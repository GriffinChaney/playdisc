import { openDB, deleteDB } from 'idb';

const DB_NAME = 'my-music-player';
const DB_VERSION = 2;
const STORE = 'tracks';
const PLAYLISTS = 'playlists';

let dbPromise = null;

function getDB() {
  if (!dbPromise) {
    dbPromise = openDB(DB_NAME, DB_VERSION, {
      upgrade(db, oldVersion) {
        // v1: the tracks store. Guarded by oldVersion so an existing v1
        // database isn't asked to re-create a store it already has.
        if (oldVersion < 1) {
          const store = db.createObjectStore(STORE, { keyPath: 'id' });
          store.createIndex('dateAdded', 'dateAdded');
        }
        // v2: playlists. A playlist is just a named, ordered list of track
        // ids pointing back into the tracks store — deleting one never
        // touches the tracks themselves.
        if (oldVersion < 2) {
          db.createObjectStore(PLAYLISTS, { keyPath: 'id' });
        }
      }
    });
  }
  return dbPromise;
}

// track shape:
// {
//   id: string,                // STABLE — never regenerated (future sharing)
//   title: string,             // per-track, never per-version
//   artist: string,            // per-track
//   duration: number,          // mirrors the ACTIVE version's duration
//   artworkBlob: Blob | null,  // per-track cover art (stays in IndexedDB)
//   audio: {...} | null,       // mirrors the active version's format info
//   activeVersionId: string,
//   versions: [                // >=1; an unversioned track has one implicit
//     { id, title, originalTitle, relPath, duration, format, fingerprint, dateAdded }
//     — relPath is relative to the per-machine library root (see media.js)
//   ],
//   notes: [ { id, text, complete, dateAdded } ],
//   tags: string[],
//   dateAdded: number,
//   liked: boolean,            // schemaless addition, 2026-09-05 — absent on
//                               // older records, treated as falsy (not liked)
//   likedAt: number | undefined // set when liked; left as-is (not cleared) on unlike
// }
// Audio bytes live on disk under the library root, NOT in IndexedDB — see
// electron/main.js. The blob->file / extension / version-title migrations
// that used to run over old records were removed on the library-sync branch
// (fresh start, nothing to migrate); every record now has `versions`.

export async function addTrack(track) {
  const db = await getDB();
  await db.put(STORE, track);
  return track;
}

export async function getAllTracks() {
  const db = await getDB();
  return db.getAll(STORE);
}

export async function updateTrack(id, changes) {
  const db = await getDB();
  const existing = await db.get(STORE, id);
  if (!existing) return null;
  const updated = { ...existing, ...changes };
  await db.put(STORE, updated);
  return updated;
}

// full-record write (replaces, never merges — a key absent from `record` is
// dropped). Unused right now; the sync merge will want it.
export async function replaceTrack(record) {
  const db = await getDB();
  await db.put(STORE, record);
  return record;
}

export async function deleteTrack(id) {
  const db = await getDB();
  await db.delete(STORE, id);
}

// playlist shape:
// {
//   id: string,
//   name: string,
//   trackIds: string[],   // ordered; references tracks.id
//   pinned: boolean,
//   createdAt: number,
//   updatedAt: number
// }

export async function getAllPlaylists() {
  const db = await getDB();
  return db.getAll(PLAYLISTS);
}

export async function putPlaylist(playlist) {
  const db = await getDB();
  await db.put(PLAYLISTS, playlist);
  return playlist;
}

export async function deletePlaylistRecord(id) {
  const db = await getDB();
  await db.delete(PLAYLISTS, id);
}

// Drop the whole database (tracks + playlists). Settings > Library > "Reset
// library…". Closes our own connection first — deleteDB blocks for as long
// as any connection is open, and ours is the only one. The caller reloads
// the renderer afterwards so every piece of derived state starts clean; a
// later getDB() would otherwise re-create an empty v2 database lazily,
// which is also fine. Audio files on disk are NOT touched here.
export async function resetLibraryDatabase() {
  if (dbPromise) {
    const db = await dbPromise;
    db.close();
    dbPromise = null;
  }
  await deleteDB(DB_NAME, {
    blocked() {
      console.warn('[db] reset blocked by another open connection');
    }
  });
}
