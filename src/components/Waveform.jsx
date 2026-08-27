import { useEffect, useRef, forwardRef, useImperativeHandle } from 'react';
import WaveSurfer from 'wavesurfer.js';

const EQ_BAR_COUNT = 24;
// throttled well below 60fps so bars snap between heights instead of
// smoothly interpolating — reads as chunky pixel-art rather than a wobble
const EQ_UPDATE_INTERVAL_MS = 90;

// Louder bars run hot (red/orange), quieter bars run cool (teal/green) —
// a loudness heatmap rather than flat bars.
function amplitudeColor(amplitude) {
  const hue = 150 - amplitude * 150;
  const lightness = 48 + amplitude * 10;
  return `hsl(${hue}, 85%, ${lightness}%)`;
}

// Custom bar renderer (wavesurfer's renderFunction hook) so each bar's
// color reflects its own loudness instead of just its screen position.
function renderHeatmapBars(channelData, ctx) {
  const { width, height } = ctx.canvas;
  const pixelRatio = Math.max(1, window.devicePixelRatio || 1);
  const barWidth = 2 * pixelRatio;
  const barGap = 2 * pixelRatio;
  const spacing = barWidth + barGap;
  const halfHeight = height / 2;

  const channel = channelData[0] || [];
  const length = channel.length;
  if (!length || width <= 0) return;

  // renderFunction bypasses wavesurfer's built-in normalize step, so scale
  // bar heights against this track's own peak ourselves.
  let max = 0;
  for (let i = 0; i < length; i++) {
    const v = Math.abs(channel[i] || 0);
    if (v > max) max = v;
  }
  if (!max) max = 1;

  const barIndexScale = width / spacing / length;
  let prevX = 0;
  let peak = 0;

  for (let i = 0; i <= length; i++) {
    const x = Math.round(i * barIndexScale);
    if (x > prevX) {
      const amplitude = Math.min(1, peak / max);
      const barHeight = Math.max(2, Math.round(amplitude * halfHeight));
      const y = halfHeight - barHeight;

      ctx.fillStyle = amplitudeColor(amplitude);
      ctx.beginPath();
      if ('roundRect' in ctx) {
        ctx.roundRect(prevX * spacing, y, barWidth, barHeight * 2, 1);
      } else {
        ctx.rect(prevX * spacing, y, barWidth, barHeight * 2);
      }
      ctx.fill();

      prevX = x;
      peak = 0;
    }
    const v = Math.abs(channel[i] || 0);
    if (v > peak) peak = v;
  }
}

// Imperative handle exposes play/pause/toggle/seek so the parent (NowPlaying /
// FocusView) can drive playback from its own transport buttons, while this
// component owns the actual wavesurfer instance and the click/drag-to-seek
// behavior.
function progressColorForTheme(theme) {
  // light mode's surface is near-white, so a faint dark wash barely reads —
  // needs noticeably more contrast than the dark-mode version to be visible
  return theme === 'light' ? 'rgba(0, 0, 0, 0.5)' : 'rgba(255, 255, 255, 0.3)';
}

