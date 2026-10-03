import { Link } from 'react-router-dom';

const tools = [
  {
    to: '/tools/sos',
    title: 'Strength of Schedule',
    detail: '2026 remaining-schedule ranks (List), weekly Offense matchups with Filter ROS / Top ranked, and a Defense weekly slate with the same controls.',
  },
  {
    to: '/tools/cheatsheet',
    title: 'Cheat Sheets',
    detail: 'PPR or Standard board you can check off as names come off the board.',
  },
];

export default function ToolsPage() {
  return (
    <section className="panel">
      <div className="page-intro">
        <h1>Tools</h1>
        <p className="subtitle">Draft helpers for this year’s board.</p>
      </div>
      <div className="tool-grid">
        {tools.map((tool) => (
          <Link key={tool.to} to={tool.to} className="tool-card">
            <h2>{tool.title}</h2>
            <p>{tool.detail}</p>
          </Link>
        ))}
      </div>
    </section>
  );
}
