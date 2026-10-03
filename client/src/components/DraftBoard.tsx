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
                  {pick.adp != null && pick.eosRank == null && pick.fantasyPoints == null ? (
                    <div className="pick-value">
                      ESPN #{Math.round(pick.adp)}
                      {pick.overallPick !== Math.round(pick.adp)
                        ? ` · ${pick.overallPick - pick.adp > 0 ? '+' : ''}${Math.round(pick.overallPick - pick.adp)} vs ADP`
                        : ''}
                    </div>
                  ) : pick.expectedPoints != null && pick.valueScore != null ? (
                    <div className="pick-value">
                      Value: {pick.valueScore > 0 ? '+' : ''}
                      {pick.valueScore.toFixed(0)}
                    </div>
                  ) : pick.expectedPoints == null && pick.adp != null && pick.eosRank != null ? (
                    <div className="pick-value">
                      Rank {Math.round(pick.adp)} →{' '}
                      {pick.eosRank >= 301 ? 'unranked' : pick.eosRank}
                    </div>
                  ) : null}
                </article>
              ))}
            </div>
          </section>
        );
      })}
    </div>
  );
}
