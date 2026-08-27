import { useCallback, useEffect, useRef, useState } from 'react';

// Multi-select for a vertical list (tracks or playlists), shared so both
// behave identically.
//
//  - ⌘/ctrl + mousedown then drag  -> paints a contiguous RANGE from the
//    anchor row to whatever row the cursor is currently over. Rebuilt every
//    mousemove, so it never skips a row however fast you drag.
//  - shift + click                 -> extends the range from the anchor.
//  - plain click                   -> clears the selection.
//  - Escape                        -> clears.
//
// Every selectable row must render `data-sel-id="<id>"` so the drag can
// hit-test with elementFromPoint. `getOrderedIds()` must return the ids in
// current on-screen order.
export function useListSelection(getOrderedIds) {
  const [selectedIds, setSelectedIds] = useState(() => new Set());
  const selectedRef = useRef(selectedIds);
  selectedRef.current = selectedIds;
  const orderedRef = useRef(getOrderedIds);
  orderedRef.current = getOrderedIds;

  const anchorIdRef = useRef(null);
  const dragRef = useRef(null); // { mode: 'add' | 'remove', base: Set }

  const clearSelection = useCallback(() => {
    setSelectedIds((prev) => (prev.size ? new Set() : prev));
  }, []);

  const applyRange = useCallback((targetId) => {
    const drag = dragRef.current;
    if (!drag) return;
    const ids = orderedRef.current();
    const a = ids.indexOf(anchorIdRef.current);
    const b = ids.indexOf(targetId);
    if (a === -1 || b === -1) return;
    const [lo, hi] = a < b ? [a, b] : [b, a];
    const next = new Set(drag.base);
    for (let i = lo; i <= hi; i++) {
      if (drag.mode === 'add') next.add(ids[i]);
      else next.delete(ids[i]);
    }
    setSelectedIds(next);
  }, []);

  useEffect(() => {
    // primary path is per-row onItemMouseOver (below); this document listener
    // is a backstop for when the cursor moves so fast it skips every row's
    // mouseover, or leaves the list — elementFromPoint still finds the row.
    function onMove(e) {
      if (!dragRef.current) return;
      const row = document.elementFromPoint(e.clientX, e.clientY)?.closest('[data-sel-id]');
      if (row) applyRange(row.getAttribute('data-sel-id'));
    }
    function onUp(e) {
      if (dragRef.current) {
        const row = document.elementFromPoint(e.clientX, e.clientY)?.closest('[data-sel-id]');
        if (row) applyRange(row.getAttribute('data-sel-id'));
      }
      dragRef.current = null;
    }
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
    return () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    };
  }, [applyRange]);

  // call from a row's onMouseOver — fills the range anchor -> this row while
  // a ⌘-drag is in progress. Fires reliably even on fast drags that skip
  // intermediate rows, because it always rebuilds the whole range.
  const onItemMouseOver = useCallback(
    (id) => {
      if (dragRef.current) applyRange(id);
    },
    [applyRange]
  );

  useEffect(() => {
    function onKey(e) {
      if (e.key === 'Escape') clearSelection();
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [clearSelection]);

  // call from a row's onMouseDown. Returns true if it began a paint-drag
  // (⌘/ctrl held) so the caller can skip its own mousedown behaviour.
  const onItemMouseDown = useCallback((id, e) => {
    if (!e.metaKey && !e.ctrlKey) return false;
    e.preventDefault(); // no text selection / native drag while painting
    const prev = selectedRef.current;
    const already = prev.has(id);
    const next = new Set(prev);
    if (already) next.delete(id);
    else next.add(id);
    dragRef.current = { mode: already ? 'remove' : 'add', base: next };
    anchorIdRef.current = id;
    setSelectedIds(next);
    return true;
  }, []);

  // call from a row's onClick. Returns 'plain' when the caller should do its
  // normal single-click thing (view the track / playlist), else 'modifier'.
  const onItemClick = useCallback(
    (id, e) => {
      if (e.metaKey || e.ctrlKey) return 'modifier';
      if (e.shiftKey && anchorIdRef.current) {
        const ids = orderedRef.current();
        const a = ids.indexOf(anchorIdRef.current);
        const b = ids.indexOf(id);
        if (a !== -1 && b !== -1) {
          const [lo, hi] = a < b ? [a, b] : [b, a];
          setSelectedIds((prev) => {
            const nextSet = new Set(prev);
            for (let i = lo; i <= hi; i++) nextSet.add(ids[i]);
            return nextSet;
          });
        }
        return 'modifier';
      }
      anchorIdRef.current = id;
      clearSelection();
      return 'plain';
    },
    [clearSelection]
  );

  return {
    selectedIds,
    setSelectedIds,
    clearSelection,
    onItemMouseDown,
    onItemMouseOver,
    onItemClick
  };
}
