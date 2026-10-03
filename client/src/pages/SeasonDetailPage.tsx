import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import ConfirmDialog from '../components/ConfirmDialog';
import DraftBoard from '../components/DraftBoard';
import PodiumCompare from '../components/PodiumCompare';
import { deleteSeason, getDraftSeason } from '../services/api';
import type { DraftFile, SeasonAnalysis } from '../types';

export default function SeasonDetailPage() {
  const { season } = useParams();
  const navigate = useNavigate();
  const [draft, setDraft] = useState<DraftFile | null>(null);
  const [analysis, setAnalysis] = useState<SeasonAnalysis | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    if (!season) return;
    getDraftSeason(parseInt(season, 10))
      .then((data) => {
        setDraft(data.draft);
        setAnalysis(data.analysis);
      })
      .catch((err) => setError(String(err)))
      .finally(() => setLoading(false));
  }, [season]);

  async function handleDelete() {
    if (!draft) return;
    setDeleting(true);
    setError(null);
    try {
      await deleteSeason(draft.season);
      navigate('/seasons');
    } catch (err) {
      setError(String(err));
      setConfirmOpen(false);
    } finally {
      setDeleting(false);
    }
  }

  if (loading) return <p className="status">Loading draft...</p>;
  if (error && !draft) return <p className="error">{error}</p>;
  if (!draft || !analysis) return <p className="error">Draft not found</p>;

  const userPicks = analysis.picks.filter((p) => p.isUserPick);

  return (
    <section className="panel">
      <div className="panel-header">
        <div>
          <Link to="/seasons" className="back-link">
            ← All seasons
          </Link>
          <h1>{draft.season} Draft</h1>
          <p className="subtitle">
            {analysis.userTeamName ?? 'Team not mapped'} · Draft grade{' '}
            {analysis.draftGrade}
          </p>
        </div>
        <button
          type="button"
          className="button danger-outline"
          onClick={() => setConfirmOpen(true)}
        >
          Delete season
        </button>
      </div>

      {error && <p className="error">{error}</p>}

      <ConfirmDialog
        open={confirmOpen}
        title={`Delete ${draft.season} season?`}
        message={`This will permanently remove the ${draft.season} draft and its team mapping. You can re-import it later from an ESPN export.`}
        confirmLabel="Delete season"
        onConfirm={handleDelete}
        onCancel={() => setConfirmOpen(false)}
        loading={deleting}
      />

      <div className="stats-row">
        <div className="stat">
          <span>Total value</span>
          <strong>{analysis.totalValue.toFixed(0)}</strong>
        </div>
        <div className="stat">
          <span>Hit rate</span>
          <strong>{(analysis.hitRate * 100).toFixed(0)}%</strong>
        </div>
        <div className="stat">
          <span>Bust rate</span>
          <strong>{(analysis.bustRate * 100).toFixed(0)}%</strong>
        </div>
        <div className="stat">
          <span>Reach rate</span>
          <strong>{(analysis.reachRate * 100).toFixed(0)}%</strong>
        </div>
      </div>

      {analysis.insights.length > 0 && (
        <ul className="insights">
          {analysis.insights.map((i) => (
            <li key={i}>{i}</li>
          ))}
        </ul>
      )}

      <PodiumCompare
        podium={analysis.podium ?? []}
        userTeamName={analysis.userTeamName}
        userDraftSlot={analysis.userDraftSlot}
        userFirstThree={analysis.userFirstThree}
        userGrade={analysis.draftGrade}
      />

      <h2>Your picks</h2>
      <DraftBoard picks={userPicks} highlightUser />

      <h2>Positional timing</h2>
      <table className="data-table">
        <thead>
          <tr>
            <th>Position</th>
            <th>Your 1st pick</th>
            <th>League average</th>
            <th>Podium average</th>
          </tr>
        </thead>
        <tbody>
          {analysis.positionalTiming.map((pt) => (
            <tr key={pt.position}>
              <td>{pt.position}</td>
              <td>{pt.userRound ?? '—'}</td>
              <td>{pt.leagueAvgRound.toFixed(1)}</td>
              <td>{pt.top3AvgRound.toFixed(1)}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <h2>Full draft board</h2>
      <DraftBoard picks={analysis.picks} />
    </section>
  );
}
