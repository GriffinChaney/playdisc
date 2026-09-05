import { memo, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import TrackItem from './TrackItem';
import TagMenu from './TagMenu';
import ShuffleIcon from './ShuffleIcon';
import { useObjectUrl } from '../lib/useObjectUrl';
import { useListSelection } from '../lib/useListSelection';
import { useArtworkPalette, useDominantColor } from '../lib/useDominantColor';
import { meshBackdropStyle } from '../lib/meshBackdrop';
import { likedBackdropStyle } from '../lib/likedBackdrop';
import { usePlaylistMosaic } from '../lib/usePlaylistMosaic';
import HeartIcon from './HeartIcon';

function formatTotal(seconds) {
  const mins = Math.round(seconds / 60);
  if (mins < 60) return `${mins} min`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return m ? `${h} hr ${m} min` : `${h} hr`;
}

function GridItem({
  track,
  index = 0,
  isActive,
  isPlayingTrack,
  isPlaying,
  isSelected,
  onSelect,
  onMouseDownItem,
  onMouseOverItem,
  onPlay,
  onContextMenu,
  onToggleLiked
}) {
  const artworkUrl = useObjectUrl(track.artworkBlob);
  // Z / follow-mode centering is handled centrally in LibraryList (via
  // data-sel-id, below) so it can coordinate user-scroll suspension the same
  // way for both list and grid — this tile has no per-row logic of its own.

  return (
    <div
      className={`grid-item${isActive ? ' active' : ''}${isSelected ? ' selected' : ''}`}
      // staggered entry delay — capped so a big library still finishes fast
      style={{ '--stagger': `${Math.min(index, 26) * 13}ms` }}
      data-sel-id={track.id}
      onMouseDown={(e) => onMouseDownItem(track.id, e)}
      onMouseOver={() => onMouseOverItem(track.id)}
      onClick={(e) => onSelect(track.id, e)}
      onDoubleClick={() => onPlay(track.id)}
      onContextMenu={(e) => onContextMenu(e, track.id)}
      title={`${track.title} — ${track.artist}`}
    >
      <div
        className="grid-cover"
        style={artworkUrl ? { backgroundImage: `url(${artworkUrl})` } : undefined}
      >
        {!artworkUrl && <span className="thumb-fallback">♪</span>}
        {/* top-right corner of the cover — the one spot in a compact grid
            tile with room to spare, doesn't collide with the eq bars (which
            sit inline with the title below) or the staggered entry motion */}
        <button
          className={`grid-like-btn${track.liked ? ' liked' : ''}`}
          onClick={(e) => {
            e.stopPropagation();
            onToggleLiked(track.id);
          }}
          aria-label={track.liked ? `unlike ${track.title}` : `like ${track.title}`}
          aria-pressed={!!track.liked}
          title={track.liked ? 'unlike' : 'like'}
        >
          <HeartIcon filled={!!track.liked} />
        </button>
      </div>
      <p className="grid-title">
        {/* only rendered on the current track's tile — same bars markup list
            view uses. Playing: animated. Loaded but paused: static, varied
            heights (grid has no row number to tint instead). Non-playing
            tiles get nothing here, same as before this feature, so their
            title stays flush left and aligned with the artist line beneath. */}
        {isPlayingTrack && (
          <span
            className={`track-eq${isPlaying ? '' : ' track-eq-paused'}`}
            aria-label={isPlaying ? 'now playing' : 'paused'}
          >
            <span className="track-eq-bar" aria-hidden="true" />
            <span className="track-eq-bar" aria-hidden="true" />
            <span className="track-eq-bar" aria-hidden="true" />
          </span>
        )}
        {track.title}
      </p>
      <p className="grid-artist">{track.artist}</p>
    </div>
  );
}

// Middle column of the library view: header (title / count / total time /
// list-grid toggle), search + tag filter, the track list or grid, the
// multi-select bulk bar, and (in an unfiltered playlist view) drag-to-reorder.
function LibraryList({
  tracks, // already resolved + ordered for the active view
  viewTitle,
  isPlaylistView,
  playlistId,
  playlistDescription = '',
  playlistImageBlob = null,
  onEditPlaylist,
  playlists,
  currentTrackId,
  playingTrackId,
  isPlaying,
  expandedTrackId,
  viewMode,
  onSetViewMode,
  sort = 'added',
  sortDir = 'desc',
  onSetSort,
  onReorderLibrary,
  shuffleEnabled = false,
  onToggleShuffle,
  isViewPlaying = false,
  onPlayPause,
  onSelectTrack,
  onPlayTrack,
  onAddTag,
  onRemoveTag,
  onDeleteTagGroup,
  onDeleteTrack,
  onAddToQueue,
  onAddTracksToPlaylist,
  onCreatePlaylistWithTracks,
  onRemoveTrackFromPlaylist,
  onReorderPlaylistTracks,
  onOpenMenu,
  onPrompt,
  onAddVersion,
  onOpenVersions,
  onEditCover,
  missingPaths,
  searchInputRef,
  scrollPosRef,
  query,
  onSetQuery,
  activeTag,
  onSetActiveTag,
  onUpdatePlaylist,
  isLikedView = false,
  onToggleLiked
}) {
  const playlistImageUrl = useObjectUrl(playlistImageBlob);

  // --- playlist cover: real image, else a 2x2 mosaic of track artwork ---
  // canonical (trackIds) order so the cover never changes when the view sort
  // does. Only computed for a playlist with no custom image.
  const playlistTrackList = useMemo(() => {
    if (!isPlaylistView || !playlistId || playlistImageBlob) return [];
    const pl = playlists.find((p) => p.id === playlistId);
    if (!pl) return [];
    const byId = new Map(tracks.map((t) => [t.id, t]));
    return pl.trackIds.map((id) => byId.get(id)).filter(Boolean);
  }, [isPlaylistView, playlistId, playlistImageBlob, playlists, tracks]);

  const firstArtworkBlob = useMemo(
    () => playlistTrackList.find((t) => t.artworkBlob)?.artworkBlob || null,
    [playlistTrackList]
  );
  const mosaic = usePlaylistMosaic(playlistTrackList); // { blobs: Blob[], pending }

  // up to four DISTINCT cover URLs; while hashes resolve, hold the first cover
  // as a single-image placeholder rather than flashing four identical tiles
  const tileBlob0 = useObjectUrl(mosaic.blobs[0] || firstArtworkBlob || null);
  const tileBlob1 = useObjectUrl(mosaic.blobs[1] || null);
  const tileBlob2 = useObjectUrl(mosaic.blobs[2] || null);
  const tileBlob3 = useObjectUrl(mosaic.blobs[3] || null);
  const distinctUrls = [tileBlob0, tileBlob1, tileBlob2, tileBlob3];
  const distinctCount = mosaic.blobs.length || (firstArtworkBlob ? 1 : 0);
  // 2x2 tile layout, available images repeated to fill; null => single cover
  const mosaicPattern =
    playlistImageBlob || distinctCount < 2
      ? null
      : distinctCount >= 4
        ? [0, 1, 2, 3]
        : distinctCount === 3
          ? [0, 1, 2, 0]
          : [0, 1, 0, 1];
  const singleCoverUrl = playlistImageBlob ? playlistImageUrl : distinctUrls[0];

  // gradient source: the real cover, else the first track's art — a single
  // stable blob, never a composite (extraction code is untouched). Liked has
  // no cover art at all, so it gets a fixed backdrop instead (see
  // likedBackdrop.js) — these two hooks still run unconditionally either way
  // (rules of hooks), just with a null blob for the Liked view.
  const coverSourceBlob = playlistImageBlob || firstArtworkBlob;
  const palette = useArtworkPalette(coverSourceBlob);
  const dominantColor = useDominantColor(coverSourceBlob);
  const backdropStyle = isLikedView ? likedBackdropStyle() : meshBackdropStyle(palette, dominantColor);

  // query/activeTag are lifted to App.jsx (query, onSetQuery, activeTag,
  // onSetActiveTag) so they survive this component unmounting on a
  // fullscreen/mini round trip — same reason scrollPosRef is lifted, see
  // the scroll-restore effect below.
  const [bulkTagMenu, setBulkTagMenu] = useState(null); // 'add' | 'remove' | null

  // inline playlist-title rename (playlists only — "Imported" isn't a
  // playlist and stays non-editable). Saves through onUpdatePlaylist, the
  // same App.jsx handler PlaylistEditModal uses, so this is never a second
  // save path — just a different entry point that supplies the current
  // description/imageBlob unchanged alongside the new name.
  const [renamingTitle, setRenamingTitle] = useState(false);
  const [renameDraft, setRenameDraft] = useState('');
  const renameCancelledRef = useRef(false);
  const renameInputRef = useRef(null);

  useEffect(() => {
    if (renamingTitle) {
      renameInputRef.current?.focus();
      renameInputRef.current?.select();
    }
  }, [renamingTitle]);

  function startRenaming() {
    if (!isPlaylistView || !onUpdatePlaylist) return;
    renameCancelledRef.current = false;
    setRenameDraft(viewTitle);
    setRenamingTitle(true);
  }

  // the single place that decides whether to save or revert — reached via
  // blur, whether that blur was caused by Enter, Escape, or genuinely
  // clicking/tabbing away, so there's exactly one commit path (see
  // handleTitleKeyDown below, which never saves/cancels directly, only
  // sets the cancelled flag and blurs)
  function commitOrCancelRename() {
    setRenamingTitle(false);
    if (renameCancelledRef.current) return;
    const trimmed = renameDraft.trim();
    // empty or unchanged -> revert without writing (no nameless playlist,
    // no no-op persist call)
    if (!trimmed || trimmed === viewTitle) return;
    onUpdatePlaylist(playlistId, {
      name: trimmed,
      description: playlistDescription,
      imageBlob: playlistImageBlob
    });
  }

  function handleTitleKeyDown(e) {
    if (e.key === 'Enter') {
      e.preventDefault();
      e.stopPropagation();
      e.currentTarget.blur(); // -> commitOrCancelRename via onBlur
    } else if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      renameCancelledRef.current = true;
      e.currentTarget.blur(); // -> commitOrCancelRename sees the cancel flag
    }
  }

  const [dropIndex, setDropIndex] = useState(null);
  const dragIndexRef = useRef(null);
  const bulkAddRef = useRef(null);
  const bulkRemoveRef = useRef(null);
  const scrollRef = useRef(null);
  // full header (state A) collapses toward compact height once the list is
  // scrolled past a threshold. Boolean only — never store the scroll offset
  // in state. 80/40 hysteresis so resting on the boundary doesn't flicker.
  const [shrunk, setShrunk] = useState(false);
  // How many px the FULL header (hero-cover playlists only — see .lib-header
  // in styles.css, `shrunk` only ever combines with `.full`) loses when it
  // collapses: cover 200px -> 64px (.lib-header-cover / .lib-header.shrunk
  // .lib-header-cover) is 136px of it, the rest is the title's font-size
  // drop (40px -> 20px, .lib-header.full .lib-title /
  // .lib-header.full.shrunk .lib-title) plus the description collapsing to
  // nothing (.lib-header.full.shrunk .playlist-hero-desc). Rounded up for
  // safety margin. `.track-list` is `flex: 1` in the same flex column as
  // `.lib-header`, so this whole delta becomes extra clientHeight on the
  // list the instant the header shrinks — see the guard in handleScroll
  // below for why that number matters here specifically. If those CSS rules
  // are ever retuned, bump this to match, or the guard below under/over-
  // corrects. (Measuring it live was considered instead of hardcoding it:
  // rejected because the very first shrink of a session has nothing to
  // measure yet — the shrunk height isn't known until a shrink has already
  // happened once — so a hardcoded fallback would be needed regardless, and
  // the header's box model is otherwise fixed pixel values, not
  // content-dependent, so a hardcoded constant isn't fighting real runtime
  // variability the way it might elsewhere.)
  const HEADER_SHRINK_DELTA = 180;
  // identity of the currently-shown TRACK ORDER: changes on a playlist
  // switch or a sort change, resetting scroll to top — but NOT on a
  // list<->grid toggle, which shows the same tracks in the same order and
  // should keep your place (see the viewMode-specific effect below instead).
  const listKey = `${isLikedView ? 'liked' : isPlaylistView ? playlistId : 'imported'}|${sort}|${sortDir}`;
  const prevListKeyRef = useRef(listKey);
  // list rows and grid tiles have very different heights, so a raw scrollTop
  // carried over from one to the other lands somewhere arbitrary. Captured
  // here, during render, because by the time any effect for this commit runs
  // the DOM has already been mutated to the new view's content — there's no
  // post-commit hook (no getSnapshotBeforeUpdate for function components)
  // that still sees the old content's scrollHeight.
  const prevViewModeRef = useRef(viewMode);
  const pendingScrollRatioRef = useRef(null);
  if (viewMode !== prevViewModeRef.current) {
    const el = scrollRef.current;
    if (el) {
      const max = el.scrollHeight - el.clientHeight;
      pendingScrollRatioRef.current = max > 0 ? el.scrollTop / max : 0;
    }
    prevViewModeRef.current = viewMode;
  }

  // App owns the saved position so it survives this component unmounting on a
  // fullscreen/mini toggle. Restore on mount, before paint. handleScroll
  // keeps it current while mounted.
  useLayoutEffect(() => {
    if (scrollRef.current && scrollPosRef?.current != null) {
      scrollRef.current.scrollTop = scrollPosRef.current;
      // match the header to the restored offset so returning from
      // fullscreen/mini onto a scrolled list doesn't flash the tall header
      setShrunk(scrollPosRef.current > 80);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  // a different list or layout starts at the top (the container DOM node is
  // reused across these, so it has to be reset explicitly)
  useLayoutEffect(() => {
    if (prevListKeyRef.current === listKey) return; // mount / no real change
    prevListKeyRef.current = listKey;
    if (scrollRef.current) scrollRef.current.scrollTop = 0;
    if (scrollPosRef) scrollPosRef.current = 0;
    // a switched-to view starts at scrollTop 0 — don't inherit the previous
    // view's collapsed header
    setShrunk(false);
  }, [listKey, scrollPosRef]);
  // a list<->grid toggle restores the PROPORTIONAL position captured above,
  // before paint, so there's no visible jump. Deliberately does not touch
  // `shrunk` — leaving it alone (rather than the listKey effect's hard
  // setShrunk(false)) is what keeps the header correctly collapsed across
  // the toggle; the native scroll event this triggers re-settles it through
  // the normal handleScroll hysteresis if the new position warrants it.
  useLayoutEffect(() => {
    const ratio = pendingScrollRatioRef.current;
    if (ratio == null) return;
    pendingScrollRatioRef.current = null;
    const el = scrollRef.current;
    if (!el) return;
    const max = el.scrollHeight - el.clientHeight;
    el.scrollTop = max > 0 ? ratio * max : 0;
    if (scrollPosRef) scrollPosRef.current = el.scrollTop;
  }, [viewMode, scrollPosRef]);

  // Z is the only thing that ever centers a track — App.jsx's
  // handleExpandTrack does that scroll directly (a synchronous DOM query +
  // scrollIntoView, not a React effect), so nothing here needs to watch
  // expandedTrackId for scrolling. This component only needs expandedTrackId
  // to tell TrackItem which row to render expanded.
  function handleScroll(e) {
    if (scrollPosRef) scrollPosRef.current = e.currentTarget.scrollTop;
    const el = e.currentTarget;
    const y = el.scrollTop;
    setShrunk((prev) => {
      if (!prev && y > 80) {
        // Would shrinking right now immediately clamp scrollTop back below
        // the un-shrink threshold? `.track-list` is `flex: 1` alongside
        // `.lib-header` (see HEADER_SHRINK_DELTA above), so a shrink hands
        // the list HEADER_SHRINK_DELTA more clientHeight — shrinking the
        // browser's own max scrollTop (scrollHeight - clientHeight) by the
        // same amount. If that would already put the new max below 40, the
        // browser force-clamps scrollTop there the instant we shrink, which
        // immediately re-triggers the un-shrink branch below, which undoes
        // the clientHeight change, which lets the very next scroll tick
        // cross 80 again — a rapid, sustained oscillation between the two
        // states. Refuse the shrink here instead: it was never going to
        // hold at this scroll position anyway. Re-evaluated fresh on every
        // scroll event (nothing here is "sticky"), so scrolling on to a
        // position with enough room shrinks it normally on the very next
        // event — this never permanently disables shrinking for the list.
        const maxIfShrunk = el.scrollHeight - (el.clientHeight + HEADER_SHRINK_DELTA);
        if (maxIfShrunk < 40) return prev;
        return true;
      }
      if (prev && y < 40) return false;
      return prev;
    });
  }

  const allTags = useMemo(() => {
    const set = new Set();
    tracks.forEach((t) => t.tags.forEach((tag) => set.add(tag)));
    return Array.from(set).sort();
  }, [tracks]);

  // search + tag filter. Playlist views keep their manual order; the Imported
  // view keeps the newest-first order it arrives in.
  const visibleTracks = useMemo(() => {
    const q = query.toLowerCase();
    return tracks.filter((t) => {
      const matchesQuery =
        !q ||
        t.artist.toLowerCase().includes(q) ||
        t.title.toLowerCase().includes(q) ||
        (t.versions || []).some((v) => v.title && v.title.toLowerCase().includes(q));
      const matchesTag = !activeTag || t.tags.includes(activeTag);
      return matchesQuery && matchesTag;
    });
  }, [tracks, query, activeTag]);

  // drag-reorder only under the "Custom" sort (library or playlist), and not
  // while a search/tag filter or grid view is on
  const reorderEnabled = !query && !activeTag && viewMode === 'list' && sort === 'custom';

  const totalSeconds = useMemo(
    () => visibleTracks.reduce((sum, t) => sum + (t.duration || 0), 0),
    [visibleTracks]
  );

  const {
    selectedIds,
    setSelectedIds,
    clearSelection,
    onItemMouseDown,
    onItemMouseOver,
    onItemClick
  } = useListSelection(() => visibleTracks.map((t) => t.id));

  // clear selection when the view changes out from under it
  useEffect(() => {
    clearSelection();
  }, [viewTitle, isPlaylistView, clearSelection]);

  function handleClick(id, e) {
    if (onItemClick(id, e) === 'plain') onSelectTrack(id);
  }

  // right-click target: the whole selection if the clicked row is part of a
  // multi-selection, otherwise just that one track (in list order)
  function menuTargets(trackId) {
    if (selectedIds.has(trackId) && selectedIds.size > 1) {
      return visibleTracks.filter((t) => selectedIds.has(t.id)).map((t) => t.id);
    }
    return [trackId];
  }

  // a row's own `+ tag` menu: if that row is part of a multi-selection, the
  // pick lands on every selected track, otherwise just that one
  function handleRowAddTag(trackId, tag) {
    menuTargets(trackId).forEach((id) => onAddTag(id, tag));
  }

  // the row's "+" queue button — same "whole selection vs. just this row"
  // logic as menuTargets above: queues every selected track (in displayed
  // order, since menuTargets/visibleTracks preserve that) if the clicked
  // row is part of the current selection, otherwise just that one row.
  function handleRowAddToQueue(trackId) {
    menuTargets(trackId).forEach((id) => onAddToQueue(id));
  }

  // the heart (list + grid) and the right-click Like/Unlike item — same
  // "whole selection vs. just this row" logic as menuTargets above. The new
  // state is the OPPOSITE of the clicked row's own current liked state,
  // applied uniformly to every targeted track (so liking a mixed selection
  // via the row you clicked doesn't leave some tracks toggled the other way).
  function handleRowToggleLiked(trackId) {
    const clicked = visibleTracks.find((t) => t.id === trackId);
    const nextLiked = !clicked?.liked;
    menuTargets(trackId).forEach((id) => onToggleLiked(id, nextLiked));
  }

  // the row's "×" button — same "whole selection vs. just this row" logic
  // as the right-click menu (menuTargets above), so deleting/removing via
  // × while several tracks are highlighted acts on all of them, not just
  // the one row you happened to click
  function handleRowDelete(trackId) {
    const ids = menuTargets(trackId);
    const many = ids.length > 1;
    if (isPlaylistView) {
      // × just takes the song(s) out of THIS playlist — stays in the
      // library, so no confirm (matches the single-track behavior before)
      ids.forEach((id) => onRemoveTrackFromPlaylist(playlistId, id));
      setSelectedIds(new Set());
      return;
    }
    const label = many ? `${ids.length} tracks` : `"${visibleTracks.find((t) => t.id === trackId)?.title}"`;
    if (confirm(`Delete ${label} from your library? This can't be undone.`)) {
      ids.forEach((id) => onDeleteTrack(id));
      setSelectedIds(new Set());
    }
  }

  function openTrackMenu(e, trackId) {
    e.preventDefault();
    const ids = menuTargets(trackId);
    const many = ids.length > 1;
    const label = many ? `${ids.length} tracks` : 'track';

    const addToPlaylistSub = [
      ...playlists.map((pl) => ({
        label: pl.name,
        onClick: () => {
          onAddTracksToPlaylist(pl.id, ids);
          setSelectedIds(new Set());
        }
      })),
      ...(playlists.length ? [{ separator: true }] : []),
      {
        label: 'New playlist…',
        onClick: () => {
          onPrompt({
            title: `New playlist from ${ids.length} ${ids.length === 1 ? 'track' : 'tracks'}`,
            placeholder: 'Playlist name',
            onSubmit: (name) => {
              onCreatePlaylistWithTracks(name, ids);
              setSelectedIds(new Set());
            }
          });
        }
      }
    ];

    // label reflects the CLICKED row's own state (not a per-selection mix) —
    // same convention "many" already uses elsewhere in this menu
    const clickedLiked = !!visibleTracks.find((t) => t.id === trackId)?.liked;
    const likeLabel = clickedLiked
      ? many
        ? `Unlike ${label}`
        : 'Unlike'
      : many
        ? `Like ${label}`
        : 'Like';

    const items = [];
    if (!many) items.push({ label: 'Play', onClick: () => onPlayTrack(trackId) });
    items.push({ label: likeLabel, onClick: () => handleRowToggleLiked(trackId) });
    if (!many && onAddVersion) {
      items.push({ label: 'Add version…', onClick: () => onAddVersion(trackId) });
      items.push({ label: 'Versions & notes…', onClick: () => onOpenVersions(trackId) });
    }
    // Edit cover works on the whole selection (ids, from menuTargets above)
    // when the clicked row is part of one — unlike Add version / Versions &
    // notes above, which stay single-track only.
    if (onEditCover) {
      items.push({ label: many ? `Edit cover… (${label})` : 'Edit cover…', onClick: () => onEditCover(ids) });
    }
    if ((!many && onAddVersion) || onEditCover) items.push({ separator: true });
    items.push({
      label: many ? `Add ${label} to queue` : 'Add to queue',
      onClick: () => {
        ids.forEach((id) => onAddToQueue(id));
        setSelectedIds(new Set());
      }
    });
    items.push({ label: `Add ${many ? label + ' ' : ''}to playlist`, submenu: addToPlaylistSub });
    if (isPlaylistView) {
      items.push({
        label: 'Remove from this playlist',
        onClick: () => {
          ids.forEach((id) => onRemoveTrackFromPlaylist(playlistId, id));
          setSelectedIds(new Set());
        }
      });
    }
    items.push({ separator: true });
    items.push({
      label: many ? `Delete ${label} from library` : 'Delete from library',
      danger: true,
      onClick: () => {
        if (confirm(`Delete ${many ? ids.length + ' tracks' : `"${visibleTracks.find((t) => t.id === trackId)?.title}"`} from your library? This can't be undone.`)) {
          ids.forEach((id) => onDeleteTrack(id));
          setSelectedIds(new Set());
        }
      }
    });

    onOpenMenu({ x: e.clientX, y: e.clientY, items });
  }

  function finalizeReorder() {
    const from = dragIndexRef.current;
    const before = dropIndex;
    dragIndexRef.current = null;
    setDropIndex(null);
    if (from === null || before === null) return;
    if (before === from || before === from + 1) return;
    if (isPlaylistView) onReorderPlaylistTracks(playlistId, from, before);
    else onReorderLibrary(from, before);
  }

  function handleBulkDelete() {
    if (confirm(`Delete ${selectedIds.size} selected tracks? This can't be undone.`)) {
      selectedIds.forEach((id) => onDeleteTrack(id));
      setSelectedIds(new Set());
    }
  }
  function handleBulkQueue() {
    visibleTracks.forEach((t) => selectedIds.has(t.id) && onAddToQueue(t.id));
    setSelectedIds(new Set());
  }
  const selectedInOrder = () => visibleTracks.filter((t) => selectedIds.has(t.id)).map((t) => t.id);

  // every tag currently on at least one selected track (for the bulk "− tag"
  // menu). Recomputed live, so as tags are removed the menu shrinks.
  const selectionTags = useMemo(() => {
    const set = new Set();
    visibleTracks.forEach((t) => {
      if (selectedIds.has(t.id)) t.tags.forEach((tg) => set.add(tg));
    });
    return [...set].sort();
  }, [visibleTracks, selectedIds]);

  function bulkAddTag(tag) {
    selectedInOrder().forEach((id) => onAddTag(id, tag));
  }
  function bulkRemoveTag(tag) {
    selectedInOrder().forEach((id) => onRemoveTag(id, tag));
  }

  // one header, three visual states:
  //   FULL    — a playlist with cover art (its own image, or a track mosaic)
  //   COMPACT — Imported, or a playlist whose tracks have no artwork at all
  //   SHRUNK  — FULL after the list is scrolled past the threshold
  const isFullHeader = isLikedView || (isPlaylistView && (!!playlistImageBlob || distinctCount > 0));
  // play is an action (needs tracks); shuffle is a mode (always available).
  // "whole view" = the unfiltered list, so search / tags never affect playback.
  const viewHasTracks = tracks.length > 0;

  function openHeaderMenu(e) {
    const r = e.currentTarget.getBoundingClientRect();
    onOpenMenu({
      x: r.left,
      y: r.bottom + 4,
      items: [{ label: 'Edit playlist', onClick: onEditPlaylist }]
    });
  }

  const controlRow = (
    <div className="lib-controls">
      <button
        className="lib-play-btn"
        onClick={onPlayPause}
        disabled={!viewHasTracks}
        aria-label={isViewPlaying ? 'pause' : 'play'}
        title={isViewPlaying ? 'pause' : 'play'}
      >
        {isViewPlaying ? '⏸' : '▶'}
      </button>
      <button
        className={`lib-shuffle-btn${shuffleEnabled ? ' active' : ''}`}
        onClick={onToggleShuffle}
        aria-label={shuffleEnabled ? 'shuffle on' : 'shuffle off'}
        aria-pressed={shuffleEnabled}
        title="shuffle"
      >
        <ShuffleIcon />
      </button>
      {onEditPlaylist && (
        <button
          className="lib-overflow-btn"
          onClick={openHeaderMenu}
          aria-label="more"
          title="more"
        >
          ⋯
        </button>
      )}
    </div>
  );

  const viewToggle = (
    <div className="view-toggle">
      <button
        className={viewMode === 'list' ? 'active' : ''}
        onClick={() => onSetViewMode('list')}
        aria-label="list view"
        title="list view"
      >
        ☰
      </button>
      <button
        className={viewMode === 'grid' ? 'active' : ''}
        onClick={() => onSetViewMode('grid')}
        aria-label="grid view"
        title="grid view"
      >
        ▦
      </button>
    </div>
  );

  // sort menu — the library (Imported) and every playlist get "Liked first"
  // alongside the rest. The Liked view gets its own list instead: no Custom
  // order (Liked has no manual trackIds array to reorder — it's a live
  // filter over every liked track, not a container), and "Recently liked" as
  // its default in Custom's usual first slot.
  const SORT_OPTIONS = isLikedView
    ? [
        ['likedAt', 'desc', 'Recently liked'],
        ['likedAt', 'asc', 'Least recently liked'],
        ['added', 'desc', 'Newest first'],
        ['added', 'asc', 'Oldest first'],
        ['artist', 'asc', 'Artist · A–Z'],
        ['artist', 'desc', 'Artist · Z–A']
      ]
    : [
        ['custom', 'desc', 'Custom order'],
        ['added', 'desc', 'Newest first'],
        ['added', 'asc', 'Oldest first'],
        ['artist', 'asc', 'Artist · A–Z'],
        ['artist', 'desc', 'Artist · Z–A'],
        ['liked', 'desc', 'Liked first']
      ];
  const activeSortLabel =
    SORT_OPTIONS.find(([s, d]) => s === sort && (s === 'custom' || s === 'liked' || d === sortDir))?.[2] || 'Sort';

  function openSortMenu(e) {
    const r = e.currentTarget.getBoundingClientRect();
    onOpenMenu({
      x: r.left,
      y: r.bottom + 4,
      items: SORT_OPTIONS.map(([s, d, label]) => {
        const active = s === sort && (s === 'custom' || s === 'liked' || d === sortDir);
        return {
          label: (
            <span className="ctx-label">
              <span className="ctx-check">{active ? '✓' : ''}</span>
              {label}
            </span>
          ),
          onClick: () => onSetSort(s, d)
        };
      })
    });
  }

  const sortControl = onSetSort && (
    <button className="lib-sort-btn" onClick={openSortMenu} title="sort">
      {activeSortLabel}
      <span className="lib-sort-caret" aria-hidden="true">▾</span>
    </button>
  );

  const headerActions = (
    <div className="lib-header-actions">
      {sortControl}
      {viewToggle}
    </div>
  );

  const subtitle = (
    <>
      {visibleTracks.length} {visibleTracks.length === 1 ? 'song' : 'songs'}
      {totalSeconds > 0 && ` · ${formatTotal(totalSeconds)}`}
    </>
  );

  return (
    <div className={`library-list${backdropStyle ? ' has-backdrop' : ''}${isLikedView ? ' liked-view' : ''}`}>
      {backdropStyle && (
        <div
          className={`lib-backdrop${isFullHeader && shrunk ? ' shrunk' : ''}`}
          style={backdropStyle}
        />
      )}

      <div
        className={`lib-header${isFullHeader ? ' full' : ' compact'}${
          isFullHeader && shrunk ? ' shrunk' : ''
        }${backdropStyle ? ' has-backdrop' : ''}`}
      >
        {isFullHeader && !isLikedView && (
          <div
            className={`lib-header-cover${mosaicPattern ? ' mosaic' : ''}`}
            style={
              !mosaicPattern && singleCoverUrl
                ? { backgroundImage: `url(${singleCoverUrl})` }
                : undefined
            }
            role={onEditPlaylist ? 'button' : undefined}
            onClick={onEditPlaylist}
            title={onEditPlaylist ? 'edit playlist' : undefined}
          >
            {mosaicPattern &&
              mosaicPattern.map((idx, i) => (
                <div
                  key={i}
                  className="lib-cover-tile"
                  style={
                    distinctUrls[idx] ? { backgroundImage: `url(${distinctUrls[idx]})` } : undefined
                  }
                />
              ))}
          </div>
        )}
        <div className="lib-header-text">
          {renamingTitle ? (
            <input
              ref={renameInputRef}
              className="lib-title lib-title-input"
              value={renameDraft}
              onChange={(e) => setRenameDraft(e.target.value)}
              onKeyDown={handleTitleKeyDown}
              onBlur={commitOrCancelRename}
              onClick={(e) => e.stopPropagation()}
              maxLength={200}
            />
          ) : (
            <h1
              className={`lib-title${isPlaylistView ? ' lib-title-editable' : ''}`}
              onClick={isPlaylistView ? startRenaming : undefined}
              title={isPlaylistView ? 'click to rename' : undefined}
            >
              {viewTitle}
            </h1>
          )}
          {isFullHeader && playlistDescription && (
            <p className="playlist-hero-desc" title={playlistDescription}>
              {playlistDescription}
            </p>
          )}
          <p className="lib-subtitle">{subtitle}</p>
          {controlRow}
        </div>
        {headerActions}
      </div>

      <input
        ref={searchInputRef}
        className="search-input"
        placeholder="search"
        value={query}
        onChange={(e) => onSetQuery(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            // first Escape clears a query, a second (or Escape on an empty
            // field) drops focus back to the app
            e.stopPropagation();
            if (query) onSetQuery('');
            else e.currentTarget.blur();
          } else if (e.key === 'Enter') {
            // not "submit", not "clear" — just "I'm done typing," so
            // shortcuts (j/k/d/u/z etc.) work again without clicking away.
            // The query itself is untouched.
            e.currentTarget.blur();
          }
        }}
      />

      {allTags.length > 0 && (
        <div className="tag-filter">
          <button className={!activeTag ? 'active' : ''} onClick={() => onSetActiveTag(null)}>
            all
          </button>
          {allTags.map((tag) => (
            <span key={tag} className={`tag-filter-item${activeTag === tag ? ' active' : ''}`}>
              <button className="tag-filter-select" onClick={() => onSetActiveTag(tag)}>
                {tag}
              </button>
              <button
                className="tag-filter-delete"
                onClick={(e) => {
                  e.stopPropagation();
                  if (confirm(`Delete tag "${tag}" from all tracks?`)) {
                    if (activeTag === tag) onSetActiveTag(null);
                    onDeleteTagGroup(tag);
                  }
                }}
                aria-label={`delete tag ${tag}`}
              >
                ×
              </button>
            </span>
          ))}
        </div>
      )}

      {selectedIds.size > 0 && (
        <div className="bulk-bar">
          <span className="bulk-count">{selectedIds.size} selected</span>
          <button
            ref={bulkAddRef}
            className={`bulk-btn${bulkTagMenu === 'add' ? ' active' : ''}`}
            onClick={() => setBulkTagMenu((m) => (m === 'add' ? null : 'add'))}
          >
            + tag
          </button>
          {selectionTags.length > 0 && (
            <button
              ref={bulkRemoveRef}
              className={`bulk-btn${bulkTagMenu === 'remove' ? ' active' : ''}`}
              onClick={() => setBulkTagMenu((m) => (m === 'remove' ? null : 'remove'))}
            >
              − tag
            </button>
          )}
          {bulkTagMenu === 'add' && (
            <TagMenu
              anchorEl={bulkAddRef.current}
              mode="add"
              options={allTags}
              onPick={bulkAddTag}
              onClose={() => setBulkTagMenu(null)}
              note={`adding to ${selectedIds.size} songs`}
            />
          )}
          {bulkTagMenu === 'remove' && (
            <TagMenu
              anchorEl={bulkRemoveRef.current}
              mode="remove"
              options={selectionTags}
              onPick={bulkRemoveTag}
              onClose={() => setBulkTagMenu(null)}
              note={`removing from ${selectedIds.size} songs`}
            />
          )}
          <button className="bulk-btn" onClick={handleBulkQueue}>
            + queue
          </button>
          <button
            className="bulk-btn"
            onClick={(e) =>
              onOpenMenu({
                x: e.clientX,
                y: e.clientY,
                items: [
                  ...playlists.map((pl) => ({
                    label: pl.name,
                    onClick: () => {
                      onAddTracksToPlaylist(pl.id, selectedInOrder());
                      setSelectedIds(new Set());
                    }
                  })),
                  ...(playlists.length ? [{ separator: true }] : []),
                  {
                    label: 'New playlist…',
                    onClick: () => {
                      const ids = selectedInOrder();
                      onPrompt({
                        title: `New playlist from ${ids.length} tracks`,
                        placeholder: 'Playlist name',
                        onSubmit: (name) => {
                          onCreatePlaylistWithTracks(name, ids);
                          setSelectedIds(new Set());
                        }
                      });
                    }
                  }
                ]
              })
            }
          >
            + playlist
          </button>
          <button className="bulk-btn danger" onClick={handleBulkDelete}>
            delete
          </button>
          <button className="bulk-btn" onClick={clearSelection}>
            clear
          </button>
        </div>
      )}

      {viewMode === 'grid' ? (
        <div
          className="track-grid view-swap"
          ref={scrollRef}
          onScroll={handleScroll}
        >
          {visibleTracks.map((track, index) => (
            <GridItem
              key={track.id}
              index={index}
              track={track}
              isActive={track.id === currentTrackId}
              isPlayingTrack={track.id === playingTrackId}
              isPlaying={isPlaying}
              isSelected={selectedIds.has(track.id)}
              onSelect={handleClick}
              onMouseDownItem={onItemMouseDown}
              onMouseOverItem={onItemMouseOver}
              onPlay={onPlayTrack}
              onContextMenu={openTrackMenu}
              onToggleLiked={handleRowToggleLiked}
            />
          ))}
          {visibleTracks.length === 0 && <p className="empty-state">nothing here yet.</p>}
        </div>
      ) : (
        <div
          className="track-list view-swap"
          ref={scrollRef}
          onScroll={handleScroll}
        >
          {visibleTracks.map((track, index) => (
            <div
              key={track.id}
              className="lib-row-wrap"
              data-sel-id={track.id}
              onMouseOver={() => onItemMouseOver(track.id)}
              draggable={reorderEnabled}
              onDragStart={(e) => {
                if (!reorderEnabled) return;
                dragIndexRef.current = index;
                e.dataTransfer.effectAllowed = 'move';
              }}
              onDragOver={(e) => {
                if (!reorderEnabled || dragIndexRef.current === null) return;
                e.preventDefault();
                const rect = e.currentTarget.getBoundingClientRect();
                const before = e.clientY < rect.top + rect.height / 2;
                setDropIndex(before ? index : index + 1);
              }}
              onDrop={(e) => {
                if (!reorderEnabled) return;
                e.preventDefault();
                finalizeReorder();
              }}
              onDragEnd={() => {
                dragIndexRef.current = null;
                setDropIndex(null);
              }}
            >
              {reorderEnabled && dropIndex === index && <div className="lib-drop-line top" />}
              <TrackItem
                track={track}
                position={index + 1}
                isActive={track.id === currentTrackId}
                isPlayingTrack={track.id === playingTrackId}
                isPlaying={isPlaying}
                isExpanded={track.id === expandedTrackId}
                isSelected={selectedIds.has(track.id)}
                onSelect={handleClick}
                onPlay={onPlayTrack}
                onMouseDownTrack={onItemMouseDown}
                onContextMenuTrack={openTrackMenu}
                onAddTag={handleRowAddTag}
                onRemoveTag={onRemoveTag}
                allTags={allTags}
                multiTagCount={
                  selectedIds.has(track.id) && selectedIds.size > 1 ? selectedIds.size : 0
                }
                onRowAction={handleRowDelete}
                inPlaylist={isPlaylistView}
                onAddToQueue={handleRowAddToQueue}
                onToggleLiked={handleRowToggleLiked}
              />
              {reorderEnabled && index === visibleTracks.length - 1 && dropIndex === visibleTracks.length && (
                <div className="lib-drop-line bottom" />
              )}
            </div>
          ))}
          {visibleTracks.length === 0 && <p className="empty-state">nothing here yet.</p>}
        </div>
      )}
    </div>
  );
}

export default memo(LibraryList);
