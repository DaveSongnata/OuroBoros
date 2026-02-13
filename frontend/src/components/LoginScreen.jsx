import { useState } from 'react';
import { api } from '../lib/api';
import { LogIn, UserPlus, Loader2 } from 'lucide-react';

export default function LoginScreen({ onAuth }) {
  const [isRegister, setIsRegister] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [tenantId, setTenantId] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      let result;
      if (isRegister) {
        result = await api.register(email, password, tenantId || undefined);
      } else {
        result = await api.login(email, password);
      }
      // Store auth data
      localStorage.setItem('ouroboros_token', result.token);
      localStorage.setItem('ouroboros_tenant', result.tenant_id);
      localStorage.setItem('ouroboros_user', JSON.stringify(result.user));
      onAuth(result);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-950 p-4">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <h1 className="text-3xl font-bold text-indigo-400">OuroBoros</h1>
          <p className="mt-2 text-sm text-gray-500">Local-First Kanban & POS</p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4 rounded-xl border border-gray-800 bg-gray-900 p-6">
          <h2 className="text-lg font-semibold text-gray-200">
            {isRegister ? 'Create Account' : 'Sign In'}
          </h2>

          {error && (
            <div className="rounded-lg bg-red-500/10 px-3 py-2 text-sm text-red-400">
              {error}
            </div>
          )}

          <div>
            <label className="mb-1 block text-xs font-medium text-gray-400">Email</label>
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-gray-200 placeholder-gray-500 focus:border-indigo-500 focus:outline-none"
              placeholder="you@company.com"
            />
          </div>

          <div>
            <label className="mb-1 block text-xs font-medium text-gray-400">Password</label>
            <input
              type="password"
              required
              minLength={6}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-gray-200 placeholder-gray-500 focus:border-indigo-500 focus:outline-none"
              placeholder="Min 6 characters"
            />
          </div>

          {isRegister && (
            <div>
              <label className="mb-1 block text-xs font-medium text-gray-400">
                Tenant ID <span className="text-gray-600">(optional)</span>
              </label>
              <input
                type="text"
                value={tenantId}
                onChange={(e) => setTenantId(e.target.value)}
                className="w-full rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-gray-200 placeholder-gray-500 focus:border-indigo-500 focus:outline-none"
                placeholder="Auto-generated from email if empty"
              />
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            className="flex w-full items-center justify-center gap-2 rounded-lg bg-indigo-600 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-indigo-500 disabled:opacity-50"
          >
            {loading ? (
              <Loader2 size={16} className="animate-spin" />
            ) : isRegister ? (
              <UserPlus size={16} />
            ) : (
              <LogIn size={16} />
            )}
            {isRegister ? 'Register' : 'Sign In'}
          </button>

          <button
            type="button"
            onClick={() => { setIsRegister(!isRegister); setError(''); }}
            className="w-full text-center text-xs text-gray-500 hover:text-indigo-400"
          >
            {isRegister ? 'Already have an account? Sign in' : "Don't have an account? Register"}
          </button>
        </form>
      </div>
    </div>
  );
}
