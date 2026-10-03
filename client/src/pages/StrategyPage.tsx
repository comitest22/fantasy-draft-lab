import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import ContenderPlaybookView from '../components/ContenderPlaybookView';
import DraftRoutesView, { MarketPanel } from '../components/DraftRoutesView';
import EraCompare from '../components/EraCompare';
import KeyTakeaways from '../components/KeyTakeaways';
import LearningsList from '../components/LearningsList';
import PageTabs from '../components/PageTabs';
import { getStrategy } from '../services/api';
import type {
  ContenderPlaybook,
  DraftRouteBook,
  EraComparison,
  SotDocument,
  StrategyRecommendation,
} from '../types';
import {
  DEFAULT_FORMAT_ID,
  DEFAULT_TEAM_SIZE,
  LEAGUE_FORMATS,
  TEAM_SIZES,
} from '../utils/leagueFormats';

const tabs = [
  { id: 'routes', label: 'Routes' },
  { id: 'values', label: 'Values' },
  { id: 'landmines', label: 'Landmines' },
  { id: 'podium', label: 'Podium' },
  { id: 'learnings', label: 'Learnings' },
  { id: 'era', label: 'Era' },
  { id: 'research', label: 'Research' },
];

export default function StrategyPage() {
  const [recommendations, setRecommendations] = useState<StrategyRecommendation[]>([]);
  const [eraComparison, setEraComparison] = useState<EraComparison | null>(null);
  const [playbook, setPlaybook] = useState<ContenderPlaybook | null>(null);
  const [routes, setRoutes] = useState<DraftRouteBook | null>(null);
  const [sotDocs, setSotDocs] = useState<SotDocument[]>([]);
  const [loading, setLoading] = useState(true);
  const [switching, setSwitching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState('routes');
  const [teams, setTeams] = useState(DEFAULT_TEAM_SIZE);
  const [formatId, setFormatId] = useState(DEFAULT_FORMAT_ID);

  useEffect(() => {
    let cancelled = false;
    setSwitching(true);
    getStrategy(teams, formatId)
      .then((data) => {
        if (cancelled) return;
        setRecommendations(data.recommendations);
        setEraComparison(data.eraComparison);
        setPlaybook(data.playbook);
        setRoutes(data.routes);
        setSotDocs(data.sotDocs);
        setError(null);
      })
      .catch((err) => {
        if (!cancelled) setError(String(err));
      })
      .finally(() => {
        if (cancelled) return;
        setLoading(false);
        setSwitching(false);
      });
    return () => {
      cancelled = true;
    };
  }, [teams, formatId]);

  if (loading) return <p className="status">Loading strategy...</p>;
  if (error && !routes) return <p className="error">{error}</p>;

  const formatLabel = LEAGUE_FORMATS.find((f) => f.id === formatId)?.label ?? formatId;

  return (
    <section className="panel">
      <div className="page-intro">
        <Link to="/strategy" className="back-link">
          ← Strategy
        </Link>
        <h1>Draft Strategy</h1>
        <p className="subtitle">
          {routes
            ? `${routes.season} pick-by-pick path for a ${teams}-team ${formatLabel} league.`
            : 'Copy what podium teams actually do in this league.'}
        </p>
      </div>
      <div>
        <div className="league-format-bar">
          <label className="league-format-field">
            Teams
            <select
              value={teams}
              onChange={(e) => setTeams(Number(e.target.value))}
              disabled={switching}
            >
              {TEAM_SIZES.map((n) => (
                <option key={n} value={n}>
                  {n}-team
                </option>
              ))}
            </select>
          </label>
          <label className="league-format-field">
            Roster
            <select
              value={formatId}
              onChange={(e) => setFormatId(e.target.value)}
              disabled={switching}
            >
              {LEAGUE_FORMATS.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.label}
                </option>
              ))}
            </select>
          </label>
        </div>
        <PageTabs tabs={tabs} active={tab} onChange={setTab} label="Strategy sections" />
      </div>

      {switching && tab !== 'podium' && tab !== 'era' && (
        <p className="status">Updating path for {teams}-team {formatLabel}…</p>
      )}

      {tab === 'routes' && routes && (
        <DraftRoutesView
          key={`${teams}-${formatId}`}
          book={routes}
          showHeading={false}
          teams={teams}
          formatId={formatId}
        />
      )}

      {tab === 'values' && routes?.market && (
        <MarketPanel market={routes.market} showHeading={false} view="values" />
      )}

      {tab === 'landmines' && routes?.market && (
        <MarketPanel market={routes.market} showHeading={false} view="landmines" />
      )}

      {tab === 'podium' && playbook && (
        <ContenderPlaybookView playbook={playbook} showHeading={false} showAdvice={false} />
      )}

      {tab === 'learnings' && (
        <div className="insight-columns">
          <section>
            <h2>Learnings</h2>
            <LearningsList recommendations={recommendations} />
          </section>
          <section>
            <h2>Takeaways</h2>
            <KeyTakeaways takes={playbook?.timingAdvice ?? []} showHeading={false} />
          </section>
        </div>
      )}

      {tab === 'era' && eraComparison && (
        <EraCompare eraComparison={eraComparison} showHeading={false} />
      )}

      {tab === 'research' && (
        <div className="sot-grid">
          <article className="sot-card">
            <strong>Data sources</strong>
            <span className="sot-meta">Player stats and compare</span>
            <div className="sot-content">
              Offense and O-line ranks on player compare are 2026 expert consensus (Action Network + PFF + Sharp + public boards), with 2025 Action Network in parentheses.
            </div>
          </article>
          {sotDocs.map((doc) => (
            <details key={doc.slug} className="sot-card">
              <summary>
                <strong>{doc.title}</strong>
                <span className="sot-meta">
                  {doc.confidence} confidence · {doc.date}
                </span>
              </summary>
              <div className="sot-content">{doc.content}</div>
            </details>
          ))}
        </div>
      )}
    </section>
  );
}
