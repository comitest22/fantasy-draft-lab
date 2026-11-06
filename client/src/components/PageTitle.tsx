import type { ReactNode } from 'react';
import { useLocation } from 'react-router-dom';
import { headerNavItems } from '../nav/appNav';

/** Page `<h1>` with the matching section nav icon (larger than the header). */
export default function PageTitle({
  children,
  className,
  badge,
}: {
  children: ReactNode;
  className?: string;
  /** Optional toolkit badge anchored top-right on the section icon. */
  badge?: ReactNode;
}) {
  const location = useLocation();
  const item = headerNavItems.find((nav) => nav.match(location.pathname));

  return (
    <h1 className={['page-title', className].filter(Boolean).join(' ')}>
      {item && (
        <span className={`page-title-icon${badge != null ? ' has-badge' : ''}`}>
          {item.icon(40)}
          {badge != null ? <span className="page-title-badge">{badge}</span> : null}
        </span>
      )}
      <span className="page-title-text">{children}</span>
    </h1>
  );
}
