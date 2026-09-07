// Global tag order — ONE array of tag strings, shared across every view
// (Imported, Liked, playlists, artist pages). Reordering a tag chip in any
// view moves it here; every view reads the same order, so "reorder in
// Imported, see it everywhere" falls out for free rather than needing
// per-view state. Persisted to localStorage.tagOrder in App.jsx. Unlike
// libraryOrder, this is NOT part of the sync snapshot — it's a per-machine
// display preference, not library data (see docs/LIBRARY_SYNC_PLAN.md's
// "stays local" bucket). Easy to add to sync later if that's wanted; ask
// before doing it, it touches syncSnapshot.js/syncMerge.js.

// Keep the saved order in sync with the tags actually used anywhere in the
// WHOLE library (every track, not just one view): drop tags no longer used
// by anything, append newly-seen tags (alphabetically) at the end. Mirrors
// reconcileLibraryOrder's contract exactly, including the same reason for
// the tracks.length === 0 guard — an empty `tracks` array on first render
// means "not loaded from IndexedDB yet," not "the library is genuinely
// empty," and reconciling against it would wipe a real saved order out
// from under a page that just hasn't finished loading. Returns `prev`
// unchanged when nothing moved, so callers can skip a needless state write.
export function reconcileTagOrder(prev, tracks) {
  if (tracks.length === 0) return prev;
  const live = new Set();
  tracks.forEach((t) => (t.tags || []).forEach((tag) => live.add(tag)));
  const kept = prev.filter((tag) => live.has(tag));
  const known = new Set(kept);
  const added = Array.from(live)
    .filter((tag) => !known.has(tag))
    .sort();
  if (added.length === 0 && kept.length === prev.length) return prev;
  return [...kept, ...added];
}

// Order a view's own tag set (whatever's present on ITS tracks — Liked only
// ever shows tags that are actually on a liked track, same as before) by
// the global order. `extra` is a defensive fallback for the brief window
// before the reconcile effect above has run once; in steady state every
// live tag is already in `order` so this is a no-op filter.
export function orderTags(tags, order) {
  const set = new Set(tags);
  const known = order.filter((t) => set.has(t));
  const extra = tags.filter((t) => !order.includes(t)).sort();
  return [...known, ...extra];
}

// Move `draggedTag` to just before/after `targetTag` in the GLOBAL order —
// even when the two are being dragged within one view's filtered subset,
// this is the right operation: any tags between them that aren't shown in
// this view keep their relative position to each other, only draggedTag's
// position relative to targetTag changes. Returns `order` unchanged (not a
// copy) if either tag isn't found, so callers can skip a needless write.
export function reorderTags(order, draggedTag, targetTag, before) {
  if (draggedTag === targetTag) return order;
  const list = [...order];
  const fromIndex = list.indexOf(draggedTag);
  if (fromIndex === -1) return order;
  list.splice(fromIndex, 1);
  let atIndex = list.indexOf(targetTag);
  if (atIndex === -1) return order;
  if (!before) atIndex += 1;
  list.splice(atIndex, 0, draggedTag);
  return list;
}
