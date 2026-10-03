import type { OpeningPick, PodiumTeamSnapshot } from '../types';
import { formatOpening } from '../utils/opening';

interface Props {
  podium: PodiumTeamSnapshot[];
  userTeamName?: string;
  userDraftSlot?: number;
  userFirstThree?: OpeningPick[];
  userGrade: number;
}

function placeLabel(n: number): string {
  if (n === 1) return 'Champion';
  if (n === 2) return '2nd';
  if (n === 3) return '3rd';
  return `${n}th`;
}

export default function PodiumCompare({
  podium,
  userTeamName,
  userDraftSlot,
  userFirstThree,
  userGrade,
}: Props) {
  if (podium.length === 0) return null;

  return (
    <section>
      <h2>This year’s podium</h2>
      <p className="subtitle">
        Copy the opening shape, not just the players. Your picks are last for
        comparison.
      </p>
      <div className="podium-grid">
        {podium.map((team) => (
          <article
            key={`${team.standing}-${team.teamName}`}
            className={`podium-card place-${team.standing}`}
          >
            <header>
              <span className="podium-place">{placeLabel(team.standing)}</span>
              <span className="podium-slot">
                Slot {team.draftSlot ?? '—'} · grade {team.draftGrade}
              </span>
            </header>
            <strong>{team.teamName}</strong>
            <p className="podium-open">{formatOpening(team.firstThree)}</p>
            <span className="podium-shape">{team.firstThreePos}</span>
          </article>
        ))}
        {userTeamName && (
          <article className="podium-card place-you">
            <header>
              <span className="podium-place">You</span>
              <span className="podium-slot">
                Slot {userDraftSlot ?? '—'} · grade {userGrade}
              </span>
            </header>
            <strong>{userTeamName}</strong>
            <p className="podium-open">{formatOpening(userFirstThree)}</p>
            <span className="podium-shape">
              {userFirstThree?.map((p) => p.position).join('-') || '—'}
            </span>
          </article>
        )}
      </div>
    </section>
  );
}
