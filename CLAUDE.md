# CLAUDE.md — Sona

Permanent project knowledge for Claude Code. Read this before changing anything.
For what's currently in progress, broken, or next, see `docs/PROJECT_STATE.md`.

## What Sona is

A local-file desktop music player, built as an Electron + React app for macOS.
User uploads audio files (mp3/wav/flac/m4a/aac/ogg) from disk; Sona parses ID3-style
metadata (title/artist/duration/embedded artwork), stores everything in IndexedDB, and
plays it back with a custom-rendered, color-reactive waveform. It is explicitly **not**
a streaming platform — no catalog, no accounts, no backend. Local files only.

The user (Griffin) is iterating on this conversationally, screenshot by screenshot,
usually testing the **packaged app in `/Applications/Sona.app`**, not just the dev
build. He tracks his own backlog of requests/bugs in a macOS Reminders list; when he
pastes a screenshot of it, those are real asks to work through, not fluff.

## Stack

- **React 18** (function components, hooks, no external state library — all state
  lives in `App.jsx` and flows down via props)
- **Vite 5** for dev server / bundling
- **Electron 31**, packaged with **electron-builder**
- **wavesurfer.js 7** for waveform rendering/playback engine
- **music-metadata-browser** for ID3/atom tag + embedded artwork parsing
- **idb** (thin IndexedDB wrapper) for local persistence
- No TypeScript, no CSS framework — plain CSS in `src/styles.css` using CSS custom
  properties for theming

## Directory layout

```
music-player-app/
├── electron/
│   ├── main.js        # main process: window creation, mini-mode IPC handlers
│   └── preload.cjs     # contextBridge: exposes window.electronAPI (MUST stay .cjs)
├── src/
│   ├── App.jsx          # ALL app state and orchestration lives here
│   ├── main.jsx          # React entry point; Buffer polyfill lives here (critical, see below)
│   ├── styles.css        # single global stylesheet, CSS variables for theming
│   ├── components/
│   │   ├── PlaylistNav.jsx    # LEFT column of the library view: Imported item, playlist list (edit / pin / rename / delete via right-click), + new playlist, then QueuePanel + HistoryPanel, resize handle
│   │   ├── PlaylistEditModal.jsx  # centered modal: playlist name + optional description + optional cover image (picker or drag-drop)
│   │   ├── LibraryList.jsx    # MIDDLE column: header (title/count/time), list⇄grid toggle, search, tag filter, multi-select + bulk bar, track list or grid, drag-reorder (playlist views), track right-click menu
│   │   ├── QueuePanel.jsx     # "up next" panel w/ drag-reorder (was inline in old Sidebar)
│   │   ├── HistoryPanel.jsx   # "recently played" collapsible panel (was inline in old Sidebar)
│   │   ├── ContextMenu.jsx    # reusable right-click menu (controlled: App holds `contextMenu` state, renders one instance); supports one level of submenu
│   │   ├── TagMenu.jsx        # combobox popover for applying/removing tags (portal, position:fixed, flips up near the bottom); used by TrackItem's `+ tag` and the bulk bar's `+ tag` / `− tag`
│   │   ├── TrackItem.jsx      # one row in the track list
│   │   ├── UploadButton.jsx   # file picker
│   │   ├── NowPlaying.jsx     # RIGHT column of the library view (artwork + waveform + transport)
│   │   ├── FocusView.jsx      # fullscreen "focus mode" view
│   │   ├── MiniPlayer.jsx     # content shown when the OS window is shrunk to mini mode
│   │   ├── BackgroundPlayBar.jsx  # floating pill shown when browsing ≠ playing track
│   │   ├── Waveform.jsx       # owns the single WaveSurfer instance; heatmap + EQ bars
│   │   ├── WaveformSlot.jsx   # reparents the shared waveform DOM node into whichever view needs it
│   │   ├── SettingsModal.jsx  # theme toggle + keybinding editor
│   │   └── VolumeIcon.jsx     # flat inline-SVG speaker glyph (no emoji)
│   └── lib/
│       ├── db.js              # IndexedDB CRUD (idb wrapper)
│       ├── parseTrack.js      # File -> track record (metadata + artwork extraction)
│       ├── useObjectUrl.js    # hook: Blob -> object URL, auto-revoked
│       ├── keybindings.js     # DEFAULT_KEYBINDINGS, load/save/format helpers
│       └── artworkTilt.js     # shared mouse-tilt handlers for album art
├── vite.config.js        # dev server port 5173; ignores release/ in the watcher
├── index.html             # <title>Sona</title>
└── package.json           # name: "sona", productName: "Sona"
```

