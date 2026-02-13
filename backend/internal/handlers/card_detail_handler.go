package handlers

import (
	"context"
	"database/sql"
	"encoding/json"
	"net/http"
	"time"

	"github.com/ouroboros/backend/internal/auth"
	"github.com/ouroboros/backend/internal/sync"
	"github.com/ouroboros/backend/internal/tenant"
)

// --- DTOs ---

type tagDTO struct {
	ID     string `json:"id"`
	CardID string `json:"card_id"`
	Name   string `json:"name"`
}

type assigneeDTO struct {
	ID        string `json:"id"`
	CardID    string `json:"card_id"`
	UserID    string `json:"user_id"`
	UserEmail string `json:"user_email"`
}

type approverDTO struct {
	ID        string  `json:"id"`
	CardID    string  `json:"card_id"`
	UserID    string  `json:"user_id"`
	UserEmail string  `json:"user_email"`
	Status    string  `json:"status"`
	DecidedAt *string `json:"decided_at"`
}

type sessionDTO struct {
	ID       string `json:"id"`
	CardID   string `json:"card_id"`
	Name     string `json:"name"`
	Position int    `json:"position"`
}

// ──────────────────────────── Tags ────────────────────────────

func AddTag(tm *tenant.Manager, hub *sync.Hub) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		tenantID := auth.TenantFromCtx(r.Context())
		cardID := r.PathValue("cardId")
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

		var t tagDTO
		err = tx.QueryRowContext(ctx,
			"INSERT INTO card_tags (card_id, name) VALUES (?, ?) RETURNING id, card_id, name",
			cardID, req.Name,
		).Scan(&t.ID, &t.CardID, &t.Name)
		if err != nil {
			http.Error(w, `{"error":"insert failed"}`, http.StatusInternalServerError)
			return
		}

		newVersion, err := hub.NextVersion(ctx, tenantID)
		if err != nil {
			http.Error(w, `{"error":"redis error"}`, http.StatusInternalServerError)
			return
		}

		payload, _ := json.Marshal(t)
		if _, err := tx.ExecContext(ctx,
			"INSERT INTO sync_log (table_name, entity_id, operation, payload, version) VALUES (?, ?, 'INSERT', ?, ?)",
			"card_tags", t.ID, string(payload), newVersion,
		); err != nil {
			http.Error(w, `{"error":"sync_log insert failed"}`, http.StatusInternalServerError)
			return
		}

		if err := tx.Commit(); err != nil {
			http.Error(w, `{"error":"commit failed"}`, http.StatusInternalServerError)
			return
		}

		hub.Notify(ctx, tenantID, newVersion)
		writeJSON(w, http.StatusCreated, t)
	}
}

func RemoveTag(tm *tenant.Manager, hub *sync.Hub) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		tenantID := auth.TenantFromCtx(r.Context())
		tagID := r.PathValue("tagId")
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

		result, err := tx.ExecContext(ctx, "DELETE FROM card_tags WHERE id = ?", tagID)
		if err != nil {
			http.Error(w, `{"error":"delete failed"}`, http.StatusInternalServerError)
			return
		}
		if n, _ := result.RowsAffected(); n == 0 {
			http.Error(w, `{"error":"tag not found"}`, http.StatusNotFound)
			return
		}

		newVersion, err := hub.NextVersion(ctx, tenantID)
		if err != nil {
			http.Error(w, `{"error":"redis error"}`, http.StatusInternalServerError)
			return
		}

		if _, err := tx.ExecContext(ctx,
			`INSERT INTO sync_log (table_name, entity_id, operation, payload, version) VALUES (?, ?, 'DELETE', '{}', ?)`,
			"card_tags", tagID, newVersion,
		); err != nil {
			http.Error(w, `{"error":"sync_log insert failed"}`, http.StatusInternalServerError)
			return
		}

		if err := tx.Commit(); err != nil {
			http.Error(w, `{"error":"commit failed"}`, http.StatusInternalServerError)
			return
		}

		hub.Notify(ctx, tenantID, newVersion)
		writeJSON(w, http.StatusOK, map[string]string{"deleted": tagID})
	}
}

// ──────────────────────────── Assigned Users ────────────────────────────

