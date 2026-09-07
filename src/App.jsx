import { useEffect, useLayoutEffect, useRef, useState, useCallback, useMemo } from 'react';
import { createPortal } from 'react-dom';
import PlaylistNav from './components/PlaylistNav';
import LibraryList from './components/LibraryList';
import ContextMenu from './components/ContextMenu';
import PromptModal from './components/PromptModal';
import PlaylistEditModal from './components/PlaylistEditModal';
import NowPlaying from './components/NowPlaying';
import GearIcon from './components/GearIcon';
import FocusView from './components/FocusView';
import MiniPlayer from './components/MiniPlayer';
import BackgroundPlayBar from './components/BackgroundPlayBar';
import Waveform from './components/Waveform';
import SettingsModal from './components/SettingsModal';
import SearchOverlay from './components/SearchOverlay';
import VolumeIcon from './components/VolumeIcon';
import ImportOverlay from './components/ImportOverlay';
import ImportToast from './components/ImportToast';
import VersionsModal from './components/VersionsModal';
import CoverEditModal from './components/CoverEditModal';
import EditArtistModal from './components/EditArtistModal';
import ChoiceModal from './components/ChoiceModal';
import LibrarySetup from './components/LibrarySetup';
import {
  addTrack,
  getAllTracks,
  updateTrack,
  replaceTrack,
  deleteTrack,
  getAllPlaylists,
  putPlaylist,
  deletePlaylistRecord,
  resetLibraryDatabase
} from './lib/db';
import { buildImportedTrack } from './lib/parseTrack';
import {
  mediaUrl,
  assertRelPath,
  isRelPath,
  readAudioMeta,
  fingerprint,
  makeVersion,
  activeVersion,
  displayTitle,
  importTitle,
  allVersions,
  extFromName,
  sniffExt
} from './lib/media';
import { useArtworkPalette } from './lib/useDominantColor';
import { loadKeybindings, saveKeybindings, eventToKeyString, DEFAULT_KEYBINDINGS } from './lib/keybindings';
import { sortLibrary, reconcileLibraryOrder } from './lib/librarySort';
import { reconcileTagOrder, reorderTags } from './lib/tagOrder';
import { primaryArtist } from './lib/artistName';
import { noteRank } from './lib/notes';
import { invalidateArtworkHash } from './lib/artworkHash';
import { fisherYates } from './lib/shuffle';
import {
  serializeLibrary,
  artFileName,
  artType,
  artRefsOf,
  isSnapshotShaped,
  hydrateTrack,
  hydratePlaylist,
  isValidTrack,
  READABLE_FORMATS
} from './lib/syncSnapshot';
import { stampAfter, mergeLibraries, applyMergedRecords, mergeTombstones } from './lib/syncMerge';

// One-time: earlier builds could persist a hand-dragged column width (often
// from an accidental grab of a resize handle, or — before this fix — a
// resize-driven auto-clamp that got saved as if it were a real drag) that
// no longer matches the re-tuned default proportions. Clear those once so
// the measured default applies; the user can still drag to a new width
// afterwards and that sticks. Bump this version string again any time a
// stale saved width needs to be force-reset.
try {
  if (localStorage.getItem('layoutDefaults') !== 'v2.5') {
    localStorage.removeItem('npWidth');
    localStorage.removeItem('navWidth');
    localStorage.setItem('layoutDefaults', 'v2.5');
  }
} catch {
  /* localStorage unavailable — nothing to reset */
}

// Shared by the global keybindings dispatcher and the space-hold-for-2x
// effect (2026-09-06) — one definition so the two never drift apart on
// what counts as "typing." Excludes the volume <input type="range"> — if
// it happens to have focus, arrow keys/space should still drive the normal
// handlers below rather than the browser's native range-input behavior.
// Is the user mid-edit in a text field right now? The sync merge never
// applies remote changes while this is true (stage 5): a merge re-renders
// whatever it touched, and a note being typed, a title mid-rename, a
// playlist name half-entered must not be re-rendered or removed underneath
// the cursor. Fields where a merge landing is harmless (the library search
// box, the search overlay, Settings, an EMPTY "add a note…" field — the
// notes panel autofocuses that one, and reading notes must not block sync)
// opt out with data-sync-passive so a cursor parked in them doesn't hold
// sync back. Resumption of a deferred merge is in the trigger effect below.
function editInProgress() {
  const el = document.activeElement;
  if (!(el instanceof HTMLElement)) return false;
  if (el.dataset.syncPassive !== undefined) return false;
  if (el.tagName === 'INPUT') return !['range', 'checkbox', 'radio', 'file', 'button', 'submit'].includes(el.type);
  return el.tagName === 'TEXTAREA' || el.isContentEditable;
}

function isTypingTarget(e) {
  const target = e.target;
  return (
    target instanceof HTMLElement &&
    ((target.tagName === 'INPUT' && target.type !== 'range') ||
      target.tagName === 'TEXTAREA' ||
      target.isContentEditable)
  );
}

