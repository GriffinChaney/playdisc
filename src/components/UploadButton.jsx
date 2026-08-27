import { useRef } from 'react';

const ACCEPTED = '.mp3,.wav,.flac,.m4a,.aac,.ogg,audio/*';

export default function UploadButton({ onFilesSelected }) {
  const inputRef = useRef(null);

  function handleChange(e) {
    const files = Array.from(e.target.files || []);
    if (files.length) onFilesSelected(files);
    e.target.value = ''; // allow re-selecting the same file later
  }

  return (
    <>
      <button className="upload-btn" onClick={() => inputRef.current?.click()}>
        upload song
      </button>
      <input
        ref={inputRef}
        type="file"
        accept={ACCEPTED}
        multiple
        style={{ display: 'none' }}
        onChange={handleChange}
      />
    </>
  );
}
