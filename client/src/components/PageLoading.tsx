/** Centered page loader — bouncing squares + per-page saying. */
export default function PageLoading({ label = 'Loading…' }: { label?: string }) {
  return (
    <div className="page-loading" role="status" aria-live="polite" aria-busy="true">
      <div className="page-loading-dots" aria-hidden="true">
        <span />
        <span />
        <span />
        <span />
      </div>
      <p className="page-loading-label">{label}</p>
    </div>
  );
}
