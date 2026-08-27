import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

// Controlled right-click menu. Parent holds `menu` state shaped as:
//   { x, y, items: [ item, ... ] }
// where each item is one of:
//   { label, onClick, danger? }
//   { label, submenu: [ item, ... ] }
//   { separator: true }
// Rendered once near the app root; pass null to close.
export default function ContextMenu({ menu, onClose }) {
  const rootRef = useRef(null);
  const [pos, setPos] = useState({ x: 0, y: 0 });
  const [openSub, setOpenSub] = useState(null);

  useLayoutEffect(() => {
    if (!menu) return;
    setOpenSub(null);
    // keep the menu on screen
    const el = rootRef.current;
    const w = el?.offsetWidth ?? 200;
    const h = el?.offsetHeight ?? 240;
    const pad = 8;
    setPos({
      x: Math.min(menu.x, window.innerWidth - w - pad),
      y: Math.min(menu.y, window.innerHeight - h - pad)
    });
  }, [menu]);

  useEffect(() => {
    if (!menu) return;
    function onKey(e) {
      if (e.key === 'Escape') onClose();
    }
    function onScroll() {
      onClose();
    }
    window.addEventListener('keydown', onKey);
    window.addEventListener('resize', onClose);
    window.addEventListener('wheel', onScroll, { passive: true });
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('resize', onClose);
      window.removeEventListener('wheel', onScroll);
    };
  }, [menu, onClose]);

  if (!menu) return null;

  function renderItems(items, isSub) {
    return items.map((item, i) => {
      if (item.separator) return <div key={i} className="ctx-separator" />;
      if (item.submenu) {
        return (
          <div
            key={i}
            className={`ctx-item has-sub${openSub === i && !isSub ? ' sub-open' : ''}`}
            // hovering this row (in the top-level menu) opens its submenu;
            // hovering any other row closes whatever was open
            onMouseEnter={() => !isSub && setOpenSub(i)}
          >
            <span>{item.label}</span>
            <span className="ctx-chevron" aria-hidden="true">›</span>
            {openSub === i && !isSub && (
              <div className="ctx-menu ctx-submenu">{renderItems(item.submenu, true)}</div>
            )}
          </div>
        );
      }
      return (
        <button
          key={i}
          className={`ctx-item${item.danger ? ' danger' : ''}`}
          disabled={item.disabled}
          // moving onto a plain row closes any open submenu so the parent
          // item stops looking highlighted
          onMouseEnter={() => !isSub && setOpenSub(null)}
          onClick={() => {
            item.onClick?.();
            onClose();
          }}
        >
          {item.label}
        </button>
      );
    });
  }

  return createPortal(
    <>
      <div className="ctx-backdrop" onMouseDown={onClose} onContextMenu={(e) => { e.preventDefault(); onClose(); }} />
      <div
        ref={rootRef}
        className="ctx-menu"
        style={{ left: pos.x, top: pos.y }}
        onContextMenu={(e) => e.preventDefault()}
      >
        {renderItems(menu.items, false)}
      </div>
    </>,
    document.body
  );
}
