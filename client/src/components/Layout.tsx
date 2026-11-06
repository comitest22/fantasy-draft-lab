import { useCallback, useEffect, useState } from 'react';
import { Link, Outlet, useLocation } from 'react-router-dom';
import { headerNavItems } from '../nav/appNav';
import { navFlyoutByPath, type NavFlyoutId } from '../nav/homeFlyouts';
import HeaderSearch from './HeaderSearch';
import NavFlyoutMenu from './NavFlyoutMenu';
import PlayerSearchBio from './PlayerSearchBio';

export default function Layout() {
  const location = useLocation();
  const isHomeLanding = location.pathname === '/';
  const [openFlyout, setOpenFlyout] = useState<NavFlyoutId | null>(null);
  const [pinnedFlyout, setPinnedFlyout] = useState<NavFlyoutId | null>(null);

  const clearFlyouts = useCallback(() => {
    setOpenFlyout(null);
    setPinnedFlyout(null);
  }, []);

  useEffect(() => {
    clearFlyouts();
  }, [location.pathname, location.search, clearFlyouts]);

  // Non-Home routes: keep the scrollbar gutter so hub ↔ subpage navigations don’t shift.
  useEffect(() => {
    const on = location.pathname !== '/';
    document.documentElement.classList.toggle('force-y-scroll', on);
    return () => document.documentElement.classList.remove('force-y-scroll');
  }, [location.pathname]);

  useEffect(() => {
    if (pinnedFlyout == null) return;
    function onDoc(e: MouseEvent) {
      const target = e.target as HTMLElement | null;
      if (target?.closest('.nav-flyout-header')) return;
      clearFlyouts();
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') clearFlyouts();
    }
    document.addEventListener('mousedown', onDoc);
    window.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      window.removeEventListener('keydown', onKey);
    };
  }, [pinnedFlyout, clearFlyouts]);

  function openFlyoutId(id: NavFlyoutId) {
    setOpenFlyout(id);
    setPinnedFlyout((pinned) => (pinned === id ? pinned : null));
  }

  function leaveFlyout(id: NavFlyoutId) {
    setPinnedFlyout((pinned) => {
      setOpenFlyout((open) => {
        if (pinned === id) return open;
        return open === id ? null : open;
      });
      return pinned;
    });
  }

  function clickFlyout(id: NavFlyoutId) {
    if (pinnedFlyout === id) {
      clearFlyouts();
      return;
    }
    setOpenFlyout(id);
    setPinnedFlyout(id);
  }

  return (
    <div className="app">
      {!isHomeLanding && (
        <header className="header">
          <div className="header-inner">
            <Link to="/" className="brand" title="B.L.I.T.Z. — Boards, Lineups, Insights, Tools, & Zero-suck">
              <img src="/dsafd-logo.png" alt="" className="brand-logo" width={40} height={40} />
              B.L.I.T.Z.
            </Link>
            <HeaderSearch />
            <nav className="nav" aria-label="Main">
              {headerNavItems.map((item) => {
                const flyoutId = navFlyoutByPath[item.to];
                const routeActive = item.match(location.pathname);
                const flyoutOpen = flyoutId != null && openFlyout === flyoutId;
                const pinned = flyoutId != null && pinnedFlyout === flyoutId;
                const active = routeActive || flyoutOpen;

                if (flyoutId) {
                  const panelId = `header-${flyoutId}-sub`;
                  return (
                    <NavFlyoutMenu
                      key={item.to}
                      id={flyoutId}
                      open={flyoutOpen}
                      openOn="hover"
                      onOpen={() => openFlyoutId(flyoutId)}
                      onClose={() => leaveFlyout(flyoutId)}
                      panelId={panelId}
                      className={`nav-flyout-header${flyoutId === 'strategy' ? ' is-strategy' : ''}`}
                    >
                      <button
                        type="button"
                        className={
                          active ? 'nav-link nav-icon-link active' : 'nav-link nav-icon-link'
                        }
                        title={item.label}
                        aria-label={item.label}
                        aria-haspopup="menu"
                        aria-expanded={flyoutOpen}
                        aria-controls={panelId}
                        data-pinned={pinned ? 'true' : undefined}
                        onClick={() => clickFlyout(flyoutId)}
                      >
                        <span className="nav-icon">{item.icon(22)}</span>
                      </button>
                    </NavFlyoutMenu>
                  );
                }

                return (
                  <Link
                    key={item.to}
                    to={item.to}
                    className={active ? 'nav-link nav-icon-link active' : 'nav-link nav-icon-link'}
                    title={item.label}
                    aria-label={item.label}
                  >
                    <span className="nav-icon">{item.icon(22)}</span>
                  </Link>
                );
              })}
            </nav>
          </div>
        </header>
      )}
      <main className="main">
        <Outlet />
      </main>
      <PlayerSearchBio />
    </div>
  );
}
