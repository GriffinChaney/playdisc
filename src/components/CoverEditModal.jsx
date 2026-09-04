import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { resizeImage } from '../lib/imageResize';
import { useObjectUrl } from '../lib/useObjectUrl';

// the artwork a track was imported with. For a never-edited track the
// current blob IS the original; once edited, the stored field is source.
function effectiveOriginalOf(t) {
  return t.originalArtworkBlob !== undefined ? t.originalArtworkBlob : t.artworkBlob || null;
}

// Per-track cover art: choose a new image, reset to the embedded/imported
// original, or clear it to blank. Changes are staged and only persist on
// Save (Cancel discards). App owns `tracks` (right-click resolves to either
// just that track, or the whole selection — see LibraryList's menuTargets).
//
// Single track: unchanged from before — a live preview, Reset/Clear disabled
// when they'd be no-ops. Multiple tracks: no preview (there's no one image
// that honestly represents a mixed selection), a "N tracks selected" label
// instead, and every action stays enabled regardless of how mixed the
// selection's current covers are — Reset resolves per-track at Save time (via
// effectiveOriginalOf), so each track goes back to its OWN original even if
// some were edited earlier and others never were. Save asks for confirmation
// first since it's about to touch many tracks at once.
//
// `originalArtworkBlob` on the track record is captured lazily the first
// time a cover is edited — so a never-touched track behaves exactly as
// before, and "reset to default" always has something real to go back to.
export default function CoverEditModal({ tracks, onClose, onSave }) {
  const isMulti = tracks.length > 1;
  const track = tracks[0];

  // undefined = nothing staged; otherwise one pending action, resolved to an
  // actual blob per track only at Save time
  const [staged, setStaged] = useState(undefined);
  const [working, setWorking] = useState(false);
  const [dragActive, setDragActive] = useState(false);
  const fileRef = useRef(null);

  const effectiveOriginal = !isMulti && track ? effectiveOriginalOf(track) : null;
  const hasOriginal = !isMulti && !!effectiveOriginal;

  const idsKey = tracks.map((t) => t.id).join(',');
  useEffect(() => {
    setStaged(undefined);
    setDragActive(false);
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

  // multi-select never previews — see file header for why
  const previewBlob = isMulti
    ? null
    : staged === undefined
      ? track?.artworkBlob || null
      : staged.type === 'clear'
        ? null
        : staged.type === 'reset'
          ? effectiveOriginal
          : staged.blob;
  const previewUrl = useObjectUrl(previewBlob);
  const originalUrl = useObjectUrl(effectiveOriginal);

  if (!tracks.length) return null;

  async function applyFile(file) {
    if (!file || !file.type.startsWith('image/')) return;
    setWorking(true);
    const resized = await resizeImage(file);
    setStaged({ type: 'file', blob: resized });
    setWorking(false);
  }
  function pickImage(e) {
    const file = e.target.files?.[0];
    e.target.value = '';
    applyFile(file);
  }

  function save() {
    if (staged === undefined) return;
    if (isMulti) {
      const prompt =
        staged.type === 'clear'
          ? `Clear cover on ${tracks.length} tracks?`
          : staged.type === 'reset'
            ? `Reset ${tracks.length} tracks to their default covers?`
            : `Change cover on ${tracks.length} tracks?`;
      if (!window.confirm(prompt)) return;
    }
    // same per-track save path as always (App's handleSaveCover -> patchTrack),
    // just called once per selected track — no parallel bulk-write path
    for (const t of tracks) {
      const tOriginal = effectiveOriginalOf(t);
      const artworkBlob =
        staged.type === 'clear' ? null : staged.type === 'reset' ? tOriginal : staged.blob;
      onSave(t.id, { artworkBlob, originalArtworkBlob: tOriginal });
    }
    onClose();
  }

  const resetDisabled = isMulti ? false : !hasOriginal;
  const clearDisabled = isMulti ? false : previewBlob == null;

  return createPortal(
    <div
      className="modal-overlay modal-overlay-blur"
      onMouseDown={onClose}
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => e.preventDefault()}
    >
      <div className="cover-edit-modal" onMouseDown={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>edit cover</h2>
          <button className="modal-close-btn" onClick={onClose} aria-label="close">
            ✕
          </button>
        </div>

        <div className="cover-edit-body">
          {isMulti ? (
            <>
              <div
                className={`cover-edit-multi${dragActive ? ' dragging' : ''}`}
                onDragOver={(e) => {
                  e.preventDefault();
                  setDragActive(true);
                }}
                onDragLeave={() => setDragActive(false)}
                onDrop={(e) => {
                  e.preventDefault();
                  setDragActive(false);
                  applyFile(e.dataTransfer.files?.[0]);
                }}
              >
                <p className="cover-edit-multi-count">{tracks.length} tracks selected</p>
              </div>
              <p className="cover-edit-hint">
                {working ? 'processing…' : dragActive ? 'drop to use this image for all selected' : 'choose an action below'}
              </p>
            </>
          ) : (
            <>
              <button
                type="button"
                className={`cover-edit-box${dragActive ? ' dragging' : ''}`}
                style={previewUrl ? { backgroundImage: `url(${previewUrl})` } : undefined}
                onClick={() => fileRef.current?.click()}
                onDragOver={(e) => {
                  e.preventDefault();
                  setDragActive(true);
                }}
                onDragLeave={() => setDragActive(false)}
                onDrop={(e) => {
                  e.preventDefault();
                  setDragActive(false);
                  applyFile(e.dataTransfer.files?.[0]);
                }}
                aria-label="choose cover image"
              >
                {!previewUrl && <span className="cover-edit-ph">{working ? '…' : '♪'}</span>}
              </button>
              <p className="cover-edit-hint">
                {working ? 'processing…' : dragActive ? 'drop to use this image' : 'click or drop an image'}
              </p>
            </>
          )}

          <div className="cover-edit-choices">
            {isMulti && (
              <button type="button" className="cover-edit-btn" onClick={() => fileRef.current?.click()}>
                Change cover…
              </button>
            )}
            <button
              type="button"
              className="cover-edit-btn"
              disabled={resetDisabled}
              title={
                isMulti
                  ? 'each track goes back to its own embedded / imported artwork'
                  : hasOriginal
                    ? 'restore the embedded / imported artwork'
                    : 'this track had no embedded artwork'
              }
              onClick={() => setStaged({ type: 'reset' })}
            >
              {!isMulti && hasOriginal && originalUrl && (
                <span
                  className="cover-edit-btn-thumb"
                  style={{ backgroundImage: `url(${originalUrl})` }}
                />
              )}
              Reset to default
            </button>
            <button
              type="button"
              className="cover-edit-btn"
              disabled={clearDisabled}
              onClick={() => setStaged({ type: 'clear' })}
            >
              Clear
            </button>
          </div>
        </div>

        <input ref={fileRef} type="file" accept="image/*" hidden onChange={pickImage} />

        <div className="pl-edit-actions">
          <button className="prompt-modal-btn" onClick={onClose}>
            Cancel
          </button>
          <button
            className="prompt-modal-btn primary"
            onClick={save}
            disabled={staged === undefined || working}
          >
            Save
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
