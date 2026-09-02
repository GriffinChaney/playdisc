import { useCallback, useEffect, useRef, useState } from 'react';
import { noteRank } from './notes';

const HOLD_MS = 220;
const MOVE_CANCEL_PX = 10; // moving this far before the hold fires = a scroll, not a drag

// Press-and-hold drag-to-reorder for notes (Apple Reminders style), shared by
// the "Versions & notes…" modal and the now-playing panel.
//
//  - press anywhere on a row and hold ~220ms → the row lifts and follows the
//    cursor. Moving more than ~10px before the hold cancels it (treated as a
//    scroll / flick).
//  - a quick tap does nothing here; the row's own onClick still fires (e.g.
//    tap the text to edit). After a real drag, the trailing click is
//    swallowed via clickGuard().
//  - constrained to one tier: the drop indicator only appears over rows of
//    the same tier as the dragged note (flagged / incomplete / complete),
//    and App's handleReorderNote enforces it too.
//
// `notes` must be the list in display order. The dragged row is translated
// imperatively (no per-frame re-render); only draggingId / dropTarget are
// state.
export function useNoteReorder(trackId, notes, onReorderNote) {
  const [draggingId, setDraggingId] = useState(null);
  const [dropTarget, setDropTarget] = useState(null); // { id, before }

  const rowEls = useRef({});
  const s = useRef({});
  const notesRef = useRef(notes);
  notesRef.current = notes;
  const dropRef = useRef(null);
  dropRef.current = dropTarget;
  const suppressClickRef = useRef(false);

  const end = useCallback(() => {
    const cur = s.current;
    clearTimeout(cur.holdTimer);
    window.removeEventListener('pointermove', cur.onMove);
    window.removeEventListener('pointerup', cur.onUp);
    const el = cur.note && rowEls.current[cur.note.id];
    if (el) el.style.transform = '';
    s.current = {};
    setDraggingId(null);
    setDropTarget(null);
  }, []);

  useEffect(() => end, [end]); // tidy up if unmounted mid-drag

  const onPointerDown = useCallback(
    (note, e) => {
      if (e.button !== 0) return;
      if (note.complete) return; // completed notes are pinned to the bottom
      // let the checkbox / star / delete / edit-input handle their own clicks
      if (e.target.closest('button, input, textarea, a')) return;

      const startX = e.clientX;
      const startY = e.clientY;
      const cur = (s.current = { note, startY, lastY: startY, dragging: false });

      cur.onMove = (ev) => {
        cur.lastY = ev.clientY;
        if (!cur.dragging) {
          if (Math.hypot(ev.clientX - startX, ev.clientY - startY) > MOVE_CANCEL_PX) end();
          return;
        }
        const el = rowEls.current[cur.note.id];
        if (el) el.style.transform = `translateY(${ev.clientY - cur.dragStartY}px)`;

        const row = document
          .elementFromPoint(ev.clientX, ev.clientY)
          ?.closest('[data-note-id]');
        const id = row?.getAttribute('data-note-id');
        const target = id && notesRef.current.find((n) => n.id === id);
        if (target && id !== cur.note.id && noteRank(target) === noteRank(cur.note)) {
          const r = row.getBoundingClientRect();
          const before = ev.clientY < r.top + r.height / 2;
          if (dropRef.current?.id !== id || dropRef.current?.before !== before) {
            setDropTarget({ id, before });
          }
        } else if (dropRef.current) {
          setDropTarget(null);
        }
      };

      cur.onUp = () => {
        if (cur.dragging && dropRef.current) {
          onReorderNote(trackId, cur.note.id, dropRef.current.id, dropRef.current.before);
          suppressClickRef.current = true;
          setTimeout(() => (suppressClickRef.current = false), 60);
        }
        end();
      };

      cur.holdTimer = setTimeout(() => {
        cur.dragging = true;
        cur.dragStartY = cur.lastY;
        setDraggingId(note.id);
      }, HOLD_MS);

      window.addEventListener('pointermove', cur.onMove);
      window.addEventListener('pointerup', cur.onUp);
    },
    [end, onReorderNote, trackId]
  );

  // wrap a row's onClick so the click that trails a drag doesn't fire
  const clickGuard = useCallback((fn) => {
    if (suppressClickRef.current) {
      suppressClickRef.current = false;
      return;
    }
    fn();
  }, []);

  // `ref` can't ride through a {...spread}, so it's returned separately
  const setRowRef = useCallback(
    (id) => (el) => {
      if (el) rowEls.current[id] = el;
      else delete rowEls.current[id];
    },
    []
  );

  const rowProps = useCallback(
    (note) => ({
      'data-note-id': note.id,
      onPointerDown: (e) => onPointerDown(note, e)
    }),
    [onPointerDown]
  );

  return { draggingId, dropTarget, rowProps, setRowRef, clickGuard };
}
