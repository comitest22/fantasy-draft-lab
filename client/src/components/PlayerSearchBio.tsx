import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  BioPlayerLoadOverlay,
  BioPlayerLoadProvider,
} from './BioPlayerLoadGate';
import PlayerCompareDialog from './PlayerCompareDialog';
import PlayerNews from './PlayerNews';
import { getMyTeam } from '../services/api';
import type { MyTeamRosterView } from '../types';

/** Roster-style bio modal driven by `?player=` (header / Home search). No team strip. */
export default function PlayerSearchBio() {
  const [params, setParams] = useSearchParams();
  const selected = params.get('player');
  const articleUrl = params.get('article');
  const [team, setTeam] = useState<MyTeamRosterView | null>(null);

  useEffect(() => {
    if (!selected) return;
    let cancelled = false;
    getMyTeam()
      .then((data) => {
        if (!cancelled) setTeam(data);
      })
      .catch(() => {
        if (!cancelled) setTeam(null);
      });
    return () => {
      cancelled = true;
    };
  }, [selected]);

  if (!selected) return null;

  function openArticle(url: string) {
    const next = new URLSearchParams(params);
    next.set('player', selected!);
    next.set('article', url);
    setParams(next, { replace: true });
  }

  function backToNews() {
    const next = new URLSearchParams(params);
    next.set('player', selected!);
    next.delete('article');
    setParams(next, { replace: true });
  }

  function selectPlayer(name: string) {
    const next = new URLSearchParams(params);
    next.set('player', name);
    next.delete('article');
    setParams(next, { replace: true });
  }

  function closeBio() {
    const next = new URLSearchParams(params);
    next.delete('player');
    next.delete('article');
    setParams(next, { replace: true });
  }

  const inspectPlayer = team?.players.find((p) => p.name === selected);
  const rosterStatusByName = team
    ? Object.fromEntries(team.players.map((p) => [p.name, p.status]))
    : undefined;

  return (
    <div className="dialog-backdrop" onClick={closeBio} role="presentation">
      <div className="mt-player-bio-shell" onClick={(e) => e.stopPropagation()}>
        <div className="mt-player-bio-row">
          <div
            className="dialog mt-player-bio"
            role="dialog"
            aria-modal="true"
            aria-label={`${selected} player bio`}
          >
            <BioPlayerLoadProvider name={selected}>
              <PlayerCompareDialog
                solo
                variant="roster"
                leftName={selected}
                onClose={closeBio}
                ratingsPlatform={team?.platform ?? 'espn'}
                currentWeek={team?.currentWeek}
                weekProjectedPoints={inspectPlayer?.projectedPoints}
                playerPosition={inspectPlayer?.position}
                playerStatus={inspectPlayer?.status}
                rosterStatusByName={rosterStatusByName}
                onSelectPlayer={selectPlayer}
                news={
                  <PlayerNews
                    name={selected}
                    articleUrl={articleUrl}
                    onOpenArticle={(item) => openArticle(item.url)}
                    onBackToResults={backToNews}
                  />
                }
              />
              <BioPlayerLoadOverlay />
            </BioPlayerLoadProvider>
          </div>
          <div className="mt-player-bio-actions">
            <button
              type="button"
              className="mt-player-bio-close"
              onClick={closeBio}
              aria-label="Close"
            >
              ×
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
