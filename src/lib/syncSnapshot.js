import { isRelPath } from './media';

// Library snapshot <-> in-memory library. Pure: no IPC, no React. See
// docs/LIBRARY_SYNC_PLAN.md (stages 3–4).
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
// schemaless additions (liked/likedAt, originalArtist, updatedAt, notes
// stamps…) ride along automatically — same convention as patchTrack.
//
// Format 2 (stage 4): `tracks` / `playlists` also carry tombstones
// `{ id, deleted: true, updatedAt }`, and `libraryOrderUpdatedAt` rides
// alongside `libraryOrder`. Format 1 documents (stage 3) are still readable —
// their records just have no stamps, which the merge handles by falling
// back to the document's `writtenAt` (see syncMerge.js).
//
// `listening` (2026-09-07) is a schemaless addition at format 2, NOT a
// format bump: it's this machine's own listening rows (src/lib/listening.js),
// purely additive, and the merge never reads it — so a reader that predates
// it ignores the key and keeps merging everything else. A bump to 3 would
// have made a not-yet-updated machine skip the WHOLE snapshot (likes, tags,
// notes too) until it was updated — see runSync's READABLE_FORMATS check.

export const SNAPSHOT_FORMAT = 2;
export const READABLE_FORMATS = new Set([1, 2]);

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
export async function serializeLibrary({
  tracks,
  playlists,
  tombstones = [],
  libraryOrder,
  libraryOrderUpdatedAt = 0,
  listening = [],
  machineId
}) {
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

  for (const t of tombstones) {
    const entry = { id: t.id, deleted: true, updatedAt: t.updatedAt };
    if (t.kind === 'track') outTracks.push(entry);
    else if (t.kind === 'playlist') outPlaylists.push(entry);
  }

  return {
    doc: {
      format: SNAPSHOT_FORMAT,
      machineId,
      writtenAt: Date.now(),
      tracks: outTracks,
      playlists: outPlaylists,
      libraryOrder: Array.isArray(libraryOrder) ? libraryOrder : [],
      libraryOrderUpdatedAt,
      listening: Array.isArray(listening) ? listening : []
    },
    art
  };
}

// ---- reading records back --------------------------------------------------
//
// A record straight out of a snapshot is "snapshot-shaped": it carries
// `{ hash, ext }` art refs under `artwork` / `originalArtwork` / `image`. A
// live record carries `artworkBlob` / `originalArtworkBlob` / `imageBlob`.
// The merge is shape-agnostic (it only compares stamps and ids), so the
// winners it hands back may be either; App.jsx hydrates the snapshot-shaped
// ones with `getBlob(ref)` (a synchronous lookup into art already read).

export function isSnapshotShaped(rec) {
  return !!rec && ('artwork' in rec || 'image' in rec);
}

export function artRefsOf(rec) {
  const out = [];
  for (const k of ['artwork', 'originalArtwork', 'image']) if (rec && rec[k]) out.push(rec[k]);
  return out;
}

export function hydrateTrack(rec, getBlob) {
  const { artwork, originalArtwork, ...rest } = rec;
  const t = { ...rest, artworkBlob: artwork ? getBlob(artwork) : null };
  if (originalArtwork !== undefined) {
    t.originalArtworkBlob = originalArtwork ? getBlob(originalArtwork) : null;
  }
  return t;
}

export function hydratePlaylist(rec, getBlob) {
  const { image, ...rest } = rec;
  return { ...rest, imageBlob: image ? getBlob(image) : null };
}

// The same sanity rule App.jsx applies to IndexedDB on load: every version
// must carry a valid relPath. A remote track that fails this is never taken.
export function isValidTrack(t) {
  return (
    !!t &&
    typeof t.id === 'string' &&
    Array.isArray(t.versions) &&
    t.versions.length > 0 &&
    t.versions.every((v) => isRelPath(v?.relPath))
  );
}
