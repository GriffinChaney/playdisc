import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  stampOf,
  stampAfter,
  mergeNotes,
  mergeLibraries,
  applyMergedRecords,
  mergeTombstones
} from '../src/lib/syncMerge.js';

const track = (id, updatedAt, extra = {}) => ({
  id,
  title: `t-${id}`,
  artist: 'a',
  versions: [{ id: `v-${id}`, relPath: `a/${id}.wav` }],
  activeVersionId: `v-${id}`,
  notes: [],
  tags: [],
  updatedAt,
  ...extra
});
const playlist = (id, updatedAt, extra = {}) => ({ id, name: `p-${id}`, trackIds: [], updatedAt, ...extra });
const tomb = (id, updatedAt) => ({ id, deleted: true, updatedAt });
const doc = (fields) => ({ doc: { format: 2, tracks: [], playlists: [], ...fields }, fallbackStamp: fields.writtenAt || 0 });
const local = (fields) => ({ tracks: [], playlists: [], tombstones: [], libraryOrder: [], libraryOrderUpdatedAt: 0, ...fields });

test('stampAfter always beats the value it was based on', () => {
  const future = Date.now() + 60_000;
  assert.equal(stampAfter({ updatedAt: future }), future + 1);
  assert.ok(stampAfter({ updatedAt: 5 }) >= Date.now() - 5);
  assert.equal(stampOf({ updatedAt: 'nope' }, 7), 7);
  assert.equal(stampOf(null, 3), 3);
});

test('bootstrap: empty local takes the union of every remote, honouring tombstones', () => {
  const r = mergeLibraries({
    local: local({}),
    remotes: [
      doc({ tracks: [track('a', 10), track('b', 10), tomb('c', 50)] }),
      doc({ tracks: [track('c', 20), track('d', 5)], playlists: [playlist('p1', 3)] })
    ]
  });
  assert.equal(r.changed, true);
  assert.deepEqual(r.tracks.map((t) => t.id).sort(), ['a', 'b', 'd']);
  assert.deepEqual([...r.changedTracks.keys()].sort(), ['a', 'b', 'd']);
  assert.deepEqual(r.tombstones, [{ id: 'c', kind: 'track', updatedAt: 50 }]);
  assert.equal(r.playlists.length, 1);
});

test('newest wins per record; a tie keeps the local copy; nothing changed keeps identity', () => {
  const a = track('a', 10, { title: 'local' });
  const b = track('b', 10, { title: 'local' });
  const loc = local({ tracks: [a, b] });
  const r = mergeLibraries({
    local: loc,
    remotes: [doc({ tracks: [track('a', 11, { title: 'remote' }), track('b', 10, { title: 'remote' })] })]
  });
  assert.equal(r.changed, true);
  assert.equal(r.tracks.find((t) => t.id === 'a').title, 'remote');
  assert.equal(r.tracks.find((t) => t.id === 'b'), b);
  assert.deepEqual([...r.changedTracks.keys()], ['a']);

  const same = mergeLibraries({ local: loc, remotes: [doc({ tracks: [track('a', 10), track('b', 9)] })] });
  assert.equal(same.changed, false);
  assert.equal(same.tracks, loc.tracks);
  assert.equal(same.tombstones, loc.tombstones);
});

test('unstamped records fall back to the supplied stamp, and the winner is materialized', () => {
  const unstampedLocal = track('a', undefined, { title: 'local' });
  const r = mergeLibraries({
    local: local({ tracks: [unstampedLocal], fallbackStamp: 100 }),
    remotes: [doc({ writtenAt: 200, tracks: [track('a', undefined, { title: 'remote' })] })]
  });
  assert.equal(r.tracks[0].title, 'remote');
  assert.equal(r.tracks[0].updatedAt, 200);

  const r2 = mergeLibraries({
    local: local({ tracks: [track('a', undefined, { title: 'local' })], fallbackStamp: 300 }),
    remotes: [doc({ writtenAt: 200, tracks: [track('a', undefined, { title: 'remote' })] })]
  });
  assert.equal(r2.changed, false);
});

