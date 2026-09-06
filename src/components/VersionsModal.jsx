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
// on the track (not any version) — add / check / edit text / delete. Artist
// is a track-level field (unlike title, which lives per version), so it's
// edited once in the header rather than per row — same inline edit/reset
// interaction as a version's title, just scoped to the whole track.
export default function VersionsModal({
  track,
  missingPaths,
  waitingPaths,
  onClose,
  onAddVersion,
  onSetActiveVersion,
  onRenameVersion,
  onRenameArtist,
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
  const [editingArtist, setEditingArtist] = useState(false);
  const [artistDraft, setArtistDraft] = useState('');
  const [editingNoteId, setEditingNoteId] = useState(null);
  const [noteDraft, setNoteDraft] = useState('');
  const [newNote, setNewNote] = useState('');
  const orderedNotes = sortNotes(track?.notes || []);
  const { draggingId, dropTarget, rowProps, setRowRef, clickGuard } = useNoteReorder(
    track?.id,
    orderedNotes,
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

  // unlike editingTitleId (keyed to a version id, so it harmlessly stops
  // matching anything when the track changes), editingArtist is a plain
  // bool — reset it explicitly so switching tracks never leaves a stale
  // edit box open pre-filled with the wrong track's draft
  useEffect(() => {
    setEditingArtist(false);
  }, [track?.id]);

  if (!track) return null;
  const versions = [...(track.versions || [])].sort((a, b) => a.dateAdded - b.dateAdded);
  const notes = orderedNotes;
  const single = versions.length <= 1;

  function commitArtist() {
    const a = artistDraft.trim();
    if (a) onRenameArtist(track.id, a);
    setEditingArtist(false);
  }
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
          <div className="vm-header-text">
            <h2>{track.title}</h2>
            <div className="vm-artist-row">
              {editingArtist ? (
                <input
                  autoFocus
                  className="vm-label-input vm-artist-input"
                  value={artistDraft}
                  onChange={(e) => setArtistDraft(e.target.value)}
                  onBlur={commitArtist}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') commitArtist();
                    if (e.key === 'Escape') setEditingArtist(false);
                  }}
                />
              ) : (
                <button
                  className="vm-label vm-artist-label"
                  onClick={() => {
                    setEditingArtist(true);
                    setArtistDraft(track.artist || '');
                  }}
                  title="rename artist"
                >
                  {track.artist}
                </button>
              )}
              {track.originalArtist !== undefined && track.artist !== track.originalArtist && (
                <button
                  className="vm-reset"
                  title={`reset to imported artist: ${track.originalArtist}`}
                  onClick={() => onRenameArtist(track.id, track.originalArtist)}
                >
                  reset to original
                </button>
              )}
            </div>
          </div>
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
              const missing = missingPaths?.has(v.relPath);
              // on its way through Dropbox — not playable yet, but not lost
              const waiting = !missing && waitingPaths?.has(v.relPath);
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
                  <div className="vm-row-main" onClick={() => !missing && !waiting && onSetActiveVersion(track.id, v.id)}>
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
                      ) : waiting ? (
                        <span className="vm-waiting">syncing from Dropbox…</span>
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
                ref={setRowRef(n.id)}
                className={`vm-note${n.complete ? ' done' : ''}${n.priority ? ' flagged' : ''}${
                  draggingId === n.id ? ' dragging' : ''
                }`}
                {...rowProps(n)}
              >
                {dropTarget?.id === n.id && (
                  <div className={`note-drop-line ${dropTarget.before ? 'top' : 'bottom'}`} />
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
                  <span
                    className="vm-note-text"
                    role="button"
                    tabIndex={0}
                    onClick={() =>
                      clickGuard(() => {
                        setEditingNoteId(n.id);
                        setNoteDraft(n.text);
                      })
                    }
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        setEditingNoteId(n.id);
                        setNoteDraft(n.text);
                      }
                    }}
                  >
                    {n.text}
                  </span>
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
