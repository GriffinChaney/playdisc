import { parseBlob } from 'music-metadata-browser';
import { fingerprint } from './mediaFingerprint';

// Every stored audio path is a `relPath`: relative to the per-machine library
// root (chosen in Settings, held by electron/main.js), POSIX slashes, e.g.
// "Artist — Title/title.wav". The renderer never holds an absolute path.
//
// This is the renderer-side half of the "fail loudly" contract from
// docs/LIBRARY_SYNC_PLAN.md: a record that somehow still carries an absolute
// path (or nothing at all) must throw at the first use, not silently
// produce a URL that 403s or an `undefined` that skips a delete.
export function assertRelPath(relPath, what = 'library path') {
  if (typeof relPath !== 'string' || !relPath.length) {
    throw new Error(`${what}: expected a relative path, got ${JSON.stringify(relPath)}`);
  }
  if (relPath.startsWith('/') || relPath.includes('\\') || /^[a-zA-Z]:/.test(relPath)) {
    throw new Error(`${what}: expected a path relative to the library folder, got an absolute path: ${relPath}`);
  }
  if (relPath.split('/').some((seg) => seg === '..' || seg === '')) {
    throw new Error(`${what}: malformed relative path: ${relPath}`);
  }
  return relPath;
}

// non-throwing form, for "is this record even usable" checks (the legacy
// library gate in App.jsx)
export function isRelPath(relPath) {
  try {
    assertRelPath(relPath);
    return true;
  } catch {
    return false;
  }
}

// Playback URL for a stored file — served by the playdisc-media:// protocol
// in electron/main.js, which resolves the relPath against the root with the
// same guards (range requests supported). Throws on a bad relPath; callers
// pass null/undefined only when there's genuinely no version to play.
export function mediaUrl(relPath) {
  if (relPath == null) return null;
  return `playdisc-media://f/${encodeURIComponent(assertRelPath(relPath, 'mediaUrl'))}`;
}

const MIME_EXT = {
  'audio/mpeg': 'mp3',
  'audio/mp3': 'mp3',
  'audio/wav': 'wav',
  'audio/x-wav': 'wav',
  'audio/wave': 'wav',
  'audio/flac': 'flac',
  'audio/x-flac': 'flac',
  'audio/mp4': 'm4a',
  'audio/x-m4a': 'm4a',
  'audio/aac': 'aac',
  'audio/ogg': 'ogg'
};

export function extFromName(name = '') {
  const m = /\.([a-z0-9]+)$/i.exec(name);
  return m ? m[1].toLowerCase() : '';
}

export function extFromBlob(blob) {
  return MIME_EXT[blob?.type] || '';
}

// Sniff the real container from the first bytes — the only reliable source
// (old blobs carried no MIME type, and tags can lie). `bytes` is an
// ArrayBuffer or typed array.
export function sniffExt(bytes) {
  const b = bytes instanceof ArrayBuffer ? new Uint8Array(bytes) : new Uint8Array(bytes.buffer || bytes);
  if (b.length < 12) return '';
  const ascii = (i, n) => String.fromCharCode(...b.subarray(i, i + n));
  if (ascii(0, 4) === 'RIFF' && ascii(8, 4) === 'WAVE') return 'wav';
  if (ascii(0, 4) === 'fLaC') return 'flac';
  if (ascii(0, 4) === 'OggS') return 'ogg';
  if (ascii(0, 3) === 'ID3') return 'mp3';
  if (b[0] === 0xff && (b[1] & 0xe0) === 0xe0) return 'mp3'; // MPEG frame sync
  if (ascii(4, 4) === 'ftyp') return 'm4a'; // MP4/M4A
  if (ascii(0, 4) === 'FORM' && ascii(8, 4) === 'AIFF') return 'aiff';
  return '';
}

// Read tags / duration / format from raw bytes (ArrayBuffer or typed array).
// Mirrors parseTrack's shape but works off bytes, not a File.
export async function readAudioMeta(bytes, name = '') {
  const blob = new Blob([bytes]);
  let duration = 0;
  let format = null;
  let title = name.replace(/\.[^/.]+$/, '') || null;
  let taggedTitle = null; // the raw embedded tag title, or null if none
  let artist = null;
  let picture = null;
  try {
    const meta = await parseBlob(blob);
    if (meta.common.title) {
      title = meta.common.title;
      taggedTitle = meta.common.title;
    }
    if (meta.common.artist) artist = meta.common.artist;
    if (meta.format?.duration) duration = meta.format.duration;
    const f = meta.format || {};
    format = {
      codec: f.codec || f.container || null,
      sampleRate: f.sampleRate || null,
      bitrate: f.bitrate || null,
      bitsPerSample: f.bitsPerSample || null,
      channels: f.numberOfChannels || null,
      lossless: typeof f.lossless === 'boolean' ? f.lossless : null
    };
    picture = meta.common.picture?.[0] || null;
  } catch (err) {
    console.warn('[media] metadata read failed for', name, err);
  }
  return { duration, format, title, taggedTitle, artist, picture };
}

export { fingerprint };

// a display title from a source filename — the stem, extension stripped.
// Versions take their title from the file they were imported from (never an
// embedded tag), so what plays is what you see in the library.
export function titleFromName(name = '') {
  return name.replace(/\.[^/.]+$/, '').trim() || 'untitled';
}

// The title to give a freshly imported file/version: the embedded tag title
// if the file has one, otherwise the filename stem. WIP bounces with no tags
// keep showing their filenames; proper releases show their clean tag title.
export function importTitle(meta, name) {
  return (meta?.title && meta.title.trim()) || titleFromName(name);
}

// make a fresh version record from an already-read file. `originalTitle` is
// the title as derived at import time — kept immutable so a rename can be
// reverted (see VersionsModal's "reset").
export function makeVersion({
  title = 'untitled',
  originalTitle,
  relPath,
  duration = 0,
  format = null,
  fp = null
}) {
  return {
    id: crypto.randomUUID(),
    title,
    originalTitle: originalTitle ?? title,
    relPath: assertRelPath(relPath, 'makeVersion'),
    duration,
    format,
    fingerprint: fp,
    dateAdded: Date.now()
  };
}

// every version across the whole library, tagged with its owning track
export function allVersions(tracks) {
  const out = [];
  for (const t of tracks) for (const v of t.versions || []) out.push({ track: t, version: v });
  return out;
}

export function activeVersion(track) {
  if (!track?.versions?.length) return null;
  return track.versions.find((v) => v.id === track.activeVersionId) || track.versions[0];
}

// the title to show for a track anywhere in the UI: the active version's own
// title, falling back to the track-level title for pre-versioning records.
export function displayTitle(track) {
  return activeVersion(track)?.title || track?.title || 'untitled';
}
