// Listening stats — pure: no IPC, no React, no DOM. Tested by
// test/listening.test.mjs (`npm test`). See CLAUDE.md "Listening stats".
//
// Storage unit is one row per (trackId, local calendar day):
//   { trackId, day: 'YYYY-MM-DD', seconds, plays }
// Rows are owned by the machine that wrote them and are NEVER merged — each
// machine's rows ride in its own snapshot and the display sums across
// machines (see App.jsx). All-time totals are the only thing shown today;
// the day buckets exist so time windows are possible later.
//
// Two rules for the hold-space-for-2x feature:
//   - a "play" needs PLAY_THRESHOLD_MS of playback at NORMAL speed within
//     one session of a track, so skimming at 2x never counts as a play;
//   - time listened is wall-clock at ANY speed — how long you actually
//     spent with the track.

export const PLAY_THRESHOLD_MS = 30_000;
// a gap between ticks longer than this is a pause / seek / sleep, not
// listening — the slice is dropped rather than counted
export const MAX_TICK_GAP_MS = 2_000;

const pad2 = (n) => String(n).padStart(2, '0');

// local calendar day — the day as the listener experienced it
export function dayKey(ts = Date.now()) {
  const d = new Date(ts);
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

export function rowKey(trackId, day) {
  return `${trackId}|${day}`;
}

// ---- session accumulator ---------------------------------------------------
//
// One session = one continuous adoption of a track (adopt -> next adopt).
// Repeat-one restarting the same track starts a new session (each loop can
// count a play). `pending` holds unflushed deltas per day.

// `now` null = no anchor yet: the first tick only anchors, so the decode /
// load gap between adopting a track and audio actually starting is never
// counted as listening.
export function startSession(trackId, now = null) {
  return { trackId, lastTick: now, normalMs: 0, playCounted: false, pending: new Map() };
}

// Same track, fresh play-threshold — repeat-one's loop. Unflushed pending
// deltas are kept; the caller flushes on its own cadence.
export function restartSession(session, now) {
  if (!session) return null;
  return { ...session, lastTick: now, normalMs: 0, playCounted: false };
}

// Forget the last tick (a pause), so the next tick's gap isn't counted.
export function suspendSession(session) {
  if (!session || session.lastTick == null) return session;
  return { ...session, lastTick: null };
}

// Advance a session by one tick. `atNormalSpeed` is whether the rate is 1x
// right now. Returns { session, newPlay } — `newPlay` is true exactly once
// per session, the tick the normal-speed total crosses the threshold.
export function tickSession(session, now, atNormalSpeed, day = dayKey()) {
  if (!session) return { session, newPlay: false };
  if (session.lastTick == null) return { session: { ...session, lastTick: now }, newPlay: false };
  const gap = now - session.lastTick;
  if (gap <= 0) return { session, newPlay: false };
  if (gap > MAX_TICK_GAP_MS) return { session: { ...session, lastTick: now }, newPlay: false };

  const pending = new Map(session.pending);
  const cur = pending.get(day) || { ms: 0, plays: 0 };
  const next = { ms: cur.ms + gap, plays: cur.plays };
  let normalMs = session.normalMs;
  let playCounted = session.playCounted;
  let newPlay = false;
  if (atNormalSpeed) {
    normalMs += gap;
    if (!playCounted && normalMs >= PLAY_THRESHOLD_MS) {
      playCounted = true;
      newPlay = true;
      next.plays += 1;
    }
  }
  pending.set(day, next);
  return { session: { ...session, lastTick: now, normalMs, playCounted, pending }, newPlay };
}

// Drain a session's pending deltas into row deltas for the store, and the
// session with `pending` cleared. Sub-second remainders are carried in the
// rows as fractional seconds — rounding happens at display time only.
export function drainSession(session) {
  if (!session || session.pending.size === 0) return { session, deltas: [] };
  const deltas = [];
  for (const [day, { ms, plays }] of session.pending) {
    if (ms <= 0 && plays === 0) continue;
    deltas.push({ trackId: session.trackId, day, seconds: ms / 1000, plays });
  }
  return { session: { ...session, pending: new Map() }, deltas };
}

// ---- rows -> totals ----------------------------------------------------------

// Map trackId -> { seconds, plays }, summed over every row given.
export function aggregateRows(rows, into = new Map()) {
  for (const r of rows || []) {
    if (!r || typeof r.trackId !== 'string') continue;
    const cur = into.get(r.trackId) || { seconds: 0, plays: 0 };
    into.set(r.trackId, {
      seconds: cur.seconds + (Number.isFinite(r.seconds) ? r.seconds : 0),
      plays: cur.plays + (Number.isFinite(r.plays) ? r.plays : 0)
    });
  }
  return into;
}

// Apply row deltas to a rows Map keyed by rowKey (the in-memory mirror of
// the IndexedDB store). Returns the updated rows for persisting.
export function applyDeltas(rowsByKey, deltas) {
  const updated = [];
  for (const d of deltas) {
    const key = rowKey(d.trackId, d.day);
    const cur = rowsByKey.get(key) || { trackId: d.trackId, day: d.day, seconds: 0, plays: 0 };
    const row = { ...cur, seconds: cur.seconds + d.seconds, plays: cur.plays + d.plays };
    rowsByKey.set(key, row);
    updated.push(row);
  }
  return updated;
}

// Sum several totals maps (this machine's + every other machine's).
export function sumTotals(...maps) {
  const out = new Map();
  for (const m of maps) {
    if (!m) continue;
    for (const [id, v] of m) {
      const cur = out.get(id) || { seconds: 0, plays: 0 };
      out.set(id, { seconds: cur.seconds + v.seconds, plays: cur.plays + v.plays });
    }
  }
  return out;
}

export function grandTotal(totals) {
  let seconds = 0;
  let plays = 0;
  for (const v of totals.values()) {
    seconds += v.seconds;
    plays += v.plays;
  }
  return { seconds, plays };
}

export function earliestDay(rows) {
  let min = null;
  for (const r of rows || []) {
    if (r && typeof r.day === 'string' && (min === null || r.day < min)) min = r.day;
  }
  return min;
}

// Per-machine snapshots: which of these docs carry listening rows from
// OTHER machines. Filtered by the doc's own machineId, not the file name —
// a Dropbox "conflicted copy" of this machine's snapshot carries this
// machine's id and would double-count if it slipped through.
export function remoteListening(docs, ownMachineId) {
  const totals = new Map();
  const machines = new Set();
  let since = null;
  for (const doc of docs || []) {
    if (!doc || !Array.isArray(doc.listening) || !doc.machineId || doc.machineId === ownMachineId) continue;
    if (doc.listening.length === 0) continue;
    machines.add(doc.machineId);
    aggregateRows(doc.listening, totals);
    const d = earliestDay(doc.listening);
    if (d && (since === null || d < since)) since = d;
  }
  return { totals, machines: machines.size, since };
}

// Cheap change signature so a focus-triggered re-read doesn't re-render
// when nothing moved: any change to any row moves the seconds sum.
export function totalsSignature({ totals, machines, since }) {
  const g = grandTotal(totals);
  return `${machines}|${since || ''}|${totals.size}|${g.seconds.toFixed(3)}|${g.plays}`;
}

// ---- display ---------------------------------------------------------------

// Top tracks by time listened; a track that no longer exists is excluded
// (its rows still count toward the grand total).
export function topTracks(tracks, totals, n = 10) {
  const out = [];
  for (const t of tracks) {
    const v = totals.get(t.id);
    if (!v || (v.seconds <= 0 && v.plays <= 0)) continue;
    out.push({ track: t, seconds: v.seconds, plays: v.plays });
  }
  out.sort((a, b) => b.seconds - a.seconds || b.plays - a.plays || (a.track.title || '').localeCompare(b.track.title || ''));
  return out.slice(0, n);
}

// Artist totals are summed from their tracks at display time — grouped the
// same way artist pages group (primaryArtist), never tracked separately.
export function topArtists(tracks, totals, primaryArtist, n = 10) {
  const byArtist = new Map();
  for (const t of tracks) {
    const v = totals.get(t.id);
    if (!v || (v.seconds <= 0 && v.plays <= 0)) continue;
    const name = primaryArtist(t.artist || '') || t.artist || '';
    if (!name) continue;
    const cur = byArtist.get(name) || { name, seconds: 0, plays: 0 };
    byArtist.set(name, { name, seconds: cur.seconds + v.seconds, plays: cur.plays + v.plays });
  }
  const out = [...byArtist.values()];
  out.sort((a, b) => b.seconds - a.seconds || b.plays - a.plays || a.name.localeCompare(b.name));
  return out.slice(0, n);
}

export function formatListenTime(seconds) {
  const s = Math.max(0, Math.round(seconds || 0));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (h > 0) return `${h}h ${pad2(m)}m`;
  if (m > 0) return `${m}m`;
  return `${s}s`;
}

export function formatDay(day) {
  if (!day) return '';
  const [y, m, d] = day.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}
