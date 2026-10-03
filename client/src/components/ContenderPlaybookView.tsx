import type { ContenderPlaybook } from '../types';
import { formatOpening } from '../utils/opening';

function pct(n: number): string {
  return `${Math.round(n * 100)}%`;
}

interface Props {
  playbook: ContenderPlaybook;
  showHeading?: boolean;
  showAdvice?: boolean;
}

export default function ContenderPlaybookView({
  playbook,
  showHeading = true,
  showAdvice = true,
}: Props) {
  if (playbook.seasons === 0 || playbook.slotOutcomes.length === 0) {
    return (
      <p className="subtitle">
        Import league standings to compare podium drafts against yours.
      </p>
    );
  }

  const { timing } = playbook;
  const maxTop3 = Math.max(...playbook.slotOutcomes.map((s) => s.top3Rate), 0.01);
  const winners = playbook.franchises.filter((f) => !f.isUser).slice(0, 5);
  const you = playbook.franchises.find((f) => f.isUser);

  return (
    <section className="contender-playbook">
      {showHeading && <h2>Podium</h2>}
      <p className="subtitle">
        {playbook.seasons} seasons · {`${playbook.leagueSize}-team`} PPR snake · final
        standings vs draft slot
      </p>

      <div className="stats-row">
        <div className="stat">
          <span>Podium first RB</span>
          <strong>Round {timing.top3.rb1.toFixed(1)}</strong>
        </div>
        <div className="stat">
          <span>Your first RB</span>
          <strong>Round {timing.user.rb1.toFixed(1)}</strong>
        </div>
        <div className="stat">
          <span>Podium first WR</span>
          <strong>Round {timing.top3.wr1.toFixed(1)}</strong>
        </div>
        <div className="stat">
          <span>Podium first TE</span>
          <strong>Round {timing.top3.te1.toFixed(1)}</strong>
        </div>
        <div className="stat">
          <span>Podium bust rate</span>
          <strong>{pct(timing.top3.bustRate)}</strong>
        </div>
        <div className="stat">
          <span>Your bust rate</span>
          <strong>{pct(timing.user.bustRate)}</strong>
        </div>
      </div>

      <h3>Draft slot vs finishing</h3>
      <p className="subtitle">Lower average finish is better. Bar is top-3 rate.</p>
      <table className="data-table slot-table">
        <thead>
          <tr>
            <th>Slot</th>
            <th>Average finish</th>
            <th>Titles</th>
            <th>Top-3 rate</th>
          </tr>
        </thead>
        <tbody>
          {playbook.slotOutcomes.map((s) => (
            <tr key={s.slot}>
              <td>{s.slot}</td>
              <td>{s.avgFinish.toFixed(2)}</td>
              <td>{s.titles}</td>
              <td>
                <div className="slot-rate">
                  <div className="bar-track">
                    <div
                      className="bar-fill"
                      style={{ width: `${(s.top3Rate / maxTop3) * 100}%` }}
                    />
                  </div>
                  <span>{pct(s.top3Rate)}</span>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <h3>First-starter timing (you vs podium)</h3>
      <table className="data-table">
        <thead>
          <tr>
            <th></th>
            <th>Podium</th>
            <th>You</th>
            <th>League</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>First RB</td>
            <td>Round {timing.top3.rb1.toFixed(1)}</td>
            <td>Round {timing.user.rb1.toFixed(1)}</td>
            <td>Round {timing.league.rb1.toFixed(1)}</td>
          </tr>
          <tr>
            <td>Second RB</td>
            <td>{timing.top3.rb2 > 0 ? `Round ${timing.top3.rb2.toFixed(1)}` : '—'}</td>
            <td>{timing.user.rb2 > 0 ? `Round ${timing.user.rb2.toFixed(1)}` : '—'}</td>
            <td>{timing.league.rb2 > 0 ? `Round ${timing.league.rb2.toFixed(1)}` : '—'}</td>
          </tr>
          <tr>
            <td>First WR</td>
            <td>Round {timing.top3.wr1.toFixed(1)}</td>
            <td>Round {timing.user.wr1.toFixed(1)}</td>
            <td>Round {timing.league.wr1.toFixed(1)}</td>
          </tr>
          <tr>
            <td>Second WR</td>
            <td>{timing.top3.wr2 > 0 ? `Round ${timing.top3.wr2.toFixed(1)}` : '—'}</td>
            <td>{timing.user.wr2 > 0 ? `Round ${timing.user.wr2.toFixed(1)}` : '—'}</td>
            <td>{timing.league.wr2 > 0 ? `Round ${timing.league.wr2.toFixed(1)}` : '—'}</td>
          </tr>
          <tr>
            <td>First QB</td>
            <td>Round {timing.top3.qb1.toFixed(1)}</td>
            <td>Round {timing.user.qb1.toFixed(1)}</td>
            <td>Round {timing.league.qb1.toFixed(1)}</td>
          </tr>
          <tr>
            <td>First TE</td>
            <td>Round {timing.top3.te1.toFixed(1)}</td>
            <td>Round {timing.user.te1.toFixed(1)}</td>
            <td>Round {timing.league.te1.toFixed(1)}</td>
          </tr>
          <tr>
            <td>Hit rate</td>
            <td>{pct(timing.top3.hitRate)}</td>
            <td>{pct(timing.user.hitRate)}</td>
            <td>{pct(timing.league.hitRate)}</td>
          </tr>
        </tbody>
      </table>

      {showAdvice && (playbook.timingAdvice?.length ?? 0) > 0 && (
        <div className="timing-advice">
          <p className="subtitle">
            What actually moves podium rate from this table — not a different position, a finished
            lineup and fewer busts.
          </p>
          {(playbook.timingAdvice ?? []).map((take) => (
            <article key={take.id} className="timing-take">
              <h4>{take.title}</h4>
              <p>{take.detail}</p>
            </article>
          ))}
        </div>
      )}

      {winners.length > 0 && (
        <>
          <h3>Repeat contenders</h3>
          <table className="data-table">
            <thead>
              <tr>
                <th>Franchise</th>
                <th>Titles</th>
                <th>Top 3</th>
                <th>Average finish</th>
              </tr>
            </thead>
            <tbody>
              {winners.map((f) => (
                <tr key={f.displayName}>
                  <td>{f.displayName}</td>
                  <td>{f.titles}</td>
                  <td>{f.top3}</td>
                  <td>{f.avgFinish.toFixed(2)}</td>
                </tr>
              ))}
              {you && (
                <tr className="user-row">
                  <td>You ({you.displayName})</td>
                  <td>{you.titles}</td>
                  <td>{you.top3}</td>
                  <td>{you.avgFinish.toFixed(2)}</td>
                </tr>
              )}
            </tbody>
          </table>
        </>
      )}

      <h3>Every champion’s first three</h3>
      <table className="data-table">
        <thead>
          <tr>
            <th>Year</th>
            <th>Champion</th>
            <th>Slot</th>
            <th>Picks 1–3</th>
          </tr>
        </thead>
        <tbody>
          {playbook.champions.map((c) => (
            <tr key={c.season}>
              <td>{c.season}</td>
              <td>{c.teamName}</td>
              <td>{c.draftSlot ?? '—'}</td>
              <td>{formatOpening(c.firstThree)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
