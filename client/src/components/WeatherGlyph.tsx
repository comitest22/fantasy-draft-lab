/** Shared outdoor / dome weather glyph (My Team Status, TD Streak). */
export default function WeatherGlyph({ kind }: { kind: string }) {
  if (kind === 'dome') {
    return (
      <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
        <path
          d="M2.4 9.2C3.2 5.6 6 3.4 8 3.4s4.8 2.2 5.6 5.8"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
        />
        <path
          d="M1.8 9.4h12.4v1.2H1.8zM3 10.6v2.4h10v-2.4"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinejoin="round"
        />
        <path d="M8 3.4V9.2" fill="none" stroke="currentColor" strokeWidth="1.3" />
      </svg>
    );
  }
  if (kind === 'rain') {
    return (
      <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
        <path
          d="M5.2 7.2A2.6 2.6 0 0 1 7.6 5.4c.4-1.4 1.7-2.4 3.2-2.4A3.2 3.2 0 0 1 14 6.4c0 .2 0 .3-.1.5A2.4 2.4 0 0 1 13.4 11H5.6A2.6 2.6 0 0 1 5.2 7.2Z"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.4"
          strokeLinejoin="round"
        />
        <path
          d="M6 12.2v1.6M8.2 12.6v1.8M10.4 12.2v1.6"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.4"
          strokeLinecap="round"
        />
      </svg>
    );
  }
  if (kind === 'snow') {
    return (
      <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
        <path
          d="M8 2.5v11M3.4 5.2l9.2 5.6M12.6 5.2 3.4 10.8"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.4"
          strokeLinecap="round"
        />
      </svg>
    );
  }
  if (kind === 'wind') {
    return (
      <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
        <path
          d="M2 6.2h8.2A2 2 0 1 0 8.4 4M2 8.6h10.2A2.1 2.1 0 1 1 10 11.2M2 11h6"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.4"
          strokeLinecap="round"
        />
      </svg>
    );
  }
  if (kind === 'cold') {
    return (
      <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
        <path
          d="M8 2.6v6.2M8 8.8a2.2 2.2 0 1 0 0 4.4 2.2 2.2 0 0 0 0-4.4Z"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinejoin="round"
        />
        <path d="M6.4 5.2h3.2" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
      <circle cx="8" cy="8" r="3.1" fill="none" stroke="currentColor" strokeWidth="1.5" />
      <path
        d="M8 2.4v1.3M8 12.3v1.3M2.4 8h1.3M12.3 8h1.3M4 4l.9.9M11.1 11.1l.9.9M4 12l.9-.9M11.1 4.9l.9-.9"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
      />
    </svg>
  );
}