func AssignUser(tm *tenant.Manager, hub *sync.Hub) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		tenantID := auth.TenantFromCtx(r.Context())
		cardID := r.PathValue("cardId")
		db, err := tm.DB(tenantID)
		if err != nil {
			http.Error(w, `{"error":"db error"}`, http.StatusInternalServerError)
			return
		}

		var req struct {
			UserID    string `json:"user_id"`
			UserEmail string `json:"user_email"`
		}
		if err := decodeJSON(r, &req); err != nil || req.UserID == "" || req.UserEmail == "" {
			http.Error(w, `{"error":"user_id and user_email required"}`, http.StatusBadRequest)
			return
		}

		ctx := r.Context()
		tx, err := db.BeginTx(ctx, nil)
		if err != nil {
			http.Error(w, `{"error":"tx begin failed"}`, http.StatusInternalServerError)
			return
		}
		defer tx.Rollback()

		var a assigneeDTO
		err = tx.QueryRowContext(ctx,
			"INSERT INTO card_assigned_users (card_id, user_id, user_email) VALUES (?, ?, ?) RETURNING id, card_id, user_id, user_email",
			cardID, req.UserID, req.UserEmail,
		).Scan(&a.ID, &a.CardID, &a.UserID, &a.UserEmail)
		if err != nil {
			http.Error(w, `{"error":"insert failed"}`, http.StatusInternalServerError)
			return
		}

		newVersion, err := hub.NextVersion(ctx, tenantID)
		if err != nil {
			http.Error(w, `{"error":"redis error"}`, http.StatusInternalServerError)
			return
		}

		payload, _ := json.Marshal(a)
		if _, err := tx.ExecContext(ctx,
			"INSERT INTO sync_log (table_name, entity_id, operation, payload, version) VALUES (?, ?, 'INSERT', ?, ?)",
			"card_assigned_users", a.ID, string(payload), newVersion,
		); err != nil {
			http.Error(w, `{"error":"sync_log insert failed"}`, http.StatusInternalServerError)
			return
		}

		if err := tx.Commit(); err != nil {
			http.Error(w, `{"error":"commit failed"}`, http.StatusInternalServerError)
			return
		}

		hub.Notify(ctx, tenantID, newVersion)
		writeJSON(w, http.StatusCreated, a)
	}
}

func UnassignUser(tm *tenant.Manager, hub *sync.Hub) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		tenantID := auth.TenantFromCtx(r.Context())
		assigneeID := r.PathValue("assigneeId")
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

		result, err := tx.ExecContext(ctx, "DELETE FROM card_assigned_users WHERE id = ?", assigneeID)
		if err != nil {
			http.Error(w, `{"error":"delete failed"}`, http.StatusInternalServerError)
			return
		}
		if n, _ := result.RowsAffected(); n == 0 {
			http.Error(w, `{"error":"assignee not found"}`, http.StatusNotFound)
			return
		}

		newVersion, err := hub.NextVersion(ctx, tenantID)
		if err != nil {
			http.Error(w, `{"error":"redis error"}`, http.StatusInternalServerError)
			return
		}

		if _, err := tx.ExecContext(ctx,
			`INSERT INTO sync_log (table_name, entity_id, operation, payload, version) VALUES (?, ?, 'DELETE', '{}', ?)`,
			"card_assigned_users", assigneeID, newVersion,
		); err != nil {
			http.Error(w, `{"error":"sync_log insert failed"}`, http.StatusInternalServerError)
			return
		}

		if err := tx.Commit(); err != nil {
			http.Error(w, `{"error":"commit failed"}`, http.StatusInternalServerError)
			return
		}

		hub.Notify(ctx, tenantID, newVersion)
		writeJSON(w, http.StatusOK, map[string]string{"deleted": assigneeID})
	}
}

// ──────────────────────────── Approvers ────────────────────────────

