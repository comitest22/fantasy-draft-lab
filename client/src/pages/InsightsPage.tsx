import { Link } from 'react-router-dom';
import PageTitle from '../components/PageTitle';

const cards = [
  {
    to: '/insights/learnings',
    title: 'Draft Learnings',
    detail:
      'What this league’s draft paths actually teach — strategy notes backed by SOT research and expert takeaways.',
  },
  {
    to: '/insights/takeaways',
    title: 'Draft Takeaways',
    detail:
      'Podium timing advice from how top finishes were built — when to fill the lineup vs chase upside.',
  },
];

/** Hub — same card pattern as Tools. */
export default function InsightsPage() {
  return (
    <section className="panel">
      <div className="page-intro">
        <PageTitle>Insights</PageTitle>
        <p className="subtitle">
          What this league’s drafts actually teach — learnings from the path, takeaways from the
          podium.
        </p>
      </div>
      <div className="tool-grid">
        {cards.map((card) => (
          <Link key={card.to} to={card.to} className="tool-card">
            <h2>{card.title}</h2>
            <p>{card.detail}</p>
          </Link>
        ))}
      </div>
    </section>
  );
}
