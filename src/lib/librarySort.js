// Library (Imported view) sorting. Playlists keep their own manual trackIds
// order and don't use any of this.
//
//   'added'  — by dateAdded; dir 'desc' = newest first (the default), 'asc' = oldest
//   'artist' — grouped by artist, then title; dir 'asc' = A–Z, 'desc' = Z–A
//   'custom' — the user's hand-dragged order (`order`, an array of track ids)

const collator = new Intl.Collator(undefined, { sensitivity: 'base', numeric: true });

export function sortLibrary(tracks, sort = 'added', dir = 'desc', order = []) {
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