export default function App() {
  const [tracks, setTracks] = useState([]);
  // currentTrackId: the track shown in the main panel (what you're browsing).
  // playingTrackId: the track actually loaded into the audio engine. They're
  // usually the same, but browsing to a different track no longer stops
  // playback — only double-clicking (or hitting play while browsing) does.
  const [currentTrackId, setCurrentTrackId] = useState(null);
  const [playingTrackId, setPlayingTrackId] = useState(null);
  const [view, setView] = useState('sidebar'); // 'sidebar' | 'focus' | 'mini'
  const viewRef = useRef(view);
  viewRef.current = view;

  // playlists + which left-nav item the middle column is showing
  const [playlists, setPlaylists] = useState([]);
  const [activeView, setActiveView] = useState({ type: 'imported' }); // | { type: 'playlist', id } | { type: 'liked' } | { type: 'artist', name }
  // Where to return when leaving the artist page (Escape, or the header's
  // back button) — captured once, when FIRST navigating to an artist page,
  // not overwritten by navigating from one artist page straight to another
  // (via the search overlay) — so a chain of artist -> artist -> artist
  // still unwinds to wherever you actually started, not the last hop.
  // { view, activeView } | null; null whenever no artist page is open.
  const [artistPageReturn, setArtistPageReturn] = useState(null);
  const [libraryViewMode, setLibraryViewMode] = useState(
    () => localStorage.getItem('libraryViewMode') || 'list'
  );
  // Library search text + active tag filter. Lifted here (not persisted —
  // session state, not a saved preference) so they survive LibraryList
  // unmounting on a fullscreen/mini round trip, same reason as libScrollRef
  // below. Switching playlists/sort does NOT clear these (matches existing
  // behavior); only an actual LibraryList unmount ever used to lose them.
  const [librarySearchQuery, setLibrarySearchQuery] = useState('');
  const [libraryActiveTag, setLibraryActiveTag] = useState(null);
  // Imported-view sort. 'added' | 'artist' | 'custom'; dir 'desc' | 'asc'.
  // Playlists are unaffected — they keep their manual trackIds order.
  const [librarySort, setLibrarySort] = useState(
    () => localStorage.getItem('librarySort') || 'added'
  );
  const [librarySortDir, setLibrarySortDir] = useState(
    () => localStorage.getItem('librarySortDir') || 'desc'
  );
  // the user's hand-dragged library order (track ids). Kept reconciled with
  // the real library at all times so switching back to 'custom' always works.
  const [libraryOrder, setLibraryOrder] = useState(() => {
    try {
      return JSON.parse(localStorage.getItem('libraryOrder') || '[]');
    } catch {
      return [];
    }
  });
  // Sync stamp for libraryOrder as a whole (newest order wins whole, see
  // syncMerge.js). Bumped ONLY by a real drag in handleReorderLibrary, never
  // by the reconcile effect below — otherwise an import on one machine would
  // out-stamp a drag on the other.
  const [libraryOrderUpdatedAt, setLibraryOrderUpdatedAt] = useState(() => {
    const n = Number(localStorage.getItem('libraryOrderUpdatedAt'));
    return Number.isFinite(n) ? n : 0;
  });
  // Global tag chip order (drag-reorderable in the tag row) — ONE array
  // shared by every view (Imported, Liked, playlists, artist pages), not
  // per-view. Per-machine display preference, not synced (see tagOrder.js).
  const [tagOrder, setTagOrder] = useState(() => {
    try {
      return JSON.parse(localStorage.getItem('tagOrder') || '[]');
    } catch {
      return [];
    }
  });
  // Deleted tracks/playlists, kept so the delete propagates through this
  // machine's snapshot instead of the other machine's copy resurrecting it:
  // [{ id, kind: 'track' | 'playlist', updatedAt }]. Never pruned (tiny).
  const [tombstones, setTombstones] = useState(() => {
    try {
      const raw = JSON.parse(localStorage.getItem('syncTombstones') || '[]');
      return Array.isArray(raw) ? raw : [];
    } catch {
      return [];
    }
  });
  // Liked view's own sort — separate from librarySort since its default and
  // options differ ('likedAt' isn't meaningful anywhere else). No custom
  // order: Liked isn't backed by a manual trackIds array, it's a live filter
  // over every liked track.
  const [likedSort, setLikedSort] = useState(() => localStorage.getItem('likedSort') || 'likedAt');
  const [likedSortDir, setLikedSortDir] = useState(
    () => localStorage.getItem('likedSortDir') || 'desc'
  );
  // Liked view's displayed row membership — deliberately NOT a live filter.
  // Snapshotted on entry and on sort change only, so unliking a track while
  // you're looking at this view leaves its row in place (heart flips to
  // outlined immediately since that reads live off `tracks`, but the row
  // itself doesn't vanish until you navigate away or change sort — a
  // misclick shouldn't make the row disappear out from under the cursor).
  const [likedViewIds, setLikedViewIds] = useState([]);
  // Artist page's own sort (2026-09-06) — same shape as Liked's, but no
  // snapshot: unlike Liked (a quick heart-toggle that shouldn't vanish a row
  // out from under a misclick), a track's artist only ever changes via the
  // deliberate rename flow in VersionsModal, so a plain live filter over
  // `tracks` is simpler and there's no accidental-vanishing row to guard
  // against. 'added' default, not 'artist' — every row here already shares
  // the same artist, so "Artist A–Z" would just degrade to a title sort
  // (still offered, since it's the same option set as a playlist view, just
  // not a useful DEFAULT for a single-artist list).
  const [artistSort, setArtistSort] = useState(() => localStorage.getItem('artistSort') || 'added');
  const [artistSortDir, setArtistSortDir] = useState(
    () => localStorage.getItem('artistSortDir') || 'desc'
  );
  const [contextMenu, setContextMenu] = useState(null);
  const [promptConfig, setPromptConfig] = useState(null);
  const [editingPlaylistId, setEditingPlaylistId] = useState(null);
  const [navCollapsed, setNavCollapsed] = useState(false);
  // ordering context for skip/auto-advance: follows whichever list a new
  // playing track was chosen from ('library' order, or a specific playlist)
  const [playbackContext, setPlaybackContext] = useState({ type: 'library' });
  const playlistsRef = useRef(playlists);
  const playbackContextRef = useRef(playbackContext);
  const activeViewRef = useRef(activeView);
  const tracksRef = useRef(tracks);
  const librarySortRef = useRef(librarySort);
  const librarySortDirRef = useRef(librarySortDir);
  const libraryOrderRef = useRef(libraryOrder);
  const libraryOrderUpdatedAtRef = useRef(libraryOrderUpdatedAt);
  const tombstonesRef = useRef(tombstones);
  const currentTrackIdRef = useRef(currentTrackId);
  const likedSortRef = useRef(likedSort);
  const likedSortDirRef = useRef(likedSortDir);
  const artistSortRef = useRef(artistSort);
  const artistSortDirRef = useRef(artistSortDir);
  // read by the shuffle-order effects below so they can anchor a rebuild on
  // "whatever's actually playing right now" without depending on
  // playingTrackId itself (which would rebuild on every track change, not
  // just on a shuffle toggle or context change)
  const playingTrackIdRef = useRef(playingTrackId);
  playlistsRef.current = playlists;
  playbackContextRef.current = playbackContext;
  activeViewRef.current = activeView;
  tracksRef.current = tracks;
  librarySortRef.current = librarySort;
  librarySortDirRef.current = librarySortDir;
  libraryOrderRef.current = libraryOrder;
  libraryOrderUpdatedAtRef.current = libraryOrderUpdatedAt;
  tombstonesRef.current = tombstones;
  currentTrackIdRef.current = currentTrackId;
  likedSortRef.current = likedSort;
  likedSortDirRef.current = likedSortDir;
  artistSortRef.current = artistSort;
  artistSortDirRef.current = artistSortDir;
  playingTrackIdRef.current = playingTrackId;

  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  // mirrored so the library header's play/pause handler stays referentially
  // stable — it must not be recreated on every 200ms currentTime tick, or
  // memo(LibraryList) re-renders through playback
  const isPlayingRef = useRef(isPlaying);
  const currentTimeRef = useRef(currentTime);
  isPlayingRef.current = isPlaying;
  currentTimeRef.current = currentTime;

  const waveformRef = useRef(null);

  // Hold-space-for-2x tape-style speed (2026-09-06). State lives in refs,
  // not React state, so the keydown/keyup effect below, handleFinish, and
  // the track/view-change and window-blur effects can all reach and reset
  // the SAME in-progress hold without any of them needing it in a
  // dependency array (a ref write triggers no re-render, which is exactly
  // right here — this is playback-engine state, not UI state).
  const spaceHoldTimerRef = useRef(null);
  const spaceHoldActiveRef = useRef(false); // crossed the threshold — rate is currently 2x
  const spaceHoldTrackingRef = useRef(false); // a keydown/keyup pair we own is in progress
  // The one place that ever un-does a hold, from wherever it's called:
  // a real release, or any of the "something changed out from under this"
  // cases (track end, track switch, view change, a modal opening, the
  // window losing focus). Safe to call when nothing is happening — every
  // branch is a no-op unless there's actually a timer pending or the rate
  // is actually at 2x.
  const resetSpaceHold = useCallback(() => {
    if (spaceHoldTimerRef.current) {
      clearTimeout(spaceHoldTimerRef.current);
      spaceHoldTimerRef.current = null;
    }
    if (spaceHoldActiveRef.current) {
      spaceHoldActiveRef.current = false;
      waveformRef.current?.setPlaybackRate(1, true);
    }
    spaceHoldTrackingRef.current = false;
  }, []);

  const searchInputRef = useRef(null);
  const [pendingFocusSearch, setPendingFocusSearch] = useState(false);
  const [expandedTrackId, setExpandedTrackId] = useState(null);
  // Option+Space quick-search overlay (2026-09-06) — see the global keydown
  // effect below for the trigger and SearchOverlay.jsx for the UI. Always
  // starts closed on mount/reopen (no "remember last query" — the component
  // itself starts its query state fresh every time it mounts, since it's
  // conditionally rendered, not just CSS-hidden).
  const [searchOverlayOpen, setSearchOverlayOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  // true while Settings was opened from mini mode, so closing it returns
  // there instead of leaving the window in the normal view. Transient by
  // design — doesn't need to survive a restart. Opening from the normal
  // view or fullscreen doesn't touch `view` at all (see handleOpenSettings),
  // so those cases need no equivalent flag: closing just leaves `view`
  // wherever it already was, which is already the desired behavior.
  const [returnToMiniAfterSettings, setReturnToMiniAfterSettings] = useState(false);
  // now-playing notes panel open state — lifted here so the "n" shortcut and
  // the icon click drive the same thing
  const [notesPanelOpen, setNotesPanelOpen] = useState(false);
  // import UX: progress overlay while parsing/storing, then a self-dismissing
  // top-right confirmation toast. Both null when no import is happening.
  const [importProgress, setImportProgress] = useState(null); // { done, total } | { done, total, label }
  const [importToast, setImportToast] = useState(null); // { id, count } | { id, error }
  const [versionsModalTrackId, setVersionsModalTrackId] = useState(null);
  // null when closed; a non-empty array of track ids while open (one id for
  // a single-track edit, several when the right-clicked row was part of a
  // selection — see LibraryList's menuTargets)
  const [coverEditTrackIds, setCoverEditTrackIds] = useState(null);
  // null when closed; a multi-selection's track ids while open — see
  // EditArtistModal.jsx (multi-selection only; a single track keeps its
  // existing inline rename in VersionsModal)
  const [editArtistTrackIds, setEditArtistTrackIds] = useState(null);
  // multi-choice confirm (e.g. merge / copy / cancel when adding a version
  // from a file that's already its own track). null when nothing to ask.
  const [choiceConfig, setChoiceConfig] = useState(null);
  // relPaths of active versions whose file is missing from disk
  const [missingPaths, setMissingPaths] = useState(() => new Set());
  // relPaths of active versions whose file has NEVER been seen on this
  // machine's disk — a remote track whose audio is still on its way through
  // Dropbox. Shown as "syncing", not "missing", and relocate isn't offered.
  // A file that WAS here once and is now absent is genuinely missing.
  // `seenRelPaths` in localStorage remembers which files this machine has
  // seen, across launches.
  const [waitingPaths, setWaitingPaths] = useState(() => new Set());
  const seenPathsRef = useRef(null);
  // bumped by main's watcher whenever audio files land / move under the
  // root, so the missing-file sweep re-runs without a tracks change
  const [fileSweepTick, setFileSweepTick] = useState(0);
  // The per-machine library root, from electron/main.js: undefined while
  // loading, then { root: string|null, exists: boolean, machineId }. The
  // renderer never uses `root` for anything but display — every path it
  // holds is relative to it (see media.js assertRelPath).
  const [libraryRoot, setLibraryRoot] = useState(undefined);
  // true when IndexedDB holds records from before the relative-path rework
  // (a version without a valid relPath). Those records are NOT loaded into
  // `tracks` — nothing here can play, rename, delete or sync them correctly,
  // and any write path would make it worse — so the app blocks behind
  // <LibrarySetup> until the library is reset. Deliberately no auto-migration:
  // the sync plan starts from a wiped library on both machines.
  const [legacyLibrary, setLegacyLibrary] = useState(false);
  // In the packaged app, nothing path-based may run until a root exists on
  // disk. In the plain dev browser (no electronAPI) there's no root concept
  // and no playback anyway, so don't block the UI there.
  const libraryReady = !window.electronAPI || !!libraryRoot?.exists;
  const setupGate = legacyLibrary || (!!window.electronAPI && libraryRoot !== undefined && !libraryRoot.exists);
  const libraryRootRef = useRef(libraryRoot);
  libraryRootRef.current = libraryRoot;
  // Library lifecycle for sync (stages 3–4):
  //   'loading' — IndexedDB not read yet
  //   'sync'    — IndexedDB read; waiting for a root, then the initial merge
  //               of every other machine's snapshot (which is also what fills
  //               an empty library on a new machine)
  //   'ready'   — normal operation; the snapshot writer is armed
  //   'blocked' — legacy records, see legacyLibrary
  // The writer runs ONLY in 'ready'. Anything earlier would snapshot an
  // empty or half-merged library as if it were this machine's truth.
  const [libraryPhase, setLibraryPhase] = useState('loading');
  // when this machine's snapshot was last written / other machines' last
  // merged in (Settings > Library)
  const [lastSnapshotAt, setLastSnapshotAt] = useState(null);
  const [lastSyncAt, setLastSyncAt] = useState(null);
  const [theme, setTheme] = useState(() => localStorage.getItem('theme') || 'dark');
  // 0-100: fullscreen background drift/audio-reaction intensity (see
  // useGradientDrift). Default 61 (2026-09-05, was 50 — retuned by feel;
  // existing saved values are untouched, this only changes what a fresh
  // install or a reset lands on).
  const [backgroundMovement, setBackgroundMovement] = useState(() => {
    const saved = parseFloat(localStorage.getItem('backgroundMovement'));
    return Number.isFinite(saved) ? saved : 61;
  });
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

  // when on, "next" and auto-advance-on-finish walk a persisted shuffled
  // order of the current context (see shuffleOrder / buildShuffleOrder /
  // advanceShuffle below) instead of library order — a real Fisher-Yates
  // permutation built once, not a fresh random pick every time, so nothing
  // repeats until the whole context has played. "Previous" needs no
  // shuffle-specific logic at all: it already walks the real play-history
  // list (handleSkip's direction===-1 branch), which is the actual path
  // played regardless of shuffle.
  const [shuffleEnabled, setShuffleEnabled] = useState(() => localStorage.getItem('shuffle') === '1');
  useEffect(() => {
    localStorage.setItem('shuffle', shuffleEnabled ? '1' : '0');
  }, [shuffleEnabled]);
  const handleToggleShuffle = useCallback(() => setShuffleEnabled((v) => !v), []);
  const shuffleEnabledRef = useRef(shuffleEnabled);
  shuffleEnabledRef.current = shuffleEnabled;

  // three-state repeat, cycled off -> all -> one -> off. `all` makes
  // auto-advance wrap to the top of the context instead of stopping at the
  // end; `one` loops the current track on finish (but a manual next-track
  // still skips). Persisted like shuffle.
  const [repeatMode, setRepeatMode] = useState(() => {
    const v = localStorage.getItem('repeat');
    return v === 'all' || v === 'one' ? v : 'off';
  });
  useEffect(() => {
    localStorage.setItem('repeat', repeatMode);
  }, [repeatMode]);
  const handleCycleRepeat = useCallback(() => {
    setRepeatMode((m) => (m === 'off' ? 'all' : m === 'all' ? 'one' : 'off'));
  }, []);

  // draggable column widths — left nav (handle on its right edge) and the
  // right now-playing column (handle on its left edge)
  const [navWidth, setNavWidth] = useState(() => {
    const saved = parseInt(localStorage.getItem('navWidth'), 10);
    const cap = Math.max(170, window.innerWidth - 460);
    return Number.isFinite(saved) ? Math.min(340, cap, Math.max(170, saved)) : 236;
  });
  // null = responsive (grows with the window via a CSS clamp); a number once
  // the user has dragged the handle to pin a specific width
  const [npWidth, setNpWidth] = useState(() => {
    const saved = parseInt(localStorage.getItem('npWidth'), 10);
    if (!Number.isFinite(saved)) return null;
    const cap = Math.max(300, window.innerWidth - 200 - 300);
    return Math.min(1400, cap, Math.max(300, saved));
  });
  // tracked so the responsive now-playing width (and the collapsed 50/50
  // split) can be fed to the grid as clean px — needed for the width vars
  // to animate on Tab (see @property in styles.css)
  const [viewportW, setViewportW] = useState(() => window.innerWidth);
  const isResizingSidebarRef = useRef(false);
  const isResizingNpRef = useRef(false);
  const navWidthRef = useRef(navWidth);
  navWidthRef.current = navWidth;
  // read by the mini-mode effect below to snapshot the pre-mini column
  // widths without a stale closure
  const npWidthRef = useRef(npWidth);
  npWidthRef.current = npWidth;
  const appRef = useRef(null);
  // snapshot of {navWidth, npWidth} taken the instant mini mode is entered,
  // force-restored the instant it's exited — see the mini-mode effect below
  // for why this exists (a real BrowserWindow resize happens for mini mode,
  // and the resize-driven clamp a few lines down can't tell that transient
  // 240px/garbage-px window from a real narrow sidebar, so it silently
  // ratchets both columns down and, being Math.min-only, can never grow them
  // back on its own).
  const preMiniLayoutRef = useRef(null);
  // previous `view`, so the mini-mode effect only fires enter/exit IPC (and
  // the column-width restore) on a genuine mini transition, not on every
  // view change that merely isn't 'mini' (e.g. a plain sidebar<->focus swap
  // used to re-invoke exitMiniMode() every time, harmlessly but pointlessly)
  const prevViewRef = useRef(view);
  // last width computed mid-drag; committed to React state + localStorage on
  // mouseup only. During the drag we write the CSS var straight to the DOM so
  // there's no per-frame re-render (that was the "resize feels laggy").
  const pendingNavRef = useRef(null);
  const pendingNpRef = useRef(null);

  // middle library-list scroll position, preserved across a fullscreen/mini
  // round-trip (which unmounts LibraryList). Owned here so it survives that
  // unmount; LibraryList reads/writes it and resets it on a list switch.
  const libScrollRef = useRef(0);

  // j/k library scroll — a small rAF easing loop toward an accumulating
  // target, so holding the key glides smoothly instead of jumping. Distinct
  // from d/u's instant track jump.
  const jkScrollRef = useRef({ el: null, target: 0, raf: 0 });
  // `big` = d/u's fast scroll — same easing loop as j/k, just a larger jump
  // per press (~half a viewport, vim ctrl-d/ctrl-u style) instead of 90px.
  const nudgeLibraryScroll = useCallback((dir, big = false) => {
    const el = document.querySelector('.track-list, .track-grid');
    if (!el) return;
    const st = jkScrollRef.current;
    const max = el.scrollHeight - el.clientHeight;
    if (!st.raf || st.el !== el) {
      st.el = el;
      st.target = el.scrollTop;
    }
    const step = big ? el.clientHeight * 0.5 : 90;
    st.target = Math.max(0, Math.min(max, st.target + dir * step));
    if (!st.raf) {
      const tick = () => {
        const cur = st.el.scrollTop;
        const diff = st.target - cur;
        if (Math.abs(diff) < 0.5) {
          st.el.scrollTop = st.target;
          st.raf = 0;
          return;
        }
        st.el.scrollTop = cur + diff * 0.18;
        st.raf = requestAnimationFrame(tick);
      };
      st.raf = requestAnimationFrame(tick);
    }
  }, []);
  useEffect(() => () => cancelAnimationFrame(jkScrollRef.current.raf), []);

  const startResizeNav = useCallback(() => {
    isResizingSidebarRef.current = true;
    appRef.current?.classList.add('resizing');
  }, []);
  const startResizeNp = useCallback(() => {
    isResizingNpRef.current = true;
    appRef.current?.classList.add('resizing');
  }, []);

  useEffect(() => {
    function handleMouseMove(e) {
      if (isResizingSidebarRef.current) {
        const w = Math.min(340, Math.max(170, e.clientX));
        pendingNavRef.current = w;
        appRef.current?.style.setProperty('--nav-width', `${w}px`);
      } else if (isResizingNpRef.current) {
        const maxNp = Math.max(300, window.innerWidth - navWidthRef.current - 300);
        const w = Math.min(1400, maxNp, Math.max(300, window.innerWidth - e.clientX));
        pendingNpRef.current = w;
        appRef.current?.style.setProperty('--np-width', `${w}px`);
      }
    }
    function handleMouseUp() {
      if (isResizingSidebarRef.current) {
        isResizingSidebarRef.current = false;
        appRef.current?.classList.remove('resizing');
        if (pendingNavRef.current != null) {
          setNavWidth(pendingNavRef.current);
          localStorage.setItem('navWidth', String(pendingNavRef.current));
          pendingNavRef.current = null;
        }
      }
      if (isResizingNpRef.current) {
        isResizingNpRef.current = false;
        appRef.current?.classList.remove('resizing');
        if (pendingNpRef.current != null) {
          setNpWidth(pendingNpRef.current);
          localStorage.setItem('npWidth', String(pendingNpRef.current));
          pendingNpRef.current = null;
        }
      }
    }
    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, []);

  // track the viewport, and if the window shrinks pull the (pinned) column
  // widths back into a range that still leaves the middle track list room.
  // This clamp is display-only — it does NOT touch localStorage. It used
  // to persist the shrunk value on every resize event, including a
  // transient small measurement while the window was still being created
  // or restored on launch (not an actual user drag) — that permanently
  // ratcheted the saved width down with no way back up, which is exactly
  // what made the layout look "too small" after quitting and reopening.
  // Only an explicit drag (the mouseup handlers above) should persist.
  //
  // SIDEBAR_MIN_WIDTH guard (2026-09-04): mini mode really resizes the OS
  // window (electron/main.js enter/exit-mini-mode), which fires genuine
  // native 'resize' events the sidebar view never asked for — a legitimate
  // 240px mini window, and (observed) transient sub-20px garbage readings
  // during the resize sequence itself. Both are narrower than the sidebar
  // view's own enforced floor (electron/main.js DEFAULT_MIN_WIDTH — keep
  // these in sync), so neither can ever be a real "the sidebar got resized"
  // event. Below that floor this whole block is a no-op: it used to instead
  // run the shrink-only clamp against these bogus widths, silently ratcheting
  // navWidth/npWidth down with no way back (see preMiniLayoutRef below for
  // the belt-and-suspenders restore on the mini round trip specifically).
  const SIDEBAR_MIN_WIDTH = 900;
  useEffect(() => {
    let raf = 0;
    function onResize() {
      if (window.innerWidth < SIDEBAR_MIN_WIDTH) return;
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        if (window.innerWidth < SIDEBAR_MIN_WIDTH) return;
        setViewportW(window.innerWidth);
        setNavWidth((w) => Math.min(w, Math.max(170, window.innerWidth - 460)));
        setNpWidth((w) => (w == null ? w : Math.min(w, Math.max(300, window.innerWidth - navWidthRef.current - 300))));
      });
    }
    window.addEventListener('resize', onResize);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', onResize);
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
    Promise.all([getAllTracks(), getAllPlaylists()]).then(([all, pls]) => {
      // see legacyLibrary above — a single pre-rework record blocks the
      // whole library rather than loading a mix of usable and unusable rows
      const legacy = all.filter(
        (t) => !Array.isArray(t.versions) || !t.versions.length || t.versions.some((v) => !isRelPath(v.relPath))
      );
      if (legacy.length) {
        console.error(
          `[library] ${legacy.length} of ${all.length} tracks predate the relative-path rework (no valid version.relPath) — refusing to load; reset the library to continue. First offender:`,
          legacy[0]
        );
        setLegacyLibrary(true);
        setLibraryPhase('blocked');
        return;
      }
      setTracks(all);
      setPlaylists(pls.map((p) => ({ pinned: false, sortIndex: p.createdAt, ...p })));
      // empty or not, the other machines' snapshots get merged in first —
      // see the initial sync effect below
      setLibraryPhase('sync');
    });
    window.electronAPI?.getLibraryRoot?.().then(setLibraryRoot);
  }, []);

  // Settings / first-launch gate: native folder picker in main. A cancel
  // leaves things as they were.
  const handleChooseLibraryRoot = useCallback(async () => {
    const res = await window.electronAPI?.chooseLibraryRoot?.();
    if (res) setLibraryRoot(res);
  }, []);

  // ---- library sync (docs/LIBRARY_SYNC_PLAN.md, stages 3–4) ----
  //
  // Reading = fold every OTHER machine's snapshot into ours with the pure
  // merge in syncMerge.js (newest wins per item, tombstones, per-note
  // stamps), hydrate whatever it took from a remote (art read back from the
  // art files), then apply. Runs once at launch — that run also stamps any
  // record from before stage 4, and is what fills an empty library from
  // another machine's snapshot (stage 3's "bootstrap" is just a merge into
  // nothing) — and again whenever the window regains focus.
  //
  // Apply goes through state UPDATERS (applyMergedRecords re-checks each
  // item against whatever the list is by then), and IndexedDB is written
  // from the COMMITTED state by the drain effects next to handleDeleteTrack
  // — so the database mirrors exactly what React ended up with, whichever
  // side won at apply time. A remote record whose art isn't on disk yet is
  // deferred whole (`accept` below): taking it with a null cover would
  // stamp "no cover" as this machine's newest truth and the art would never
  // arrive. It's retried on the next merge.
  const knownArtRef = useRef(null); // Set of "<hash>.<ext>" | null until listed
  const syncBusyRef = useRef(false);
  const syncAgainRef = useRef(false); // a merge was requested mid-merge
  const syncSkippedRef = useRef(false); // an apply skipped an item that moved; merge again
  const lastSyncStartRef = useRef(0);
  const initialSyncDoneRef = useRef(false);
  // ids the last merge touched, drained to IndexedDB once state has committed
  const pendingSyncTrackIdsRef = useRef(new Set());
  const pendingSyncPlaylistIdsRef = useRef(new Set());

  const syncDeferredForEditRef = useRef(false); // a merge waited for an edit to finish
  const runSync = useCallback(async ({ initial = false, reason = 'focus' } = {}) => {
    if (syncBusyRef.current) {
      syncAgainRef.current = true;
      return;
    }
    // never apply under a live edit (see editInProgress) — checked here
    // before the read, and again right before apply since the read is async
    if (!initial && editInProgress()) {
      syncDeferredForEditRef.current = true;
      console.log(`[sync] deferred (${reason}): an edit is in progress; will merge when it ends`);
      return;
    }
    // focus can fire in bursts (clicking between windows); one read a second is plenty
    if (reason === 'focus' && Date.now() - lastSyncStartRef.current < 1000) return;
    syncBusyRef.current = true;
    lastSyncStartRef.current = Date.now();
    const wasEmpty = tracksRef.current.length === 0 && playlistsRef.current.length === 0;
    try {
      const [snaps, artNames] = await Promise.all([
        window.electronAPI.syncReadSnapshots(),
        window.electronAPI.syncListArt()
      ]);
      knownArtRef.current = new Set(artNames);
      const own = snaps.find((s) => s.own);
      // Dropbox conflicted copies are merged like any other snapshot and
      // then removed — but only once a merge run has actually consumed them
      // in full (no record deferred waiting for art), so nothing they carry
      // is lost.
      const conflicted = snaps.filter((s) => s.conflicted && s.doc).map((s) => s.file);
      const cleanupConflicts = (deferred) => {
        if (!conflicted.length || deferred) return;
        window.electronAPI.syncDeleteConflictedCopies?.(conflicted).catch((err) =>
          console.warn('[sync] conflicted-copy cleanup failed:', err)
        );
      };
      const remotes = snaps
        .filter((s) => !s.own && s.doc)
        .sort((a, b) => (a.file < b.file ? -1 : a.file > b.file ? 1 : 0))
        .filter((s) => {
          if (READABLE_FORMATS.has(s.doc.format)) return true;
          console.warn(`[sync] skipping ${s.file}: unsupported snapshot format ${s.doc.format}`);
          return false;
        })
        .map((s) => ({ file: s.file, doc: s.doc, fallbackStamp: s.doc.writtenAt || 0 }));

      // Records from before stage 4 carry no updatedAt. On the first stage-4
      // launch they're stamped ONCE with this machine's last snapshot's
      // writtenAt — the newest anything here could have been edited — NOT
      // Date.now(), which would out-stamp every real edit the other machine
      // made since. A remote pre-stage-4 record reads the same way, off its
      // own snapshot's writtenAt (fallbackStamp above). Either upgrade
      // order converges.
      const fallback = initial ? own?.doc?.writtenAt || 0 : 0;
      const basedOnTracks = new Map(tracksRef.current.map((t) => [t.id, t]));
      const basedOnPlaylists = new Map(playlistsRef.current.map((p) => [p.id, p]));
      const basedOnTombstones = tombstonesRef.current;
      const known = knownArtRef.current;
      const artHere = (rec) => artRefsOf(rec).every((r) => known.has(artFileName(r)));
      const accept = (kind, rec) => (kind === 'track' ? isValidTrack(rec) : true) && artHere(rec);
      const result = mergeLibraries({
        local: {
          tracks: tracksRef.current,
          playlists: playlistsRef.current,
          tombstones: basedOnTombstones,
          libraryOrder: libraryOrderRef.current,
          libraryOrderUpdatedAt: libraryOrderUpdatedAtRef.current,
          fallbackStamp: fallback
        },
        remotes,
        accept
      });
      const nRemote =
        result.changedTracks.size +
        result.deletedTracks.size +
        result.changedPlaylists.size +
        result.deletedPlaylists.size;
      const nRemoteTracks = result.changedTracks.size;
      if (initial) {
        for (const t of result.tracks) {
          if (typeof t.updatedAt !== 'number') result.changedTracks.set(t.id, { ...t, updatedAt: fallback });
        }
        for (const p of result.playlists) {
          if (typeof p.updatedAt !== 'number') result.changedPlaylists.set(p.id, { ...p, updatedAt: fallback });
        }
      }
      const nothing =
        !result.changedTracks.size &&
        !result.deletedTracks.size &&
        !result.changedPlaylists.size &&
        !result.deletedPlaylists.size &&
        !result.tombstonesChanged &&
        !result.libraryOrderChanged;
      if (nothing) {
        if (result.deferred) {
          console.log(`[sync] nothing to merge; ${result.deferred} remote record(s) still waiting for their art files`);
        }
        cleanupConflicts(result.deferred);
        return;
      }

      // hydrate remote winners: read each art file they reference, once
      const need = new Set();
      for (const rec of [...result.changedTracks.values(), ...result.changedPlaylists.values()]) {
        if (isSnapshotShaped(rec)) for (const r of artRefsOf(rec)) need.add(artFileName(r));
      }
      const blobs = new Map();
      for (const name of need) {
        const bytes = await window.electronAPI.syncReadArt(name);
        if (bytes) blobs.set(name, new Blob([bytes], { type: artType(name.split('.').pop()) }));
        else console.warn('[sync] art file vanished between listing and reading:', name);
      }
      const getBlob = (r) => blobs.get(artFileName(r)) || null;

      // the read took time; an edit may have started meanwhile
      if (!initial && editInProgress()) {
        syncDeferredForEditRef.current = true;
        console.log('[sync] deferred at apply: an edit is in progress; will merge when it ends');
        return;
      }
      const changedTracks = new Map();
      for (const [id, rec] of result.changedTracks) {
        changedTracks.set(id, isSnapshotShaped(rec) ? hydrateTrack(rec, getBlob) : rec);
      }
      const changedPlaylists = new Map();
      for (const [id, rec] of result.changedPlaylists) {
        changedPlaylists.set(
          id,
          isSnapshotShaped(rec) ? { pinned: false, sortIndex: rec.createdAt, ...hydratePlaylist(rec, getBlob) } : rec
        );
      }

      // The playing track's active file may be about to change under the
      // engine (a version switch or rename on the other machine). Keep it
      // playing from 0, same as restartIfPlaying — audioUrl follows state,
      // so the reload itself needs nothing more. Rare, accepted (plan).
      const pid = playingTrackIdRef.current;
      if (pid && changedTracks.has(pid)) {
        const before = activeVersion(basedOnTracks.get(pid))?.relPath;
        const after = activeVersion(changedTracks.get(pid))?.relPath;
        if (before !== after) {
          shouldAutoPlayRef.current = isPlayingRef.current;
          setCurrentTime(0);
        }
      }

      if (changedTracks.size || result.deletedTracks.size) {
        for (const id of changedTracks.keys()) pendingSyncTrackIdsRef.current.add(id);
        for (const id of result.deletedTracks.keys()) pendingSyncTrackIdsRef.current.add(id);
        setTracks((prev) => {
          const r = applyMergedRecords(prev, {
            changed: changedTracks,
            deleted: result.deletedTracks,
            basedOn: basedOnTracks
          });
          if (r.skipped) syncSkippedRef.current = true;
          return r.records;
        });
      }
      if (changedPlaylists.size || result.deletedPlaylists.size) {
        for (const id of changedPlaylists.keys()) pendingSyncPlaylistIdsRef.current.add(id);
        for (const id of result.deletedPlaylists.keys()) pendingSyncPlaylistIdsRef.current.add(id);
        setPlaylists((prev) => {
          const r = applyMergedRecords(prev, {
            changed: changedPlaylists,
            deleted: result.deletedPlaylists,
            basedOn: basedOnPlaylists
          });
          if (r.skipped) syncSkippedRef.current = true;
          return r.records;
        });
      }
      if (result.tombstonesChanged) {
        setTombstones((prev) =>
          prev === basedOnTombstones ? result.tombstones : mergeTombstones(prev, result.tombstones)
        );
      }
      if (result.libraryOrderChanged) {
        setLibraryOrder(result.libraryOrder);
        setLibraryOrderUpdatedAt(result.libraryOrderUpdatedAt);
      }

      console.log(
        `[sync] merged ${remotes.length} snapshot(s): ${result.changedTracks.size} track(s) changed, ${result.deletedTracks.size} deleted; ${result.changedPlaylists.size} playlist(s) changed, ${result.deletedPlaylists.size} deleted` +
          (result.libraryOrderChanged ? '; library order' : '') +
          (result.deferred ? `; ${result.deferred} deferred (art not here yet)` : '')
      );
      if (nRemote) {
        setImportToast(
          wasEmpty && initial
            ? { id: Date.now(), loaded: nRemoteTracks, loadedFrom: 'Dropbox' }
            : { id: Date.now(), synced: nRemote }
        );
      }
      cleanupConflicts(result.deferred);
    } catch (err) {
      console.error('[sync] merge failed:', err);
    } finally {
      syncBusyRef.current = false;
      setLastSyncAt(Date.now());
      if (syncAgainRef.current) {
        syncAgainRef.current = false;
        runSync({ reason: 'again' });
      }
    }
  }, []);

  // Initial merge, once per launch, the moment IndexedDB is read AND a root
  // exists (the root can arrive later — first launch goes empty db -> choose
  // folder -> merge). Only then is the snapshot writer armed.
  useEffect(() => {
    if (libraryPhase !== 'sync' || !libraryReady || initialSyncDoneRef.current) return;
    initialSyncDoneRef.current = true;
    if (!window.electronAPI?.syncReadSnapshots) {
      setLibraryPhase('ready'); // dev browser: nothing to merge from
      return;
    }
    (async () => {
      if (tracksRef.current.length === 0 && playlistsRef.current.length === 0) {
        setImportProgress({ done: 0, total: 1, label: 'Loading library from Dropbox…' });
      }
      try {
        await runSync({ initial: true, reason: 'launch' });
      } finally {
        setImportProgress(null);
        setLibraryPhase('ready');
      }
    })();
  }, [libraryPhase, libraryReady, runSync]);

  // When to read (stage 5). The live signal is main's directory watcher:
  // another machine's snapshot (or an art file) landing under .playdisc/
  // through Dropbox arrives as 'sync-dir-changed', already debounced. Focus
  // and wake-from-sleep ('resume', also via that channel) are belt and
  // braces for anything the watcher could miss.
  //
  // Resuming a merge deferred by the edit guard: `focusout` alone is NOT
  // enough. Chromium fires no focusout/blur when the focused element is
  // REMOVED from the DOM (verified 2026-09-06: focus silently lands on
  // <body>) — which is exactly what Escape-closing the notes panel or the
  // versions modal does to its autofocused input. So every event that can
  // end an edit is watched (keydown for Escape/Enter, mousedown for a click
  // that closes or blurs, input for a field emptying back to passive), each
  // re-checking after a tick so React has committed and activeElement has
  // settled. Free when nothing is deferred: the flag check is the first
  // line.
  useEffect(() => {
    if (libraryPhase !== 'ready' || !libraryReady || !window.electronAPI?.syncReadSnapshots) return;
    const onFocus = () => runSync({ reason: 'focus' });
    window.addEventListener('focus', onFocus);
    const offDir = window.electronAPI.onSyncDirChanged?.((p) => runSync({ reason: p?.reason || 'watch' }));
    const offFiles = window.electronAPI.onLibraryFilesChanged?.(() => setFileSweepTick((n) => n + 1));
    let resumeTimer = null;
    const maybeResume = () => {
      if (!syncDeferredForEditRef.current) return;
      clearTimeout(resumeTimer);
      resumeTimer = setTimeout(() => {
        if (!syncDeferredForEditRef.current || editInProgress()) return;
        syncDeferredForEditRef.current = false;
        runSync({ reason: 'edit-done' });
      }, 0);
    };
    const EDIT_END_EVENTS = ['focusout', 'keydown', 'mousedown', 'input'];
    for (const ev of EDIT_END_EVENTS) document.addEventListener(ev, maybeResume, true);
    return () => {
      clearTimeout(resumeTimer);
      window.removeEventListener('focus', onFocus);
      for (const ev of EDIT_END_EVENTS) document.removeEventListener(ev, maybeResume, true);
      offDir?.();
      offFiles?.();
    };
  }, [libraryPhase, libraryReady, runSync]);

  // Writer: this machine's snapshot is rewritten (debounced) after any
  // change to tracks / playlists / tombstones / the hand-dragged library
  // order. Art bytes go over IPC only for files main doesn't already have
  // (knownArtRef is refreshed from disk by every merge and grows with each
  // write). Writes are serialized; a change landing mid-write marks it
  // dirty and the loop goes round again, so the last write always reflects
  // the latest state.
  const snapshotTimerRef = useRef(null);
  const snapshotBusyRef = useRef(false);
  const snapshotDirtyRef = useRef(false);

  const flushSnapshot = useCallback(async () => {
    if (snapshotBusyRef.current) return;
    snapshotBusyRef.current = true;
    try {
      while (snapshotDirtyRef.current) {
        snapshotDirtyRef.current = false;
        const machineId = libraryRootRef.current?.machineId;
        if (!machineId) return;
        const { doc, art } = await serializeLibrary({
          tracks: tracksRef.current,
          playlists: playlistsRef.current,
          tombstones: tombstonesRef.current,
          libraryOrder: libraryOrderRef.current,
          libraryOrderUpdatedAt: libraryOrderUpdatedAtRef.current,
          machineId
        });
        const known = knownArtRef.current || new Set();
        const newArt = [];
        for (const [name, blob] of art) {
          if (known.has(name)) continue;
          newArt.push({ name, bytes: new Uint8Array(await blob.arrayBuffer()) });
        }
        const res = await window.electronAPI.syncWriteSnapshot({ json: JSON.stringify(doc), art: newArt });
        for (const a of newArt) known.add(a.name);
        knownArtRef.current = known;
        setLastSnapshotAt(doc.writtenAt);
        console.log(
          `[sync] wrote ${res.file}: ${doc.tracks.length} tracks, ${doc.playlists.length} playlists, ${res.bytes} bytes, ${res.artWritten} new art file(s)`
        );
      }
    } catch (err) {
      console.error('[sync] snapshot write failed:', err);
    } finally {
      snapshotBusyRef.current = false;
    }
  }, []);

  useEffect(() => {
    if (libraryPhase !== 'ready' || !libraryReady || !window.electronAPI?.syncWriteSnapshot) return;
    clearTimeout(snapshotTimerRef.current);
    snapshotTimerRef.current = setTimeout(() => {
      snapshotDirtyRef.current = true;
      flushSnapshot();
    }, 500);
    return () => clearTimeout(snapshotTimerRef.current);
  }, [tracks, playlists, tombstones, libraryOrder, libraryOrderUpdatedAt, libraryPhase, libraryReady, flushSnapshot]);

  // sweep for active-version files that have gone missing from disk. Waits
  // for the root: main throws on every media IPC without one, and a legacy
  // record never gets this far (it isn't in `tracks`). assertRelPath is the
  // loud failure for anything that slipped past the load-time check.
  //
  // Absent files split two ways (stage 5): a path this machine has seen on
  // disk before is MISSING (moved or deleted — offer relocate); one it has
  // never seen is WAITING — a remote track whose audio hasn't come through
  // Dropbox yet. Re-runs when tracks change and whenever main's watcher
  // reports files landing under the root (fileSweepTick).
  useEffect(() => {
    if (!window.electronAPI?.mediaExists || !libraryReady) return;
    const paths = tracks.map((t) => assertRelPath(activeVersion(t)?.relPath, 'missing-file sweep'));
    if (!paths.length) return;
    let cancelled = false;
    window.electronAPI.mediaExists([...new Set(paths)]).then((res) => {
      if (cancelled) return;
      if (!seenPathsRef.current) {
        try {
          seenPathsRef.current = new Set(JSON.parse(localStorage.getItem('seenRelPaths') || '[]'));
        } catch {
          seenPathsRef.current = new Set();
        }
      }
      const seen = seenPathsRef.current;
      let seenChanged = false;
      const missing = new Set();
      const waiting = new Set();
      for (const [p, ok] of Object.entries(res)) {
        if (ok) {
          if (!seen.has(p)) {
            seen.add(p);
            seenChanged = true;
          }
        } else if (seen.has(p)) missing.add(p);
        else waiting.add(p);
      }
      if (seenChanged) {
        try {
          localStorage.setItem('seenRelPaths', JSON.stringify([...seen]));
        } catch {
          /* best effort */
        }
      }
      const same = (prev, next) => prev.size === next.size && [...next].every((p) => prev.has(p));
      setMissingPaths((prev) => (same(prev, missing) ? prev : missing));
      setWaitingPaths((prev) => (same(prev, waiting) ? prev : waiting));
      if (waiting.size) console.log(`[sync] ${waiting.size} track file(s) still on their way through Dropbox`);
    });
    return () => {
      cancelled = true;
    };
  }, [tracks, libraryReady, fileSweepTick]);

  useEffect(() => {
    localStorage.setItem('libraryViewMode', libraryViewMode);
  }, [libraryViewMode]);

  useEffect(() => {
    localStorage.setItem('librarySort', librarySort);
    localStorage.setItem('librarySortDir', librarySortDir);
  }, [librarySort, librarySortDir]);

  useEffect(() => {
    localStorage.setItem('likedSort', likedSort);
    localStorage.setItem('likedSortDir', likedSortDir);
  }, [likedSort, likedSortDir]);

  useEffect(() => {
    localStorage.setItem('artistSort', artistSort);
    localStorage.setItem('artistSortDir', artistSortDir);
  }, [artistSort, artistSortDir]);

  useEffect(() => {
    localStorage.setItem('libraryOrder', JSON.stringify(libraryOrder));
  }, [libraryOrder]);

  useEffect(() => {
    localStorage.setItem('libraryOrderUpdatedAt', String(libraryOrderUpdatedAt));
  }, [libraryOrderUpdatedAt]);

  useEffect(() => {
    localStorage.setItem('tagOrder', JSON.stringify(tagOrder));
  }, [tagOrder]);

  useEffect(() => {
    localStorage.setItem('syncTombstones', JSON.stringify(tombstones));
  }, [tombstones]);

  // keep the saved custom order in step with the real library (imports,
  // deletes) — cheap, returns the same array when nothing changed. Skips
  // while tracks haven't loaded, so a saved order isn't wiped on startup.
  useEffect(() => {
    if (!tracks.length) return;
    setLibraryOrder((prev) => reconcileLibraryOrder(prev, tracks));
  }, [tracks]);

  // same reconcile contract as libraryOrder above, for the global tag order
  useEffect(() => {
    if (!tracks.length) return;
    setTagOrder((prev) => reconcileTagOrder(prev, tracks));
  }, [tracks]);

  // drag-reorder a tag chip (any view) — moves it in the GLOBAL order, see
  // tagOrder.js for why that's correct even when dragging within a view's
  // filtered subset.
  const handleReorderTags = useCallback((draggedTag, targetTag, before) => {
    setTagOrder((prev) => reorderTags(prev, draggedTag, targetTag, before));
  }, []);

  // pick a sort; the menu always passes an explicit dir
  const handleSetLibrarySort = useCallback((sort, dir) => {
    setLibrarySort(sort);
    if (dir) setLibrarySortDir(dir);
  }, []);

  const handleSetLikedSort = useCallback((sort, dir) => {
    setLikedSort(sort);
    if (dir) setLikedSortDir(dir);
  }, []);

  const handleSetArtistSort = useCallback((sort, dir) => {
    setArtistSort(sort);
    if (dir) setArtistSortDir(dir);
  }, []);

  const handleReorderLibrary = useCallback((fromIndex, insertBeforeIndex) => {
    setLibraryOrderUpdatedAt((prev) => stampAfter({ updatedAt: prev }));
    setLibraryOrder((prev) => {
      const next = [...prev];
      const [moved] = next.splice(fromIndex, 1);
      const adj = insertBeforeIndex > fromIndex ? insertBeforeIndex - 1 : insertBeforeIndex;
      next.splice(adj, 0, moved);
      return next;
    });
  }, []);

  // Z is the ONLY thing that ever scrolls the library list — nothing here
  // auto-repositions on a track change or on playback starting. Target is
  // the playing track if one is loaded, else whatever's browsed. Always
  // centers it, synchronously (a direct DOM query/scrollIntoView, same
  // pattern as nudgeLibraryScroll — no React effect round-trip needed).
  // Expand/collapse only applies in list view, and only decides collapse
  // when the track is already fully visible — otherwise repeated Z presses
  // while scrolled away would alternate silently between "expand" (which
  // scrolled) and "collapse" (which used to not scroll at all).
  //
  // Also pulls the target back into being the DISPLAYED track (setCurrentTrackId)
  // — 2026-09-05: previously Z only scrolled/expanded without touching what's
  // browsed, so it could center the playing track while NowPlaying kept
  // showing something else you'd clicked over to. Now Z always ends with the
  // playing track (or, if nothing's playing, whatever's browsed) both
  // centered AND displayed.
  // How far a center-scroll must actually move the container before it's
  // worth doing — below this, on a short/mostly-visible list, `scrollIntoView`
  // still fires but produces a small, visually pointless jump instead of a
  // real re-center (2026-09-05: reported as "janky" on a ~10-track playlist
  // where most rows were already on screen). Roughly half a track row. This
  // is independent of the measurement-timing fix below — it's a threshold on
  // a (now-correct) distance, not itself a source of the bug, so it didn't
  // need retuning once the measurement was fixed.
  const SCROLL_JUMP_THRESHOLD = 24;

  // Root-caused 2026-09-05: on a Z press that also expands a row, the row
  // only grows taller once React commits `setExpandedTrackId` and the
  // browser reflows — which hasn't happened yet at the point a plain
  // synchronous function body calls setState and keeps going. Measuring
  // scrollHeight/offsetTop/getBoundingClientRect() right after calling
  // setExpandedTrackId (the old code, in the same tick) reads the PRE-
  // expansion layout every time, so the scroll target/distance was
  // routinely computed against stale geometry. Negligible on a long list
  // (one row's height is a rounding error against the total scrollable
  // range); on a ~15-track list one expanded row can be a large fraction of
  // it — hence "sometimes needs a second press" (the second press finally
  // measures the already-expanded, settled layout) and "bounces off the
  // bottom" (scrolling toward a target computed before the layout shift,
  // then the shift moves the actual target elsewhere).
  //
  // Fix: split into two steps across a real commit boundary, the same
  // technique as the WaveformSlot rework — expand-decision + state updates
  // happen synchronously here (unaffected by this bug: it only needs the
  // CURRENT, pre-press layout, to decide expand vs. collapse), then a
  // useLayoutEffect (below) does the measurement + scroll AFTER React has
  // committed those state updates and the browser has reflowed the taller
  // row — but BEFORE paint, so there's no visible two-step jump, only ever
  // one correct final frame.
  const pendingScrollTargetRef = useRef(null);
  const [scrollRequestTick, setScrollRequestTick] = useState(0);

  const handleExpandTrack = useCallback(() => {
    const targetId = playingTrackId || currentTrackId;
    if (!targetId) return;
    setCurrentTrackId(targetId);
    const container = document.querySelector('.track-list, .track-grid');
    const target = container?.querySelector(`[data-sel-id="${CSS.escape(targetId)}"]`);
    if (container && target) {
      // Pre-press measurement — correct to use here: this only decides
      // expand vs. collapse vs. stay-expanded-and-recenter, which is a
      // question about the CURRENT state before this press changes
      // anything, not about where things will end up afterward.
      const c = container.getBoundingClientRect();
      const t = target.getBoundingClientRect();
      const isVisible = t.top >= c.top && t.bottom <= c.bottom;
      setExpandedTrackId((id) => {
        if (libraryViewMode === 'grid') return id; // grid has no expand panel at all
        if (id !== targetId) return targetId; // not expanded (on this track) -> expand
        if (isVisible) return null; // expanded and already visible -> collapse
        return id; // expanded but off-screen -> stay expanded, just center below
      });
    }
    // Defer the actual scroll decision to after this render commits — see
    // the useLayoutEffect below. Bumping scrollRequestTick (rather than
    // relying on expandedTrackId changing) guarantees the effect runs even
    // when the expand/collapse decision above was a no-op value (e.g.
    // collapsing, where the state goes from some id back to null — a real
    // change — but also the "stay expanded" branch, which returns the SAME
    // id and would otherwise bail out of re-rendering entirely).
    pendingScrollTargetRef.current = targetId;
    setScrollRequestTick((n) => n + 1);
  }, [playingTrackId, currentTrackId, libraryViewMode]);

  useLayoutEffect(() => {
    const targetId = pendingScrollTargetRef.current;
    if (!targetId) return;
    pendingScrollTargetRef.current = null;
    const container = document.querySelector('.track-list, .track-grid');
    const target = container?.querySelector(`[data-sel-id="${CSS.escape(targetId)}"]`);
    if (!container || !target) return;
    const c = container.getBoundingClientRect();
    const t = target.getBoundingClientRect();
    const isVisible = t.top >= c.top && t.bottom <= c.bottom;
    if (isVisible) return; // already fully on screen — nothing to center
    // Real distance a centered scroll would travel, clamped to the
    // container's actual scrollable range (the same clamp the browser
    // itself applies) rather than the theoretical unclamped distance to
    // dead-center — see SCROLL_JUMP_THRESHOLD above.
    const targetCenter = t.top - c.top + t.height / 2;
    const desiredDelta = targetCenter - c.height / 2;
    const maxScrollTop = Math.max(0, container.scrollHeight - container.clientHeight);
    const newScrollTop = Math.min(maxScrollTop, Math.max(0, container.scrollTop + desiredDelta));
    const actualDelta = Math.abs(newScrollTop - container.scrollTop);
    if (actualDelta <= SCROLL_JUMP_THRESHOLD) return;
    target.scrollIntoView({ block: 'center' });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scrollRequestTick]);

  // Search-overlay "go to this track" (2026-09-06) — same landing state as
  // pressing z on it (browsed + expanded + centered), generalized to an
  // arbitrary id instead of always playingTrackId||currentTrackId, and
  // preceded by a view switch when needed. Reuses the exact same deferred
  // scroll mechanism as handleExpandTrack above (pendingScrollTargetRef +
  // scrollRequestTick) rather than duplicating it — the effect at line ~771
  // already handles "wait for the commit, then measure/scroll," which is
  // exactly as true here as it is for Z, including right after a view
  // switch remounts LibraryList with a different track list.
  //
  // Which view to land in: stay put if the CURRENT view already contains
  // the track (Imported always does, trivially, since "Imported" = the
  // whole library, not "not in a playlist" — see activeView docs; the
  // current playlist or Liked only "contain" it if the track is actually
  // in them) — this avoids an unnecessary context switch away from where
  // you're already looking when the track happens to be visible right
  // there. Otherwise Imported is the one landing spot guaranteed to work
  // for every track regardless of which playlists (if any) it's in, so
  // there's no need to guess/rank among multiple playlists that might
  // contain it.
  const landOnTrack = useCallback(
    (id) => {
      const track = tracks.find((t) => t.id === id);
      if (!track) return;
      setView('sidebar');
      const stayPut =
        activeView.type === 'imported' ||
        (activeView.type === 'liked' && !!track.liked) ||
        (activeView.type === 'artist' && primaryArtist(track.artist) === activeView.name) ||
        (activeView.type === 'playlist' &&
          playlists.find((p) => p.id === activeView.id)?.trackIds.includes(id));
      // (leaving the artist page this way, via a search result, is handled
      // generically by the artistPageReturn safety-net effect above — no
      // special-casing needed here)
      if (!stayPut) setActiveView({ type: 'imported' });
      setCurrentTrackId(id);
      if (libraryViewMode !== 'grid') setExpandedTrackId(id); // grid has no expand panel — see handleExpandTrack
      pendingScrollTargetRef.current = id;
      setScrollRequestTick((n) => n + 1);
    },
    [tracks, activeView, playlists, libraryViewMode]
  );

  // Search-overlay/track-row "go to this artist" (2026-09-06: now a real
  // page — see the `activeView.type === 'artist'` case threaded throughout
  // this file, the same way 'liked' was added as a third case). Captures
  // the return point the FIRST time (see artistPageReturn above), so
  // artist -> artist chaining doesn't lose track of where you actually
  // started.
  const openArtist = useCallback(
    (artistName) => {
      // normalize here, once, so every call site (track rows, grid tiles,
      // Now Playing, Focus view, search) can keep passing the raw
      // track.artist string — "Daft Punk feat. X" and "Daft Punk" land on
      // the SAME page. See src/lib/artistName.js.
      const name = primaryArtist(artistName);
      setArtistPageReturn((prev) => prev ?? { view, activeView });
      setView('sidebar');
      setActiveView({ type: 'artist', name });
    },
    [view, activeView]
  );

  // Leaving the artist page (Escape, or the header's back control) —
  // restores the view/activeView captured when the page was entered. See
  // "Which view to land in" in landOnTrack above for why there's no
  // equivalent scroll-position restore: even switching between two
  // ordinary playlists already resets scroll to the top by design (see
  // LibraryList's listKey effect) — there's no existing "remember where I
  // was" mechanism for THAT case either, so adding one just for this one
  // exit path would be new, inconsistent behavior, not a restoration of
  // something that already existed.
  const closeArtistPage = useCallback(() => {
    const back = artistPageReturn;
    setArtistPageReturn(null);
    if (back) {
      setView(back.view);
      setActiveView(back.activeView);
    } else {
      setActiveView({ type: 'imported' }); // safety net — shouldn't normally be reachable
    }
  }, [artistPageReturn]);

  // Safety net for artistPageReturn: the sidebar (PlaylistNav's Imported /
  // playlist / Liked Songs items) can navigate straight OFF the artist page
  // without ever calling closeArtistPage — that's fine, they're just normal
  // navigation, not "close the artist page" — but it would otherwise leave
  // artistPageReturn stale, and openArtist's `prev ?? {...}` (see above)
  // would then wrongly reuse that stale point on the NEXT artist page visit
  // instead of capturing where this new one actually started. Whenever
  // activeView isn't 'artist', there's no open artist page, so there's
  // nothing valid to return to.
  useEffect(() => {
    if (activeView.type !== 'artist') setArtistPageReturn(null);
  }, [activeView.type]);

  // Single dispatch point the search overlay calls on Enter/click — kept
  // here (not in the overlay) so it stays a dumb search+list component,
  // consistent with the rest of the app's props-in/callbacks-out shape.
  const handleSelectSearchResult = useCallback(
    (result) => {
      if (result.type === 'track') landOnTrack(result.id);
      else if (result.type === 'playlist') {
        setView('sidebar');
        setActiveView({ type: 'playlist', id: result.id });
      } else if (result.type === 'artist') openArtist(result.name);
      // Imported/Liked Songs (2026-09-06) — searchable alongside playlists,
      // same "navigate to a view" shape, just the two built-in ones instead
      // of a playlist record.
      else if (result.type === 'imported') {
        setView('sidebar');
        setActiveView({ type: 'imported' });
      } else if (result.type === 'liked') {
        setView('sidebar');
        setActiveView({ type: 'liked' });
      }
    },
    [landOnTrack, openArtist]
  );

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
    localStorage.setItem('backgroundMovement', String(backgroundMovement));
  }, [backgroundMovement]);

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

  // Settings > Library > "Reset library…" — wipe the database and every
  // localStorage key that references track ids, then reload the renderer so
  // all derived state (playing/current/expanded ids, history, shuffle order,
  // the liked-view snapshot…) starts from nothing, instead of trying to
  // unwind each piece by hand. Per-machine preferences (theme, keybindings,
  // layout, volume, sort prefs) are deliberately kept. Audio files on disk
  // are NOT deleted — this is the "start fresh" path for the library-sync
  // rework, and the old files are simply orphaned.
  const handleResetLibrary = useCallback(async () => {
    const ok = window.confirm(
      'Reset the library?\n\nEvery track, playlist, version, note and tag will be forgotten. Audio files on disk are left in place. Keybindings and appearance settings are kept.'
    );
    if (!ok) return;
    waveformRef.current?.pause();
    // stop the snapshot writer first so a debounced write can't land
    // between the wipe and the reload and re-snapshot the old library
    clearTimeout(snapshotTimerRef.current);
    snapshotDirtyRef.current = false;
    try {
      await resetLibraryDatabase();
      // this machine's own snapshot goes too — otherwise the reload would
      // immediately bootstrap the wiped library right back from it. Other
      // machines' snapshots stay and DO bootstrap this one (that's the
      // "set up the second Mac" path).
      await window.electronAPI?.syncDeleteOwnSnapshot?.();
    } catch (err) {
      console.error('[reset] database reset failed:', err);
      window.alert('Reset failed — nothing was changed. See the console for details.');
      return;
    }
    for (const key of ['libraryOrder', 'libraryOrderUpdatedAt', 'tagOrder', 'syncTombstones', 'playHistory', 'seenRelPaths']) {
      try {
        localStorage.removeItem(key);
      } catch {
        /* localStorage unavailable */
      }
    }
    window.location.reload();
  }, []);

  // native menu "Settings…" / Cmd+, (electron/main.js) opens the same modal
  // everywhere. Mini mode is a real, physically tiny OS window (see the
  // enterMiniMode/exitMiniMode effect below) that the normal-sized settings
  // modal can't usefully render inside — so opening from mini first returns
  // to the normal view. Opening from 'sidebar' or 'focus' deliberately does
  // NOT touch `view` — both are already full-size windows, Settings just
  // overlays on top, and closing leaves you exactly where you were. That's
  // already correct for focus today, so mini reuses the same "don't touch
  // view unless you have to" principle rather than adding a second,
  // parallel mechanism.
  //
  // History, so nobody re-derives it: this path used to pause playback.
  // Not because of Settings — diagnostics showed the shared <audio> node had
  // already been detached and re-attached, and had fired its own native
  // 'pause', before SettingsModal ever mounted. The cause was the view
  // switch itself: MiniPlayer/NowPlaying/FocusView each mounted their own
  // <WaveformSlot> behind a ternary, so mini -> sidebar removed the host
  // node from the document for ~14ms, and browsers pause a media element
  // that leaves the document. Fixed at the root by keeping all three views
  // mounted (see the render below and CLAUDE.md "Single shared WaveSurfer
  // instance", tag `waveformslot-fixed`) — this handler needs no special
  // sequencing; a plain setView + setSettingsOpen in one update is correct.
  const handleOpenSettings = useCallback(() => {
    if (viewRef.current === 'mini') {
      setReturnToMiniAfterSettings(true);
      setView('sidebar');
    }
    setSettingsOpen(true);
  }, []);
  const handleCloseSettings = useCallback(() => {
    setSettingsOpen(false);
    if (returnToMiniAfterSettings) {
      setView('mini');
      setReturnToMiniAfterSettings(false);
    }
  }, [returnToMiniAfterSettings]);
  useEffect(() => window.electronAPI?.onOpenSettings?.(handleOpenSettings), [handleOpenSettings]);

  // Cmd+W / the native close button (electron/main.js): report whenever any
  // of these three modals is open so main can gate the window's real close
  // event on it, and close whichever one is open when asked to instead of
  // letting the window close. One coordination point here rather than
  // touching PlaylistEditModal/VersionsModal/CoverEditModal/EditArtistModal
  // individually — they already each expose a plain onClose prop wired to
  // these setters.
  const anyModalOpen = !!(editingPlaylistId || versionsModalTrackId || coverEditTrackIds || editArtistTrackIds);
  const modalStateRef = useRef({ editingPlaylistId, versionsModalTrackId, coverEditTrackIds, editArtistTrackIds });
  modalStateRef.current = { editingPlaylistId, versionsModalTrackId, coverEditTrackIds, editArtistTrackIds };
  useEffect(() => {
    window.electronAPI?.setModalOpen?.(anyModalOpen);
  }, [anyModalOpen]);
  useEffect(
    () =>
      window.electronAPI?.onCloseActiveModal?.(() => {
        const m = modalStateRef.current;
        if (m.coverEditTrackIds) setCoverEditTrackIds(null);
        else if (m.editArtistTrackIds) setEditArtistTrackIds(null);
        else if (m.versionsModalTrackId) setVersionsModalTrackId(null);
        else if (m.editingPlaylistId) setEditingPlaylistId(null);
      }),
    []
  );

  const currentTrack = tracks.find((t) => t.id === currentTrackId) || null;
  const playingTrack = tracks.find((t) => t.id === playingTrackId) || null;
  // the audio engine always follows the PLAYING track's ACTIVE version.
  // Changing the active version changes this URL, which recreates the
  // WaveSurfer instance -> playback restarts from 0 (intended: different
  // mixes don't line up).
  // mediaUrl throws on a version without a valid relPath — deliberately, see
  // media.js. Nothing is handed to the audio engine until the root exists.
  const playingVersion = activeVersion(playingTrack);
  const audioUrl = libraryReady && playingVersion ? mediaUrl(playingVersion.relPath) : null;
  const currentMissing =
    !!currentTrack && missingPaths.has(activeVersion(currentTrack)?.relPath);
  const currentWaiting =
    !!currentTrack && waitingPaths.has(activeVersion(currentTrack)?.relPath);
  // colors sampled from the PLAYING track's cover, fed to the waveform + EQ
  // visualizer (null when the track has no artwork -> default heatmap colors)
  const playingPalette = useArtworkPalette(playingTrack?.artworkBlob);
  const isViewingPlayingTrack = currentTrackId === playingTrackId;
  // is what's playing the active left-nav view's context? drives the library
  // header's play button showing pause instead of play
  const headerViewPlaying =
    isPlaying &&
    (activeView.type === 'playlist'
      ? playbackContext.type === 'playlist' && playbackContext.id === activeView.id
      : activeView.type === 'liked'
        ? playbackContext.type === 'liked'
        : activeView.type === 'artist'
          ? playbackContext.type === 'artist' && playbackContext.name === activeView.name
          : playbackContext.type === 'library');
  // in focus / mini the waveform sits on the cover-derived (dark) mesh
  // backdrop whenever there's cover art — so its played-region wash should
  // use the light value in both themes, not the library view's dark wash
  const waveOnDarkBackdrop = (view === 'focus' || view === 'mini') && !!playingPalette;

  // the ordered track list the middle column shows for the active left-nav
  // item: a playlist's manual order, or the whole library newest-first.
  // Memoised so a playback-time re-render (currentTime ticks) doesn't hand
  // LibraryList a brand-new array and force every row to re-render — that
  // regressed the "clicks feel laggy / inconsistent" complaint.
  const activePlaylist =
    activeView.type === 'playlist' ? playlists.find((p) => p.id === activeView.id) || null : null;
  const isLikedView = activeView.type === 'liked';
  const isArtistView = activeView.type === 'artist';
  const activeArtistName = isArtistView ? activeView.name : null;

  // one sort surface for the middle column, resolved from whichever view is
  // active. Library sort is app-level; playlist sort rides on the record;
  // Liked has its own (separate default/options, see likedSort above); the
  // artist page has its own too (see artistSort above), for the same reason.
  // (the setter, handleSetActiveSort, is defined lower — it needs
  // handleSetPlaylistSort, which needs persistPlaylist.)
  const activeSort = activePlaylist
    ? activePlaylist.sort || 'custom'
    : isLikedView
      ? likedSort
      : isArtistView
        ? artistSort
        : librarySort;
  const activeSortDir = activePlaylist
    ? activePlaylist.sortDir || 'desc'
    : isLikedView
      ? likedSortDir
      : isArtistView
        ? artistSortDir
        : librarySortDir;

  const shownTracks = useMemo(() => {
    if (activePlaylist) {
      const byId = new Map(tracks.map((t) => [t.id, t]));
      const plTracks = activePlaylist.trackIds.map((id) => byId.get(id)).filter(Boolean);
      const sort = activePlaylist.sort || 'custom';
      if (sort === 'custom') return plTracks;
      return sortLibrary(plTracks, sort, activePlaylist.sortDir || 'desc', activePlaylist.trackIds);
    }
    if (isLikedView) {
      // likedViewIds is a frozen snapshot (see its declaration above) —
      // membership doesn't change here just because a track's liked flag
      // flipped; track data itself (title, the flag for the heart icon,
      // etc.) still comes from the live `tracks` array via this lookup.
      const byId = new Map(tracks.map((t) => [t.id, t]));
      const likedTracks = likedViewIds.map((id) => byId.get(id)).filter(Boolean);
      return sortLibrary(likedTracks, likedSort, likedSortDir, []);
    }
    if (isArtistView) {
      // live filter, not a snapshot — see artistSort's declaration above for
      // why that's the right call here (unlike Liked's likedViewIds)
      return sortLibrary(tracks.filter((t) => primaryArtist(t.artist) === activeArtistName), artistSort, artistSortDir, []);
    }
    return sortLibrary(tracks, librarySort, librarySortDir, libraryOrder);
  }, [
    tracks,
    activePlaylist,
    isLikedView,
    likedViewIds,
    likedSort,
    likedSortDir,
    isArtistView,
    activeArtistName,
    artistSort,
    artistSortDir,
    librarySort,
    librarySortDir,
    libraryOrder
  ]);
  // the middle column's displayed order (pre search/tag filter) — the header
  // play button starts here so "play" matches what the user sees
  const shownTracksRef = useRef(shownTracks);
  shownTracksRef.current = shownTracks;

  // (Re-)snapshots which tracks the Liked view shows, on entering it and on
  // an actual sort change — NOT on every `tracks` change, which is the whole
  // point (see likedViewIds above). activeView.type is enough to detect
  // "entered/left," since leaving always changes it to something else first,
  // so coming back re-triggers this even though the string value repeats.
  useEffect(() => {
    if (activeView.type === 'liked') {
      setLikedViewIds(tracksRef.current.filter((t) => t.liked).map((t) => t.id));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeView.type, likedSort, likedSortDir]);

  const dismissImportToast = useCallback(() => setImportToast(null), []);

  // `files` is {name, path} descriptors from the native dialog. Each file is
  // read once (for tags + fingerprint), copied into ~/Music/Sona Library,
  // and stored as a track with one implicit version. Files whose fingerprint
  // already exists in the library are skipped (re-importing a folder).
  const handleFilesSelected = useCallback(async (files) => {
    if (!window.electronAPI?.readAudioFile) {
      setImportToast({ id: Date.now(), error: true });
      return;
    }
    setImportProgress({ done: 0, total: files.length });
    let done = 0;
    let failed = 0;
    let skipped = 0;
    const existing = new Set(allVersions(tracksRef.current).map((x) => x.version.fingerprint));
    const added = [];
    try {
      for (const item of files) {
        try {
          const bytes = await window.electronAPI.readAudioFile(item.path);
          const fp = await fingerprint(bytes);
          if (existing.has(fp)) {
            skipped += 1;
            continue;
          }
          existing.add(fp);
          const meta = await readAudioMeta(bytes, item.name);
          const fileTitle = importTitle(meta, item.name);
          const { relPath } = await window.electronAPI.mediaCopyIn({
            srcPath: item.path,
            artist: meta.artist || 'unknown artist',
            title: fileTitle,
            // on-disk filename base = the version title, so the library
            // folder is self-documenting
            label: fileTitle,
            ext: sniffExt(bytes) || extFromName(item.name)
          });
          const track = buildImportedTrack({ name: item.name, meta, relPath, fp });
          await addTrack(track);
          added.push(track);
        } catch (err) {
          console.error('[import] failed on', item.name ?? item, err);
          failed += 1;
        } finally {
          done += 1;
          setImportProgress({ done, total: files.length });
        }
      }
      if (added.length) setTracks((prev) => [...prev, ...added]);
      if (!currentTrackId && added.length) {
        setCurrentTrackId(added[0].id);
        setPlayingTrackId(added[0].id);
      }
      setImportToast({ id: Date.now(), count: added.length, failed, skipped });
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
    // capture the sort in effect now, so changing it mid-playback doesn't
    // reorder what "next" plays
    if (av.type === 'playlist') {
      const pl = playlistsRef.current.find((p) => p.id === av.id);
      return { type: 'playlist', id: av.id, sort: pl?.sort || 'custom', dir: pl?.sortDir || 'desc' };
    }
    if (av.type === 'liked') {
      return { type: 'liked', sort: likedSortRef.current, dir: likedSortDirRef.current };
    }
    if (av.type === 'artist') {
      return { type: 'artist', name: av.name, sort: artistSortRef.current, dir: artistSortDirRef.current };
    }
    return { type: 'library', sort: librarySortRef.current, dir: librarySortDirRef.current };
  }, []);

  const handlePlayTrack = useCallback((id) => {
    setPlaybackContext(contextFromActiveView());
    handleAdoptAndPlay(id, { autoPlay: true });
  }, [handleAdoptAndPlay, contextFromActiveView]);

  // pick the track a "play this whole thing" action should start on, honoring
  // shuffle mode. `orderedIds` is the order to start from (a view's displayed
  // order); callers without a view — the left nav — pass nothing and get the
  // playlist's canonical order.
  const startTrackFor = useCallback((orderedIds) => {
    const resolvable = orderedIds.filter((tid) => tracksRef.current.some((t) => t.id === tid));
    if (!resolvable.length) return null;
    return shuffleEnabledRef.current
      ? resolvable[Math.floor(Math.random() * resolvable.length)]
      : resolvable[0];
  }, []);

  const handlePlayPlaylist = useCallback(
    (id, orderedIds) => {
      const pl = playlistsRef.current.find((p) => p.id === id);
      if (!pl) return;
      const startId = startTrackFor(orderedIds && orderedIds.length ? orderedIds : pl.trackIds);
      if (!startId) return;
      setPlaybackContext({ type: 'playlist', id });
      handleAdoptAndPlay(startId, { autoPlay: true });
    },
    [startTrackFor, handleAdoptAndPlay]
  );

  // "play the whole library" — Imported view has no playlist id, so start from
  // the full library in its current displayed sort order
  const handlePlayLibrary = useCallback(() => {
    const ordered = sortLibrary(
      tracksRef.current,
      librarySortRef.current,
      librarySortDirRef.current,
      libraryOrderRef.current
    );
    const startId = startTrackFor(ordered.map((t) => t.id));
    if (!startId) return;
    setPlaybackContext({
      type: 'library',
      sort: librarySortRef.current,
      dir: librarySortDirRef.current
    });
    handleAdoptAndPlay(startId, { autoPlay: true });
  }, [startTrackFor, handleAdoptAndPlay]);

  // "play Liked" — same shape as handlePlayLibrary, but over every liked
  // track rather than the whole library. `orderedIds`, when given, is the
  // Liked view's current displayed (frozen-snapshot) order, same as how the
  // header play button passes shownTracksRef through for a playlist/library.
  const handlePlayLiked = useCallback(
    (orderedIds) => {
      const ids =
        orderedIds && orderedIds.length
          ? orderedIds
          : tracksRef.current.filter((t) => t.liked).map((t) => t.id);
      const startId = startTrackFor(ids);
      if (!startId) return;
      setPlaybackContext({ type: 'liked', sort: likedSortRef.current, dir: likedSortDirRef.current });
      handleAdoptAndPlay(startId, { autoPlay: true });
    },
    [startTrackFor, handleAdoptAndPlay]
  );

  // "play this artist" — same shape as handlePlayLiked. `orderedIds`, when
  // given, is the artist page's current displayed order (same convention as
  // the header play button elsewhere).
  const handlePlayArtist = useCallback(
    (name, orderedIds) => {
      const ids =
        orderedIds && orderedIds.length
          ? orderedIds
          : tracksRef.current.filter((t) => primaryArtist(t.artist) === name).map((t) => t.id);
      const startId = startTrackFor(ids);
      if (!startId) return;
      setPlaybackContext({ type: 'artist', name, sort: artistSortRef.current, dir: artistSortDirRef.current });
      handleAdoptAndPlay(startId, { autoPlay: true });
    },
    [startTrackFor, handleAdoptAndPlay]
  );

  // the library header's play/pause button. If this view's context is already
  // what's playing (or paused mid-track), toggle the engine — resume must not
  // restart or re-roll the shuffle pick. Otherwise start the view fresh.
  const handleHeaderPlayPause = useCallback(() => {
    const av = activeViewRef.current;
    const ctx = playbackContextRef.current;
    const sameCtx =
      av.type === 'playlist'
        ? ctx.type === 'playlist' && ctx.id === av.id
        : av.type === 'liked'
          ? ctx.type === 'liked'
          : av.type === 'artist'
            ? ctx.type === 'artist' && ctx.name === av.name
            : ctx.type === 'library';
    const started = isPlayingRef.current || currentTimeRef.current > 0;
    if (sameCtx && started) {
      waveformRef.current?.toggle();
      return;
    }
    if (av.type === 'playlist') {
      handlePlayPlaylist(
        av.id,
        shownTracksRef.current.map((t) => t.id)
      );
    } else if (av.type === 'liked') {
      handlePlayLiked(shownTracksRef.current.map((t) => t.id));
    } else if (av.type === 'artist') {
      handlePlayArtist(
        av.name,
        shownTracksRef.current.map((t) => t.id)
      );
    } else {
      handlePlayLibrary();
    }
  }, [handlePlayPlaylist, handlePlayLiked, handlePlayArtist, handlePlayLibrary]);

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

  // restart the *playing* track from 0:00 without changing play/pause state
  // (wavesurfer.seekTo keeps playing if playing, stays paused if paused).
  // setCurrentTime(0) gives the time row an immediate reset — a programmatic
  // seek doesn't emit an 'interaction' event, so a paused seek wouldn't
  // otherwise update the UI until playback resumed.
  const handleRestartTrack = useCallback(() => {
    if (!playingTrackId) return;
    waveformRef.current?.seekTo(0);
    setCurrentTime(0);
  }, [playingTrackId]);

  // merge `changes` into a track, in state and IndexedDB, stamped for the
  // sync merge (syncMerge.js): `updatedAt` = stampAfter(previous), so the
  // edit beats the value it was based on even under clock skew. Notes are
  // the exception — a notes-only change bumps `notesUpdatedAt` (which
  // side's note ORDER wins) and leaves `updatedAt` alone, so it can never
  // out-stamp a like/rename/tag made on the other machine; notes merge by
  // id with their own stamps, which the note handlers below set.
  const patchTrack = useCallback((id, changes) => {
    const prev = tracksRef.current.find((t) => t.id === id);
    const keys = Object.keys(changes);
    const notesOnly = keys.length > 0 && keys.every((k) => k === 'notes' || k === 'deletedNotes');
    const stamped = notesOnly
      ? { ...changes, notesUpdatedAt: stampAfter({ updatedAt: prev?.notesUpdatedAt }) }
      : { ...changes, updatedAt: stampAfter(prev) };
    setTracks((list) => list.map((t) => (t.id === id ? { ...t, ...stamped } : t)));
    updateTrack(id, stamped);
  }, []);

  // liked/favorites. likedAt is only ever set (on like) — left as-is on
  // unlike (schemaless field, no migration; absent/undefined reads as not
  // liked everywhere it's checked).
  const handleSetLiked = useCallback(
    (id, liked) => {
      patchTrack(id, liked ? { liked: true, likedAt: Date.now() } : { liked: false });
    },
    [patchTrack]
  );

  // tags go through patchTrack like every other track edit, so they're
  // stamped for sync (they used to call updateTrack directly)
  const handleAddTag = useCallback(
    (id, tag) => {
      const t = tracksRef.current.find((x) => x.id === id);
      if (t && !t.tags.includes(tag)) patchTrack(id, { tags: [...t.tags, tag] });
    },
    [patchTrack]
  );

  const handleRemoveTag = useCallback(
    (id, tag) => {
      const t = tracksRef.current.find((x) => x.id === id);
      if (t && t.tags.includes(tag)) patchTrack(id, { tags: t.tags.filter((tg) => tg !== tag) });
    },
    [patchTrack]
  );

  // removes a tag from every track that has it, deleting the whole group at once
  const handleDeleteTagGroup = useCallback(
    (tag) => {
      for (const t of tracksRef.current) {
        if (t.tags.includes(tag)) patchTrack(t.id, { tags: t.tags.filter((tg) => tg !== tag) });
      }
    },
    [patchTrack]
  );

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
    // sync stamp: always beats the record this edit was based on (syncMerge.js)
    const withStamp = { ...pl, updatedAt: stampAfter(playlistsRef.current.find((p) => p.id === pl.id)) };
    setPlaylists((prev) => {
      const i = prev.findIndex((p) => p.id === pl.id);
      return i === -1 ? [...prev, withStamp] : prev.map((p) => (p.id === pl.id ? withStamp : p));
    });
    putPlaylist(withStamp);
    return withStamp;
  }, []);

  // per-playlist sort lives on the playlist record ('custom' = the manual
  // trackIds order; 'artist'/'added' are non-destructive view re-sorts).
  const handleSetPlaylistSort = useCallback(
    (playlistId, sort, dir) => {
      const pl = playlistsRef.current.find((p) => p.id === playlistId);
      if (!pl) return;
      persistPlaylist({ ...pl, sort, sortDir: dir || pl.sortDir || 'desc' });
    },
    [persistPlaylist]
  );

  // the middle column's sort setter, routed to the active view
  const handleSetActiveSort = useCallback(
    (sort, dir) => {
      const av = activeViewRef.current;
      if (av.type === 'playlist') handleSetPlaylistSort(av.id, sort, dir);
      else if (av.type === 'liked') handleSetLikedSort(sort, dir);
      else if (av.type === 'artist') handleSetArtistSort(sort, dir);
      else handleSetLibrarySort(sort, dir);
    },
    [handleSetPlaylistSort, handleSetLikedSort, handleSetArtistSort, handleSetLibrarySort]
  );

  const handleCreatePlaylist = useCallback(
    (name, trackIds = []) => {
      const now = Date.now();
      const pl = {
        id: crypto.randomUUID(),
        name,
        trackIds: [...new Set(trackIds)],
        pinned: false,
        sortIndex: now, // sorts to the end of the unpinned list
        createdAt: now,
        updatedAt: now
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

  // full edit (name + optional description + optional cover image)
  const handleUpdatePlaylist = useCallback(
    (id, { name, description, imageBlob }) => {
      const pl = playlistsRef.current.find((p) => p.id === id);
      if (pl) persistPlaylist({ ...pl, name, description, imageBlob });
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
    const pl = playlistsRef.current.find((p) => p.id === id);
    setPlaylists((prev) => prev.filter((p) => p.id !== id));
    deletePlaylistRecord(id);
    setTombstones((prev) => mergeTombstones(prev, [{ id, kind: 'playlist', updatedAt: stampAfter(pl) }]));
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

  // drag a playlist up/down in the nav. Reordering stays within the dragged
  // playlist's group (pinned vs unpinned); the group is renumbered by 1000s.
  const handleReorderPlaylists = useCallback((draggedId, targetId, before) => {
    setPlaylists((prev) => {
      const dragged = prev.find((p) => p.id === draggedId);
      const target = prev.find((p) => p.id === targetId);
      if (!dragged || !target || !!dragged.pinned !== !!target.pinned) return prev;
      const group = prev
        .filter((p) => !!p.pinned === !!dragged.pinned)
        .sort((a, b) => (a.sortIndex ?? a.createdAt) - (b.sortIndex ?? b.createdAt));
      const rest = group.filter((p) => p.id !== draggedId);
      let at = rest.findIndex((p) => p.id === targetId);
      if (at === -1) return prev;
      if (!before) at += 1;
      const ordered = [...rest.slice(0, at), dragged, ...rest.slice(at)];
      const nextSi = new Map(ordered.map((p, i) => [p.id, i * 1000]));
      let touched = false;
      const next = prev.map((p) => {
        if (!nextSi.has(p.id) || p.sortIndex === nextSi.get(p.id)) return p;
        touched = true;
        const updated = { ...p, sortIndex: nextSi.get(p.id), updatedAt: stampAfter(p) };
        putPlaylist(updated);
        return updated;
      });
      return touched ? next : prev;
    });
  }, []);

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
        if (list.length) {
          const sort = ctx.sort || pl.sort || 'custom';
          return sort === 'custom'
            ? list
            : sortLibrary(list, sort, ctx.dir || pl.sortDir || 'desc', pl.trackIds);
        }
      }
    }
    if (ctx.type === 'liked') {
      // the LIVE liked set, not the Liked view's frozen display snapshot —
      // that snapshot is a UI-only concern (rows not vanishing mid-look), it
      // has no bearing on what skip/auto-advance should traverse
      return sortLibrary(
        tracks.filter((t) => t.liked),
        ctx.sort || 'likedAt',
        ctx.dir || 'desc',
        []
      );
    }
    if (ctx.type === 'artist') {
      return sortLibrary(
        tracks.filter((t) => primaryArtist(t.artist) === ctx.name),
        ctx.sort || 'added',
        ctx.dir || 'desc',
        []
      );
    }
    return sortLibrary(
      tracks,
      ctx.sort || 'added',
      ctx.dir || 'desc',
      libraryOrderRef.current
    );
  }, [tracks]);

  // ---- shuffle: a real shuffled order, not a random pick per skip ----
  // `shuffleOrder` is the current context's track ids in shuffled play
  // order — built once (Fisher-Yates) and then walked forward/backward like
  // any other ordered list, so every track plays once before any repeats.
  // Lives here (not on playbackContext itself) because it needs its own
  // effect-driven lifecycle: rebuilt when shuffle turns on or the context
  // changes, reconciled (not rebuilt) when the context's own track list
  // changes, cleared when shuffle turns off. "Previous" needs none of this —
  // it already walks the real play-history list (see handleSkip below),
  // which is the actual path played regardless of shuffle.
  const [shuffleOrder, setShuffleOrder] = useState([]);
  const shuffleOrderRef = useRef(shuffleOrder);
  const setShuffleOrderBoth = useCallback((order) => {
    shuffleOrderRef.current = order;
    setShuffleOrder(order);
  }, []);

  // `anchorId`, if present and still in this context, is pinned at position
  // 0 and everything else is shuffled around it — used when shuffle turns on
  // (or the context changes) while something is already playing, so that
  // track keeps playing instead of the user being jumped elsewhere.
  const buildShuffleOrder = useCallback(
    (anchorId) => {
      const ids = orderedContextTracks().map((t) => t.id);
      if (anchorId && ids.includes(anchorId)) {
        return [anchorId, ...fisherYates(ids.filter((id) => id !== anchorId))];
      }
      return fisherYates(ids);
    },
    [orderedContextTracks]
  );

  // Rebuild (anchored on whatever's currently playing) whenever shuffle
  // turns on, or the context changes while it's already on — this is what
  // makes "turn shuffle on mid-playback" keep the current track playing
  // (decision: shuffle everything else around it) and "switch to a
  // different playlist while shuffling" start a fresh order for the new one
  // (the old one is discarded, not merged). Always rebuilds unconditionally
  // rather than trying to detect "is the existing order already correct" —
  // the one case that could look redundant (handlePlayPlaylist/
  // handlePlayLibrary already picked a random start id, then this rebuild
  // runs right after and reshuffles the rest around it) is cheap and
  // harmless, and skipping it would need a correctness check on the OLD
  // order's contents that isn't worth the complexity.
  useEffect(() => {
    if (!shuffleEnabled) {
      setShuffleOrderBoth([]);
      return;
    }
    setShuffleOrderBoth(buildShuffleOrder(playingTrackIdRef.current));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shuffleEnabled, playbackContext]);

  // Tracks added to (or removed from) the current context mid-shuffle: keep
  // the existing order's relative order for survivors and append newcomers
  // at the end — never reshuffle from scratch just because the list
  // changed. (Removal isn't explicitly asked for, but a stale id left in
  // the order after a track is deleted would dead-end a lookup later, so
  // it's pruned here too.)
  useEffect(() => {
    if (!shuffleEnabled) return;
    const currentIds = orderedContextTracks().map((t) => t.id);
    const currentSet = new Set(currentIds);
    setShuffleOrder((prev) => {
      const kept = prev.filter((id) => currentSet.has(id));
      const keptSet = new Set(kept);
      const appended = currentIds.filter((id) => !keptSet.has(id));
      if (kept.length === prev.length && appended.length === 0) return prev;
      const next = [...kept, ...appended];
      shuffleOrderRef.current = next;
      return next;
    });
  }, [tracks, shuffleEnabled, orderedContextTracks]);

  // Advances one step along the persisted shuffle order from `referenceId`.
  // Builds the order lazily if it's somehow empty when this is called.
  // Reaching (or past) the last element starts a fresh shuffled pass — a
  // NEW shuffle, not the same order repeating — and reports `wrapped: true`
  // only when `referenceId` was genuinely the last element of a real,
  // known order (as opposed to not being found in it at all, e.g. the
  // track that just played came from the queue and isn't part of this
  // context) — see handleFinish below for why that distinction matters for
  // the repeat-off-stops-at-the-end check.
  const advanceShuffle = useCallback(
    (referenceId) => {
      let order = shuffleOrderRef.current;
      if (!order.length) {
        order = buildShuffleOrder(referenceId);
        setShuffleOrderBoth(order);
      }
      const idx = order.indexOf(referenceId);
      if (idx !== -1 && idx < order.length - 1) {
        return { trackId: order[idx + 1], wrapped: false };
      }
      const atGenuineEnd = idx === order.length - 1;
      const fresh = buildShuffleOrder(null);
      setShuffleOrderBoth(fresh);
      return { trackId: fresh[0], wrapped: atGenuineEnd };
    },
    [buildShuffleOrder, setShuffleOrderBoth]
  );

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
      // manual "next" always wraps into a fresh shuffled pass at the end,
      // same as sequential mode's manual skip wraps regardless of repeat
      // mode — only handleFinish's natural end-of-track respects repeat-off
      const { trackId } = advanceShuffle(referenceId);
      handleAdoptAndPlay(trackId, { autoPlay: isPlaying });
      return;
    }
    const idx = sorted.findIndex((t) => t.id === referenceId);
    const nextIdx = (idx + direction + sorted.length) % sorted.length;
    handleAdoptAndPlay(sorted[nextIdx].id, { autoPlay: isPlaying });
  }, [tracks, playingTrackId, currentTrackId, handleAdoptAndPlay, isPlaying, queue, shuffleEnabled, goToHistory, stepHistory, commitHistory, orderedContextTracks, advanceShuffle]);

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
    // a track ending mid-hold must not carry a 2x rate into whatever plays
    // next (repeat-one restarts the SAME track, so this has to run before
    // that branch too, not just the auto-advance ones below)
    resetSpaceHold();
    // repeat-one: loop the current track, bypassing queue / context entirely
    if (repeatMode === 'one' && playingTrackId) {
      waveformRef.current?.seekTo(0);
      setCurrentTime(0);
      waveformRef.current?.play();
      return;
    }
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
      // unlike a manual skip, a track finishing naturally at the end of a
      // full shuffled pass respects repeat mode — stop with repeat off,
      // same as sequential mode below, instead of shuffling forever
      const { trackId, wrapped } = advanceShuffle(referenceId);
      if (wrapped && repeatMode !== 'all') {
        waveformRef.current?.pause();
        waveformRef.current?.seekTo(0);
        setCurrentTime(0);
        setIsPlaying(false);
        return;
      }
      handleAdoptAndPlay(trackId, { autoPlay: true });
      return;
    }
    const idx = sorted.findIndex((t) => t.id === referenceId);
    // Sequential playback only — the shuffle branch above already returned.
    // End of the context with repeat off -> stop, don't wrap.
    if (idx === sorted.length - 1 && repeatMode !== 'all') {
      waveformRef.current?.pause();
      waveformRef.current?.seekTo(0);
      setCurrentTime(0);
      setIsPlaying(false);
      return;
    }
    const nextIdx = (idx + 1) % sorted.length;
    handleAdoptAndPlay(sorted[nextIdx].id, { autoPlay: true });
  }, [tracks, playingTrackId, currentTrackId, handleAdoptAndPlay, queue, shuffleEnabled, repeatMode, goToHistory, stepHistory, orderedContextTracks, advanceShuffle, resetSpaceHold]);

  // OS-level media keys — literal F7/F8/F9 and the Media* keys, registered
  // always for the app's whole lifetime (electron/main.js, via
  // globalShortcut) — forwarded over IPC and routed into the exact same
  // handlers the in-app transport buttons and playPause/next/prev
  // keybindings use, not a parallel playback path. Declared after
  // handleTogglePlay/handleSkip since it closes over both.
  useEffect(
    () =>
      window.electronAPI?.onMediaKey?.((action) => {
        if (action === 'playpause') handleTogglePlay();
        else if (action === 'previous') handleSkip(-1);
        else if (action === 'next') handleSkip(1);
      }),
    [handleTogglePlay, handleSkip]
  );

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

  // ---- versions & notes -------------------------------------------------

  const restartIfPlaying = useCallback(
    (trackId) => {
      if (trackId === playingTrackId) {
        shouldAutoPlayRef.current = isPlaying;
        setCurrentTime(0);
        // audioUrl changes off activeVersionId -> Waveform recreates & (if
        // shouldAutoPlay) plays from 0 on ready
      }
    },
    [playingTrackId, isPlaying]
  );

  // the track-level title is always a mirror of the active version's title —
  // that's what makes the library show whatever version is playing.
  const handleSetActiveVersion = useCallback(
    (trackId, versionId) => {
      const t = tracksRef.current.find((x) => x.id === trackId);
      const v = t?.versions.find((x) => x.id === versionId);
      if (!t || !v || t.activeVersionId === versionId) return;
      patchTrack(trackId, {
        activeVersionId: versionId,
        title: v.title || t.title,
        duration: v.duration,
        audio: v.format
      });
      restartIfPlaying(trackId);
    },
    [patchTrack, restartIfPlaying]
  );

  const handleRenameVersion = useCallback(
    async (trackId, versionId, rawTitle) => {
      const t = tracksRef.current.find((x) => x.id === trackId);
      const v = t?.versions.find((x) => x.id === versionId);
      const title = (rawTitle || '').trim();
      if (!t || !v || !title || title === v.title) return;
      // rename the file on disk to match, best-effort (DB path stays truth).
      // Best-effort covers filesystem failures only: a version without a
      // valid relPath throws here, before anything is touched, on purpose.
      let relPath = assertRelPath(v.relPath, 'rename version');
      if (window.electronAPI?.mediaRename) {
        try {
          relPath = assertRelPath(await window.electronAPI.mediaRename({ relPath, title }), 'rename version result');
        } catch (err) {
          console.error('[media] rename failed, keeping the old filename:', err);
          relPath = v.relPath;
        }
      }
      const isActive = t.activeVersionId === versionId;
      patchTrack(trackId, {
        versions: t.versions.map((x) => (x.id === versionId ? { ...x, title, relPath } : x)),
        ...(isActive ? { title } : {})
      });
      if (isActive && relPath !== v.relPath) restartIfPlaying(trackId);
    },
    [patchTrack, restartIfPlaying]
  );

  // custom artist name, same edit/reset pattern as version titles just above
  // (empty or unchanged input is a silent no-op, matching commitTitle's
  // `if (t)` guard in VersionsModal) but scoped to the track, not a version —
  // there's exactly one artist per track, unlike title which can genuinely
  // differ per version. originalArtist is captured lazily on first edit,
  // same as CoverEditModal's originalArtworkBlob: a never-edited track has
  // nothing to reset (and shows no reset control), an edited one always has
  // the real imported value to go back to, and a second edit never
  // overwrites the true original with an already-edited value.
  const handleRenameArtist = useCallback(
    (trackId, rawArtist) => {
      const t = tracksRef.current.find((x) => x.id === trackId);
      const artist = (rawArtist || '').trim();
      if (!t || !artist || artist === t.artist) return;
      const originalArtist = t.originalArtist !== undefined ? t.originalArtist : t.artist;
      patchTrack(trackId, { artist, originalArtist });
    },
    [patchTrack]
  );

  const handleDeleteVersion = useCallback(
    (trackId, versionId) => {
      const t = tracksRef.current.find((x) => x.id === trackId);
      if (!t || t.versions.length <= 1) return; // deleting the last version is blocked
      const gone = t.versions.find((v) => v.id === versionId);
      const remaining = t.versions.filter((v) => v.id !== versionId);
      let activeVersionId = t.activeVersionId;
      let extra = {};
      if (activeVersionId === versionId) {
        const next = [...remaining].sort((a, b) => b.dateAdded - a.dateAdded)[0];
        activeVersionId = next.id;
        extra = { title: next.title || t.title, duration: next.duration, audio: next.format };
      }
      patchTrack(trackId, { versions: remaining, activeVersionId, ...extra });
      if (gone) window.electronAPI?.mediaDelete(assertRelPath(gone.relPath, 'delete version'));
      if (activeVersionId !== t.activeVersionId) restartIfPlaying(trackId);
    },
    [patchTrack, restartIfPlaying]
  );

  // read a picked file, returning { entry, bytes, fp, meta } or null on cancel
  const readPicked = useCallback(async () => {
    const entry = await window.electronAPI?.selectAudioFile();
    if (!entry) return null;
    const bytes = await window.electronAPI.readAudioFile(entry.path);
    const fp = await fingerprint(bytes);
    const meta = await readAudioMeta(bytes, entry.name);
    return { entry, bytes, fp, meta };
  }, []);

  const handleAddVersion = useCallback(
    async (trackId) => {
      const t = tracksRef.current.find((x) => x.id === trackId);
      if (!t || !window.electronAPI?.selectAudioFile) return;
      const picked = await readPicked();
      if (!picked) return;
      const { entry, bytes, fp, meta } = picked;
      const title = importTitle(meta, entry.name);

      if (t.versions.some((v) => v.fingerprint === fp)) {
        window.alert('That file is already a version of this track.');
        return;
      }
      const elsewhere = allVersions(tracksRef.current).find(
        (x) => x.version.fingerprint === fp && x.track.id !== trackId
      );

      // copy the picked file into this track's folder as a new active version
      const addSeparateCopy = async () => {
        const { relPath } = await window.electronAPI.mediaCopyIn({
          srcPath: entry.path,
          artist: t.artist,
          title: t.title,
          label: title, // on-disk filename base
          ext: sniffExt(bytes) || extFromName(entry.name)
        });
        const newVersion = makeVersion({
          title,
          relPath,
          duration: meta.duration,
          format: meta.format,
          fp
        });
        patchTrack(trackId, {
          versions: [...t.versions, newVersion],
          activeVersionId: newVersion.id,
          title: newVersion.title,
          duration: newVersion.duration,
          audio: newVersion.format
        });
        restartIfPlaying(trackId);
      };

      // fold the standalone track's version(s) into this one and remove it
      const mergeFromElsewhere = async () => {
        const src = elsewhere.track;
        patchTrack(trackId, {
          versions: [...t.versions, ...src.versions], // files already in the library
          activeVersionId: elsewhere.version.id,
          title: elsewhere.version.title || src.title,
          duration: elsewhere.version.duration,
          audio: elsewhere.version.format
        });
        await deleteTrack(src.id);
        setTracks((prev) => prev.filter((x) => x.id !== src.id));
        setTombstones((prev) => mergeTombstones(prev, [{ id: src.id, kind: 'track', updatedAt: stampAfter(src) }]));
        playlistsRef.current.forEach((pl) => {
          if (pl.trackIds.includes(src.id)) {
            persistPlaylist({
              ...pl,
              trackIds: [...new Set(pl.trackIds.map((id) => (id === src.id ? trackId : id)))]
            });
          }
        });
        if (src.id === playingTrackId) setPlayingTrackId(trackId);
        if (src.id === currentTrackId) setCurrentTrackId(trackId);
        restartIfPlaying(trackId);
      };

      if (elsewhere) {
        setChoiceConfig({
          title: 'That file is already in your library',
          message: `"${entry.name}" is already here as "${displayTitle(elsewhere.track)}".`,
          choices: [
            { value: 'merge', label: 'Merge', danger: true },
            { value: 'copy', label: 'Add separate copy', primary: true },
            { value: 'cancel', label: 'Cancel' }
          ],
          onChoose: (v) => {
            if (v === 'merge') mergeFromElsewhere();
            else if (v === 'copy') addSeparateCopy();
          }
        });
        return;
      }

      await addSeparateCopy();
    },
    [readPicked, patchTrack, persistPlaylist, restartIfPlaying, playingTrackId, currentTrackId]
  );

  const handleRelocateVersion = useCallback(
    async (trackId, versionId) => {
      const t = tracksRef.current.find((x) => x.id === trackId);
      const v = t?.versions.find((x) => x.id === versionId);
      if (!t || !v) return;
      const picked = await readPicked();
      if (!picked) return;
      const { entry, bytes, fp, meta } = picked;
      const { relPath } = await window.electronAPI.mediaCopyIn({
        srcPath: entry.path,
        artist: t.artist,
        title: t.title,
        label: v.title || 'original',
        ext: sniffExt(bytes) || extFromName(entry.name)
      });
      const nextV = {
        ...v,
        relPath: assertRelPath(relPath, 'relocate version'),
        duration: meta.duration,
        format: meta.format,
        fingerprint: fp
      };
      patchTrack(trackId, {
        versions: t.versions.map((x) => (x.id === versionId ? nextV : x)),
        ...(t.activeVersionId === versionId ? { duration: nextV.duration, audio: nextV.format } : {})
      });
      setMissingPaths((prev) => {
        const next = new Set(prev);
        next.delete(v.relPath);
        return next;
      });
      restartIfPlaying(trackId);
    },
    [readPicked, patchTrack, restartIfPlaying]
  );

  const handleAddNote = useCallback(
    (trackId, text) => {
      const t = tracksRef.current.find((x) => x.id === trackId);
      if (!t || !text.trim()) return;
      const now = Date.now();
      const note = { id: crypto.randomUUID(), text: text.trim(), complete: false, dateAdded: now, updatedAt: now };
      patchTrack(trackId, { notes: [...(t.notes || []), note] });
    },
    [patchTrack]
  );
  // Every note edit stamps THAT note (`updatedAt: stampAfter(note)`) — notes
  // merge by id across machines, see syncMerge.js. A delete leaves a
  // tombstone in `deletedNotes` so the other machine's copy doesn't bring
  // the note back.
  const handleToggleNote = useCallback(
    (trackId, noteId) => {
      const t = tracksRef.current.find((x) => x.id === trackId);
      if (!t) return;
      patchTrack(trackId, {
        notes: (t.notes || []).map((n) =>
          n.id === noteId ? { ...n, complete: !n.complete, updatedAt: stampAfter(n) } : n
        )
      });
    },
    [patchTrack]
  );
  const handleEditNote = useCallback(
    (trackId, noteId, text) => {
      const t = tracksRef.current.find((x) => x.id === trackId);
      if (!t) return;
      patchTrack(trackId, {
        notes: (t.notes || []).map((n) => (n.id === noteId ? { ...n, text, updatedAt: stampAfter(n) } : n))
      });
    },
    [patchTrack]
  );
  const handleDeleteNote = useCallback(
    (trackId, noteId) => {
      const t = tracksRef.current.find((x) => x.id === trackId);
      const gone = (t?.notes || []).find((n) => n.id === noteId);
      if (!t || !gone) return;
      patchTrack(trackId, {
        notes: t.notes.filter((n) => n.id !== noteId),
        deletedNotes: [...(t.deletedNotes || []), { id: noteId, updatedAt: stampAfter(gone) }]
      });
    },
    [patchTrack]
  );
  const handleToggleNotePriority = useCallback(
    (trackId, noteId) => {
      const t = tracksRef.current.find((x) => x.id === trackId);
      if (!t) return;
      patchTrack(trackId, {
        notes: (t.notes || []).map((n) =>
          n.id === noteId ? { ...n, priority: !n.priority, updatedAt: stampAfter(n) } : n
        )
      });
    },
    [patchTrack]
  );
  // manual drag order for notes — moves `movedId` next to `targetId` in the
  // raw notes array. Only within the same tier (flagged / incomplete /
  // complete); the array order is what sortNotes preserves within a tier.
  const handleReorderNote = useCallback(
    (trackId, movedId, targetId, before) => {
      const t = tracksRef.current.find((x) => x.id === trackId);
      if (!t) return;
      const notes = [...(t.notes || [])];
      const from = notes.findIndex((n) => n.id === movedId);
      const target = notes.find((n) => n.id === targetId);
      if (from === -1 || !target || movedId === targetId) return;
      if (noteRank(notes[from]) !== noteRank(target)) return; // different tier
      const [moved] = notes.splice(from, 1);
      let at = notes.findIndex((n) => n.id === targetId);
      if (!before) at += 1;
      notes.splice(at, 0, moved);
      patchTrack(trackId, { notes });
    },
    [patchTrack]
  );

  // cover art edit — CoverEditModal captures `originalArtworkBlob` lazily and
  // hands back the full pair to persist. Invalidate the playlist-mosaic's
  // cached content hash for this track too — its artwork just changed, and
  // that cache assumes otherwise (see artworkHash.js).
  const handleSaveCover = useCallback(
    (trackId, { artworkBlob, originalArtworkBlob }) => {
      patchTrack(trackId, { artworkBlob, originalArtworkBlob });
      invalidateArtworkHash(trackId);
    },
    [patchTrack]
  );

  // Forget a set of track ids everywhere transient state points at them:
  // playback, the browsed track, the zoomed row, open modals, the queue,
  // history. Shared by a local delete and a delete merged in from the other
  // machine. Files and the database are the callers' business.
  const dropTrackRefs = useCallback(
    (ids) => {
      const gone = new Set(ids);
      if (gone.has(playingTrackIdRef.current)) {
        waveformRef.current?.pause();
        setPlayingTrackId(null);
        setIsPlaying(false);
        setCurrentTime(0);
        setDuration(0);
      }
      if (gone.has(currentTrackIdRef.current)) setCurrentTrackId(null);
      setExpandedTrackId((id) => (gone.has(id) ? null : id));
      setVersionsModalTrackId((id) => (gone.has(id) ? null : id));
      setCoverEditTrackIds((open) => {
        if (!open) return open;
        const kept = open.filter((id) => !gone.has(id));
        return kept.length === open.length ? open : kept.length ? kept : null;
      });
      setEditArtistTrackIds((open) => {
        if (!open) return open;
        const kept = open.filter((id) => !gone.has(id));
        return kept.length === open.length ? open : kept.length ? kept : null;
      });
      setQueue((q) => (q.some((e) => gone.has(e.trackId)) ? q.filter((e) => !gone.has(e.trackId)) : q));
      const filtered = historyRef.current.filter((h) => !gone.has(h.trackId));
      if (filtered.length !== historyRef.current.length) {
        commitHistory(filtered, Math.min(historyIndexRef.current, filtered.length));
      }
    },
    [commitHistory]
  );

  const handleDeleteTrack = useCallback(
    async (id) => {
      const t = tracksRef.current.find((x) => x.id === id);
      (t?.versions || []).forEach((v) => window.electronAPI?.mediaDelete(assertRelPath(v.relPath, 'delete track')));
      await deleteTrack(id);
      setTracks((prev) => prev.filter((x) => x.id !== id));
      // recorded, not just removed — so the other machine's copy can't
      // resurrect it on the next merge (syncMerge.js)
      setTombstones((prev) => mergeTombstones(prev, [{ id, kind: 'track', updatedAt: stampAfter(t) }]));
      dropTrackRefs([id]);
      // drop the deleted track from every playlist that referenced it
      playlistsRef.current.forEach((pl) => {
        if (pl.trackIds.includes(id)) {
          persistPlaylist({ ...pl, trackIds: pl.trackIds.filter((x) => x !== id) });
        }
      });
    },
    [dropTrackRefs, persistPlaylist]
  );

  // Drain the last merge to IndexedDB from COMMITTED state: whichever side
  // won at apply time is what's in `tracks` / `playlists` now, so write
  // exactly that (full-record replace, never a partial update). A track the
  // merge removed gets its references dropped here, same as a local delete
  // — but NOT its files: the machine that deleted it already removed those
  // and Dropbox carries that over. A skipped apply (an item moved under the
  // merge) queues one more merge.
  useEffect(() => {
    const pend = pendingSyncTrackIdsRef.current;
    if (pend.size) {
      pendingSyncTrackIdsRef.current = new Set();
      const gone = [];
      for (const id of pend) {
        const t = tracks.find((x) => x.id === id);
        if (t) replaceTrack(t);
        else {
          deleteTrack(id);
          gone.push(id);
        }
      }
      if (gone.length) dropTrackRefs(gone);
    }
    if (syncSkippedRef.current) {
      syncSkippedRef.current = false;
      runSync({ reason: 'retry' });
    }
  }, [tracks, dropTrackRefs, runSync]);

  useEffect(() => {
    const pend = pendingSyncPlaylistIdsRef.current;
    if (pend.size) {
      pendingSyncPlaylistIdsRef.current = new Set();
      for (const id of pend) {
        const p = playlists.find((x) => x.id === id);
        if (p) {
          putPlaylist(p);
          continue;
        }
        deletePlaylistRecord(id);
        setPlaybackContext((ctx) => (ctx.type === 'playlist' && ctx.id === id ? { type: 'library' } : ctx));
        setActiveView((av) => (av.type === 'playlist' && av.id === id ? { type: 'imported' } : av));
        setEditingPlaylistId((cur) => (cur === id ? null : cur));
      }
    }
    if (syncSkippedRef.current) {
      syncSkippedRef.current = false;
      runSync({ reason: 'retry' });
    }
  }, [playlists, runSync]);

  // focus the search box once we're back in sidebar view after cmd+s
  useEffect(() => {
    if (view === 'sidebar' && pendingFocusSearch) {
      searchInputRef.current?.focus();
      searchInputRef.current?.select();
      setPendingFocusSearch(false);
    }
  }, [view, pendingFocusSearch]);

  // physically shrink/restore the OS window itself for mini mode, rather
  // than showing a small widget inside the still-full-size window.
  //
  // Root-caused 2026-09-04: that real OS resize (240px, and momentarily
  // narrower still) fires native 'resize' events that the SIDEBAR_MIN_WIDTH
  // guard above now ignores for navWidth/npWidth — but as a second,
  // independent line of defense, this effect also snapshots both column
  // widths the instant mini mode is entered and force-writes them back
  // (plain setState calls, not the shrink-only clamp) the instant it's
  // exited. Sequencing: the snapshot read happens synchronously, in the same
  // tick as the `view === 'mini'` branch below, before enterMiniMode() sends
  // its IPC — and the actual OS resize (and any resize events it causes)
  // can only happen later, asynchronously, once main.js has handled that
  // IPC. So nothing can clamp navWidth/npWidth for THIS transition before
  // the snapshot is taken.
  //
  // Gated on a genuine mini transition (prevViewRef), not just "view isn't
  // mini" — previously this ran its else-branch (calling exitMiniMode())
  // on every view change away from mini, including a plain sidebar<->focus
  // swap that never touched mini at all.
  useEffect(() => {
    const prevView = prevViewRef.current;
    prevViewRef.current = view;
    if (view === 'mini' && prevView !== 'mini') {
      preMiniLayoutRef.current = { navWidth: navWidthRef.current, npWidth: npWidthRef.current };
      window.electronAPI?.enterMiniMode(240, 240);
    } else if (view !== 'mini' && prevView === 'mini') {
      window.electronAPI?.exitMiniMode();
      const saved = preMiniLayoutRef.current;
      if (saved) {
        setNavWidth(saved.navWidth);
        setNpWidth(saved.npWidth);
        preMiniLayoutRef.current = null;
      }
    }
  }, [view]);

  // global shortcuts, driven by the user-configurable keybindings map
  useEffect(() => {
    function handleKeyDown(e) {
      // the settings modal / search overlay each own key handling while
      // open (their own capture-phase listener handles Escape/Cmd+W/etc.
      // for themselves — see SettingsModal.jsx and SearchOverlay.jsx) —
      // this mirrors settingsOpen exactly rather than inventing a second
      // mechanism, per the Cmd+W lesson below. The library-setup gate is
      // blocking by definition — no shortcut may act behind it.
      if (settingsOpen || searchOverlayOpen || setupGate) return;

      // Option+Space opens the quick-search overlay (2026-09-06) —
      // deliberately NOT Electron's globalShortcut (system-wide, and
      // already a source of real conflicts elsewhere in this app — see
      // the F7/F8/F9 media-key handling); a plain renderer keydown only
      // ever fires while this window is actually focused, which is exactly
      // "open when Playdisc is focused, otherwise do nothing" with no
      // extra code. Fixed, not in the rebindable keybindings map — same
      // precedent as Cmd+W and Cmd+, below, both deliberately excluded from
      // DEFAULT_KEYBINDINGS. e.code (not e.key) for the physical Space key,
      // since macOS's Option-modifies-key-value behavior can otherwise turn
      // e.key into a composed character instead of a plain space. Declines
      // to open over another modal (Settings, or one of the three tracked
      // in modalStateRef) rather than stacking two modal-ish surfaces.
      if (e.altKey && !e.metaKey && !e.ctrlKey && !e.shiftKey && e.code === 'Space') {
        e.preventDefault();
        if (!anyModalOpen) setSearchOverlayOpen(true);
        return;
      }

      // Cmd/Ctrl+W: the main window has no Cmd+W of its own — buildAppMenu()
      // replaces the File menu (no role: 'close') and role: 'windowMenu' on
      // macOS doesn't include one either, so this only ever arrives here as a
      // plain DOM keydown, same as SettingsModal's own Cmd+W-mirrors-Escape
      // handler (that handler now stops propagation on its dismiss branch, so
      // this one never even runs while Settings is open — see SettingsModal
      // for why that used to leak through). With one of the three modals
      // open, close it (same priority as the old close-active-modal IPC
      // path). Cmd+W is intentionally NEVER allowed to close or quit the app
      // window — with nothing open it's a deliberate no-op, just swallowed.
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'w') {
        e.preventDefault();
        const m = modalStateRef.current;
        if (m.coverEditTrackIds) setCoverEditTrackIds(null);
        else if (m.editArtistTrackIds) setEditArtistTrackIds(null);
        else if (m.versionsModalTrackId) setVersionsModalTrackId(null);
        else if (m.editingPlaylistId) setEditingPlaylistId(null);
        return;
      }

      const isTyping = isTypingTarget(e);
      const keyStr = eventToKeyString(e);

      // W/A/S/D (+ arrow keys as an alias), mini mode only: move the card
      // between corners game-movement-style. Fixed, not in the rebindable
      // keybindings map — same precedent as Option+Space/Cmd+W above, this
      // is a mode-specific spatial control, not a track-list/playback
      // action. Takes priority over whatever these keys are otherwise
      // bound to (shuffle defaults to 's', scrollDownFast to 'd', arrows to
      // next/prev/volume) for exactly as long as mini mode is showing —
      // their on-screen equivalents (the mini transport buttons, the
      // right-click shuffle toggle) still work. electron/main.js does the
      // actual moving (it owns the window + screen APIs), animated the
      // same way the corner-snap glide is.
      if (view === 'mini' && !isTyping && !e.metaKey && !e.ctrlKey && !e.altKey) {
        const dir =
          keyStr === 'w' || keyStr === 'arrowup'
            ? 'up'
            : keyStr === 's' || keyStr === 'arrowdown'
              ? 'down'
              : keyStr === 'a' || keyStr === 'arrowleft'
                ? 'left'
                : keyStr === 'd' || keyStr === 'arrowright'
                  ? 'right'
                  : null;
        if (dir) {
          e.preventDefault();
          window.electronAPI?.moveMiniWindow?.(dir);
          return;
        }
      }

      // Cmd+, (open settings) is handled by the native app menu accelerator
      // in electron/main.js, not here — see keybindings.js.

      // Escape leaves fullscreen / mini and returns to the general view.
      // (In the general view, Escape is left to the search field + selection.)
      if (e.key === 'Escape' && view !== 'sidebar') {
        e.preventDefault();
        setView('sidebar');
        return;
      }

      // Escape closes the artist page (2026-09-06), checked right after the
      // fullscreen/mini case above and before everything else, same
      // "unconditional, before isTyping" placement — this is what makes it
      // still fire even if some non-search-box element on the page happens
      // to have focus. The two checks are mutually exclusive in practice
      // (opening an artist page always switches to 'sidebar' first — see
      // openArtist), but if `view` and `activeView` ever disagree (e.g. the
      // mini-player keybinding pressed while viewing an artist page), the
      // fullscreen/mini exit above wins first; a second Escape then closes
      // the artist page. Loses to: Settings/the search overlay (see the
      // early return at the top of this handler — each owns Escape
      // entirely while open) and to LibraryList's own search-box Escape
      // handling (a local onKeyDown that stops propagation before this
      // handler ever runs, when that box has focus and isn't empty).
      if (e.key === 'Escape' && activeView.type === 'artist') {
        e.preventDefault();
        closeArtistPage();
        return;
      }

      if (keyStr === keybindings.search.key) {
        e.preventDefault();
        setPendingFocusSearch(true);
        setView('sidebar');
        return;
      }

      if (isTyping) return;

      if (keyStr === keybindings.toggleNav.key) {
        // only meaningful in the 3-column library view
        if (view === 'sidebar') {
          e.preventDefault();
          setNavCollapsed((c) => !c);
        }
        return;
      }

      // playPause is handled by the dedicated hold-for-2x effect below
      // instead of here — see SPACE_HOLD_THRESHOLD_MS — since a plain
      // keydown-fires-immediately branch can't distinguish a tap from the
      // first moment of a hold. That effect calls handleTogglePlay itself
      // on a genuine tap (not just waveformRef.toggle() — if you're
      // browsing a track that isn't loaded into the audio engine yet,
      // there's nothing to toggle; handleTogglePlay adopts the browsed
      // track first, same as clicking the play button does).
      if (keyStr === keybindings.next.key) {
        e.preventDefault();
        handleSkip(1);
      } else if (keyStr === keybindings.prev.key) {
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
        handleExpandTrack();
      } else if (keyStr === keybindings.expandNotes.key) {
        // same as clicking the now-playing notes icon (only exists in the
        // general view)
        if (view === 'sidebar') {
          e.preventDefault();
          setNotesPanelOpen((o) => !o);
        }
      } else if (keyStr === keybindings.scrollDown.key) {
        e.preventDefault();
        nudgeLibraryScroll(1);
      } else if (keyStr === keybindings.scrollUp.key) {
        e.preventDefault();
        nudgeLibraryScroll(-1);
      } else if (keyStr === keybindings.scrollDownFast.key) {
        e.preventDefault();
        nudgeLibraryScroll(1, true);
      } else if (keyStr === keybindings.scrollUpFast.key) {
        e.preventDefault();
        nudgeLibraryScroll(-1, true);
      } else if (keyStr === keybindings.toggleLibraryView.key) {
        e.preventDefault();
        setView('sidebar');
        setLibraryViewMode((m) => (m === 'grid' ? 'list' : 'grid'));
      } else if (keyStr === keybindings.seekBack.key) {
        e.preventDefault();
        waveformRef.current?.skip(-5);
      } else if (keyStr === keybindings.seekForward.key) {
        e.preventDefault();
        waveformRef.current?.skip(5);
      } else if (keyStr === keybindings.restart.key) {
        e.preventDefault();
        handleRestartTrack(); // same as the transport restart button; no-ops if nothing's loaded
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
    searchOverlayOpen,
    anyModalOpen,
    setupGate,
    view,
    activeView,
    closeArtistPage,
    handleSetVolume,
    handleTogglePlay,
    handleToggleShuffle,
    handleRestartTrack,
    nudgeLibraryScroll,
    handleExpandTrack
  ]);

  // Hold-space-for-2x tape-style speed. A quick tap of the play/pause key
  // still just toggles, exactly as before this feature — the distinction
  // is made here, not in the dispatcher above, because a plain
  // keydown-fires-immediately branch can't tell a tap from the first
  // instant of a hold. 200ms threshold: long enough that a normal, snappy
  // tap-to-play/pause never accidentally engages 2x (typical key-repeat
  // delay on macOS is itself ~500-600ms, so this comfortably sits below
  // that too, meaning the threshold — not the OS's own repeat timing — is
  // always what decides), short enough that a deliberate hold feels
  // instant, matching the "hold space to skim" gesture this is modeled on
  // (YouTube uses a comparable threshold for the same reason).
  //
  // e.repeat (true for OS auto-repeat while a key is held, false for the
  // genuine first press) is what keeps this to "once per hold, not once
  // per repeat" — the repeat keydowns are ignored outright, so neither the
  // timer nor a play/pause toggle can ever fire from them.
  //
  // isTypingTarget is the EXACT SAME function the dispatcher above uses,
  // not a second reimplementation — typing a literal space in the library
  // search box, Settings' search, a rename field, the notes panel, or the
  // search overlay's own input all take the early return here for free.
  // settingsOpen/searchOverlayOpen/anyModalOpen are re-checked here too
  // (not just relied on via the dispatcher's own early return above) since
  // this is a separate listener pair, not a branch inside that handler.
  //
  // The keyUP handler deliberately does NOT re-check any of those guards —
  // once spaceHoldTrackingRef says a press begun here, the release must
  // always be honored (reset the rate, or toggle, whichever is due)
  // regardless of what opened in the meantime. See resetSpaceHold's own
  // comment above for why refs, not state.
  const SPACE_HOLD_THRESHOLD_MS = 200;
  useEffect(() => {
    function handleKeyDown(e) {
      if (eventToKeyString(e) !== keybindings.playPause.key) return;
      if (settingsOpen || searchOverlayOpen || anyModalOpen || setupGate) return;
      if (isTypingTarget(e)) return;
      // Every qualifying keydown, including OS auto-repeat while held — not
      // just the first. Space's default browser action is "scroll the
      // nearest scrollable ancestor" (the track list, or the grid — same
      // default, different container, both blocked the same way here since
      // this prevents the key event itself, not something container-
      // specific); `e.repeat` was checked before this, as an early return,
      // so only the very first keydown of a hold ever got prevented and
      // every auto-repeat after it fell through to the browser's default —
      // invisible on a quick tap (one keydown, moves the list a few px at
      // most) but a rapid, repeated scroll for the whole duration of a
      // hold. isTypingTarget still wins over this — a space in a text field
      // must actually type a space, never get prevented.
      e.preventDefault();
      if (e.repeat) return; // only the first keydown of a hold starts tracking/the timer
      spaceHoldTrackingRef.current = true;
      spaceHoldActiveRef.current = false;
      spaceHoldTimerRef.current = setTimeout(() => {
        spaceHoldTimerRef.current = null;
        spaceHoldActiveRef.current = true;
        // Skipped when nothing's actually playing — "holding space with
        // playback stopped" must do nothing rather than set a rate that's
        // only ever audible as a glitch the moment playback next starts.
        // preservePitch=false is the tape/record-speeding-up effect: false
        // means DON'T preserve pitch, so it rises with the speed — see
        // Waveform.jsx's setPlaybackRate for which underlying media
        // property that actually sets (preservesPitch, confirmed live —
        // no webkit-prefixed fallback needed on this Chromium version).
        if (isPlayingRef.current) waveformRef.current?.setPlaybackRate(2, false);
      }, SPACE_HOLD_THRESHOLD_MS);
    }
    function handleKeyUp(e) {
      if (eventToKeyString(e) !== keybindings.playPause.key) return;
      if (!spaceHoldTrackingRef.current) return; // not a press this effect started tracking
      const wasHolding = spaceHoldActiveRef.current;
      resetSpaceHold();
      // only a genuine tap (never crossed the threshold) toggles — same
      // action, same guard rail, a plain press always triggered
      if (!wasHolding) handleTogglePlay();
    }
    document.addEventListener('keydown', handleKeyDown);
    document.addEventListener('keyup', handleKeyUp);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      document.removeEventListener('keyup', handleKeyUp);
    };
  }, [keybindings, settingsOpen, searchOverlayOpen, anyModalOpen, setupGate, handleTogglePlay, resetSpaceHold]);

  // Reset on track switch or a view change (fullscreen/mini, back-to-
  // sidebar, the artist-page Escape/back path) — holding space, then
  // clicking a different track or leaving the view mid-hold, must not
  // carry a 2x rate into whatever's showing/playing next.
  useEffect(() => {
    resetSpaceHold();
  }, [playingTrackId, view, resetSpaceHold]);

  // Reset the instant any modal-ish surface opens, however it was opened —
  // this is a safety net alongside the keydown guard above (which only
  // stops a NEW hold from starting), for the narrower case of one of these
  // opening via the mouse while a hold from the keyboard is already mid-
  // flight (e.g. clicking the gear icon while still holding space).
  useEffect(() => {
    if (settingsOpen || searchOverlayOpen || anyModalOpen) resetSpaceHold();
  }, [settingsOpen, searchOverlayOpen, anyModalOpen, resetSpaceHold]);

  // Window-blur case, specifically: Cmd+Tab-ing away mid-hold never
  // delivers a keyup for the held key at all (the OS, not this window, has
  // the keyboard focus from that point on) — there is no keyboard event to
  // catch here, by construction. 'blur' on window is the actual signal:
  // it fires the instant this window stops being the focused one, for any
  // reason (Cmd+Tab, clicking another app, minimizing), independent of
  // whatever key state the OS is now tracking on our behalf.
  useEffect(() => {
    window.addEventListener('blur', resetSpaceHold);
    return () => window.removeEventListener('blur', resetSpaceHold);
  }, [resetSpaceHold]);

  return (
    <div
      ref={appRef}
      className={`app${navCollapsed && view === 'sidebar' ? ' nav-collapsed' : ''}`}
      style={{
        // clean px only, so both vars can animate on Tab (see @property).
        '--nav-width': `${navCollapsed && view === 'sidebar' ? 0 : navWidth}px`,
        // Tab collapse: nav goes to 0 and the track list + artwork split the
        // whole window evenly. Normal view: the artwork column takes ~48% of
        // the room left after the nav (middle keeps a slight edge, min 340px).
        // Toggling Tab off returns cleanly to this because nothing mutates
        // npWidth in between (the np handle is hidden while collapsed).
        '--np-width': `${
          navCollapsed && view === 'sidebar'
            ? Math.round(viewportW / 2)
            : npWidth ??
              (() => {
                const avail = viewportW - navWidth;
                return Math.max(320, Math.min(1400, Math.round(avail * 0.483), avail - 340));
              })()
        }px`
      }}
    >
      {createPortal(
        <Waveform
          ref={waveformRef}
          audioUrl={audioUrl}
          theme={theme}
          palette={playingPalette}
          onDarkBackdrop={waveOnDarkBackdrop}
          onReady={handleReady}
          onTimeUpdate={handleTimeUpdate}
          onFinish={handleFinish}
          onPlayStateChange={setIsPlaying}
        />,
        waveformHostRef.current
      )}
      {view !== 'mini' && <div className="drag-strip" />}
      {view === 'sidebar' && (
        <button
          className="settings-gear"
          onClick={handleOpenSettings}
          aria-label="settings"
          title="settings"
        >
          <GearIcon />
        </button>
      )}
      {/* The three views that can show the waveform — NowPlaying, FocusView,
          MiniPlayer — are ALL always mounted; `active` CSS-hides the two that
          aren't current (display:none via `view-hidden`). They must never be
          swapped by a ternary: that unmounts the old view's WaveformSlot,
          detaching the shared <audio> host node from the document, and the
          browser pauses a detached media element (measured, asynchronously,
          ~1.4ms after the reattach). Keeping all three mounted means a view
          switch moves the host between two containers that are both already
          in the document — one appendChild, never detached, never paused.
          PlaylistNav/LibraryList hold no audio and stay conditional.
          DOM order matters: .now-playing has no explicit grid-column and
          lands in column 3 by auto-placement after nav + list; the hidden
          focus/mini views generate no grid box (display:none / fixed). */}
      {view === 'sidebar' && (
        <>
          <PlaylistNav
            playlists={playlists}
            activeView={activeView}
            onSelectView={setActiveView}
            likedCount={tracks.filter((t) => t.liked).length}
            onFilesSelected={handleFilesSelected}
            onCreatePlaylist={handleCreatePlaylist}
            onOpenMenu={setContextMenu}
            onTogglePin={handleTogglePinPlaylist}
            onReorderPlaylists={handleReorderPlaylists}
            onRenamePlaylist={handleRenamePlaylist}
            onEditPlaylist={setEditingPlaylistId}
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
            onResizeStart={startResizeNav}
          />
          <LibraryList
            tracks={shownTracks}
            viewTitle={
              activePlaylist
                ? activePlaylist.name
                : isLikedView
                  ? 'Liked Songs'
                  : isArtistView
                    ? activeArtistName
                    : 'Imported'
            }
            isPlaylistView={!!activePlaylist}
            isLikedView={isLikedView}
            isArtistView={isArtistView}
            onOpenArtist={openArtist}
            playlistId={activePlaylist?.id}
            playlistDescription={activePlaylist?.description || ''}
            playlistImageBlob={activePlaylist?.imageBlob || null}
            onEditPlaylist={activePlaylist ? () => setEditingPlaylistId(activePlaylist.id) : undefined}
            onToggleLiked={handleSetLiked}
            playlists={playlists}
            currentTrackId={currentTrackId}
            playingTrackId={playingTrackId}
            isPlaying={isPlaying}
            expandedTrackId={expandedTrackId}
            viewMode={libraryViewMode}
            onSetViewMode={setLibraryViewMode}
            query={librarySearchQuery}
            onSetQuery={setLibrarySearchQuery}
            activeTag={libraryActiveTag}
            onSetActiveTag={setLibraryActiveTag}
            onUpdatePlaylist={handleUpdatePlaylist}
            sort={activeSort}
            sortDir={activeSortDir}
            onSetSort={handleSetActiveSort}
            onReorderLibrary={handleReorderLibrary}
            scrollPosRef={libScrollRef}
            shuffleEnabled={shuffleEnabled}
            onToggleShuffle={handleToggleShuffle}
            isViewPlaying={headerViewPlaying}
            onPlayPause={handleHeaderPlayPause}
            onSelectTrack={handleViewTrack}
            onPlayTrack={handlePlayTrack}
            onAddTag={handleAddTag}
            onRemoveTag={handleRemoveTag}
            onDeleteTagGroup={handleDeleteTagGroup}
            tagOrder={tagOrder}
            onReorderTags={handleReorderTags}
            onDeleteTrack={handleDeleteTrack}
            onAddToQueue={handleAddToQueue}
            onAddTracksToPlaylist={handleAddTracksToPlaylist}
            onCreatePlaylistWithTracks={handleCreatePlaylist}
            onRemoveTrackFromPlaylist={handleRemoveTrackFromPlaylist}
            onReorderPlaylistTracks={handleReorderPlaylistTracks}
            onOpenMenu={setContextMenu}
            onPrompt={setPromptConfig}
            onAddVersion={handleAddVersion}
            onOpenVersions={setVersionsModalTrackId}
            onEditCover={setCoverEditTrackIds}
            onEditArtist={setEditArtistTrackIds}
            missingPaths={missingPaths}
            searchInputRef={searchInputRef}
          />
        </>
      )}
      <NowPlaying
        active={view === 'sidebar'}
        onResizeStart={startResizeNp}
        track={currentTrack}
        waveformHost={waveformHostRef.current}
        isCurrentlyPlayingTrack={isViewingPlayingTrack}
        isPlaying={isPlaying && isViewingPlayingTrack}
        currentTime={currentTime}
        duration={duration}
        onTogglePlay={handleTogglePlay}
        onSkip={handleSkip}
        onRestart={handleRestartTrack}
        canRestart={!!playingTrack}
        onEnterFocus={() => setView('focus')}
        shuffleEnabled={shuffleEnabled}
        onToggleShuffle={handleToggleShuffle}
        repeatMode={repeatMode}
        onCycleRepeat={handleCycleRepeat}
        onOpenArtist={openArtist}
        mediaMissing={currentMissing}
        mediaWaiting={currentWaiting}
        onRelocate={() => {
          const v = activeVersion(currentTrack);
          if (v) handleRelocateVersion(currentTrack.id, v.id);
        }}
        onAddNote={handleAddNote}
        onToggleNote={handleToggleNote}
        onEditNote={handleEditNote}
        onDeleteNote={handleDeleteNote}
        onToggleNotePriority={handleToggleNotePriority}
        onReorderNote={handleReorderNote}
        onOpenMenu={setContextMenu}
        onOpenVersions={setVersionsModalTrackId}
        notesPanelOpen={notesPanelOpen}
        onNotesPanelOpenChange={setNotesPanelOpen}
      />
      <FocusView
        active={view === 'focus'}
        track={currentTrack}
        waveformHost={waveformHostRef.current}
        isCurrentlyPlayingTrack={isViewingPlayingTrack}
        isPlaying={isPlaying && isViewingPlayingTrack}
        currentTime={currentTime}
        duration={duration}
        onTogglePlay={handleTogglePlay}
        onSkip={handleSkip}
        onRestart={handleRestartTrack}
        canRestart={!!playingTrack}
        onExitFocus={() => setView('sidebar')}
        shuffleEnabled={shuffleEnabled}
        onToggleShuffle={handleToggleShuffle}
        repeatMode={repeatMode}
        onCycleRepeat={handleCycleRepeat}
        onOpenArtist={openArtist}
        movementIntensity={backgroundMovement}
        getFrequencyBands={() => waveformRef.current?.getFrequencyBands()}
      />
      <MiniPlayer
        active={view === 'mini'}
        track={playingTrack}
        waveformHost={waveformHostRef.current}
        isPlaying={isPlaying}
        onTogglePlay={() => waveformRef.current?.toggle()}
        onSkip={handleSkip}
        onExit={() => setView('sidebar')}
        volume={volume}
        onSetVolume={handleSetVolume}
        shuffleEnabled={shuffleEnabled}
        onToggleShuffle={handleToggleShuffle}
        movementIntensity={backgroundMovement}
        getFrequencyBands={() => waveformRef.current?.getFrequencyBands()}
      />
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
        <ImportOverlay done={importProgress.done} total={importProgress.total} label={importProgress.label} />
      )}
      {importToast && (
        <ImportToast toast={importToast} onDismiss={dismissImportToast} />
      )}
      {searchOverlayOpen && (
        <SearchOverlay
          tracks={tracks}
          playlists={playlists}
          onSelectResult={handleSelectSearchResult}
          onClose={() => setSearchOverlayOpen(false)}
        />
      )}
      {settingsOpen && (
        <SettingsModal
          theme={theme}
          onSetTheme={setTheme}
          backgroundMovement={backgroundMovement}
          onSetBackgroundMovement={setBackgroundMovement}
          keybindings={keybindings}
          onSetKeybindings={handleSetKeybinding}
          onResetKeybindings={handleResetKeybindings}
          onResetLibrary={handleResetLibrary}
          libraryRoot={libraryRoot}
          onChooseLibraryRoot={handleChooseLibraryRoot}
          lastSnapshotAt={lastSnapshotAt}
          lastSyncAt={lastSyncAt}
          trackCount={tracks.length}
          onClose={handleCloseSettings}
        />
      )}
      {setupGate && (
        <LibrarySetup
          legacy={legacyLibrary}
          libraryRoot={libraryRoot}
          onChooseRoot={handleChooseLibraryRoot}
          onResetLibrary={handleResetLibrary}
        />
      )}
      <ContextMenu menu={contextMenu} onClose={() => setContextMenu(null)} />
      <PromptModal config={promptConfig} onClose={() => setPromptConfig(null)} />
      <ChoiceModal config={choiceConfig} onClose={() => setChoiceConfig(null)} />
      <PlaylistEditModal
        playlist={playlists.find((p) => p.id === editingPlaylistId) || null}
        onClose={() => setEditingPlaylistId(null)}
        onSave={handleUpdatePlaylist}
      />
      <VersionsModal
        track={tracks.find((t) => t.id === versionsModalTrackId) || null}
        missingPaths={missingPaths}
        waitingPaths={waitingPaths}
        onClose={() => setVersionsModalTrackId(null)}
        onAddVersion={handleAddVersion}
        onSetActiveVersion={handleSetActiveVersion}
        onRenameVersion={handleRenameVersion}
        onRenameArtist={handleRenameArtist}
        onDeleteVersion={handleDeleteVersion}
        onRelocateVersion={handleRelocateVersion}
        onAddNote={handleAddNote}
        onToggleNote={handleToggleNote}
        onEditNote={handleEditNote}
        onDeleteNote={handleDeleteNote}
        onToggleNotePriority={handleToggleNotePriority}
        onReorderNote={handleReorderNote}
      />
      <CoverEditModal
        tracks={coverEditTrackIds ? tracks.filter((t) => coverEditTrackIds.includes(t.id)) : []}
        onClose={() => setCoverEditTrackIds(null)}
        onSave={handleSaveCover}
      />
      <EditArtistModal
        tracks={editArtistTrackIds ? tracks.filter((t) => editArtistTrackIds.includes(t.id)) : []}
        onClose={() => setEditArtistTrackIds(null)}
        onRenameArtist={handleRenameArtist}
      />
    </div>
  );
}
