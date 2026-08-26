import type { EraComparison } from '../types';

interface Props {
  eraComparison: EraComparison;
}

export default function EraCompare({ eraComparison }: Props) {
  const { goodEra, badEra, insights } = eraComparison;

  return (
    <section className="era-compare">
      <h2>Era Comparison</h2>
      <div className="era-grid">
        <div className="era-card good">
          <h3>{goodEra.label}</h3>
          <p className="era-seasons">{goodEra.seasons.join(', ') || 'No data'}</p>
          <dl>
            <div>
              <dt>Draft grade</dt>
              <dd>{goodEra.avgDraftGrade.toFixed(0)}</dd>
            </div>
            <div>
              <dt>Hit rate</dt>
              <dd>{(goodEra.avgHitRate * 100).toFixed(0)}%</dd>
            </div>
            <div>
              <dt>Bust rate</dt>
              <dd>{(goodEra.avgBustRate * 100).toFixed(0)}%</dd>
            </div>
            <div>
              <dt>Reach rate</dt>
              <dd>{(goodEra.avgReachRate * 100).toFixed(0)}%</dd>
            </div>
          </dl>
        </div>
        <div className="era-card bad">
          <h3>{badEra.label}</h3>
          <p className="era-seasons">{badEra.seasons.join(', ') || 'No data'}</p>
          <dl>
            <div>
              <dt>Draft grade</dt>
              <dd>{badEra.avgDraftGrade.toFixed(0)}</dd>
            </div>
            <div>
              <dt>Hit rate</dt>
              <dd>{(badEra.avgHitRate * 100).toFixed(0)}%</dd>
            </div>
            <div>
              <dt>Bust rate</dt>
              <dd>{(badEra.avgBustRate * 100).toFixed(0)}%</dd>
            </div>
            <div>
              <dt>Reach rate</dt>
              <dd>{(badEra.avgReachRate * 100).toFixed(0)}%</dd>
            </div>
          </dl>
        </div>
      </div>
      {insights.length > 0 && (
        <ul className="insights">
          {insights.map((insight) => (
            <li key={insight}>{insight}</li>
          ))}
        </ul>
      )}
    </section>
  );
}
