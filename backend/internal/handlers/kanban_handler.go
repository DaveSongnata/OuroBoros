package handlers

import (
	"encoding/json"
	"net/http"

	"github.com/ouroboros/backend/internal/auth"
	"github.com/ouroboros/backend/internal/sync"
	"github.com/ouroboros/backend/internal/tenant"
)

type card struct {
	ID                 string  `json:"id"`
	ProjectID          string  `json:"project_id"`
	ColumnName         string  `json:"column_name"`
	Title              string  `json:"title"`
	Position           int     `json:"position"`
	ApprovalStatus     string  `json:"approval_status"`
	AssignedApproverID *string `json:"assigned_approver_id"`
	DueDate            *string `json:"due_date"`
	Client             *string `json:"client"`
	Priority           string  `json:"priority"`
	Notes              *string `json:"notes"`
}

func CreateCard(tm *tenant.Manager, hub *sync.Hub) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		tenantID := auth.TenantFromCtx(r.Context())
		db, err := tm.DB(tenantID)
		if err != nil {
			http.Error(w, `{"error":"db error"}`, http.StatusInternalServerError)
			return
		}

		var req struct {
			ProjectID  string `json:"project_id"`
			ColumnName string `json:"column_name"`
			Title      string `json:"title"`
			Position   int    `json:"position"`
		}
		if err := decodeJSON(r, &req); err != nil || req.Title == "" || req.ProjectID == "" {
			http.Error(w, `{"error":"project_id and title required"}`, http.StatusBadRequest)
			return
		}
		if req.ColumnName == "" {
			req.ColumnName = "backlog"
		}

		ctx := r.Context()
		tx, err := db.BeginTx(ctx, nil)
		if err != nil {
			http.Error(w, `{"error":"tx begin failed"}`, http.StatusInternalServerError)
			return
		}
		defer tx.Rollback()

		var c card
		err = tx.QueryRowContext(ctx,
			`INSERT INTO kanban_cards (project_id, column_name, title, position)
			 VALUES (?, ?, ?, ?)
			 RETURNING id, project_id, column_name, title, position, approval_status, assigned_approver_id, due_date, client, priority, notes`,
			req.ProjectID, req.ColumnName, req.Title, req.Position,
		).Scan(&c.ID, &c.ProjectID, &c.ColumnName, &c.Title, &c.Position, &c.ApprovalStatus, &c.AssignedApproverID, &c.DueDate, &c.Client, &c.Priority, &c.Notes)
		if err != nil {
			http.Error(w, `{"error":"insert failed"}`, http.StatusInternalServerError)
			return
		}

		newVersion, err := hub.NextVersion(ctx, tenantID)
		if err != nil {
			http.Error(w, `{"error":"redis error"}`, http.StatusInternalServerError)
			return
		}

		payload, _ := json.Marshal(c)
		if _, err := tx.ExecContext(ctx,
			"INSERT INTO sync_log (table_name, entity_id, operation, payload, version) VALUES (?, ?, 'INSERT', ?, ?)",
			"kanban_cards", c.ID, string(payload), newVersion,
		); err != nil {
			http.Error(w, `{"error":"sync_log insert failed"}`, http.StatusInternalServerError)
			return
		}

		if err := tx.Commit(); err != nil {
			http.Error(w, `{"error":"commit failed"}`, http.StatusInternalServerError)
			return
		}

		hub.Notify(ctx, tenantID, newVersion)
		writeJSON(w, http.StatusCreated, c)
	}
}

