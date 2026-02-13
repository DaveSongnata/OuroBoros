import { useState, useEffect, useCallback, useRef } from 'react';
import { useWorker } from '../hooks/useWorker';
import { api } from '../lib/api';
import {
  X, FileText, ShoppingCart, ShieldCheck,
  Plus, Minus, PlusCircle, Receipt, Trash2,
  CheckCircle, XCircle, Clock, Lock,
  ChevronDown, ChevronRight, Tag, Users, CalendarDays,
  LayoutList, StickyNote, UserPlus, Search,
} from 'lucide-react';

const TABS = [
  { id: 'details', label: 'Informações', icon: FileText },
  { id: 'pos', label: 'POS', icon: ShoppingCart },
  { id: 'approvals', label: 'Aprovações', icon: ShieldCheck },
];

const STATUS_CONFIG = {
  pending: { icon: Clock, color: 'text-yellow-400', bg: 'bg-yellow-500/10', label: 'Pendente' },
  approved: { icon: CheckCircle, color: 'text-emerald-400', bg: 'bg-emerald-500/10', label: 'Aprovado' },
  rejected: { icon: XCircle, color: 'text-red-400', bg: 'bg-red-500/10', label: 'Rejeitado' },
};

const PRIORITIES = [
  { value: 'normal', label: 'Normal', color: 'bg-gray-600 text-gray-200' },
  { value: 'urgente', label: 'Urgente', color: 'bg-red-600 text-white' },
  { value: 'evento', label: 'Evento', color: 'bg-blue-600 text-white' },
  { value: 'atrasado', label: 'Atrasado', color: 'bg-orange-600 text-white' },
];

