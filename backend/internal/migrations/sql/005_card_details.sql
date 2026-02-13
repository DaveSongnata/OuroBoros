-- Card info fields
ALTER TABLE kanban_cards ADD COLUMN due_date TEXT;
ALTER TABLE kanban_cards ADD COLUMN client TEXT;
ALTER TABLE kanban_cards ADD COLUMN priority TEXT NOT NULL DEFAULT 'normal';
ALTER TABLE kanban_cards ADD COLUMN notes TEXT;

-- Tags per card
CREATE TABLE IF NOT EXISTS card_tags (
    id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
    card_id TEXT NOT NULL REFERENCES kanban_cards(id) ON DELETE CASCADE,
    name TEXT NOT NULL
);

-- Assigned users per card
CREATE TABLE IF NOT EXISTS card_assigned_users (
    id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
    card_id TEXT NOT NULL REFERENCES kanban_cards(id) ON DELETE CASCADE,
    user_id TEXT NOT NULL,
    user_email TEXT NOT NULL
);

-- Multi-approvers per card
CREATE TABLE IF NOT EXISTS card_approvers (
    id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
    card_id TEXT NOT NULL REFERENCES kanban_cards(id) ON DELETE CASCADE,
    user_id TEXT NOT NULL,
    user_email TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    decided_at TEXT
);

-- Sessions (layout sections) per card
CREATE TABLE IF NOT EXISTS card_sessions (
    id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
    card_id TEXT NOT NULL REFERENCES kanban_cards(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    position INTEGER NOT NULL DEFAULT 0
);