func UpdateCard(tm *tenant.Manager, hub *sync.Hub) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		tenantID := auth.TenantFromCtx(r.Context())
		cardID := r.PathValue("id")
		db, err := tm.DB(tenantID)
		if err != nil {
			http.Error(w, `{"error":"db error"}`, http.StatusInternalServerError)
			return
		}

		var req struct {
			ColumnName         *string `json:"column_name"`
			Title              *string `json:"title"`
			Position           *int    `json:"position"`
			ApprovalStatus     *string `json:"approval_status"`
			AssignedApproverID *string `json:"assigned_approver_id"`
			DueDate            *string `json:"due_date"`
			Client             *string `json:"client"`
			Priority           *string `json:"priority"`
			Notes              *string `json:"notes"`
		}
		if err := decodeJSON(r, &req); err != nil {
			http.Error(w, `{"error":"invalid json"}`, http.StatusBadRequest)
			return
		}

		ctx := r.Context()
		tx, err := db.BeginTx(ctx, nil)
		if err != nil {
			http.Error(w, `{"error":"tx begin failed"}`, http.StatusInternalServerError)
			return
		}
		defer tx.Rollback()

		if req.ColumnName != nil {
			tx.ExecContext(ctx, "UPDATE kanban_cards SET column_name = ? WHERE id = ?", *req.ColumnName, cardID)
		}
		if req.Title != nil {
			tx.ExecContext(ctx, "UPDATE kanban_cards SET title = ? WHERE id = ?", *req.Title, cardID)
		}
		if req.Position != nil {
			tx.ExecContext(ctx, "UPDATE kanban_cards SET position = ? WHERE id = ?", *req.Position, cardID)
		}
		if req.ApprovalStatus != nil {
			tx.ExecContext(ctx, "UPDATE kanban_cards SET approval_status = ? WHERE id = ?", *req.ApprovalStatus, cardID)
		}
		if req.AssignedApproverID != nil {
			tx.ExecContext(ctx, "UPDATE kanban_cards SET assigned_approver_id = ? WHERE id = ?", *req.AssignedApproverID, cardID)
		}
		if req.DueDate != nil {
			tx.ExecContext(ctx, "UPDATE kanban_cards SET due_date = ? WHERE id = ?", *req.DueDate, cardID)
		}
		if req.Client != nil {
			tx.ExecContext(ctx, "UPDATE kanban_cards SET client = ? WHERE id = ?", *req.Client, cardID)
		}
		if req.Priority != nil {
			tx.ExecContext(ctx, "UPDATE kanban_cards SET priority = ? WHERE id = ?", *req.Priority, cardID)
		}
		if req.Notes != nil {
			tx.ExecContext(ctx, "UPDATE kanban_cards SET notes = ? WHERE id = ?", *req.Notes, cardID)
		}

		var c card
		err = tx.QueryRowContext(ctx,
			`SELECT id, project_id, column_name, title, position, approval_status,
			        assigned_approver_id, due_date, client, priority, notes
			 FROM kanban_cards WHERE id = ?`, cardID,
		).Scan(&c.ID, &c.ProjectID, &c.ColumnName, &c.Title, &c.Position, &c.ApprovalStatus,
			&c.AssignedApproverID, &c.DueDate, &c.Client, &c.Priority, &c.Notes)
		if err != nil {
			http.Error(w, `{"error":"card not found"}`, http.StatusNotFound)
			return
		}

		newVersion, err := hub.NextVersion(ctx, tenantID)
		if err != nil {
			http.Error(w, `{"error":"redis error"}`, http.StatusInternalServerError)
			return
		}

		payload, _ := json.Marshal(c)
		if _, err := tx.ExecContext(ctx,
			"INSERT INTO sync_log (table_name, entity_id, operation, payload, version) VALUES (?, ?, 'UPDATE', ?, ?)",
			"kanban_cards", c.ID, string(payload), newVersion,
		); err != nil {
			http.Error(w, `{"error":"sync_log insert failed"}`, http.StatusInternalServerError)
			return
		}

		if err := tx.Commit(); err != nil {
			http.Error(w, `{"error":"commit failed"}`, http.StatusInternalServerError)
			return
		}

		hub.Notify(ctx, tenantID, newVersion)
		writeJSON(w, http.StatusOK, c)
	}
}

func ListCards(tm *tenant.Manager) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		tenantID := auth.TenantFromCtx(r.Context())
		db, err := tm.DB(tenantID)
		if err != nil {
			http.Error(w, `{"error":"db error"}`, http.StatusInternalServerError)
			return
		}

		projectID := r.URL.Query().Get("project_id")
		query := "SELECT id, project_id, column_name, title, position, approval_status, assigned_approver_id, due_date, client, priority, notes FROM kanban_cards"
		var args []any
		if projectID != "" {
			query += " WHERE project_id = ?"
			args = append(args, projectID)
		}
		query += " ORDER BY position"

		rows, err := db.QueryContext(r.Context(), query, args...)
		if err != nil {
			http.Error(w, `{"error":"query failed"}`, http.StatusInternalServerError)
			return
		}
		defer rows.Close()

		var cards []card
		for rows.Next() {
			var c card
			rows.Scan(&c.ID, &c.ProjectID, &c.ColumnName, &c.Title, &c.Position, &c.ApprovalStatus, &c.AssignedApproverID, &c.DueDate, &c.Client, &c.Priority, &c.Notes)
			cards = append(cards, c)
		}
		if cards == nil {
			cards = []card{}
		}
		writeJSON(w, http.StatusOK, cards)
	}
}
