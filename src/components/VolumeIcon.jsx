// Flat, minimal speaker glyph (no emoji rendering quirks) — arc count
// reflects volume level, matching the app's plain-line icon language.
export default function VolumeIcon({ volume }) {
  const muted = volume === 0;
  const low = volume > 0 && volume < 0.5;

  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M3 9H7L11 5V19L7 15H3V9Z" fill="currentColor" />
      {muted ? (
        <path d="M15 9L20 15M20 9L15 15" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      ) : (
        <>
          <path
            d="M14.5 8.5C15.5 9.5 16 10.7 16 12C16 13.3 15.5 14.5 14.5 15.5"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinecap="round"
            fill="none"
          />
          {!low && (
            <path
              d="M17.3 5.7C19 7.4 20 9.6 20 12C20 14.4 19 16.6 17.3 18.3"
              stroke="currentColor"
              strokeWidth="1.6"
              strokeLinecap="round"
              fill="none"
            />
          )}
        </>
      )}
    </svg>
  );
}
