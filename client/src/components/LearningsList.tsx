import type { StrategyRecommendation } from '../types';

const severityClass = {
  info: 'severity-info',
  warning: 'severity-warning',
  critical: 'severity-critical',
};

interface Props {
  recommendations: StrategyRecommendation[];
}

export default function LearningsList({ recommendations }: Props) {
  if (recommendations.length === 0) {
    return <p>Import standings and drafts to generate contender recommendations.</p>;
  }

  return (
    <div className="rec-list">
      {recommendations.map((rec) => (
        <article key={rec.id} className={`rec-card ${severityClass[rec.severity]}`}>
          <h3>{rec.title}</h3>
          <p>{rec.detail}</p>
          {rec.sources && rec.sources.length > 0 && (
            <p className="rec-sources">Sources: {rec.sources.join(', ')}</p>
          )}
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
  );
}
