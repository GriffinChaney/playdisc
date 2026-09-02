import { useEffect, useRef, useState } from 'react';
import NotesIcon from './NotesIcon';

// Per-track notes, surfaced in the now-playing panel: a quiet icon in the
// column's bottom-left that expands into an inline checklist. Check items
// off and add new ones here; editing text and deleting notes stay in the
// "Versions & notes…" modal. Same note data as the modal — this reads
// `notes` straight off the track record and calls the same handlers.
export default function NowPlayingNotes({ trackId, notes = [], onAddNote, onToggleNote, onDeleteNote }) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState('');
  const rootRef = useRef(null);

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
            {notes.map((n) => (
              <div key={n.id} className={`np-note${n.complete ? ' done' : ''}`}>
                <button
                  className="np-note-check"
                  onClick={() => onToggleNote(trackId, n.id)}
                  aria-label={n.complete ? 'mark not done' : 'mark done'}
                >
                  {n.complete ? '✓' : ''}
                </button>
                <span className="np-note-text">{n.text}</span>
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
