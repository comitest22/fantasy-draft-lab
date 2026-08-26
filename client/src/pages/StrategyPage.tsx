import { useEffect, useState } from 'react';
import EraCompare from '../components/EraCompare';
import { getStrategy } from '../services/api';
import type { EraComparison, StrategyRecommendation, SotDocument } from '../types';

const severityClass = {
  info: 'severity-info',
  warning: 'severity-warning',
  critical: 'severity-critical',
};

export default function StrategyPage() {
  const [recommendations, setRecommendations] = useState<StrategyRecommendation[]>([]);
  const [eraComparison, setEraComparison] = useState<EraComparison | null>(null);
  const [sotDocs, setSotDocs] = useState<SotDocument[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getStrategy()
      .then((data) => {
        setRecommendations(data.recommendations);
        setEraComparison(data.eraComparison);
        setSotDocs(data.sotDocs);
      })
      .catch((err) => setError(String(err)))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <p className="status">Loading strategy...</p>;
  if (error) return <p className="error">{error}</p>;

  return (
    <section className="panel">
      <h1>Draft Strategy</h1>
      <p className="subtitle">
        Recommendations based on your historical drafts and SOT research library.
      </p>

      {eraComparison && <EraCompare eraComparison={eraComparison} />}

      <h2>Recommendations</h2>
      {recommendations.length === 0 ? (
        <p>Import more seasons to generate strategy recommendations.</p>
      ) : (
        <div className="rec-list">
          {recommendations.map((rec) => (
            <article key={rec.id} className={`rec-card ${severityClass[rec.severity]}`}>
              <h3>{rec.title}</h3>
              <p>{rec.detail}</p>
              {rec.citations && rec.citations.length > 0 && (
                <div className="citations">
                  <strong>Sources:</strong>
                  <ul>
                    {rec.citations.map((c) => (
                      <li key={c.slug}>{c.title}</li>
                    ))}
                  </ul>
                </div>
              )}
            </article>
          ))}
        </div>
      )}

      <h2>Research library (SOT)</h2>
      <div className="sot-grid">
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
    </section>
  );
}
