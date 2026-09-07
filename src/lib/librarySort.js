// Library (Imported view) sorting. Playlists keep their own manual trackIds
// order and don't use any of this.
//
//   'added'   — by dateAdded; dir 'desc' = newest first (the default), 'asc' = oldest
//   'artist'  — grouped by artist, then title; dir 'asc' = A–Z, 'desc' = Z–A
//   'custom'  — the user's hand-dragged order (`order`, an array of track ids)
//   'liked'   — liked tracks first (2026-09-05); ties fall back to dateAdded
//               desc, same secondary order 'artist' ties use. `dir` is
//               ignored — there's one "Liked first" menu entry, not a pair.
//               Available alongside the others in Imported/playlists.
//   'likedAt' — Liked-view-only default: by likedAt, dir 'desc' = most
//               recently liked first (the view's default), 'asc' = oldest
//               like first. Never offered outside the Liked view — nothing
//               else has a meaningful likedAt to sort by.
//   'plays'   — "Most played" (2026-09-07): by play count desc, from the
//               `plays` map (trackId -> { seconds, plays }, this machine's
//               listening summed with every other machine's — see
//               src/lib/listening.js). Ties by time listened desc — 45 s of
//               listening with 0 plays outranks a track never touched —
//               then newest first. `dir` ignored.
//   'neverPlayed' — "Never played first": 0 plays on top (newest first),
//               then ascending play count. Deliberately NOT time-aware —
//               "never played" means 0 plays, however much it was skimmed.
//               `dir` ignored. Both are single menu entries like 'liked',
//               available wherever 'liked' is.

const collator = new Intl.Collator(undefined, { sensitivity: 'base', numeric: true });
const NO_PLAYS = new Map();

export function sortLibrary(tracks, sort = 'added', dir = 'desc', order = [], plays = NO_PLAYS) {
  if (sort === 'plays') {
    return [...tracks].sort((a, b) => {
      const av = plays.get(a.id);
      const bv = plays.get(b.id);
      const ap = av?.plays || 0;
      const bp = bv?.plays || 0;
      if (ap !== bp) return bp - ap;
      const as = av?.seconds || 0;
      const bs = bv?.seconds || 0;
      if (as !== bs) return bs - as;
      return b.dateAdded - a.dateAdded;
    });
  }

  if (sort === 'neverPlayed') {
    const playsOf = (t) => plays.get(t.id)?.plays || 0;
    return [...tracks].sort((a, b) => {
      const ap = playsOf(a);
      const bp = playsOf(b);
      if (ap !== bp) return ap - bp;
      return b.dateAdded - a.dateAdded;
    });
  }

  if (sort === 'custom') {
    const pos = new Map(order.map((id, i) => [id, i]));
    // anything missing from the saved order (e.g. imported while another sort
    // was active and reconcile hasn't run yet) falls to the end, newest first
    return [...tracks].sort((a, b) => {
      const ai = pos.has(a.id) ? pos.get(a.id) : Infinity;
      const bi = pos.has(b.id) ? pos.get(b.id) : Infinity;
      if (ai !== bi) return ai - bi;
      return b.dateAdded - a.dateAdded;
    });
  }

  if (sort === 'liked') {
    return [...tracks].sort((a, b) => {
      const al = a.liked ? 1 : 0;
      const bl = b.liked ? 1 : 0;
      if (al !== bl) return bl - al; // liked (1) before unliked (0)
      return b.dateAdded - a.dateAdded;
    });
  }

  if (sort === 'likedAt') {
    const s = dir === 'asc' ? 1 : -1;
    return [...tracks].sort((a, b) => s * ((a.likedAt || 0) - (b.likedAt || 0)));
  }

  if (sort === 'artist') {
    // dir flips the artist grouping only; within an artist, always title A–Z
    const s = dir === 'desc' ? -1 : 1;
    return [...tracks].sort(
      (a, b) =>
        s * collator.compare(a.artist || '', b.artist || '') ||
        collator.compare(a.title || '', b.title || '') ||
        b.dateAdded - a.dateAdded
    );
  }

  // 'added'
  return [...tracks].sort((a, b) =>
    dir === 'asc' ? a.dateAdded - b.dateAdded : b.dateAdded - a.dateAdded
  );
}

// Keep the saved custom order in sync with the actual library: drop ids whose
// track is gone, prepend ids that are new (newest first). Returns `prev`
// unchanged when nothing moved, so callers can skip a needless state write.
export function reconcileLibraryOrder(prev, tracks) {
  // tracks empty == not loaded from IndexedDB yet (or a genuinely empty
  // library). Either way, don't touch a saved order we can't validate.
  if (tracks.length === 0) return prev;
  const live = new Set(tracks.map((t) => t.id));
  const kept = prev.filter((id) => live.has(id));
  const known = new Set(kept);
  const added = tracks
    .filter((t) => !known.has(t.id))
    .sort((a, b) => b.dateAdded - a.dateAdded)
    .map((t) => t.id);
  if (added.length === 0 && kept.length === prev.length) return prev;
  return [...added, ...kept];
}
