import type { ReactNode } from 'react';

export type ToolsMode = 'in-season' | 'draft';

export function parseToolkit(raw: string | null): ToolsMode | null {
  if (raw === 'in-season' || raw === 'draft') return raw;
  return null;
}

export function inSeasonIcon(size = 36) {
  return (
    <svg viewBox="0 0 32 32" width={size} height={size} aria-hidden="true">
      <rect
        x="6"
        y="8"
        width="20"
        height="18"
        rx="3"
        fill="none"
        stroke="var(--accent)"
        strokeWidth="2"
      />
      <path d="M6 13h20" fill="none" stroke="var(--accent)" strokeWidth="2" />
      <path
        d="M11 6v4M21 6v4"
        fill="none"
        stroke="#ffffff"
        strokeWidth="2"
        strokeLinecap="round"
      />
      <circle cx="12" cy="18" r="1.4" fill="var(--accent)" />
      <circle cx="16" cy="18" r="1.4" fill="var(--accent)" />
      <circle cx="20" cy="18" r="1.4" fill="var(--accent)" />
      <circle cx="12" cy="22.5" r="1.4" fill="var(--accent)" />
      <circle cx="16" cy="22.5" r="1.4" fill="var(--accent)" />
    </svg>
  );
}

export function draftIcon(size = 36) {
  return (
    <svg viewBox="0 0 32 32" width={size} height={size} aria-hidden="true">
      <path
        d="M9 5h11l5 5v17a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2z"
        fill="none"
        stroke="var(--accent)"
        strokeWidth="2"
      />
      <path d="M20 5v5h5" fill="none" stroke="var(--accent)" strokeWidth="2" />
      <path
        d="M11 15h10M11 19h10M11 23h6"
        fill="none"
        stroke="#ffffff"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
    </svg>
  );
}

export const toolsModeMeta: Record<
  ToolsMode,
  { label: string; title: string; icon: (size?: number) => ReactNode }
> = {
  'in-season': {
    label: 'In Season',
    title: 'In Season Tools',
    icon: inSeasonIcon,
  },
  draft: {
    label: 'Draft',
    title: 'Draft Tools',
    icon: draftIcon,
  },
};
