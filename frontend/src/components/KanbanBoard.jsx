import { useState, useEffect, useCallback } from 'react';
import { DragDropContext, Droppable, Draggable } from '@hello-pangea/dnd';
import { useWorker } from '../hooks/useWorker';
import { api } from '../lib/api';
import { Plus, GripVertical, FolderPlus } from 'lucide-react';

const COLUMNS = [
  { id: 'backlog', label: 'Backlog', color: 'bg-gray-500' },
  { id: 'todo', label: 'To Do', color: 'bg-blue-500' },
  { id: 'in_progress', label: 'In Progress', color: 'bg-amber-500' },
  { id: 'review', label: 'Review', color: 'bg-purple-500' },
  { id: 'done', label: 'Done', color: 'bg-emerald-500' },
];

export default function KanbanBoard() {
  const { query, optimisticWrite, onSync, ready } = useWorker();
  const [projects, setProjects] = useState([]);
  const [cards, setCards] = useState([]);
  const [currentProject, setCurrentProject] = useState(null);
  const [newProjectName, setNewProjectName] = useState('');
  const [addingCardCol, setAddingCardCol] = useState(null);
  const [newCardTitle, setNewCardTitle] = useState('');

  // Load projects from worker
  const loadProjects = useCallback(async () => {
    if (!ready) return;
    const result = await query('projects');
    setProjects(result);
    if (!currentProject && result.length > 0) {
      setCurrentProject(result[0].id);
    }
  }, [query, ready, currentProject]);

  // Load cards from worker
  const loadCards = useCallback(async () => {
    if (!ready || !currentProject) return;
    const result = await query('kanban_cards', { project_id: currentProject });
    setCards(result);
  }, [query, ready, currentProject]);

  // Initial load
  useEffect(() => { loadProjects(); }, [loadProjects]);
  useEffect(() => { loadCards(); }, [loadCards]);

  // Re-load on sync events
  useEffect(() => {
    return onSync((tables) => {
      if (tables.includes('projects')) loadProjects();
      if (tables.includes('kanban_cards')) loadCards();
    });
  }, [onSync, loadProjects, loadCards]);

  // Create project
  async function handleCreateProject(e) {
    e.preventDefault();
    if (!newProjectName.trim()) return;
    try {
      const p = await api.createProject(newProjectName.trim());
      optimisticWrite('projects', p.id, p);
      setCurrentProject(p.id);
      setNewProjectName('');
    } catch (err) {
      console.error('Failed to create project:', err);
    }
  }

  // Create card
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

  // Drag end — optimistic UI
  async function handleDragEnd(result) {
    const { draggableId, destination, source } = result;
    if (!destination) return;
    if (destination.droppableId === source.droppableId && destination.index === source.index) return;

    const newColumn = destination.droppableId;
    const cardId = draggableId;

    // 1. Optimistic: update React state immediately
    setCards((prev) => {
      const updated = prev.map((c) =>
        c.id === cardId ? { ...c, column_name: newColumn, position: destination.index } : c
      );
      return updated;
    });

    // 2. Optimistic: update worker local DB
    const card = cards.find((c) => c.id === cardId);
    if (card) {
      optimisticWrite('kanban_cards', cardId, {
        ...card,
        column_name: newColumn,
        position: destination.index,
      });
    }

    // 3. Send PATCH to backend
    try {
      await api.updateCard(cardId, {
        column_name: newColumn,
        position: destination.index,
      });
    } catch {
      // On failure, re-sync will correct the state
      loadCards();
    }
  }

  // Group cards by column
  const cardsByColumn = {};
  for (const col of COLUMNS) {
    cardsByColumn[col.id] = cards.filter((c) => c.column_name === col.id);
  }

  return (
    <div className="flex h-full flex-col">
      {/* Project selector bar */}
      <div className="flex items-center gap-3 border-b border-gray-800 bg-gray-900/30 px-6 py-3">
        <select
          value={currentProject || ''}
          onChange={(e) => setCurrentProject(e.target.value)}
          className="rounded-lg border border-gray-700 bg-gray-800 px-3 py-1.5 text-sm text-gray-200 focus:border-indigo-500 focus:outline-none"
        >
          <option value="" disabled>Select project...</option>
          {projects.map((p) => (
            <option key={p.id} value={p.id}>{p.name}</option>
          ))}
        </select>

        <form onSubmit={handleCreateProject} className="flex items-center gap-2">
          <input
            type="text"
            value={newProjectName}
            onChange={(e) => setNewProjectName(e.target.value)}
            placeholder="New project name"
            className="rounded-lg border border-gray-700 bg-gray-800 px-3 py-1.5 text-sm text-gray-200 placeholder-gray-500 focus:border-indigo-500 focus:outline-none"
          />
          <button
            type="submit"
            className="flex items-center gap-1.5 rounded-lg bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-indigo-500"
          >
            <FolderPlus size={14} />
            Project
          </button>
        </form>
      </div>

      {/* Kanban columns */}
      {!currentProject ? (
        <div className="flex flex-1 items-center justify-center text-gray-500">
          Select or create a project to see the board.
        </div>
      ) : (
        <DragDropContext onDragEnd={handleDragEnd}>
          <div className="kanban-scroll flex flex-1 gap-4 overflow-x-auto p-6">
            {COLUMNS.map((col) => (
              <div
                key={col.id}
                className="flex w-72 shrink-0 flex-col rounded-xl border border-gray-800 bg-gray-900"
              >
                {/* Column header */}
                <div className="flex items-center justify-between border-b border-gray-800 px-4 py-3">
                  <div className="flex items-center gap-2">
                    <div className={`h-2.5 w-2.5 rounded-full ${col.color}`} />
                    <span className="text-sm font-semibold text-gray-200">{col.label}</span>
                  </div>
                  <span className="rounded-full bg-gray-800 px-2 py-0.5 text-xs font-medium text-gray-400">
                    {cardsByColumn[col.id].length}
                  </span>
                </div>

                {/* Droppable area */}
                <Droppable droppableId={col.id}>
                  {(provided, snapshot) => (
                    <div
                      ref={provided.innerRef}
                      {...provided.droppableProps}
                      className={`flex-1 space-y-2 overflow-y-auto p-2 transition-colors ${
                        snapshot.isDraggingOver ? 'bg-gray-800/50' : ''
                      }`}
                      style={{ minHeight: 80 }}
                    >
                      {cardsByColumn[col.id].map((card, index) => (
                        <Draggable key={card.id} draggableId={card.id} index={index}>
                          {(provided, snapshot) => (
                            <div
                              ref={provided.innerRef}
                              {...provided.draggableProps}
                              className={`group rounded-lg border bg-gray-850 p-3 transition-all ${
                                snapshot.isDragging
                                  ? 'border-indigo-500 bg-gray-800 shadow-lg shadow-indigo-500/10 rotate-1'
                                  : 'border-gray-800 bg-gray-850 hover:border-gray-700'
                              }`}
                            >
                              <div className="flex items-start gap-2">
                                <div
                                  {...provided.dragHandleProps}
                                  className="mt-0.5 cursor-grab text-gray-600 opacity-0 transition-opacity group-hover:opacity-100"
                                >
                                  <GripVertical size={14} />
                                </div>
                                <div className="flex-1">
                                  <p className="text-sm text-gray-200">{card.title}</p>
                                  <p className="mt-1 font-mono text-[10px] text-gray-600">
                                    {card.id.slice(0, 8)}
                                  </p>
                                </div>
                              </div>
                            </div>
                          )}
                        </Draggable>
                      ))}
                      {provided.placeholder}
                    </div>
                  )}
                </Droppable>

                {/* Add card form / button */}
                <div className="border-t border-gray-800 p-2">
                  {addingCardCol === col.id ? (
                    <form onSubmit={handleCreateCard} className="space-y-2">
                      <input
                        autoFocus
                        type="text"
                        value={newCardTitle}
                        onChange={(e) => setNewCardTitle(e.target.value)}
                        onKeyDown={(e) => { if (e.key === 'Escape') { setAddingCardCol(null); setNewCardTitle(''); } }}
                        placeholder="Card title..."
                        className="w-full rounded-lg border border-gray-700 bg-gray-800 px-3 py-1.5 text-sm text-gray-200 placeholder-gray-500 focus:border-indigo-500 focus:outline-none"
                      />
                      <div className="flex gap-2">
                        <button
                          type="submit"
                          className="flex-1 rounded-lg bg-indigo-600 py-1 text-xs font-medium text-white hover:bg-indigo-500"
                        >
                          Add
                        </button>
                        <button
                          type="button"
                          onClick={() => { setAddingCardCol(null); setNewCardTitle(''); }}
                          className="flex-1 rounded-lg bg-gray-800 py-1 text-xs text-gray-400 hover:bg-gray-700"
                        >
                          Cancel
                        </button>
                      </div>
                    </form>
                  ) : (
                    <button
                      onClick={() => { setAddingCardCol(col.id); setNewCardTitle(''); }}
                      className="flex w-full items-center justify-center gap-1.5 rounded-lg border border-dashed border-gray-700 py-1.5 text-xs text-gray-500 transition-colors hover:border-indigo-500 hover:text-indigo-400"
                    >
                      <Plus size={14} />
                      Add card
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </DragDropContext>
      )}
    </div>
  );
}
