-- Fix os_orders.project_id FK (was referencing kanban_cards, must reference projects)

-- 1. Backup data (no FK constraints on backup tables)
CREATE TABLE os_orders_backup AS SELECT uuid, short_id, card_id, project_id, total, created_at FROM os_orders;
CREATE TABLE os_items_backup AS SELECT id, order_id, product_id, qty FROM os_items;

-- 2. Drop child first, then parent
DROP TABLE os_items;
DROP TABLE os_orders;

-- 3. Recreate with correct FK
CREATE TABLE os_orders (
    uuid       TEXT PRIMARY KEY,
    short_id   TEXT NOT NULL UNIQUE,
    card_id    TEXT REFERENCES kanban_cards(id),
    project_id TEXT REFERENCES projects(id),
    total      REAL NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE os_items (
    id         TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
    order_id   TEXT NOT NULL REFERENCES os_orders(uuid),
    product_id TEXT NOT NULL REFERENCES products(id),
    qty        INTEGER NOT NULL DEFAULT 1
);

-- 4. Restore data
INSERT OR IGNORE INTO os_orders (uuid, short_id, card_id, project_id, total, created_at)
    SELECT uuid, short_id, card_id, project_id, total, created_at FROM os_orders_backup;

INSERT OR IGNORE INTO os_items (id, order_id, product_id, qty)
    SELECT id, order_id, product_id, qty FROM os_items_backup;

-- 5. Cleanup
DROP TABLE os_orders_backup;
DROP TABLE os_items_backup;
