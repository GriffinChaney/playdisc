import { useObjectUrl } from '../lib/useObjectUrl';
import { useDominantColor, useArtworkPalette } from '../lib/useDominantColor';
import { meshBackdropStyle } from '../lib/meshBackdrop';
import WaveformSlot from './WaveformSlot';

export default function MiniPlayer({ track, waveformHost, isPlaying, onTogglePlay, onSkip, onExit }) {
  const artworkUrl = useObjectUrl(track?.artworkBlob);
  // same cover-derived mesh as the focus view — the gradient's %-based blob
  // positions scale straight down to this small window. undefined for an
  // art-less track, which keeps the plain --surface background.
  const palette = useArtworkPalette(track?.artworkBlob);
  const dominantColor = useDominantColor(track?.artworkBlob);
  const backdropStyle = meshBackdropStyle(palette, dominantColor);

  return (
    <div className={`mini-player${backdropStyle ? ' has-backdrop' : ''}`} style={backdropStyle}>
      {/* keeps the underlying <audio> element attached to the document while
          minimized — detaching it (which happens if this unmounts) pauses it */}
      <div style={{ display: 'none' }}>
        <WaveformSlot host={waveformHost} />
      </div>
      <div
        className="mini-artwork"
        onClick={onExit}
        role="button"
        aria-label="expand player"
        style={artworkUrl ? { backgroundImage: `url(${artworkUrl})` } : undefined}
      >
        {!artworkUrl && <span className="artwork-fallback">♪</span>}
      </div>

      <p className="mini-title">{track ? track.title : 'nothing playing'}</p>

      <div className="mini-transport">
        <button onClick={() => onSkip(-1)} aria-label="previous track">
          ⏮
        </button>
        <button className="play-btn" onClick={onTogglePlay} aria-label={isPlaying ? 'pause' : 'play'}>
          {isPlaying ? '⏸' : '▶'}
        </button>
        <button onClick={() => onSkip(1)} aria-label="next track">
          ⏭
        </button>
      </div>
    </div>
  );
}
