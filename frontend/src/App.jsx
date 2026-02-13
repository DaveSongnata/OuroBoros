import { useState, useEffect } from 'react';
import { useWorker } from './hooks/useWorker';
import { setToken } from './lib/api';
import LoginScreen from './components/LoginScreen';
import KanbanBoard from './components/KanbanBoard';
import POSModule from './components/POSModule';
import {
  LayoutDashboard,
  ShoppingCart,
  Wifi,
  WifiOff,
  Loader2,
  LogOut,
} from 'lucide-react';

const TABS = [
  { id: 'kanban', label: 'Kanban', icon: LayoutDashboard },
  { id: 'pos', label: 'POS', icon: ShoppingCart },
];

export default function App() {
  const [activeTab, setActiveTab] = useState('kanban');
  const { syncStatus, version, ready, startWorker } = useWorker();
  const [authed, setAuthed] = useState(false);
  const [userEmail, setUserEmail] = useState('');

  // On mount, check localStorage for existing session
  useEffect(() => {
    const savedToken = localStorage.getItem('ouroboros_token');
    if (savedToken) {
      setToken(savedToken);
      startWorker(savedToken);
      setAuthed(true);
      try {
        const user = JSON.parse(localStorage.getItem('ouroboros_user') || '{}');
        setUserEmail(user.email || '');
      } catch { /* ignore */ }
    }
  }, [startWorker]);

  function handleAuth(result) {
    setToken(result.token);
    startWorker(result.token);
    setAuthed(true);
    setUserEmail(result.user?.email || '');
  }

  function handleLogout() {
    localStorage.removeItem('ouroboros_token');
    localStorage.removeItem('ouroboros_tenant');
    localStorage.removeItem('ouroboros_user');
    setToken(null);
    setAuthed(false);
    setUserEmail('');
  }

  if (!authed) {
    return <LoginScreen onAuth={handleAuth} />;
  }

  return (
    <div className="flex h-screen flex-col bg-gray-950">
      {/* Header */}
      <header className="flex items-center justify-between border-b border-gray-800 bg-gray-900 px-6 py-3">
        <div className="flex items-center gap-4">
          <h1 className="text-lg font-bold tracking-tight text-indigo-400">
            OuroBoros
          </h1>
          <StatusBadge status={syncStatus} />
        </div>
        <div className="flex items-center gap-4">
          <span className="font-mono text-xs text-gray-500">v{version}</span>
          {userEmail && (
            <span className="text-xs text-gray-500">{userEmail}</span>
          )}
          <button
            onClick={handleLogout}
            className="flex items-center gap-1.5 rounded-lg border border-gray-700 px-2.5 py-1 text-xs text-gray-400 transition-colors hover:border-red-500 hover:text-red-400"
          >
            <LogOut size={12} />
            Logout
          </button>
        </div>
      </header>

      {/* Tab bar */}
      <nav className="flex gap-1 border-b border-gray-800 bg-gray-900/50 px-6">
        {TABS.map((tab) => {
          const Icon = tab.icon;
          const isActive = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`flex items-center gap-2 border-b-2 px-4 py-2.5 text-sm font-medium transition-colors ${
                isActive
                  ? 'border-indigo-500 text-indigo-400'
                  : 'border-transparent text-gray-400 hover:text-gray-200'
              }`}
            >
              <Icon size={16} />
              {tab.label}
            </button>
          );
        })}
      </nav>

      {/* Content */}
      <main className="flex-1 overflow-hidden">
        {!ready ? (
          <div className="flex h-full items-center justify-center text-gray-500">
            <Loader2 className="mr-2 animate-spin" size={20} />
            Initializing local database...
          </div>
        ) : activeTab === 'kanban' ? (
          <KanbanBoard />
        ) : (
          <POSModule />
        )}
      </main>
    </div>
  );
}

function StatusBadge({ status }) {
  if (status === 'online') {
    return (
      <span className="flex items-center gap-1.5 rounded-full bg-emerald-500/10 px-2.5 py-0.5 text-xs font-medium text-emerald-400">
        <Wifi size={12} />
        Online
      </span>
    );
  }
  if (status === 'offline') {
    return (
      <span className="flex items-center gap-1.5 rounded-full bg-red-500/10 px-2.5 py-0.5 text-xs font-medium text-red-400">
        <WifiOff size={12} />
        Offline
      </span>
    );
  }
  return (
    <span className="flex items-center gap-1.5 rounded-full bg-yellow-500/10 px-2.5 py-0.5 text-xs font-medium text-yellow-400">
      <Loader2 size={12} className="animate-spin" />
      {status === 'syncing' ? 'Syncing' : 'Connecting'}
    </span>
  );
}
