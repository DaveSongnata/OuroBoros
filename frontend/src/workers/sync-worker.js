/**
 * OuroBoros Sync Worker — Real SQLite Wasm + OPFS
 *
 * This worker manages a REAL SQLite database persisted to the Origin Private
 * File System (OPFS). Data survives page refreshes and browser restarts.
 * All reads from the UI are answered by SELECT queries against this local DB.
 */

import sqlite3InitModule from '@sqlite.org/sqlite-wasm';

let db = null;
let localVersion = 0;
let token = null;
let apiBase = '';

// ── SQLite OPFS Initialization ─────────────────────────────────────────────
async function initDB() {
    const sqlite3 = await sqlite3InitModule({
        print: console.log,
        printErr: console.error,
        locateFile: (file) => `/sqlite3/${file}`,
    });
    console.log('[worker] SQLite version:', sqlite3.version.libVersion);

    // Try OPFS first, fall back to in-memory
    if (sqlite3.oo1.OpfsDb) {
        console.log('[worker] OPFS VFS available — data will persist across refreshes');
        db = new sqlite3.oo1.OpfsDb('/ouroboros-local.db');
    } else {
        console.warn('[worker] OPFS not available, using in-memory DB (data lost on refresh)');
        db = new sqlite3.oo1.DB('/ouroboros-local.db', 'c');
    }

    // Run local migrations
    db.exec(`
        CREATE TABLE IF NOT EXISTS projects (
            id TEXT PRIMARY KEY, name TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS kanban_cards (
            id TEXT PRIMARY KEY, project_id TEXT NOT NULL,
            column_name TEXT NOT NULL DEFAULT 'backlog',
            title TEXT NOT NULL, position INTEGER NOT NULL DEFAULT 0,
            approval_status TEXT NOT NULL DEFAULT 'pending',
            assigned_approver_id TEXT,
            due_date TEXT, client TEXT,
            priority TEXT NOT NULL DEFAULT 'normal',
            notes TEXT
        );
        CREATE TABLE IF NOT EXISTS products (
            id TEXT PRIMARY KEY, name TEXT NOT NULL, price REAL NOT NULL DEFAULT 0
        );
        CREATE TABLE IF NOT EXISTS os_orders (
            uuid TEXT PRIMARY KEY, short_id TEXT NOT NULL,
            card_id TEXT, project_id TEXT, total REAL NOT NULL DEFAULT 0
        );
        CREATE TABLE IF NOT EXISTS os_items (
            id TEXT PRIMARY KEY, order_id TEXT NOT NULL,
            product_id TEXT NOT NULL, qty INTEGER NOT NULL DEFAULT 1
        );
        CREATE TABLE IF NOT EXISTS kanban_columns (
            id TEXT PRIMARY KEY, project_id TEXT NOT NULL,
            name TEXT NOT NULL, color TEXT NOT NULL DEFAULT 'bg-gray-500',
            position INTEGER NOT NULL DEFAULT 0
        );
        CREATE TABLE IF NOT EXISTS card_tags (
            id TEXT PRIMARY KEY, card_id TEXT NOT NULL, name TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS card_assigned_users (
            id TEXT PRIMARY KEY, card_id TEXT NOT NULL,
            user_id TEXT NOT NULL, user_email TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS card_approvers (
            id TEXT PRIMARY KEY, card_id TEXT NOT NULL,
            user_id TEXT NOT NULL, user_email TEXT NOT NULL,
            status TEXT NOT NULL DEFAULT 'pending', decided_at TEXT
        );
        CREATE TABLE IF NOT EXISTS card_sessions (
            id TEXT PRIMARY KEY, card_id TEXT NOT NULL,
            name TEXT NOT NULL, position INTEGER NOT NULL DEFAULT 0
        );
        CREATE TABLE IF NOT EXISTS _meta (key TEXT PRIMARY KEY, value TEXT);
    `);

    // Restore persisted version
    const rows = db.exec({ sql: "SELECT value FROM _meta WHERE key = 'version'", returnValue: 'resultRows' });
    if (rows.length > 0) {
        localVersion = parseInt(rows[0][0], 10) || 0;
    }

    console.log('[worker] local DB ready, version:', localVersion);
    postMessage({ type: 'db-ready' });
}

