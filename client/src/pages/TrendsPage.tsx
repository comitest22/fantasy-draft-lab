import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import ContenderPlaybookView from '../components/ContenderPlaybookView';
import EraCompare from '../components/EraCompare';
import PageLoading from '../components/PageLoading';
import PageTabs from '../components/PageTabs';
import PageTitle from '../components/PageTitle';
import { draftIcon } from '../nav/toolsMode';
import { getTrends } from '../services/api';
import type { ContenderPlaybook, EraComparison, SeasonAnalysis } from '../types';
import { sortSeasonAnalyses } from '../utils/sort';

const tabs = [
  { id: 'podium', label: 'Podium' },
  { id: 'era', label: 'Era' },
  { id: 'grades', label: 'Grades' },
  { id: 'rates', label: 'Rates' },
];

export default function TrendsPage() {
  const [analyses, setAnalyses] = useState<SeasonAnalysis[]>([]);
  const [eraComparison, setEraComparison] = useState<EraComparison | null>(null);
  const [playbook, setPlaybook] = useState<ContenderPlaybook | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState('podium');

  const sortedAnalyses = useMemo(() => sortSeasonAnalyses(analyses, 'desc'), [analyses]);

  useEffect(() => {
    getTrends()
      .then((data) => {
        setAnalyses(data.analyses);
        setEraComparison(data.eraComparison);
        setPlaybook(data.playbook);
      })
      .catch((err) => setError(String(err)))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <PageLoading label="Reading the tape…" />;
  if (error) return <p className="error">{error}</p>;

  return (
    <section className="panel">
      <div className="page-intro">
        <p className="crumb">
          <Link to="/tools">Tools</Link>
          <span aria-hidden="true"> › </span>
          <Link to="/tools?toolkit=draft">Draft</Link>
          <span aria-hidden="true"> › </span>
          Draft Trends
        </p>
        <PageTitle badge={draftIcon(20)}>Draft Trends</PageTitle>
        <p className="subtitle">
          How podium teams draft in this league, and how your seasons compare.
        </p>
      </div>
      <PageTabs tabs={tabs} active={tab} onChange={setTab} label="Trends sections" />

      {tab === 'podium' && playbook && (
        <ContenderPlaybookView playbook={playbook} showHeading={false} showAdvice={false} />
      )}
      {tab === 'era' && eraComparison && (
        <EraCompare eraComparison={eraComparison} showHeading={false} />
      )}
      {tab === 'grades' && (
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
      )}
      {tab === 'rates' && (
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
      )}
    </section>
  );
}
