package main

import (
	"context"
	"log"
	"net/http"
	"os"
	"os/signal"
	"path/filepath"
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

	// Ensure data directory exists
	if err := os.MkdirAll(dataDir, 0o755); err != nil {
		log.Fatalf("failed to create data dir: %v", err)
	}

	// Central system database (users, auth — NOT per-tenant)
	sdb, err := auth.OpenSystemDB(filepath.Join(dataDir, "system.db"))
	if err != nil {
		log.Fatalf("failed to open system db: %v", err)
	}

	// Redis client with retry
	rdb := redis.NewClient(&redis.Options{Addr: redisAddr})
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
	log.Printf("connected to redis at %s", redisAddr)

	// Core services
	tm := tenant.NewManager(dataDir, 64)
	hub := sync.NewHub(rdb)
	jwtAuth := auth.New([]byte(jwtSecret))

	// Start SSE hub (subscribes to Redis Pub/Sub)
	go hub.Run(ctx)

	// Router
	mux := http.NewServeMux()

	// Public routes (no auth required)
	mux.HandleFunc("POST /api/auth/register", handlers.Register(jwtAuth, sdb))
	mux.HandleFunc("POST /api/auth/login", handlers.Login(jwtAuth, sdb))

	// Protected API routes
	api := http.NewServeMux()
	api.HandleFunc("GET /api/sync", handlers.GetSync(tm))
	api.HandleFunc("POST /api/projects", handlers.CreateProject(tm, hub))
	api.HandleFunc("GET /api/projects", handlers.ListProjects(tm))
	api.HandleFunc("POST /api/kanban/cards", handlers.CreateCard(tm, hub))
	api.HandleFunc("PUT /api/kanban/cards/{id}", handlers.UpdateCard(tm, hub))
	api.HandleFunc("GET /api/kanban/cards", handlers.ListCards(tm))
	api.HandleFunc("POST /api/products", handlers.CreateProduct(tm, hub))
	api.HandleFunc("GET /api/products", handlers.ListProducts(tm))
	api.HandleFunc("POST /api/orders", handlers.CreateOrder(tm, hub))
	api.HandleFunc("GET /api/orders", handlers.ListOrders(tm))
	api.HandleFunc("GET /api/users", handlers.ListTenantUsers(sdb))

	// SSE endpoint (protected)
	api.HandleFunc("GET /sse/events", handlers.SSEHandler(hub))

	// Wrap protected routes with auth middleware
	mux.Handle("/", jwtAuth.Middleware(api))

	srv := &http.Server{
		Addr:         ":" + port,
		Handler:      corsMiddleware(mux),
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
