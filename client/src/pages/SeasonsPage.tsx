import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { getOverview } from '../services/api';
import type { SeasonAnalysis } from '../types';
import { sortSeasonAnalyses } from '../utils/sort';

export default function SeasonsPage() {
  const [analyses, setAnalyses] = useState<SeasonAnalysis[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const sortedAnalyses = useMemo(
    () => sortSeasonAnalyses(analyses, 'asc'),
    [analyses]
  );

  useEffect(() => {
    getOverview()
      .then((data) => setAnalyses(data.analyses))
      .catch((err) => setError(String(err)))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <p className="status">Loading seasons...</p>;
  if (error) return <p className="error">{error}</p>;

  if (sortedAnalyses.length === 0) {
    return (
      <section className="panel">
        <h1>Your Draft History</h1>
        <p>No seasons imported yet.</p>
        <Link to="/import" className="button">
          Import your first draft
        </Link>
      </section>
    );
  }

  return (
    <section className="panel">
      <div className="panel-header">
        <h1>Your Draft History</h1>
        <Link to="/import" className="button secondary">
          Import season
        </Link>
      </div>
      <div className="season-grid">
        {sortedAnalyses.map((a) => (
            <Link key={a.season} to={`/season/${a.season}`} className="season-card">
              <h2>{a.season}</h2>
              <div className="grade-circle">{a.draftGrade}</div>
              <dl>
                <div>
                  <dt>Team</dt>
                  <dd>{a.userTeamName ?? 'Not set'}</dd>
                </div>
                <div>
                  <dt>Finish</dt>
                  <dd>{a.finalStanding ? `#${a.finalStanding}` : '—'}</dd>
                </div>
                <div>
                  <dt>Hit rate</dt>
                  <dd>{(a.hitRate * 100).toFixed(0)}%</dd>
                </div>
                <div>
                  <dt>Reach rate</dt>
                  <dd>{(a.reachRate * 100).toFixed(0)}%</dd>
                </div>
              </dl>
            </Link>
          ))}
      </div>
    </section>
  );
}
