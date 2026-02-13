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

		// Insert project
		var p project
		err = tx.QueryRowContext(ctx,
			"INSERT INTO projects (name) VALUES (?) RETURNING id, name", req.Name,
		).Scan(&p.ID, &p.Name)
		if err != nil {
			http.Error(w, `{"error":"insert failed"}`, http.StatusInternalServerError)
			return
		}

		// Increment version and log to sync_log
		newVersion, err := hub.Publish(ctx, tenantID)
		if err != nil {
			http.Error(w, `{"error":"redis error"}`, http.StatusInternalServerError)
			return
		}

		payload, _ := json.Marshal(p)
		_, err = tx.ExecContext(ctx,
			"INSERT INTO sync_log (table_name, entity_id, operation, payload, version) VALUES (?, ?, 'INSERT', ?, ?)",
			"projects", p.ID, string(payload), newVersion,
		)
		if err != nil {
			http.Error(w, `{"error":"sync_log insert failed"}`, http.StatusInternalServerError)
			return
		}

		if err := tx.Commit(); err != nil {
			http.Error(w, `{"error":"commit failed"}`, http.StatusInternalServerError)
			return
		}

		writeJSON(w, http.StatusCreated, p)
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
