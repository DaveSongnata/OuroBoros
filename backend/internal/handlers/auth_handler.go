package handlers

import (
	"net/http"
	"time"

	"github.com/ouroboros/backend/internal/auth"
)

type tokenRequest struct {
	TenantID string `json:"tenant_id"`
}

type tokenResponse struct {
	Token string `json:"token"`
}

// IssueToken handles POST /api/auth/token.
// In a real app this would validate credentials; here we just need a tenant_id.
func IssueToken(a *auth.Auth) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var req tokenRequest
		if err := decodeJSON(r, &req); err != nil || req.TenantID == "" {
			http.Error(w, `{"error":"tenant_id required"}`, http.StatusBadRequest)
			return
		}
		token, err := a.Issue(req.TenantID, 24*time.Hour)
		if err != nil {
			http.Error(w, `{"error":"token generation failed"}`, http.StatusInternalServerError)
			return
		}
		writeJSON(w, http.StatusOK, tokenResponse{Token: token})
	}
}
