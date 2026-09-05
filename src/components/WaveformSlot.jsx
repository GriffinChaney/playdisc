import { useLayoutEffect, useRef } from 'react';

// Receives the persistent, off-tree DOM node that holds the live WaveSurfer
// instance (and its <audio> element) and claims it into this slot whenever
// this slot is the `active` one.
//
// CONTRACT — this is load-bearing for playback, see CLAUDE.md "Single shared
// WaveSurfer instance":
//   - Every view that can show the waveform (NowPlaying / FocusView /
//     MiniPlayer) renders one of these and stays MOUNTED at all times.
//     App.jsx hides inactive views with CSS (display: none via `view-hidden`);
//     it never unmounts them. Adding a new waveform-bearing view means
//     following the same pattern — never a conditional render.
//   - Exactly one slot is `active` at a time, driven by App.jsx's `view`.
//   - Switching views therefore moves `host` between two containers that are
//     BOTH already in the document, via a single appendChild. The node is
//     never detached, so the browser never sees a disconnected media element
//     and never pauses it. (The old per-view mount/unmount pattern removed the
//     node and re-added it ~14ms later; browsers pause a media element that
//     leaves the document, asynchronously — measured firing 1.4ms AFTER the
//     reattach. Restored 2026-09-04, tag `waveformslot-fixed`.)
//   - useLayoutEffect, not useEffect: the move lands in the same commit as
//     the view switch, before paint, so the newly-shown view never paints a
//     frame with an empty slot.
export default function WaveformSlot({ host, active = true }) {
  const containerRef = useRef(null);

  useLayoutEffect(() => {
    if (!active || !containerRef.current || !host) return;
    if (host.parentNode === containerRef.current) return; // already ours
    containerRef.current.appendChild(host);
  }, [host, active]);

  return <div ref={containerRef} style={{ width: '100%' }} />;
}
