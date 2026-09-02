import { useEffect, useRef, useState } from 'react';
import NotesIcon from './NotesIcon';
import StarIcon from './StarIcon';
import { sortNotes } from '../lib/notes';
import { useNoteReorder } from '../lib/useNoteReorder';

// Per-track notes, surfaced in the now-playing panel: a quiet icon in the
// column's bottom-left that expands into an inline checklist. Check items
// off, flag priority, add new ones, delete on hover here; editing note text
// stays in the "Versions & notes…" modal. Same note data as the modal —
// this reads `notes` straight off the track record and calls the same
// handlers.
export default function NowPlayingNotes({
  trackId,
  notes = [],
  onAddNote,
  onToggleNote,
  onDeleteNote,
  onToggleNotePriority,
  onReorderNote
}) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState('');
  const rootRef = useRef(null);
  const { dropTarget, onHandleDragStart, onRowDragOver, onRowDrop, onDragEnd } = useNoteReorder(
    trackId,
    onReorderNote
  );

  const total = notes.length;
  const openCount = notes.filter((n) => !n.complete).length;

  // collapse the panel when the browsed track changes out from under it
  useEffect(() => {
    setOpen(false);
    setDraft('');
  }, [trackId]);

  useEffect(() => {
    if (!open) return;
    function onDown(e) {
      if (rootRef.current && !rootRef.current.contains(e.target)) setOpen(false);
    }
    function onKey(e) {
      if (e.key === 'Escape') {
        e.stopPropagation(); // don't also clear the track selection
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', onDown, true);
    document.addEventListener('keydown', onKey, true);
    return () => {
      document.removeEventListener('mousedown', onDown, true);
      document.removeEventListener('keydown', onKey, true);
    };
  }, [open]);

  function submit(e) {
    e.preventDefault();
    const t = draft.trim();
    if (!t) return;
    onAddNote(trackId, t);
    setDraft('');
  }

  return (
    <div className="np-notes" ref={rootRef}>
      {open && (
        <div className="np-notes-panel">
          <p className="np-notes-head">notes</p>
          <div className="np-notes-list">
            {total === 0 && <p className="np-notes-empty">no notes yet</p>}
            {sortNotes(notes).map((n) => (
              <div
                key={n.id}
                className={`np-note${n.complete ? ' done' : ''}${n.priority ? ' flagged' : ''}`}
                onDragOver={(e) => onRowDragOver(n, e)}
                onDrop={(e) => onRowDrop(n, e)}
              >
                {dropTarget?.id === n.id && (
                  <div className={`note-drop-line ${dropTarget.before ? 'top' : 'bottom'}`} />
                )}
                {!n.complete && (
                  <span
                    className="note-drag-handle"
                    draggable
                    onDragStart={(e) => onHandleDragStart(n, e)}
                    onDragEnd={onDragEnd}
                    aria-hidden="true"
                    title="drag to reorder"
                  >
                    ⠿
                  </span>
                )}
                <button
                  className="np-note-check"
                  onClick={() => onToggleNote(trackId, n.id)}
                  aria-label={n.complete ? 'mark not done' : 'mark done'}
                >
                  {n.complete ? '✓' : ''}
                </button>
                <span className="np-note-text">{n.text}</span>
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
            <input
              autoFocus
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
