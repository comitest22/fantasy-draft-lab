import type { ReactNode } from 'react';
import {
  learningsIcon,
  survivorLoseIcon,
  survivorWinIcon,
  takeawaysIcon,
  tdStreakIcon,
} from './homeFlyoutIcons';
import { draftIcon, inSeasonIcon, toolsModeMeta } from './toolsMode';

export type NavFlyoutId = 'tools' | 'insights' | 'strategy';

export type NavFlyoutChoice = {
  to: string;
  label: string;
  icon: (size?: number) => ReactNode;
};

export const navFlyouts: Record<
  NavFlyoutId,
  { ariaLabel: string; choices: NavFlyoutChoice[] }
> = {
  tools: {
    ariaLabel: 'Tools toolkits',
    choices: [
      {
        to: '/tools?toolkit=in-season',
        label: toolsModeMeta['in-season'].label,
        icon: inSeasonIcon,
      },
      {
        to: '/tools?toolkit=draft',
        label: toolsModeMeta.draft.label,
        icon: draftIcon,
      },
    ],
  },
  insights: {
    ariaLabel: 'Insights pages',
    choices: [
      { to: '/insights/learnings', label: 'Draft Learnings', icon: learningsIcon },
      { to: '/insights/takeaways', label: 'Draft Takeaways', icon: takeawaysIcon },
    ],
  },
  strategy: {
    ariaLabel: 'Strategy pages',
    choices: [
      { to: '/strategy/draft', label: 'Draft', icon: draftIcon },
      { to: '/strategy/survivor', label: 'NFL Survivor', icon: survivorWinIcon },
      {
        to: '/strategy/survivor-loser',
        label: 'NFL Survivor Loser',
        icon: survivorLoseIcon,
      },
      { to: '/strategy/td-streak', label: 'TD Streak', icon: tdStreakIcon },
    ],
  },
};

export const navFlyoutByPath: Record<string, NavFlyoutId> = {
  '/tools': 'tools',
  '/insights': 'insights',
  '/strategy': 'strategy',
};
