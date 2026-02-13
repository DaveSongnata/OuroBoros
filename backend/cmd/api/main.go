package main

import (
	"context"
	"log"
	"net/http"
	"os"
	"os/signal"
	"path/filepath"
	"strings"
	"syscall"
	"time"

	"github.com/ouroboros/backend/internal/auth"
	"github.com/ouroboros/backend/internal/handlers"
	"github.com/ouroboros/backend/internal/sync"
	"github.com/ouroboros/backend/internal/tenant"
	"github.com/redis/go-redis/v9"
)

func main() {
	port := envOr("PORT", "9090")
	redisAddr := envOr("REDIS_ADDR", "localhost:6379")
	jwtSecret := envOr("JWT_SECRET", "ouroboros-dev-secret-change-in-prod")
	dataDir := envOr("DATA_DIR", "./data")
	staticDir := envOr("STATIC_DIR", "")

	// Ensure data directory exists
	if err := os.MkdirAll(dataDir, 0o755); err != nil {
		log.Fatalf("failed to create data dir: %v", err)
	}

	// Central system database (users, auth — NOT per-tenant)
	sdb, err := auth.OpenSystemDB(filepath.Join(dataDir, "system.db"))
	if err != nil {
		log.Fatalf("failed to open system db: %v", err)
	}

	// Redis client — supports both host:port and redis:// URL formats
	var rdb *redis.Client
	if strings.HasPrefix(redisAddr, "redis://") || strings.HasPrefix(redisAddr, "rediss://") {
		opt, err := redis.ParseURL(redisAddr)
		if err != nil {
			log.Fatalf("invalid REDIS_ADDR URL: %v", err)
		}
		rdb = redis.NewClient(opt)
	} else {
		rdb = redis.NewClient(&redis.Options{Addr: redisAddr})
	}

	ctx := context.Background()
	const maxRetries = 5
	for i := range maxRetries {
		if err := rdb.Ping(ctx).Err(); err != nil {
			if i == maxRetries-1 {
				log.Fatalf("failed to connect to redis after %d attempts: %v", maxRetries, err)
			}
			log.Printf("redis not ready (attempt %d/%d), retrying in 1s...", i+1, maxRetries)
			time.Sleep(time.Second)
			continue
		}
		break
	}
	log.Printf("connected to redis")

	// Core services
	tm := tenant.NewManager(dataDir, 64)
	hub := sync.NewHub(rdb)
	jwtAuth := auth.New([]byte(jwtSecret))

	// Start SSE hub (subscribes to Redis Pub/Sub)
	go hub.Run(ctx)

	// Router — single mux, middleware skips /api/auth/ paths
	mux := http.NewServeMux()

	// Auth routes (public — middleware skips /api/auth/ prefix)
	mux.HandleFunc("POST /api/auth/register", handlers.Register(jwtAuth, sdb))
	mux.HandleFunc("POST /api/auth/login", handlers.Login(jwtAuth, sdb))

	// Protected API routes
	mux.HandleFunc("GET /api/sync", handlers.GetSync(tm))
	mux.HandleFunc("POST /api/projects", handlers.CreateProject(tm, hub))
	mux.HandleFunc("DELETE /api/projects/{id}", handlers.DeleteProject(tm, hub))
	mux.HandleFunc("GET /api/projects", handlers.ListProjects(tm))
	mux.HandleFunc("POST /api/kanban/cards", handlers.CreateCard(tm, hub))
	mux.HandleFunc("PUT /api/kanban/cards/{id}", handlers.UpdateCard(tm, hub))
	mux.HandleFunc("GET /api/kanban/cards", handlers.ListCards(tm))
	mux.HandleFunc("POST /api/products", handlers.CreateProduct(tm, hub))
	mux.HandleFunc("GET /api/products", handlers.ListProducts(tm))
	mux.HandleFunc("POST /api/orders", handlers.CreateOrder(tm, hub))
	mux.HandleFunc("GET /api/orders", handlers.ListOrders(tm))
	mux.HandleFunc("POST /api/users", handlers.InviteUser(sdb, tm, hub))
	mux.HandleFunc("GET /api/users", handlers.ListTenantUsers(sdb))

	// Kanban columns
	mux.HandleFunc("POST /api/kanban/columns", handlers.CreateColumn(tm, hub))
	mux.HandleFunc("PUT /api/kanban/columns/{id}", handlers.UpdateColumn(tm, hub))
	mux.HandleFunc("DELETE /api/kanban/columns/{id}", handlers.DeleteColumn(tm, hub))
	mux.HandleFunc("GET /api/kanban/columns", handlers.ListColumns(tm))

	// Card details: tags, assignees, approvers, sessions
	mux.HandleFunc("POST /api/kanban/cards/{cardId}/tags", handlers.AddTag(tm, hub))
	mux.HandleFunc("DELETE /api/kanban/cards/{cardId}/tags/{tagId}", handlers.RemoveTag(tm, hub))
	mux.HandleFunc("POST /api/kanban/cards/{cardId}/assignees", handlers.AssignUser(tm, hub))
	mux.HandleFunc("DELETE /api/kanban/cards/{cardId}/assignees/{assigneeId}", handlers.UnassignUser(tm, hub))
	mux.HandleFunc("POST /api/kanban/cards/{cardId}/approvers", handlers.AddApprover(tm, hub))
	mux.HandleFunc("DELETE /api/kanban/cards/{cardId}/approvers/{approverId}", handlers.RemoveApprover(tm, hub))
	mux.HandleFunc("POST /api/kanban/cards/{cardId}/approvers/{approverId}/decide", handlers.DecideApproval(tm, hub))
	mux.HandleFunc("POST /api/kanban/cards/{cardId}/sessions", handlers.CreateSession(tm, hub))
	mux.HandleFunc("DELETE /api/kanban/cards/{cardId}/sessions/{sessionId}", handlers.DeleteSession(tm, hub))

	// SSE endpoint (protected)
	mux.HandleFunc("GET /sse/events", handlers.SSEHandler(hub))

	// Serve frontend static files in production (SPA with fallback to index.html)
	if staticDir != "" {
		if info, err := os.Stat(staticDir); err == nil && info.IsDir() {
			log.Printf("serving static files from %s", staticDir)
			fs := http.FileServer(http.Dir(staticDir))
			mux.Handle("/", http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				// COOP/COEP headers required for SharedArrayBuffer (OPFS)
				w.Header().Set("Cross-Origin-Opener-Policy", "same-origin")
				w.Header().Set("Cross-Origin-Embedder-Policy", "require-corp")

				// Try serving exact file
				filePath := filepath.Join(staticDir, filepath.Clean(r.URL.Path))
				if fi, err := os.Stat(filePath); err == nil && !fi.IsDir() {
					fs.ServeHTTP(w, r)
					return
				}
				// SPA fallback → index.html
				http.ServeFile(w, r, filepath.Join(staticDir, "index.html"))
			}))
		}
	}

	srv := &http.Server{
		Addr:         ":" + port,
		Handler:      corsMiddleware(jwtAuth.Middleware(mux)),
		ReadTimeout:  5 * time.Second,
		WriteTimeout: 0, // SSE needs unlimited write timeout
		IdleTimeout:  120 * time.Second,
	}

	// Graceful shutdown
	go func() {
		log.Printf("ouroboros API listening on :%s", port)
		if err := srv.ListenAndServe(); err != http.ErrServerClosed {
			log.Fatalf("server error: %v", err)
		}
	}()

	quit := make(chan os.Signal, 1)
	signal.Notify(quit, syscall.SIGINT, syscall.SIGTERM)
	<-quit

	log.Println("shutting down...")
	shutdownCtx, cancel := context.WithTimeout(ctx, 10*time.Second)
	defer cancel()
	srv.Shutdown(shutdownCtx)
	tm.CloseAll()
	sdb.Close()
	rdb.Close()
	log.Println("goodbye")
}

func envOr(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}

func corsMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Access-Control-Allow-Origin", "*")
		w.Header().Set("Access-Control-Allow-Methods", "GET, POST, PUT, PATCH, DELETE, OPTIONS")
		w.Header().Set("Access-Control-Allow-Headers", "Content-Type, Authorization")
		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusNoContent)
			return
		}
		next.ServeHTTP(w, r)
	})
}
