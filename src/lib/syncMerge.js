// Library merge — pure, no IPC, no React, no DOM. Tested by
// test/syncMerge.test.mjs (`npm test`). See docs/LIBRARY_SYNC_PLAN.md, stage 4.
//
// Rules, in one place:
//   - Every synced item (track, playlist) carries `updatedAt`. Newest wins,
//     per item, whole record. A tie keeps the local copy (strictly newer to
//     replace) — the only thing that matters is that both machines apply the
//     same rule, and a real tie between *different* edits needs two edits in
//     the same millisecond on two machines.
//   - Deletes are tombstones `{ id, deleted: true, updatedAt }` in the same
//     arrays; a tombstone competes on its stamp like any record. An edit
//     newer than the delete resurrects the item and retires the tombstone.
//   - Notes are the exception to whole-record: they merge by note id with
//     their own stamps (`note.updatedAt`, `track.deletedNotes`,
//     `track.notesUpdatedAt`), so a note edit on one machine and a like on
//     the other don't collide. Note ORDER follows whichever side touched
//     notes most recently (`notesUpdatedAt`).
//   - `libraryOrder` (the hand-dragged Imported order) is one array with one
//     stamp; newest wins whole.
//   - Records without a stamp (written before stage 4) fall back to the
//     caller-supplied stamp: for a remote snapshot that's its `writtenAt`,
//     for local records whatever App.jsx decides (see the initial sync).
//   - Local edits stamp `stampAfter(previous)` = max(now, previous + 1), so
//     an edit always beats the value it was based on, even under clock skew.

export function stampOf(rec, fallback = 0) {
  const s = rec ? rec.updatedAt : undefined;
  return typeof s === 'number' && Number.isFinite(s) ? s : fallback;
}

export function stampAfter(prev) {
  return Math.max(Date.now(), stampOf(prev) + 1);
}

export function isTombstone(rec) {
  return !!rec && rec.deleted === true;
}

// ---- notes --------------------------------------------------------------

// a note from before per-note stamps is as old as its creation
function noteStamp(n) {
  return stampOf(n, (n && n.dateAdded) || 0);
}

function notesStateOf(rec) {
  return {
    notes: (rec && rec.notes) || [],
    deletedNotes: (rec && rec.deletedNotes) || [],
    notesUpdatedAt: stampOf({ updatedAt: rec && rec.notesUpdatedAt })
  };
}

// Merge two notes states. Ties (per note, and for order) favour `a`.
export function mergeNotes(a, b) {
  const aNotes = a.notes || [];
  const bNotes = b.notes || [];
  const tomb = new Map();
  for (const d of [...(a.deletedNotes || []), ...(b.deletedNotes || [])]) {
    if (!d || typeof d.id !== 'string') continue;
    const s = stampOf(d);
    if (!tomb.has(d.id) || tomb.get(d.id) < s) tomb.set(d.id, s);
  }
  const live = new Map();
  for (const n of [...aNotes, ...bNotes]) {
    if (!n || typeof n.id !== 'string') continue;
    const cur = live.get(n.id);
    if (!cur || noteStamp(n) > noteStamp(cur)) live.set(n.id, n);
  }
  const deletedNotes = [];
  for (const [id, s] of tomb) {
    const n = live.get(id);
    if (n && noteStamp(n) > s) continue; // edited after the delete: resurrected
    live.delete(id);
    deletedNotes.push({ id, updatedAt: s });
  }
  deletedNotes.sort((x, y) => (x.id < y.id ? -1 : x.id > y.id ? 1 : 0));

  const aStamp = stampOf({ updatedAt: a.notesUpdatedAt });
  const bStamp = stampOf({ updatedAt: b.notesUpdatedAt });
  const [primary, secondary] = bStamp > aStamp ? [bNotes, aNotes] : [aNotes, bNotes];
  const notes = [];
  const seen = new Set();
  for (const n of [...primary, ...secondary]) {
    if (!n || seen.has(n.id) || !live.has(n.id)) continue;
    seen.add(n.id);
    notes.push(live.get(n.id));
  }
  return { notes, deletedNotes, notesUpdatedAt: Math.max(aStamp, bStamp) };
}

