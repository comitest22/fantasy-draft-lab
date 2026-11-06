import type { ReactNode } from 'react';

export type AppNavItem = {
  to: string;
  label: string;
  match: (path: string) => boolean;
  icon: (size?: number) => ReactNode;
};

function seasonsIcon(size = 28) {
  return (
    <svg viewBox="0 0 32 32" width={size} height={size} aria-hidden="true">
      <path
        d="M10 6h12v6a6 6 0 0 1-12 0V6Z"
        fill="none"
        stroke="var(--accent)"
        strokeWidth="2"
        strokeLinejoin="round"
      />
      <path
        d="M10 8H6v2a4 4 0 0 0 4 4M22 8h4v2a4 4 0 0 1-4 4M16 18v5M11 25h10"
        fill="none"
        stroke="var(--accent)"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M16 9.5v3M14.5 11h3"
        fill="none"
        stroke="#ffffff"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
    </svg>
  );
}

function toolsIcon(size = 28) {
  return (
    <svg viewBox="0 0 32 32" width={size} height={size} aria-hidden="true">
      <rect
        x="7"
        y="6"
        width="18"
        height="21"
        rx="3"
        fill="none"
        stroke="var(--accent)"
        strokeWidth="2"
      />
      <path
        d="M12 6V4.8A1.8 1.8 0 0 1 13.8 3h4.4A1.8 1.8 0 0 1 20 4.8V6"
        fill="none"
        stroke="var(--accent)"
        strokeWidth="2"
      />
      <path
        d="m11 13 2 2 3.5-3.5M11 20l2 2 3.5-3.5"
        fill="none"
        stroke="var(--accent)"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M18.5 13.5H22M18.5 20.5H22"
        fill="none"
        stroke="#ffffff"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
    </svg>
  );
}

function importIcon(size = 28) {
  return (
    <svg viewBox="0 0 32 32" width={size} height={size} aria-hidden="true">
      <path
        d="M16 5v14m0 0-4.5-4.5M16 19l4.5-4.5"
        fill="none"
        stroke="var(--accent)"
        strokeWidth="2.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M6 20v4a3 3 0 0 0 3 3h14a3 3 0 0 0 3-3v-4"
        fill="none"
        stroke="var(--accent)"
        strokeWidth="2"
        strokeLinecap="round"
      />
      <path
        d="M11 23.5h10"
        fill="none"
        stroke="#ffffff"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
    </svg>
  );
}

function insightsIcon(size = 28) {
  return (
    <svg viewBox="0 0 32 32" width={size} height={size} aria-hidden="true">
      <path
        d="M5 23 12 16l4.5 4.5L26 9"
        fill="none"
        stroke="var(--accent)"
        strokeWidth="2.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M20 9h6v6"
        fill="none"
        stroke="var(--accent)"
        strokeWidth="2.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M7 26h18"
        fill="none"
        stroke="#ffffff"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
    </svg>
  );
}

function strategyIcon(size = 28) {
  return (
    <svg viewBox="0 0 32 32" width={size} height={size} aria-hidden="true">
      <path
        d="M8 24c1.5-7 6-11 16-15"
        fill="none"
        stroke="var(--accent)"
        strokeWidth="2.2"
        strokeLinecap="round"
      />
      <path
        d="m20 6 4.5 2.5L22 13"
        fill="none"
        stroke="var(--accent)"
        strokeWidth="2.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx="8" cy="10" r="2.8" fill="none" stroke="#ffffff" strokeWidth="1.8" />
      <path
        d="m19 20 5 5m0-5-5 5"
        fill="none"
        stroke="#ffffff"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
    </svg>
  );
}

function myTeamIcon(size = 28) {
  return (
    <svg viewBox="0 0 32 32" width={size} height={size} aria-hidden="true">
      <path
        d="M16 4 7 8v7.5C7 21.8 10.8 26.3 16 28c5.2-1.7 9-6.2 9-12.5V8l-9-4Z"
        fill="none"
        stroke="var(--accent)"
        strokeWidth="2"
        strokeLinejoin="round"
      />
      <ellipse
        cx="16"
        cy="16"
        rx="5.2"
        ry="3.4"
        transform="rotate(-30 16 16)"
        fill="none"
        stroke="var(--accent)"
        strokeWidth="1.8"
      />
      <path
        d="m14.2 17 3.6-2"
        fill="none"
        stroke="#ffffff"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
    </svg>
  );
}

function homeIcon(size = 28) {
  return (
    <svg viewBox="0 0 32 32" width={size} height={size} aria-hidden="true">
      <path
        d="M5 14.5 16 5l11 9.5"
        fill="none"
        stroke="var(--accent)"
        strokeWidth="2.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M9 13.5V26h14V13.5"
        fill="none"
        stroke="var(--accent)"
        strokeWidth="2"
        strokeLinejoin="round"
      />
      <path
        d="M13.5 26v-7h5v7"
        fill="none"
        stroke="#ffffff"
        strokeWidth="1.8"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/** Header nav (includes Home). */
export const headerNavItems: AppNavItem[] = [
  {
    to: '/',
    label: 'Home',
    match: (path) => path === '/',
    icon: homeIcon,
  },
  {
    to: '/seasons',
    label: 'Seasons',
    match: (path) => path.startsWith('/seasons') || path.startsWith('/season/'),
    icon: seasonsIcon,
  },
  {
    to: '/tools',
    label: 'Tools',
    match: (path) => path.startsWith('/tools'),
    icon: toolsIcon,
  },
  {
    to: '/import',
    label: 'Import',
    match: (path) => path.startsWith('/import'),
    icon: importIcon,
  },
  {
    to: '/insights',
    label: 'Insights',
    match: (path) => path.startsWith('/insights'),
    icon: insightsIcon,
  },
  {
    to: '/strategy',
    label: 'Strategy',
    match: (path) => path.startsWith('/strategy'),
    icon: strategyIcon,
  },
  {
    to: '/my-team',
    label: 'My Team',
    match: (path) => path.startsWith('/my-team'),
    icon: myTeamIcon,
  },
];

/** Home launchpad row (no Home tile). */
export const homeMenuItems = headerNavItems.filter((item) => item.to !== '/');
