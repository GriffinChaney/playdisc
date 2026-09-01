# Versioning + notes — test handoff

Branch: `versioning-notes` (pushed, **not merged**). `main` is untouched.
Packaged build is installed at `/Applications/Sona.app` as of 2026-08-30 evening.
Commit: `feat: optional per-track versioning + notes; audio moves to disk`.

> **Stale on two counts:** versioning was merged to `main` (`f9b8cb4`), and the
> app was later renamed **Sona → Playdisc** (`915bbdc`) — profile is now
> `~/Library/Application Support/Playdisc/`, protocol is `playdisc-media://`,
> packaged app is `/Applications/Playdisc.app`. Kept for the migration/decision
> history below.

Griffin has **not tested any of this yet.** The migration ran on his real
library but the interactive feature is unverified.

---

## What already happened on this machine (don't redo it)

- One-time **migration** moved all 23 tracks' audio out of IndexedDB into
  `~/Music/Sona Library/` (one folder per track). It verified every file was
  on disk before dropping any blob. `localStorage['sona:mediaMigration'] = 'v1'`.
- A **v2 fixup pass** sniffed each file's real header and renamed the 23 files
  from `.mp3` → `.wav` (the library is 192 kHz WAV rips; early build wrote the
  wrong extension). DB paths updated. `localStorage['sona:extFix'] = 'done'`.
- App did not crash; both flags are set.

## Test checklist (packaged app)

1. **Playback** — does a track play at all? Audio now streams from disk via a
   new `playdisc-media://` protocol (`electron/main.js`). This is the biggest
   unknown. If nothing plays, that protocol handler is the first suspect.
2. **Seeking** — scrub/drag to a point in a long track; does it jump quickly
   (range requests) or hang/re-buffer?
3. **Add version** — right-click a track → "Add version…" → pick an audio file.
   Expected: it copies into `~/Music/Sona Library/<Artist — Title>/`, becomes
   the active version, then prompts for an optional label.
4. **Versions & notes modal** — right-click → "Versions & notes…":
   - click a version row to make it active; if that track is playing it should
     restart from 0
   - click a label to rename it inline
   - delete a version (the ✕); deleting the last one must be blocked
   - notes: add / check / click-to-edit text / delete
5. **Cover-colored waveform + EQ** — still following the cover art (same
   playback path, so if playback broke this will too).

Also worth a glance: a plain unversioned track's row should look **pixel
identical** to before (no badges). `vN` badge + unchecked-note count only show
next to the duration in **list view** when they apply.

## Revert

`main` has none of this. To go back:

```bash
cd ~/Developer/playdisc
git checkout main
npm run electron:build
codesign --sign - --force --deep "release/mac-arm64/Playdisc.app"
rm -rf /Applications/Playdisc.app && cp -R release/mac-arm64/Playdisc.app /Applications/
```

The migration already dropped the audio blobs from IndexedDB, so old `main`
code won't find audio for existing tracks. Pre-migration IndexedDB is backed
up at:

```
~/Developer/sona-backups/idb-pre-versioning/   (IndexedDB/, Local Storage/, blob_storage/)
```

To restore it: quit Playdisc, copy those three folders back into
`~/Library/Application Support/Playdisc/`, relaunch. (The `~/Music/Sona Library/`
files can stay — old code ignores them.)

Note: a `~/Library/Application Support/Sona/` directory may still exist — it's the
**pre-rename profile copy**, left intact by `migrateProfileFromSona()` when the app
became Playdisc. It's a frozen snapshot from 2026-09-01, not the live profile.

Git tag `pre-versioning-2026-08-28` marks the last pre-versioning commit on
main. Code-only backup zips are in `~/Developer/sona-backups/`.

## Update 2026-08-31 — title follows the active version

Griffin tested the versioning build and asked for one change (this reverses
the earlier "titles stay at track level" decision — he changed his mind after
using it):

- **Each version now has its own `title`**, derived from its source filename
  on import (`titleFromName` in `src/lib/media.js`) — never an embedded tag.
- The **track-level `title` is now a mirror** of the active version's title.
  Every version mutation that can change which version is active
  (`handleSetActiveVersion`, `handleDeleteVersion`, `handleAddVersion`,
  merge) writes `title:` through `patchTrack`. So the whole existing UI
  (LibraryList, NowPlaying, FocusView, MiniPlayer, BackgroundPlayBar, queue,
  history) shows the active version's name with no per-component changes.
