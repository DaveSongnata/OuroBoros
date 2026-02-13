package auth

import (
	"crypto/rand"
	"database/sql"
	"encoding/binary"
	"encoding/hex"
	"errors"
	"fmt"
	"log"
	"time"

	_ "github.com/mattn/go-sqlite3"
	"golang.org/x/crypto/bcrypt"
)

var (
	ErrEmailTaken    = errors.New("email already registered")
	ErrInvalidCreds  = errors.New("invalid email or password")
	ErrUserNotFound  = errors.New("user not found")
)

type User struct {
	ID       string `json:"id"`
	Email    string `json:"email"`
	TenantID string `json:"tenant_id"`
}

// SystemDB manages the central users database (not per-tenant).
type SystemDB struct {
	db *sql.DB
}

func OpenSystemDB(path string) (*SystemDB, error) {
	db, err := sql.Open("sqlite3", path+"?_journal_mode=WAL&_busy_timeout=5000&_foreign_keys=on")
	if err != nil {
		return nil, fmt.Errorf("open system db: %w", err)
	}
	db.SetMaxOpenConns(1)

	if err := migrate(db); err != nil {
		db.Close()
		return nil, fmt.Errorf("migrate system db: %w", err)
	}

	log.Printf("[auth] system.db ready at %s", path)
	return &SystemDB{db: db}, nil
}

func migrate(db *sql.DB) error {
	_, err := db.Exec(`
		CREATE TABLE IF NOT EXISTS users (
			id            TEXT PRIMARY KEY,
			email         TEXT NOT NULL UNIQUE,
			password_hash TEXT NOT NULL,
			tenant_id     TEXT NOT NULL,
			created_at    TEXT NOT NULL DEFAULT (datetime('now'))
		);
		CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
		CREATE INDEX IF NOT EXISTS idx_users_tenant ON users(tenant_id);
	`)
	return err
}

func (s *SystemDB) Close() error {
	return s.db.Close()
}

// Register creates a new user with a bcrypt-hashed password.
func (s *SystemDB) Register(email, password, tenantID string) (*User, error) {
	hash, err := bcrypt.GenerateFromPassword([]byte(password), bcrypt.DefaultCost)
	if err != nil {
		return nil, fmt.Errorf("hash password: %w", err)
	}

	id := generateUUIDv7()
	_, err = s.db.Exec(
		"INSERT INTO users (id, email, password_hash, tenant_id) VALUES (?, ?, ?, ?)",
		id, email, string(hash), tenantID,
	)
	if err != nil {
		if isUniqueViolation(err) {
			return nil, ErrEmailTaken
		}
		return nil, fmt.Errorf("insert user: %w", err)
	}

	return &User{ID: id, Email: email, TenantID: tenantID}, nil
}

// Login verifies credentials and returns the user.
func (s *SystemDB) Login(email, password string) (*User, error) {
	var u User
	var hash string
	err := s.db.QueryRow(
		"SELECT id, email, tenant_id, password_hash FROM users WHERE email = ?", email,
	).Scan(&u.ID, &u.Email, &u.TenantID, &hash)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, ErrInvalidCreds
		}
		return nil, fmt.Errorf("query user: %w", err)
	}

	if err := bcrypt.CompareHashAndPassword([]byte(hash), []byte(password)); err != nil {
		return nil, ErrInvalidCreds
	}

	return &u, nil
}

// ListByTenant returns all users in a tenant (for approver selection).
func (s *SystemDB) ListByTenant(tenantID string) ([]User, error) {
	rows, err := s.db.Query("SELECT id, email, tenant_id FROM users WHERE tenant_id = ?", tenantID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var users []User
	for rows.Next() {
		var u User
		rows.Scan(&u.ID, &u.Email, &u.TenantID)
		users = append(users, u)
	}
	if users == nil {
		users = []User{}
	}
	return users, nil
}

func (s *SystemDB) DB() *sql.DB {
	return s.db
}

func generateUUIDv7() string {
	var buf [16]byte
	ms := uint64(time.Now().UnixMilli())
	binary.BigEndian.PutUint32(buf[0:4], uint32(ms>>16))
	binary.BigEndian.PutUint16(buf[4:6], uint16(ms))
	rand.Read(buf[6:])
	buf[6] = (buf[6] & 0x0F) | 0x70
	buf[8] = (buf[8] & 0x3F) | 0x80
	return hex.EncodeToString(buf[:4]) + "-" +
		hex.EncodeToString(buf[4:6]) + "-" +
		hex.EncodeToString(buf[6:8]) + "-" +
		hex.EncodeToString(buf[8:10]) + "-" +
		hex.EncodeToString(buf[10:16])
}

func isUniqueViolation(err error) bool {
	return err != nil && (errors.Is(err, sql.ErrNoRows) || err.Error() == "UNIQUE constraint failed: users.email" || len(err.Error()) > 0 && err.Error()[:6] == "UNIQUE")
}
