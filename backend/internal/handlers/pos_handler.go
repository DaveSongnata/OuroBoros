package handlers

import (
	"encoding/json"
	"net/http"

	"github.com/ouroboros/backend/internal/auth"
	"github.com/ouroboros/backend/internal/sync"
	"github.com/ouroboros/backend/internal/tenant"
)

type productDTO struct {
	ID    string  `json:"id"`
	Name  string  `json:"name"`
	Price float64 `json:"price"`
}

type orderDTO struct {
	UUID      string    `json:"uuid"`
	ShortID   string    `json:"short_id"`
	CardID    *string   `json:"card_id"`
	ProjectID *string   `json:"project_id"`
	Total     float64   `json:"total"`
	Items     []itemDTO `json:"items,omitempty"`
}

type itemDTO struct {
	ID        string `json:"id"`
	OrderID   string `json:"order_id"`
	ProductID string `json:"product_id"`
	Qty       int    `json:"qty"`
}

// --- Products ---

func CreateProduct(tm *tenant.Manager, hub *sync.Hub) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		tenantID := auth.TenantFromCtx(r.Context())
		db, err := tm.DB(tenantID)
		if err != nil {
			http.Error(w, `{"error":"db error"}`, http.StatusInternalServerError)
			return
		}

		var req struct {
			Name  string  `json:"name"`
			Price float64 `json:"price"`
		}
		if err := decodeJSON(r, &req); err != nil || req.Name == "" {
			http.Error(w, `{"error":"name required"}`, http.StatusBadRequest)
			return
		}

		ctx := r.Context()
		tx, err := db.BeginTx(ctx, nil)
		if err != nil {
			http.Error(w, `{"error":"tx begin failed"}`, http.StatusInternalServerError)
			return
		}
		defer tx.Rollback()

		var p productDTO
		err = tx.QueryRowContext(ctx,
			"INSERT INTO products (name, price) VALUES (?, ?) RETURNING id, name, price",
			req.Name, req.Price,
		).Scan(&p.ID, &p.Name, &p.Price)
		if err != nil {
			http.Error(w, `{"error":"insert failed"}`, http.StatusInternalServerError)
			return
		}

		newVersion, err := hub.NextVersion(ctx, tenantID)
		if err != nil {
			http.Error(w, `{"error":"redis error"}`, http.StatusInternalServerError)
			return
		}

		payload, _ := json.Marshal(p)
		if _, err := tx.ExecContext(ctx,
			"INSERT INTO sync_log (table_name, entity_id, operation, payload, version) VALUES (?, ?, 'INSERT', ?, ?)",
			"products", p.ID, string(payload), newVersion,
		); err != nil {
			http.Error(w, `{"error":"sync_log insert failed"}`, http.StatusInternalServerError)
			return
		}

		if err := tx.Commit(); err != nil {
			http.Error(w, `{"error":"commit failed"}`, http.StatusInternalServerError)
			return
		}

		hub.Notify(ctx, tenantID, newVersion)
		writeJSON(w, http.StatusCreated, p)
	}
}

func ListProducts(tm *tenant.Manager) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		tenantID := auth.TenantFromCtx(r.Context())
		db, err := tm.DB(tenantID)
		if err != nil {
			http.Error(w, `{"error":"db error"}`, http.StatusInternalServerError)
			return
		}

		rows, err := db.QueryContext(r.Context(), "SELECT id, name, price FROM products ORDER BY name")
		if err != nil {
			http.Error(w, `{"error":"query failed"}`, http.StatusInternalServerError)
			return
		}
		defer rows.Close()

		var products []productDTO
		for rows.Next() {
			var p productDTO
			rows.Scan(&p.ID, &p.Name, &p.Price)
			products = append(products, p)
		}
		if products == nil {
			products = []productDTO{}
		}
		writeJSON(w, http.StatusOK, products)
	}
}

// --- Orders ---

