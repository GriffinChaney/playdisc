import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { resizeImage } from '../lib/imageResize';

const DESC_MAX = 300;

// Full playlist editor: name, optional description (shown atop the middle
// column), optional cover image (same). Controlled from App: pass the
// `playlist` record or null. Save commits all three at once; Esc / click
// outside cancels.
export default function PlaylistEditModal({ playlist, onClose, onSave }) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [imageBlob, setImageBlob] = useState(null);
  const [preview, setPreview] = useState(null);
  const [working, setWorking] = useState(false);
  const [dragActive, setDragActive] = useState(false);
  const fileRef = useRef(null);

  useEffect(() => {
    if (!playlist) return;
    setName(playlist.name || '');
    setDescription(playlist.description || '');
    setImageBlob(playlist.imageBlob || null);
  }, [playlist]);

  // keep a live object-URL preview for whatever image blob is staged
  useEffect(() => {
    if (!imageBlob) {
      setPreview(null);
      return;
    }
    const url = URL.createObjectURL(imageBlob);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [imageBlob]);

  useEffect(() => {
    // only while the modal is actually open — otherwise this capture-phase
    // stopPropagation would swallow Escape for the rest of the app (e.g.
    // clearing a track selection) even when nothing is being edited
    if (!playlist) return;
    function onKey(e) {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
    }
    document.addEventListener('keydown', onKey, true);
    return () => document.removeEventListener('keydown', onKey, true);
  }, [playlist, onClose]);

  if (!playlist) return null;

  async function applyImageFile(file) {
    if (!file || !file.type.startsWith('image/')) return;
    setWorking(true);
    const resized = await resizeImage(file);
    setImageBlob(resized);
    setWorking(false);
  }

  function pickImage(e) {
    const file = e.target.files?.[0];
    e.target.value = '';
    applyImageFile(file);
  }

  function save() {
    const n = name.trim();
    if (!n) return;
    onSave(playlist.id, {
      name: n,
      description: description.trim(),
      imageBlob: imageBlob || null
    });
    onClose();
  }

  return createPortal(
    <div
      className="modal-overlay modal-overlay-blur"
      onMouseDown={onClose}
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => e.preventDefault()}
    >
      <div className="pl-edit-modal" onMouseDown={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>edit playlist</h2>
          <button className="modal-close-btn" onClick={onClose} aria-label="close">
            ✕
          </button>
        </div>

        <div className="pl-edit-body">
          <div className="pl-edit-cover">
            <button
              type="button"
              className={`pl-edit-cover-box${dragActive ? ' dragging' : ''}`}
              style={preview ? { backgroundImage: `url(${preview})` } : undefined}
              onClick={() => fileRef.current?.click()}
              onDragOver={(e) => {
                e.preventDefault();
                setDragActive(true);
              }}
              onDragLeave={() => setDragActive(false)}
              onDrop={(e) => {
                e.preventDefault();
                setDragActive(false);
                applyImageFile(e.dataTransfer.files?.[0]);
              }}
              aria-label="choose cover image"
            >
              {!preview && (
                <span>{working ? '…' : dragActive ? 'drop\nimage' : 'choose or\ndrop image'}</span>
              )}
            </button>
            {preview && (
              <button type="button" className="pl-edit-cover-remove" onClick={() => setImageBlob(null)}>
                remove image
              </button>
            )}
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              hidden
              onChange={pickImage}
            />
          </div>

          <div className="pl-edit-fields">
            <label className="pl-edit-label">
              name
              <input
                autoFocus
                className="pl-edit-input"
                value={name}
                onChange={(e) => setName(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && save()}
              />
            </label>
            <label className="pl-edit-label">
              description
              <textarea
                className="pl-edit-textarea"
                rows={3}
                maxLength={DESC_MAX}
                placeholder="optional — shows above the track list"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
              />
              <span className="pl-edit-count">
                {description.length}/{DESC_MAX}
              </span>
            </label>
          </div>
        </div>

        <div className="pl-edit-actions">
          <button className="prompt-modal-btn" onClick={onClose}>
            Cancel
          </button>
          <button className="prompt-modal-btn primary" onClick={save} disabled={!name.trim() || working}>
            Save
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
