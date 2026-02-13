const API_BASE = '';

let token = null;

export function setToken(t) {
  token = t;
}

export function getToken() {
  return token;
}

export async function fetchToken(tenantId) {
  const res = await fetch(`${API_BASE}/api/auth/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ tenant_id: tenantId }),
  });
  if (!res.ok) throw new Error('Failed to get token');
  const data = await res.json();
  token = data.token;
  return data.token;
}

async function request(method, path, body) {
  const res = await fetch(`${API_BASE}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: 'request failed' }));
    throw new Error(err.error || 'request failed');
  }
  return res.json();
}

export const api = {
  createProject: (name) => request('POST', '/api/projects', { name }),
  createCard: (data) => request('POST', '/api/kanban/cards', data),
  updateCard: (id, data) => request('PUT', `/api/kanban/cards/${id}`, data),
  createProduct: (data) => request('POST', '/api/products', data),
  createOrder: (data) => request('POST', '/api/orders', data),
};