export default function CardDrawer({ card, onClose }) {
  const { query, optimisticWrite, onSync } = useWorker();
  const [tab, setTab] = useState('details');
  const [products, setProducts] = useState([]);
  const [cart, setCart] = useState([]);
  const [orders, setOrders] = useState([]);
  const [users, setUsers] = useState([]);
  const [placing, setPlacing] = useState(false);
  const placingRef = useRef(false);
  const [cardData, setCardData] = useState(card);

  // New state for card details
  const [tags, setTags] = useState([]);
  const [assignees, setAssignees] = useState([]);
  const [approvers, setApprovers] = useState([]);
  const [sessions, setSessions] = useState([]);
  const [expandedOrder, setExpandedOrder] = useState(null);
  const [orderItems, setOrderItems] = useState({});
  const [newTagName, setNewTagName] = useState('');
  const [newSessionName, setNewSessionName] = useState('');
  const [newProductName, setNewProductName] = useState('');
  const [newProductPrice, setNewProductPrice] = useState('');
  const [assigneeSearch, setAssigneeSearch] = useState('');
  const [approverSearch, setApproverSearch] = useState('');
  const [allProjectTags, setAllProjectTags] = useState([]);
  const [productSearch, setProductSearch] = useState('');
  const [productPage, setProductPage] = useState(1);

  const currentUser = JSON.parse(localStorage.getItem('ouroboros_user') || '{}');

  const loadProducts = useCallback(async () => {
    setProducts(await query('products'));
  }, [query]);

  const loadOrders = useCallback(async () => {
    setOrders(await query('os_orders', { card_id: card.id }));
  }, [query, card.id]);

  const loadCard = useCallback(async () => {
    const result = await query('kanban_cards', { id: card.id });
    if (result.length > 0) setCardData(result[0]);
  }, [query, card.id]);

  const loadTags = useCallback(async () => {
    setTags(await query('card_tags', { card_id: card.id }));
  }, [query, card.id]);

  const loadAssignees = useCallback(async () => {
    setAssignees(await query('card_assigned_users', { card_id: card.id }));
  }, [query, card.id]);

  const loadApprovers = useCallback(async () => {
    setApprovers(await query('card_approvers', { card_id: card.id }));
  }, [query, card.id]);

  const loadSessions = useCallback(async () => {
    setSessions(await query('card_sessions', { card_id: card.id }));
  }, [query, card.id]);

  const loadAllProjectTags = useCallback(async () => {
    const result = await query(null, null,
      `SELECT DISTINCT name FROM card_tags WHERE card_id IN (SELECT id FROM kanban_cards WHERE project_id = '${card.project_id}')`
    );
    setAllProjectTags(result.map(r => r.name));
  }, [query, card.project_id]);

  useEffect(() => {
    loadProducts();
    loadOrders();
    loadTags();
    loadAssignees();
    loadApprovers();
    loadSessions();
    loadAllProjectTags();
    api.listUsers().then(setUsers).catch(() => {});
  }, [loadProducts, loadOrders, loadTags, loadAssignees, loadApprovers, loadSessions, loadAllProjectTags]);

  // Reload data when switching tabs to ensure freshness
  useEffect(() => {
    if (tab === 'approvals') { loadApprovers(); loadCard(); }
    if (tab === 'pos') loadProducts();
    if (tab === 'details') { loadTags(); loadAllProjectTags(); loadAssignees(); loadSessions(); loadOrders(); }
  }, [tab, loadApprovers, loadCard, loadProducts, loadTags, loadAllProjectTags, loadAssignees, loadSessions, loadOrders]);

  useEffect(() => {
    return onSync((tables) => {
      if (tables.includes('products')) loadProducts();
      if (tables.includes('os_orders') || tables.includes('os_items')) loadOrders();
      if (tables.includes('kanban_cards')) loadCard();
      if (tables.includes('card_tags')) { loadTags(); loadAllProjectTags(); }
      if (tables.includes('card_assigned_users')) loadAssignees();
      if (tables.includes('card_approvers')) loadApprovers();
      if (tables.includes('card_sessions')) loadSessions();
      if (tables.includes('users')) api.listUsers().then(setUsers).catch(() => {});
    });
  }, [onSync, loadProducts, loadOrders, loadCard, loadTags, loadAllProjectTags, loadAssignees, loadApprovers, loadSessions]);

  const totalSales = orders.reduce((sum, o) => sum + (Number(o.total) || 0), 0);
  const isRejected = cardData.approval_status === 'rejected';

  // ─── Card field update (debounced save on blur) ───
  async function updateField(field, value) {
    try {
      const updated = await api.updateCard(card.id, { [field]: value });
      optimisticWrite('kanban_cards', card.id, updated);
      setCardData(updated);
    } catch (err) {
      alert('Failed: ' + err.message);
    }
  }

  // ─── Tags ───
  async function handleAddTag() {
    if (!newTagName.trim()) return;
    try {
      const t = await api.addTag(card.id, newTagName.trim());
      optimisticWrite('card_tags', t.id, t);
      setNewTagName('');
    } catch (err) { alert(err.message); }
  }

  async function handleRemoveTag(tagId) {
    try {
      await api.removeTag(card.id, tagId);
      setTags(prev => prev.filter(t => t.id !== tagId));
    } catch (err) { alert(err.message); }
  }

  // ─── Assigned users ───
  async function handleAssignUser(user) {
    if (assignees.some(a => a.user_id === user.id)) return;
    try {
      const a = await api.assignUser(card.id, user.id, user.email);
      optimisticWrite('card_assigned_users', a.id, a);
      setAssigneeSearch('');
    } catch (err) { alert(err.message); }
  }

  async function handleUnassignUser(assigneeId) {
    try {
      await api.unassignUser(card.id, assigneeId);
      setAssignees(prev => prev.filter(a => a.id !== assigneeId));
    } catch (err) { alert(err.message); }
  }

  // ─── Approvers ───
  async function handleAddApprover(user) {
    if (approvers.some(a => a.user_id === user.id)) return;
    try {
      const a = await api.addApprover(card.id, user.id, user.email);
      optimisticWrite('card_approvers', a.id, a);
      setApproverSearch('');
    } catch (err) { alert(err.message); }
  }

  async function handleRemoveApprover(approverId) {
    try {
      await api.removeApprover(card.id, approverId);
      setApprovers(prev => prev.filter(a => a.id !== approverId));
    } catch (err) { alert(err.message); }
  }

  async function handleDecideApproval(approverId, status) {
    try {
      const updated = await api.decideApproval(card.id, approverId, status);
      optimisticWrite('card_approvers', updated.id, updated);
      loadCard();
    } catch (err) { alert(err.message); }
  }

  // ─── Sessions ───
  async function handleCreateSession() {
    if (!newSessionName.trim()) return;
    try {
      const s = await api.createSession(card.id, newSessionName.trim());
      optimisticWrite('card_sessions', s.id, s);
      setNewSessionName('');
    } catch (err) { alert(err.message); }
  }

  async function handleDeleteSession(sessionId) {
    try {
      await api.deleteSession(card.id, sessionId);
      setSessions(prev => prev.filter(s => s.id !== sessionId));
    } catch (err) { alert(err.message); }
  }

  // ─── Order expansion ───
  async function toggleOrderExpand(orderUuid) {
    if (expandedOrder === orderUuid) {
      setExpandedOrder(null);
      return;
    }
    setExpandedOrder(orderUuid);
    if (!orderItems[orderUuid]) {
      const items = await query('os_items', { order_id: orderUuid });
      setOrderItems(prev => ({ ...prev, [orderUuid]: items }));
    }
  }

  // ─── POS ───
  function addToCart(product) {
    setCart(prev => {
      const existing = prev.find(i => i.product.id === product.id);
      if (existing) return prev.map(i => i.product.id === product.id ? { ...i, qty: i.qty + 1 } : i);
      return [...prev, { product, qty: 1 }];
    });
  }

  function updateQty(productId, delta) {
    setCart(prev => prev.map(i => i.product.id === productId ? { ...i, qty: i.qty + delta } : i).filter(i => i.qty > 0));
  }

  const cartTotal = cart.reduce((sum, i) => sum + i.product.price * i.qty, 0);

  async function handlePlaceOrder() {
    if (cart.length === 0 || placingRef.current || isRejected) return;
    placingRef.current = true;
    setPlacing(true);
    try {
      const items = cart.map(i => ({ product_id: i.product.id, qty: i.qty }));
      const order = await api.createOrder({ items, card_id: card.id, project_id: card.project_id });
      optimisticWrite('os_orders', order.uuid, order);
      setCart([]);
    } catch (err) {
      alert('Failed: ' + err.message);
    } finally {
      placingRef.current = false;
      setPlacing(false);
    }
  }

  async function handleCreateProduct() {
    if (!newProductName.trim()) return;
    const price = parseFloat(newProductPrice) || 0;
    try {
      const p = await api.createProduct({ name: newProductName.trim(), price });
      optimisticWrite('products', p.id, p);
      setNewProductName('');
      setNewProductPrice('');
    } catch (err) { alert(err.message); }
  }

  const statusCfg = STATUS_CONFIG[cardData.approval_status] || STATUS_CONFIG.pending;
  const StatusIcon = statusCfg.icon;

  const filteredUsersForAssign = users.filter(u =>
    !assignees.some(a => a.user_id === u.id) &&
    u.email.toLowerCase().includes(assigneeSearch.toLowerCase())
  );

  const filteredUsersForApprove = users.filter(u =>
    !approvers.some(a => a.user_id === u.id) &&
    u.email.toLowerCase().includes(approverSearch.toLowerCase())
  );

  return (
    <div className="fixed inset-0 z-50 flex justify-end" onClick={onClose}>
      <div className="absolute inset-0 bg-black/50" />
      <div
        className="relative flex h-full w-full flex-col border-l border-gray-800 bg-gray-900 sm:max-w-lg"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-gray-800 px-4 py-3 sm:px-6 sm:py-4">
          <div className="min-w-0 flex-1">
            <h2 className="truncate text-base font-semibold text-gray-200 sm:text-lg">{cardData.title}</h2>
            <div className="mt-1 flex items-center gap-2">
              <span className={`flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${statusCfg.bg} ${statusCfg.color}`}>
                <StatusIcon size={12} /> {statusCfg.label}
              </span>
              <span className="text-xs text-gray-500">Vendas: R$ {totalSales.toFixed(2)}</span>
            </div>
          </div>
          <button onClick={onClose} className="ml-2 rounded-lg p-1 text-gray-400 hover:bg-gray-800">
            <X size={20} />
          </button>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-gray-800">
          {TABS.map(t => {
            const Icon = t.icon;
            return (
              <button
                key={t.id}
                onClick={() => setTab(t.id)}
                className={`flex flex-1 items-center justify-center gap-1.5 py-2.5 text-xs font-medium transition-colors ${
                  tab === t.id ? 'border-b-2 border-indigo-500 text-indigo-400' : 'text-gray-500 hover:text-gray-300'
                }`}
              >
                <Icon size={14} /> {t.label}
              </button>
            );
          })}
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-4 sm:p-6">
          {/* ═══════ DETAILS / INFORMAÇÕES ═══════ */}
          {tab === 'details' && (
            <div className="space-y-5">
              {/* Title */}
              <Field label="Título">
                <input
                  type="text"
                  defaultValue={cardData.title}
                  onBlur={e => { if (e.target.value !== cardData.title) updateField('title', e.target.value); }}
                  className="input-field"
                />
              </Field>

              {/* Due Date */}
              <Field label="Data de Entrega" icon={CalendarDays}>
                <input
                  type="date"
                  defaultValue={cardData.due_date || ''}
                  onChange={e => updateField('due_date', e.target.value)}
                  className="input-field"
                />
              </Field>

              {/* Client */}
              <Field label="Cliente">
                <input
                  type="text"
                  defaultValue={cardData.client || ''}
                  placeholder="Nome do cliente"
                  onBlur={e => { if (e.target.value !== (cardData.client || '')) updateField('client', e.target.value); }}
                  className="input-field"
                />
              </Field>

              {/* Priority */}
              <Field label="Prioridade">
                <div className="flex gap-1.5">
                  {PRIORITIES.map(p => (
                    <button
                      key={p.value}
                      onClick={() => updateField('priority', p.value)}
                      className={`rounded-md px-3 py-1.5 text-xs font-medium transition-all ${
                        (cardData.priority || 'normal') === p.value
                          ? p.color + ' ring-2 ring-white/30'
                          : 'bg-gray-800 text-gray-400 hover:bg-gray-700'
                      }`}
                    >
                      {p.label}
                    </button>
                  ))}
                </div>
              </Field>

              {/* Status */}
              <Field label="Status">
                <div className={`flex items-center gap-2 rounded-lg px-4 py-2.5 ${statusCfg.bg}`}>
                  <StatusIcon size={16} className={statusCfg.color} />
                  <span className={`text-sm font-semibold ${statusCfg.color}`}>{statusCfg.label}</span>
                </div>
              </Field>

              {/* Tags */}
              <Field label="Tags" icon={Tag}>
                <div className="flex items-center gap-1.5">
                  <input
                    type="text"
                    value={newTagName}
                    onChange={e => setNewTagName(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && handleAddTag()}
                    placeholder="Nova tag"
                    className="input-field flex-1"
                  />
                  <button onClick={handleAddTag} className="rounded-md bg-indigo-600 px-3 py-2 text-xs font-medium text-white hover:bg-indigo-500">
                    Nova Tag
                  </button>
                </div>
                {tags.length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {tags.map(t => (
                      <span key={t.id} className="flex items-center gap-1 rounded-full bg-indigo-500/20 px-2.5 py-1 text-xs font-medium text-indigo-300">
                        {t.name}
                        <button onClick={() => handleRemoveTag(t.id)} className="ml-0.5 text-indigo-400 hover:text-red-400">
                          <X size={10} />
                        </button>
                      </span>
                    ))}
                  </div>
                )}
                {/* Reusable tag suggestions from other cards in the project */}
                {(() => {
                  const currentTagNames = tags.map(t => t.name);
                  const suggestions = allProjectTags.filter(name => !currentTagNames.includes(name));
                  if (suggestions.length === 0) return null;
                  return (
                    <div className="mt-2">
                      <p className="mb-1 text-xs text-gray-500">Tags do projeto:</p>
                      <div className="flex flex-wrap gap-1">
                        {suggestions.map(name => (
                          <button
                            key={name}
                            onClick={async () => {
                              try {
                                const t = await api.addTag(card.id, name);
                                optimisticWrite('card_tags', t.id, t);
                              } catch (err) { alert(err.message); }
                            }}
                            className="rounded-full bg-gray-800 px-2.5 py-1 text-xs text-gray-400 hover:bg-indigo-500/20 hover:text-indigo-300"
                          >
                            {name}
                          </button>
                        ))}
                      </div>
                    </div>
                  );
                })()}
              </Field>

              {/* Assigned Users */}
              <Field label="Usuários Atribuídos" icon={Users}>
                <input
                  type="text"
                  value={assigneeSearch}
                  onChange={e => setAssigneeSearch(e.target.value)}
                  placeholder="Buscar por nome ou email..."
                  className="input-field"
                />
                {assigneeSearch && filteredUsersForAssign.length > 0 && (
                  <div className="mt-1 max-h-28 overflow-y-auto rounded-lg border border-gray-700 bg-gray-800">
                    {filteredUsersForAssign.map(u => (
                      <button key={u.id} onClick={() => handleAssignUser(u)}
                        className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs text-gray-300 hover:bg-gray-700">
                        <UserPlus size={12} className="text-indigo-400" /> {u.email}
                      </button>
                    ))}
                  </div>
                )}
                {assignees.length > 0 && (
                  <div className="mt-2 space-y-1">
                    {assignees.map(a => (
                      <div key={a.id} className="flex items-center justify-between rounded-lg border border-gray-800 px-3 py-1.5 text-sm">
                        <span className="text-gray-300">{a.user_email}</span>
                        <button onClick={() => handleUnassignUser(a.id)} className="text-gray-500 hover:text-red-400"><X size={12} /></button>
                      </div>
                    ))}
                  </div>
                )}
              </Field>

              {/* Notes */}
              <Field label="Observações" icon={StickyNote}>
                <textarea
                  defaultValue={cardData.notes || ''}
                  onBlur={e => { if (e.target.value !== (cardData.notes || '')) updateField('notes', e.target.value); }}
                  placeholder="Anotações sobre este card..."
                  rows={3}
                  className="input-field resize-none"
                />
              </Field>

              {/* Sessions */}
              <Field label="Sessões" icon={LayoutList}>
                <p className="mb-2 text-xs text-gray-500">Organize os layouts do card</p>
                {sessions.length > 0 && (
                  <div className="mb-2 space-y-1">
                    {sessions.map(s => (
                      <div key={s.id} className="flex items-center justify-between rounded-lg border border-gray-800 px-3 py-1.5 text-sm">
                        <span className="text-gray-300">{s.name}</span>
                        <button onClick={() => handleDeleteSession(s.id)} className="text-gray-500 hover:text-red-400"><Trash2 size={12} /></button>
                      </div>
                    ))}
                  </div>
                )}
                <div className="flex items-center gap-1.5">
                  <input
                    type="text"
                    value={newSessionName}
                    onChange={e => setNewSessionName(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && handleCreateSession()}
                    placeholder="Nome da sessão"
                    className="input-field flex-1"
                  />
                  <button onClick={handleCreateSession} className="rounded-md bg-gray-700 px-3 py-2 text-xs font-medium text-gray-200 hover:bg-gray-600">
                    Nova Sessão
                  </button>
                </div>
              </Field>

              {/* Orders (expandable) */}
              <Field label={`Pedidos (${orders.length})`} icon={Receipt}>
                <div className="space-y-1">
                  {orders.slice(0, 30).map(o => (
                    <div key={o.uuid || o.short_id} className="rounded-lg border border-gray-800">
                      <button
                        onClick={() => toggleOrderExpand(o.uuid)}
                        className="flex w-full items-center justify-between px-3 py-2 text-sm hover:bg-gray-800/50"
                      >
                        <div className="flex items-center gap-2">
                          {expandedOrder === o.uuid ? <ChevronDown size={12} className="text-gray-500" /> : <ChevronRight size={12} className="text-gray-500" />}
                          <span className="font-mono text-indigo-400">#{o.short_id}</span>
                        </div>
                        <span className="text-emerald-400">R$ {Number(o.total).toFixed(2)}</span>
                      </button>
                      {expandedOrder === o.uuid && (
                        <div className="border-t border-gray-800 px-3 py-2">
                          {orderItems[o.uuid] ? (
                            orderItems[o.uuid].length > 0 ? (
                              <div className="space-y-1">
                                {orderItems[o.uuid].map(item => {
                                  const prod = products.find(p => p.id === item.product_id);
                                  return (
                                    <div key={item.id} className="flex items-center justify-between text-xs">
                                      <span className="text-gray-300">{prod ? prod.name : item.product_id}</span>
                                      <div className="flex items-center gap-3">
                                        <span className="text-gray-500">x{item.qty}</span>
                                        <span className="text-emerald-400">R$ {((prod ? prod.price : 0) * item.qty).toFixed(2)}</span>
                                      </div>
                                    </div>
                                  );
                                })}
                              </div>
                            ) : (
                              <p className="text-xs text-gray-500">Sem itens encontrados</p>
                            )
                          ) : (
                            <p className="text-xs text-gray-500">Carregando...</p>
                          )}
                        </div>
                      )}
                    </div>
                  ))}
                  {orders.length > 30 && <p className="text-xs text-gray-500">+{orders.length - 30} mais</p>}
                </div>
              </Field>
            </div>
          )}

          {/* ═══════ POS ═══════ */}
          {tab === 'pos' && (
            <div className="space-y-4">
              {isRejected && (
                <div className="flex items-center gap-2 rounded-lg bg-red-500/10 px-4 py-3 text-sm text-red-400">
                  <Lock size={16} /> Card rejeitado. Vendas bloqueadas.
                </div>
              )}

              {/* Product creation */}
              <div className="rounded-lg border border-dashed border-gray-700 p-3">
                <p className="mb-2 text-xs font-medium text-gray-400">Novo Produto</p>
                <div className="flex gap-1.5">
                  <input
                    type="text"
                    value={newProductName}
                    onChange={e => setNewProductName(e.target.value)}
                    placeholder="Nome"
                    className="input-field flex-[2]"
                  />
                  <input
                    type="number"
                    step="0.01"
                    value={newProductPrice}
                    onChange={e => setNewProductPrice(e.target.value)}
                    placeholder="Preço"
                    className="input-field flex-1"
                  />
                  <button
                    onClick={handleCreateProduct}
                    disabled={!newProductName.trim()}
                    className="rounded-md bg-emerald-600 px-3 py-2 text-xs font-medium text-white hover:bg-emerald-500 disabled:opacity-40"
                  >
                    <Plus size={14} />
                  </button>
                </div>
              </div>

              <h3 className="text-sm font-semibold text-gray-300">Produtos</h3>
              <div className="relative">
                <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
                <input
                  type="text"
                  value={productSearch}
                  onChange={e => { setProductSearch(e.target.value); setProductPage(1); }}
                  placeholder="Buscar produto..."
                  className="input-field pl-8"
                />
              </div>
              {(() => {
                const PAGE_SIZE = 12;
                const filtered = products.filter(p =>
                  p.name.toLowerCase().includes(productSearch.toLowerCase())
                );
                const visible = filtered.slice(0, productPage * PAGE_SIZE);
                const hasMore = visible.length < filtered.length;
                return (
                  <>
                    <div className="grid grid-cols-2 gap-2">
                      {visible.map(p => (
                        <button
                          key={p.id}
                          onClick={() => !isRejected && addToCart(p)}
                          disabled={isRejected}
                          className="rounded-lg border border-gray-800 bg-gray-800/50 p-3 text-left transition-all hover:border-indigo-500/50 disabled:opacity-40 disabled:cursor-not-allowed"
                        >
                          <p className="text-sm font-medium text-gray-200">{p.name}</p>
                          <p className="text-sm font-bold text-emerald-400">R$ {Number(p.price).toFixed(2)}</p>
                        </button>
                      ))}
                    </div>
                    {filtered.length === 0 && (
                      <p className="text-center text-xs text-gray-500">Nenhum produto encontrado</p>
                    )}
                    {hasMore && (
                      <button
                        onClick={() => setProductPage(prev => prev + 1)}
                        className="w-full rounded-lg border border-gray-700 py-2 text-xs font-medium text-gray-400 hover:bg-gray-800 hover:text-gray-200"
                      >
                        Mostrar mais ({filtered.length - visible.length} restantes)
                      </button>
                    )}
                  </>
                );
              })()}

              {cart.length > 0 && (
                <>
                  <h3 className="text-sm font-semibold text-gray-300">Carrinho</h3>
                  <div className="space-y-1">
                    {cart.map(item => (
                      <div key={item.product.id} className="flex items-center justify-between rounded-lg border border-gray-800 px-3 py-2 text-sm">
                        <span className="text-gray-200">{item.product.name}</span>
                        <div className="flex items-center gap-1">
                          <button onClick={() => updateQty(item.product.id, -1)} className="p-0.5 text-gray-400 hover:text-red-400"><Minus size={12} /></button>
                          <span className="w-5 text-center text-gray-200">{item.qty}</span>
                          <button onClick={() => updateQty(item.product.id, 1)} className="p-0.5 text-gray-400 hover:text-emerald-400"><PlusCircle size={12} /></button>
                        </div>
                        <span className="text-emerald-400">R$ {(item.product.price * item.qty).toFixed(2)}</span>
                      </div>
                    ))}
                  </div>
                  <div className="flex items-center justify-between border-t border-gray-800 pt-3">
                    <span className="text-sm text-gray-400">Total</span>
                    <span className="text-lg font-bold text-emerald-400">R$ {cartTotal.toFixed(2)}</span>
                  </div>
                  <div className="flex gap-2">
                    <button onClick={() => setCart([])} className="flex flex-1 items-center justify-center gap-1 rounded-lg border border-gray-700 py-2 text-xs text-gray-400 hover:text-red-400">
                      <Trash2 size={12} /> Limpar
                    </button>
                    <button onClick={handlePlaceOrder} disabled={placing} className="flex flex-[2] items-center justify-center gap-1 rounded-lg bg-emerald-600 py-2 text-sm font-semibold text-white hover:bg-emerald-500 disabled:opacity-50">
                      <Receipt size={14} /> {placing ? 'Criando...' : 'Criar Pedido'}
                    </button>
                  </div>
                </>
              )}
            </div>
          )}

          {/* ═══════ APPROVALS / APROVAÇÕES ═══════ */}
          {tab === 'approvals' && (
            <div className="space-y-4">
              {/* Add approver */}
              <Field label="Adicionar Aprovador">
                <input
                  type="text"
                  value={approverSearch}
                  onChange={e => setApproverSearch(e.target.value)}
                  placeholder="Buscar por email..."
                  className="input-field"
                />
                {approverSearch && filteredUsersForApprove.length > 0 && (
                  <div className="mt-1 max-h-28 overflow-y-auto rounded-lg border border-gray-700 bg-gray-800">
                    {filteredUsersForApprove.map(u => (
                      <button key={u.id} onClick={() => handleAddApprover(u)}
                        className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs text-gray-300 hover:bg-gray-700">
                        <UserPlus size={12} className="text-indigo-400" /> {u.email}
                      </button>
                    ))}
                  </div>
                )}
              </Field>

              {/* Current status */}
              <Field label="Status da Aprovação">
                <div className={`flex items-center gap-2 rounded-lg px-4 py-2.5 ${statusCfg.bg}`}>
                  <StatusIcon size={16} className={statusCfg.color} />
                  <span className={`text-sm font-semibold ${statusCfg.color}`}>{statusCfg.label}</span>
                  {approvers.length > 0 && (
                    <span className="ml-auto text-xs text-gray-500">
                      {approvers.filter(a => a.status === 'approved').length}/{approvers.length} aprovado(s)
                    </span>
                  )}
                </div>
              </Field>

              {/* Approvers table */}
              {approvers.length > 0 && (
                <div className="rounded-lg border border-gray-800">
                  <div className="grid grid-cols-[1fr_auto_auto] gap-2 border-b border-gray-800 px-3 py-2 text-xs font-medium text-gray-500">
                    <span>Usuário</span>
                    <span>Status</span>
                    <span>Ação</span>
                  </div>
                  {approvers.map(a => {
                    const isMe = currentUser.id === a.user_id;
                    const aCfg = STATUS_CONFIG[a.status] || STATUS_CONFIG.pending;
                    const AIcon = aCfg.icon;
                    return (
                      <div key={a.id} className="grid grid-cols-[1fr_auto_auto] items-center gap-2 border-b border-gray-800 px-3 py-2.5 last:border-b-0">
                        <div>
                          <p className="text-sm text-gray-300">{a.user_email}</p>
                          {a.decided_at && (
                            <p className="text-xs text-gray-500">
                              {new Date(a.decided_at).toLocaleString()}
                            </p>
                          )}
                        </div>
                        <span className={`flex items-center gap-1 text-xs font-medium ${aCfg.color}`}>
                          <AIcon size={12} /> {aCfg.label}
                        </span>
                        <div className="flex gap-1">
                          {isMe && a.status === 'pending' ? (
                            <>
                              <button
                                onClick={() => handleDecideApproval(a.id, 'approved')}
                                className="rounded bg-emerald-600 px-2 py-1 text-xs font-medium text-white hover:bg-emerald-500"
                              >
                                Aprovar
                              </button>
                              <button
                                onClick={() => handleDecideApproval(a.id, 'rejected')}
                                className="rounded bg-red-600 px-2 py-1 text-xs font-medium text-white hover:bg-red-500"
                              >
                                Rejeitar
                              </button>
                            </>
                          ) : (
                            <button
                              onClick={() => handleRemoveApprover(a.id)}
                              className="rounded p-1 text-gray-500 hover:text-red-400"
                              title="Remover"
                            >
                              <Trash2 size={12} />
                            </button>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}

              {approvers.length === 0 && (
                <p className="text-center text-sm text-gray-500">Nenhum aprovador adicionado.</p>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function Field({ label, icon: Icon, children }) {
  return (
    <div>
      <label className="mb-1.5 flex items-center gap-1.5 text-xs font-medium text-gray-400">
        {Icon && <Icon size={12} />}
        {label}
      </label>
      {children}
    </div>
  );
}
