import { makeVersion, importTitle } from './media';

// Build the track record for a freshly imported file. `meta` comes from
// readAudioMeta (media.js), `relPath` is where the copy landed relative to
// the library root, `fp` its fingerprint. Audio bytes are NOT stored on the
// record — only the relative path, via a single implicit version.
export function buildImportedTrack({ name, meta, relPath, fp }) {
  // the version's title: embedded tag title if present, else the filename
  // stem; the track-level title mirrors the active version's.
  const title = importTitle(meta, name);
  const artist = meta.artist || 'unknown artist';
  const version = makeVersion({
    title,
    relPath,
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
    dateAdded: Date.now(),
    updatedAt: Date.now() // sync merge stamp — see src/lib/syncMerge.js
  };
}
