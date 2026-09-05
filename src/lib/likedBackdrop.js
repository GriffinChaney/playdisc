// Fixed backdrop for the Liked Songs header — NOT cover-derived (Liked has
// no cover art to sample). Same visual construction as meshBackdropStyle's
// palette branch (several radial blobs over a dark base, see meshBackdrop.js)
// so it reads as a sibling of the cover-derived mesh gradients without
// sharing their code — meshBackdropStyle, dominantColor.js, and the
// extraction pipeline are untouched by this feature.
//
// LIKED_GRADIENT_BASE + LIKED_GRADIENT_TONES are the ONE place this color
// lives. Currently blue, built from --playing (#8ec5e8 dark-theme /
// #3d8fc4 light-theme) plus a paler highlight and a deeper shade for range.
// To switch the whole header red (or anything else) later, edit these two
// constants only — nothing downstream needs to change.
const LIKED_GRADIENT_BASE = '#0d1b26';
const LIKED_GRADIENT_TONES = ['#c7e6fa', '#8ec5e8', '#3d8fc4', '#1f4e6e'];
const BLOB_POS = ['24% 20%', '78% 22%', '65% 82%', '18% 78%'];

function withAlpha(hex, a) {
  const n = parseInt(hex.slice(1), 16);
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  return `rgba(${r}, ${g}, ${b}, ${a})`;
}

export function likedBackdropStyle() {
  return {
    backgroundColor: LIKED_GRADIENT_BASE,
    backgroundImage: LIKED_GRADIENT_TONES.map(
      (c, i) => `radial-gradient(circle at ${BLOB_POS[i % BLOB_POS.length]}, ${withAlpha(c, 0.85)} 0%, transparent 60%)`
    ).join(', ')
  };
}