function sameNotesState(rec, state) {
  const cur = notesStateOf(rec);
  if (cur.notesUpdatedAt !== state.notesUpdatedAt) return false;
  if (cur.notes.length !== state.notes.length) return false;
  for (let i = 0; i < cur.notes.length; i++) if (cur.notes[i] !== state.notes[i]) return false;
  if (cur.deletedNotes.length !== state.deletedNotes.length) return false;
  const byId = new Map(cur.deletedNotes.map((d) => [d.id, stampOf(d)]));
  for (const d of state.deletedNotes) if (byId.get(d.id) !== d.updatedAt) return false;
  return true;
}

// ---- records ------------------------------------------------------------

function materialize(rec, stamp) {
  return rec.updatedAt === stamp ? rec : { ...rec, updatedAt: stamp };
}

// One kind (tracks or playlists). Returns the merged list in local order
// with remote additions appended, plus what changed relative to `localRecs`.
function mergeKind({ kind, localRecs, localTombs, remotes, localFallback, accept, notesAware }) {
  const key = kind === 'track' ? 'tracks' : 'playlists';
  const localById = new Map(localRecs.map((r) => [r.id, r]));
  // id -> the current winner: { rec, stamp, deleted, fromLocal }
  const cand = new Map();
  for (const r of localRecs) {
    cand.set(r.id, { rec: r, stamp: stampOf(r, localFallback), deleted: false, fromLocal: true });
  }
  for (const t of localTombs) {
    if (t.kind !== kind) continue;
    const s = stampOf(t);
    const c = cand.get(t.id);
    if (!c || s >= c.stamp) cand.set(t.id, { rec: null, stamp: s, deleted: true, fromLocal: true });
  }
  // every live remote copy, for folding notes across all of them
  const noteSources = new Map();
  let deferred = 0;

  for (const { doc, fallbackStamp } of remotes) {
    for (const r of (doc && doc[key]) || []) {
      if (!r || typeof r.id !== 'string') continue;
      const s = stampOf(r, fallbackStamp);
      const c = cand.get(r.id);
      if (isTombstone(r)) {
        if (!c || s > c.stamp) cand.set(r.id, { rec: null, stamp: s, deleted: true, fromLocal: false });
        continue;
      }
      if (notesAware) {
        if (!noteSources.has(r.id)) noteSources.set(r.id, []);
        noteSources.get(r.id).push(r);
      }
      if (c && s <= c.stamp) continue;
      if (!accept(kind, r)) {
        deferred += 1;
        continue;
      }
      cand.set(r.id, { rec: r, stamp: s, deleted: false, fromLocal: false });
    }
  }

  const foldNotes = (rec, id) => {
    if (!notesAware) return rec;
    const local = localById.get(id);
    let acc = notesStateOf(local || rec);
    for (const src of noteSources.get(id) || []) acc = mergeNotes(acc, notesStateOf(src));
    return sameNotesState(rec, acc) ? rec : { ...rec, ...acc };
  };

  const result = [];
  const changed = new Map();
  const deleted = new Map(); // id -> tombstone stamp
  const tombs = [];
  for (const r of localRecs) {
    const c = cand.get(r.id);
    if (c.deleted) {
      deleted.set(r.id, c.stamp);
      tombs.push({ id: r.id, kind, updatedAt: c.stamp });
      continue;
    }
    let rec = c.fromLocal ? c.rec : materialize(c.rec, c.stamp);
    rec = foldNotes(rec, r.id);
    if (rec !== r) changed.set(r.id, rec);
    result.push(rec);
  }
  for (const [id, c] of cand) {
    if (localById.has(id)) continue;
    if (c.deleted) {
      tombs.push({ id, kind, updatedAt: c.stamp });
      continue;
    }
    const rec = foldNotes(materialize(c.rec, c.stamp), id);
    changed.set(id, rec);
    result.push(rec);
  }
  return {
    records: changed.size || deleted.size ? result : localRecs,
    changed,
    deleted,
    tombs,
    deferred
  };
}

function sameTombstones(a, b) {
  if (a.length !== b.length) return false;
  const k = (t) => `${t.kind}:${t.id}`;
  const m = new Map(a.map((t) => [k(t), stampOf(t)]));
  return b.every((t) => m.get(k(t)) === stampOf(t));
}