test('a newer tombstone deletes; a newer edit resurrects and retires the tombstone', () => {
  const a = track('a', 10);
  const r = mergeLibraries({ local: local({ tracks: [a] }), remotes: [doc({ tracks: [tomb('a', 11)] })] });
  assert.equal(r.tracks.length, 0);
  assert.equal(r.deletedTracks.get('a'), 11);
  assert.deepEqual(r.tombstones, [{ id: 'a', kind: 'track', updatedAt: 11 }]);

  const r2 = mergeLibraries({
    local: local({ tombstones: [{ id: 'a', kind: 'track', updatedAt: 11 }] }),
    remotes: [doc({ tracks: [track('a', 12, { title: 'edited after delete' })] })]
  });
  assert.equal(r2.tracks.length, 1);
  assert.deepEqual(r2.tombstones, []);
  assert.equal(r2.tombstonesChanged, true);

  const r3 = mergeLibraries({
    local: local({ tombstones: [{ id: 'a', kind: 'track', updatedAt: 11 }] }),
    remotes: [doc({ tracks: [track('a', 10, { title: 'stale' })] })]
  });
  assert.equal(r3.changed, false);
  assert.equal(r3.tracks.length, 0);
});

test('a remote record the caller cannot accept yet is deferred, not applied and not deleting anything', () => {
  const a = track('a', 10);
  const r = mergeLibraries({
    local: local({ tracks: [a] }),
    remotes: [doc({ tracks: [track('a', 20), track('b', 20)] })],
    accept: (kind, rec) => rec.id !== 'b' && rec.updatedAt !== 20
  });
  assert.equal(r.tracks.length, 1);
  assert.equal(r.tracks[0], a);
  assert.equal(r.deferred, 2);
  assert.equal(r.changed, false);
});

test('notes merge by id with their own stamps, independent of the record winner', () => {
  const n1 = { id: 'n1', text: 'one', complete: false, dateAdded: 1, updatedAt: 1 };
  const n2 = { id: 'n2', text: 'two', complete: false, dateAdded: 2, updatedAt: 2 };
  // local: liked the track (record stamp 30), notes untouched
  const loc = track('a', 30, { liked: true, notes: [n1, n2], notesUpdatedAt: 2 });
  // remote: older record, but edited n1 and added n3 after
  const remote = track('a', 20, {
    liked: false,
    notes: [{ ...n1, text: 'one (edited)', updatedAt: 40 }, n2, { id: 'n3', text: 'three', dateAdded: 41, updatedAt: 41 }],
    notesUpdatedAt: 41
  });
  const r = mergeLibraries({ local: local({ tracks: [loc] }), remotes: [doc({ tracks: [remote] })] });
  const out = r.tracks[0];
  assert.equal(out.liked, true, 'record fields come from the local (newer) record');
  assert.equal(out.updatedAt, 30);
  assert.deepEqual(
    out.notes.map((n) => n.text),
    ['one (edited)', 'two', 'three']
  );
  assert.equal(out.notesUpdatedAt, 41);
  assert.equal(out.notes[1], n2, 'an untouched note keeps its identity');
});

test('note deletes are tombstones; a later edit resurrects; order follows the newer notesUpdatedAt', () => {
  const a = {
    notes: [{ id: 'x', updatedAt: 1 }, { id: 'y', updatedAt: 1 }, { id: 'z', updatedAt: 1 }],
    deletedNotes: [],
    notesUpdatedAt: 5
  };
  const b = {
    notes: [{ id: 'z', updatedAt: 1 }, { id: 'x', updatedAt: 1 }],
    deletedNotes: [{ id: 'y', updatedAt: 9 }],
    notesUpdatedAt: 9
  };
  const m = mergeNotes(a, b);
  assert.deepEqual(m.notes.map((n) => n.id), ['z', 'x'], 'b touched notes last, so b\'s order');
  assert.deepEqual(m.deletedNotes, [{ id: 'y', updatedAt: 9 }]);
  assert.equal(m.notesUpdatedAt, 9);

  const resurrect = mergeNotes(b, { notes: [{ id: 'y', text: 'back', updatedAt: 10 }], deletedNotes: [], notesUpdatedAt: 10 });
  assert.deepEqual(resurrect.notes.map((n) => n.id), ['y', 'z', 'x']);
  assert.deepEqual(resurrect.deletedNotes, []);

  // ties favour a
  const tie = mergeNotes(a, { ...b, deletedNotes: [], notesUpdatedAt: 5 });
  assert.deepEqual(tie.notes.map((n) => n.id), ['x', 'y', 'z']);
});

