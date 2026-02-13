-- Link orders to kanban cards via project_id, add approval workflow

ALTER TABLE os_orders ADD COLUMN project_id TEXT REFERENCES kanban_cards(id);

ALTER TABLE kanban_cards ADD COLUMN approval_status TEXT NOT NULL DEFAULT 'pending'
    CHECK(approval_status IN ('pending', 'approved', 'rejected'));

ALTER TABLE kanban_cards ADD COLUMN assigned_approver_id TEXT;
