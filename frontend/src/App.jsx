import { useState, useEffect } from 'react';
import { useWorker } from './hooks/useWorker';
import { setToken } from './lib/api';
import LoginScreen from './components/LoginScreen';
import KanbanBoard from './components/KanbanBoard';
import TeamPanel from './components/TeamPanel';
import {
  Wifi,
  WifiOff,
  Loader2,
  LogOut,
  Users,
} from 'lucide-react';

export default function App() {
  const { syncStatus, version, ready, startWorker } = useWorker();
  const [authed, setAuthed] = useState(false);
  const [userEmail, setUserEmail] = useState('');
  const [showTeam, setShowTeam] = useState(false);

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
      <header className="flex flex-wrap items-center justify-between gap-2 border-b border-gray-800 bg-gray-900 px-4 py-2 sm:px-6 sm:py-3">
        <div className="flex items-center gap-3">
          <h1 className="text-base font-bold tracking-tight text-indigo-400 sm:text-lg">
            OuroBoros
          </h1>
          <StatusBadge status={syncStatus} />
        </div>
        <div className="flex items-center gap-2 sm:gap-4">
          <span className="hidden font-mono text-xs text-gray-500 sm:inline">v{version}</span>
          {userEmail && (
            <span className="hidden text-xs text-gray-500 md:inline">{userEmail}</span>
          )}
          <button
            onClick={() => setShowTeam(true)}
            className="flex items-center gap-1.5 rounded-lg border border-gray-700 px-2.5 py-1.5 text-xs text-gray-400 transition-colors hover:border-indigo-500 hover:text-indigo-400"
          >
            <Users size={14} />
            <span className="hidden sm:inline">Team</span>
          </button>
          <button
            onClick={handleLogout}
            className="flex items-center gap-1.5 rounded-lg border border-gray-700 px-2.5 py-1.5 text-xs text-gray-400 transition-colors hover:border-red-500 hover:text-red-400"
          >
            <LogOut size={14} />
            <span className="hidden sm:inline">Logout</span>
          </button>
        </div>
      </header>

      {/* Content */}
      <main className="flex-1 overflow-hidden">
        {!ready ? (
          <div className="flex h-full items-center justify-center text-gray-500">
            <Loader2 className="mr-2 animate-spin" size={20} />
            Initializing local database...
          </div>
        ) : (
          <KanbanBoard />
        )}
      </main>

      {showTeam && <TeamPanel onClose={() => setShowTeam(false)} />}
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
