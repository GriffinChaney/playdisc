import { openDB } from 'idb';

const DB_NAME = 'my-music-player';
const DB_VERSION = 1;
const STORE = 'tracks';

let dbPromise = null;

function getDB() {
  if (!dbPromise) {
    dbPromise = openDB(DB_NAME, DB_VERSION, {
      upgrade(db) {
        const store = db.createObjectStore(STORE, { keyPath: 'id' });
        store.createIndex('dateAdded', 'dateAdded');
      }
    });
  }
  return dbPromise;
}

// track shape:
// {
//   id: string,
//   title: string,
//   artist: string,
//   duration: number,          // seconds
//   audioBlob: Blob,           // the actual audio file
//   artworkBlob: Blob | null,  // extracted cover art, if any
//   tags: string[],
//   dateAdded: number          // epoch ms, used for sorting
// }

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

export async function deleteTrack(id) {
  const db = await getDB();
  await db.delete(STORE, id);
}
