import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  PLAY_THRESHOLD_MS,
  MAX_TICK_GAP_MS,
  startSession,
  restartSession,
  suspendSession,
  tickSession,
  drainSession,
  aggregateRows,
  applyDeltas,
  sumTotals,
  grandTotal,
  remoteListening,
  topTracks,
  topArtists,
  formatListenTime
} from '../src/lib/listening.js';
import { sortLibrary } from '../src/lib/librarySort.js';

const DAY = '2026-09-07';

// advance a session by `n` ticks of `step` ms
function run(session, from, n, step, normal, day = DAY) {
  let now = from;
  let plays = 0;
  for (let i = 0; i < n; i++) {
    now += step;
    const r = tickSession(session, now, normal, day);
    session = r.session;
    if (r.newPlay) plays += 1;
  }
  return { session, now, plays };
}

test('30 s at normal speed counts exactly one play per session', () => {
  let s = startSession('t1', 0);
  const r = run(s, 0, 200, 200, true); // 40 s
  assert.equal(r.plays, 1);
  assert.equal(r.session.playCounted, true);
  const d = drainSession(r.session).deltas;
  assert.equal(d.length, 1);
  assert.equal(d[0].plays, 1);
  assert.ok(Math.abs(d[0].seconds - 40) < 1e-9);
});

test('skimming at 2x never counts a play, but time still accrues', () => {
  const s = startSession('t1', 0);
  const r = run(s, 0, 300, 200, false); // 60 s at 2x
  assert.equal(r.plays, 0);
  const d = drainSession(r.session).deltas;
  assert.ok(Math.abs(d[0].seconds - 60) < 1e-9);
  assert.equal(d[0].plays, 0);
});

test('mixed speed: only the 1x portion counts toward the threshold', () => {
  let { session, now } = run(startSession('t1', 0), 0, 100, 200, false); // 20 s at 2x
  assert.equal(session.normalMs, 0);
  const r = run(session, now, 100, 200, true); // +20 s at 1x -> 20 s normal, below threshold
  assert.equal(r.plays, 0);
  const r2 = run(r.session, r.now, 60, 200, true); // +12 s -> 32 s normal
  assert.equal(r2.plays, 1);
});

test('a tick gap over MAX_TICK_GAP_MS is dropped, not counted', () => {
  const s = startSession('t1', 0);
  const r = tickSession(s, MAX_TICK_GAP_MS + 1, true, DAY);
  assert.equal(r.session.pending.size, 0);
  assert.equal(r.session.lastTick, MAX_TICK_GAP_MS + 1);
  const r2 = tickSession(r.session, MAX_TICK_GAP_MS + 201, true, DAY);
  assert.ok(Math.abs(r2.session.pending.get(DAY).ms - 200) < 1e-9);
});

test('suspend forgets the last tick so a pause gap is never counted', () => {
  let s = startSession('t1', 0);
  s = tickSession(s, 200, true, DAY).session;
  s = suspendSession(s);
  assert.equal(s.lastTick, null);
  const r = tickSession(s, 1000, true, DAY); // first tick after resume: no gap counted
  assert.ok(Math.abs(r.session.pending.get(DAY).ms - 200) < 1e-9);
});

test('restartSession (repeat-one) allows another play, keeps pending time', () => {
  const r = run(startSession('t1', 0), 0, 200, 200, true);
  assert.equal(r.plays, 1);
  const again = run(restartSession(r.session, r.now), r.now, 200, 200, true);
  assert.equal(again.plays, 1);
  const d = drainSession(again.session).deltas;
  assert.equal(d[0].plays, 2);
  assert.ok(Math.abs(d[0].seconds - 80) < 1e-9);
});

test('drain clears pending; deltas split by day', () => {
  let s = startSession('t1', 0);
  s = run(s, 0, 10, 200, true, '2026-09-07').session;
  s = run(s, 2000, 10, 200, true, '2026-09-08').session;
  const { session, deltas } = drainSession(s);
  assert.equal(session.pending.size, 0);
  assert.deepEqual(
    deltas.map((d) => [d.day, d.seconds]),
    [
      ['2026-09-07', 2],
      ['2026-09-08', 2]
    ]
  );
  assert.deepEqual(drainSession(session).deltas, []);
});

