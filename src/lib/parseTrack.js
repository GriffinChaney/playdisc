import { parseBlob } from 'music-metadata-browser';

// Turns a raw File (from <input type="file"> or drag/drop) into the track
// record shape that db.js expects. Falls back to the filename when tags
// are missing, since not every download has clean ID3 metadata.
export async function parseTrack(file) {
  let title = file.name.replace(/\.[^/.]+$/, '');
  let artist = 'unknown artist';
  let duration = 0;
  let artworkBlob = null;
  // audio fidelity info, surfaced in the UI so it's obvious Sona plays the
  // original file untouched (no re-encode) — quality is whatever you import
  let audio = null;

  try {
    const metadata = await parseBlob(file);
    if (metadata.common.title) title = metadata.common.title;
    if (metadata.common.artist) artist = metadata.common.artist;
    if (metadata.format.duration) duration = metadata.format.duration;

    const f = metadata.format || {};
    audio = {
      codec: f.codec || f.container || null,
      sampleRate: f.sampleRate || null, // Hz
      bitrate: f.bitrate || null, // bits/sec
      bitsPerSample: f.bitsPerSample || null,
      channels: f.numberOfChannels || null,
      lossless: typeof f.lossless === 'boolean' ? f.lossless : null
    };

    const picture = metadata.common.picture?.[0];
    if (picture) {
      artworkBlob = new Blob([picture.data], { type: picture.format });
    }
  } catch (err) {
    // Some files (e.g. certain Spotify-downloaded exports) may have
    // stripped or non-standard tags, or be DRM-protected. Fall back to
    // filename-only metadata rather than blocking the upload.
    console.warn(`Could not read metadata for "${file.name}":`, err);
  }

  return {
    id: crypto.randomUUID(),
    title,
    artist,
    duration,
    audioBlob: file,
    artworkBlob,
    audio,
    tags: [],
    dateAdded: Date.now()
  };
}
