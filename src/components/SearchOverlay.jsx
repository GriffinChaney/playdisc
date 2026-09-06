import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useObjectUrl } from '../lib/useObjectUrl';

// Raycast/Spotlight-style quick-search (2026-09-06): Option+Space (see
// App.jsx's global keydown effect) opens this over whatever view is
// showing, without touching it. Purely a finding tool — selecting a result
// navigates to it, it never plays anything.
//
// Backdrop/dismiss/focus follow the same shape as SettingsModal
// (modal-overlay + a capture-phase document keydown listener for
// Escape/Cmd+W, stopping propagation on its own dismiss branch so App.jsx's
// global handler never sees it and can't double-handle or fall through to
// closing the window — see the Cmd+W lesson in App.jsx). The panel itself
// looks different on purpose (no header/close button, floats in the upper
// third rather than dead-center) to read as a quick command palette rather
// than a settings-style modal.

// Each group capped independently (not one global cap) so a broad query
// can't let one category (usually tracks, since there are far more of them
// than playlists or artists) crowd out the other two entirely. 8 keeps a
// group short enough to scan at a glance — well under what Cmd+1-9 can
// reach anyway — while still comfortably covering real queries against a
// ~190-track library; the panel scrolls if a query is broad enough to still
// overflow across all three groups, so nothing beyond the cap is silently
// unreachable, just not one of the fast-jump slots.
const RESULTS_PER_GROUP = 8;

// Imported and Liked Songs (2026-09-06) are grouped with playlists — same
// "thing you navigate to" as any playlist, just not user-created — under
// one relabeled header. "Playlists" stopped fitting once it held two
// things that aren't playlists; "Views" reads correctly for all three
// (Imported, Liked Songs, and every real playlist) without implying they're
// user-created. GROUP_LABELS keys are these merged group ids, not raw
// result types — see groupOf() below for the type -> group mapping.
const GROUP_LABELS = { track: 'Tracks', view: 'Views', artist: 'Artists' };
function groupOf(type) {
  return type === 'track' ? 'track' : type === 'artist' ? 'artist' : 'view';
}

// Match strength within a group, weakest last — an exact or prefix match on
// a view/playlist name should rank above one that merely contains the
// query, so typing "liked" surfaces "Liked Songs" ahead of some unrelated
// playlist whose name happens to contain those letters. Tracks/artists
// don't need this (they're typically searched by a short fragment of a
// longer title/name, where "contains" IS the normal case), so it's only
// applied to the merged Views group below.
function matchRank(name, q) {
  const n = name.toLowerCase();
  if (n === q) return 0;
  if (n.startsWith(q)) return 1;
  return 2;
}

function ResultThumb({ result }) {
  // Tracks and playlists-with-a-cover get a real thumbnail (same fallback
  // glyph as everywhere else in the app — TrackItem's .track-thumb /
  // .thumb-fallback); artists, Imported, and Liked Songs have no image
  // source in the data model at all, so those rows just skip the thumb
  // column rather than inventing a placeholder graphic for them.
  const blob = result.type === 'track' ? result.artworkBlob : result.type === 'playlist' ? result.imageBlob : null;
  const url = useObjectUrl(blob);
  if (result.type !== 'track' && result.type !== 'playlist') return null;
  return (
    <div className="search-result-thumb" style={url ? { backgroundImage: `url(${url})` } : undefined}>
      {!url && <span className="thumb-fallback">♪</span>}
    </div>
  );
}

