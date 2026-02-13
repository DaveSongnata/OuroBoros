import { useState, useEffect, useCallback } from 'react';
import { useWorker } from '../hooks/useWorker';
import { api } from '../lib/api';
import {
  Plus,
  Trash2,
  ShoppingBag,
  Package,
  Receipt,
  Minus,
  PlusCircle,
} from 'lucide-react';

export default function POSModule() {
  const { query, optimisticWrite, onSync, ready } = useWorker();
  const [products, setProducts] = useState([]);
  const [orders, setOrders] = useState([]);
  const [cart, setCart] = useState([]);
  const [newName, setNewName] = useState('');
  const [newPrice, setNewPrice] = useState('');
  const [placing, setPlacing] = useState(false);

  const loadProducts = useCallback(async () => {
    if (!ready) return;
    const result = await query('products');
    setProducts(result);
  }, [query, ready]);

  const loadOrders = useCallback(async () => {
    if (!ready) return;
    const result = await query('os_orders');
    setOrders(result);
  }, [query, ready]);

  useEffect(() => { loadProducts(); }, [loadProducts]);
  useEffect(() => { loadOrders(); }, [loadOrders]);

  useEffect(() => {
    return onSync((tables) => {
      if (tables.includes('products')) loadProducts();
      if (tables.includes('os_orders')) loadOrders();
    });
  }, [onSync, loadProducts, loadOrders]);

  async function handleAddProduct(e) {
    e.preventDefault();
    const name = newName.trim();
    const price = parseFloat(newPrice);
    if (!name || isNaN(price) || price < 0) return;
    try {
      const p = await api.createProduct({ name, price });
      optimisticWrite('products', p.id, p);
      setNewName('');
      setNewPrice('');
    } catch (err) {
      console.error('Failed to create product:', err);
    }
  }

  function addToCart(product) {
    setCart((prev) => {
      const existing = prev.find((i) => i.product.id === product.id);
      if (existing) {
        return prev.map((i) =>
          i.product.id === product.id ? { ...i, qty: i.qty + 1 } : i
        );
      }
      return [...prev, { product, qty: 1 }];
    });
  }

  function updateQty(productId, delta) {
    setCart((prev) =>
      prev
        .map((i) =>
          i.product.id === productId ? { ...i, qty: i.qty + delta } : i
        )
        .filter((i) => i.qty > 0)
    );
  }

  const cartTotal = cart.reduce((sum, i) => sum + i.product.price * i.qty, 0);

  async function handlePlaceOrder() {
    if (cart.length === 0 || placing) return;
    setPlacing(true);
    try {
      const items = cart.map((i) => ({ product_id: i.product.id, qty: i.qty }));
      const order = await api.createOrder({ items });
      optimisticWrite('os_orders', order.uuid, order);
      setCart([]);
    } catch (err) {
      console.error('Failed to place order:', err);
    } finally {
      setPlacing(false);
    }
  }

  return (
    <div className="flex h-full flex-col overflow-hidden lg:flex-row">
      {/* Left: Products */}
      <div className="flex flex-1 flex-col overflow-y-auto border-r border-gray-800 p-6">
        {/* Add product form */}
        <form onSubmit={handleAddProduct} className="mb-6 flex items-center gap-2">
          <input
            type="text"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="Product name"
            className="flex-1 rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-gray-200 placeholder-gray-500 focus:border-indigo-500 focus:outline-none"
          />
          <input
            type="number"
            step="0.01"
            min="0"
            value={newPrice}
            onChange={(e) => setNewPrice(e.target.value)}
            placeholder="Price"
            className="w-28 rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-gray-200 placeholder-gray-500 focus:border-indigo-500 focus:outline-none"
          />
          <button
            type="submit"
            className="flex items-center gap-1.5 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-indigo-500"
          >
            <Plus size={14} />
            Product
          </button>
        </form>

        <h2 className="mb-4 flex items-center gap-2 text-sm font-semibold text-gray-300">
          <Package size={16} />
          Products
        </h2>

        {products.length === 0 ? (
          <p className="text-sm text-gray-500">No products yet. Add one above.</p>
        ) : (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-4">
            {products.map((p) => (
              <button
                key={p.id}
                onClick={() => addToCart(p)}
                className="group rounded-xl border border-gray-800 bg-gray-900 p-4 text-left transition-all hover:border-indigo-500/50 hover:-translate-y-0.5 hover:shadow-lg hover:shadow-indigo-500/5"
              >
                <p className="text-sm font-semibold text-gray-200 group-hover:text-white">
                  {p.name}
                </p>
                <p className="mt-1 text-lg font-bold text-emerald-400">
                  R$ {Number(p.price).toFixed(2)}
                </p>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Right: Cart + Orders */}
      <div className="flex w-full flex-col lg:w-96">
        {/* Cart */}
        <div className="flex flex-1 flex-col border-b border-gray-800 p-6">
          <h2 className="mb-4 flex items-center gap-2 text-sm font-semibold text-gray-300">
            <ShoppingBag size={16} />
            Current Order
          </h2>

          {cart.length === 0 ? (
            <p className="flex-1 text-sm text-gray-500">
              Click a product to add it to the order.
            </p>
          ) : (
            <div className="flex-1 space-y-2 overflow-y-auto">
              {cart.map((item) => (
                <div
                  key={item.product.id}
                  className="flex items-center justify-between rounded-lg border border-gray-800 bg-gray-900 px-3 py-2"
                >
                  <div className="flex-1">
                    <p className="text-sm text-gray-200">{item.product.name}</p>
                    <p className="text-xs text-gray-500">
                      R$ {Number(item.product.price).toFixed(2)} x {item.qty}
                    </p>
                  </div>
                  <div className="flex items-center gap-1">
                    <button
                      onClick={() => updateQty(item.product.id, -1)}
                      className="rounded p-1 text-gray-400 hover:bg-gray-800 hover:text-red-400"
                    >
                      <Minus size={14} />
                    </button>
                    <span className="w-6 text-center text-sm font-medium text-gray-200">
                      {item.qty}
                    </span>
                    <button
                      onClick={() => updateQty(item.product.id, 1)}
                      className="rounded p-1 text-gray-400 hover:bg-gray-800 hover:text-emerald-400"
                    >
                      <PlusCircle size={14} />
                    </button>
                  </div>
                  <span className="ml-3 text-sm font-semibold text-emerald-400">
                    R$ {(item.product.price * item.qty).toFixed(2)}
                  </span>
                </div>
              ))}
            </div>
          )}

          {/* Total + Actions */}
          <div className="mt-4 border-t border-gray-800 pt-4">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium text-gray-400">Total</span>
              <span className="text-xl font-bold text-emerald-400">
                R$ {cartTotal.toFixed(2)}
              </span>
            </div>
            <div className="mt-3 flex gap-2">
              <button
                onClick={() => setCart([])}
                disabled={cart.length === 0}
                className="flex flex-1 items-center justify-center gap-1.5 rounded-lg border border-gray-700 bg-gray-800 py-2 text-sm text-gray-300 transition-colors hover:border-red-500 hover:text-red-400 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                <Trash2 size={14} />
                Clear
              </button>
              <button
                onClick={handlePlaceOrder}
                disabled={cart.length === 0 || placing}
                className="flex flex-[2] items-center justify-center gap-1.5 rounded-lg bg-emerald-600 py-2 text-sm font-semibold text-white transition-colors hover:bg-emerald-500 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                <Receipt size={14} />
                {placing ? 'Placing...' : 'Place Order'}
              </button>
            </div>
          </div>
        </div>

        {/* Recent orders */}
        <div className="overflow-y-auto p-6">
          <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold text-gray-300">
            <Receipt size={16} />
            Recent Orders
          </h2>
          {orders.length === 0 ? (
            <p className="text-sm text-gray-500">No orders yet.</p>
          ) : (
            <div className="space-y-2">
              {orders.map((o) => (
                <div
                  key={o.uuid || o.short_id}
                  className="flex items-center justify-between rounded-lg border border-gray-800 bg-gray-900 px-4 py-2.5"
                >
                  <span className="font-mono text-sm font-semibold text-indigo-400">
                    #{o.short_id}
                  </span>
                  <span className="text-sm font-bold text-emerald-400">
                    R$ {Number(o.total).toFixed(2)}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
