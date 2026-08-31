import { makeVersion } from './media';

// Build the track record for a freshly imported file. `meta` comes from
// readAudioMeta (media.js), `storedPath` is the copy already placed in the
// library, `fp` its fingerprint. Audio bytes are NOT stored on the record —
// only the on-disk path, via a single implicit version.
export function buildImportedTrack({ name, meta, storedPath, fp }) {
  const title = meta.title || name.replace(/\.[^/.]+$/, '') || 'untitled';
  const artist = meta.artist || 'unknown artist';
  const version = makeVersion({
    label: '',
    filePath: storedPath,
    duration: meta.duration || 0,
    format: meta.format,
    fp
  });
  return {
    id: crypto.randomUUID(),
    title,
    artist,
    duration: version.duration,
    artworkBlob: meta.picture ? new Blob([meta.picture.data], { type: meta.picture.format }) : null,
    audio: version.format,
    activeVersionId: version.id,
    versions: [version],
    notes: [],
    tags: [],
    dateAdded: Date.now()
  };
}