export default function SearchOverlay({ tracks, playlists, onSelectResult, onClose }) {
  const [query, setQuery] = useState('');
  const [highlightedIndex, setHighlightedIndex] = useState(0);
  const inputRef = useRef(null);
  const resultRefs = useRef([]);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // There's no artist entity in the data model (see CLAUDE.md) — built here
  // as the distinct set of non-empty track artists, case-insensitively
  // deduped (first-seen casing wins), with a track count for the subtitle.
  const artists = useMemo(() => {
    const map = new Map();
    for (const t of tracks) {
      const name = (t.artist || '').trim();
      if (!name) continue;
      const key = name.toLowerCase();
      const entry = map.get(key);
      if (entry) entry.count += 1;
      else map.set(key, { name, count: 1 });
    }
    return [...map.values()];
  }, [tracks]);

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    const trackResults = tracks
      .filter((t) => t.title?.toLowerCase().includes(q) || t.artist?.toLowerCase().includes(q))
      .slice(0, RESULTS_PER_GROUP)
      .map((t) => ({
        type: 'track',
        id: t.id,
        primary: t.title || 'Untitled',
        secondary: t.artist || 'Unknown artist',
        artworkBlob: t.artworkBlob
      }));
    // Imported/Liked Songs are synthetic entries, not real playlist
    // records — same result shape otherwise so they slot into the merged,
    // ranked Views group below exactly like a playlist does.
    const builtinViews = [
      { type: 'imported', id: 'imported', name: 'Imported', count: tracks.length },
      { type: 'liked', id: 'liked', name: 'Liked Songs', count: tracks.filter((t) => t.liked).length }
    ]
      .filter((v) => v.name.toLowerCase().includes(q))
      .map((v) => ({
        type: v.type,
        id: v.id,
        primary: v.name,
        secondary: `${v.count} track${v.count === 1 ? '' : 's'}`
      }));
    const playlistResults = playlists
      .filter((p) => p.name?.toLowerCase().includes(q))
      .map((p) => ({
        type: 'playlist',
        id: p.id,
        primary: p.name,
        secondary: `${p.trackIds.length} track${p.trackIds.length === 1 ? '' : 's'}`,
        imageBlob: p.imageBlob
      }));
    // stable sort (V8/JS engines guarantee this) — ties keep their relative
    // order (builtins before playlists, then each in their own order) so
    // rank only ever promotes a strong match, never reshuffles equal ones
    const viewResults = [...builtinViews, ...playlistResults]
      .sort((a, b) => matchRank(a.primary, q) - matchRank(b.primary, q))
      .slice(0, RESULTS_PER_GROUP);
    const artistResults = artists
      .filter((a) => a.name.toLowerCase().includes(q))
      .slice(0, RESULTS_PER_GROUP)
      .map((a) => ({
        type: 'artist',
        id: a.name,
        name: a.name,
        primary: a.name,
        secondary: `${a.count} track${a.count === 1 ? '' : 's'}`
      }));
    return [...trackResults, ...viewResults, ...artistResults];
  }, [query, tracks, playlists, artists]);

  // First result highlighted by default (so Enter works immediately after
  // typing) — reset on every query change, not on every `results` change,
  // since the underlying library can change too (schemaless-field patches,
  // etc.) without that meaning "start over."
  useEffect(() => {
    setHighlightedIndex(0);
  }, [query]);

  const safeIndex = Math.min(highlightedIndex, Math.max(0, results.length - 1));

  useEffect(() => {
    resultRefs.current[safeIndex]?.scrollIntoView({ block: 'nearest' });
  }, [safeIndex]);

  function selectResult(result) {
    onSelectResult(result);
    onClose();
  }

  // Capture phase, same as SettingsModal's own keydown effect and for the
  // same reason: this has to run and (on its dismiss branch) stopPropagation
  // BEFORE App.jsx's bubble-phase global handler ever sees the event —
  // that handler already short-circuits entirely while this overlay is open
  // (searchOverlayOpen, mirroring settingsOpen), so in practice this is the
  // only thing that can close it. Plain typing keys are deliberately left
  // alone (no preventDefault/stopPropagation) so they just reach the input's
  // own onChange normally.
  useEffect(() => {
    function handleKeyDown(e) {
      const isDismiss = e.key === 'Escape' || ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'w');
      if (isDismiss) {
        e.preventDefault();
        e.stopPropagation();
        onClose();
        return;
      }
      if (e.key === 'ArrowDown') {
        if (!results.length) return;
        e.preventDefault();
        e.stopPropagation();
        setHighlightedIndex((i) => Math.min(results.length - 1, i + 1));
        return;
      }
      if (e.key === 'ArrowUp') {
        if (!results.length) return;
        e.preventDefault();
        e.stopPropagation();
        setHighlightedIndex((i) => Math.max(0, i - 1));
        return;
      }
      if (e.key === 'Enter') {
        const target = results[safeIndex];
        if (!target) return;
        e.preventDefault();
        e.stopPropagation();
        selectResult(target);
        return;
      }
      if ((e.metaKey || e.ctrlKey) && /^[1-9]$/.test(e.key)) {
        const target = results[Number(e.key) - 1];
        if (!target) return;
        e.preventDefault();
        e.stopPropagation();
        selectResult(target);
      }
    }
    document.addEventListener('keydown', handleKeyDown, true);
    return () => document.removeEventListener('keydown', handleKeyDown, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [results, safeIndex]);

  let lastGroup = null;

  return createPortal(
    <div className="modal-overlay modal-overlay-blur search-overlay" onMouseDown={onClose}>
      <div className="search-palette" onMouseDown={(e) => e.stopPropagation()}>
        <input
          ref={inputRef}
          className="search-palette-input"
          placeholder="Search tracks, playlists, artists…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        {query.trim() === '' ? (
          <div className="search-palette-empty">Search your library</div>
        ) : results.length === 0 ? (
          <div className="search-palette-empty">No results for “{query.trim()}”</div>
        ) : (
          <div className="search-palette-results">
            {results.map((result, i) => {
              const group = groupOf(result.type);
              const showHeader = group !== lastGroup;
              lastGroup = group;
              return (
                <div key={`${result.type}-${result.id}`}>
                  {showHeader && <div className="search-group-label">{GROUP_LABELS[group]}</div>}
                  <div
                    ref={(el) => (resultRefs.current[i] = el)}
                    className={`search-result-row${i === safeIndex ? ' highlighted' : ''}`}
                    onMouseEnter={() => setHighlightedIndex(i)}
                    onClick={() => selectResult(result)}
                  >
                    <ResultThumb result={result} />
                    <div className="search-result-text">
                      <span className="search-result-primary">{result.primary}</span>
                      <span className="search-result-secondary">{result.secondary}</span>
                    </div>
                    {i < 9 && <span className="search-result-shortcut">⌘{i + 1}</span>}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>,
    document.body
  );
}
