package main

import (
	"bufio"
	"context"
	"encoding/json"
	"fmt"
	"log"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	"github.com/ouroboros/backend/internal/auth"
	"github.com/ouroboros/backend/internal/sync"
	"github.com/ouroboros/backend/internal/tenant"
	"github.com/redis/go-redis/v9"
)

type product struct {
	Name  string
	Price float64
}

func main() {
	if len(os.Args) < 2 {
		fmt.Fprintf(os.Stderr, "usage: import-products <dump.sql> [tenant_id]\n")
		fmt.Fprintf(os.Stderr, "\nImports product names/prices from a MySQL dump into the tenant's SQLite DB.\n")
		fmt.Fprintf(os.Stderr, "If tenant_id is omitted, uses the first tenant found in system.db.\n")
		os.Exit(1)
	}

	dumpFile := os.Args[1]
	dataDir := envOr("DATA_DIR", "./data")
	redisAddr := envOr("REDIS_ADDR", "localhost:6379")

	// 1. Parse the dump file
	log.Printf("parsing %s ...", dumpFile)
	products, err := parseDump(dumpFile)
	if err != nil {
		log.Fatalf("parse dump: %v", err)
	}
	log.Printf("found %d products in dump", len(products))

	if len(products) == 0 {
		log.Fatal("no products found — check that the dump contains INSERT INTO `produtos` statements")
	}

	// 2. Resolve tenant
	sdb, err := auth.OpenSystemDB(filepath.Join(dataDir, "system.db"))
	if err != nil {
		log.Fatalf("open system db: %v", err)
	}
	defer sdb.Close()

	var tenantID string
	if len(os.Args) >= 3 {
		tenantID = os.Args[2]
	} else {
		tenantID, err = firstTenant(sdb)
		if err != nil {
			log.Fatalf("no tenant found: %v\nPass tenant_id as second argument.", err)
		}
	}
	log.Printf("target tenant: %s", tenantID)

	// 3. Open tenant DB
	tm := tenant.NewManager(dataDir, 4)
	db, err := tm.DB(tenantID)
	if err != nil {
		log.Fatalf("open tenant db: %v", err)
	}

	// 4. Redis for sync
	rdb := redis.NewClient(&redis.Options{Addr: redisAddr})
	ctx := context.Background()
	if err := rdb.Ping(ctx).Err(); err != nil {
		log.Fatalf("redis ping: %v", err)
	}
	hub := sync.NewHub(rdb)

	// 5. Clear existing products (optional — avoids duplicates on re-run)
	clearFlag := envOr("CLEAR_PRODUCTS", "false")
	if clearFlag == "true" || clearFlag == "1" {
		log.Println("CLEAR_PRODUCTS=true — deleting existing products...")
		db.Exec("DELETE FROM os_items")
		db.Exec("DELETE FROM os_orders")
		db.Exec("DELETE FROM products")
	}

	// 6. Bulk insert in a single transaction
	log.Printf("inserting %d products...", len(products))
	start := time.Now()

	tx, err := db.Begin()
	if err != nil {
		log.Fatalf("begin tx: %v", err)
	}

	stmt, err := tx.Prepare("INSERT INTO products (name, price) VALUES (?, ?) RETURNING id")
	if err != nil {
		log.Fatalf("prepare: %v", err)
	}

	type inserted struct {
		ID    string  `json:"id"`
		Name  string  `json:"name"`
		Price float64 `json:"price"`
	}

	var ids []inserted
	for i, p := range products {
		var id string
		if err := stmt.QueryRow(p.Name, p.Price).Scan(&id); err != nil {
			tx.Rollback()
			log.Fatalf("insert product #%d (%s): %v", i, p.Name, err)
		}
		ids = append(ids, inserted{ID: id, Name: p.Name, Price: p.Price})
	}
	stmt.Close()

	// 7. Write sync_log entries
	newVersion, err := hub.NextVersion(ctx, tenantID)
	if err != nil {
		log.Printf("warning: redis version failed (sync may be stale): %v", err)
		newVersion = 1
	}

	syncStmt, err := tx.Prepare(
		"INSERT INTO sync_log (table_name, entity_id, operation, payload, version) VALUES ('products', ?, 'INSERT', ?, ?)",
	)
	if err != nil {
		tx.Rollback()
		log.Fatalf("prepare sync: %v", err)
	}
	for _, p := range ids {
		payload, _ := json.Marshal(p)
		syncStmt.Exec(p.ID, string(payload), newVersion)
	}
	syncStmt.Close()

	if err := tx.Commit(); err != nil {
		log.Fatalf("commit: %v", err)
	}

	hub.Notify(ctx, tenantID, newVersion)

	elapsed := time.Since(start)
	log.Printf("done! imported %d products in %s", len(products), elapsed)

	tm.CloseAll()
	rdb.Close()
}

