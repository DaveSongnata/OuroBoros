package handlers

import (
	"encoding/json"
	"net/http"

	"github.com/ouroboros/backend/internal/auth"
	"github.com/ouroboros/backend/internal/sync"
	"github.com/ouroboros/backend/internal/tenant"
)

type project struct {
	ID   string `json:"id"`
	Name string `json:"name"`
}

func CreateProject(tm *tenant.Manager, hub *sync.Hub) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		tenantID := auth.TenantFromCtx(r.Context())
		db, err := tm.DB(tenantID)
		if err != nil {
			http.Error(w, `{"error":"db error"}`, http.StatusInternalServerError)
			return
		}

		var req struct {
			Name string `json:"name"`
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

		var p project
		err = tx.QueryRowContext(ctx,
			"INSERT INTO projects (name) VALUES (?) RETURNING id, name", req.Name,
		).Scan(&p.ID, &p.Name)
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
			"projects", p.ID, string(payload), newVersion,
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

func DeleteProject(tm *tenant.Manager, hub *sync.Hub) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		tenantID := auth.TenantFromCtx(r.Context())
		projectID := r.PathValue("id")
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

		// Delete cascade: items → orders → cards → columns → project
		tx.ExecContext(ctx, "DELETE FROM os_items WHERE order_id IN (SELECT uuid FROM os_orders WHERE project_id = ?)", projectID)
		tx.ExecContext(ctx, "DELETE FROM os_orders WHERE project_id = ?", projectID)
		tx.ExecContext(ctx, "DELETE FROM kanban_cards WHERE project_id = ?", projectID)
		tx.ExecContext(ctx, "DELETE FROM kanban_columns WHERE project_id = ?", projectID)

		result, err := tx.ExecContext(ctx, "DELETE FROM projects WHERE id = ?", projectID)
		if err != nil {
			http.Error(w, `{"error":"delete failed"}`, http.StatusInternalServerError)
			return
		}
		if n, _ := result.RowsAffected(); n == 0 {
			http.Error(w, `{"error":"project not found"}`, http.StatusNotFound)
			return
		}

		newVersion, err := hub.NextVersion(ctx, tenantID)
		if err != nil {
			http.Error(w, `{"error":"redis error"}`, http.StatusInternalServerError)
			return
		}

		if _, err := tx.ExecContext(ctx,
			`INSERT INTO sync_log (table_name, entity_id, operation, payload, version) VALUES (?, ?, 'DELETE', '{}', ?)`,
			"projects", projectID, newVersion,
		); err != nil {
			http.Error(w, `{"error":"sync_log insert failed"}`, http.StatusInternalServerError)
			return
		}

		if err := tx.Commit(); err != nil {
			http.Error(w, `{"error":"commit failed"}`, http.StatusInternalServerError)
			return
		}

		hub.Notify(ctx, tenantID, newVersion)
		writeJSON(w, http.StatusOK, map[string]string{"deleted": projectID})
	}
}

func ListProjects(tm *tenant.Manager) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		tenantID := auth.TenantFromCtx(r.Context())
		db, err := tm.DB(tenantID)
		if err != nil {
			http.Error(w, `{"error":"db error"}`, http.StatusInternalServerError)
			return
		}

		rows, err := db.QueryContext(r.Context(), "SELECT id, name FROM projects ORDER BY created_at")
		if err != nil {
			http.Error(w, `{"error":"query failed"}`, http.StatusInternalServerError)
			return
		}
		defer rows.Close()

		var projects []project
		for rows.Next() {
			var p project
			rows.Scan(&p.ID, &p.Name)
			projects = append(projects, p)
		}
		if projects == nil {
			projects = []project{}
		}
		writeJSON(w, http.StatusOK, projects)
	}
}
