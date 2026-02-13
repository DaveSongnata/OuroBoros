/**
 * OuroBoros - Main Thread UI
 *
 * Rules:
 * - NEVER makes GET requests to the network (reads come from the local worker DB)
 * - POST/PUT/PATCH go to the server, with optimistic UI updates
 * - Listens to worker messages for re-renders after sync
 */

const API_BASE = location.origin;
let token = null;
let tenantId = null;
let worker = null;
let currentTab = 'kanban';
let currentProjectId = null;
let queryCallbacks = {};
let queryIdCounter = 0;

// ── Cart State (POS) ──────────────────────────────────────────────────────
let cart = []; // { product: {...}, qty: number }

// ── Bootstrap ──────────────────────────────────────────────────────────────
async function boot() {
    // Auto-provision a tenant token for the demo
    tenantId = localStorage.getItem('ouroboros_tenant') || 'demo';
    token = localStorage.getItem('ouroboros_token');

    if (!token) {
        try {
            const res = await fetch(`${API_BASE}/api/auth/token`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ tenant_id: tenantId }),
            });
            const data = await res.json();
            token = data.token;
            localStorage.setItem('ouroboros_token', token);
            localStorage.setItem('ouroboros_tenant', tenantId);
        } catch (err) {
            document.getElementById('syncStatus').textContent = 'API Offline';
            document.getElementById('syncStatus').className = 'status offline';
            return;
        }
    }

    // Start Web Worker
    worker = new Worker('src/worker.js');
    worker.onmessage = handleWorkerMessage;
    worker.postMessage({ type: 'init', token, apiBase: API_BASE });

    // Tab switching
    document.querySelectorAll('.tab').forEach(tab => {
        tab.addEventListener('click', () => switchTab(tab.dataset.tab));
    });

    // Kanban controls
    document.getElementById('addProjectBtn').addEventListener('click', addProject);
    document.getElementById('newProjectName').addEventListener('keydown', e => { if (e.key === 'Enter') addProject(); });
    document.getElementById('projectSelect').addEventListener('change', e => {
        currentProjectId = e.target.value;
        renderKanban();
    });

    // POS controls
    document.getElementById('addProductBtn').addEventListener('click', addProduct);
    document.getElementById('newProductName').addEventListener('keydown', e => { if (e.key === 'Enter') addProduct(); });
    document.getElementById('clearCartBtn').addEventListener('click', () => { cart = []; renderCart(); });
    document.getElementById('placeOrderBtn').addEventListener('click', placeOrder);
}

// ── Worker Communication ───────────────────────────────────────────────────
function handleWorkerMessage(e) {
    const msg = e.data;
    switch (msg.type) {
        case 'db-ready':
            document.getElementById('syncStatus').textContent = 'Syncing...';
            break;

        case 'sync-status':
            const el = document.getElementById('syncStatus');
            if (msg.status === 'online') {
                el.textContent = 'Online';
                el.className = 'status';
            } else {
                el.textContent = 'Offline';
                el.className = 'status offline';
            }
            break;

        case 'sync-complete':
            document.getElementById('versionDisplay').textContent = `v${msg.version}`;
            // Re-render affected views
            if (msg.tables.includes('projects')) renderProjectSelect();
            if (msg.tables.includes('kanban_cards')) renderKanban();
            if (msg.tables.includes('products')) renderProducts();
            if (msg.tables.includes('os_orders')) renderOrders();
            break;

        case 'query-result':
            const cb = queryCallbacks[msg.id];
            if (cb) {
                cb(msg.result);
                delete queryCallbacks[msg.id];
            }
            break;
    }
}

function queryWorker(table, filter) {
    return new Promise(resolve => {
        const id = ++queryIdCounter;
        queryCallbacks[id] = resolve;
        worker.postMessage({ type: 'query', id, query: { table, filter } });
    });
}

// ── API Helper ─────────────────────────────────────────────────────────────
async function apiPost(path, body) {
    const res = await fetch(`${API_BASE}${path}`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`,
        },
        body: JSON.stringify(body),
    });
    if (!res.ok) {
        const err = await res.json().catch(() => ({ error: 'request failed' }));
        throw new Error(err.error || 'request failed');
    }
    return res.json();
}

async function apiPut(path, body) {
    const res = await fetch(`${API_BASE}${path}`, {
        method: 'PUT',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`,
        },
        body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error('request failed');
    return res.json();
}

