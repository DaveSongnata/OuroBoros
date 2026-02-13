import { useState, useEffect, useCallback } from 'react';
import { useWorker } from '../hooks/useWorker';
import { api } from '../lib/api';
import {
  X, FileText, ShoppingCart, ShieldCheck,
  Plus, Minus, PlusCircle, Receipt, Trash2,
  CheckCircle, XCircle, Clock, Lock,
} from 'lucide-react';

const TABS = [
  { id: 'details', label: 'Details', icon: FileText },
  { id: 'pos', label: 'POS', icon: ShoppingCart },
  { id: 'approvals', label: 'Approvals', icon: ShieldCheck },
];

const STATUS_CONFIG = {
  pending: { icon: Clock, color: 'text-yellow-400', bg: 'bg-yellow-500/10', label: 'Pending' },
  approved: { icon: CheckCircle, color: 'text-emerald-400', bg: 'bg-emerald-500/10', label: 'Approved' },
  rejected: { icon: XCircle, color: 'text-red-400', bg: 'bg-red-500/10', label: 'Rejected' },
};

export default function CardDrawer({ card, onClose }) {
  const { query, optimisticWrite, onSync } = useWorker();
  const [tab, setTab] = useState('details');
  const [products, setProducts] = useState([]);
  const [cart, setCart] = useState([]);
  const [orders, setOrders] = useState([]);
  const [users, setUsers] = useState([]);
  const [placing, setPlacing] = useState(false);
  const [cardData, setCardData] = useState(card);

  const loadProducts = useCallback(async () => {
    const result = await query('products');
    setProducts(result);
  }, [query]);

  const loadOrders = useCallback(async () => {
    const result = await query('os_orders', { card_id: card.id });
    setOrders(result);
  }, [query, card.id]);

  const loadCard = useCallback(async () => {
    const result = await query('kanban_cards', { id: card.id });
    if (result.length > 0) setCardData(result[0]);
  }, [query, card.id]);

  useEffect(() => {
    loadProducts();
    loadOrders();
    // Load users for approver selection
    api.listUsers().then(setUsers).catch(() => {});
  }, [loadProducts, loadOrders]);

  useEffect(() => {
    return onSync((tables) => {
      if (tables.includes('products')) loadProducts();
      if (tables.includes('os_orders')) loadOrders();
      if (tables.includes('kanban_cards')) loadCard();
    });
  }, [onSync, loadProducts, loadOrders, loadCard]);

  const totalSales = orders.reduce((sum, o) => sum + (Number(o.total) || 0), 0);
  const isRejected = cardData.approval_status === 'rejected';

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
    if (cart.length === 0 || placing || isRejected) return;
    setPlacing(true);
    try {
      const items = cart.map(i => ({ product_id: i.product.id, qty: i.qty }));
      const order = await api.createOrder({ items, card_id: card.id, project_id: card.project_id });
      optimisticWrite('os_orders', order.uuid, order);
      setCart([]);
    } catch (err) {
      alert('Failed: ' + err.message);
    } finally {
      setPlacing(false);
    }
  }

  async function handleApproval(status) {
    try {
      const updated = await api.updateCard(card.id, { approval_status: status });
      optimisticWrite('kanban_cards', card.id, updated);
      setCardData(updated);
    } catch (err) {
      alert('Failed: ' + err.message);
    }
  }

  async function handleAssignApprover(userId) {
    try {
      const updated = await api.updateCard(card.id, { assigned_approver_id: userId });
      optimisticWrite('kanban_cards', card.id, updated);
      setCardData(updated);
    } catch (err) {
      alert('Failed: ' + err.message);
    }
  }

  const statusCfg = STATUS_CONFIG[cardData.approval_status] || STATUS_CONFIG.pending;
  const StatusIcon = statusCfg.icon;

  return (
    <div className="fixed inset-0 z-50 flex justify-end" onClick={onClose}>
      <div className="absolute inset-0 bg-black/50" />
      <div
        className="relative flex h-full w-full max-w-lg flex-col border-l border-gray-800 bg-gray-900"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-gray-800 px-6 py-4">
          <div>
            <h2 className="text-lg font-semibold text-gray-200">{cardData.title}</h2>
            <div className="mt-1 flex items-center gap-2">
              <span className={`flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${statusCfg.bg} ${statusCfg.color}`}>
                <StatusIcon size={12} /> {statusCfg.label}
              </span>
              <span className="text-xs text-gray-500">Sales: R$ {totalSales.toFixed(2)}</span>
            </div>
          </div>
          <button onClick={onClose} className="rounded-lg p-1 text-gray-400 hover:bg-gray-800">
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
        <div className="flex-1 overflow-y-auto p-6">
          {tab === 'details' && (
            <div className="space-y-4">
              <div>
                <label className="text-xs font-medium text-gray-400">Card ID</label>
                <p className="mt-1 font-mono text-sm text-gray-300">{cardData.id}</p>
              </div>
              <div>
                <label className="text-xs font-medium text-gray-400">Column</label>
                <p className="mt-1 text-sm text-gray-300">{cardData.column_name}</p>
              </div>
              <div>
                <label className="text-xs font-medium text-gray-400">Total Sales</label>
                <p className="mt-1 text-xl font-bold text-emerald-400">R$ {totalSales.toFixed(2)}</p>
              </div>
              <div>
                <label className="text-xs font-medium text-gray-400">Orders ({orders.length})</label>
                <div className="mt-2 space-y-1">
                  {orders.slice(0, 20).map(o => (
                    <div key={o.uuid || o.short_id} className="flex justify-between rounded border border-gray-800 px-3 py-1.5 text-sm">
                      <span className="font-mono text-indigo-400">#{o.short_id}</span>
                      <span className="text-emerald-400">R$ {Number(o.total).toFixed(2)}</span>
                    </div>
                  ))}
                  {orders.length > 20 && <p className="text-xs text-gray-500">+{orders.length - 20} more</p>}
                </div>
              </div>
            </div>
          )}

          {tab === 'pos' && (
            <div className="space-y-4">
              {isRejected && (
                <div className="flex items-center gap-2 rounded-lg bg-red-500/10 px-4 py-3 text-sm text-red-400">
                  <Lock size={16} /> This card is rejected. Sales are locked.
                </div>
              )}

              <h3 className="text-sm font-semibold text-gray-300">Products</h3>
              <div className="grid grid-cols-2 gap-2">
                {products.map(p => (
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

              {cart.length > 0 && (
                <>
                  <h3 className="text-sm font-semibold text-gray-300">Cart</h3>
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
                      <Trash2 size={12} /> Clear
                    </button>
                    <button onClick={handlePlaceOrder} disabled={placing} className="flex flex-[2] items-center justify-center gap-1 rounded-lg bg-emerald-600 py-2 text-sm font-semibold text-white hover:bg-emerald-500 disabled:opacity-50">
                      <Receipt size={14} /> {placing ? 'Placing...' : 'Place Order'}
                    </button>
                  </div>
                </>
              )}
            </div>
          )}

          {tab === 'approvals' && (
            <div className="space-y-4">
              <div>
                <label className="mb-2 block text-xs font-medium text-gray-400">Assign Approver</label>
                <select
                  value={cardData.assigned_approver_id || ''}
                  onChange={e => handleAssignApprover(e.target.value)}
                  className="w-full rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-gray-200 focus:border-indigo-500 focus:outline-none"
                >
                  <option value="">None</option>
                  {users.map(u => (
                    <option key={u.id} value={u.id}>{u.email}</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="mb-2 block text-xs font-medium text-gray-400">Current Status</label>
                <div className={`flex items-center gap-2 rounded-lg px-4 py-3 ${statusCfg.bg}`}>
                  <StatusIcon size={18} className={statusCfg.color} />
                  <span className={`font-semibold ${statusCfg.color}`}>{statusCfg.label}</span>
                </div>
              </div>

              <div>
                <label className="mb-2 block text-xs font-medium text-gray-400">Actions</label>
                <div className="flex gap-2">
                  <button
                    onClick={() => handleApproval('approved')}
                    disabled={cardData.approval_status === 'approved'}
                    className="flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-emerald-600 py-2.5 text-sm font-semibold text-white hover:bg-emerald-500 disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    <CheckCircle size={16} /> Approve
                  </button>
                  <button
                    onClick={() => handleApproval('rejected')}
                    disabled={cardData.approval_status === 'rejected'}
                    className="flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-red-600 py-2.5 text-sm font-semibold text-white hover:bg-red-500 disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    <XCircle size={16} /> Reject
                  </button>
                  <button
                    onClick={() => handleApproval('pending')}
                    disabled={cardData.approval_status === 'pending'}
                    className="flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-gray-700 py-2.5 text-sm font-semibold text-white hover:bg-gray-600 disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    <Clock size={16} /> Reset
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