// local:   { tracks, playlists, tombstones: [{ id, kind, updatedAt }],
//            libraryOrder, libraryOrderUpdatedAt, fallbackStamp }
// remotes: [{ doc, fallbackStamp }] — `doc` is a snapshot document whose
//          `tracks` / `playlists` arrays may contain tombstones
// accept(kind, rec): whether a remote record can be taken *now* (its art is
//          on disk, its versions are valid…). A rejected record is deferred —
//          left out of this merge entirely, neither applied nor deleted — and
//          counted in `deferred`, so the caller knows to try again later.
export function mergeLibraries({ local, remotes, accept = () => true }) {
  const localFallback = local.fallbackStamp || 0;
  const localTombs = local.tombstones || [];
  const t = mergeKind({
    kind: 'track',
    localRecs: local.tracks || [],
    localTombs,
    remotes,
    localFallback,
    accept,
    notesAware: true
  });
  const p = mergeKind({
    kind: 'playlist',
    localRecs: local.playlists || [],
    localTombs,
    remotes,
    localFallback,
    accept,
    notesAware: false
  });

  let libraryOrder = Array.isArray(local.libraryOrder) ? local.libraryOrder : [];
  let libraryOrderUpdatedAt = stampOf({ updatedAt: local.libraryOrderUpdatedAt });
  let libraryOrderChanged = false;
  for (const { doc } of remotes) {
    if (!doc || !Array.isArray(doc.libraryOrder)) continue;
    const s = stampOf({ updatedAt: doc.libraryOrderUpdatedAt });
    if (s > libraryOrderUpdatedAt) {
      libraryOrder = doc.libraryOrder;
      libraryOrderUpdatedAt = s;
      libraryOrderChanged = true;
    }
  }

  const tombstones = [...t.tombs, ...p.tombs];
  const tombstonesChanged = !sameTombstones(localTombs, tombstones);

  return {
    changed:
      t.changed.size > 0 ||
      t.deleted.size > 0 ||
      p.changed.size > 0 ||
      p.deleted.size > 0 ||
      tombstonesChanged ||
      libraryOrderChanged,
    tracks: t.records,
    playlists: p.records,
    tombstones: tombstonesChanged ? tombstones : localTombs,
    tombstonesChanged,
    libraryOrder,
    libraryOrderUpdatedAt,
    libraryOrderChanged,
    changedTracks: t.changed, // id -> record (a remote winner is still snapshot-shaped)
    deletedTracks: t.deleted, // id -> tombstone stamp
    changedPlaylists: p.changed,
    deletedPlaylists: p.deleted,
    deferred: t.deferred + p.deferred
  };
}

// Apply a merge's per-kind result to whatever the list is NOW (it may have
// moved since the merge was computed — an import finishing, a like landing).
// A change is applied when the item is exactly the object the merge was
// based on, or when the incoming stamp still beats it; otherwise it's
// skipped and reported, and the caller merges again. Pure, so it's safe as
// a React state updater.
export function applyMergedRecords(prev, { changed, deleted, basedOn }) {
  let skipped = 0;
  let touched = false;
  const out = [];
  const seen = new Set();
  for (const r of prev) {
    seen.add(r.id);
    if (deleted.has(r.id)) {
      if (basedOn.get(r.id) === r || stampOf(r) < deleted.get(r.id)) {
        touched = true;
        continue;
      }
      skipped += 1;
      out.push(r);
      continue;
    }
    const rec = changed.get(r.id);
    if (!rec) {
      out.push(r);
      continue;
    }
    if (basedOn.get(r.id) === r || stampOf(r) < stampOf(rec)) {
      touched = true;
      out.push(rec);
    } else {
      skipped += 1;
      out.push(r);
    }
  }
  for (const [id, rec] of changed) {
    if (seen.has(id)) continue;
    touched = true;
    out.push(rec);
  }
  return { records: touched ? out : prev, skipped };
}

// union by (kind, id), newest stamp wins
export function mergeTombstones(prev, incoming) {
  const k = (t) => `${t.kind}:${t.id}`;
  const m = new Map(prev.map((t) => [k(t), t]));
  let touched = false;
  for (const t of incoming) {
    const cur = m.get(k(t));
    if (!cur || stampOf(cur) < stampOf(t)) {
      m.set(k(t), t);
      touched = true;
    }
  }
  return touched ? [...m.values()] : prev;
}
