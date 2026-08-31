# Versioning + notes — test handoff

Branch: `versioning-notes` (pushed, **not merged**). `main` is untouched.
Packaged build is installed at `/Applications/Sona.app` as of 2026-08-30 evening.
Commit: `feat: optional per-track versioning + notes; audio moves to disk`.

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
   new `sona-media://` protocol (`electron/main.js`). This is the biggest
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
cd ~/Developer/sona
git checkout main
npm run electron:build
codesign --sign - --force --deep "release/mac-arm64/Sona.app"
rm -rf /Applications/Sona.app && cp -R release/mac-arm64/Sona.app /Applications/
```

The migration already dropped the audio blobs from IndexedDB, so old `main`
code won't find audio for existing tracks. Pre-migration IndexedDB is backed
up at:

```
~/Developer/sona-backups/idb-pre-versioning/   (IndexedDB/, Local Storage/, blob_storage/)
```

To restore it: quit Sona, copy those three folders back into
`~/Library/Application Support/Sona/`, relaunch. (The `~/Music/Sona Library/`
files can stay — old code ignores them.)

Git tag `pre-versioning-2026-08-28` marks the last pre-versioning commit on
main. Code-only backup zips are in `~/Developer/sona-backups/`.

## For a fresh session picking this up later

- Read `CLAUDE.md` + `docs/PROJECT_STATE.md` first (they do **not** yet
  describe versioning — that's deliberate, the feature isn't confirmed).
- Repo is at `~/Developer/sona`. `npm run backup` snapshots to
  `~/Developer/sona-backups/`.
- **Path-based audio can't run in `npm run dev`** (plain browser, no Electron
  filesystem / no custom protocol). Test playback in the packaged app only.
  UI-only things (the modal, indicators, notes) can be tested in the browser
  by seeding IndexedDB with the new track shape — see the track shape comment
  in `src/lib/db.js`.
- `electron:dev` is Gatekeeper-blocked on this laptop; packaged flow is the
  only way (rebuild → re-sign → replace `/Applications/Sona.app`, ~2 min).
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
