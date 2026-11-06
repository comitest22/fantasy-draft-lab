import { useCallback, useState } from 'react';
import { Link } from 'react-router-dom';
import HeaderSearch from '../components/HeaderSearch';
import NavFlyoutMenu from '../components/NavFlyoutMenu';
import { homeMenuItems } from '../nav/appNav';
import { navFlyoutByPath, type NavFlyoutId } from '../nav/homeFlyouts';

export default function HomePage() {
  const [openFlyout, setOpenFlyout] = useState<NavFlyoutId | null>(null);

  const closeFlyout = useCallback(() => setOpenFlyout(null), []);

  function toggleFlyout(id: NavFlyoutId) {
    setOpenFlyout((current) => (current === id ? null : id));
  }

  return (
    <section className="panel home-landing">
      <div className="home-launch">
        <div className="home-hero">
          <div className="home-brand">
            <img src="/dsafd-logo.png" alt="" className="home-brand-logo" width={76} height={76} />
            <h1 className="home-brand-title">B.L.I.T.Z.</h1>
          </div>
          <p className="subtitle home-acronym">
            Boards, Lineups, Insights, Tools, &amp; Zero-suck
          </p>
        </div>
        <div className="home-controls">
          <div className="home-search-wrap">
            <HeaderSearch />
          </div>
          <nav className="home-menu-grid" aria-label="Main navigation">
            {homeMenuItems.map((item) => {
              const flyoutId = navFlyoutByPath[item.to];
              if (!flyoutId) {
                return (
                  <Link key={item.to} to={item.to} className="home-menu-btn">
                    <span className="home-menu-icon">{item.icon(28)}</span>
                    <span className="home-menu-label">{item.label}</span>
                  </Link>
                );
              }

              const isOpen = openFlyout === flyoutId;
              const panelId = `home-${flyoutId}-sub`;

              return (
                <NavFlyoutMenu
                  key={item.to}
                  id={flyoutId}
                  open={isOpen}
                  onClose={closeFlyout}
                  panelId={panelId}
                  className="home-menu-flyout"
                >
                  <button
                    type="button"
                    className={`home-menu-btn${isOpen ? ' is-active' : ''}`}
                    onClick={() => toggleFlyout(flyoutId)}
                    aria-expanded={isOpen}
                    aria-controls={panelId}
                  >
                    <span className="home-menu-icon">{item.icon(28)}</span>
                    <span className="home-menu-label">{item.label}</span>
                  </button>
                </NavFlyoutMenu>
              );
            })}
          </nav>
        </div>
      </div>
    </section>
  );
}
