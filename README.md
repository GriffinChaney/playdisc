# Playdisc

> **Working on this project?** Read [`CLAUDE.md`](CLAUDE.md) for architecture,
> conventions, and things not to break, and
> [`docs/PROJECT_STATE.md`](docs/PROJECT_STATE.md) for current bugs / in-progress
> work before making changes. This README is a lighter intro and may lag behind
> those two.

A personal, local-only music player. You add exactly the songs you want — your
own tracks, friends' mixes, downloads — and nothing else ever shows up. Desktop
app (Electron + React), library stored locally in IndexedDB. No server, no
account, no sync, no catalog.

## What it does

**Library**
- Drag-free multi-file import for `mp3 / wav / flac / m4a / aac / ogg`, with a
  progress overlay and a slide-in confirmation toast
- Automatic ID3 / atom metadata + embedded artwork extraction on import
- Search, per-track tags (inline `+ tag`, plus bulk tag / delete on a selection),
  tag-group filtering
- Multi-select in both list and grid view — ⌘-click, shift-click, ⌘-drag to paint
  a contiguous range — with a floating action bar (queue / add-to-playlist / tag /
  delete)

**Playlists** (three-column library view, Spotify-style)
- **Left** — "Imported" (your whole library) + your playlists. Drag playlists to
  reorder; pin one to the top; rename; ⌘/shift-select several and delete them at
  once. Deleting a playlist never touches the songs.
- **Middle** — the track list for whatever's selected, as a list or an album-art
  grid (`v` toggles); drag to reorder within a playlist. The row `×` removes from the
  current playlist (only deletes from the library in the "Imported" view). Press `z`
  to keep the current track zoomed (with date added / format / size); the zoom
  follows as you skip.
- **Right** — now playing: artwork (click for fullscreen), color-reactive
  waveform, pixel-art EQ, transport
- Add to a playlist by right-clicking a track (or a multi-selection), or the
  `+ playlist` button on the selection bar
- Both side columns are drag-resizable and the layout scales with the window — by
  default the track list and the artwork zone split the space after the nav roughly
  evenly. **Tab** hides the playlist nav and splits the window evenly between the
  track list and the artwork zone. Opens near-maximized.

**Playback**
- Browsing a track (single click) never interrupts what's playing — a floating
  bar keeps the real playing track reachable
- Scrubbable / scroll-to-scrub waveform (wavesurfer.js)
- Manual **queue** ("up next", drag to reorder) consumed before library order
- Browser-style **play history**: Previous / Next walk what you actually played
  (with a "recently played" list you can jump around in); playing from a playlist
  keeps Next inside that playlist
- Shuffle, adjustable volume, fully rebindable keyboard shortcuts (Settings)

**Views**
- Normal 3-column library view, a fullscreen **focus** view (ambient backdrop
  sampled from the cover art), and a real OS-window **mini** mode
- The single audio engine is shared across all views — switching never restarts
  playback

## Setup

```bash
cd playdisc
npm install
npm run electron:dev      # Vite dev server + Electron, hot reload
```

`npm run dev` alone runs it as a plain browser tab (no Electron-only features
like mini mode, but faster to iterate on UI).

### Building the app

```bash
npm run electron:build
codesign --sign - --force --deep "release/mac-arm64/Playdisc.app"
```

The ad-hoc re-sign is required every build — electron-builder doesn't sign
(no paid Apple cert), and unsigned the app hits a hard Gatekeeper block. See
`CLAUDE.md` for the full rebuild → re-sign → replace `/Applications/Playdisc.app`
loop.

## Stack

React 18 (no state library — all state in `App.jsx`), Vite 5, Electron 31
(electron-builder), wavesurfer.js 7, music-metadata-browser, `idb`. Plain CSS
with custom properties, no framework, no TypeScript.

## Project structure

```
electron/
  main.js          # window creation, mini-mode IPC, acceptFirstMouse
  preload.cjs      # contextBridge (must stay .cjs)
src/
  components/
    PlaylistNav.jsx    # left column: Imported + playlists + queue/history panels
    LibraryList.jsx    # middle column: track list / grid, search, tags, bulk bar
    NowPlaying.jsx     # right column: artwork + waveform + transport
    QueuePanel.jsx     HistoryPanel.jsx    ContextMenu.jsx   PromptModal.jsx
    TrackItem.jsx      FocusView.jsx       MiniPlayer.jsx     Waveform.jsx
    WaveformSlot.jsx   BackgroundPlayBar.jsx  SettingsModal.jsx  ...
  lib/
    db.js            # IndexedDB: tracks + playlists stores (v2)
    parseTrack.js    # metadata + artwork extraction
    keybindings.js   dominantColor.js   useObjectUrl.js   artworkTilt.js
  App.jsx            # all state + orchestration
  styles.css
```
