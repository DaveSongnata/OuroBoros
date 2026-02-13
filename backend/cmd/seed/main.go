package main

import (
	"context"
	"fmt"
	"log"
	"os"
	"path/filepath"
	"time"

	"github.com/ouroboros/backend/internal/auth"
	"github.com/ouroboros/backend/internal/tenant"
	"github.com/redis/go-redis/v9"
)

func main() {
	dataDir := envOr("DATA_DIR", "./data")
	redisAddr := envOr("REDIS_ADDR", "localhost:6379")

	os.MkdirAll(dataDir, 0o755)

	// 1. Create real user in system.db
	sdb, err := auth.OpenSystemDB(filepath.Join(dataDir, "system.db"))
	if err != nil {
		log.Fatalf("open system db: %v", err)
	}
	defer sdb.Close()

	user, err := sdb.Register("seed@ouroboros.dev", "seed123456", "seed_tenant")
	if err != nil {
		log.Printf("user may already exist: %v", err)
		// Try to login instead
		user2, err2 := sdb.Login("seed@ouroboros.dev", "seed123456")
		if err2 != nil {
			log.Fatalf("failed to create or login seed user: %v / %v", err, err2)
		}
		user = user2
	}
	log.Printf("seed user: %s (tenant: %s)", user.Email, user.TenantID)

	// 2. Open tenant DB
	tm := tenant.NewManager(dataDir, 4)
	db, err := tm.DB(user.TenantID)
	if err != nil {
		log.Fatalf("open tenant db: %v", err)
	}

	// 3. Redis client
	rdb := redis.NewClient(&redis.Options{Addr: redisAddr})
	ctx := context.Background()
	if err := rdb.Ping(ctx).Err(); err != nil {
		log.Fatalf("redis: %v", err)
	}

	// 4. Seed 30,000 records in a single transaction
	log.Println("seeding 30,000 records...")
	start := time.Now()

	tx, err := db.Begin()
	if err != nil {
		log.Fatalf("begin tx: %v", err)
	}

	// Create 5 projects
	projectIDs := make([]string, 5)
	for i := range 5 {
		var id string
		err := tx.QueryRow(
			"INSERT INTO projects (name) VALUES (?) RETURNING id",
			fmt.Sprintf("Project %d", i+1),
		).Scan(&id)
		if err != nil {
			tx.Rollback()
			log.Fatalf("insert project: %v", err)
		}
		projectIDs[i] = id
	}

	// Create 100 products
	productIDs := make([]string, 100)
	for i := range 100 {
		var id string
		err := tx.QueryRow(
			"INSERT INTO products (name, price) VALUES (?, ?) RETURNING id",
			fmt.Sprintf("Product %04d", i+1),
			float64(i%100)+1.99,
		).Scan(&id)
		if err != nil {
			tx.Rollback()
			log.Fatalf("insert product: %v", err)
		}
		productIDs[i] = id
	}

	// Create 500 kanban cards across projects
	cardIDs := make([]string, 500)
	columns := []string{"backlog", "todo", "in_progress", "review", "done"}
	for i := range 500 {
		var id string
		err := tx.QueryRow(
			"INSERT INTO kanban_cards (project_id, column_name, title, position) VALUES (?, ?, ?, ?) RETURNING id",
			projectIDs[i%5], columns[i%5], fmt.Sprintf("Card %04d", i+1), i,
		).Scan(&id)
		if err != nil {
			tx.Rollback()
			log.Fatalf("insert card: %v", err)
		}
		cardIDs[i] = id
	}

	// Create ~29,395 orders (to reach ~30k total records with items)
	// Each order has 1 item, linked to a card
	orderCount := 29395
	for i := range orderCount {
		cardID := cardIDs[i%500]
		productID := productIDs[i%100]
		uuid := fmt.Sprintf("seed-%08d-0000-7000-8000-%012d", i, i)
		shortID := fmt.Sprintf("S%07d", i)

		_, err := tx.Exec(
			"INSERT INTO os_orders (uuid, short_id, card_id, project_id, total) VALUES (?, ?, ?, ?, ?)",
			uuid, shortID, cardID, cardID, float64(i%100)+1.99,
		)
		if err != nil {
			tx.Rollback()
			log.Fatalf("insert order %d: %v", i, err)
		}

		_, err = tx.Exec(
			"INSERT INTO os_items (order_id, product_id, qty) VALUES (?, ?, ?)",
			uuid, productID, (i%5)+1,
		)
		if err != nil {
			tx.Rollback()
			log.Fatalf("insert item %d: %v", i, err)
		}
	}

	// Write all 30k+ records to sync_log with version=1
	_, err = tx.Exec(`
		INSERT INTO sync_log (table_name, entity_id, operation, payload, version)
		SELECT 'projects', id, 'INSERT', json_object('id', id, 'name', name), 1 FROM projects
		UNION ALL
		SELECT 'products', id, 'INSERT', json_object('id', id, 'name', name, 'price', price), 1 FROM products
		UNION ALL
		SELECT 'kanban_cards', id, 'INSERT', json_object('id', id, 'project_id', project_id, 'column_name', column_name, 'title', title, 'position', position, 'approval_status', approval_status), 1 FROM kanban_cards
		UNION ALL
		SELECT 'os_orders', uuid, 'INSERT', json_object('uuid', uuid, 'short_id', short_id, 'card_id', card_id, 'total', total), 1 FROM os_orders
	`)
	if err != nil {
		tx.Rollback()
		log.Fatalf("bulk sync_log: %v", err)
	}

	if err := tx.Commit(); err != nil {
		log.Fatalf("commit: %v", err)
	}

	elapsed := time.Since(start)

	// 5. Set Redis version
	rdb.HSet(ctx, "tenant:"+user.TenantID+":version", "v", 1)
	rdb.Publish(ctx, "sync:"+user.TenantID, "1")

	log.Printf("seeded 30,000+ records in %s", elapsed)
	log.Printf("login with: seed@ouroboros.dev / seed123456")

	tm.CloseAll()
	rdb.Close()
}

func envOr(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}
