import { useEffect, useRef } from 'react';

const AUDIO_EXTENSIONS = ['mp3', 'wav', 'flac', 'm4a', 'aac', 'ogg'];
const ACCEPTED = AUDIO_EXTENSIONS.map((ext) => `.${ext}`).join(',') + ',audio/*';

function isAudioFile(file) {
  const ext = file.name.split('.').pop()?.toLowerCase();
  return !!ext && AUDIO_EXTENSIONS.includes(ext);
}

export default function UploadButton({ onFilesSelected }) {
  const fileInputRef = useRef(null);
  const folderInputRef = useRef(null);

  // webkitdirectory has to be set as a DOM property, not a JSX attribute —
  // React doesn't recognize it and won't reliably reflect it onto the
  // actual <input>, so it's applied imperatively here instead.
  useEffect(() => {
    if (folderInputRef.current) {
      folderInputRef.current.webkitdirectory = true;
    }
  }, []);

  function handleFilesChange(e) {
    const files = Array.from(e.target.files || []);
    if (files.length) onFilesSelected(files);
    e.target.value = ''; // allow re-selecting the same file later
  }

  function handleFolderChange(e) {
    const all = Array.from(e.target.files || []);
    // webkitdirectory hands back every file under the chosen folder,
    // already flattened recursively through any nested subfolders — no
    // manual walking needed. Just filter down to files that look like
    // audio so junk (.DS_Store, artwork, project files, etc.) is skipped.
    const audioFiles = all.filter(isAudioFile);
    if (audioFiles.length) {
      onFilesSelected(audioFiles);
    } else if (all.length) {
      alert('No supported audio files (mp3/wav/flac/m4a/aac/ogg) found in that folder.');
    }
    e.target.value = '';
  }

  return (
    <>
      <button className="upload-btn" onClick={() => fileInputRef.current?.click()}>
        upload song
      </button>
      <button className="upload-btn" onClick={() => folderInputRef.current?.click()}>
        import folder
      </button>
      <input
        ref={fileInputRef}
        type="file"
        accept={ACCEPTED}
        multiple
        style={{ display: 'none' }}
        onChange={handleFilesChange}
      />
      <input
        ref={folderInputRef}
        type="file"
        multiple
        style={{ display: 'none' }}
        onChange={handleFolderChange}
      />
    </>
  );
}
