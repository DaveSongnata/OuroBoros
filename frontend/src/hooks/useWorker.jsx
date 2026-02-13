import { createContext, useContext, useEffect, useRef, useState, useCallback } from 'react';
import { fetchToken, getToken, setToken } from '../lib/api';

const WorkerContext = createContext(null);

export function WorkerProvider({ children }) {
  const workerRef = useRef(null);
  const callbacksRef = useRef({});
  const listenersRef = useRef(new Set());
  const queryIdRef = useRef(0);
  const [syncStatus, setSyncStatus] = useState('connecting');
  const [version, setVersion] = useState(0);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    async function boot() {
      const tenantId = localStorage.getItem('ouroboros_tenant') || 'demo';
      let token = localStorage.getItem('ouroboros_token');

      if (!token) {
        try {
          token = await fetchToken(tenantId);
          localStorage.setItem('ouroboros_token', token);
          localStorage.setItem('ouroboros_tenant', tenantId);
        } catch {
          setSyncStatus('offline');
          return;
        }
      } else {
        setToken(token);
      }

      const w = new Worker('/worker.js');
      workerRef.current = w;

      w.onmessage = (e) => {
        const msg = e.data;
        switch (msg.type) {
          case 'db-ready':
            setSyncStatus('syncing');
            break;

          case 'sync-status':
            setSyncStatus(msg.status === 'online' ? 'online' : 'offline');
            break;

          case 'sync-complete':
            setVersion(msg.version);
            // Notify all subscribers
            for (const fn of listenersRef.current) {
              fn(msg.tables);
            }
            break;

          case 'query-result': {
            const cb = callbacksRef.current[msg.id];
            if (cb) {
              cb(msg.result);
              delete callbacksRef.current[msg.id];
            }
            break;
          }
        }
      };

      w.postMessage({ type: 'init', token, apiBase: '' });
      setReady(true);
    }

    boot();

    return () => {
      workerRef.current?.terminate();
    };
  }, []);

  const query = useCallback((table, filter) => {
    return new Promise((resolve) => {
      const id = ++queryIdRef.current;
      callbacksRef.current[id] = resolve;
      workerRef.current?.postMessage({ type: 'query', id, query: { table, filter } });
    });
  }, []);

  const optimisticWrite = useCallback((table, id, payload) => {
    workerRef.current?.postMessage({
      type: 'optimistic-write',
      data: { table, id, payload },
    });
  }, []);

  const forceSync = useCallback(() => {
    workerRef.current?.postMessage({ type: 'force-sync' });
  }, []);

  const onSync = useCallback((fn) => {
    listenersRef.current.add(fn);
    return () => listenersRef.current.delete(fn);
  }, []);

  const value = {
    query,
    optimisticWrite,
    forceSync,
    onSync,
    syncStatus,
    version,
    ready,
  };

  return <WorkerContext.Provider value={value}>{children}</WorkerContext.Provider>;
}

export function useWorker() {
  const ctx = useContext(WorkerContext);
  if (!ctx) throw new Error('useWorker must be used within WorkerProvider');
  return ctx;
}
