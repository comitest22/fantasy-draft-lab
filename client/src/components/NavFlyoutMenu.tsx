import { useEffect, useRef, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { navFlyouts, type NavFlyoutId } from '../nav/homeFlyouts';

type NavFlyoutMenuProps = {
  id: NavFlyoutId;
  open: boolean;
  onClose: () => void;
  /** Used for hover open (header). */
  onOpen?: () => void;
  /** `hover` opens on mouse enter; `click` relies on the trigger button. */
  openOn?: 'click' | 'hover';
  panelId: string;
  className?: string;
  children: ReactNode;
};

/** Shared home/header flyout panel under a positioned trigger wrapper. */
export default function NavFlyoutMenu({
  id,
  open,
  onClose,
  onOpen,
  openOn = 'click',
  panelId,
  className,
  children,
}: NavFlyoutMenuProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const flyout = navFlyouts[id];

  useEffect(() => {
    if (!open || openOn === 'hover') return;
    function onDoc(e: MouseEvent) {
      if (!rootRef.current?.contains(e.target as Node)) onClose();
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    document.addEventListener('mousedown', onDoc);
    window.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      window.removeEventListener('keydown', onKey);
    };
  }, [open, onClose, openOn]);

  useEffect(() => {
    if (!open || openOn !== 'hover') return;
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose, openOn]);

  return (
    <div
      ref={rootRef}
      className={['nav-flyout', className].filter(Boolean).join(' ')}
      onMouseEnter={openOn === 'hover' ? onOpen : undefined}
      onMouseLeave={openOn === 'hover' ? onClose : undefined}
    >
      {children}
      {open ? (
        <div
          id={panelId}
          className="home-menu-sub nav-flyout-sub"
          role="group"
          aria-label={flyout.ariaLabel}
        >
          {flyout.choices.map((choice) => (
            <Link
              key={choice.to}
              to={choice.to}
              className="home-menu-sub-btn"
              onClick={onClose}
            >
              <span className="home-menu-sub-icon">{choice.icon(20)}</span>
              <span className="home-menu-sub-label">{choice.label}</span>
            </Link>
          ))}
        </div>
      ) : null}
    </div>
  );
}
