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
  deleteProject: (id) => request('DELETE', `/api/projects/${id}`),
  createCard: (data) => request('POST', '/api/kanban/cards', data),
  updateCard: (id, data) => request('PUT', `/api/kanban/cards/${id}`, data),
  createProduct: (data) => request('POST', '/api/products', data),
  createOrder: (data) => request('POST', '/api/orders', data),

  // Columns
  createColumn: (data) => request('POST', '/api/kanban/columns', data),
  updateColumn: (id, data) => request('PUT', `/api/kanban/columns/${id}`, data),
  deleteColumn: (id) => request('DELETE', `/api/kanban/columns/${id}`),

  // Users
  listUsers: () => request('GET', '/api/users'),
  inviteUser: (email, password) => request('POST', '/api/users', { email, password }),

  // Card details
  addTag: (cardId, name) => request('POST', `/api/kanban/cards/${cardId}/tags`, { name }),
  removeTag: (cardId, tagId) => request('DELETE', `/api/kanban/cards/${cardId}/tags/${tagId}`),
  assignUser: (cardId, user_id, user_email) => request('POST', `/api/kanban/cards/${cardId}/assignees`, { user_id, user_email }),
  unassignUser: (cardId, assigneeId) => request('DELETE', `/api/kanban/cards/${cardId}/assignees/${assigneeId}`),
  addApprover: (cardId, user_id, user_email) => request('POST', `/api/kanban/cards/${cardId}/approvers`, { user_id, user_email }),
  removeApprover: (cardId, approverId) => request('DELETE', `/api/kanban/cards/${cardId}/approvers/${approverId}`),
  decideApproval: (cardId, approverId, status) => request('POST', `/api/kanban/cards/${cardId}/approvers/${approverId}/decide`, { status }),
  createSession: (cardId, name) => request('POST', `/api/kanban/cards/${cardId}/sessions`, { name }),
  deleteSession: (cardId, sessionId) => request('DELETE', `/api/kanban/cards/${cardId}/sessions/${sessionId}`),
};
