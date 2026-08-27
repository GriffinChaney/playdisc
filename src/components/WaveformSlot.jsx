import { useEffect, useRef } from 'react';

// Receives a persistent, off-tree DOM node (holding the live WaveSurfer
// instance) and reparents it into this slot on mount. Because the node
// itself is never destroyed, playback survives moving between views (e.g.
// sidebar <-> fullscreen) instead of reloading the audio from scratch.
export default function WaveformSlot({ host }) {
  const containerRef = useRef(null);

  useEffect(() => {
    if (containerRef.current && host) {
      containerRef.current.appendChild(host);
    }
  }, [host]);

  return <div ref={containerRef} style={{ width: '100%' }} />;
}