- `displayTitle(track)` helper exists as a fallback (`activeVersion?.title ||
  track.title`) for any record that predates version titles.
- **Freeform `label` on versions is gone.** The Versions modal row now shows
  the version's title (click to rename inline) + date. The `v4` count badge
  in list view stays.
- **Search** matches any version's title, not just the active one — searching
  a non-active version's name still finds the track.
- **On-disk filenames** now follow the version title: `mediaCopyIn` is passed
  `label: <title>`, and renaming a version title calls the new
  `media:rename` IPC (`electron/main.js` + `preload.cjs`) to rename the file
  in place. Best-effort — the DB `filePath` stays source of truth, so a
  failed rename just leaves the old filename.
- **Backfill:** a one-time effect (`sona:versionTitles` localStorage flag)
  seeds every titleless version with its track's current title. Griffin's
  pre-existing multi-version tracks (files named `original.wav` etc., no
  recoverable original name) will show the track title until he
  **deletes + re-adds** those versions — his choice, not an auto-derive.
- **Duplicate-on-add** (adding a version from a file already in the library
  as its own track) is now a 3-way `ChoiceModal`
  (`src/components/ChoiceModal.jsx`): Merge / Add separate copy / Cancel,
  instead of the old 2-button `window.confirm`.

Still **not** done: track-folder names (`~/Music/Sona Library/<Artist —
Title>/`) are per-track and still don't re-sync on a title edit. Only the
per-version *file* names now sync.

### 2026-08-31 (later, after more testing)

Three revisions from Griffin:

1. **Title source reverted to tag-then-filename** (`importTitle` in
   `src/lib/media.js`). Filename-only mangled proper releases
   ("03 - Massive Attack - Teardrop"). Tagless WIP bounces still fall back to
   the filename. `readAudioMeta` now also returns `taggedTitle` (raw embedded
   tag, or null) so callers can tell "has a real tag" from "using the stem".
2. **`originalTitle` on every version** — the title as derived at import,
   immutable. The Versions modal shows a **"reset to original"** link on a row
   whose title has been changed from it; that calls the normal rename path so
   it re-syncs the on-disk filename too.
3. **List-view badge is now `v2/4`** (active version's date-added position /
   total), not `v4` (a bare count that read like "you're on v4").

Backfill flag bumped `sona:versionTitles` → **`v2`**: re-reads every version
file on disk, takes the embedded tag title when there is one (else keeps the
current title), sets `originalTitle`, and renames files to match. Runs behind
the import-progress overlay ("Refreshing version titles…"). **It resets any
hand-rename on a tagged file** — acceptable since "reset to original" + inline
rename make that a two-click fix.

## For a fresh session picking this up later

- Read `CLAUDE.md` + `docs/PROJECT_STATE.md` first (they do **not** yet
  describe versioning — that's deliberate, the feature isn't confirmed).
- Repo is at `~/Developer/playdisc` (renamed from `~/Developer/sona`).
  `npm run backup` snapshots to `~/Developer/sona-backups/` (dir name kept).
- **Path-based audio can't run in `npm run dev`** (plain browser, no Electron
  filesystem / no custom protocol). Test playback in the packaged app only.
  UI-only things (the modal, indicators, notes) can be tested in the browser
  by seeding IndexedDB with the new track shape — see the track shape comment
  in `src/lib/db.js`.
- `electron:dev` is Gatekeeper-blocked on this laptop; packaged flow is the
  only way (rebuild → re-sign → replace `/Applications/Playdisc.app`, ~2 min).
- Key files: `electron/main.js` (protocol + media IPC), `src/lib/media.js`
  (helpers, `sniffExt`), `src/lib/mediaFingerprint.js`, `src/App.jsx`
  (migration effects + all the version/note handlers, search
  `// ---- versions & notes`), `src/components/VersionsModal.jsx`.
- Decisions already locked (from Griffin): copy-in not in-place refs; library
  at `~/Music/Sona Library/`; keep the "file missing — relocate?" state;
  deleting the last version is blocked (never auto-converts to track delete);
  no dev-browser blob fallback (one audio code path only); merge-on-duplicate
  offered when adding a version that's already a standalone track.
- Known rough edge deferred: folder/file names in `~/Music/Sona Library/` are
  set at creation and **not** re-synced when a title or label is later edited
  (playback is unaffected — DB path is source of truth). Add rename-sync if it
  annoys him.
