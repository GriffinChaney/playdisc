// Content hash of a track's embedded artwork, so the playlist-cover mosaic can
// tell visually-distinct covers apart. Album art embedded by one ripper at one
// quality is frequently byte-length-identical across different images, so a
// size check would collapse different covers into one tile — the exact bug the
// mosaic exists to avoid. We hash the actual bytes instead.
//
// Cached by track id, so each blob is read and digested once, not once per
// render. Artwork used to be immutable after import, which made that cache
// permanent for a track's whole session — no longer true now that cover
// editing (CoverEditModal) can change/reset/clear a track's artworkBlob at
// runtime. handleSaveCover calls invalidateArtworkHash() on every save, so a
// stale hash is never read back after an edit.

const cache = new Map(); // trackId -> hex string | in-flight Promise<string|null>

// Drop a track's cached hash — call this whenever its artworkBlob changes.
export function invalidateArtworkHash(trackId) {
  cache.delete(trackId);
}

// Synchronously resolved hashes for a set of tracks, or null if any is still
// pending / unread. Lets the mosaic hook skip the loading state on a revisit.
export function peekArtworkHashes(tracks) {
  const out = [];
  for (const t of tracks) {
    const hit = cache.get(t.id);
    if (typeof hit !== 'string') return null;
    out.push(hit);
  }
  return out;
}

export function getArtworkHash(trackId, blob) {
  if (!blob) return Promise.resolve(null);
  const hit = cache.get(trackId);
  if (hit != null) return Promise.resolve(hit); // string or in-flight Promise

  const p = (async () => {
    try {
      const buf = await blob.arrayBuffer();
      const digest = await crypto.subtle.digest('SHA-256', buf);
      const hex = Array.from(new Uint8Array(digest))
        .map((b) => b.toString(16).padStart(2, '0'))
        .join('');
      cache.set(trackId, hex);
      return hex;
    } catch {
      // don't poison the cache — a later revisit can retry
      cache.delete(trackId);
      return null;
    }
  })();

  cache.set(trackId, p);
  return p;
}
