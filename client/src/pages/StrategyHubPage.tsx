import { Link } from 'react-router-dom';

const cards = [
  {
    to: '/strategy/draft',
    title: 'Draft',
    detail: 'Pick-by-pick routes, values, landmines, podium, learnings, and research for this league.',
  },
  {
    to: '/strategy/survivor',
    title: 'NFL Survivor',
    detail: 'Winner-take-all knockout. Week board, season grid, and multi-entry pick paths from the PoolGenius Data Grid.',
  },
  {
    to: '/strategy/survivor-loser',
    title: 'NFL Survivor Loser',
    detail: 'Pick a team to lose each week. Same PoolGenius odds inverted for dogs, including multi-entry pick paths.',
  },
  {
    to: '/strategy/td-streak',
    title: 'TD Streak',
    detail: 'Anytime-TD player path. Week 1 is two primaries (either TD advances) plus an alternate; later weeks one name plus an alternate.',
  },
];

export default function StrategyHubPage() {
  return (
    <section className="panel">
      <div className="page-intro">
        <h1>Strategy</h1>
        <p className="subtitle">Draft work plus the three in-season survivor leagues.</p>
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
