import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import LearningsList from '../components/LearningsList';
import PageLoading from '../components/PageLoading';
import PageTitle from '../components/PageTitle';
import { learningsIcon } from '../nav/homeFlyoutIcons';
import { getStrategy } from '../services/api';
import type { StrategyRecommendation } from '../types';

export default function LearningsPage() {
  const [recommendations, setRecommendations] = useState<StrategyRecommendation[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    getStrategy()
      .then((data) => {
        if (cancelled) return;
        setRecommendations(data.recommendations);
        setError(null);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (loading) return <PageLoading label="Studying the film…" />;

  return (
    <section className="panel">
      <div className="page-intro">
        <p className="crumb">
          <Link to="/insights">Insights</Link>
          <span aria-hidden="true"> › </span>
          Draft Learnings
        </p>
        <PageTitle badge={learningsIcon(20)}>Draft Learnings</PageTitle>
        <p className="subtitle">
          Strategy notes from this league’s draft paths, with research sources.
        </p>
      </div>
      {error && <p className="error">{error}</p>}
      {!error && <LearningsList recommendations={recommendations} />}
    </section>
  );
}
