-- Dynamic kanban columns per project

CREATE TABLE IF NOT EXISTS kanban_columns (
    id         TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
    project_id TEXT NOT NULL REFERENCES projects(id),
    name       TEXT NOT NULL,
    color      TEXT NOT NULL DEFAULT 'bg-gray-500',
    position   INTEGER NOT NULL DEFAULT 0
);
