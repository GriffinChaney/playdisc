// Note tiers: flagged-incomplete (0) → incomplete (1) → complete (2).
export function noteRank(n) {
  return n.complete ? 2 : n.priority ? 0 : 1;
}

// Ordering shared by the "Versions & notes…" modal and the now-playing panel
// so they always agree. Partition by tier, and *within* a tier keep the raw
// array order — that array order is the source of truth for manual
// drag-to-reorder (Array.prototype.sort is stable, so a rank-only compare is
// exactly a stable partition). `priority` / `dateAdded` are optional on
// older records.
export function sortNotes(notes = []) {
  return [...notes].sort((a, b) => noteRank(a) - noteRank(b));
}
