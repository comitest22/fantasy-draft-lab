import { Link, Outlet, useLocation } from 'react-router-dom';
import HeaderSearch from './HeaderSearch';

const navItems = [
  { to: '/', label: 'Home', match: (path: string) => path === '/' },
  { to: '/seasons', label: 'Seasons', match: (path: string) => path.startsWith('/seasons') || path.startsWith('/season/') },
  { to: '/tools', label: 'Tools', match: (path: string) => path.startsWith('/tools') },
  { to: '/import', label: 'Import', match: (path: string) => path.startsWith('/import') },
  { to: '/trends', label: 'Trends', match: (path: string) => path.startsWith('/trends') },
  { to: '/strategy', label: 'Strategy', match: (path: string) => path.startsWith('/strategy') },
];

export default function Layout() {
  const location = useLocation();

  return (
    <div className="app">
      <header className="header">
        <div className="header-inner">
          <Link to="/" className="brand" title="DontSuckAtFantasyDrafts">
            <img src="/dsafd-logo.png" alt="" className="brand-logo" width={32} height={32} />
            DSAFD
          </Link>
          <HeaderSearch />
          <nav className="nav">
            {navItems.map((item) => (
              <Link
                key={item.to}
                to={item.to}
                className={item.match(location.pathname) ? 'nav-link active' : 'nav-link'}
              >
                {item.label}
              </Link>
            ))}
          </nav>
        </div>
      </header>
      <main className="main">
        <Outlet />
      </main>
    </div>
  );
}
