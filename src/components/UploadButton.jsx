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
    // hands the {name, path} descriptors straight to onFilesSelected —
    // reading each file's actual bytes happens in App.jsx's
    // handleFilesSelected now, inside the same loop that reports import
    // progress, so the progress bar shows up immediately instead of after
    // everything's already been read
    if (entries.length) onFilesSelected(entries);
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
