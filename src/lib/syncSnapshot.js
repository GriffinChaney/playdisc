import { isRelPath } from './media';

// Library snapshot <-> in-memory library. Pure: no IPC, no React. See
// docs/LIBRARY_SYNC_PLAN.md (stage 3).
//
// A snapshot is one JSON document per machine, `<root>/.playdisc/sync/
// <machineId>.json`, holding that machine's entire library: every track and
// playlist record verbatim EXCEPT the binary fields, which become content-
// addressed references to files in `<root>/.playdisc/art/<sha256>.<ext>`.
// Art files are immutable and shared (many tracks carry the same cover), so
// they never conflict and dedupe for free; the JSON stays small enough to
// rewrite on every like.
//
// Records are spread through (`{ ...t }` minus blobs), not whitelisted, so
// schemaless additions (liked/likedAt, originalArtist, ...) ride along
// automatically — same convention as patchTrack/updateTrack.

export const SNAPSHOT_FORMAT = 1;

const EXT_BY_TYPE = {
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif'
};
const TYPE_BY_EXT = {
  jpg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  gif: 'image/gif'
};

export function artExt(blob) {
  return EXT_BY_TYPE[blob?.type] || 'bin';
}
export function artType(ext) {
  return TYPE_BY_EXT[ext] || 'application/octet-stream';
}
export function artFileName({ hash, ext }) {
  return `${hash}.${ext}`;
}

// SHA-256 of a blob's bytes, cached per Blob *object* — blobs in React
// state are stable identities until an edit replaces them, so each cover is
// digested once per session, not once per snapshot write.
const hashCache = new WeakMap();
export async function blobHash(blob) {
  const hit = hashCache.get(blob);
  if (hit) return hit;
  const p = (async () => {
    const digest = await crypto.subtle.digest('SHA-256', await blob.arrayBuffer());
    return Array.from(new Uint8Array(digest))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');
  })();
  hashCache.set(blob, p);
  return p;
}

// { doc, art } — `doc` is the JSON-ready snapshot, `art` a Map of
// "<hash>.<ext>" -> Blob for every art file the doc references (the caller
// decides which of those actually need writing).
export async function serializeLibrary({ tracks, playlists, libraryOrder, machineId }) {
  const art = new Map();
  const ref = async (blob) => {
    const hash = await blobHash(blob);
    const ext = artExt(blob);
    art.set(artFileName({ hash, ext }), blob);
    return { hash, ext };
  };

  const outTracks = [];
  for (const t of tracks) {
    const { artworkBlob, originalArtworkBlob, ...rest } = t;
    const rec = { ...rest, artwork: artworkBlob ? await ref(artworkBlob) : null };
    // tri-state, mirrored exactly: absent = never edited (CoverEditModal
    // treats the current art as the original), null = edited from no art,
    // blob = the imported art captured on first edit
    if (originalArtworkBlob !== undefined) {
      rec.originalArtwork = originalArtworkBlob ? await ref(originalArtworkBlob) : null;
    }
    outTracks.push(rec);
  }

  const outPlaylists = [];
  for (const p of playlists) {
    const { imageBlob, ...rest } = p;
    outPlaylists.push({ ...rest, image: imageBlob ? await ref(imageBlob) : null });
  }

  return {
    doc: {
      format: SNAPSHOT_FORMAT,
      machineId,
      writtenAt: Date.now(),
      tracks: outTracks,
      playlists: outPlaylists,
      libraryOrder: Array.isArray(libraryOrder) ? libraryOrder : []
    },
    art
  };
}

// Reverse of serializeLibrary. `readArt({ hash, ext })` resolves to a Blob or
// null (missing art file -> the track just has no cover, which is the
// honest state — the file may still be on its way through Dropbox).
// `onProgress(done, total)` is optional. Each distinct art file is read once.
export async function hydrateLibrary(doc, readArt, onProgress) {
  if (!doc || doc.format !== SNAPSHOT_FORMAT) {
    throw new Error(`unsupported snapshot format: ${doc?.format}`);
  }
  const memo = new Map();
  const load = (r) => {
    const key = artFileName(r);
    if (!memo.has(key)) memo.set(key, readArt(r));
    return memo.get(key);
  };

  const total = (doc.tracks?.length || 0) + (doc.playlists?.length || 0);
  let done = 0;
  const tick = () => onProgress?.(++done, total);

  const tracks = [];
  for (const r of doc.tracks || []) {
    const { artwork, originalArtwork, ...rest } = r;
    const t = { ...rest, artworkBlob: artwork ? await load(artwork) : null };
    if (originalArtwork !== undefined) {
      t.originalArtworkBlob = originalArtwork ? await load(originalArtwork) : null;
    }
    tracks.push(t);
    tick();
  }

  const playlists = [];
  for (const r of doc.playlists || []) {
    const { image, ...rest } = r;
    playlists.push({ ...rest, imageBlob: image ? await load(image) : null });
    tick();
  }

  return { tracks, playlists, libraryOrder: Array.isArray(doc.libraryOrder) ? doc.libraryOrder : [] };
}

// The same sanity rule App.jsx applies to IndexedDB on load: every version
// must carry a valid relPath. A snapshot that fails this is refused whole.
export function findInvalidTrack(tracks) {
  return (
    tracks.find(
      (t) =>
        !t ||
        typeof t.id !== 'string' ||
        !Array.isArray(t.versions) ||
        !t.versions.length ||
        t.versions.some((v) => !isRelPath(v?.relPath))
    ) || null
  );
}
