-- Core domain tables + sync_log

CREATE TABLE IF NOT EXISTS projects (
    id         TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
    name       TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS kanban_cards (
    id          TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
    project_id  TEXT NOT NULL REFERENCES projects(id),
    column_name TEXT NOT NULL DEFAULT 'backlog',
    title       TEXT NOT NULL,
    position    INTEGER NOT NULL DEFAULT 0,
    created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS products (
    id         TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
    name       TEXT NOT NULL,
    price      REAL NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS os_orders (
    uuid       TEXT PRIMARY KEY,
    short_id   TEXT NOT NULL UNIQUE,
    card_id    TEXT REFERENCES kanban_cards(id),
    total      REAL NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS os_items (
    id         TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
    order_id   TEXT NOT NULL REFERENCES os_orders(uuid),
    product_id TEXT NOT NULL REFERENCES products(id),
    qty        INTEGER NOT NULL DEFAULT 1
);

-- Delta sync engine table
CREATE TABLE IF NOT EXISTS sync_log (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    table_name TEXT    NOT NULL,
    entity_id  TEXT    NOT NULL,
    operation  TEXT    NOT NULL CHECK(operation IN ('INSERT','UPDATE','DELETE','PATCH')),
    payload    TEXT    NOT NULL DEFAULT '{}',
    version    INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_sync_log_version ON sync_log(version);