func AddApprover(tm *tenant.Manager, hub *sync.Hub) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		tenantID := auth.TenantFromCtx(r.Context())
		cardID := r.PathValue("cardId")
		db, err := tm.DB(tenantID)
		if err != nil {
			http.Error(w, `{"error":"db error"}`, http.StatusInternalServerError)
			return
		}

		var req struct {
			UserID    string `json:"user_id"`
			UserEmail string `json:"user_email"`
		}
		if err := decodeJSON(r, &req); err != nil || req.UserID == "" || req.UserEmail == "" {
			http.Error(w, `{"error":"user_id and user_email required"}`, http.StatusBadRequest)
			return
		}

		ctx := r.Context()
		tx, err := db.BeginTx(ctx, nil)
		if err != nil {
			http.Error(w, `{"error":"tx begin failed"}`, http.StatusInternalServerError)
			return
		}
		defer tx.Rollback()

		var a approverDTO
		err = tx.QueryRowContext(ctx,
			`INSERT INTO card_approvers (card_id, user_id, user_email)
			 VALUES (?, ?, ?)
			 RETURNING id, card_id, user_id, user_email, status, decided_at`,
			cardID, req.UserID, req.UserEmail,
		).Scan(&a.ID, &a.CardID, &a.UserID, &a.UserEmail, &a.Status, &a.DecidedAt)
		if err != nil {
			http.Error(w, `{"error":"insert failed"}`, http.StatusInternalServerError)
			return
		}

		// When approvers are added, card goes to pending
		tx.ExecContext(ctx, "UPDATE kanban_cards SET approval_status = 'pending' WHERE id = ?", cardID)

		newVersion, err := hub.NextVersion(ctx, tenantID)
		if err != nil {
			http.Error(w, `{"error":"redis error"}`, http.StatusInternalServerError)
			return
		}

		payload, _ := json.Marshal(a)
		if _, err := tx.ExecContext(ctx,
			"INSERT INTO sync_log (table_name, entity_id, operation, payload, version) VALUES (?, ?, 'INSERT', ?, ?)",
			"card_approvers", a.ID, string(payload), newVersion,
		); err != nil {
			http.Error(w, `{"error":"sync_log insert failed"}`, http.StatusInternalServerError)
			return
		}

		if err := syncCardUpdate(tx, ctx, cardID, newVersion); err != nil {
			http.Error(w, `{"error":"sync_log insert failed"}`, http.StatusInternalServerError)
			return
		}

		if err := tx.Commit(); err != nil {
			http.Error(w, `{"error":"commit failed"}`, http.StatusInternalServerError)
			return
		}

		hub.Notify(ctx, tenantID, newVersion)
		writeJSON(w, http.StatusCreated, a)
	}
}

func RemoveApprover(tm *tenant.Manager, hub *sync.Hub) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		tenantID := auth.TenantFromCtx(r.Context())
		approverID := r.PathValue("approverId")
		cardID := r.PathValue("cardId")
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

		result, err := tx.ExecContext(ctx, "DELETE FROM card_approvers WHERE id = ?", approverID)
		if err != nil {
			http.Error(w, `{"error":"delete failed"}`, http.StatusInternalServerError)
			return
		}
		if n, _ := result.RowsAffected(); n == 0 {
			http.Error(w, `{"error":"approver not found"}`, http.StatusNotFound)
			return
		}

		recalcApprovalStatus(tx, ctx, cardID)

		newVersion, err := hub.NextVersion(ctx, tenantID)
		if err != nil {
			http.Error(w, `{"error":"redis error"}`, http.StatusInternalServerError)
			return
		}

		if _, err := tx.ExecContext(ctx,
			`INSERT INTO sync_log (table_name, entity_id, operation, payload, version) VALUES (?, ?, 'DELETE', '{}', ?)`,
			"card_approvers", approverID, newVersion,
		); err != nil {
			http.Error(w, `{"error":"sync_log insert failed"}`, http.StatusInternalServerError)
			return
		}

		if err := syncCardUpdate(tx, ctx, cardID, newVersion); err != nil {
			http.Error(w, `{"error":"sync_log insert failed"}`, http.StatusInternalServerError)
			return
		}

		if err := tx.Commit(); err != nil {
			http.Error(w, `{"error":"commit failed"}`, http.StatusInternalServerError)
			return
		}

		hub.Notify(ctx, tenantID, newVersion)
		writeJSON(w, http.StatusOK, map[string]string{"deleted": approverID})
	}
}

