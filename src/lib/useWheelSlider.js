import { useRef } from 'react';

// Scroll-wheel support for a slider-like control. React's own onWheel prop
// is silently useless for this: React registers its delegated wheel
// listener as passive, so e.preventDefault() inside a JSX onWheel handler
// throws "Unable to preventDefault inside passive event listener
// invocation." and does nothing, letting the scroll/rubber-band gesture
// fall through to whatever's behind the control. A real, non-delegated
// addEventListener with {passive:false} is the only way to actually claim
// the wheel event. Value/onChange are read through refs (updated every
// render) so the listener itself only needs to be (re)attached when the DOM
// node changes identity (mount/unmount), not every render.
//
// Originally lived in SettingsModal.jsx for the background-movement slider
// (0-100 range); extracted 2026-09-05 so the mini-player volume bar
// (0-1 range) can reuse it — pass `min`/`max` for anything other than 0-100.
export function useWheelSlider(value, onChange, step, { min = 0, max = 100 } = {}) {
  const valueRef = useRef(value);
  valueRef.current = value;
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const cleanupRef = useRef(null);

  return (el) => {
    if (cleanupRef.current) {
      cleanupRef.current();
      cleanupRef.current = null;
    }
    if (!el) return;
    function onWheel(e) {
      e.preventDefault();
      const delta = e.deltaY < 0 ? step : -step;
      onChangeRef.current(Math.min(max, Math.max(min, valueRef.current + delta)));
    }
    el.addEventListener('wheel', onWheel, { passive: false });
    cleanupRef.current = () => el.removeEventListener('wheel', onWheel);
  };
}
