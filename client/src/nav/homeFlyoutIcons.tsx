/** Small submenu icons for Home flyouts (accent + white stroke language). */

export function learningsIcon(size = 20) {
  return (
    <svg viewBox="0 0 32 32" width={size} height={size} aria-hidden="true">
      <path
        d="M7 8.5c0-.8.7-1.5 1.5-1.5H15v18H8.5A1.5 1.5 0 0 1 7 23.5v-15Z"
        fill="none"
        stroke="var(--accent)"
        strokeWidth="2"
        strokeLinejoin="round"
      />
      <path
        d="M25 8.5c0-.8-.7-1.5-1.5-1.5H17v18h6.5a1.5 1.5 0 0 0 1.5-1.5v-15Z"
        fill="none"
        stroke="var(--accent)"
        strokeWidth="2"
        strokeLinejoin="round"
      />
      <path
        d="M16 7v18"
        fill="none"
        stroke="#ffffff"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
    </svg>
  );
}

export function takeawaysIcon(size = 20) {
  return (
    <svg viewBox="0 0 32 32" width={size} height={size} aria-hidden="true">
      <path
        d="M7 24h18"
        fill="none"
        stroke="var(--accent)"
        strokeWidth="2"
        strokeLinecap="round"
      />
      <path
        d="M10 24v-7h4v7M14 17V9h4v15M18 24v-5h4v5"
        fill="none"
        stroke="var(--accent)"
        strokeWidth="2"
        strokeLinejoin="round"
      />
      <path
        d="m12 12 2.2-2.2L16.5 12"
        fill="none"
        stroke="#ffffff"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function survivorWinIcon(size = 20) {
  return (
    <svg viewBox="0 0 32 32" width={size} height={size} aria-hidden="true">
      <circle cx="16" cy="16" r="10" fill="none" stroke="var(--accent)" strokeWidth="2" />
      <path
        d="m11 16.2 3.2 3.2L21.5 12"
        fill="none"
        stroke="#ffffff"
        strokeWidth="2.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/** Check only — for circular page-title badges (no nested ring). */
export function survivorWinBadgeIcon(size = 20) {
  return (
    <svg viewBox="0 0 32 32" width={size} height={size} aria-hidden="true">
      <path
        d="m8.5 16.5 5 5L23.5 11"
        fill="none"
        stroke="var(--accent)"
        strokeWidth="2.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function survivorLoseIcon(size = 20) {
  return (
    <svg viewBox="0 0 32 32" width={size} height={size} aria-hidden="true">
      <circle cx="16" cy="16" r="10" fill="none" stroke="var(--accent)" strokeWidth="2" />
      <path
        d="m12 12 8 8M20 12l-8 8"
        fill="none"
        stroke="#ffffff"
        strokeWidth="2.2"
        strokeLinecap="round"
      />
    </svg>
  );
}

/** X only — for circular page-title badges (no nested ring). */
export function survivorLoseBadgeIcon(size = 20) {
  return (
    <svg viewBox="0 0 32 32" width={size} height={size} aria-hidden="true">
      <path
        d="m10 10 12 12M22 10 10 22"
        fill="none"
        stroke="var(--accent)"
        strokeWidth="2.8"
        strokeLinecap="round"
      />
    </svg>
  );
}

export function tdStreakIcon(size = 20) {
  return (
    <svg viewBox="0 0 32 32" width={size} height={size} aria-hidden="true">
      <ellipse
        cx="16"
        cy="16"
        rx="11"
        ry="7.5"
        transform="rotate(-28 16 16)"
        fill="none"
        stroke="var(--accent)"
        strokeWidth="2"
      />
      <path
        d="M9.5 13.5c2.2 1.4 4.8 2.2 6.5 2.5"
        fill="none"
        stroke="#ffffff"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
      <path
        d="M20 9.5v3.5M22.2 10.8 19.5 13"
        fill="none"
        stroke="var(--accent)"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
      <circle cx="23.5" cy="8.5" r="1.5" fill="var(--accent)" />
    </svg>
  );
}
