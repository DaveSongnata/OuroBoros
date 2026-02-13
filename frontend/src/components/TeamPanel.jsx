import { useState, useEffect } from 'react';
import { api } from '../lib/api';
import { X, UserPlus, Users, Loader2 } from 'lucide-react';

export default function TeamPanel({ onClose }) {
  const [users, setUsers] = useState([]);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  useEffect(() => {
    api.listUsers().then(setUsers).catch(() => {});
  }, []);

  async function handleInvite(e) {
    e.preventDefault();
    if (!email.trim() || !password.trim()) return;
    setError('');
    setSuccess('');
    setLoading(true);
    try {
      const user = await api.inviteUser(email.trim(), password.trim());
      setUsers(prev => [...prev, user]);
      setEmail('');
      setPassword('');
      setSuccess(`Invited ${user.email}`);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center pt-20" onClick={onClose}>
      <div className="absolute inset-0 bg-black/50" />
      <div
        className="relative w-full max-w-md rounded-xl border border-gray-800 bg-gray-900 shadow-2xl"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-gray-800 px-6 py-4">
          <div className="flex items-center gap-2">
            <Users size={18} className="text-indigo-400" />
            <h2 className="text-lg font-semibold text-gray-200">Team</h2>
          </div>
          <button onClick={onClose} className="rounded-lg p-1 text-gray-400 hover:bg-gray-800">
            <X size={18} />
          </button>
        </div>

        <div className="p-6 space-y-4">
          {/* Invite form */}
          <form onSubmit={handleInvite} className="space-y-3">
            <h3 className="text-sm font-medium text-gray-400">Invite User</h3>
            {error && <div className="rounded-lg bg-red-500/10 px-3 py-2 text-xs text-red-400">{error}</div>}
            {success && <div className="rounded-lg bg-emerald-500/10 px-3 py-2 text-xs text-emerald-400">{success}</div>}
            <input
              type="email" required value={email}
              onChange={e => setEmail(e.target.value)}
              placeholder="user@company.com"
              className="w-full rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-gray-200 placeholder-gray-500 focus:border-indigo-500 focus:outline-none"
            />
            <input
              type="password" required minLength={6} value={password}
              onChange={e => setPassword(e.target.value)}
              placeholder="Temporary password (min 6)"
              className="w-full rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-gray-200 placeholder-gray-500 focus:border-indigo-500 focus:outline-none"
            />
            <button
              type="submit" disabled={loading}
              className="flex w-full items-center justify-center gap-2 rounded-lg bg-indigo-600 py-2 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-50"
            >
              {loading ? <Loader2 size={14} className="animate-spin" /> : <UserPlus size={14} />}
              Invite
            </button>
          </form>

          {/* Users list */}
          <div>
            <h3 className="text-sm font-medium text-gray-400 mb-2">Members</h3>
            <div className="space-y-1 max-h-48 overflow-y-auto">
              {users.map(u => (
                <div key={u.id} className="flex items-center gap-3 rounded-lg border border-gray-800 px-3 py-2">
                  <div className="flex h-7 w-7 items-center justify-center rounded-full bg-indigo-500/20 text-xs font-bold text-indigo-400">
                    {u.email[0].toUpperCase()}
                  </div>
                  <span className="text-sm text-gray-300">{u.email}</span>
                </div>
              ))}
              {users.length === 0 && (
                <p className="text-xs text-gray-500">No team members yet.</p>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
