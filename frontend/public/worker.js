/**
 * OuroBoros Web Worker
 *
 * Responsibilities:
 * - Manage a local SQLite database via sqlite-wasm (OPFS)
 * - Listen for SSE version events from the server
 * - Fetch deltas from the server and apply them locally
 * - Respond to queries from the main thread (reads from local DB)
 * - The main thread NEVER makes GET requests to the network
 */

let db = null;
let localVersion = 0;
let token = null;
let apiBase = '';
let sseSource = null;

// ── SQLite WASM Setup ──────────────────────────────────────────────────────
// We use the official sqlite-wasm OPFS build.
// In production, serve sqlite3.wasm from your own CDN.
const SQLITE_WASM_URL = 'https://cdn.jsdelivr.net/npm/@aspect-build/aspect-sqlite-wasm@0.2.0/dist/';

async function initDB() {
    // For this MVP, we use an in-memory store with a simple JS object
    // as a SQLite-wasm OPFS alternative that works without complex setup.
    // In production, replace with actual sqlite-wasm OPFS.
    db = createLocalStore();
    localVersion = 0;
    postMessage({ type: 'db-ready' });
}

// Simple local store that mirrors the SQLite schema in memory.
// This allows the MVP to work without requiring OPFS/SharedArrayBuffer.
function createLocalStore() {
    const store = {
        projects: new Map(),
        kanban_cards: new Map(),
        products: new Map(),
        os_orders: new Map(),
        os_items: new Map(),
        _version: 0,
    };

    return {
        applyDelta(entry) {
            const table = entry.table_name;
            if (!store[table]) return;
            const payload = typeof entry.payload === 'string' ? JSON.parse(entry.payload) : entry.payload;
            const entityId = entry.entity_id;

            switch (entry.operation) {
                case 'INSERT':
                case 'UPDATE':
                case 'PATCH':
                    store[table].set(entityId, payload);
                    break;
                case 'DELETE':
                    store[table].delete(entityId);
                    break;
            }
            store._version = Math.max(store._version, entry.version);
        },

        getAll(table) {
            if (!store[table]) return [];
            return Array.from(store[table].values());
        },

        get(table, id) {
            if (!store[table]) return null;
            return store[table].get(id) || null;
        },

        upsert(table, id, data) {
            if (!store[table]) return;
            store[table].set(id, data);
        },

        get version() { return store._version; },
        set version(v) { store._version = v; },
    };
}

// ── SSE Connection ─────────────────────────────────────────────────────────
function connectSSE() {
    if (sseSource) {
        sseSource.close();
    }

    // SSE via EventSource doesn't support custom headers.
    // We pass the token as a query parameter for SSE only.
    // The server's SSE endpoint should accept this.
    // Alternative: use fetch-based SSE.
    startFetchSSE();
}

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
            buffer = lines.pop(); // keep incomplete line in buffer

            for (const line of lines) {
                if (line.startsWith('data: ')) {
                    const version = parseInt(line.slice(6).trim(), 10);
                    if (!isNaN(version) && version > localVersion) {
                        await fetchDeltas();
                    }
                }
            }
        }
    } catch (err) {
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
            db.applyDelta(delta);
        }
        localVersion = deltas[deltas.length - 1].version;

        postMessage({
            type: 'sync-complete',
            version: localVersion,
            tables: [...new Set(deltas.map(d => d.table_name))],
        });
    } catch (err) {
        console.error('[worker] fetchDeltas error:', err);
    }
}

// ── Query Handler ──────────────────────────────────────────────────────────
function handleQuery(id, query) {
    const { table, filter } = query;
    let result = db.getAll(table);

    if (filter) {
        result = result.filter(row => {
            for (const [key, val] of Object.entries(filter)) {
                if (row[key] !== val) return false;
            }
            return true;
        });
    }

    // Sort kanban cards by position
    if (table === 'kanban_cards') {
        result.sort((a, b) => (a.position || 0) - (b.position || 0));
    }

    postMessage({ type: 'query-result', id, result });
}

// ── Optimistic Write ───────────────────────────────────────────────────────
function handleOptimisticWrite(data) {
    const { table, id, payload } = data;
    db.upsert(table, id, payload);
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
            // Initial full sync
            await fetchDeltas();
            connectSSE();
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
