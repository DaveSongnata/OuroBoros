package handlers

import (
	"encoding/json"
	"net/http"

	"github.com/ouroboros/backend/internal/auth"
	"github.com/ouroboros/backend/internal/sync"
	"github.com/ouroboros/backend/internal/tenant"
)

type column struct {
	ID        string `json:"id"`
	ProjectID string `json:"project_id"`
	Name      string `json:"name"`
	Color     string `json:"color"`
	Position  int    `json:"position"`
}

func CreateColumn(tm *tenant.Manager, hub *sync.Hub) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		tenantID := auth.TenantFromCtx(r.Context())
		db, err := tm.DB(tenantID)
		if err != nil {
			http.Error(w, `{"error":"db error"}`, http.StatusInternalServerError)
			return
		}

		var req struct {
			ProjectID string `json:"project_id"`
			Name      string `json:"name"`
			Color     string `json:"color"`
			Position  int    `json:"position"`
		}
		if err := decodeJSON(r, &req); err != nil || req.Name == "" || req.ProjectID == "" {
			http.Error(w, `{"error":"project_id and name required"}`, http.StatusBadRequest)
			return
		}
		if req.Color == "" {
			req.Color = "bg-gray-500"
		}

		ctx := r.Context()
		tx, err := db.BeginTx(ctx, nil)
		if err != nil {
			http.Error(w, `{"error":"tx begin failed"}`, http.StatusInternalServerError)
			return
		}
		defer tx.Rollback()

		var c column
		err = tx.QueryRowContext(ctx,
			`INSERT INTO kanban_columns (project_id, name, color, position)
			 VALUES (?, ?, ?, ?)
			 RETURNING id, project_id, name, color, position`,
			req.ProjectID, req.Name, req.Color, req.Position,
		).Scan(&c.ID, &c.ProjectID, &c.Name, &c.Color, &c.Position)
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
			"kanban_columns", c.ID, string(payload), newVersion,
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

func UpdateColumn(tm *tenant.Manager, hub *sync.Hub) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		tenantID := auth.TenantFromCtx(r.Context())
		colID := r.PathValue("id")
		db, err := tm.DB(tenantID)
		if err != nil {
			http.Error(w, `{"error":"db error"}`, http.StatusInternalServerError)
			return
		}

		var req struct {
			Name     *string `json:"name"`
			Color    *string `json:"color"`
			Position *int    `json:"position"`
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

		if req.Name != nil {
			tx.ExecContext(ctx, "UPDATE kanban_columns SET name = ? WHERE id = ?", *req.Name, colID)
		}
		if req.Color != nil {
			tx.ExecContext(ctx, "UPDATE kanban_columns SET color = ? WHERE id = ?", *req.Color, colID)
		}
		if req.Position != nil {
			tx.ExecContext(ctx, "UPDATE kanban_columns SET position = ? WHERE id = ?", *req.Position, colID)
		}

		var c column
		err = tx.QueryRowContext(ctx,
			"SELECT id, project_id, name, color, position FROM kanban_columns WHERE id = ?", colID,
		).Scan(&c.ID, &c.ProjectID, &c.Name, &c.Color, &c.Position)
		if err != nil {
			http.Error(w, `{"error":"column not found"}`, http.StatusNotFound)
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
			"kanban_columns", c.ID, string(payload), newVersion,
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

func DeleteColumn(tm *tenant.Manager, hub *sync.Hub) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		tenantID := auth.TenantFromCtx(r.Context())
		colID := r.PathValue("id")
		db, err := tm.DB(tenantID)
		if err != nil {
			http.Error(w, `{"error":"db error"}`, http.StatusInternalServerError)
			return
		}

		ctx := r.Context()
		tx, err := db.BeginTx(ctx, nil)
		if err != nil {
			http.Error(w, `{"error":"tx begin failed"}`, http.StatusInternalServerError)
			return
		}
		defer tx.Rollback()

		result, err := tx.ExecContext(ctx, "DELETE FROM kanban_columns WHERE id = ?", colID)
		if err != nil {
			http.Error(w, `{"error":"delete failed"}`, http.StatusInternalServerError)
			return
		}
		if n, _ := result.RowsAffected(); n == 0 {
			http.Error(w, `{"error":"column not found"}`, http.StatusNotFound)
			return
		}

		newVersion, err := hub.NextVersion(ctx, tenantID)
		if err != nil {
			http.Error(w, `{"error":"redis error"}`, http.StatusInternalServerError)
			return
		}

		if _, err := tx.ExecContext(ctx,
			`INSERT INTO sync_log (table_name, entity_id, operation, payload, version) VALUES (?, ?, 'DELETE', '{}', ?)`,
			"kanban_columns", colID, newVersion,
		); err != nil {
			http.Error(w, `{"error":"sync_log insert failed"}`, http.StatusInternalServerError)
			return
		}

		if err := tx.Commit(); err != nil {
			http.Error(w, `{"error":"commit failed"}`, http.StatusInternalServerError)
			return
		}

		hub.Notify(ctx, tenantID, newVersion)
		writeJSON(w, http.StatusOK, map[string]string{"deleted": colID})
	}
}

func ListColumns(tm *tenant.Manager) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		tenantID := auth.TenantFromCtx(r.Context())
		db, err := tm.DB(tenantID)
		if err != nil {
			http.Error(w, `{"error":"db error"}`, http.StatusInternalServerError)
			return
		}

		projectID := r.URL.Query().Get("project_id")
		query := "SELECT id, project_id, name, color, position FROM kanban_columns"
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

		var cols []column
		for rows.Next() {
			var c column
			rows.Scan(&c.ID, &c.ProjectID, &c.Name, &c.Color, &c.Position)
			cols = append(cols, c)
		}
		if cols == nil {
			cols = []column{}
		}
		writeJSON(w, http.StatusOK, cols)
	}
}
