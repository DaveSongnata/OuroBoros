package handlers

import (
	"errors"
	"net/http"
	"strings"
	"time"

	"github.com/ouroboros/backend/internal/auth"
)

type registerRequest struct {
	Email    string `json:"email"`
	Password string `json:"password"`
	TenantID string `json:"tenant_id"`
}

type loginRequest struct {
	Email    string `json:"email"`
	Password string `json:"password"`
}

type authResponse struct {
	Token    string     `json:"token"`
	User     *auth.User `json:"user"`
	TenantID string     `json:"tenant_id"`
}

// Register handles POST /api/auth/register.
// Creates a user in system.db with bcrypt-hashed password.
func Register(a *auth.Auth, sdb *auth.SystemDB) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var req registerRequest
		if err := decodeJSON(r, &req); err != nil {
			http.Error(w, `{"error":"invalid json"}`, http.StatusBadRequest)
			return
		}
		if req.Email == "" || req.Password == "" {
			http.Error(w, `{"error":"email and password required"}`, http.StatusBadRequest)
			return
		}
		if len(req.Password) < 6 {
			http.Error(w, `{"error":"password must be at least 6 characters"}`, http.StatusBadRequest)
			return
		}

		// If no tenant_id provided, generate one from the email prefix
		tenantID := req.TenantID
		if tenantID == "" {
			tenantID = strings.Split(req.Email, "@")[0]
		}

		user, err := sdb.Register(req.Email, req.Password, tenantID)
		if err != nil {
			if errors.Is(err, auth.ErrEmailTaken) {
				http.Error(w, `{"error":"email already registered"}`, http.StatusConflict)
				return
			}
			http.Error(w, `{"error":"registration failed"}`, http.StatusInternalServerError)
			return
		}

		token, err := a.Issue(user.TenantID, 24*time.Hour)
		if err != nil {
			http.Error(w, `{"error":"token generation failed"}`, http.StatusInternalServerError)
			return
		}

		writeJSON(w, http.StatusCreated, authResponse{
			Token:    token,
			User:     user,
			TenantID: user.TenantID,
		})
	}
}

// Login handles POST /api/auth/login.
// Verifies bcrypt password against system.db, returns signed JWT.
func Login(a *auth.Auth, sdb *auth.SystemDB) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var req loginRequest
		if err := decodeJSON(r, &req); err != nil {
			http.Error(w, `{"error":"invalid json"}`, http.StatusBadRequest)
			return
		}
		if req.Email == "" || req.Password == "" {
			http.Error(w, `{"error":"email and password required"}`, http.StatusBadRequest)
			return
		}

		user, err := sdb.Login(req.Email, req.Password)
		if err != nil {
			if errors.Is(err, auth.ErrInvalidCreds) {
				http.Error(w, `{"error":"invalid email or password"}`, http.StatusUnauthorized)
				return
			}
			http.Error(w, `{"error":"login failed"}`, http.StatusInternalServerError)
			return
		}

		token, err := a.Issue(user.TenantID, 24*time.Hour)
		if err != nil {
			http.Error(w, `{"error":"token generation failed"}`, http.StatusInternalServerError)
			return
		}

		writeJSON(w, http.StatusOK, authResponse{
			Token:    token,
			User:     user,
			TenantID: user.TenantID,
		})
	}
}

// InviteUser handles POST /api/users — creates a user in the caller's tenant.
func InviteUser(sdb *auth.SystemDB) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		tenantID := auth.TenantFromCtx(r.Context())
		var req registerRequest
		if err := decodeJSON(r, &req); err != nil {
			http.Error(w, `{"error":"invalid json"}`, http.StatusBadRequest)
			return
		}
		if req.Email == "" || req.Password == "" {
			http.Error(w, `{"error":"email and password required"}`, http.StatusBadRequest)
			return
		}
		if len(req.Password) < 6 {
			http.Error(w, `{"error":"password must be at least 6 characters"}`, http.StatusBadRequest)
			return
		}

		user, err := sdb.Register(req.Email, req.Password, tenantID)
		if err != nil {
			if errors.Is(err, auth.ErrEmailTaken) {
				http.Error(w, `{"error":"email already registered"}`, http.StatusConflict)
				return
			}
			http.Error(w, `{"error":"invite failed"}`, http.StatusInternalServerError)
			return
		}
		writeJSON(w, http.StatusCreated, user)
	}
}

// ListTenantUsers handles GET /api/users — returns users in the same tenant.
func ListTenantUsers(sdb *auth.SystemDB) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		tenantID := auth.TenantFromCtx(r.Context())
		users, err := sdb.ListByTenant(tenantID)
		if err != nil {
			http.Error(w, `{"error":"query failed"}`, http.StatusInternalServerError)
			return
		}
		writeJSON(w, http.StatusOK, users)
	}
}
