// Deterministic per-artist header gradient (2026-09-06) for artist pages —
// NOT cover-derived (an artist has no single cover to sample; see App.jsx's
// activeView 'artist' case). Same visual construction as
// likedBackdropStyle()/meshBackdropStyle's palette branch (several radial
// blobs over a dark base) so it reads as a sibling of the other header
// gradients without sharing their code — meshBackdropStyle, dominantColor.js,
// and the real extraction pipeline are untouched by this feature, same rule
// likedBackdrop.js follows.
//
// The hue is HASHED from the artist's name (djb2-style string hash -> hue
// 0-359), never randomized — the same artist must always land on the same
// hue, and different artists should visibly differ. Saturation/lightness
// stay in a fixed, controlled band regardless of hue (ARTIST_GRADIENT_*
// below), so every artist's gradient still looks like it belongs to this
// app (no neon, no mud) and the base stays dark enough for .has-backdrop's
// light text treatment to stay legible in both themes.
//
// ARTIST_GRADIENT_BASE_S/L and ARTIST_GRADIENT_TONES are the ONE place to
// retune the look — everything below them (the hash, the gradient
// construction) is generic and shouldn't need to change.
const ARTIST_GRADIENT_BASE_S = 32; // base wash saturation, %
const ARTIST_GRADIENT_BASE_L = 11; // base wash lightness, % — dark enough for .has-backdrop's light text
const ARTIST_GRADIENT_TONES = [
  { s: 62, l: 76 }, // pale highlight
  { s: 60, l: 60 },
  { s: 55, l: 42 },
  { s: 48, l: 26 } // deep
];
const BLOB_POS = ['24% 20%', '78% 22%', '65% 82%', '18% 78%'];

function hashHue(name) {
  // djb2
  let h = 5381;
  for (let i = 0; i < name.length; i++) {
    h = (h * 33) ^ name.charCodeAt(i);
  }
  return Math.abs(h) % 360;
}

export function artistBackdropStyle(artistName) {
  const hue = hashHue(String(artistName || ''));
  return {
    backgroundColor: `hsl(${hue}, ${ARTIST_GRADIENT_BASE_S}%, ${ARTIST_GRADIENT_BASE_L}%)`,
    backgroundImage: ARTIST_GRADIENT_TONES.map(
      ({ s, l }, i) =>
        `radial-gradient(circle at ${BLOB_POS[i % BLOB_POS.length]}, hsla(${hue}, ${s}%, ${l}%, 0.85) 0%, transparent 60%)`
    ).join(', ')
  };
}
