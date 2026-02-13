package migrations

import (
	"database/sql"
	"embed"
	"fmt"
	"log"
	"sort"
	"strconv"
	"strings"
)

//go:embed sql/*.sql
var sqlFiles embed.FS

// Run applies all pending migrations to the database.
// It uses PRAGMA user_version to track the current schema version.
func Run(db *sql.DB) error {
	entries, err := sqlFiles.ReadDir("sql")
	if err != nil {
		return fmt.Errorf("read embedded sql dir: %w", err)
	}

	// Parse and sort migration files by version number
	type migration struct {
		version int
		name    string
	}
	var migrations []migration
	for _, e := range entries {
		name := e.Name()
		if !strings.HasSuffix(name, ".sql") {
			continue
		}
		// Expected format: 001_description.sql
		parts := strings.SplitN(name, "_", 2)
		if len(parts) < 2 {
			continue
		}
		ver, err := strconv.Atoi(parts[0])
		if err != nil {
			continue
		}
		migrations = append(migrations, migration{version: ver, name: name})
	}
	sort.Slice(migrations, func(i, j int) bool {
		return migrations[i].version < migrations[j].version
	})

	// Get current schema version
	var currentVersion int
	if err := db.QueryRow("PRAGMA user_version").Scan(&currentVersion); err != nil {
		return fmt.Errorf("read user_version: %w", err)
	}

	// Apply pending migrations
	for _, m := range migrations {
		if m.version <= currentVersion {
			continue
		}
		content, err := sqlFiles.ReadFile("sql/" + m.name)
		if err != nil {
			return fmt.Errorf("read migration %s: %w", m.name, err)
		}

		log.Printf("[migrations] applying %s (version %d -> %d)", m.name, currentVersion, m.version)

		tx, err := db.Begin()
		if err != nil {
			return fmt.Errorf("begin tx for %s: %w", m.name, err)
		}
		if _, err := tx.Exec(string(content)); err != nil {
			tx.Rollback()
			return fmt.Errorf("exec migration %s: %w", m.name, err)
		}
		// SQLite doesn't support PRAGMA in transactions via parameter binding,
		// so we use Sprintf safely (version is an int, not user input).
		if _, err := tx.Exec(fmt.Sprintf("PRAGMA user_version = %d", m.version)); err != nil {
			tx.Rollback()
			return fmt.Errorf("set user_version for %s: %w", m.name, err)
		}
		if err := tx.Commit(); err != nil {
			return fmt.Errorf("commit migration %s: %w", m.name, err)
		}
		currentVersion = m.version
	}

	log.Printf("[migrations] schema at version %d", currentVersion)
	return nil
}
