import { useEffect, useRef, useState } from 'react';
import NotesIcon from './NotesIcon';
import StarIcon from './StarIcon';
import { sortNotes } from '../lib/notes';
import { useNoteReorder } from '../lib/useNoteReorder';

// Per-track notes, surfaced in the now-playing panel: a quiet icon in the
// column's bottom-left that expands into an inline checklist. Check off, flag
// priority, click the text to edit, add, delete on hover, and press-and-hold
// a row to reorder. Same note data as the "Versions & notes…" modal — reads
// `notes` straight off the track record and calls the same handlers.
// Right-clicking the icon opens that modal for this track.
export default function NowPlayingNotes({
  trackId,
  notes = [],
  onAddNote,
  onToggleNote,
  onEditNote,
  onDeleteNote,
  onToggleNotePriority,
  onReorderNote,
  onOpenMenu,
  onOpenVersions,
  open = false,
  onOpenChange
}) {
  // controlled by App (so the "n" shortcut and the icon share one state);
  // this shim keeps the existing setOpen(...) / setOpen(fn) call sites working
  const setOpen = (v) => onOpenChange?.(v);
  const [draft, setDraft] = useState('');
  const [editingId, setEditingId] = useState(null);
  const [editDraft, setEditDraft] = useState('');
  const rootRef = useRef(null);

  const ordered = sortNotes(notes);
  const { draggingId, dropTarget, rowProps, setRowRef, clickGuard } = useNoteReorder(
    trackId,
    ordered,
    onReorderNote
  );

  const total = notes.length;
  const openCount = notes.filter((n) => !n.complete).length;

  // collapse the panel when the browsed track changes out from under it
  useEffect(() => {
    setOpen(false);
    setDraft('');
    setEditingId(null);
  }, [trackId]);

  useEffect(() => {
    if (!open) return;
    function onDown(e) {
      if (rootRef.current && !rootRef.current.contains(e.target)) setOpen(false);
    }
    function onKey(e) {
      if (e.key === 'Escape') {
        e.stopPropagation(); // don't also clear the track selection
        if (editingId) setEditingId(null);
        else setOpen(false);
      }
    }
    document.addEventListener('mousedown', onDown, true);
    document.addEventListener('keydown', onKey, true);
    return () => {
      document.removeEventListener('mousedown', onDown, true);
      document.removeEventListener('keydown', onKey, true);
    };
  }, [open, editingId]);

  function submit(e) {
    e.preventDefault();
    const t = draft.trim();
    if (!t) return;
    onAddNote(trackId, t);
    setDraft('');
  }

  function startEdit(n) {
    setEditingId(n.id);
    setEditDraft(n.text);
  }
  function commitEdit(id) {
    const t = editDraft.trim();
    if (t) onEditNote(trackId, id, t);
    setEditingId(null);
  }

  return (
    <div className="np-notes" ref={rootRef}>
      {open && (
        <div className="np-notes-panel">
          <p className="np-notes-head">notes</p>
          <div className="np-notes-list">
            {total === 0 && <p className="np-notes-empty">no notes yet</p>}
            {ordered.map((n) => (
              <div
                key={n.id}
                ref={setRowRef(n.id)}
                className={`np-note${n.complete ? ' done' : ''}${n.priority ? ' flagged' : ''}${
                  draggingId === n.id ? ' dragging' : ''
                }`}
                {...rowProps(n)}
              >
                {dropTarget?.id === n.id && (
                  <div className={`note-drop-line ${dropTarget.before ? 'top' : 'bottom'}`} />
                )}
                <button
                  className="np-note-check"
                  onClick={() => onToggleNote(trackId, n.id)}
                  aria-label={n.complete ? 'mark not done' : 'mark done'}
                >
                  {n.complete ? '✓' : ''}
                </button>
                {editingId === n.id ? (
                  <input
                    autoFocus
                    className="np-note-input"
                    value={editDraft}
                    onChange={(e) => setEditDraft(e.target.value)}
                    onBlur={() => commitEdit(n.id)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') commitEdit(n.id);
                      if (e.key === 'Escape') setEditingId(null);
                    }}
                  />
                ) : (
                  <span
                    className="np-note-text"
                    role="button"
                    tabIndex={0}
                    onClick={() => clickGuard(() => startEdit(n))}
                    onKeyDown={(e) => e.key === 'Enter' && startEdit(n)}
                  >
                    {n.text}
                  </span>
                )}
                <button
                  className={`np-note-star${n.priority ? ' on' : ''}`}
                  onClick={() => onToggleNotePriority(trackId, n.id)}
                  aria-label={n.priority ? 'clear priority' : 'flag as priority'}
                  aria-pressed={!!n.priority}
                  title={n.priority ? 'priority' : 'flag as priority'}
                >
                  <StarIcon filled={!!n.priority} />
                </button>
                <button
                  className="np-note-del"
                  onClick={() => onDeleteNote(trackId, n.id)}
                  aria-label="delete note"
                >
                  ✕
                </button>
              </div>
            ))}
          </div>
          <form className="np-notes-add" onSubmit={submit}>
            {/* passive to the sync edit guard while EMPTY — a cursor parked
                here (it autofocuses with the panel) must not hold merges
                back; only a note actually being typed does. See
                editInProgress() in App.jsx. */}
            <input
              autoFocus
              data-sync-passive={draft ? undefined : ''}
              placeholder="add a note…"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
            />
          </form>
        </div>
      )}

      <button
        className={`np-notes-btn${open ? ' active' : ''}`}
        onClick={() => setOpen((o) => !o)}
        onContextMenu={(e) => {
          e.preventDefault();
          onOpenMenu?.({
            x: e.clientX,
            y: e.clientY,
            items: [{ label: 'Versions & notes…', onClick: () => onOpenVersions?.(trackId) }]
          });
        }}
        aria-label={open ? 'hide notes' : total ? `notes (${openCount} open of ${total})` : 'notes'}
        aria-expanded={open}
        title="notes"
      >
        <NotesIcon />
        {openCount > 0 && <span className="np-notes-count">{openCount}</span>}
        {total > 0 && openCount === 0 && <span className="np-notes-done">✓</span>}
      </button>
    </div>
  );
}