// parseDump reads a mysqldump file and extracts products from INSERT INTO `produtos` statements.
func parseDump(path string) ([]product, error) {
	f, err := os.Open(path)
	if err != nil {
		return nil, err
	}
	defer f.Close()

	var products []product
	scanner := bufio.NewScanner(f)
	// MySQL dumps can have very long INSERT lines
	scanner.Buffer(make([]byte, 0, 64*1024), 10*1024*1024)

	for scanner.Scan() {
		line := scanner.Text()
		// Match lines like: INSERT INTO `produtos` VALUES (...)
		upper := strings.ToUpper(line)
		if !strings.Contains(upper, "INSERT") || !strings.Contains(upper, "PRODUTOS") {
			continue
		}

		// Find VALUES section
		idx := strings.Index(upper, "VALUES")
		if idx < 0 {
			continue
		}
		valuesStr := line[idx+6:] // after "VALUES"

		tuples := parseTuples(valuesStr)
		for _, fields := range tuples {
			// Column order: codigoproduto(0), nomeproduto(1), qtdproduto(2), precoproduto(3), EAN(4)
			if len(fields) < 4 {
				continue
			}
			name := unquote(fields[1])
			price := parseFloat(fields[3])
			if name != "" {
				products = append(products, product{Name: name, Price: price})
			}
		}
	}

	return products, scanner.Err()
}

// parseTuples parses "(v1,v2,...),(v1,v2,...)" into a slice of field slices.
func parseTuples(s string) [][]string {
	var result [][]string
	i := 0
	for i < len(s) {
		// Find opening '('
		for i < len(s) && s[i] != '(' {
			i++
		}
		if i >= len(s) {
			break
		}
		i++ // skip '('

		var fields []string
		var current strings.Builder
		inQuote := false

		for i < len(s) {
			ch := s[i]

			if inQuote {
				if ch == '\\' && i+1 < len(s) {
					// Escaped character — write the next char literally
					i++
					current.WriteByte(s[i])
				} else if ch == '\'' {
					// Check for '' (double-single-quote escape)
					if i+1 < len(s) && s[i+1] == '\'' {
						current.WriteByte('\'')
						i++
					} else {
						inQuote = false
					}
				} else {
					current.WriteByte(ch)
				}
			} else {
				switch ch {
				case '\'':
					inQuote = true
				case ',':
					fields = append(fields, strings.TrimSpace(current.String()))
					current.Reset()
				case ')':
					fields = append(fields, strings.TrimSpace(current.String()))
					result = append(result, fields)
					i++
					goto nextTuple
				default:
					current.WriteByte(ch)
				}
			}
			i++
		}
	nextTuple:
	}
	return result
}

func unquote(s string) string {
	s = strings.TrimSpace(s)
	if s == "NULL" || s == "null" {
		return ""
	}
	return s
}

func parseFloat(s string) float64 {
	s = strings.TrimSpace(s)
	if s == "NULL" || s == "null" || s == "" {
		return 0
	}
	v, _ := strconv.ParseFloat(s, 64)
	return v
}

func firstTenant(sdb *auth.SystemDB) (string, error) {
	row := sdb.DB().QueryRow("SELECT tenant_id FROM users LIMIT 1")
	var tid string
	if err := row.Scan(&tid); err != nil {
		return "", err
	}
	return tid, nil
}

func envOr(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}
