package auth

import (
	"context"
	"net/http"
	"strings"
	"time"

	"github.com/golang-jwt/jwt/v5"
)

type contextKey string

const (
	TenantKey contextKey = "tenant_id"
	UserKey   contextKey = "user_id"
)

// Auth handles JWT creation and verification entirely in-memory.
type Auth struct {
	secret []byte
}

func New(secret []byte) *Auth {
	return &Auth{secret: secret}
}

// Claims embedded in every token.
type Claims struct {
	TenantID string `json:"tid"`
	UserID   string `json:"uid"`
	jwt.RegisteredClaims
}

// Issue creates a signed JWT for a given tenant and user.
func (a *Auth) Issue(tenantID, userID string, ttl time.Duration) (string, error) {
	now := time.Now()
	claims := Claims{
		TenantID: tenantID,
		UserID:   userID,
		RegisteredClaims: jwt.RegisteredClaims{
			IssuedAt:  jwt.NewNumericDate(now),
			ExpiresAt: jwt.NewNumericDate(now.Add(ttl)),
		},
	}
	token := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
	return token.SignedString(a.secret)
}

// Verify parses and validates a token, returning its claims.
func (a *Auth) Verify(tokenStr string) (*Claims, error) {
	token, err := jwt.ParseWithClaims(tokenStr, &Claims{}, func(t *jwt.Token) (any, error) {
		return a.secret, nil
	})
	if err != nil {
		return nil, err
	}
	return token.Claims.(*Claims), nil
}

// Middleware extracts the JWT from the Authorization header, verifies it,
// and injects tenant_id + user_id into context. No DB lookups.
// Public paths under /api/auth/ are passed through without token checks.
func (a *Auth) Middleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// Skip auth for public endpoints
		if strings.HasPrefix(r.URL.Path, "/api/auth/") {
			next.ServeHTTP(w, r)
			return
		}

		header := r.Header.Get("Authorization")
		if !strings.HasPrefix(header, "Bearer ") {
			http.Error(w, `{"error":"missing authorization"}`, http.StatusUnauthorized)
			return
		}
		tokenStr := strings.TrimPrefix(header, "Bearer ")
		claims, err := a.Verify(tokenStr)
		if err != nil {
			http.Error(w, `{"error":"invalid token"}`, http.StatusUnauthorized)
			return
		}
		ctx := context.WithValue(r.Context(), TenantKey, claims.TenantID)
		ctx = context.WithValue(ctx, UserKey, claims.UserID)
		next.ServeHTTP(w, r.WithContext(ctx))
	})
}

// TenantFromCtx extracts the tenant ID from context.
func TenantFromCtx(ctx context.Context) string {
	v, _ := ctx.Value(TenantKey).(string)
	return v
}

// UserFromCtx extracts the user ID from context.
func UserFromCtx(ctx context.Context) string {
	v, _ := ctx.Value(UserKey).(string)
	return v
}
