// Content fingerprint for an audio file: total size + SHA-256 of the first
// and last 256 KB. Cheap (never hashes the whole file) and collision-proof
// for real audio — used to spot when the same mix is being imported twice
// or added as a version of a track it's already in.
const EDGE = 256 * 1024;

async function sha256Hex(bytes) {
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

// accepts an ArrayBuffer or a Uint8Array/Buffer
export async function fingerprint(input) {
  const buf = input instanceof ArrayBuffer ? new Uint8Array(input) : new Uint8Array(input.buffer || input);
  const size = buf.byteLength;
  const head = buf.subarray(0, Math.min(EDGE, size));
  const tail = buf.subarray(Math.max(0, size - EDGE));
  const [h, t] = await Promise.all([sha256Hex(head), sha256Hex(tail)]);
  return `${size}-${h.slice(0, 24)}-${t.slice(0, 24)}`;
}
