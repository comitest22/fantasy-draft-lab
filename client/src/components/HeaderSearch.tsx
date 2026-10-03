import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { getSearchBoard } from '../services/api';
import type { RouteBoardPlayer } from '../types';

function matchesQuery(player: RouteBoardPlayer, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return false;
  return (
    player.playerName.toLowerCase().includes(q) ||
    player.position.toLowerCase() === q ||
    String(player.rank) === q ||
    `#${player.rank}` === q
  );
}

export default function HeaderSearch() {
  const navigate = useNavigate();
  const rootRef = useRef<HTMLFormElement>(null);
  const [query, setQuery] = useState('');
  const [board, setBoard] = useState<RouteBoardPlayer[]>([]);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    getSearchBoard()
      .then((data) => setBoard(data.board))
      .catch(() => setBoard([]));
  }, []);

  const results = useMemo(
    () => board.filter((p) => matchesQuery(p, query)).slice(0, 12),
    [board, query]
  );

  const showList = open && query.trim().length > 0;

  useEffect(() => {
    function onPointerDown(e: PointerEvent) {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        setOpen(false);
        setQuery('');
      }
    }
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKey);
    };
  }, []);

  function openPlayer(name: string) {
    setQuery('');
    setOpen(false);
    navigate(`/?player=${encodeURIComponent(name)}`);
  }

  return (
    <form
      ref={rootRef}
      className="header-search"
      role="search"
      onSubmit={(e) => {
        e.preventDefault();
        if (results[0]) openPlayer(results[0].playerName);
      }}
    >
      <label className="visually-hidden" htmlFor="header-player-search">
        Search players
      </label>
      <input
        id="header-player-search"
        className="header-search-input"
        type="search"
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        placeholder="Search players"
        autoComplete="off"
      />
      {showList && (
        <ul className="header-results" role="listbox">
          {results.length === 0 ? (
            <li className="header-results-empty">No players match “{query.trim()}”.</li>
          ) : (
            results.map((p) => (
              <li key={p.playerName}>
                <button
                  type="button"
                  className="home-result"
                  role="option"
                  onClick={() => openPlayer(p.playerName)}
                >
                  <span className="home-result-rank">#{p.rank}</span>
                  <span className="home-result-pos">{p.position}</span>
                  <span className="home-result-name">{p.playerName}</span>
                </button>
              </li>
            ))
          )}
        </ul>
      )}
    </form>
  );
}