test('playlists: whole record newest wins, tombstones delete', () => {
  const p1 = playlist('p1', 10, { trackIds: ['a'] });
  const p2 = playlist('p2', 10);
  const r = mergeLibraries({
    local: local({ playlists: [p1, p2] }),
    remotes: [doc({ playlists: [playlist('p1', 11, { trackIds: ['a', 'b'] }), tomb('p2', 11), playlist('p3', 1)] })]
  });
  assert.deepEqual(r.playlists.map((p) => p.id), ['p1', 'p3']);
  assert.deepEqual(r.playlists[0].trackIds, ['a', 'b']);
  assert.equal(r.deletedPlaylists.get('p2'), 11);
  assert.deepEqual(r.tombstones, [{ id: 'p2', kind: 'playlist', updatedAt: 11 }]);
});

test('libraryOrder: newest stamp wins whole; unstamped never beats stamped', () => {
  const r = mergeLibraries({
    local: local({ libraryOrder: ['a', 'b'], libraryOrderUpdatedAt: 5 }),
    remotes: [doc({ libraryOrder: ['b', 'a'], libraryOrderUpdatedAt: 6 }), doc({ libraryOrder: ['x'] })]
  });
  assert.deepEqual(r.libraryOrder, ['b', 'a']);
  assert.equal(r.libraryOrderUpdatedAt, 6);
  assert.equal(r.libraryOrderChanged, true);
  const r2 = mergeLibraries({
    local: local({ libraryOrder: ['a'], libraryOrderUpdatedAt: 0 }),
    remotes: [doc({ libraryOrder: ['x'] })]
  });
  assert.equal(r2.libraryOrderChanged, false);
});

test('applyMergedRecords: applies against the object it was based on, re-checks stamps otherwise', () => {
  const a = track('a', 10);
  const b = track('b', 10);
  const c = track('c', 10);
  const basedOn = new Map([['a', a], ['b', b], ['c', c]]);
  const changed = new Map([['a', track('a', 20)], ['b', track('b', 20)], ['d', track('d', 1)]]);
  const deleted = new Map([['c', 15]]);
  // b was edited locally after the merge was planned, with a newer stamp
  const bLocalNewer = track('b', 25);
  const prev = [a, bLocalNewer, c];
  const { records, skipped } = applyMergedRecords(prev, { changed, deleted, basedOn });
  assert.deepEqual(records.map((t) => [t.id, t.updatedAt]), [['a', 20], ['b', 25], ['d', 1]]);
  assert.equal(skipped, 1);
  const noop = applyMergedRecords(prev, { changed: new Map(), deleted: new Map(), basedOn });
  assert.equal(noop.records, prev);
});

test('mergeTombstones unions by kind+id, newest wins, identity kept when nothing new', () => {
  const prev = [{ id: 'a', kind: 'track', updatedAt: 5 }];
  assert.equal(mergeTombstones(prev, [{ id: 'a', kind: 'track', updatedAt: 4 }]), prev);
  const next = mergeTombstones(prev, [{ id: 'a', kind: 'track', updatedAt: 6 }, { id: 'a', kind: 'playlist', updatedAt: 1 }]);
  assert.deepEqual(next, [
    { id: 'a', kind: 'track', updatedAt: 6 },
    { id: 'a', kind: 'playlist', updatedAt: 1 }
  ]);
});