const Waveform = forwardRef(function Waveform(
  { audioUrl, theme, height = 60, onReady, onFinish, onTimeUpdate, onPlayStateChange },
  ref
) {
  const containerRef = useRef(null);
  const wsRef = useRef(null);
  const decodedChannelRef = useRef(null);
  const sampleRateRef = useRef(44100);
  const trackPeakRef = useRef(1);
  const eqBarRefs = useRef([]);
  const eqRafRef = useRef(null);

  useEffect(() => {
    if (!containerRef.current || !audioUrl) return;

    // wavesurfer always re-tints the "played" region with a flat color on
    // top of the base heatmap canvas. Fully transparent (tried previously)
    // stopped it from looking like it "changes color" while scrubbing, but
    // also made played bars invisible against the surface in both themes —
    // a theme-aware translucent wash keeps it legible without being jarring.
    const ws = WaveSurfer.create({
      container: containerRef.current,
      waveColor: '#3d3a5c',
      progressColor: progressColorForTheme(theme),
      cursorColor: '#f97316',
      cursorWidth: 2,
      height,
      renderFunction: renderHeatmapBars,
      interact: true, // <-- this is what makes click/drag-to-seek work
      dragToSeek: true // scrub by clicking and dragging across the waveform
    });

    wsRef.current = ws;
    ws.load(audioUrl);

    ws.on('ready', () => {
      onReady?.(ws.getDuration());
      // Grab the decoded samples once so the equalizer can sample live
      // amplitude per sub-band from them on every tick.
      const decoded = ws.getDecodedData();
      if (decoded) {
        const channel = decoded.getChannelData(0);
        decodedChannelRef.current = channel;
        sampleRateRef.current = decoded.sampleRate;
        let max = 0;
        for (let i = 0; i < channel.length; i++) {
          const v = Math.abs(channel[i]);
          if (v > max) max = v;
        }
        trackPeakRef.current = max || 1;
      }
    });
    ws.on('finish', () => onFinish?.());
    ws.on('audioprocess', (currentTime) => onTimeUpdate?.(currentTime));
    ws.on('interaction', () => onTimeUpdate?.(ws.getCurrentTime()));
    ws.on('play', () => {
      onPlayStateChange?.(true);
      startEqualizerLoop();
    });
    ws.on('pause', () => {
      onPlayStateChange?.(false);
      stopEqualizerLoop();
    });

    // Drives the little pixel-bar equalizer strip independently of
    // wavesurfer's own event cadence, sampling a window of decoded audio
    // around the current playhead and splitting it into per-bar sub-bands.
    function startEqualizerLoop() {
      let lastUpdate = 0;
      function tick(timestamp) {
        eqRafRef.current = requestAnimationFrame(tick);
        if (timestamp - lastUpdate < EQ_UPDATE_INTERVAL_MS) return;
        lastUpdate = timestamp;

        const channel = decodedChannelRef.current;
        const currentWs = wsRef.current;
        if (!channel || !currentWs) return;

        const centerSample = Math.floor(currentWs.getCurrentTime() * sampleRateRef.current);
        const windowSize = 5000;
        const segSize = Math.floor(windowSize / EQ_BAR_COUNT);
        const start = Math.max(0, centerSample - windowSize / 2);

        for (let b = 0; b < EQ_BAR_COUNT; b++) {
          const segStart = Math.min(channel.length, start + b * segSize);
          const segEnd = Math.min(channel.length, segStart + segSize);
          let peak = 0;
          for (let i = segStart; i < segEnd; i++) {
            const v = Math.abs(channel[i]);
            if (v > peak) peak = v;
          }
          const amplitude = Math.min(1, Math.pow(peak / trackPeakRef.current, 0.6));
          const el = eqBarRefs.current[b];
          if (el) {
            el.style.height = `${8 + amplitude * 92}%`;
            el.style.background = amplitudeColor(amplitude);
          }
        }
      }
      eqRafRef.current = requestAnimationFrame(tick);
    }

    function stopEqualizerLoop() {
      if (eqRafRef.current) cancelAnimationFrame(eqRafRef.current);
      eqRafRef.current = null;
      eqBarRefs.current.forEach((el) => {
        if (el) {
          el.style.height = '8%';
          el.style.background = '';
        }
      });
    }

    return () => {
      stopEqualizerLoop();
      ws.destroy();
      wsRef.current = null;
      decodedChannelRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [audioUrl]);

  // Theme toggles don't recreate the WaveSurfer instance (that's keyed only
  // off audioUrl, to avoid restarting playback), so the progress color was
  // previously stuck at whatever it was when the instance was created —
  // looking "bugged" until the next track load happened to pick up the new
  // theme. Re-tint the existing instance directly instead.
  useEffect(() => {
    wsRef.current?.setOptions({ progressColor: progressColorForTheme(theme) });
  }, [theme]);

  useImperativeHandle(ref, () => ({
    play: () => wsRef.current?.play(),
    pause: () => wsRef.current?.pause(),
    toggle: () => wsRef.current?.playPause(),
    isPlaying: () => wsRef.current?.isPlaying() ?? false,
    seekTo: (fraction) => wsRef.current?.seekTo(fraction), // 0..1
    skip: (seconds) => wsRef.current?.skip(seconds), // relative nudge, +/- seconds
    setVolume: (v) => wsRef.current?.setVolume(v), // 0..1
    getVolume: () => wsRef.current?.getVolume() ?? 1,
    getCurrentTime: () => wsRef.current?.getCurrentTime() ?? 0,
    getDuration: () => wsRef.current?.getDuration() ?? 0,
    // single 0..1 loudness reading at the current playhead, for small
    // reactive UI elsewhere (e.g. the background-play-bar's mini meter)
    getAmplitude: () => {
      const channel = decodedChannelRef.current;
      const ws = wsRef.current;
      if (!channel || !ws) return 0;
      const centerSample = Math.floor(ws.getCurrentTime() * sampleRateRef.current);
      const windowSize = 4000;
      const start = Math.max(0, centerSample - windowSize / 2);
      const end = Math.min(channel.length, centerSample + windowSize / 2);
      let peak = 0;
      for (let i = start; i < end; i++) {
        const v = Math.abs(channel[i]);
        if (v > peak) peak = v;
      }
      return Math.min(1, Math.pow(peak / trackPeakRef.current, 0.6));
    }
  }));

  return (
    <div
      className="waveform-hover-zone"
      style={{ width: '100%' }}
      onWheel={(e) => {
        // proportional to scroll magnitude and clamped, so a trackpad scrubs
        // finely while a mouse wheel notch still moves a sensible amount
        const amount = Math.max(-2, Math.min(2, -e.deltaY * 0.01));
        wsRef.current?.skip(amount);
      }}
    >
      <div ref={containerRef} style={{ width: '100%', cursor: 'pointer' }} />
      <div className="waveform-eq" aria-hidden="true">
        {Array.from({ length: EQ_BAR_COUNT }).map((_, i) => (
          <div key={i} ref={(el) => (eqBarRefs.current[i] = el)} className="waveform-eq-bar" />
        ))}
      </div>
    </div>
  );
});

export default Waveform;
