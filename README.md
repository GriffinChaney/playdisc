# Sona

> **Working on this project?** Read [`CLAUDE.md`](CLAUDE.md) for architecture,
> conventions, and things not to break, and
> [`docs/PROJECT_STATE.md`](docs/PROJECT_STATE.md) for current bugs/in-progress work
> before making changes. This README is a lighter intro/setup guide and may lag
> behind those two.

A personal, local-only music player. You add exactly the songs you want —
own tracks, friends' tracks, downloads — nothing else ever shows up.
Runs as a desktop app (Electron), library stored locally in IndexedDB
(no server, no account, no sync).

## Features in this scaffold

- Upload button (multi-file, drag-free file picker) for mp3/wav/flac/m4a/aac/ogg
- Automatic ID3 metadata + embedded artwork extraction on upload
- Library sidebar: search, tag filter, sorted newest-added-first
- Inline tag editing (`+ tag` on each track row)
- Scrubbable waveform (click or drag anywhere to jump to that point) via wavesurfer.js
- Two views: sidebar + player, and a fullscreen focus view (artwork, title,
  waveform, transport only — no tags, no queue)
- Playback position/state carries over when you switch between the two views

## Setup

```bash
cd my-music-player
npm install
npm run electron:dev
```

This starts the Vite dev server and opens the Electron window pointed at
it, with hot reload. `npm run dev` alone runs it as a regular browser tab
if you'd rather iterate there first.

To build a distributable app:

```bash
npm run electron:build
```

## Known limitations / next steps

- **Waveform remounts on view switch.** Switching between sidebar and
  focus view currently reloads the waveform (it reseeks to your current
  position and resumes playback, but there's a brief flash). Fixing this
  properly means having wavesurfer attach to one persistent `<audio>`
  element that never unmounts — worth doing once the rest feels solid.
- **Tag editing is minimal** — one tag at a time, no rename/delete UI yet.
  Delete/rename would just be a couple more IndexedDB calls plus a
  small UI affordance.
- **No queue/shuffle** — skip next/previous currently just walks the
  newest-added-first list. A real queue is a reasonable v2 addition.
- **Spotify-downloaded files**: if any of yours are DRM-protected or have
  stripped tags, metadata extraction will silently fall back to the
  filename — worth testing a few early.
- **No folder-watching** — everything comes in through the upload button.
  Electron *can* watch a folder on disk directly, which would be a nice
  addition via the (currently empty) preload bridge.

## Project structure

```
electron/
  main.js        # creates the app window
  preload.js      # placeholder for future native bridge
src/
  components/
    Sidebar.jsx       # library: upload, search, tags, track list
    TrackItem.jsx      # one row in the library
    UploadButton.jsx
    NowPlaying.jsx     # sidebar-mode player panel
    FocusView.jsx      # fullscreen player
    Waveform.jsx       # wavesurfer.js wrapper, scrubbable
  lib/
    db.js              # IndexedDB (tracks, tags, dateAdded)
    parseTrack.js       # ID3 + artwork extraction on upload
    useObjectUrl.js     # Blob -> object URL hook
  App.jsx              # state + view switching
  styles.css
```
