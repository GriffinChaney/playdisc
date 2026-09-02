import { useCallback, useRef, useState } from 'react';
import { noteRank } from './notes';

// Drag-to-reorder for notes, shared by the "Versions & notes…" modal and the
// now-playing panel. Drag is constrained to a single tier (flagged /
// incomplete / complete) — the drop indicator only shows when the dragged
// note and the row under the cursor are the same tier, and App's
// handleReorderNote enforces the same rule.
export function useNoteReorder(trackId, onReorderNote) {
  const dragRef = useRef(null); // { id, rank }
  const [dropTarget, setDropTarget] = useState(null); // { id, before }

  const onHandleDragStart = useCallback((note, e) => {
    dragRef.current = { id: note.id, rank: noteRank(note) };
    e.dataTransfer.effectAllowed = 'move';
    try {
      e.dataTransfer.setData('text/plain', note.id); // Firefox needs data set
    } catch {
      /* noop */
    }
  }, []);

  const onRowDragOver = useCallback((note, e) => {
    const d = dragRef.current;
    if (!d || d.id === note.id || noteRank(note) !== d.rank) return;
    e.preventDefault();
    const r = e.currentTarget.getBoundingClientRect();
    const before = e.clientY < r.top + r.height / 2;
    setDropTarget((prev) =>
      prev && prev.id === note.id && prev.before === before ? prev : { id: note.id, before }
    );
  }, []);

  const onRowDrop = useCallback(
    (note, e) => {
      const d = dragRef.current;
      const dt = dropTarget;
      dragRef.current = null;
      setDropTarget(null);
      if (!d || !dt || dt.id !== note.id) return;
      e.preventDefault();
      onReorderNote(trackId, d.id, note.id, dt.before);
    },
    [dropTarget, onReorderNote, trackId]
  );

  const onDragEnd = useCallback(() => {
    dragRef.current = null;
    setDropTarget(null);
  }, []);

  return { dropTarget, onHandleDragStart, onRowDragOver, onRowDrop, onDragEnd };
}
