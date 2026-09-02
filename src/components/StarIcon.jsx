// Priority flag for a note. Outline when off, filled when on. 13px to sit
// comfortably in the dense note rows.
export default function StarIcon({ filled = false }) {
  return (
    <svg
      width="13"
      height="13"
      viewBox="0 0 24 24"
      fill={filled ? 'currentColor' : 'none'}
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M12 3l2.6 5.6 6 .8-4.4 4.1 1.1 5.9L12 16.9 6.7 19.5l1.1-5.9L3.4 9.4l6-.8L12 3z" />
    </svg>
  );
}
