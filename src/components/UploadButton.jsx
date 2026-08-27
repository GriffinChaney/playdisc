import { useRef } from 'react';

const AUDIO_EXTENSIONS = ['mp3', 'wav', 'flac', 'm4a', 'aac', 'ogg'];
const ACCEPTED = AUDIO_EXTENSIONS.map((ext) => `.${ext}`).join(',') + ',audio/*';

function isAudioFile(file) {
  const ext = file.name.split('.').pop()?.toLowerCase();
  return !!ext && AUDIO_EXTENSIONS.includes(ext);
}

// One button, one native dialog: window.electronAPI.selectAudioImport()
// (see electron/main.js) opens a real macOS open panel with BOTH files and
// folders selectable at once — something an HTML <input type="file"> can't
// do (it's file-only or folder-only, never both). Whatever's picked gets
// scanned recursively for audio in the main process and handed back ready
// to import, so from here it's just "select anything, it figures out what
// you meant."
export default function UploadButton({ onFilesSelected }) {
  const fileInputRef = useRef(null);

  // Fallback for `npm run dev` in a plain browser tab, where there's no
  // Electron main process to ask — same old file-only picker as before.
  function handleFallbackChange(e) {
    const files = Array.from(e.target.files || []).filter(isAudioFile);
    if (files.length) onFilesSelected(files);
    e.target.value = '';
  }

  async function handleClick() {
    if (!window.electronAPI?.selectAudioImport) {
      fileInputRef.current?.click();
      return;
    }
    const entries = await window.electronAPI.selectAudioImport();
    if (!entries.length) return;
    // read one file at a time (not Promise.all) — sending every file's
    // full bytes through IPC in one go crashed the app on a real folder
    // of WAVs, since that one giant message overwhelmed V8's serializer
    const files = [];
    for (const entry of entries) {
      try {
        const data = await window.electronAPI.readAudioFile(entry.path);
        files.push(new File([data], entry.name));
      } catch (err) {
        console.error('[import] failed to read', entry.path, err);
      }
    }
    if (files.length) onFilesSelected(files);
  }

  return (
    <>
      <button className="upload-btn" onClick={handleClick}>
        upload song
      </button>
      <input
        ref={fileInputRef}
        type="file"
        accept={ACCEPTED}
        multiple
        style={{ display: 'none' }}
        onChange={handleFallbackChange}
      />
    </>
  );
}