test('applyDeltas accumulates into rows keyed by track+day', () => {
  const rows = new Map();
  applyDeltas(rows, [{ trackId: 'a', day: DAY, seconds: 10, plays: 1 }]);
  applyDeltas(rows, [{ trackId: 'a', day: DAY, seconds: 5, plays: 0 }]);
  const row = rows.get(`a|${DAY}`);
  assert.equal(row.seconds, 15);
  assert.equal(row.plays, 1);
});

test('aggregateRows / sumTotals / grandTotal', () => {
  const local = aggregateRows([
    { trackId: 'a', day: DAY, seconds: 10, plays: 1 },
    { trackId: 'a', day: '2026-09-08', seconds: 20, plays: 1 }
  ]);
  const remote = aggregateRows([{ trackId: 'a', day: DAY, seconds: 5, plays: 1 }, { trackId: 'b', day: DAY, seconds: 7, plays: 0 }]);
  const all = sumTotals(local, remote);
  assert.deepEqual(all.get('a'), { seconds: 35, plays: 3 });
  assert.deepEqual(all.get('b'), { seconds: 7, plays: 0 });
  assert.deepEqual(grandTotal(all), { seconds: 42, plays: 3 });
});

test('remoteListening skips own machine (and conflicted copies of it) by machineId', () => {
  const docs = [
    { machineId: 'me', listening: [{ trackId: 'a', day: DAY, seconds: 100, plays: 5 }] },
    { machineId: 'me', listening: [{ trackId: 'a', day: DAY, seconds: 100, plays: 5 }] }, // conflicted copy
    { machineId: 'other', listening: [{ trackId: 'a', day: '2026-09-01', seconds: 30, plays: 1 }] },
    { machineId: 'third', listening: [] },
    { machineId: 'legacy' } // pre-stats snapshot, no listening key
  ];
  const r = remoteListening(docs, 'me');
  assert.equal(r.machines, 1);
  assert.equal(r.since, '2026-09-01');
  assert.deepEqual(r.totals.get('a'), { seconds: 30, plays: 1 });
});

test('top lists exclude tracks that no longer exist; grand total keeps them', () => {
  const tracks = [
    { id: 'a', title: 'A', artist: 'Daft Punk' },
    { id: 'b', title: 'B', artist: 'Daft Punk feat. Todd Edwards' },
    { id: 'c', title: 'C', artist: 'Someone' }
  ];
  const totals = new Map([
    ['a', { seconds: 100, plays: 2 }],
    ['b', { seconds: 50, plays: 1 }],
    ['c', { seconds: 10, plays: 0 }],
    ['deleted', { seconds: 1000, plays: 9 }]
  ]);
  const tt = topTracks(tracks, totals, 10);
  assert.deepEqual(
    tt.map((r) => r.track.id),
    ['a', 'b', 'c']
  );
  const primary = (s) => s.replace(/\s+feat\..*$/i, '');
  const ta = topArtists(tracks, totals, primary, 10);
  assert.deepEqual(ta[0], { name: 'Daft Punk', seconds: 150, plays: 3 });
  assert.equal(grandTotal(totals).seconds, 1160);
});

test('formatListenTime', () => {
  assert.equal(formatListenTime(45), '45s');
  assert.equal(formatListenTime(125), '2m');
  assert.equal(formatListenTime(3600 * 41 + 12 * 60), '41h 12m');
  assert.equal(formatListenTime(3605), '1h 00m');
});

test('sortLibrary: Most played and Never played first', () => {
  const tracks = [
    { id: 'a', title: 'A', dateAdded: 1 },
    { id: 'b', title: 'B', dateAdded: 2 },
    { id: 'c', title: 'C', dateAdded: 3 },
    { id: 'd', title: 'D', dateAdded: 4 }
  ];
  const plays = new Map([
    ['a', { seconds: 1, plays: 5 }],
    ['b', { seconds: 1, plays: 0 }],
    ['c', { seconds: 1, plays: 2 }]
  ]);
  assert.deepEqual(
    sortLibrary(tracks, 'plays', 'desc', [], plays).map((t) => t.id),
    ['a', 'c', 'd', 'b'] // ties (0 plays) newest first
  );
  assert.deepEqual(
    sortLibrary(tracks, 'neverPlayed', 'desc', [], plays).map((t) => t.id),
    ['d', 'b', 'c', 'a'] // never played (newest first), then ascending plays
  );
  // no plays map at all: everything is "never played"
  assert.deepEqual(
    sortLibrary(tracks, 'plays', 'desc', []).map((t) => t.id),
    ['d', 'c', 'b', 'a']
  );
});
