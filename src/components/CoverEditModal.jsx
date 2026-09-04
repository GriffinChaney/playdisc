import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { resizeImage } from '../lib/imageResize';
import { useObjectUrl } from '../lib/useObjectUrl';

// Per-track cover art: choose a new image, reset to the embedded/imported
// original, or clear it to blank. Changes are staged and only persist on
// Save (Cancel discards). App owns `coverEditTrackId`.
//
// `originalArtworkBlob` on the track record is captured lazily the first
// time a cover is edited — so a never-touched track behaves exactly as
// before, and "reset to default" always has something real to go back to.
export default function CoverEditModal({ track, onClose, onSave }) {
  // undefined = unchanged; Blob = new/original; null = cleared
  const [staged, setStaged] = useState(undefined);
  const [working, setWorking] = useState(false);
  const [dragActive, setDragActive] = useState(false);
  const fileRef = useRef(null);

  // the artwork the track was imported with. For a never-edited track the
  // current blob IS the original; once edited, the stored field is source.
  const effectiveOriginal = track
    ? track.originalArtworkBlob !== undefined
      ? track.originalArtworkBlob
      : track.artworkBlob || null
    : null;
  const hasOriginal = !!effectiveOriginal;

  useEffect(() => {
    setStaged(undefined);
    setDragActive(false);
  }, [track?.id]);

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

  const previewBlob = staged !== undefined ? staged : track?.artworkBlob || null;
  const previewUrl = useObjectUrl(previewBlob);
  const originalUrl = useObjectUrl(effectiveOriginal);

  if (!track) return null;

  async function applyFile(file) {
    if (!file || !file.type.startsWith('image/')) return;
    setWorking(true);
    const resized = await resizeImage(file);
    setStaged(resized);
    setWorking(false);
  }
  function pickImage(e) {
    const file = e.target.files?.[0];
    e.target.value = '';
    applyFile(file);
  }

  function save() {
    if (staged !== undefined) {
      const originalArtworkBlob =
        track.originalArtworkBlob !== undefined
          ? track.originalArtworkBlob
          : track.artworkBlob || null;
      onSave(track.id, { artworkBlob: staged, originalArtworkBlob });
    }
    onClose();
  }

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

          <div className="cover-edit-choices">
            <button
              type="button"
              className="cover-edit-btn"
              disabled={!hasOriginal}
              title={
                hasOriginal
                  ? 'restore the embedded / imported artwork'
                  : 'this track had no embedded artwork'
              }
              onClick={() => setStaged(effectiveOriginal)}
            >
              {hasOriginal && originalUrl && (
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
              disabled={previewBlob == null}
              onClick={() => setStaged(null)}
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
