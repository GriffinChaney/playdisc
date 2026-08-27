import { useState, useRef } from 'react';

// "up next" panel with precise drag-to-reorder. Extracted from the old
// Sidebar unchanged in behaviour — see the drop-line comments below.
export default function QueuePanel({ queue, tracks, onRemoveFromQueue, onReorderQueue, onClearQueue }) {
  const [dropIndicatorIndex, setDropIndicatorIndex] = useState(null);
  const dragIndexRef = useRef(null);

  function finalizeDrop() {
    const from = dragIndexRef.current;
    const insertBefore = dropIndicatorIndex;
    dragIndexRef.current = null;
    setDropIndicatorIndex(null);
    if (from === null || insertBefore === null) return;
    if (insertBefore === from || insertBefore === from + 1) return; // no-op drop
    onReorderQueue(from, insertBefore);
  }

  if (queue.length === 0) return null;

  return (
    <div className="queue-panel">
      <div className="queue-panel-header">
        <p className="queue-label">up next — {queue.length}</p>
        <button className="queue-clear-btn" onClick={onClearQueue}>
          clear
        </button>
      </div>
      <div
        className="queue-drop-zone"
        onDragOver={(e) => {
          if (e.target !== e.currentTarget || dragIndexRef.current === null) return;
          e.preventDefault();
          setDropIndicatorIndex(queue.length);
        }}
        onDrop={(e) => {
          if (dragIndexRef.current === null) return;
          e.preventDefault();
          finalizeDrop();
        }}
      >
        {queue.map((entry, index) => {
          const t = tracks.find((tr) => tr.id === entry.trackId);
          if (!t) return null;
          const isLast = index === queue.length - 1;
          return (
            <div key={entry.qid} className="queue-item-wrap">
              {/* absolutely positioned so it never nudges row layout — letting
                  it push rows around mid-drag made drops land one song off */}
              {dropIndicatorIndex === index && <div className="queue-drop-line top" />}
              <div
                className="queue-item"
                draggable
                onDragStart={(e) => {
                  dragIndexRef.current = index;
                  e.dataTransfer.effectAllowed = 'move';
                }}
                onDragOver={(e) => {
                  e.preventDefault();
                  if (dragIndexRef.current === null) return;
                  const rect = e.currentTarget.getBoundingClientRect();
                  const before = e.clientY < rect.top + rect.height / 2;
                  setDropIndicatorIndex(before ? index : index + 1);
                }}
                onDrop={(e) => {
                  e.preventDefault();
                  finalizeDrop();
                }}
                onDragEnd={() => {
                  dragIndexRef.current = null;
                  setDropIndicatorIndex(null);
                }}
              >
                <span className="queue-drag-handle" aria-hidden="true">
                  ⠿
                </span>
                <span className="queue-item-title">{t.title}</span>
                <button
                  className="queue-item-remove"
                  onClick={() => onRemoveFromQueue(entry.qid)}
                  aria-label={`remove ${t.title} from queue`}
                >
                  ×
                </button>
              </div>
              {isLast && dropIndicatorIndex === queue.length && (
                <div className="queue-drop-line bottom" />
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