## How to build / run

```bash
npm run electron:dev      # vite dev server + electron pointed at localhost:5173
npm run electron:build    # vite build + electron-builder -> release/mac-arm64/Sona.app
```

**Always fully restart** `electron:dev` (kill both processes, don't rely on HMR) after
touching anything in `electron/` (main.js, preload.cjs) — Electron's main process does
not hot-reload. Frontend-only changes (`src/**`) hot-reload fine via Vite, but if
several files changed or state feels stale, a fresh restart is cheap and safer than
debugging an HMR ghost.

### macOS code-signing gotcha (do this every rebuild)

electron-builder does **not** sign the app (no paid Apple Developer certificate
configured), which corrupts/omits the code signature enough that Gatekeeper shows
**"[App] will damage your computer"** — a hard block, not the milder "unidentified
developer" prompt. Fix every time after `electron:build`:

```bash
codesign --sign - --force --deep "release/mac-arm64/Sona.app"
```

This produces a valid ad-hoc signature (`Sealed Resources` present) that Gatekeeper
accepts for local execution. The user has established this workflow: rebuild → re-sign
→ quit the running app → replace `/Applications/Sona.app` → relaunch. He explicitly
asked me to do the `/Applications` replacement directly (not just hand him the file) —
that consent was scoped to this specific rebuild-and-replace loop for this app.

### Vite watcher gotcha

`release/` (electron-builder's output) sits inside the project root. Without
`server.watch.ignored: ['**/release/**']` in `vite.config.js`, Vite's dev server picks
up the packaged output as source changes and triggers spurious full-page reloads.
Already fixed — don't remove that config.

## Electron process architecture

- `electron/main.js`: creates a single `BrowserWindow`, `titleBarStyle: 'hiddenInset'`
  (traffic lights inset over content, no title-bar strip — this is why `.sidebar` and
  `.back-btn` have extra top padding, to clear the traffic-light hit area).
- `electron/preload.cjs`: **must stay `.cjs`**, not `.js`. `package.json` has
  `"type": "module"`, so a plain `.js` preload gets loaded as ESM and Electron's
  preload context throws `Cannot use import statement outside a module`. `.cjs`
  forces CommonJS regardless of the package type field. Preload uses
  `contextBridge.exposeInMainWorld('electronAPI', {...})` with `contextIsolation: true`,
  `nodeIntegration: false`.
- IPC bridge (`window.electronAPI`) currently exposes exactly two things, both for
  mini-player mode:
  - `enterMiniMode(width, height)` → `ipcRenderer.send('enter-mini-mode', {...})`
  - `exitMiniMode()` → `ipcRenderer.send('exit-mini-mode')`
  Main process remembers the pre-mini `getBounds()` in a module-level
  `boundsBeforeMini` variable and restores it on exit. Mini mode **really resizes the
  OS window** (`win.setBounds`, `win.setResizable(false)`, temporarily shrinks
  `setMinimumSize`) — it is not a fake widget floating inside the full-size window.
  This was a deliberate correction after the first mini-player implementation (an
  in-window widget) was explicitly rejected by the user as leaving "a huge big grey
  empty box."
- Console forwarding: `win.webContents.on('console-message', ...)` pipes all renderer
  `console.*` output to the terminal running `electron:dev`, regardless of whether
  DevTools is open. DevTools no longer auto-opens on launch (was previously
  `openDevTools()` unconditionally in dev — removed because the user didn't want it
  popping up every run). Open manually with Cmd+Option+I when needed; the console
  forwarding means you often don't need to.

## State architecture (`App.jsx`)

All state lives in `App.jsx`; components are close to pure props-in/callbacks-out.
No context, no external store. Key state and *why* it's shaped this way:

### `currentTrackId` vs `playingTrackId` — the most important distinction in the app

- `currentTrackId`: the track shown in the main panel (what the user is *browsing*).
- `playingTrackId`: the track actually loaded into the audio engine (what's *playing*).

These are deliberately decoupled. Single-clicking a track in the sidebar only changes
`currentTrackId` (pure browse, zero effect on playback). Double-clicking, pressing
play while browsing a different track, skip, and natural track-finish all go through
`handleAdoptAndPlay(id, { autoPlay })`, which sets both.

`audioUrl` (fed to the single `<Waveform>`) is derived from `playingTrackId`, **never**
`currentTrackId`. This is why browsing doesn't interrupt playback: the audio engine's
props never change just because you're looking at something else.

When `currentTrackId !== playingTrackId`:
- `NowPlaying`/`FocusView` show the browsed track's artwork/title, but overlay
  `"press play to switch playback to this track"` on top of the waveform area
  (`isCurrentlyPlayingTrack` prop) instead of showing a mismatched waveform.
- `BackgroundPlayBar` appears (bottom-center, or bottom-center-of-content-area when
  the sidebar is showing — see CSS section) showing the actually-playing track with
  its own mini play/pause and a small reactive pixel meter, so playback stays
  reachable without forcing navigation back to it.
- The play/pause icon shown to the user reflects `isPlaying && isViewingPlayingTrack`
  (a derived value), not raw `isPlaying` — so it always shows ▶ when you're looking at
  something that isn't currently sounding, even if something else is playing in the
  background.

### Single shared WaveSurfer instance — do not break this

There is exactly **one** `<Waveform>` React component instance for the whole app
lifetime, rendered via `createPortal(<Waveform .../>, waveformHostRef.current)` at the
top of `App.jsx`, where `waveformHostRef.current` is a plain detached `<div>` created
once (`useRef`, lazy-init) and never destroyed.

`NowPlaying`, `FocusView`, and `MiniPlayer` don't render their own `<Waveform>`.
Instead they render `<WaveformSlot host={waveformHost} />`, which on mount does
`containerRef.current.appendChild(host)` — physically moving the *same* DOM node
(containing WaveSurfer's canvases and its internal `<audio>` element) into whatever
layout currently wants to show it.

**Why:** WaveSurfer defaults to the `MediaElement` backend (an actual `<audio>` tag).
Browsers pause an `<audio>` element the instant it's removed from the document. Early
versions of this app conditionally rendered `<Waveform>` per-view (or conditionally
skipped `<WaveformSlot>` based on `isCurrentlyPlayingTrack`), which unmounted the slot,
detached the host node, and silently paused whatever was playing — this was reported
repeatedly as "playback stops/restarts when I switch views" and "clicking another
track pauses what's playing." Root-caused and fixed by:

1. Never conditionally unmounting `<WaveformSlot>`. It is *always* rendered in
   `NowPlaying`/`FocusView`/`MiniPlayer` (the latter renders it `display: none` — that's
   fine, `display: none` does **not** detach from the document, only `removeChild`
   does).
2. Using an absolutely-positioned CSS overlay (`.waveform-placeholder-overlay`,
   `pointer-events: none`, explicit `z-index: 10`, solid non-transparent background) to
   visually hide the waveform when not relevant, instead of removing it from the DOM.

**If you're asked to add a new view/surface that might show the waveform, or to hide
it under some condition, use the overlay pattern — never make `<WaveformSlot>`'s
presence conditional.**

### Library view = 3 columns (`view === 'sidebar'`)

The `'sidebar'` view (the name is now historical — it's the normal/general view)
renders a 3-column CSS grid on `.app`:
`[PlaylistNav | LibraryList | NowPlaying]`, widths `var(--nav-width)` (drag-resizable,
persisted to `localStorage.navWidth`) / `1fr` / `var(--np-width)` (fixed 278px).
**`'focus'` and `'mini'` views are untouched** — `.focus-view` still spans
`grid-column: 1 / -1`, `.mini-player` is still `position: fixed; inset: 0`.

- `activeView`: `{ type: 'imported' }` or `{ type: 'playlist', id }` — which left-nav
  item the middle column shows. "Imported" = the **entire library** (newest-first),
  not "songs not in a playlist". Purely a view; never changes `currentTrackId`/
  `playingTrackId`.
- `playlists`: array of `{ id, name, trackIds: string[], pinned, sortIndex, createdAt, updatedAt }`.
  Left-nav order = `pinned desc, sortIndex asc` (`sortIndex` backfills to `createdAt`
  for old records). Drag-reorder in `PlaylistNav` (`handleReorderPlaylists`) renumbers
  the dragged item's group (pinned vs unpinned) by 1000s; you can't drag across that
  boundary.
  A playlist is just an **ordered list of track ids** — deleting one never touches the
  tracks. Stored in a new IndexedDB store `playlists` (**DB_VERSION bumped 1→2**; the
  `upgrade` callback is now `oldVersion`-guarded so existing v1 dbs migrate cleanly).
  Every mutation writes the whole record through via `persistPlaylist` /
  `putPlaylist`. `handleDeleteTrack` also prunes the id from every playlist.
- `libraryViewMode`: `'list' | 'grid'`, persisted to `localStorage.libraryViewMode`.
  Toggled by the `toggleLibraryView` keybinding (default `v`) as well as the header
  buttons.
- `npWidth`: right now-playing column width. **`null` = responsive** — auto width
  `max(320, min(1400, round((viewportW - navWidth) * 0.483), avail - 340))`, i.e. the
  right/artwork column and the middle track list split the post-nav space roughly
  evenly (measured to match a screenshot the user signed off on). Becomes a number
  once the user drags the left-edge handle (`.np-resize-handle`), persisted to
  `localStorage.npWidth`. A window-`resize` listener updates `viewportW` and re-clamps
  the pinned widths so the middle track list always keeps ≥300px. `navWidth` default
  is 236. When `navCollapsed` (Tab), `--np-width` is `viewportW / 2` — the track list
  and artwork split the whole window evenly, and `--nav-width` is 0; toggling Tab off
  returns to the responsive value because nothing mutates `npWidth` while collapsed
  (both resize handles are `display:none` then — a live np handle sits mid-window and
  is trivially grabbed by accident, which is exactly how a bad width once got saved).
  There is a **one-time layout reset** at the top of `App.jsx` keyed on
  `localStorage.layoutDefaults` (currently `'v2.4'`): on first run of a new value it
  clears saved `npWidth`/`navWidth` so a stale hand-dragged width can't override a
  re-tuned default. Bump that string whenever the defaults are re-tuned. The
  now-playing + focus artwork/waveform are sized off viewport units so both views
  scale with the window. **Mini mode is fixed-size and unaffected**. Window opens at ~Raycast "Almost Maximize" (work area inset ~3%,
  centered — see `electron/main.js`).
  - `--nav-width` / `--np-width` are **registered via `@property`** (`<length>`) so the
    grid can transition — that's what makes the Tab collapse *slide*. App.jsx feeds
    them **clean px only**; a `vw`/`clamp()` value silently fails registered-property
    validation and the var freezes at `initial-value`. `.app.resizing` kills the
    transition so a drag-resize still tracks 1:1. NOTE: CSS transitions are frozen
    while `document.hidden` — the in-app browser pane is always hidden, so verify
    Tab-slide smoothness in the packaged app, not the dev preview.
- `navCollapsed`: `Tab` (the `toggleNav` keybinding) slides `PlaylistNav` out of view
  in the `'sidebar'` view — grid's `--nav-width` animates to 0 + `.playlist-nav`
  `translateX(-100%)`. `.app.nav-collapsed .library-list` gets extra left padding to
  clear the traffic lights.
- **`window.prompt()` does NOT work in Electron** (throws "not supported"). Anything
  needing a typed string (naming a new playlist) uses `<PromptModal>`, controlled by
  App's `promptConfig` state. `window.confirm()` *is* fine and is still used for
  destructive confirms.
- **Playlist edit** (`PlaylistEditModal.jsx`, App `editingPlaylistId` state): right-
  click a playlist → "Edit…" (Rename stays too). Modal edits name + optional
  `description` + optional `imageBlob` (both new playlist-record fields, no DB
  migration — records are schemaless). Image is downscaled to ≤600px by
  `src/lib/imageResize.js` on pick/drop, stored as a Blob. When the active playlist
  has an image and/or description, `LibraryList` swaps its plain `.lib-header` for a
  `.playlist-hero` band (96px cover + name + 2-line-clamped description + count +
  quick "edit" button); with neither, the header is unchanged. Modal backdrop uses
  `.modal-overlay-blur` (a ~3px `backdrop-filter` on top of the shared scrim). The
  cover box also accepts drag-and-drop; the overlay `preventDefault`s stray drops so
  Electron doesn't navigate to the file.
- `playbackContext`: `{ type: 'library' }` or `{ type: 'playlist', id }`. Set whenever
  a NEW playing track is chosen from the middle column (`handlePlayTrack`,
  `handleTogglePlay` adopting a browsed track, `handlePlayPlaylist`) — derived from
  `activeView` at that moment. `handleSkip` / `handleFinish` traverse
  `orderedContextTracks()` (the playlist's manual order, else library newest-first)
  instead of always library order. This is what makes "next" stay inside a playlist.
- `contextMenu`: `{ x, y, items }` for the single `<ContextMenu>`. `setContextMenu` is
  passed to PlaylistNav (playlist right-click) and LibraryList (track right-click,
  which acts on the whole multi-selection if the clicked row is part of one).
- **Multi-select** (tracks in list *and* grid, and playlists) all goes through
  `src/lib/useListSelection.js`. ⌘/ctrl-drag paints a **range** (anchor → row under
  cursor, rebuilt on every `onMouseOver` + an `elementFromPoint` backstop) so a fast
  drag never skips rows; shift-click extends; plain click clears. Rows carry
  `data-sel-id`. Playlists: Delete/Backspace or right-click "Delete N playlists"
  removes the selection (songs stay in the library). **Press feedback on rows is a
  `filter: brightness()` dip, NOT a `transform: scale()`** — a scale-down shrinks the
  row out from under the cursor and the click lands on empty space (this was the
  "clicks feel inconsistent" bug). Buttons keep the scale-down.
- **Tags** (`TagMenu.jsx`): `+ tag` on a row opens a combobox popover pre-populated
  with every existing tag (`allTags`, computed in `LibraryList` from the current
  view's tracks) — no typing needed; typing narrows, and a non-matching query gets a
  "Create …" row. Picking a tag keeps the menu open (tag several at once); Esc / click
  / scroll closes. Rendered in a portal with `position: fixed` so the scrolling list
  never clips it, and it flips above the button when there's < 240px below. If the
  clicked row is part of a multi-selection, the pick fans out to the whole selection
  (`LibraryList.handleRowAddTag` → `menuTargets`) and the menu shows an "adding to N
  songs" note. The bulk bar has `+ tag` (same menu, `allTags`) and `− tag` (only shown
  when the selection has tags; options = union of tags across selected tracks, removes
  from all). The old inline `<input>`/`window.prompt`-style tag entry is gone.

### Other App.jsx state

- `view`: `'sidebar' | 'focus' | 'mini'` — which top-level layout shows. `'sidebar'`
  is the 3-column library view (see above); it and FocusView are mutually exclusive
  (conditional render, safe because neither owns the waveform DOM node directly —
  `WaveformSlot` re-mounts into whichever is active and reparents the persistent host).
  Mini uses the same pattern via its own `<WaveformSlot>` (hidden).
- `isPlaying`, `currentTime`, `duration`: engine playback state, driven by WaveSurfer
  events (`play`/`pause`/`audioprocess`/`ready`).
  - `currentTime` updates are **throttled to 200ms** via `handleTimeUpdate` in
    `App.jsx` (a `performance.now()`-gated wrapper around `setCurrentTime`). Raw
    `audioprocess` events fire many times a second; without throttling, the entire app
    re-rendered constantly during playback, which manifested as generally "laggy,
    buggy, sometimes needs two clicks" — do not remove this throttle or lower it much
    below 200ms.
- `queue`: array of track IDs, a manually-built play queue. Consumed first (shift off
  the front) by both `handleSkip(1)` and `handleFinish` before falling back to
  library-order traversal. Not persisted across restarts (in-memory only).
- `history` / `historyIndex`: browser-style play-history back/forward stack. Every
  genuinely-new track that starts playing is appended (`{ hid, trackId, playedAt }`);
  `historyIndex` points at the currently-playing entry. `handleSkip(-1)` walks back
  through it, `handleSkip(1)` retraces forward before falling to queue/shuffle/library;
  playing something brand-new while stepped back truncates the forward tail. Persisted
  to `localStorage` (`playHistory`); `historyIndex` always re-inits to the live edge
  (`history.length`) on load. Shown in Sidebar's collapsible "recently played" panel.
  **All history mutations go through `commitHistory(list, pos)` / `setHistoryPos(pos)`
  which set plain values and keep `historyRef`/`historyIndexRef` in lockstep — never a
  `setHistory(prev => …)` updater with ref/setState side effects inside, because
  StrictMode double-invokes updaters and that double-applied the index math (dev-only
  bug: forward tail wasn't truncated on a new play).**
- `navWidth`: width of the left playlist-nav column, persisted to
  `localStorage.navWidth`, applied via CSS var `--nav-width` on `.app` (clamped
  170–340). Drag-resize handled by a `mousemove`/`mouseup` listener pair gated by
  `isResizingSidebarRef`, started via `.sidebar-resize-handle`'s `onMouseDown` (the
  handle lives on PlaylistNav's right edge).
- `volume`: persisted to `localStorage`. Applied via `volumeRef` (not just state)
  because **each track switch recreates the WaveSurfer instance** (see below), which
  resets volume to its default — `handleReady` re-applies `volumeRef.current` on every
  new track load.
- `keybindings`: loaded/saved via `src/lib/keybindings.js`, editable in
  `SettingsModal`. `ArrowLeft`/`ArrowRight` are **hardcoded additional aliases** for
  next/prev in `App.jsx`'s keydown handler (`e.key === 'ArrowRight'` etc., ORed with
  the configurable binding) — they are *not* in `DEFAULT_KEYBINDINGS` and are not
  user-rebindable. This is intentional (user asked for arrows to "also" work) but is
  an inconsistency worth knowing about if the keybinding system is reworked.
- `theme`: `'dark' | 'light'`, persisted to `localStorage`, applied as
  `document.documentElement.dataset.theme`.
- `expandedTrackId`: which track row is "zoomed" (Z key / `expandTrack`),
  Cubase-track-height style. Z is a **follow-mode toggle**, not a per-row toggle: once
  on, an effect keyed on `currentTrackId` keeps the zoom on whatever track you skip /
  browse / finish onto; press Z again to turn it off. The zoomed row shows an info
  strip (a quality badge + chips from `src/lib/audioQuality.js` — codec / sample rate
  / bit depth or bitrate — then size, date added, duration, tag count;
  `.track-expanded-info` in `TrackItem.jsx`) and auto-scrolls into view. This depth
  is **only** in the zoom — the user explicitly wanted the right-hand NowPlaying
  column kept to just title + artist. **That scroll must stay instant**
  (`scrollIntoView({ block: 'nearest' })`, no `behavior: 'smooth'`) — a smooth scroll
  re-targets against the row's own growing height and hard-froze the renderer on
  rapid track changes.

### Track record shape (see `src/lib/db.js`)

```js
{
  id: string,            // crypto.randomUUID()
  title: string,
  artist: string,
  duration: number,      // seconds
  audioBlob: Blob,       // the original file — played as-is, never re-encoded
  artworkBlob: Blob|null,// extracted embedded cover art, if any
  audio: {              // fidelity info from music-metadata (null on parse fail,
    codec, sampleRate,  //   and absent on records imported before 2026-08-27)
    bitrate, bitsPerSample, channels, lossless
  } | null,
  tags: string[],
  dateAdded: number      // epoch ms; sort key for library order
}
```

IndexedDB database name is `"my-music-player"` (stores `"tracks"` and, since
DB_VERSION 2, `"playlists"`) — **not** renamed to `"sona"` when the app was rebranded.
Harmless (it's an internal identifier the user never sees), but don't be surprised
finding it while debugging storage, and don't
"fix" it without checking whether a migration is worth the churn — a rename would
require a migration path or it just creates a second empty database.

## Audio / playback / visualization system

All of this lives in `src/components/Waveform.jsx`.

- **Backend**: WaveSurfer's default `MediaElement` backend (uses a real `<audio>` tag
  internally) — not `WebAudio`. This is *why* the DOM-detachment-pauses-playback issue
  above is real and must be respected.
- **Playback fidelity**: the `<audio>` element plays the imported file's original
  bytes — Sona never transcodes (`parseTrack` stores `audioBlob: file` untouched). So
  playback quality == whatever was imported; a lossless import (FLAC/ALAC/WAV) really
  is lossless out, which is the answer to "better than Spotify" (Spotify tops out at
  320 kbps lossy). The decoded data grabbed on `ready` is only for the visualizer, not
  playback. Don't add a normalize / gain / resample stage without a very good reason.
- **Custom `renderFunction`** (`renderHeatmapBars`): draws every waveform bar's color
  from its *own* amplitude — quiet bars run cool (teal/green), loud bars run hot
  (red/orange), via `amplitudeColor(amplitude)` (HSL hue 150→0 as amplitude rises).
  This bypasses WaveSurfer's built-in `normalize` step, so the function does its own
  peak-scan normalization against the track's own max.
- **Progress/"played" region**: WaveSurfer always re-tints the played region with a
  single flat `progressColor` on a second canvas layered on top of the (always fully
  rendered) base heatmap canvas. This cannot be made to preserve per-bar heatmap
  colors — it's an all-or-nothing recolor by design in wavesurfer.js. Current setting:
  a **theme-aware translucent wash**, computed at creation time from
  `document.documentElement.dataset.theme`:
  - dark: `rgba(255,255,255,0.3)`
  - light: `rgba(0,0,0,0.5)` (needs more contrast against a near-white surface)
  History: started as an opaque white/pink wash (user: "don't like the pink overlay,
  changes color when I scrub") → made fully transparent (user: "now I can't see what's
  played, blends into the background") → landed on the current theme-aware translucent
  version. If touching this again, keep both failure modes in mind — too strong reads
  as "changing color"/jarring, too weak reads as invisible.
- **Pixel-art equalizer strip** (`.waveform-eq`, `EQ_BAR_COUNT = 24`): a *second*,
  independent live visualizer below the waveform, **not** part of the WaveSurfer
  canvas. Driven by its own `requestAnimationFrame` loop (`startEqualizerLoop`),
  throttled to `EQ_UPDATE_INTERVAL_MS = 90` for a deliberately chunky/stepped look
  (not smooth interpolation — that's the point, "pixel art" was explicitly requested
  after a smoother whole-container pulse was tried and called "barely visible"/too
  subtle). Samples a window of the decoded channel data around the current playhead,
  split into per-bar sub-bands, direct DOM style mutation via `eqBarRefs` (no React
  re-render). Started/stopped on WaveSurfer's `play`/`pause` events.
- **Decoded audio access**: on `ready`, grabs `ws.getDecodedData().getChannelData(0)`
  once into `decodedChannelRef`, plus `sampleRateRef` and a scanned `trackPeakRef`
  (max abs sample, used for normalization everywhere in this file). All the reactive
  visual bits (EQ loop, `getAmplitude()`) read from these refs rather than re-decoding.
- **Imperative handle** (via `forwardRef`/`useImperativeHandle`): `play`, `pause`,
  `toggle`, `isPlaying`, `seekTo(fraction)`, `skip(seconds)`, `setVolume`, `getVolume`,
  `getCurrentTime`, `getDuration`, and `getAmplitude()` (single 0..1 loudness reading
  at the current playhead — used by `BackgroundPlayBar`'s mini meter, not just the
  main EQ).
- **Scroll-to-scrub**: `onWheel` on the waveform's wrapper, proportional to
  `e.deltaY` (`skip(-e.deltaY * 0.01)`, clamped to ±2s per event) — deliberately *not*
  a fixed jump, after a flat "3 seconds per wheel event" was reported as too coarse
  for trackpads.
- **Artwork extraction bug (root-caused, fixed)**: `music-metadata-browser` throws
  `ReferenceError: Buffer is not defined` in a real Electron renderer (Node's `Buffer`
  global doesn't exist there — this is the classic gotcha where a Node-derived diagnostic
  script gives a false negative because it runs in real Node, where `Buffer` *is*
  defined). `parseTrack.js`'s `catch` swallows the error and silently falls back to
  filename-only metadata + no artwork, which looked exactly like "this file just has
  no embedded art" until traced via renderer console forwarding. Fixed by importing
  the `buffer` npm polyfill and setting `window.Buffer = window.Buffer || Buffer` in
  `src/main.jsx`, before anything else runs. **Do not remove this** — metadata/artwork
  parsing silently degrades (no error surfaced to the user) without it.

## UI / design philosophy (accumulated from direct feedback)

- **Decoupled browse vs. play** (see above) is a hard product requirement now, not a
  nice-to-have — the user was explicit and repeated this request after the first
  implementation attempt regressed it.
- **Minimal, native-feeling, not skeuomorphic.** Emoji icons were explicitly replaced
  with flat inline SVG (`VolumeIcon.jsx`) after being called "dated." Native OS form
  controls (e.g. a plain `<input type="range">` relying on `accent-color`) were also
  called dated and replaced with a custom-styled slider (thin track, hidden-until-hover
  thumb, Spotify/Apple-influenced).
- **No purple/accent color on neutral chrome.** The app's purple/pink accent
  (`--accent`, `--accent-dim`, and the waveform's violet-to-orange progress gradient)
  is fine on the *waveform* and album-art-adjacent surfaces, but the user explicitly
  asked to remove it from the volume slider and from tag-filter chips in both themes —
  those now use `var(--text-primary)`/neutral grays instead of `var(--accent-dim)`.
  Don't reintroduce purple on generic UI chrome without checking first.
- **Subtle "Apple-like" micro-interactions are wanted broadly**: hover-scale on
  tracks/buttons/inputs (~1.01–1.15x, `transition: transform 0.12–0.15s ease`), a
  cursor-tracking 3D tilt on album art (`src/lib/artworkTilt.js`,
  `perspective(700px) rotateX/rotateY`), and a scale/fade `view-enter` keyframe
  animation applied to `.sidebar`, `.now-playing`, and `.focus-view` on mount (used for
  the fullscreen-toggle and mini-toggle transitions, since those are full
  conditional-unmount swaps rather than the persistent-node pattern used for the
  waveform). The list⇄grid swap reuses `view-enter` on `.track-list`/`.track-grid`
  (`.view-swap`) — they already conditionally unmount on toggle, so no key/reflow
  trick is needed. Grid additionally staggers its tiles in top-left→bottom-right via
  a per-tile `--stagger` delay (`grid-tile-in`, `backwards` fill so the held
  transform doesn't fight `:hover`; capped ~26 tiles so a big library still lands
  fast). Both respect `prefers-reduced-motion`.
- **Escape in the search field** (`LibraryList` `onKeyDown`): first press clears a
  non-empty query, a second press (or Escape on an empty field) blurs it.
- **Everything reactive to music should feel "reactive," not decorative-on-a-timer.**
  Both visualizers (main EQ strip, background-bar mini meter) sample real decoded
  audio amplitude at the current playhead — never a canned/fake animation loop. This
  was explicitly requested after an earlier whole-waveform-container pulse (driven by
  the same real data, just applied as a transform/glow on the whole block) was called
  "barely visible."
- **Real OS behavior over in-app simulation, when asked.** Fullscreen toggle and mini
  mode are both explicitly *not* real OS-level window states (fullscreen is an
  in-window view swap, not `win.setFullScreen()`) — except mini mode, which *is* now a
  real `BrowserWindow` resize, specifically because the fake in-window version was
  rejected. If the user asks for "real" OS behavior for something else (real
  fullscreen, always-on-top, multiple windows), take that literally rather than
  defaulting to a cheaper in-app simulation.
- **Keyboard-first.** Every action added should get a keybinding, and every new
  keybinding should be added to `DEFAULT_KEYBINDINGS` in `src/lib/keybindings.js` so
  it shows up in Settings automatically — the user has repeatedly asked "make sure you
  add all new key commands to my settings menu."

## Things Claude should never break

1. **`<WaveformSlot>` must never be conditionally unmounted** while playback might be
   happening. Hide it with CSS overlays, not conditional rendering. (See "Single
   shared WaveSurfer instance" above.)
2. **`window.Buffer` polyfill in `src/main.jsx`** — removing it silently breaks all
   metadata/artwork parsing with no visible error.
3. **`electron/preload.cjs` must stay `.cjs`**, and `electron/main.js` must reference
   it as `preload.cjs`, not `.js`.
4. **Re-sign after every `electron:build`** (`codesign --sign - --force --deep`)
   before trying to launch the packaged app, or Gatekeeper hard-blocks it.
5. **`vite.config.js`'s `server.watch.ignored: ['**/release/**']`** — removing it
   brings back spurious full-page reloads whenever a packaged build exists on disk.
6. **`currentTime` throttle in `App.jsx`** (`handleTimeUpdate`, 200ms) — don't feed
   raw `audioprocess` events straight into `setCurrentTime` again; it reintroduces the
   "laggy, needs two clicks" complaint.
7. **`audioUrl` must derive from `playingTrackId`, never `currentTrackId`.** This is
   the entire mechanism that keeps browsing from interrupting playback.
8. Don't reintroduce **DevTools auto-open** on launch (`openDevTools()` in
   `main.js`'s `isDev` branch) — explicitly removed at the user's request. Console
   forwarding (`console-message` listener) covers debugging needs without it.
