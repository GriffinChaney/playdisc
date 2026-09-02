// Flat inline glyph for the per-track notes control (a dog-eared page with a
// check). Matches the other transport icons: 15px, stroke = currentColor.
export default function NotesIcon() {
  return (
    <svg
      width="15"
      height="15"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M6 3h8l6 6v11a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z" />
      <path d="M14 3v6h6" />
      <path d="M8.5 14l1.75 1.75L14 12" />
    </svg>
  );
}