func DecideApproval(tm *tenant.Manager, hub *sync.Hub) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		tenantID := auth.TenantFromCtx(r.Context())
		userID := auth.UserFromCtx(r.Context())
		cardID := r.PathValue("cardId")
		approverID := r.PathValue("approverId")
		db, err := tm.DB(tenantID)
		if err != nil {
			http.Error(w, `{"error":"db error"}`, http.StatusInternalServerError)
			return
		}

		var req struct {
			Status string `json:"status"`
		}
		if err := decodeJSON(r, &req); err != nil || (req.Status != "approved" && req.Status != "rejected") {
			http.Error(w, `{"error":"status must be approved or rejected"}`, http.StatusBadRequest)
			return
		}

		ctx := r.Context()
		tx, err := db.BeginTx(ctx, nil)
		if err != nil {
			http.Error(w, `{"error":"tx begin failed"}`, http.StatusInternalServerError)
			return
		}
		defer tx.Rollback()

		// Verify current user owns this approver entry
		var approverUserID string
		err = tx.QueryRowContext(ctx,
			"SELECT user_id FROM card_approvers WHERE id = ? AND card_id = ?",
			approverID, cardID,
		).Scan(&approverUserID)
		if err != nil {
			http.Error(w, `{"error":"approver not found"}`, http.StatusNotFound)
			return
		}
		if approverUserID != userID {
			http.Error(w, `{"error":"you can only decide your own approval"}`, http.StatusForbidden)
			return
		}

		decidedAt := time.Now().UTC().Format(time.RFC3339)
		tx.ExecContext(ctx,
			"UPDATE card_approvers SET status = ?, decided_at = ? WHERE id = ?",
			req.Status, decidedAt, approverID,
		)

		recalcApprovalStatus(tx, ctx, cardID)

		// Read updated approver
		var a approverDTO
		err = tx.QueryRowContext(ctx,
			"SELECT id, card_id, user_id, user_email, status, decided_at FROM card_approvers WHERE id = ?",
			approverID,
		).Scan(&a.ID, &a.CardID, &a.UserID, &a.UserEmail, &a.Status, &a.DecidedAt)
		if err != nil {
			http.Error(w, `{"error":"read approver failed"}`, http.StatusInternalServerError)
			return
		}

		newVersion, err := hub.NextVersion(ctx, tenantID)
		if err != nil {
			http.Error(w, `{"error":"redis error"}`, http.StatusInternalServerError)
			return
		}

		payload, _ := json.Marshal(a)
		if _, err := tx.ExecContext(ctx,
			"INSERT INTO sync_log (table_name, entity_id, operation, payload, version) VALUES (?, ?, 'UPDATE', ?, ?)",
			"card_approvers", a.ID, string(payload), newVersion,
		); err != nil {
			http.Error(w, `{"error":"sync_log insert failed"}`, http.StatusInternalServerError)
			return
		}

		if err := syncCardUpdate(tx, ctx, cardID, newVersion); err != nil {
			http.Error(w, `{"error":"sync_log insert failed"}`, http.StatusInternalServerError)
			return
		}

		if err := tx.Commit(); err != nil {
			http.Error(w, `{"error":"commit failed"}`, http.StatusInternalServerError)
			return
		}

		hub.Notify(ctx, tenantID, newVersion)
		writeJSON(w, http.StatusOK, a)
	}
}

// ──────────────────────────── Sessions ────────────────────────────

func CreateSession(tm *tenant.Manager, hub *sync.Hub) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		tenantID := auth.TenantFromCtx(r.Context())
		cardID := r.PathValue("cardId")
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

		var pos int
		tx.QueryRowContext(ctx, "SELECT COUNT(*) FROM card_sessions WHERE card_id = ?", cardID).Scan(&pos)

		var s sessionDTO
		err = tx.QueryRowContext(ctx,
			"INSERT INTO card_sessions (card_id, name, position) VALUES (?, ?, ?) RETURNING id, card_id, name, position",
			cardID, req.Name, pos,
		).Scan(&s.ID, &s.CardID, &s.Name, &s.Position)
		if err != nil {
			http.Error(w, `{"error":"insert failed"}`, http.StatusInternalServerError)
			return
		}

		newVersion, err := hub.NextVersion(ctx, tenantID)
		if err != nil {
			http.Error(w, `{"error":"redis error"}`, http.StatusInternalServerError)
			return
		}

		payload, _ := json.Marshal(s)
		if _, err := tx.ExecContext(ctx,
			"INSERT INTO sync_log (table_name, entity_id, operation, payload, version) VALUES (?, ?, 'INSERT', ?, ?)",
			"card_sessions", s.ID, string(payload), newVersion,
		); err != nil {
			http.Error(w, `{"error":"sync_log insert failed"}`, http.StatusInternalServerError)
			return
		}

		if err := tx.Commit(); err != nil {
			http.Error(w, `{"error":"commit failed"}`, http.StatusInternalServerError)
			return
		}

		hub.Notify(ctx, tenantID, newVersion)
		writeJSON(w, http.StatusCreated, s)
	}
}

