import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import KeyTakeaways from '../components/KeyTakeaways';
import PageLoading from '../components/PageLoading';
import PageTitle from '../components/PageTitle';
import { takeawaysIcon } from '../nav/homeFlyoutIcons';
import { getStrategy } from '../services/api';
import type { TimingAdvice } from '../types';

export default function TakeawaysPage() {
  const [takeaways, setTakeaways] = useState<TimingAdvice[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    getStrategy()
      .then((data) => {
        if (cancelled) return;
        setTakeaways(data.playbook?.timingAdvice ?? []);
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

  if (loading) return <PageLoading label="Collecting the takeaways…" />;

  return (
    <section className="panel">
      <div className="page-intro">
        <p className="crumb">
          <Link to="/insights">Insights</Link>
          <span aria-hidden="true"> › </span>
          Draft Takeaways
        </p>
        <PageTitle badge={takeawaysIcon(20)}>Draft Takeaways</PageTitle>
        <p className="subtitle">
          Podium timing advice from how top finishes were built in this league.
        </p>
      </div>
      {error && <p className="error">{error}</p>}
      {!error && <KeyTakeaways takes={takeaways} showHeading={false} />}
    </section>
  );
}