func CreateOrder(tm *tenant.Manager, hub *sync.Hub) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		tenantID := auth.TenantFromCtx(r.Context())
		db, err := tm.DB(tenantID)
		if err != nil {
			http.Error(w, `{"error":"db error"}`, http.StatusInternalServerError)
			return
		}

		var req struct {
			CardID    *string `json:"card_id"`
			ProjectID *string `json:"project_id"`
			Items     []struct {
				ProductID string `json:"product_id"`
				Qty       int    `json:"qty"`
			} `json:"items"`
		}
		if err := decodeJSON(r, &req); err != nil || len(req.Items) == 0 {
			http.Error(w, `{"error":"items required"}`, http.StatusBadRequest)
			return
		}

		// If card_id provided, check approval status — reject if card is rejected
		ctx := r.Context()
		tx, err := db.BeginTx(ctx, nil)
		if err != nil {
			http.Error(w, `{"error":"tx begin failed"}`, http.StatusInternalServerError)
			return
		}
		defer tx.Rollback()

		if req.CardID != nil && *req.CardID != "" {
			var status string
			err := tx.QueryRowContext(ctx, "SELECT approval_status FROM kanban_cards WHERE id = ?", *req.CardID).Scan(&status)
			if err != nil {
				http.Error(w, `{"error":"card not found"}`, http.StatusBadRequest)
				return
			}
			if status == "rejected" {
				http.Error(w, `{"error":"card is rejected — sales are locked"}`, http.StatusForbidden)
				return
			}
		}

		orderUUID := uuidV7()
		sid := shortID()

		var total float64
		for _, item := range req.Items {
			var price float64
			err := tx.QueryRowContext(ctx, "SELECT price FROM products WHERE id = ?", item.ProductID).Scan(&price)
			if err != nil {
				http.Error(w, `{"error":"product not found"}`, http.StatusBadRequest)
				return
			}
			total += price * float64(item.Qty)
		}

		_, err = tx.ExecContext(ctx,
			"INSERT INTO os_orders (uuid, short_id, card_id, project_id, total) VALUES (?, ?, ?, ?, ?)",
			orderUUID, sid, req.CardID, req.ProjectID, total,
		)
		if err != nil {
			http.Error(w, `{"error":"insert order failed"}`, http.StatusInternalServerError)
			return
		}

		var items []itemDTO
		for _, item := range req.Items {
			var it itemDTO
			err = tx.QueryRowContext(ctx,
				"INSERT INTO os_items (order_id, product_id, qty) VALUES (?, ?, ?) RETURNING id, order_id, product_id, qty",
				orderUUID, item.ProductID, item.Qty,
			).Scan(&it.ID, &it.OrderID, &it.ProductID, &it.Qty)
			if err != nil {
				http.Error(w, `{"error":"insert item failed"}`, http.StatusInternalServerError)
				return
			}
			items = append(items, it)
		}

		order := orderDTO{
			UUID:      orderUUID,
			ShortID:   sid,
			CardID:    req.CardID,
			ProjectID: req.ProjectID,
			Total:     total,
			Items:     items,
		}

		newVersion, err := hub.NextVersion(ctx, tenantID)
		if err != nil {
			http.Error(w, `{"error":"redis error"}`, http.StatusInternalServerError)
			return
		}

		payload, _ := json.Marshal(order)
		if _, err := tx.ExecContext(ctx,
			"INSERT INTO sync_log (table_name, entity_id, operation, payload, version) VALUES (?, ?, 'INSERT', ?, ?)",
			"os_orders", order.UUID, string(payload), newVersion,
		); err != nil {
			http.Error(w, `{"error":"sync_log insert failed"}`, http.StatusInternalServerError)
			return
		}

		// Sync each item separately so the worker's os_items table stays populated
		for _, it := range items {
			itemPayload, _ := json.Marshal(it)
			if _, err := tx.ExecContext(ctx,
				"INSERT INTO sync_log (table_name, entity_id, operation, payload, version) VALUES (?, ?, 'INSERT', ?, ?)",
				"os_items", it.ID, string(itemPayload), newVersion,
			); err != nil {
				http.Error(w, `{"error":"sync_log insert failed"}`, http.StatusInternalServerError)
				return
			}
		}

		if err := tx.Commit(); err != nil {
			http.Error(w, `{"error":"commit failed"}`, http.StatusInternalServerError)
			return
		}

		hub.Notify(ctx, tenantID, newVersion)
		writeJSON(w, http.StatusCreated, order)
	}
}

func ListOrders(tm *tenant.Manager) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		tenantID := auth.TenantFromCtx(r.Context())
		db, err := tm.DB(tenantID)
		if err != nil {
			http.Error(w, `{"error":"db error"}`, http.StatusInternalServerError)
			return
		}

		cardID := r.URL.Query().Get("card_id")
		query := "SELECT uuid, short_id, card_id, project_id, total FROM os_orders"
		var args []any
		if cardID != "" {
			query += " WHERE card_id = ?"
			args = append(args, cardID)
		}
		query += " ORDER BY created_at DESC"

		rows, err := db.QueryContext(r.Context(), query, args...)
		if err != nil {
			http.Error(w, `{"error":"query failed"}`, http.StatusInternalServerError)
			return
		}
		defer rows.Close()

		var orders []orderDTO
		for rows.Next() {
			var o orderDTO
			rows.Scan(&o.UUID, &o.ShortID, &o.CardID, &o.ProjectID, &o.Total)
			orders = append(orders, o)
		}
		if orders == nil {
			orders = []orderDTO{}
		}
		writeJSON(w, http.StatusOK, orders)
	}
}