// ── Tab Switching ──────────────────────────────────────────────────────────
function switchTab(tab) {
    currentTab = tab;
    document.querySelectorAll('.tab').forEach(t => t.classList.toggle('active', t.dataset.tab === tab));
    document.getElementById('kanban-tab').style.display = tab === 'kanban' ? '' : 'none';
    document.getElementById('pos-tab').style.display = tab === 'pos' ? '' : 'none';
}

// ── KANBAN ─────────────────────────────────────────────────────────────────
const COLUMNS = ['backlog', 'todo', 'in_progress', 'review', 'done'];
const COLUMN_LABELS = { backlog: 'Backlog', todo: 'To Do', in_progress: 'In Progress', review: 'Review', done: 'Done' };

async function renderProjectSelect() {
    const projects = await queryWorker('projects');
    const select = document.getElementById('projectSelect');
    const currentVal = select.value;
    select.innerHTML = '<option value="">Select project...</option>';
    projects.forEach(p => {
        const opt = document.createElement('option');
        opt.value = p.id;
        opt.textContent = p.name;
        select.appendChild(opt);
    });
    if (currentVal) select.value = currentVal;
    if (!currentProjectId && projects.length > 0) {
        currentProjectId = projects[0].id;
        select.value = currentProjectId;
        renderKanban();
    }
}

async function renderKanban() {
    if (!currentProjectId) {
        document.getElementById('kanbanBoard').innerHTML = '<p style="color:#8b949e;padding:20px;">Select or create a project to see the board.</p>';
        return;
    }
    const cards = await queryWorker('kanban_cards', { project_id: currentProjectId });
    const board = document.getElementById('kanbanBoard');
    board.innerHTML = '';

    COLUMNS.forEach(col => {
        const colCards = cards.filter(c => c.column_name === col);
        const colEl = document.createElement('div');
        colEl.className = 'kanban-column';
        colEl.innerHTML = `
            <div class="kanban-column-header">
                ${COLUMN_LABELS[col]}
                <span class="count">${colCards.length}</span>
            </div>
            <div class="kanban-cards" data-column="${col}"></div>
        `;

        const cardsContainer = colEl.querySelector('.kanban-cards');

        // Drop zone
        cardsContainer.addEventListener('dragover', e => {
            e.preventDefault();
            cardsContainer.style.background = '#1c2128';
        });
        cardsContainer.addEventListener('dragleave', () => {
            cardsContainer.style.background = '';
        });
        cardsContainer.addEventListener('drop', e => {
            e.preventDefault();
            cardsContainer.style.background = '';
            const cardId = e.dataTransfer.getData('text/plain');
            moveCard(cardId, col);
        });

        colCards.forEach(card => {
            const cardEl = document.createElement('div');
            cardEl.className = 'kanban-card';
            cardEl.draggable = true;
            cardEl.innerHTML = `<div class="card-title">${escapeHtml(card.title)}</div><div class="card-id">${card.id.slice(0, 8)}</div>`;
            cardEl.addEventListener('dragstart', e => {
                e.dataTransfer.setData('text/plain', card.id);
                cardEl.classList.add('dragging');
            });
            cardEl.addEventListener('dragend', () => cardEl.classList.remove('dragging'));
            cardsContainer.appendChild(cardEl);
        });

        // Add card button
        const addBtn = document.createElement('button');
        addBtn.className = 'add-card-btn';
        addBtn.textContent = '+ Add card';
        addBtn.addEventListener('click', () => promptAddCard(col));
        cardsContainer.appendChild(addBtn);

        board.appendChild(colEl);
    });
}

async function addProject() {
    const input = document.getElementById('newProjectName');
    const name = input.value.trim();
    if (!name) return;
    input.value = '';

    try {
        const p = await apiPost('/api/projects', { name });
        // Optimistic: tell worker to add it locally
        worker.postMessage({ type: 'optimistic-write', data: { table: 'projects', id: p.id, payload: p } });
        currentProjectId = p.id;
        renderProjectSelect();
    } catch (err) {
        alert('Failed to create project: ' + err.message);
    }
}

