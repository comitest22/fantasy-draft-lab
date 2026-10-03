import type { TimingAdvice } from '../types';

interface Props {
  takes: TimingAdvice[];
  showHeading?: boolean;
}

export default function KeyTakeaways({ takes, showHeading = true }: Props) {
  return (
    <section className="key-takeaways">
      {showHeading && <h2>Key Takeaways</h2>}
      {takes.length === 0 ? (
        <p className="subtitle">Import standings and drafts to generate takeaways.</p>
      ) : (
        <div className="timing-advice">
          {takes.map((take) => (
            <article key={take.id} className="timing-take">
              <h4>{take.title}</h4>
              <p>{take.detail}</p>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}
