import { useState, useEffect, useCallback } from 'react';
import { DragDropContext, Droppable, Draggable } from '@hello-pangea/dnd';
import { useWorker } from '../hooks/useWorker';
import { api } from '../lib/api';
import CardDrawer from './CardDrawer';
import {
  Plus, GripVertical, FolderPlus,
  CheckCircle, XCircle, Clock, DollarSign,
  Pencil, Trash2, X, Check,
} from 'lucide-react';

const COLOR_OPTIONS = [
  'bg-gray-500', 'bg-blue-500', 'bg-amber-500', 'bg-purple-500',
  'bg-emerald-500', 'bg-red-500', 'bg-indigo-500', 'bg-pink-500', 'bg-cyan-500',
];

const APPROVAL_ICON = {
  pending: { icon: Clock, color: 'text-yellow-400' },
  approved: { icon: CheckCircle, color: 'text-emerald-400' },
  rejected: { icon: XCircle, color: 'text-red-400' },
};

export default function KanbanBoard() {
  const { query, optimisticWrite, onSync, ready } = useWorker();
  const [projects, setProjects] = useState([]);
  const [columns, setColumns] = useState([]);
  const [cards, setCards] = useState([]);
  const [salesTotals, setSalesTotals] = useState({});
  const [currentProject, setCurrentProject] = useState(null);
  const [newProjectName, setNewProjectName] = useState('');
  const [addingCardCol, setAddingCardCol] = useState(null);
  const [newCardTitle, setNewCardTitle] = useState('');
  const [selectedCard, setSelectedCard] = useState(null);
  // Column management
  const [addingColumn, setAddingColumn] = useState(false);
  const [newColName, setNewColName] = useState('');
  const [newColColor, setNewColColor] = useState('bg-blue-500');
  const [editingCol, setEditingCol] = useState(null);
  const [editColName, setEditColName] = useState('');
  const [editColColor, setEditColColor] = useState('');

  const loadProjects = useCallback(async () => {
    if (!ready) return;
    const result = await query('projects');
    setProjects(result);
    if (!currentProject && result.length > 0) {
      setCurrentProject(result[0].id);
    }
  }, [query, ready, currentProject]);

  const loadColumns = useCallback(async () => {
    if (!ready || !currentProject) return;
    const result = await query('kanban_columns', { project_id: currentProject });
    setColumns(result);
  }, [query, ready, currentProject]);

  const loadCards = useCallback(async () => {
    if (!ready || !currentProject) return;
    const result = await query('kanban_cards', { project_id: currentProject });
    setCards(result);
  }, [query, ready, currentProject]);

  const loadSalesTotals = useCallback(async () => {
    if (!ready) return;
    try {
      const result = await query(null, null,
        "SELECT card_id, SUM(total) as total_sales, COUNT(*) as order_count FROM os_orders WHERE card_id IS NOT NULL GROUP BY card_id"
      );
      const map = {};
      for (const row of result) {
        map[row.card_id] = { total: row.total_sales || 0, count: row.order_count || 0 };
      }
      setSalesTotals(map);
    } catch { /* table may be empty */ }
  }, [query, ready]);

  useEffect(() => { loadProjects(); }, [loadProjects]);
  useEffect(() => { loadColumns(); }, [loadColumns]);
  useEffect(() => { loadCards(); }, [loadCards]);
  useEffect(() => { loadSalesTotals(); }, [loadSalesTotals]);

  useEffect(() => {
    return onSync((tables) => {
      if (tables.includes('projects')) loadProjects();
      if (tables.includes('kanban_columns')) loadColumns();
      if (tables.includes('kanban_cards')) loadCards();
      if (tables.includes('os_orders')) loadSalesTotals();
    });
  }, [onSync, loadProjects, loadColumns, loadCards, loadSalesTotals]);

  async function handleCreateProject(e) {
    e.preventDefault();
    if (!newProjectName.trim()) return;
    try {
      const p = await api.createProject(newProjectName.trim());
      optimisticWrite('projects', p.id, p);
      setCurrentProject(p.id);
      setNewProjectName('');
      // Create default columns
      const defaults = [
        { name: 'Backlog', color: 'bg-gray-500', position: 0 },
        { name: 'To Do', color: 'bg-blue-500', position: 1 },
        { name: 'In Progress', color: 'bg-amber-500', position: 2 },
        { name: 'Done', color: 'bg-emerald-500', position: 3 },
      ];
      for (const col of defaults) {
        const c = await api.createColumn({ project_id: p.id, ...col });
        optimisticWrite('kanban_columns', c.id, c);
      }
    } catch (err) {
      console.error('Failed to create project:', err);
    }
  }

  async function handleCreateCard(e) {
    e.preventDefault();
    if (!newCardTitle.trim() || !addingCardCol) return;
    try {
      const c = await api.createCard({
        project_id: currentProject,
        column_name: addingCardCol,
        title: newCardTitle.trim(),
      });
      optimisticWrite('kanban_cards', c.id, c);
      setNewCardTitle('');
      setAddingCardCol(null);
    } catch (err) {
      console.error('Failed to create card:', err);
    }
  }

  async function handleCreateColumn(e) {
    e.preventDefault();
    if (!newColName.trim()) return;
    try {
      const c = await api.createColumn({
        project_id: currentProject,
        name: newColName.trim(),
        color: newColColor,
        position: columns.length,
      });
      optimisticWrite('kanban_columns', c.id, c);
      setNewColName('');
      setNewColColor('bg-blue-500');
      setAddingColumn(false);
    } catch (err) {
      console.error('Failed to create column:', err);
    }
  }

  async function handleUpdateColumn(colId) {
    if (!editColName.trim()) return;
    try {
      const c = await api.updateColumn(colId, { name: editColName.trim(), color: editColColor });
      optimisticWrite('kanban_columns', c.id, c);
      setEditingCol(null);
    } catch (err) {
      console.error('Failed to update column:', err);
    }
  }

  async function handleDeleteColumn(colId) {
    try {
      await api.deleteColumn(colId);
      setColumns(prev => prev.filter(c => c.id !== colId));
    } catch (err) {
      console.error('Failed to delete column:', err);
    }
  }

  async function handleDragEnd(result) {
    const { draggableId, destination, source } = result;
    if (!destination) return;
    if (destination.droppableId === source.droppableId && destination.index === source.index) return;

    const newColumn = destination.droppableId;
    const cardId = draggableId;

    setCards(prev => prev.map(c =>
      c.id === cardId ? { ...c, column_name: newColumn, position: destination.index } : c
    ));

    const card = cards.find(c => c.id === cardId);
    if (card) {
      optimisticWrite('kanban_cards', cardId, { ...card, column_name: newColumn, position: destination.index });
    }

    try {
      await api.updateCard(cardId, { column_name: newColumn, position: destination.index });
    } catch {
      loadCards();
    }
  }

  const cardsByColumn = {};
  for (const col of columns) {
    cardsByColumn[col.id] = cards.filter(c => c.column_name === col.id);
  }

  return (
    <div className="flex h-full flex-col">
      {/* Project selector */}
      <div className="flex items-center gap-3 border-b border-gray-800 bg-gray-900/30 px-6 py-3">
        <select
          value={currentProject || ''}
          onChange={e => setCurrentProject(e.target.value)}
          className="rounded-lg border border-gray-700 bg-gray-800 px-3 py-1.5 text-sm text-gray-200 focus:border-indigo-500 focus:outline-none"
        >
          <option value="" disabled>Select project...</option>
          {projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
        <form onSubmit={handleCreateProject} className="flex items-center gap-2">
          <input
            type="text" value={newProjectName}
            onChange={e => setNewProjectName(e.target.value)}
            placeholder="New project name"
            className="rounded-lg border border-gray-700 bg-gray-800 px-3 py-1.5 text-sm text-gray-200 placeholder-gray-500 focus:border-indigo-500 focus:outline-none"
          />
          <button type="submit" className="flex items-center gap-1.5 rounded-lg bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-500">
            <FolderPlus size={14} /> Project
          </button>
        </form>
      </div>

      {!currentProject ? (
        <div className="flex flex-1 items-center justify-center text-gray-500">
          Select or create a project to see the board.
        </div>
      ) : (
        <DragDropContext onDragEnd={handleDragEnd}>
          <div className="kanban-scroll flex flex-1 gap-4 overflow-x-auto p-6">
            {columns.map(col => (
              <div key={col.id} className="flex w-72 shrink-0 flex-col rounded-xl border border-gray-800 bg-gray-900">
                {/* Column header */}
                {editingCol === col.id ? (
                  <div className="border-b border-gray-800 px-3 py-2 space-y-2">
                    <input
                      autoFocus
                      value={editColName}
                      onChange={e => setEditColName(e.target.value)}
                      onKeyDown={e => { if (e.key === 'Escape') setEditingCol(null); }}
                      className="w-full rounded border border-gray-700 bg-gray-800 px-2 py-1 text-sm text-gray-200 focus:border-indigo-500 focus:outline-none"
                    />
                    <div className="flex flex-wrap gap-1">
                      {COLOR_OPTIONS.map(c => (
                        <button
                          key={c} type="button"
                          onClick={() => setEditColColor(c)}
                          className={`h-5 w-5 rounded-full ${c} ${editColColor === c ? 'ring-2 ring-white ring-offset-1 ring-offset-gray-900' : ''}`}
                        />
                      ))}
                    </div>
                    <div className="flex gap-1">
                      <button onClick={() => handleUpdateColumn(col.id)} className="flex-1 rounded bg-indigo-600 py-1 text-xs text-white hover:bg-indigo-500">
                        <Check size={12} className="mx-auto" />
                      </button>
                      <button onClick={() => setEditingCol(null)} className="flex-1 rounded bg-gray-800 py-1 text-xs text-gray-400 hover:bg-gray-700">
                        <X size={12} className="mx-auto" />
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="flex items-center justify-between border-b border-gray-800 px-4 py-3">
                    <div className="flex items-center gap-2">
                      <div className={`h-2.5 w-2.5 rounded-full ${col.color}`} />
                      <span className="text-sm font-semibold text-gray-200">{col.name}</span>
                    </div>
                    <div className="flex items-center gap-1">
                      <span className="rounded-full bg-gray-800 px-2 py-0.5 text-xs font-medium text-gray-400">
                        {(cardsByColumn[col.id] || []).length}
                      </span>
                      <button
                        onClick={() => { setEditingCol(col.id); setEditColName(col.name); setEditColColor(col.color); }}
                        className="rounded p-1 text-gray-600 hover:text-gray-300"
                      >
                        <Pencil size={12} />
                      </button>
                      <button
                        onClick={() => handleDeleteColumn(col.id)}
                        className="rounded p-1 text-gray-600 hover:text-red-400"
                      >
                        <Trash2 size={12} />
                      </button>
                    </div>
                  </div>
                )}

                {/* Droppable card area */}
                <Droppable droppableId={col.id}>
                  {(provided, snapshot) => (
                    <div
                      ref={provided.innerRef}
                      {...provided.droppableProps}
                      className={`flex-1 space-y-2 overflow-y-auto p-2 transition-colors ${snapshot.isDraggingOver ? 'bg-gray-800/50' : ''}`}
                      style={{ minHeight: 80 }}
                    >
                      {(cardsByColumn[col.id] || []).map((card, index) => {
                        const approval = APPROVAL_ICON[card.approval_status] || APPROVAL_ICON.pending;
                        const ApprovalIcon = approval.icon;
                        const sales = salesTotals[card.id];
                        return (
                          <Draggable key={card.id} draggableId={card.id} index={index}>
                            {(provided, snapshot) => (
                              <div
                                ref={provided.innerRef}
                                {...provided.draggableProps}
                                onClick={() => setSelectedCard(card)}
                                className={`group cursor-pointer rounded-lg border p-3 transition-all ${
                                  snapshot.isDragging
                                    ? 'border-indigo-500 bg-gray-800 shadow-lg shadow-indigo-500/10 rotate-1'
                                    : 'border-gray-800 bg-gray-950 hover:border-gray-700'
                                }`}
                              >
                                <div className="flex items-start gap-2">
                                  <div {...provided.dragHandleProps} className="mt-0.5 cursor-grab text-gray-600 opacity-0 transition-opacity group-hover:opacity-100">
                                    <GripVertical size={14} />
                                  </div>
                                  <div className="flex-1">
                                    <div className="flex items-center gap-1.5">
                                      <ApprovalIcon size={12} className={approval.color} />
                                      <p className="text-sm text-gray-200">{card.title}</p>
                                    </div>
                                    <div className="mt-1 flex items-center gap-2">
                                      <span className="font-mono text-[10px] text-gray-600">{card.id.slice(0, 8)}</span>
                                      {sales && sales.total > 0 && (
                                        <span className="flex items-center gap-0.5 text-[10px] text-emerald-500">
                                          <DollarSign size={10} />
                                          {sales.total.toFixed(0)} ({sales.count})
                                        </span>
                                      )}
                                    </div>
                                  </div>
                                </div>
                              </div>
                            )}
                          </Draggable>
                        );
                      })}
                      {provided.placeholder}
                    </div>
                  )}
                </Droppable>

                {/* Add card */}
                <div className="border-t border-gray-800 p-2">
                  {addingCardCol === col.id ? (
                    <form onSubmit={handleCreateCard} className="space-y-2">
                      <input autoFocus type="text" value={newCardTitle}
                        onChange={e => setNewCardTitle(e.target.value)}
                        onKeyDown={e => { if (e.key === 'Escape') { setAddingCardCol(null); setNewCardTitle(''); } }}
                        placeholder="Card title..."
                        className="w-full rounded-lg border border-gray-700 bg-gray-800 px-3 py-1.5 text-sm text-gray-200 placeholder-gray-500 focus:border-indigo-500 focus:outline-none"
                      />
                      <div className="flex gap-2">
                        <button type="submit" className="flex-1 rounded-lg bg-indigo-600 py-1 text-xs font-medium text-white hover:bg-indigo-500">Add</button>
                        <button type="button" onClick={() => { setAddingCardCol(null); setNewCardTitle(''); }} className="flex-1 rounded-lg bg-gray-800 py-1 text-xs text-gray-400 hover:bg-gray-700">Cancel</button>
                      </div>
                    </form>
                  ) : (
                    <button
                      onClick={() => { setAddingCardCol(col.id); setNewCardTitle(''); }}
                      className="flex w-full items-center justify-center gap-1.5 rounded-lg border border-dashed border-gray-700 py-1.5 text-xs text-gray-500 hover:border-indigo-500 hover:text-indigo-400"
                    >
                      <Plus size={14} /> Add card
                    </button>
                  )}
                </div>
              </div>
            ))}

            {/* Add column */}
            <div className="flex w-72 shrink-0 flex-col">
              {addingColumn ? (
                <form onSubmit={handleCreateColumn} className="rounded-xl border border-gray-800 bg-gray-900 p-4 space-y-3">
                  <input
                    autoFocus
                    value={newColName}
                    onChange={e => setNewColName(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Escape') setAddingColumn(false); }}
                    placeholder="Column name..."
                    className="w-full rounded-lg border border-gray-700 bg-gray-800 px-3 py-1.5 text-sm text-gray-200 placeholder-gray-500 focus:border-indigo-500 focus:outline-none"
                  />
                  <div className="flex flex-wrap gap-1.5">
                    {COLOR_OPTIONS.map(c => (
                      <button
                        key={c} type="button"
                        onClick={() => setNewColColor(c)}
                        className={`h-6 w-6 rounded-full ${c} transition-all ${newColColor === c ? 'ring-2 ring-white ring-offset-1 ring-offset-gray-900 scale-110' : 'opacity-60 hover:opacity-100'}`}
                      />
                    ))}
                  </div>
                  <div className="flex gap-2">
                    <button type="submit" className="flex-1 rounded-lg bg-indigo-600 py-1.5 text-xs font-medium text-white hover:bg-indigo-500">Create</button>
                    <button type="button" onClick={() => setAddingColumn(false)} className="flex-1 rounded-lg bg-gray-800 py-1.5 text-xs text-gray-400 hover:bg-gray-700">Cancel</button>
                  </div>
                </form>
              ) : (
                <button
                  onClick={() => setAddingColumn(true)}
                  className="flex h-12 items-center justify-center gap-2 rounded-xl border border-dashed border-gray-700 text-sm text-gray-500 hover:border-indigo-500 hover:text-indigo-400 transition-colors"
                >
                  <Plus size={16} /> Add Column
                </button>
              )}
            </div>
          </div>
        </DragDropContext>
      )}

      {/* Card Drawer */}
      {selectedCard && (
        <CardDrawer
          card={selectedCard}
          onClose={() => { setSelectedCard(null); loadCards(); loadSalesTotals(); }}
        />
      )}
    </div>
  );
}
