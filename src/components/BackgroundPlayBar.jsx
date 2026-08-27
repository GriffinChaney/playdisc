import { useEffect, useRef } from 'react';
import { useObjectUrl } from '../lib/useObjectUrl';

const BAR_COUNT = 5;

// Shown when browsing a different track than the one actually playing, so
// playback stays reachable/controllable without forcing you back to it.
export default function BackgroundPlayBar({ track, isPlaying, getAmplitude, onTogglePlay, onJumpToTrack, style }) {
  const artworkUrl = useObjectUrl(track.artworkBlob);
  const barRefs = useRef([]);
  const rafRef = useRef(null);

  // small pixel-meter reacting to the actually-playing track, echoing the
  // main waveform's equalizer but scaled down for this compact bar
  useEffect(() => {
    if (!isPlaying) {
      barRefs.current.forEach((el) => el && (el.style.height = '15%'));
      return;
    }
    let lastUpdate = 0;
    function tick(timestamp) {
      rafRef.current = requestAnimationFrame(tick);
      if (timestamp - lastUpdate < 110) return;
      lastUpdate = timestamp;
      const amplitude = getAmplitude?.() ?? 0;
      barRefs.current.forEach((el, i) => {
        if (!el) return;
        const wobble = 0.6 + 0.4 * Math.sin(i * 2.1 + timestamp / 220);
        el.style.height = `${15 + amplitude * wobble * 85}%`;
      });
    }
    rafRef.current = requestAnimationFrame(tick);
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, [isPlaying, getAmplitude]);

  return (
    <div className="bg-play-bar" onClick={onJumpToTrack} role="button" aria-label="jump to playing track" style={style}>
      <div className="bg-play-thumb" style={artworkUrl ? { backgroundImage: `url(${artworkUrl})` } : undefined}>
        {!artworkUrl && <span className="thumb-fallback">♪</span>}
      </div>
      <span className="bg-play-info">
        <span className="bg-play-title">{track.title}</span>
        <span className="bg-play-artist">{track.artist}</span>
      </span>
      <div className="bg-play-meter" aria-hidden="true">
        {Array.from({ length: BAR_COUNT }).map((_, i) => (
          <div key={i} ref={(el) => (barRefs.current[i] = el)} className="bg-play-meter-bar" />
        ))}
      </div>
      <button
        className="bg-play-toggle"
        onClick={(e) => {
          e.stopPropagation();
          onTogglePlay();
        }}
        aria-label={isPlaying ? 'pause' : 'play'}
      >
        {isPlaying ? '⏸' : '▶'}
      </button>
    </div>
  );
}
