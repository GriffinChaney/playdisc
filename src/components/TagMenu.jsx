import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

// Combobox popover for applying / removing tags.
//
//  - Opens with the full candidate list already visible — no need to type.
//    Typing just narrows it.
//  - Picking a row does NOT close the menu, so you can tag (or untag) a song
//    with several tags in one go. Escape or a click outside closes it.
//  - In 'add' mode, a non-matching query gets a "Create <query>" row on top.
//  - Rendered in a portal with position:fixed so the scrolling track list
//    never clips it, and it flips above the anchor when there's no room below.
export default function TagMenu({ anchorEl, mode = 'add', options, onPick, onClose, note }) {
  const [query, setQuery] = useState('');
  const [activeIdx, setActiveIdx] = useState(0);
  const [pos, setPos] = useState(null);
  const menuRef = useRef(null);
  const inputRef = useRef(null);

  const q = query.trim().toLowerCase();
  const filtered = options.filter((t) => t.toLowerCase().includes(q));
  const exact = options.some((t) => t.toLowerCase() === q);
  const showCreate = mode === 'add' && q.length > 0 && !exact;
  const rows = showCreate
    ? [{ create: true, label: query.trim() }, ...filtered.map((label) => ({ label }))]
    : filtered.map((label) => ({ label }));

  useLayoutEffect(() => {
    if (!anchorEl) return;
    const r = anchorEl.getBoundingClientRect();
    const spaceBelow = window.innerHeight - r.bottom;
    const flipUp = spaceBelow < 240 && r.top > spaceBelow;
    setPos({
      left: Math.round(r.left),
      width: Math.max(190, Math.round(r.width)),
      ...(flipUp
        ? { bottom: Math.round(window.innerHeight - r.top + 4) }
        : { top: Math.round(r.bottom + 4) })
    });
  }, [anchorEl]);

  // the input only mounts once `pos` is resolved (first render returns null),
  // so focus after that, not on the initial empty render
  useEffect(() => {
    if (pos) inputRef.current?.focus();
  }, [pos]);

  useEffect(() => {
    function onDown(e) {
      if (
        menuRef.current &&
        !menuRef.current.contains(e.target) &&
        !anchorEl?.contains(e.target)
      ) {
        onClose();
      }
    }
    function onKey(e) {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
    }
    // any scroll detaches a position:fixed popover from its anchor — just close
    function onScroll() {
      onClose();
    }
    document.addEventListener('mousedown', onDown, true);
    document.addEventListener('keydown', onKey, true);
    document.addEventListener('scroll', onScroll, true);
    return () => {
      document.removeEventListener('mousedown', onDown, true);
      document.removeEventListener('keydown', onKey, true);
      document.removeEventListener('scroll', onScroll, true);
    };
  }, [anchorEl, onClose]);

  function choose(row) {
    if (!row) return;
    onPick(row.label);
    setQuery('');
    setActiveIdx(0);
    inputRef.current?.focus();
  }

  if (!pos) return null;

  return createPortal(
    <div
      ref={menuRef}
      className={`tag-menu${mode === 'remove' ? ' tag-menu-remove' : ''}`}
      style={{
        position: 'fixed',
        left: pos.left,
        width: pos.width,
        top: pos.top,
        bottom: pos.bottom
      }}
      onClick={(e) => e.stopPropagation()}
    >
      {note && <div className="tag-menu-note">{note}</div>}
      <input
        ref={inputRef}
        autoFocus
        className="tag-menu-input"
        placeholder={mode === 'add' ? 'find or create a tag' : 'remove a tag'}
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          setActiveIdx(0);
        }}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') {
            e.preventDefault();
            setActiveIdx((i) => Math.min(i + 1, rows.length - 1));
          } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            setActiveIdx((i) => Math.max(i - 1, 0));
          } else if (e.key === 'Enter') {
            e.preventDefault();
            choose(rows[activeIdx]);
          }
        }}
      />
      <div className="tag-menu-list">
        {rows.length === 0 && (
          <div className="tag-menu-empty">
            {mode === 'add' ? 'type to create a tag' : 'no tags on the selection'}
          </div>
        )}
        {rows.map((row, i) => (
          <button
            key={row.create ? '__create' : row.label}
            type="button"
            className={`tag-menu-row${i === activeIdx ? ' active' : ''}${row.create ? ' create' : ''}`}
            onMouseEnter={() => setActiveIdx(i)}
            onClick={() => choose(row)}
          >
            <span>
              {row.create ? (
                <>
                  Create “<strong>{row.label}</strong>”
                </>
              ) : (
                row.label
              )}
            </span>
            {mode === 'remove' && !row.create && <span className="tag-menu-hint">remove</span>}
          </button>
        ))}
      </div>
    </div>,
    document.body
  );
}
