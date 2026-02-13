const API_BASE = '';

let token = null;

export function setToken(t) {
  token = t;
}

export function getToken() {
  return token;
}

async function request(method, path, body) {
  const res = await fetch(`${API_BASE}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
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
  // Auth (no token needed)
  register: (email, password, tenant_id) => request('POST', '/api/auth/register', { email, password, tenant_id }),
  login: (email, password) => request('POST', '/api/auth/login', { email, password }),

  // Domain (token required)
  createProject: (name) => request('POST', '/api/projects', { name }),
  createCard: (data) => request('POST', '/api/kanban/cards', data),
  updateCard: (id, data) => request('PUT', `/api/kanban/cards/${id}`, data),
  createProduct: (data) => request('POST', '/api/products', data),
  createOrder: (data) => request('POST', '/api/orders', data),
  listUsers: () => request('GET', '/api/users'),
};
