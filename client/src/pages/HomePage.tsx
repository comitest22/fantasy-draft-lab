import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import KeyTakeaways from '../components/KeyTakeaways';
import LearningsList from '../components/LearningsList';
import PlayerCompareDialog from '../components/PlayerCompareDialog';
import PlayerNews from '../components/PlayerNews';
import { getStrategy } from '../services/api';
import type { StrategyRecommendation, TimingAdvice } from '../types';

export default function HomePage() {
  const [params, setParams] = useSearchParams();
  const selected = params.get('player');
  const articleUrl = params.get('article');
  const [recommendations, setRecommendations] = useState<StrategyRecommendation[]>([]);
  const [takeaways, setTakeaways] = useState<TimingAdvice[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (selected) window.scrollTo({ top: 0 });
  }, [selected, articleUrl]);

  useEffect(() => {
    if (selected) return;
    let cancelled = false;
    getStrategy()
      .then((data) => {
        if (cancelled) return;
        setRecommendations(data.recommendations);
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
  }, [selected]);

  function openArticle(url: string) {
    if (!selected) return;
    setParams({ player: selected, article: url });
  }

  function backToNews() {
    if (!selected) return;
    setParams({ player: selected });
  }

  function backToHome() {
    setParams({});
  }

  if (selected) {
    return (
      <section className="player-page">
        <button type="button" className="back-link player-page-back" onClick={backToHome}>
          ← Back
        </button>
        <div className="player-page-grid">
          <PlayerCompareDialog
            solo
            variant="page"
            leftName={selected}
            onClose={backToHome}
          />
          <PlayerNews
            name={selected}
            articleUrl={articleUrl}
            onOpenArticle={(item) => openArticle(item.url)}
            onBackToResults={backToNews}
          />
        </div>
      </section>
    );
  }

  return (
    <section className="panel">
      <div className="page-intro">
        <h1>DontSuckAtFantasyDrafts</h1>
        <p className="subtitle">
          What this league’s drafts actually teach — learnings from the path, takeaways from the
          podium.
        </p>
      </div>
      {loading && <p className="status">Loading notes…</p>}
      {error && <p className="error">{error}</p>}
      {!loading && !error && (
        <div className="insight-columns">
          <section>
            <h2>Learnings</h2>
            <LearningsList recommendations={recommendations} />
          </section>
          <section>
            <h2>Takeaways</h2>
            <KeyTakeaways takes={takeaways} showHeading={false} />
          </section>
        </div>
      )}
    </section>
  );
}
