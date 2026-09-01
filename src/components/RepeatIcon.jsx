// Standard looping-arrows repeat glyph. `one` adds the small "1" for
// repeat-one. Matched to ShuffleIcon's 15px box and 1.6 stroke weight.
export default function RepeatIcon({ one = false }) {
  const stroke = {
    stroke: 'currentColor',
    strokeWidth: 1.6,
    strokeLinecap: 'round',
    strokeLinejoin: 'round',
    fill: 'none'
  };
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M17 2l4 4-4 4" {...stroke} />
      <path d="M3 11v-1a4 4 0 0 1 4-4h14" {...stroke} />
      <path d="M7 22l-4-4 4-4" {...stroke} />
      <path d="M21 13v1a4 4 0 0 1-4 4H3" {...stroke} />
      {one && <path d="M11 10h1v4" {...stroke} />}
    </svg>
  );
}
