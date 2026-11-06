import { Link, useSearchParams } from 'react-router-dom';
import PageTitle from '../components/PageTitle';
import { parseToolkit, toolsModeMeta } from '../nav/toolsMode';

const tools = [
  {
    to: '/tools/sos',
    title: 'Strength of Schedule',
    detail:
      '2026 remaining-schedule ranks (List), weekly Offense matchups with Filter ROS / Top ranked, and a Defense weekly slate with the same controls.',
    mode: 'in-season' as const,
  },
  {
    to: '/tools/cheatsheet',
    title: 'Cheat Sheets',
    detail: 'PPR or Standard board you can check off as names come off the board.',
    mode: 'draft' as const,
  },
  {
    to: '/tools/trends',
    title: 'Draft Trends',
    detail: 'Podium patterns, era compare, draft grades, and hit/bust rates across your seasons.',
    mode: 'draft' as const,
  },
];

export default function ToolsPage() {
  const [params] = useSearchParams();
  const mode = parseToolkit(params.get('toolkit'));
  const visible = mode ? tools.filter((t) => t.mode === mode) : tools;
  const badge = mode ? toolsModeMeta[mode].icon(20) : undefined;

  return (
    <section className="panel">
      <div className="tools-hub-body">
        <div className="page-intro">
          {mode ? (
            <p className="crumb">
              <Link to="/tools">Tools</Link>
              <span aria-hidden="true"> › </span>
              {toolsModeMeta[mode].label}
            </p>
          ) : null}
          <PageTitle badge={badge}>{mode ? toolsModeMeta[mode].title : 'Tools'}</PageTitle>
          {!mode ? (
            <p className="subtitle">In-season boards and draft-day checklists for this league.</p>
          ) : null}
        </div>
        <div className="tool-grid">
          {visible.map((tool) => (
            <Link key={tool.to} to={tool.to} className="tool-card">
              <h2>{tool.title}</h2>
              <p>{tool.detail}</p>
            </Link>
          ))}
        </div>
      </div>
    </section>
  );
}
