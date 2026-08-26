import { useEffect, useMemo, useState } from 'react';
import EraCompare from '../components/EraCompare';
import { getTrends } from '../services/api';
import type { EraComparison, SeasonAnalysis } from '../types';
import { sortSeasonAnalyses } from '../utils/sort';

export default function TrendsPage() {
  const [analyses, setAnalyses] = useState<SeasonAnalysis[]>([]);
  const [eraComparison, setEraComparison] = useState<EraComparison | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const sortedAnalyses = useMemo(
    () => sortSeasonAnalyses(analyses, 'asc'),
    [analyses]
  );

  useEffect(() => {
    getTrends()
      .then((data) => {
        setAnalyses(data.analyses);
        setEraComparison(data.eraComparison);
      })
      .catch((err) => setError(String(err)))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <p className="status">Loading trends...</p>;
  if (error) return <p className="error">{error}</p>;

  return (
    <section className="panel">
      <h1>Draft Trends</h1>
      {eraComparison && <EraCompare eraComparison={eraComparison} />}

      <h2>Draft grade by season</h2>
      <div className="bar-chart">
        {sortedAnalyses.map((a) => (
          <div key={a.season} className="bar-row">
              <span className="bar-label">{a.season}</span>
              <div className="bar-track">
                <div
                  className="bar-fill"
                  style={{ width: `${a.draftGrade}%` }}
                  title={`Grade ${a.draftGrade}`}
                />
              </div>
              <span className="bar-value">{a.draftGrade}</span>
            </div>
          ))}
      </div>

      <h2>Hit / bust / reach rates</h2>
      <table className="data-table">
        <thead>
          <tr>
            <th>Season</th>
            <th>Hit rate</th>
            <th>Bust rate</th>
            <th>Reach rate</th>
            <th>Total value</th>
          </tr>
        </thead>
        <tbody>
          {sortedAnalyses.map((a) => (
              <tr key={a.season}>
                <td>{a.season}</td>
                <td>{(a.hitRate * 100).toFixed(0)}%</td>
                <td>{(a.bustRate * 100).toFixed(0)}%</td>
                <td>{(a.reachRate * 100).toFixed(0)}%</td>
                <td>{a.totalValue.toFixed(0)}</td>
              </tr>
            ))}
        </tbody>
      </table>
    </section>
  );
}