func DeleteSession(tm *tenant.Manager, hub *sync.Hub) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		tenantID := auth.TenantFromCtx(r.Context())
		sessionID := r.PathValue("sessionId")
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

		result, err := tx.ExecContext(ctx, "DELETE FROM card_sessions WHERE id = ?", sessionID)
		if err != nil {
			http.Error(w, `{"error":"delete failed"}`, http.StatusInternalServerError)
			return
		}
		if n, _ := result.RowsAffected(); n == 0 {
			http.Error(w, `{"error":"session not found"}`, http.StatusNotFound)
			return
		}

		newVersion, err := hub.NextVersion(ctx, tenantID)
		if err != nil {
			http.Error(w, `{"error":"redis error"}`, http.StatusInternalServerError)
			return
		}

		if _, err := tx.ExecContext(ctx,
			`INSERT INTO sync_log (table_name, entity_id, operation, payload, version) VALUES (?, ?, 'DELETE', '{}', ?)`,
			"card_sessions", sessionID, newVersion,
		); err != nil {
			http.Error(w, `{"error":"sync_log insert failed"}`, http.StatusInternalServerError)
			return
		}

		if err := tx.Commit(); err != nil {
			http.Error(w, `{"error":"commit failed"}`, http.StatusInternalServerError)
			return
		}

		hub.Notify(ctx, tenantID, newVersion)
		writeJSON(w, http.StatusOK, map[string]string{"deleted": sessionID})
	}
}

// ──────────────────────────── Helpers ────────────────────────────

// recalcApprovalStatus checks all approvers and updates the card's approval_status.
// any rejected → rejected, all approved → approved, otherwise pending.
func recalcApprovalStatus(tx *sql.Tx, ctx context.Context, cardID string) {
	var total, approved, rejected int
	tx.QueryRowContext(ctx,
		`SELECT COUNT(*),
		        COALESCE(SUM(CASE WHEN status='approved' THEN 1 ELSE 0 END), 0),
		        COALESCE(SUM(CASE WHEN status='rejected' THEN 1 ELSE 0 END), 0)
		 FROM card_approvers WHERE card_id = ?`,
		cardID,
	).Scan(&total, &approved, &rejected)

	var newStatus string
	switch {
	case total == 0:
		newStatus = "pending"
	case rejected > 0:
		newStatus = "rejected"
	case approved == total:
		newStatus = "approved"
	default:
		newStatus = "pending"
	}
	tx.ExecContext(ctx, "UPDATE kanban_cards SET approval_status = ? WHERE id = ?", newStatus, cardID)
}

// syncCardUpdate reads the full card and writes a sync_log entry for it.
func syncCardUpdate(tx *sql.Tx, ctx context.Context, cardID string, version int64) error {
	var c card
	err := tx.QueryRowContext(ctx,
		`SELECT id, project_id, column_name, title, position, approval_status,
		        assigned_approver_id, due_date, client, priority, notes
		 FROM kanban_cards WHERE id = ?`, cardID,
	).Scan(&c.ID, &c.ProjectID, &c.ColumnName, &c.Title, &c.Position, &c.ApprovalStatus,
		&c.AssignedApproverID, &c.DueDate, &c.Client, &c.Priority, &c.Notes)
	if err != nil {
		return err
	}

	payload, _ := json.Marshal(c)
	_, err = tx.ExecContext(ctx,
		"INSERT INTO sync_log (table_name, entity_id, operation, payload, version) VALUES (?, ?, 'UPDATE', ?, ?)",
		"kanban_cards", c.ID, string(payload), version,
	)
	return err
}
