package tenant

import (
	"container/list"
	"database/sql"
	"fmt"
	"log"
	"path/filepath"
	gosync "sync"

	"github.com/ouroboros/backend/internal/migrations"
	_ "github.com/mattn/go-sqlite3"
)

// Manager is an LRU cache of SQLite connections, one per tenant.
type Manager struct {
	dataDir  string
	maxConns int

	mu    gosync.Mutex
	cache map[string]*list.Element
	order *list.List // front = most recently used
}

type entry struct {
	tenantID string
	db       *sql.DB
}

func NewManager(dataDir string, maxConns int) *Manager {
	return &Manager{
		dataDir:  dataDir,
		maxConns: maxConns,
		cache:    make(map[string]*list.Element),
		order:    list.New(),
	}
}

// DB returns a ready-to-use *sql.DB for the given tenant.
// It opens and migrates the database lazily on first access,
// and evicts the least-recently-used connection when the cache is full.
func (m *Manager) DB(tenantID string) (*sql.DB, error) {
	m.mu.Lock()
	defer m.mu.Unlock()

	// Cache hit: move to front
	if el, ok := m.cache[tenantID]; ok {
		m.order.MoveToFront(el)
		return el.Value.(*entry).db, nil
	}

	// Cache miss: open new connection
	dbPath := filepath.Join(m.dataDir, fmt.Sprintf("tenant_%s.db", tenantID))
	db, err := sql.Open("sqlite3", dbPath+"?_journal_mode=WAL&_busy_timeout=5000&_foreign_keys=on")
	if err != nil {
		return nil, fmt.Errorf("open db for tenant %s: %w", tenantID, err)
	}
	db.SetMaxOpenConns(1) // SQLite performs best with a single writer

	// Run lazy migrations
	if err := migrations.Run(db); err != nil {
		db.Close()
		return nil, fmt.Errorf("migrate tenant %s: %w", tenantID, err)
	}

	// Evict LRU if at capacity
	if m.order.Len() >= m.maxConns {
		m.evictLRU()
	}

	e := &entry{tenantID: tenantID, db: db}
	el := m.order.PushFront(e)
	m.cache[tenantID] = el

	log.Printf("[tenant] opened db for tenant %s", tenantID)
	return db, nil
}

func (m *Manager) evictLRU() {
	back := m.order.Back()
	if back == nil {
		return
	}
	e := back.Value.(*entry)
	e.db.Close()
	delete(m.cache, e.tenantID)
	m.order.Remove(back)
	log.Printf("[tenant] evicted db for tenant %s", e.tenantID)
}

// CloseAll closes all open database connections.
func (m *Manager) CloseAll() {
	m.mu.Lock()
	defer m.mu.Unlock()
	for _, el := range m.cache {
		el.Value.(*entry).db.Close()
	}
	m.cache = make(map[string]*list.Element)
	m.order.Init()
	log.Println("[tenant] closed all connections")
}
