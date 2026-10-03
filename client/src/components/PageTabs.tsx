import { useEffect, useRef } from 'react';

interface Tab {
  id: string;
  label: string;
}

interface Props {
  tabs: Tab[];
  active: string;
  onChange: (id: string) => void;
  label: string;
}

export default function PageTabs({ tabs, active, onChange, label }: Props) {
  const barRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const bar = barRef.current;
    if (!bar) return;

    let frame = 0;

    const update = () => {
      const header = document.querySelector('.header');
      const headerBottom = header?.getBoundingClientRect().bottom ?? 0;
      const rect = bar.getBoundingClientRect();
      const underHeader = rect.top < headerBottom - 1;
      bar.style.opacity = underHeader ? '0' : '1';
      bar.style.pointerEvents = underHeader ? 'none' : '';
    };

    const onScroll = () => {
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        update();
      });
    };

    update();
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll);
    return () => {
      if (frame) cancelAnimationFrame(frame);
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onScroll);
    };
  }, []);

  return (
    <div ref={barRef} className="page-tabs" role="tablist" aria-label={label}>
      {tabs.map((tab) => (
        <button
          key={tab.id}
          type="button"
          role="tab"
          aria-selected={tab.id === active}
          className={`page-tab${tab.id === active ? ' active' : ''}`}
          onClick={() => {
            onChange(tab.id);
            window.scrollTo({ top: 0 });
          }}
        >
          {tab.label}
        </button>
      ))}
    </div>
  );
}
