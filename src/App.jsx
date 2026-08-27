import { useEffect, useRef, useState, useCallback } from 'react';
import { createPortal } from 'react-dom';
import PlaylistNav from './components/PlaylistNav';
import LibraryList from './components/LibraryList';
import ContextMenu from './components/ContextMenu';
import NowPlaying from './components/NowPlaying';
import FocusView from './components/FocusView';
import MiniPlayer from './components/MiniPlayer';
import BackgroundPlayBar from './components/BackgroundPlayBar';
import Waveform from './components/Waveform';
import SettingsModal from './components/SettingsModal';
import VolumeIcon from './components/VolumeIcon';
import ImportOverlay from './components/ImportOverlay';
import ImportToast from './components/ImportToast';
import {
  addTrack,
  getAllTracks,
  updateTrack,
  deleteTrack,
  getAllPlaylists,
  putPlaylist,
  deletePlaylistRecord
} from './lib/db';
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

  // playlists + which left-nav item the middle column is showing
  const [playlists, setPlaylists] = useState([]);
  const [activeView, setActiveView] = useState({ type: 'imported' }); // | { type: 'playlist', id }
  const [libraryViewMode, setLibraryViewMode] = useState(
    () => localStorage.getItem('libraryViewMode') || 'list'
  );
  const [contextMenu, setContextMenu] = useState(null);
  // ordering context for skip/auto-advance: follows whichever list a new
  // playing track was chosen from ('library' order, or a specific playlist)
  const [playbackContext, setPlaybackContext] = useState({ type: 'library' });
  const playlistsRef = useRef(playlists);
  const playbackContextRef = useRef(playbackContext);
  const activeViewRef = useRef(activeView);
  playlistsRef.current = playlists;
  playbackContextRef.current = playbackContext;
  activeViewRef.current = activeView;

  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);

  const waveformRef = useRef(null);
  const searchInputRef = useRef(null);
  const [pendingFocusSearch, setPendingFocusSearch] = useState(false);
  const [expandedTrackId, setExpandedTrackId] = useState(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  // import UX: progress overlay while parsing/storing, then a self-dismissing
  // top-right confirmation toast. Both null when no import is happening.
  const [importProgress, setImportProgress] = useState(null); // { done, total }
  const [importToast, setImportToast] = useState(null); // { id, count } | { id, error }
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

  // width of the left playlist-nav column (drag handle on its right edge)
  const [navWidth, setNavWidth] = useState(() => {
    const saved = parseInt(localStorage.getItem('navWidth'), 10);
    return Number.isFinite(saved) ? Math.min(340, Math.max(170, saved)) : 200;
  });
  const isResizingSidebarRef = useRef(false);

  useEffect(() => {
    function handleMouseMove(e) {
      if (!isResizingSidebarRef.current) return;
      setNavWidth(Math.min(340, Math.max(170, e.clientX)));
    }
    function handleMouseUp() {
      if (!isResizingSidebarRef.current) return;
      isResizingSidebarRef.current = false;
      setNavWidth((w) => {
        localStorage.setItem('navWidth', String(w));
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
    getAllPlaylists().then((pls) => setPlaylists(pls.map((p) => ({ pinned: false, ...p }))));
  }, []);

  useEffect(() => {
    localStorage.setItem('libraryViewMode', libraryViewMode);
  }, [libraryViewMode]);

  // if the active playlist is deleted elsewhere, fall back to Imported
  useEffect(() => {
    if (activeView.type === 'playlist' && !playlists.some((p) => p.id === activeView.id)) {
      setActiveView({ type: 'imported' });
    }
  }, [playlists, activeView]);

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

  // the ordered track list the middle column shows for the active left-nav
  // item: a playlist's manual order, or the whole library newest-first
  const activePlaylist =
    activeView.type === 'playlist' ? playlists.find((p) => p.id === activeView.id) || null : null;
  const shownTracks = (() => {
    if (activePlaylist) {
      const byId = new Map(tracks.map((t) => [t.id, t]));
      return activePlaylist.trackIds.map((id) => byId.get(id)).filter(Boolean);
    }
    return [...tracks].sort((a, b) => b.dateAdded - a.dateAdded);
  })();

  const dismissImportToast = useCallback(() => setImportToast(null), []);

  const handleFilesSelected = useCallback(async (files) => {
    setImportProgress({ done: 0, total: files.length });
    let done = 0;
    try {
      const parsed = await Promise.all(
        files.map(async (file) => {
          const track = await parseTrack(file);
          await addTrack(track);
          done += 1;
          setImportProgress({ done, total: files.length });
          return track;
        })
      );
      setTracks((prev) => [...prev, ...parsed]);
      // nothing loaded yet — safe to both show and load the first upload
      if (!currentTrackId && parsed.length) {
        setCurrentTrackId(parsed[0].id);
        setPlayingTrackId(parsed[0].id);
      }
      setImportToast({ id: Date.now(), count: parsed.length });
    } catch (err) {
      console.error('[import] failed:', err);
      setImportToast({ id: Date.now(), error: true });
    } finally {
      setImportProgress(null);
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

  // the ordering context that skip / auto-advance should follow, derived
  // from whichever left-nav view a play was initiated from
  const contextFromActiveView = useCallback(() => {
    const av = activeViewRef.current;
    return av.type === 'playlist' ? { type: 'playlist', id: av.id } : { type: 'library' };
  }, []);

  const handlePlayTrack = useCallback((id) => {
    setPlaybackContext(contextFromActiveView());
    handleAdoptAndPlay(id, { autoPlay: true });
  }, [handleAdoptAndPlay, contextFromActiveView]);

  const handlePlayPlaylist = useCallback(
    (id) => {
      const pl = playlistsRef.current.find((p) => p.id === id);
      const firstId = pl?.trackIds.find((tid) => tracks.some((t) => t.id === tid));
      if (!firstId) return;
      setPlaybackContext({ type: 'playlist', id });
      handleAdoptAndPlay(firstId, { autoPlay: true });
    },
    [tracks, handleAdoptAndPlay]
  );

  // play/pause button: if browsing a track that isn't the one playing,
  // pressing play adopts it instead of toggling whatever's in the background
  const handleTogglePlay = useCallback(() => {
    if (currentTrackId && currentTrackId !== playingTrackId) {
      setPlaybackContext(contextFromActiveView());
      handleAdoptAndPlay(currentTrackId, { autoPlay: true });
    } else {
      waveformRef.current?.toggle();
    }
  }, [currentTrackId, playingTrackId, handleAdoptAndPlay, contextFromActiveView]);

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

  // ---- playlists ----
  // A playlist is a named, ordered list of track ids. Every mutation writes
  // the whole record through to IndexedDB. Deleting a playlist never touches
  // the tracks it referenced.
  const persistPlaylist = useCallback((pl) => {
    const withStamp = { ...pl, updatedAt: Date.now() };
    setPlaylists((prev) => {
      const i = prev.findIndex((p) => p.id === pl.id);
      return i === -1 ? [...prev, withStamp] : prev.map((p) => (p.id === pl.id ? withStamp : p));
    });
    putPlaylist(withStamp);
    return withStamp;
  }, []);

  const handleCreatePlaylist = useCallback(
    (name, trackIds = []) => {
      const pl = {
        id: crypto.randomUUID(),
        name,
        trackIds: [...new Set(trackIds)],
        pinned: false,
        createdAt: Date.now(),
        updatedAt: Date.now()
      };
      setPlaylists((prev) => [...prev, pl]);
      putPlaylist(pl);
      setActiveView({ type: 'playlist', id: pl.id });
      return pl.id;
    },
    []
  );

  const handleRenamePlaylist = useCallback(
    (id, name) => {
      const pl = playlistsRef.current.find((p) => p.id === id);
      if (pl) persistPlaylist({ ...pl, name });
    },
    [persistPlaylist]
  );

  const handleTogglePinPlaylist = useCallback(
    (id) => {
      const pl = playlistsRef.current.find((p) => p.id === id);
      if (pl) persistPlaylist({ ...pl, pinned: !pl.pinned });
    },
    [persistPlaylist]
  );

  const handleDeletePlaylist = useCallback((id) => {
    setPlaylists((prev) => prev.filter((p) => p.id !== id));
    deletePlaylistRecord(id);
    setPlaybackContext((ctx) => (ctx.type === 'playlist' && ctx.id === id ? { type: 'library' } : ctx));
  }, []);

  const handleAddTracksToPlaylist = useCallback(
    (id, trackIds) => {
      const pl = playlistsRef.current.find((p) => p.id === id);
      if (!pl) return;
      const merged = [...pl.trackIds];
      trackIds.forEach((tid) => {
        if (!merged.includes(tid)) merged.push(tid);
      });
      persistPlaylist({ ...pl, trackIds: merged });
    },
    [persistPlaylist]
  );

  const handleRemoveTrackFromPlaylist = useCallback(
    (id, trackId) => {
      const pl = playlistsRef.current.find((p) => p.id === id);
      if (pl) persistPlaylist({ ...pl, trackIds: pl.trackIds.filter((t) => t !== trackId) });
    },
    [persistPlaylist]
  );

  const handleReorderPlaylistTracks = useCallback(
    (id, fromIndex, insertBeforeIndex) => {
      const pl = playlistsRef.current.find((p) => p.id === id);
      if (!pl) return;
      const next = [...pl.trackIds];
      const [moved] = next.splice(fromIndex, 1);
      const adjusted = insertBeforeIndex > fromIndex ? insertBeforeIndex - 1 : insertBeforeIndex;
      next.splice(adjusted, 0, moved);
      persistPlaylist({ ...pl, trackIds: next });
    },
    [persistPlaylist]
  );

  // ---- play history: browser-style back/forward through what actually played ----
  // Every genuinely-new track that starts playing is appended. Back/Forward
  // (handleSkip -1 / +1) walk this list; playing something brand-new while
  // stepped back truncates the "forward" tail, exactly like browser history.
  // Persisted (ids + timestamps only). `historyIndex` points at the currently
  // playing entry and always starts at the live edge (== history.length) on
  // load, so the first Back press lands on the last-played track.
  const MAX_HISTORY = 50;

  const [history, setHistory] = useState(() => {
    try {
      const raw = JSON.parse(localStorage.getItem('playHistory') || '[]');
      return Array.isArray(raw) ? raw.filter((h) => h && typeof h.trackId === 'string') : [];
    } catch {
      return [];
    }
  });
  const [historyIndex, setHistoryIndex] = useState(() => history.length);
  const historyRef = useRef(history);
  const historyIndexRef = useRef(historyIndex);
  historyRef.current = history;
  historyIndexRef.current = historyIndex;
  // set true right before a Back/Forward/list-jump adopt, so the append
  // effect below knows that playingTrackId change is navigation, not a new play
  const historyNavRef = useRef(false);

  // All history mutations go through these two so the refs stay in lockstep
  // with state. They set plain values (never updater fns) — under StrictMode
  // an updater fn is invoked twice, which would double-apply ref side effects.
  const setHistoryPos = useCallback((i) => {
    historyIndexRef.current = i;
    setHistoryIndex(i);
  }, []);
  const commitHistory = useCallback((list, pos) => {
    historyRef.current = list;
    setHistory(list);
    historyIndexRef.current = pos;
    setHistoryIndex(pos);
  }, []);

  useEffect(() => {
    if (!playingTrackId) return;
    if (historyNavRef.current) {
      historyNavRef.current = false;
      return;
    }
    const i = historyIndexRef.current;
    const prev = historyRef.current;
    if (prev[i]?.trackId === playingTrackId) return; // same track re-triggered
    let next = [
      ...prev.slice(0, i + 1),
      { hid: crypto.randomUUID(), trackId: playingTrackId, playedAt: Date.now() }
    ];
    if (next.length > MAX_HISTORY) next = next.slice(next.length - MAX_HISTORY);
    commitHistory(next, next.length - 1);
  }, [playingTrackId, commitHistory]);

  useEffect(() => {
    localStorage.setItem('playHistory', JSON.stringify(history));
  }, [history]);

  // once the library has loaded, drop entries for tracks deleted between sessions
  const historyPrunedRef = useRef(false);
  useEffect(() => {
    if (historyPrunedRef.current || tracks.length === 0) return;
    historyPrunedRef.current = true;
    const ids = new Set(tracks.map((t) => t.id));
    const filtered = historyRef.current.filter((h) => ids.has(h.trackId));
    if (filtered.length === historyRef.current.length) return;
    commitHistory(filtered, Math.min(historyIndexRef.current, filtered.length));
  }, [tracks, commitHistory]);

  // move the cursor to a specific history position and play that entry
  const goToHistory = useCallback((i, autoPlay) => {
    const entry = historyRef.current[i];
    if (!entry || !tracks.some((t) => t.id === entry.trackId)) return;
    setHistoryPos(i);
    if (entry.trackId === playingTrackId) {
      if (autoPlay) waveformRef.current?.play();
      return;
    }
    historyNavRef.current = true;
    handleAdoptAndPlay(entry.trackId, { autoPlay });
  }, [tracks, playingTrackId, handleAdoptAndPlay, setHistoryPos]);

  // nearest history position from `from` in direction `dir` (±1) whose track
  // still exists, or -1 if there's none
  const stepHistory = useCallback((from, dir) => {
    const h = historyRef.current;
    const ids = new Set(tracks.map((t) => t.id));
    let j = from + dir;
    while (j >= 0 && j < h.length && !ids.has(h[j].trackId)) j += dir;
    return j >= 0 && j < h.length ? j : -1;
  }, [tracks]);

  const handleJumpToHistory = useCallback((i) => goToHistory(i, true), [goToHistory]);

  const handleClearHistory = useCallback(() => {
    commitHistory([], 0);
  }, [commitHistory]);

  // the ordered track list that skip / auto-advance traverses: the playlist
  // the current playback started from, else plain library (newest-first) order
  const orderedContextTracks = useCallback(() => {
    const ctx = playbackContextRef.current;
    if (ctx.type === 'playlist') {
      const pl = playlistsRef.current.find((p) => p.id === ctx.id);
      if (pl) {
        const byId = new Map(tracks.map((t) => [t.id, t]));
        const list = pl.trackIds.map((tid) => byId.get(tid)).filter(Boolean);
        if (list.length) return list;
      }
    }
    return [...tracks].sort((a, b) => b.dateAdded - a.dateAdded);
  }, [tracks]);

  const handleSkip = useCallback((direction) => {
    if (!tracks.length) return;

    // BACK: walk the real play history
    if (direction === -1) {
      const j = stepHistory(historyIndexRef.current, -1);
      if (j !== -1) {
        goToHistory(j, isPlaying);
        return;
      }
      // no earlier history entry. If there's a history at all, keep going
      // backward in library order but PREPEND (extend the trail backward) so
      // the forward tail you'd built up isn't lost — same as a browser
      // stepping back past where its history began.
      const h = historyRef.current;
      if (h.length > 0) {
        const anchorId = h[0]?.trackId;
        const sortedLib = orderedContextTracks();
        const ai = sortedLib.findIndex((t) => t.id === anchorId);
        if (ai !== -1) {
          const prevTrack = sortedLib[(ai - 1 + sortedLib.length) % sortedLib.length];
          if (prevTrack.id !== playingTrackId) {
            let extended = [
              { hid: crypto.randomUUID(), trackId: prevTrack.id, playedAt: Date.now() },
              ...h
            ];
            if (extended.length > MAX_HISTORY) extended = extended.slice(0, MAX_HISTORY);
            historyNavRef.current = true;
            commitHistory(extended, 0);
            handleAdoptAndPlay(prevTrack.id, { autoPlay: isPlaying });
          }
          return;
        }
      }
      // history is empty — plain library-order previous (the effect will
      // append it as the first entry)
    }

    // FORWARD: if we've stepped back, retrace forward through history first
    if (direction === 1 && historyIndexRef.current < historyRef.current.length - 1) {
      const j = stepHistory(historyIndexRef.current, 1);
      if (j !== -1) {
        goToHistory(j, isPlaying);
        return;
      }
    }

    if (direction === 1 && queue.length > 0) {
      const [next, ...rest] = queue;
      setQueue(rest);
      handleAdoptAndPlay(next.trackId, { autoPlay: isPlaying });
      return;
    }
    const sorted = orderedContextTracks();
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
  }, [tracks, playingTrackId, currentTrackId, handleAdoptAndPlay, isPlaying, queue, shuffleEnabled, goToHistory, stepHistory, commitHistory, orderedContextTracks]);

  const handleReady = useCallback((dur) => {
    setDuration(dur);
    // each track switch recreates the underlying WaveSurfer instance, which
    // resets volume to its default — reapply the user's chosen level
    waveformRef.current?.setVolume(volumeRef.current);
    // NOTE: no position-resume here. `onReady` only fires when a *new* WaveSurfer
    // instance is created, which only happens on a real track switch — and
    // `handleAdoptAndPlay` already resets `currentTime` to 0 for that. Switching
    // between sidebar/focus/mini views reparents the *same* waveform node (see
    // WaveformSlot), so it never re-fires `ready` and never loses its position.
    if (shouldAutoPlayRef.current) {
      shouldAutoPlayRef.current = false;
      waveformRef.current?.play();
    }
  }, []);

  // a track finishing naturally should always auto-advance and keep
  // playing, regardless of ambient isPlaying state at that instant
  const handleFinish = useCallback(() => {
    // if the finish happened while stepped back in history, retrace forward
    if (historyIndexRef.current < historyRef.current.length - 1) {
      const j = stepHistory(historyIndexRef.current, 1);
      if (j !== -1) {
        goToHistory(j, true);
        return;
      }
    }
    if (queue.length > 0) {
      const [next, ...rest] = queue;
      setQueue(rest);
      handleAdoptAndPlay(next.trackId, { autoPlay: true });
      return;
    }
    if (!tracks.length) return;
    const sorted = orderedContextTracks();
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
  }, [tracks, playingTrackId, currentTrackId, handleAdoptAndPlay, queue, shuffleEnabled, goToHistory, stepHistory, orderedContextTracks]);

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
    const filtered = historyRef.current.filter((h) => h.trackId !== id);
    if (filtered.length !== historyRef.current.length) {
      commitHistory(filtered, Math.min(historyIndexRef.current, filtered.length));
    }
    // drop the deleted track from every playlist that referenced it
    playlistsRef.current.forEach((pl) => {
      if (pl.trackIds.includes(id)) {
        persistPlaylist({ ...pl, trackIds: pl.trackIds.filter((t) => t !== id) });
      }
    });
  }, [currentTrackId, playingTrackId, commitHistory, persistPlaylist]);

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
    <div className="app" style={{ '--nav-width': `${navWidth}px`, '--np-width': '278px' }}>
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
          <PlaylistNav
            playlists={playlists}
            activeView={activeView}
            onSelectView={setActiveView}
            onFilesSelected={handleFilesSelected}
            onCreatePlaylist={handleCreatePlaylist}
            onOpenMenu={setContextMenu}
            onTogglePin={handleTogglePinPlaylist}
            onRenamePlaylist={handleRenamePlaylist}
            onDeletePlaylist={handleDeletePlaylist}
            onPlayPlaylist={handlePlayPlaylist}
            queue={queue}
            tracks={tracks}
            onRemoveFromQueue={handleRemoveFromQueue}
            onReorderQueue={handleReorderQueue}
            onClearQueue={handleClearQueue}
            history={history}
            historyIndex={historyIndex}
            onJumpToHistory={handleJumpToHistory}
            onClearHistory={handleClearHistory}
            onResizeStart={() => {
              isResizingSidebarRef.current = true;
            }}
          />
          <LibraryList
            tracks={shownTracks}
            viewTitle={activePlaylist ? activePlaylist.name : 'Imported'}
            isPlaylistView={!!activePlaylist}
            playlistId={activePlaylist?.id}
            playlists={playlists}
            currentTrackId={currentTrackId}
            playingTrackId={playingTrackId}
            expandedTrackId={expandedTrackId}
            viewMode={libraryViewMode}
            onSetViewMode={setLibraryViewMode}
            onSelectTrack={handleViewTrack}
            onPlayTrack={handlePlayTrack}
            onAddTag={handleAddTag}
            onRemoveTag={handleRemoveTag}
            onDeleteTagGroup={handleDeleteTagGroup}
            onDeleteTrack={handleDeleteTrack}
            onAddToQueue={handleAddToQueue}
            onAddTracksToPlaylist={handleAddTracksToPlaylist}
            onCreatePlaylistWithTracks={handleCreatePlaylist}
            onRemoveTrackFromPlaylist={handleRemoveTrackFromPlaylist}
            onReorderPlaylistTracks={handleReorderPlaylistTracks}
            onOpenMenu={setContextMenu}
            searchInputRef={searchInputRef}
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
          // middle (track-list) column in the 3-column library view
          style={
            view === 'sidebar'
              ? { left: `calc((100% + var(--nav-width) - var(--np-width)) / 2)` }
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
      {importProgress && (
        <ImportOverlay done={importProgress.done} total={importProgress.total} />
      )}
      {importToast && (
        <ImportToast toast={importToast} onDismiss={dismissImportToast} />
      )}
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
      <ContextMenu menu={contextMenu} onClose={() => setContextMenu(null)} />
    </div>
  );
}
