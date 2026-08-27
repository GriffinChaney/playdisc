import { useEffect, useRef, useState, useCallback } from 'react';
import { createPortal } from 'react-dom';
import Sidebar from './components/Sidebar';
import NowPlaying from './components/NowPlaying';
import FocusView from './components/FocusView';
import MiniPlayer from './components/MiniPlayer';
import BackgroundPlayBar from './components/BackgroundPlayBar';
import Waveform from './components/Waveform';
import SettingsModal from './components/SettingsModal';
import VolumeIcon from './components/VolumeIcon';
import { addTrack, getAllTracks, updateTrack, deleteTrack } from './lib/db';
import { parseTrack } from './lib/parseTrack';
import { useObjectUrl } from './lib/useObjectUrl';
import { loadKeybindings, saveKeybindings, eventToKeyString, DEFAULT_KEYBINDINGS } from './lib/keybindings';

export default function App() {
  const [tracks, setTracks] = useState([]);
  // currentTrackId: the track shown in the main panel (what you're browsing).
  // playingTrackId: the track actually loaded into the audio engine. They're
  // usually the same, but browsing to a different track no longer stops
  // playback — only double-clicking (or hitting play while browsing) does.
  const [currentTrackId, setCurrentTrackId] = useState(null);
  const [playingTrackId, setPlayingTrackId] = useState(null);
  const [view, setView] = useState('sidebar'); // 'sidebar' | 'focus' | 'mini'

  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);

  const waveformRef = useRef(null);
  const searchInputRef = useRef(null);
  const [pendingFocusSearch, setPendingFocusSearch] = useState(false);
  const [expandedTrackId, setExpandedTrackId] = useState(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [theme, setTheme] = useState(() => localStorage.getItem('theme') || 'dark');
  const [keybindings, setKeybindingsState] = useState(() => loadKeybindings());
  const [volume, setVolume] = useState(() => {
    const saved = parseFloat(localStorage.getItem('volume'));
    return Number.isFinite(saved) ? saved : 1;
  });
  const volumeRef = useRef(volume);
  // true while a newly-selected track is still loading and should start
  // playing as soon as it's ready; isPlaying itself only flips once
  // playback actually starts, so the play/pause icon never lies mid-load.
  const shouldAutoPlayRef = useRef(false);

  // when on, "next" and auto-advance-on-finish pick a genuinely random track
  // (Math.random(), not a shuffled-order queue) instead of library order.
  // "previous" stays sequential either way — shuffle only affects moving
  // forward, same as most players.
  const [shuffleEnabled, setShuffleEnabled] = useState(() => localStorage.getItem('shuffle') === '1');
  useEffect(() => {
    localStorage.setItem('shuffle', shuffleEnabled ? '1' : '0');
  }, [shuffleEnabled]);
  const handleToggleShuffle = useCallback(() => setShuffleEnabled((v) => !v), []);

  const [sidebarWidth, setSidebarWidth] = useState(() => {
    const saved = parseInt(localStorage.getItem('sidebarWidth'), 10);
    return Number.isFinite(saved) ? saved : 300;
  });
  const isResizingSidebarRef = useRef(false);

  useEffect(() => {
    function handleMouseMove(e) {
      if (!isResizingSidebarRef.current) return;
      setSidebarWidth(Math.min(520, Math.max(220, e.clientX)));
    }
    function handleMouseUp() {
      if (!isResizingSidebarRef.current) return;
      isResizingSidebarRef.current = false;
      setSidebarWidth((w) => {
        localStorage.setItem('sidebarWidth', String(w));
        return w;
      });
    }
    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, []);

  // A single WaveSurfer instance lives here for the whole app lifetime,
  // rendered into this detached DOM node via a portal. NowPlaying/FocusView
  // pull the node into their own layout via WaveformSlot instead of each
  // mounting their own <Waveform>, so switching views never tears down and
  // reloads the audio (which used to restart playback).
  const waveformHostRef = useRef(null);
  if (!waveformHostRef.current) {
    waveformHostRef.current = document.createElement('div');
    waveformHostRef.current.style.width = '100%';
  }

  useEffect(() => {
    getAllTracks().then(setTracks);
  }, []);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem('theme', theme);
  }, [theme]);

  useEffect(() => {
    volumeRef.current = volume;
    waveformRef.current?.setVolume(volume);
    localStorage.setItem('volume', String(volume));
  }, [volume]);

  const handleSetVolume = useCallback((next) => {
    setVolume(Math.min(1, Math.max(0, next)));
  }, []);

  const handleSetKeybinding = useCallback((action, key) => {
    setKeybindingsState((prev) => {
      const next = { ...prev, [action]: { ...prev[action], key } };
      saveKeybindings(next);
      return next;
    });
  }, []);

  const handleResetKeybindings = useCallback(() => {
    localStorage.removeItem('keybindings');
    setKeybindingsState(DEFAULT_KEYBINDINGS);
  }, []);

  const currentTrack = tracks.find((t) => t.id === currentTrackId) || null;
  const playingTrack = tracks.find((t) => t.id === playingTrackId) || null;
  // the audio engine always follows the PLAYING track, never the browsed one
  const audioUrl = useObjectUrl(playingTrack?.audioBlob);
  const isViewingPlayingTrack = currentTrackId === playingTrackId;

  const handleFilesSelected = useCallback(async (files) => {
    const parsed = await Promise.all(files.map(parseTrack));
    for (const track of parsed) {
      await addTrack(track);
    }
    setTracks((prev) => [...prev, ...parsed]);
    // nothing loaded yet — safe to both show and load the first upload
    if (!currentTrackId && parsed.length) {
      setCurrentTrackId(parsed[0].id);
      setPlayingTrackId(parsed[0].id);
    }
  }, [currentTrackId]);

  // single click: just browse — never touches the audio engine, so whatever
  // is already playing keeps playing undisturbed
  const handleViewTrack = useCallback((id) => {
    setCurrentTrackId(id);
  }, []);

  // loads a track into the audio engine and (optionally) starts it —
  // double-click, hitting play while browsing, and skip all go through this
  const handleAdoptAndPlay = useCallback((id, { autoPlay = true } = {}) => {
    setCurrentTrackId(id);
    if (id === playingTrackId) {
      if (autoPlay) waveformRef.current?.play();
      return;
    }
    shouldAutoPlayRef.current = autoPlay;
    setPlayingTrackId(id);
    setCurrentTime(0);
    setDuration(0);
    setIsPlaying(false); // not actually playing yet — flips true once loaded audio starts (if autoPlay)
  }, [playingTrackId]);

  const handlePlayTrack = useCallback((id) => {
    handleAdoptAndPlay(id, { autoPlay: true });
  }, [handleAdoptAndPlay]);

  // play/pause button: if browsing a track that isn't the one playing,
  // pressing play adopts it instead of toggling whatever's in the background
  const handleTogglePlay = useCallback(() => {
    if (currentTrackId && currentTrackId !== playingTrackId) {
      handleAdoptAndPlay(currentTrackId, { autoPlay: true });
    } else {
      waveformRef.current?.toggle();
    }
  }, [currentTrackId, playingTrackId, handleAdoptAndPlay]);

  const handleAddTag = useCallback(async (id, tag) => {
    setTracks((prev) =>
      prev.map((t) => (t.id === id && !t.tags.includes(tag) ? { ...t, tags: [...t.tags, tag] } : t))
    );
    const track = tracks.find((t) => t.id === id);
    if (track && !track.tags.includes(tag)) {
      await updateTrack(id, { tags: [...track.tags, tag] });
    }
  }, [tracks]);

  const handleRemoveTag = useCallback(async (id, tag) => {
    setTracks((prev) => prev.map((t) => (t.id === id ? { ...t, tags: t.tags.filter((tg) => tg !== tag) } : t)));
    const track = tracks.find((t) => t.id === id);
    if (track) {
      await updateTrack(id, { tags: track.tags.filter((tg) => tg !== tag) });
    }
  }, [tracks]);

  // removes a tag from every track that has it, deleting the whole group at once
  const handleDeleteTagGroup = useCallback(async (tag) => {
    const affected = tracks.filter((t) => t.tags.includes(tag));
    setTracks((prev) =>
      prev.map((t) => (t.tags.includes(tag) ? { ...t, tags: t.tags.filter((tg) => tg !== tag) } : t))
    );
    for (const t of affected) {
      await updateTrack(t.id, { tags: t.tags.filter((tg) => tg !== tag) });
    }
  }, [tracks]);

  // manually-queued up-next tracks, consumed before falling back to plain
  // library order. Each entry is { qid, trackId } rather than a bare track
  // id — the same song can be queued more than once, so the id alone can't
  // identify a specific entry (for React keys or for removing just one copy).
  const [queue, setQueue] = useState([]);

  const handleAddToQueue = useCallback((trackId) => {
    setQueue((prev) => [...prev, { qid: crypto.randomUUID(), trackId }]);
  }, []);

  const handleRemoveFromQueue = useCallback((qid) => {
    setQueue((prev) => prev.filter((entry) => entry.qid !== qid));
  }, []);

  const handleClearQueue = useCallback(() => {
    setQueue([]);
  }, []);

  // insertBeforeIndex is expressed against the array BEFORE the dragged
  // item is removed (e.g. "drop this above position 3"), so it needs
  // shifting back by one once that removal happens above it.
  const handleReorderQueue = useCallback((fromIndex, insertBeforeIndex) => {
    setQueue((prev) => {
      const next = [...prev];
      const [moved] = next.splice(fromIndex, 1);
      const adjusted = insertBeforeIndex > fromIndex ? insertBeforeIndex - 1 : insertBeforeIndex;
      next.splice(adjusted, 0, moved);
      return next;
    });
  }, []);

  const handleSkip = useCallback((direction) => {
    if (!tracks.length) return;
    if (direction === 1 && queue.length > 0) {
      const [next, ...rest] = queue;
      setQueue(rest);
      handleAdoptAndPlay(next.trackId, { autoPlay: isPlaying });
      return;
    }
    const sorted = [...tracks].sort((a, b) => b.dateAdded - a.dateAdded);
    // skip always moves relative to what's actually playing, not whatever
    // happens to be browsed, so it stays correct even mid-browse
    const referenceId = playingTrackId ?? currentTrackId;
    if (direction === 1 && shuffleEnabled && sorted.length > 1) {
      const candidates = sorted.filter((t) => t.id !== referenceId);
      const pick = candidates[Math.floor(Math.random() * candidates.length)];
      handleAdoptAndPlay(pick.id, { autoPlay: isPlaying });
      return;
    }
    const idx = sorted.findIndex((t) => t.id === referenceId);
    const nextIdx = (idx + direction + sorted.length) % sorted.length;
    handleAdoptAndPlay(sorted[nextIdx].id, { autoPlay: isPlaying });
  }, [tracks, playingTrackId, currentTrackId, handleAdoptAndPlay, isPlaying, queue, shuffleEnabled]);

  const handleReady = useCallback((dur) => {
    setDuration(dur);
    // each track switch recreates the underlying WaveSurfer instance, which
    // resets volume to its default — reapply the user's chosen level
    waveformRef.current?.setVolume(volumeRef.current);
    // resume position when the waveform remounts (e.g. after switching
    // between sidebar and focus view)
    if (currentTime > 0 && dur > 0) {
      waveformRef.current?.seekTo(Math.min(currentTime / dur, 1));
    }
    if (shouldAutoPlayRef.current) {
      shouldAutoPlayRef.current = false;
      waveformRef.current?.play();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // a track finishing naturally should always auto-advance and keep
  // playing, regardless of ambient isPlaying state at that instant
  const handleFinish = useCallback(() => {
    if (queue.length > 0) {
      const [next, ...rest] = queue;
      setQueue(rest);
      handleAdoptAndPlay(next.trackId, { autoPlay: true });
      return;
    }
    if (!tracks.length) return;
    const sorted = [...tracks].sort((a, b) => b.dateAdded - a.dateAdded);
    const referenceId = playingTrackId ?? currentTrackId;
    if (shuffleEnabled && sorted.length > 1) {
      const candidates = sorted.filter((t) => t.id !== referenceId);
      const pick = candidates[Math.floor(Math.random() * candidates.length)];
      handleAdoptAndPlay(pick.id, { autoPlay: true });
      return;
    }
    const idx = sorted.findIndex((t) => t.id === referenceId);
    const nextIdx = (idx + 1) % sorted.length;
    handleAdoptAndPlay(sorted[nextIdx].id, { autoPlay: true });
  }, [tracks, playingTrackId, currentTrackId, handleAdoptAndPlay, queue, shuffleEnabled]);

  // audioprocess fires many times a second — updating currentTime state on
  // every tick meant the whole app re-rendered constantly during playback,
  // which was very likely why clicks (like browsing to another track) felt
  // laggy or needed a second try. A quarter-second display update is still
  // smooth for a mm:ss readout and cuts re-renders drastically.
  const lastTimeUpdateRef = useRef(0);
  const handleTimeUpdate = useCallback((t) => {
    const now = performance.now();
    if (now - lastTimeUpdateRef.current < 200) return;
    lastTimeUpdateRef.current = now;
    setCurrentTime(t);
  }, []);

  const handleDeleteTrack = useCallback(async (id) => {
    await deleteTrack(id);
    setTracks((prev) => prev.filter((t) => t.id !== id));
    if (id === playingTrackId) {
      waveformRef.current?.pause();
      setPlayingTrackId(null);
      setIsPlaying(false);
      setCurrentTime(0);
      setDuration(0);
    }
    if (id === currentTrackId) {
      setCurrentTrackId(null);
    }
  }, [currentTrackId, playingTrackId]);

  // focus the search box once we're back in sidebar view after cmd+s
  useEffect(() => {
    if (view === 'sidebar' && pendingFocusSearch) {
      searchInputRef.current?.focus();
      searchInputRef.current?.select();
      setPendingFocusSearch(false);
    }
  }, [view, pendingFocusSearch]);

  // physically shrink/restore the OS window itself for mini mode, rather
  // than showing a small widget inside the still-full-size window
  useEffect(() => {
    if (view === 'mini') {
      window.electronAPI?.enterMiniMode(240, 240);
    } else {
      window.electronAPI?.exitMiniMode();
    }
  }, [view]);

  // global shortcuts, driven by the user-configurable keybindings map
  useEffect(() => {
    function handleKeyDown(e) {
      if (settingsOpen) return; // the settings modal owns key handling while open

      const target = e.target;
      // exclude the volume <input type="range"> — if it happens to have
      // focus, arrow keys should still drive our own volume handler below
      // rather than the browser's native range-input stepping (which was
      // both too small a nudge and showed a focus ring around the slider)
      const isTyping =
        target instanceof HTMLElement &&
        ((target.tagName === 'INPUT' && target.type !== 'range') ||
          target.tagName === 'TEXTAREA' ||
          target.isContentEditable);
      const keyStr = eventToKeyString(e);

      if (keyStr === keybindings.settings.key) {
        e.preventDefault();
        setSettingsOpen(true);
        return;
      }

      if (keyStr === keybindings.search.key) {
        e.preventDefault();
        setPendingFocusSearch(true);
        setView('sidebar');
        return;
      }

      if (isTyping) return;

      if (keyStr === keybindings.playPause.key) {
        e.preventDefault();
        // not just waveformRef.toggle() — if you're browsing a track that
        // isn't loaded into the audio engine yet, there's nothing to toggle.
        // handleTogglePlay adopts the browsed track first, same as clicking
        // the play button does.
        handleTogglePlay();
      } else if (keyStr === keybindings.next.key || e.key === 'ArrowRight') {
        e.preventDefault();
        handleSkip(1);
      } else if (keyStr === keybindings.prev.key || e.key === 'ArrowLeft') {
        e.preventDefault();
        handleSkip(-1);
      } else if (keyStr === keybindings.fullscreen.key) {
        e.preventDefault();
        setView((v) => (v === 'focus' ? 'sidebar' : 'focus'));
      } else if (keyStr === keybindings.miniPlayer.key) {
        e.preventDefault();
        setView((v) => (v === 'mini' ? 'sidebar' : 'mini'));
      } else if (keyStr === keybindings.expandTrack.key) {
        e.preventDefault();
        setExpandedTrackId((id) => (id === currentTrackId ? null : currentTrackId));
      } else if (keyStr === keybindings.seekBack.key) {
        e.preventDefault();
        waveformRef.current?.skip(-5);
      } else if (keyStr === keybindings.seekForward.key) {
        e.preventDefault();
        waveformRef.current?.skip(5);
      } else if (keyStr === keybindings.volumeUp.key) {
        e.preventDefault();
        handleSetVolume(volumeRef.current + 0.1);
      } else if (keyStr === keybindings.volumeDown.key) {
        e.preventDefault();
        handleSetVolume(volumeRef.current - 0.1);
      } else if (keyStr === keybindings.shuffle.key) {
        e.preventDefault();
        handleToggleShuffle();
      }
    }

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [
    handleSkip,
    currentTrackId,
    keybindings,
    settingsOpen,
    handleSetVolume,
    handleTogglePlay,
    handleToggleShuffle
  ]);

  return (
    <div className="app" style={{ '--sidebar-width': `${sidebarWidth}px` }}>
      {createPortal(
        <Waveform
          ref={waveformRef}
          audioUrl={audioUrl}
          theme={theme}
          onReady={handleReady}
          onTimeUpdate={handleTimeUpdate}
          onFinish={handleFinish}
          onPlayStateChange={setIsPlaying}
        />,
        waveformHostRef.current
      )}
      {view !== 'mini' && <div className="drag-strip" />}
      {view === 'mini' ? (
        <MiniPlayer
          track={playingTrack}
          waveformHost={waveformHostRef.current}
          isPlaying={isPlaying}
          onTogglePlay={() => waveformRef.current?.toggle()}
          onSkip={handleSkip}
          onExit={() => setView('sidebar')}
        />
      ) : view === 'sidebar' ? (
        <>
          <Sidebar
            tracks={tracks}
            currentTrackId={currentTrackId}
            playingTrackId={playingTrackId}
            expandedTrackId={expandedTrackId}
            onSelectTrack={handleViewTrack}
            onPlayTrack={handlePlayTrack}
            onFilesSelected={handleFilesSelected}
            onAddTag={handleAddTag}
            onRemoveTag={handleRemoveTag}
            onDeleteTagGroup={handleDeleteTagGroup}
            onDeleteTrack={handleDeleteTrack}
            queue={queue}
            onAddToQueue={handleAddToQueue}
            onRemoveFromQueue={handleRemoveFromQueue}
            onReorderQueue={handleReorderQueue}
            onClearQueue={handleClearQueue}
            searchInputRef={searchInputRef}
            onResizeStart={() => {
              isResizingSidebarRef.current = true;
            }}
          />
          <NowPlaying
            track={currentTrack}
            waveformHost={waveformHostRef.current}
            isCurrentlyPlayingTrack={isViewingPlayingTrack}
            isPlaying={isPlaying && isViewingPlayingTrack}
            currentTime={currentTime}
            duration={duration}
            onTogglePlay={handleTogglePlay}
            onSkip={handleSkip}
            onEnterFocus={() => setView('focus')}
            shuffleEnabled={shuffleEnabled}
            onToggleShuffle={handleToggleShuffle}
          />
        </>
      ) : (
        <FocusView
          track={currentTrack}
          waveformHost={waveformHostRef.current}
          isCurrentlyPlayingTrack={isViewingPlayingTrack}
          isPlaying={isPlaying && isViewingPlayingTrack}
          currentTime={currentTime}
          duration={duration}
          onTogglePlay={handleTogglePlay}
          onSkip={handleSkip}
          onExitFocus={() => setView('sidebar')}
          shuffleEnabled={shuffleEnabled}
          onToggleShuffle={handleToggleShuffle}
        />
      )}
      {playingTrack && !isViewingPlayingTrack && view !== 'mini' && (
        <BackgroundPlayBar
          track={playingTrack}
          isPlaying={isPlaying}
          getAmplitude={() => waveformRef.current?.getAmplitude() ?? 0}
          onTogglePlay={() => waveformRef.current?.toggle()}
          onJumpToTrack={() => setCurrentTrackId(playingTrackId)}
          // centered on the whole window in focus view, but on just the
          // main content area (right of the sidebar) in sidebar view —
          // otherwise it visually skews left, eaten into by the sidebar
          style={
            view === 'sidebar'
              ? { left: `calc((100% + var(--sidebar-width, 300px)) / 2)` }
              : undefined
          }
        />
      )}
      <div
        className="volume-control"
        style={view === 'mini' ? { display: 'none' } : undefined}
        onWheel={(e) => {
          e.preventDefault();
          handleSetVolume(volumeRef.current + (e.deltaY < 0 ? 0.04 : -0.04));
        }}
      >
        <span className="volume-icon">
          <VolumeIcon volume={volume} />
        </span>
        <input
          type="range"
          className="volume-slider"
          min="0"
          max="1"
          step="0.01"
          value={volume}
          onChange={(e) => handleSetVolume(parseFloat(e.target.value))}
          tabIndex={-1}
          aria-label="volume"
          style={{ '--vol-pct': `${volume * 100}%` }}
        />
      </div>
      {settingsOpen && (
        <SettingsModal
          theme={theme}
          onSetTheme={setTheme}
          keybindings={keybindings}
          onSetKeybindings={handleSetKeybinding}
          onResetKeybindings={handleResetKeybindings}
          onClose={() => setSettingsOpen(false)}
        />
      )}
    </div>
  );
}
