// Like/favorite glyph — outline at rest, filled when liked. Color is handled
// entirely by CSS (currentColor) via .track-like-btn/.grid-like-btn in
// styles.css, which is the ONE place the liked color lives (var(--playing) —
// see the comment there for how to switch it, e.g. to red, in one edit).
export default function HeartIcon({ filled = false }) {
  return (
    <svg
      width="13"
      height="13"
      viewBox="0 0 24 24"
      aria-hidden="true"
      fill={filled ? 'currentColor' : 'none'}
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinejoin="round"
    >
      <path d="M12 20.6c-.3 0-.6-.1-.8-.3C7.6 17.4 3 13.7 3 9.3 3 6.4 5.3 4 8.2 4c1.6 0 3.1.7 3.8 2 .7-1.3 2.2-2 3.8-2C18.7 4 21 6.4 21 9.3c0 4.4-4.6 8.1-8.2 11-.2.2-.5.3-.8.3z" />
    </svg>
  );
}
