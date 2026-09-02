import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import StarIcon from './StarIcon';
import { sortNotes } from '../lib/notes';
import { useNoteReorder } from '../lib/useNoteReorder';

function fmtDur(s = 0) {
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60).toString().padStart(2, '0');
  return `${m}:${sec}`;
}
function fmtDate(ms) {
  return ms ? new Date(ms).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) : '';
}

// Versions + notes for one track. Same blur/darken backdrop as the playlist
// editor. Versions: click a row to make it active, rename its title inline,
// or delete it (blocked when it's the only one). Notes: a plain checklist
// on the track (not any version) — add / check / edit text / delete.
export default function VersionsModal({
  track,
  missingPaths,
  onClose,
  onAddVersion,
  onSetActiveVersion,
  onRenameVersion,
  onDeleteVersion,
  onRelocateVersion,
  onAddNote,
  onToggleNote,
  onEditNote,
  onDeleteNote,
  onToggleNotePriority,
  onReorderNote
}) {
  const [editingTitleId, setEditingTitleId] = useState(null);
  const [titleDraft, setTitleDraft] = useState('');
  const [editingNoteId, setEditingNoteId] = useState(null);
  const [noteDraft, setNoteDraft] = useState('');
  const [newNote, setNewNote] = useState('');
  const { dropTarget, onHandleDragStart, onRowDragOver, onRowDrop, onDragEnd } = useNoteReorder(
    track?.id,
    onReorderNote
  );

  useEffect(() => {
    if (!track) return;
    function onKey(e) {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
    }
    document.addEventListener('keydown', onKey, true);
    return () => document.removeEventListener('keydown', onKey, true);
  }, [track, onClose]);

  if (!track) return null;
  const versions = [...(track.versions || [])].sort((a, b) => a.dateAdded - b.dateAdded);
  const notes = sortNotes(track.notes || []);
  const single = versions.length <= 1;

  function commitTitle(id) {
    const t = titleDraft.trim();
    if (t) onRenameVersion(track.id, id, t);
    setEditingTitleId(null);
  }
  function commitNote(id) {
    const t = noteDraft.trim();
    if (t) onEditNote(track.id, id, t);
    setEditingNoteId(null);
  }
  function addNote() {
    const t = newNote.trim();
    if (!t) return;
    onAddNote(track.id, t);
    setNewNote('');
  }

  return createPortal(
    <div
      className="modal-overlay modal-overlay-blur"
      onMouseDown={onClose}
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => e.preventDefault()}
    >
      <div className="vm-modal" onMouseDown={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>{track.title}</h2>
          <button className="modal-close-btn" onClick={onClose} aria-label="close">
            ✕
          </button>
        </div>

        <div className="vm-body">
          <div className="vm-section-head">
            <span>versions</span>
            <button className="vm-add" onClick={() => onAddVersion(track.id)}>
              + add version
            </button>
          </div>
          <div className="vm-list">
            {versions.map((v) => {
              const isActive = v.id === track.activeVersionId;
              const missing = missingPaths?.has(v.filePath);
              return (
                <div key={v.id} className={`vm-row${isActive ? ' active' : ''}`}>
                  <button
                    className="vm-radio"
                    onClick={() => onSetActiveVersion(track.id, v.id)}
                    aria-label={isActive ? 'active version' : 'make active'}
                    title={isActive ? 'active version' : 'make this the active version'}
                  >
                    <span className={isActive ? 'on' : ''} />
                  </button>
                  <div className="vm-row-main" onClick={() => !missing && onSetActiveVersion(track.id, v.id)}>
                    {editingTitleId === v.id ? (
                      <input
                        autoFocus
                        className="vm-label-input"
                        value={titleDraft}
                        onChange={(e) => setTitleDraft(e.target.value)}
                        onBlur={() => commitTitle(v.id)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') commitTitle(v.id);
                          if (e.key === 'Escape') setEditingTitleId(null);
                        }}
                        onClick={(e) => e.stopPropagation()}
                      />
                    ) : (
                      <button
                        className="vm-label"
                        onClick={(e) => {
                          e.stopPropagation();
                          setEditingTitleId(v.id);
                          setTitleDraft(v.title || track.title || '');
                        }}
                        title="rename this version"
                      >
                        {v.title || track.title}
                      </button>
                    )}
                    <span className="vm-meta">
                      {missing ? (
                        <span className="vm-missing">file missing</span>
                      ) : (
                        fmtDur(v.duration)
                      )}
                      {' · '}
                      {fmtDate(v.dateAdded)}
                      {v.originalTitle && v.title && v.title !== v.originalTitle && (
                        <>
                          {' · '}
                          <button
                            className="vm-reset"
                            title={`reset to imported title: ${v.originalTitle}`}
                            onClick={(e) => {
                              e.stopPropagation();
                              onRenameVersion(track.id, v.id, v.originalTitle);
                            }}
                          >
                            reset to original
                          </button>
                        </>
                      )}
                    </span>
                  </div>
                  {missing && (
                    <button className="vm-relocate" onClick={() => onRelocateVersion(track.id, v.id)}>
                      relocate…
                    </button>
                  )}
                  {!single && (
                    <button
                      className="vm-del"
                      onClick={() => onDeleteVersion(track.id, v.id)}
                      aria-label="delete version"
                      title="delete version"
                    >
                      ✕
                    </button>
                  )}
                </div>
              );
            })}
          </div>

          <div className="vm-section-head vm-notes-head">
            <span>notes</span>
          </div>
          <div className="vm-list">
            {notes.map((n) => (
              <div
                key={n.id}
                className={`vm-note${n.complete ? ' done' : ''}${n.priority ? ' flagged' : ''}`}
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
                  className="vm-check"
                  onClick={() => onToggleNote(track.id, n.id)}
                  aria-label={n.complete ? 'mark not done' : 'mark done'}
                >
                  <span className={n.complete ? 'on' : ''}>{n.complete ? '✓' : ''}</span>
                </button>
                {editingNoteId === n.id ? (
                  <input
                    autoFocus
                    className="vm-note-input"
                    value={noteDraft}
                    onChange={(e) => setNoteDraft(e.target.value)}
                    onBlur={() => commitNote(n.id)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') commitNote(n.id);
                      if (e.key === 'Escape') setEditingNoteId(null);
                    }}
                  />
                ) : (
                  <button
                    className="vm-note-text"
                    onClick={() => {
                      setEditingNoteId(n.id);
                      setNoteDraft(n.text);
                    }}
                  >
                    {n.text}
                  </button>
                )}
                <button
                  className={`vm-note-star${n.priority ? ' on' : ''}`}
                  onClick={() => onToggleNotePriority(track.id, n.id)}
                  aria-label={n.priority ? 'clear priority' : 'flag as priority'}
                  aria-pressed={!!n.priority}
                  title={n.priority ? 'priority' : 'flag as priority'}
                >
                  <StarIcon filled={!!n.priority} />
                </button>
                <button
                  className="vm-del"
                  onClick={() => onDeleteNote(track.id, n.id)}
                  aria-label="delete note"
                >
                  ✕
                </button>
              </div>
            ))}
            <form
              className="vm-note-add"
              onSubmit={(e) => {
                e.preventDefault();
                addNote();
              }}
            >
              <input
                className="vm-note-input"
                placeholder="add a note…"
                value={newNote}
                onChange={(e) => setNewNote(e.target.value)}
              />
            </form>
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
}