// ── Delta Application ──────────────────────────────────────────────────────
function applyDelta(entry) {
    const payload = typeof entry.payload === 'string' ? JSON.parse(entry.payload) : entry.payload;
    const table = entry.table_name;
    const entityId = entry.entity_id;

    switch (entry.operation) {
        case 'INSERT':
        case 'UPDATE':
        case 'PATCH':
            upsertRow(table, entityId, payload);
            break;
        case 'DELETE':
            db.exec({ sql: `DELETE FROM ${table} WHERE ${pkCol(table)} = ?`, bind: [entityId] });
            break;
    }
}

function pkCol(table) {
    if (table === 'os_orders') return 'uuid';
    return 'id';
}

function upsertRow(table, id, payload) {
    switch (table) {
        case 'projects':
            db.exec({
                sql: `INSERT OR REPLACE INTO projects (id, name) VALUES (?, ?)`,
                bind: [payload.id || id, payload.name],
            });
            break;
        case 'kanban_cards':
            db.exec({
                sql: `INSERT OR REPLACE INTO kanban_cards (id, project_id, column_name, title, position, approval_status, assigned_approver_id, due_date, client, priority, notes)
                      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                bind: [payload.id || id, payload.project_id, payload.column_name || 'backlog',
                       payload.title, payload.position || 0,
                       payload.approval_status || 'pending', payload.assigned_approver_id || null,
                       payload.due_date || null, payload.client || null,
                       payload.priority || 'normal', payload.notes || null],
            });
            break;
        case 'products':
            db.exec({
                sql: `INSERT OR REPLACE INTO products (id, name, price) VALUES (?, ?, ?)`,
                bind: [payload.id || id, payload.name, payload.price || 0],
            });
            break;
        case 'os_orders':
            db.exec({
                sql: `INSERT OR REPLACE INTO os_orders (uuid, short_id, card_id, project_id, total) VALUES (?, ?, ?, ?, ?)`,
                bind: [payload.uuid || id, payload.short_id, payload.card_id || null,
                       payload.project_id || null, payload.total || 0],
            });
            // Also insert items if present in payload (backward compat)
            if (payload.items && Array.isArray(payload.items)) {
                for (const it of payload.items) {
                    db.exec({
                        sql: `INSERT OR REPLACE INTO os_items (id, order_id, product_id, qty) VALUES (?, ?, ?, ?)`,
                        bind: [it.id, it.order_id || payload.uuid || id, it.product_id, it.qty || 1],
                    });
                }
            }
            break;
        case 'os_items':
            db.exec({
                sql: `INSERT OR REPLACE INTO os_items (id, order_id, product_id, qty) VALUES (?, ?, ?, ?)`,
                bind: [payload.id || id, payload.order_id, payload.product_id, payload.qty || 1],
            });
            break;
        case 'kanban_columns':
            db.exec({
                sql: `INSERT OR REPLACE INTO kanban_columns (id, project_id, name, color, position) VALUES (?, ?, ?, ?, ?)`,
                bind: [payload.id || id, payload.project_id, payload.name, payload.color || 'bg-gray-500', payload.position || 0],
            });
            break;
        case 'card_tags':
            db.exec({
                sql: `INSERT OR REPLACE INTO card_tags (id, card_id, name) VALUES (?, ?, ?)`,
                bind: [payload.id || id, payload.card_id, payload.name],
            });
            break;
        case 'card_assigned_users':
            db.exec({
                sql: `INSERT OR REPLACE INTO card_assigned_users (id, card_id, user_id, user_email) VALUES (?, ?, ?, ?)`,
                bind: [payload.id || id, payload.card_id, payload.user_id, payload.user_email],
            });
            break;
        case 'card_approvers':
            db.exec({
                sql: `INSERT OR REPLACE INTO card_approvers (id, card_id, user_id, user_email, status, decided_at) VALUES (?, ?, ?, ?, ?, ?)`,
                bind: [payload.id || id, payload.card_id, payload.user_id, payload.user_email,
                       payload.status || 'pending', payload.decided_at || null],
            });
            break;
        case 'card_sessions':
            db.exec({
                sql: `INSERT OR REPLACE INTO card_sessions (id, card_id, name, position) VALUES (?, ?, ?, ?)`,
                bind: [payload.id || id, payload.card_id, payload.name, payload.position || 0],
            });
            break;
    }
}

// ── SSE Connection ─────────────────────────────────────────────────────────
async function startFetchSSE() {
    const url = `${apiBase}/sse/events`;
    try {
        const response = await fetch(url, {
            headers: { 'Authorization': `Bearer ${token}` },
        });
        if (!response.ok) {
            postMessage({ type: 'sync-status', status: 'offline' });
            setTimeout(() => startFetchSSE(), 5000);
            return;
        }

        postMessage({ type: 'sync-status', status: 'online' });

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';

        while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split('\n');
            buffer = lines.pop();
            for (const line of lines) {
                if (line.startsWith('data: ')) {
                    const version = parseInt(line.slice(6).trim(), 10);
                    if (!isNaN(version) && version > localVersion) {
                        await fetchDeltas();
                    }
                }
            }
        }
    } catch {
        postMessage({ type: 'sync-status', status: 'offline' });
        setTimeout(() => startFetchSSE(), 5000);
    }
}

// ── Delta Sync ─────────────────────────────────────────────────────────────
async function fetchDeltas() {
    try {
        const res = await fetch(`${apiBase}/api/sync?since=${localVersion}`, {
            headers: { 'Authorization': `Bearer ${token}` },
        });
        if (!res.ok) return;

        const deltas = await res.json();
        if (!deltas.length) return;

        for (const delta of deltas) {
            applyDelta(delta);
        }
        localVersion = deltas[deltas.length - 1].version;

        // Persist version to OPFS
        db.exec({ sql: `INSERT OR REPLACE INTO _meta (key, value) VALUES ('version', ?)`, bind: [String(localVersion)] });

        postMessage({
            type: 'sync-complete',
            version: localVersion,
            tables: [...new Set(deltas.map(d => d.table_name))],
        });
    } catch (err) {
        console.error('[worker] fetchDeltas error:', err);
    }
}

// ── Query Handler — Real SQL SELECTs ───────────────────────────────────────
function handleQuery(id, query) {
    if (!db) {
        postMessage({ type: 'query-result', id, result: [] });
        return;
    }
    const { table, filter, sql: rawSql } = query;
    let result;

    if (rawSql) {
        // Allow raw SQL for JOINs (e.g., sales totals per card)
        result = db.exec({ sql: rawSql, returnValue: 'resultRows', rowMode: 'object' });
    } else {
        let sqlStr = `SELECT * FROM ${table}`;
        const binds = [];
        if (filter && Object.keys(filter).length > 0) {
            const clauses = Object.entries(filter).map(([k]) => `${k} = ?`);
            binds.push(...Object.values(filter));
            sqlStr += ` WHERE ${clauses.join(' AND ')}`;
        }
        if (table === 'kanban_cards') sqlStr += ' ORDER BY position';
        if (table === 'kanban_columns') sqlStr += ' ORDER BY position';
        if (table === 'os_orders') sqlStr += ' ORDER BY rowid DESC';

        result = db.exec({ sql: sqlStr, bind: binds, returnValue: 'resultRows', rowMode: 'object' });
    }

    postMessage({ type: 'query-result', id, result });
}

// ── Optimistic Write ───────────────────────────────────────────────────────
function handleOptimisticWrite(data) {
    if (!db) return;
    const { table, id, payload } = data;
    upsertRow(table, id, payload);
    postMessage({
        type: 'sync-complete',
        version: localVersion,
        tables: [table],
    });
}

// ── Message Handler ────────────────────────────────────────────────────────
self.onmessage = async function (e) {
    const msg = e.data;
    switch (msg.type) {
        case 'init':
            token = msg.token;
            apiBase = msg.apiBase || '';
            await initDB();
            await fetchDeltas();
            startFetchSSE();
            break;
        case 'query':
            handleQuery(msg.id, msg.query);
            break;
        case 'optimistic-write':
            handleOptimisticWrite(msg.data);
            break;
        case 'force-sync':
            await fetchDeltas();
            break;
    }
};
