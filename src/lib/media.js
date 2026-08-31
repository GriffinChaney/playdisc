import { parseBlob } from 'music-metadata-browser';
import { fingerprint } from './mediaFingerprint';

// Playback URL for a stored file — served by the sona-media:// protocol in
// electron/main.js (streams from ~/Music/Sona Library with range support).
export function mediaUrl(filePath) {
  return filePath ? `sona-media://f/${encodeURIComponent(filePath)}` : null;
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
  let artist = null;
  let picture = null;
  try {
    const meta = await parseBlob(blob);
    if (meta.common.title) title = meta.common.title;
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
  return { duration, format, title, artist, picture };
}

export { fingerprint };

// make a fresh version record from an already-read file
export function makeVersion({ label = '', filePath, duration = 0, format = null, fp = null }) {
  return {
    id: crypto.randomUUID(),
    label,
    filePath,
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
