import type { GradedPick, PickGrade } from '../types';

const gradeClass: Record<PickGrade, string> = {
  hit: 'grade-hit',
  steal: 'grade-steal',
  fair: 'grade-fair',
  reach: 'grade-reach',
  bust: 'grade-bust',
  rookie: 'grade-rookie',
  unknown: 'grade-unknown',
};

interface Props {
  picks: GradedPick[];
  highlightUser?: boolean;
}

export default function DraftBoard({ picks, highlightUser = true }: Props) {
  const rounds = [...new Set(picks.map((p) => p.round))].sort((a, b) => a - b);

  return (
    <div className="draft-board">
      {rounds.map((round) => {
        const roundPicks = picks
          .filter((p) => p.round === round)
          .sort((a, b) => a.pickInRound - b.pickInRound);

        return (
          <section key={round} className="round-section">
            <h3>Round {round}</h3>
            <div className="pick-grid">
              {roundPicks.map((pick) => (
                <article
                  key={`${pick.overallPick}-${pick.playerName}`}
                  className={`pick-card ${gradeClass[pick.grade]} ${
                    highlightUser && pick.isUserPick ? 'user-pick' : ''
                  }`}
                >
                  <div className="pick-meta">
                    <span>#{pick.overallPick}</span>
                    <span className={`grade-badge ${gradeClass[pick.grade]}`}>
                      {pick.grade}
                    </span>
                  </div>
                  <strong>{pick.playerName}</strong>
                  <div className="pick-detail">
                    {pick.position} · {pick.nflTeam}
                  </div>
                  <div className="pick-team">{pick.fantasyTeamName}</div>
                  {pick.valueScore != null && (
                    <div className="pick-value">
                      Value: {pick.valueScore > 0 ? '+' : ''}
                      {pick.valueScore.toFixed(0)}
                    </div>
                  )}
                </article>
              ))}
            </div>
          </section>
        );
      })}
    </div>
  );
}
