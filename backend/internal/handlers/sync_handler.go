package handlers

import (
	"net/http"
	"strconv"

	"github.com/ouroboros/backend/internal/auth"
	"github.com/ouroboros/backend/internal/sync"
	"github.com/ouroboros/backend/internal/tenant"
)

type syncEntry struct {
	ID        int64  `json:"id"`
	Table     string `json:"table_name"`
	EntityID  string `json:"entity_id"`
	Operation string `json:"operation"`
	Payload   string `json:"payload"`
	Version   int64  `json:"version"`
}

// GetSync handles GET /api/sync?since={version}
// Returns all sync_log entries with version > since.
func GetSync(tm *tenant.Manager) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		tenantID := auth.TenantFromCtx(r.Context())
		db, err := tm.DB(tenantID)
		if err != nil {
			http.Error(w, `{"error":"db error"}`, http.StatusInternalServerError)
			return
		}

		since, _ := strconv.ParseInt(r.URL.Query().Get("since"), 10, 64)

		rows, err := db.QueryContext(r.Context(),
			"SELECT id, table_name, entity_id, operation, payload, version FROM sync_log WHERE version > ? ORDER BY version ASC",
			since,
		)
		if err != nil {
			http.Error(w, `{"error":"query failed"}`, http.StatusInternalServerError)
			return
		}
		defer rows.Close()

		var entries []syncEntry
		for rows.Next() {
			var e syncEntry
			if err := rows.Scan(&e.ID, &e.Table, &e.EntityID, &e.Operation, &e.Payload, &e.Version); err != nil {
				http.Error(w, `{"error":"scan failed"}`, http.StatusInternalServerError)
				return
			}
			entries = append(entries, e)
		}
		if entries == nil {
			entries = []syncEntry{}
		}
		writeJSON(w, http.StatusOK, entries)
	}
}

// SSEHandler handles GET /sse/events — Server-Sent Events for real-time sync.
func SSEHandler(hub *sync.Hub) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		tenantID := auth.TenantFromCtx(r.Context())

		flusher, ok := w.(http.Flusher)
		if !ok {
			http.Error(w, "streaming unsupported", http.StatusInternalServerError)
			return
		}

		w.Header().Set("Content-Type", "text/event-stream")
		w.Header().Set("Cache-Control", "no-cache")
		w.Header().Set("Connection", "keep-alive")
		w.Header().Set("X-Accel-Buffering", "no")
		// Initial comment forces proxies (Vite, Nginx) to forward the response
		w.Write([]byte(":ok\n\n"))
		flusher.Flush()

		ch, unsub := hub.Subscribe(tenantID)
		defer unsub()

		ctx := r.Context()
		for {
			select {
			case <-ctx.Done():
				return
			case version, ok := <-ch:
				if !ok {
					return
				}
				// SSE format: "data: {version}\n\n"
				w.Write([]byte("data: " + strconv.FormatInt(version, 10) + "\n\n"))
				flusher.Flush()
			}
		}
	}
}
