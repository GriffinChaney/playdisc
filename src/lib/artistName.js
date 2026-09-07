// Featured-artist grouping (2026-09-06). "Daft Punk feat. Todd Edwards" and
// "Daft Punk" are the same artist for navigation/grouping purposes — one
// artist page, one entry in search, one backdrop hue — but the FULL string
// stays exactly as typed everywhere it's actually displayed (track rows,
// grid tiles, Now Playing, Focus view, search result subtitles). This is
// the one function that computes the grouping identity; it is NEVER used
// to overwrite what's shown.
//
// Deliberately narrow: only `feat`/`feat.`/`ft`/`ft.` (case-insensitive,
// word-bounded) split the string. `&` is left alone on purpose — checked
// against the real library first (2026-09-06): "Bob Marley & The Wailers"
// is a band's actual name, not a feature credit, and naively splitting on
// "&" would have broken it into "Bob Marley" + a dangling "The Wailers".
// `with`, `x`, and `,` are NOT handled yet either — "x" in particular is a
// real separator Griffin's own bounces use ("Griffin x Marley Chaney"), but
// none of those are imported yet, so there's nothing in the library to get
// it right against. Add it here (and re-check the real library again
// first, the same way) once there's real data to verify the parsing on.
const FEATURE_MARKER = /\b(feat|ft)\b/i;

export function primaryArtist(fullArtist) {
  const s = (fullArtist || '').trim();
  const m = FEATURE_MARKER.exec(s);
  if (!m) return s;
  // trim whatever precedes the marker itself, plus any opening punctuation
  // typically written right before it ("Daft Punk (feat. X)", "Daft Punk,
  // feat. X" both reduce to "Daft Punk", not "Daft Punk (" or "Daft Punk,")
  const cut = s.slice(0, m.index).replace(/[\s,;([-]+$/, '').trim();
  return cut || s; // never return an empty string for oddly-shaped data
}
