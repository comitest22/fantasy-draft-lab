import { useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { getSearchBoard } from '../services/api';
import type { RouteBoardPlayer } from '../types';

function matchesQuery(player: RouteBoardPlayer, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return false;
  if (
    player.playerName.toLowerCase().includes(q) ||
    player.position.toLowerCase() === q ||
    String(player.rank) === q ||
    `#${player.rank}` === q
  ) {
    return true;
  }
  if (player.nflTeam?.toLowerCase() === q) return true;
  if (player.position === 'D/ST') {
    if (q === 'dst' || q === 'd/st' || q === 'def' || q === 'defense') return true;
    const nick = player.playerName.replace(/\s+d\/st$/i, '').trim().toLowerCase();
    if (nick && (nick.includes(q) || q.includes(nick))) return true;
  }
  return false;
}

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  const tag = target.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
}

export default function HeaderSearch() {
  const navigate = useNavigate();
  const location = useLocation();
  const rootRef = useRef<HTMLFormElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState('');
  const [board, setBoard] = useState<RouteBoardPlayer[]>([]);
  const [boardLoaded, setBoardLoaded] = useState(false);
  const [open, setOpen] = useState(false);

  function ensureBoard() {
    if (boardLoaded) return;
    setBoardLoaded(true);
    getSearchBoard()
      .then((data) => setBoard(data.board))
      .catch(() => {
        setBoard([]);
        setBoardLoaded(false);
      });
  }

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
        return;
      }
      if (e.key !== '\\' || e.metaKey || e.ctrlKey || e.altKey) return;
      if (isTypingTarget(e.target)) return;
      e.preventDefault();
      ensureBoard();
      setOpen(true);
      inputRef.current?.focus();
      inputRef.current?.select();
    }
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [boardLoaded]);

  function openPlayer(name: string) {
    setQuery('');
    setOpen(false);
    const next = new URLSearchParams(location.search);
    next.set('player', name);
    next.delete('article');
    navigate({ pathname: location.pathname, search: next.toString() }, { replace: false });
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
        ref={inputRef}
        id="header-player-search"
        className="header-search-input"
        type="search"
        value={query}
        onChange={(e) => {
          ensureBoard();
          setQuery(e.target.value);
          setOpen(true);
        }}
        onFocus={() => {
          ensureBoard();
          setOpen(true);
        }}
        placeholder={'{ Search players by pressing \\ }'}
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