async function promptAddCard(column) {
    const title = prompt(`New card in "${COLUMN_LABELS[column]}":`);
    if (!title) return;

    try {
        const c = await apiPost('/api/kanban/cards', {
            project_id: currentProjectId,
            column_name: column,
            title,
        });
        // Optimistic update
        worker.postMessage({ type: 'optimistic-write', data: { table: 'kanban_cards', id: c.id, payload: c } });
    } catch (err) {
        alert('Failed to create card: ' + err.message);
    }
}

async function moveCard(cardId, newColumn) {
    // Optimistic: update locally first
    const cards = await queryWorker('kanban_cards');
    const card = cards.find(c => c.id === cardId);
    if (card) {
        const updated = { ...card, column_name: newColumn };
        worker.postMessage({ type: 'optimistic-write', data: { table: 'kanban_cards', id: cardId, payload: updated } });
    }

    // Then send to server
    try {
        await apiPut(`/api/kanban/cards/${cardId}`, { column_name: newColumn });
    } catch (err) {
        // On failure, force re-sync to correct state
        worker.postMessage({ type: 'force-sync' });
    }
}

// ── POS ────────────────────────────────────────────────────────────────────
async function renderProducts() {
    const products = await queryWorker('products');
    const grid = document.getElementById('productsGrid');
    grid.innerHTML = '';
    products.forEach(p => {
        const tile = document.createElement('div');
        tile.className = 'product-tile';
        tile.innerHTML = `<div class="name">${escapeHtml(p.name)}</div><div class="price">R$ ${Number(p.price).toFixed(2)}</div>`;
        tile.addEventListener('click', () => addToCart(p));
        grid.appendChild(tile);
    });
}

function addToCart(product) {
    const existing = cart.find(i => i.product.id === product.id);
    if (existing) {
        existing.qty++;
    } else {
        cart.push({ product, qty: 1 });
    }
    renderCart();
}

function renderCart() {
    const container = document.getElementById('cartItems');
    container.innerHTML = '';
    let total = 0;
    cart.forEach((item, idx) => {
        total += item.product.price * item.qty;
        const row = document.createElement('div');
        row.className = 'cart-item';
        row.innerHTML = `
            <span>${item.qty}x ${escapeHtml(item.product.name)}</span>
            <span>R$ ${(item.product.price * item.qty).toFixed(2)}</span>
        `;
        row.style.cursor = 'pointer';
        row.title = 'Click to remove';
        row.addEventListener('click', () => {
            cart.splice(idx, 1);
            renderCart();
        });
        container.appendChild(row);
    });
    document.getElementById('cartTotal').textContent = `R$ ${total.toFixed(2)}`;
}

async function addProduct() {
    const nameInput = document.getElementById('newProductName');
    const priceInput = document.getElementById('newProductPrice');
    const name = nameInput.value.trim();
    const price = parseFloat(priceInput.value);
    if (!name || isNaN(price)) return;
    nameInput.value = '';
    priceInput.value = '';

    try {
        const p = await apiPost('/api/products', { name, price });
        worker.postMessage({ type: 'optimistic-write', data: { table: 'products', id: p.id, payload: p } });
    } catch (err) {
        alert('Failed to create product: ' + err.message);
    }
}

async function placeOrder() {
    if (cart.length === 0) return;
    const items = cart.map(i => ({ product_id: i.product.id, qty: i.qty }));

    try {
        const order = await apiPost('/api/orders', { items });
        worker.postMessage({ type: 'optimistic-write', data: { table: 'os_orders', id: order.uuid, payload: order } });
        cart = [];
        renderCart();
        alert(`Order placed! ID: ${order.short_id}`);
    } catch (err) {
        alert('Failed to place order: ' + err.message);
    }
}

async function renderOrders() {
    const orders = await queryWorker('os_orders');
    const container = document.getElementById('ordersList');
    container.innerHTML = '';
    orders.forEach(o => {
        const row = document.createElement('div');
        row.className = 'order-row';
        row.innerHTML = `
            <span class="short-id">#${o.short_id}</span>
            <span class="total">R$ ${Number(o.total).toFixed(2)}</span>
        `;
        container.appendChild(row);
    });
}

// ── Utilities ──────────────────────────────────────────────────────────────
function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
}

// ── Start ──────────────────────────────────────────────────────────────────
boot();
