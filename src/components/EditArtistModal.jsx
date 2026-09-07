import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';

// This track's original artist name (imported/tag value) — the same
// undefined-or-string tri-state App.jsx's handleRenameArtist already uses:
// undefined means never edited, so the CURRENT name IS the original.
function effectiveOriginalArtistOf(t) {
  return t.originalArtist !== undefined ? t.originalArtist : t.artist;
}

// Multi-selection artist rename, reached from LibraryList's right-click menu
// (menuTargets resolves the target set) — ONLY for a multi-selection. A
// single track keeps its existing inline rename in VersionsModal untouched;
// this modal is never opened for one, so there's no second single-track
// editing path to keep in sync with that one.
//
// Mirrors CoverEditModal's multi-select shape: no single "current value"
// shown (the selection can hold many different artists), a count instead,
// and both actions (Set / Reset) stay enabled no matter how mixed the
// selection's current artists are — Reset resolves per-track at apply time
// via effectiveOriginalArtistOf, so each track goes back to ITS OWN
// original even when some were edited before and others never were.
// Unlike the cover modal there's no async "stage a file, decide, then
// Save" step (typing a name needs no processing), so each action confirms
// and applies immediately rather than going through a separate staged
// Save — naming the action and the track count, since overwriting many
// different existing artist names is more destructive than the cover case.
//
// Routes through the SAME single-track save path VersionsModal's inline
// edit already uses — `onRenameArtist(trackId, name)`, App.jsx's
// handleRenameArtist — called once per selected track. No parallel bulk
// handler.
export default function EditArtistModal({ tracks, onClose, onRenameArtist }) {
  const [draft, setDraft] = useState('');

  const idsKey = tracks.map((t) => t.id).join(',');
  useEffect(() => {
    setDraft('');
  }, [idsKey]);

  useEffect(() => {
    if (!tracks.length) return;
    function onKey(e) {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
    }
    document.addEventListener('keydown', onKey, true);
    return () => document.removeEventListener('keydown', onKey, true);
  }, [tracks.length, onClose]);

  if (!tracks.length) return null;

  function setArtist() {
    const name = draft.trim();
    if (!name) return;
    if (!window.confirm(`Set artist to "${name}" on ${tracks.length} tracks? This replaces each track's current artist.`)) {
      return;
    }
    for (const t of tracks) onRenameArtist(t.id, name);
    onClose();
  }

  function resetArtist() {
    if (!window.confirm(`Reset artist on ${tracks.length} tracks? Each track goes back to its own original artist.`)) {
      return;
    }
    for (const t of tracks) onRenameArtist(t.id, effectiveOriginalArtistOf(t));
    onClose();
  }

  return createPortal(
    <div className="modal-overlay modal-overlay-blur" onMouseDown={onClose}>
      <div className="cover-edit-modal edit-artist-modal" onMouseDown={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>edit artist</h2>
          <button className="modal-close-btn" onClick={onClose} aria-label="close">
            ✕
          </button>
        </div>

        <div className="cover-edit-body">
          <p className="cover-edit-multi-count">{tracks.length} tracks selected</p>

          <form
            className="edit-artist-set-row"
            onSubmit={(e) => {
              e.preventDefault();
              setArtist();
            }}
          >
            <input
              autoFocus
              className="vm-label-input"
              placeholder="new artist name"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
            />
            <button type="submit" className="cover-edit-btn" disabled={!draft.trim()}>
              Set artist
            </button>
          </form>

          <button
            type="button"
            className="cover-edit-btn edit-artist-reset-btn"
            title="each track goes back to its own embedded / imported artist"
            onClick={resetArtist}
          >
            Reset to default
          </button>
        </div>

        <div className="pl-edit-actions">
          <button className="prompt-modal-btn" onClick={onClose}>
            Cancel
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
