import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import DraftBoard from '../components/DraftBoard';
import PageTitle from '../components/PageTitle';
import {
  confirmEspnTeam,
  getEspnTeamDefaults,
  getLeagueConfig,
  previewEspnTeam,
  previewImport,
} from '../services/api';
import { confirmImportBatch } from '../services/importBatch';
import type {
  DraftFile,
  EspnTeamSummary,
  LeagueConfig,
  MyTeamPlayer,
} from '../types';
import {
  createImportId,
  getSeasonOptions,
  guessSeasonFromFilename,
} from '../utils/import';
import { statusBadge } from '../utils/valueChips';

type ImportStatus = 'pending' | 'previewing' | 'ready' | 'error';

interface ImportItem {
  id: string;
  file: File;
  season: number;
  draft: DraftFile | null;
  errors: string[];
  warnings: string[];
  userTeamName: string;
  finalStanding: string;
  notes: string;
  status: ImportStatus;
  expanded: boolean;
}

interface SeasonDefaults {
  userTeamName: string;
  finalStanding: string;
  notes: string;
}

const seasonOptions = getSeasonOptions();
const defaultSeason = seasonOptions[0];

function getSeasonDefaults(
  season: number,
  config: LeagueConfig | null
): SeasonDefaults {
  const entry = config?.seasons[String(season)];
  return {
    userTeamName: entry?.userTeamName ?? '',
    finalStanding:
      entry?.finalStanding != null ? String(entry.finalStanding) : '',
    notes: entry?.notes ?? '',
  };
}

function createImportItem(file: File, config: LeagueConfig | null): ImportItem {
  const season = guessSeasonFromFilename(file.name) ?? defaultSeason;
  const defaults = getSeasonDefaults(season, config);

  return {
    id: createImportId(),
    file,
    season,
    draft: null,
    errors: [],
    warnings: [],
    userTeamName: defaults.userTeamName,
    finalStanding: defaults.finalStanding,
    notes: defaults.notes,
    status: 'pending',
    expanded: false,
  };
}

function resolveUserTeamName(
  item: ImportItem,
  fantasyTeamNames: string[],
  config: LeagueConfig | null
): string {
  if (item.userTeamName && fantasyTeamNames.includes(item.userTeamName)) {
    return item.userTeamName;
  }

  const savedTeam = config?.seasons[String(item.season)]?.userTeamName;
  if (savedTeam && fantasyTeamNames.includes(savedTeam)) {
    return savedTeam;
  }

  if (fantasyTeamNames.length === 1) {
    return fantasyTeamNames[0];
  }

  return '';
}

function duplicateSeasons(items: ImportItem[]): number[] {
  const seen = new Map<number, number>();
  for (const item of items) {
    seen.set(item.season, (seen.get(item.season) ?? 0) + 1);
  }
  return [...seen.entries()]
    .filter(([, count]) => count > 1)
    .map(([season]) => season);
}

function LeagueRosterRow({
  player,
  slotLabel,
}: {
  player: MyTeamPlayer;
  slotLabel: string;
}) {
  const badge = statusBadge(player.status);
  return (
    <li>
      <span className={`pos-pill pos-${player.position.replace('/', '')}`}>
        {slotLabel}
      </span>
      <span className="espn-roster-player">
        {player.name}
        {player.nflTeam ? ` · ${player.nflTeam}` : ''}
        {badge && (
          <span className={`status-text status-text-${badge.tone}`} title={badge.title}>
            {badge.label}
          </span>
        )}
      </span>
    </li>
  );
}

export default function ImportPage() {
  const navigate = useNavigate();
  const [items, setItems] = useState<ImportItem[]>([]);
  const [leagueConfig, setLeagueConfig] = useState<LeagueConfig | null>(null);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const [leagueId, setLeagueId] = useState('1735901');
  const [leagueSeason, setLeagueSeason] = useState(defaultSeason);
  const [espnS2, setEspnS2] = useState('');
  const [swid, setSwid] = useState('');
  const [hasSavedAuth, setHasSavedAuth] = useState(false);
  const [leagueLoading, setLeagueLoading] = useState(false);
  const [leagueMessage, setLeagueMessage] = useState<string | null>(null);
  const [espnTeams, setEspnTeams] = useState<EspnTeamSummary[]>([]);
  const [espnTeamId, setEspnTeamId] = useState<number | null>(null);
  const [rosterPreview, setRosterPreview] = useState<MyTeamPlayer[]>([]);
  const [previewTeamName, setPreviewTeamName] = useState<string | null>(null);

  useEffect(() => {
    getLeagueConfig()
      .then(setLeagueConfig)
      .catch(() => setLeagueConfig(null));
    getEspnTeamDefaults()
      .then((defaults) => {
        setLeagueId(String(defaults.leagueId));
        setLeagueSeason(defaults.season);
        setHasSavedAuth(defaults.hasSavedAuth);
      })
      .catch(() => {
        /* keep local defaults */
      });
  }, []);

  useEffect(() => {
    if (window.location.hash === '#import-league') {
      document.getElementById('import-league')?.scrollIntoView({ behavior: 'smooth' });
    }
  }, []);

  function updateItem(id: string, patch: Partial<ImportItem>) {
    setItems((current) =>
      current.map((item) => (item.id === id ? { ...item, ...patch } : item))
    );
  }

  function handleFilesSelected(fileList: FileList | null) {
    if (!fileList?.length) return;
    const docxFiles = Array.from(fileList).filter((f) =>
      f.name.toLowerCase().endsWith('.docx')
    );
    if (docxFiles.length === 0) {
      setMessage('Please select one or more .docx files.');
      return;
    }
    setMessage(null);
    setItems((current) => [
      ...current,
      ...docxFiles.map((file) => createImportItem(file, leagueConfig)),
    ]);
  }

  function removeItem(id: string) {
    setItems((current) => current.filter((item) => item.id !== id));
  }

  async function previewItem(item: ImportItem): Promise<ImportItem> {
    const result = await previewImport(item.file, item.season);
    const hasErrors = result.errors.length > 0;
    return {
      ...item,
      draft: result.draft,
      errors: result.errors,
      warnings: result.warnings,
      userTeamName: resolveUserTeamName(
        item,
        result.draft.fantasyTeamNames,
        leagueConfig
      ),
      status: hasErrors ? 'error' : 'ready',
    };
  }

  async function handlePreviewAll() {
    if (items.length === 0) return;
    setLoading(true);
    setMessage(null);

    const dupes = duplicateSeasons(items);
    if (dupes.length > 0) {
      setMessage(
        `Duplicate season assignments: ${dupes.join(', ')}. Assign a unique season to each file.`
      );
      setLoading(false);
      return;
    }

    setItems((current) =>
      current.map((item) => ({ ...item, status: 'previewing' as const }))
    );

    try {
      const updated = await Promise.all(items.map(previewItem));
      setItems(updated);
      const failed = updated.filter((item) => item.status === 'error').length;
      if (failed > 0) {
        setMessage(`${failed} file(s) failed to parse. Fix errors or remove those files.`);
      }
    } catch (err) {
      setMessage(String(err));
      setItems((current) =>
        current.map((item) =>
          item.status === 'previewing' ? { ...item, status: 'pending' as const } : item
        )
      );
    } finally {
      setLoading(false);
    }
  }

  async function handleSaveAll() {
    const readyItems = items.filter(
      (item) => item.draft && item.errors.length === 0
    );
    if (readyItems.length === 0) {
      setMessage('Load team names first. At least one valid draft is required to save.');
      return;
    }

    const dupes = duplicateSeasons(items);
    if (dupes.length > 0) {
      setMessage(
        `Duplicate season assignments: ${dupes.join(', ')}. Assign a unique season to each file.`
      );
      return;
    }

    setLoading(true);
    setMessage(null);

    const results = await confirmImportBatch(
      readyItems.map((item) => ({
        draft: item.draft!,
        userTeamName: item.userTeamName || undefined,
        finalStanding: item.finalStanding
          ? parseInt(item.finalStanding, 10)
          : undefined,
        notes: item.notes || undefined,
      }))
    );

    const saved = results.filter((r) => r.ok).map((r) => r.season);
    const failed = results.filter((r) => !r.ok);

    if (failed.length > 0) {
      setMessage(
        `Saved ${saved.length} season(s). Failed: ${failed
          .map((r) => `${r.season} (${r.error})`)
          .join('; ')}`
      );
      setItems((current) =>
        current.filter((item) => !saved.includes(item.season))
      );
    } else {
      navigate('/seasons');
    }

    setLoading(false);
  }

  const saveableItems = items.filter(
    (item) => item.draft && item.errors.length === 0
  );
  const saveableCount = saveableItems.length;
  const dupes = duplicateSeasons(items);
  const hasPreviewed = items.some((item) => item.draft != null);

  function resetLeaguePreview() {
    setEspnTeams([]);
    setEspnTeamId(null);
    setRosterPreview([]);
    setPreviewTeamName(null);
  }

  async function handleLeaguePreview() {
    const id = parseInt(leagueId, 10);
    if (Number.isNaN(id)) {
      setLeagueMessage('Enter a valid ESPN league ID.');
      return;
    }
    setLeagueLoading(true);
    setLeagueMessage(null);
    try {
      const result = await previewEspnTeam({
        leagueId: id,
        season: leagueSeason,
        teamId: espnTeamId ?? undefined,
        espnS2: espnS2 || undefined,
        swid: swid || undefined,
      });
      setEspnTeams(result.teams);
      const nextId = result.selectedTeamId ?? result.suggestedTeamId;
      setEspnTeamId(nextId);
      setRosterPreview(result.roster);
      setPreviewTeamName(result.teamName);
      if (!nextId) {
        setLeagueMessage('League loaded. Pick your team, then import.');
      }
    } catch (err) {
      setLeagueMessage(err instanceof Error ? err.message : String(err));
      resetLeaguePreview();
    } finally {
      setLeagueLoading(false);
    }
  }

  async function handleLeagueTeamChange(teamId: number) {
    setEspnTeamId(teamId);
    const id = parseInt(leagueId, 10);
    if (Number.isNaN(id)) return;
    setLeagueLoading(true);
    setLeagueMessage(null);
    try {
      const result = await previewEspnTeam({
        leagueId: id,
        season: leagueSeason,
        teamId,
        espnS2: espnS2 || undefined,
        swid: swid || undefined,
      });
      setEspnTeams(result.teams);
      setEspnTeamId(result.selectedTeamId ?? teamId);
      setRosterPreview(result.roster);
      setPreviewTeamName(result.teamName);
    } catch (err) {
      setLeagueMessage(err instanceof Error ? err.message : String(err));
    } finally {
      setLeagueLoading(false);
    }
  }

  async function handleLeagueImport() {
    const id = parseInt(leagueId, 10);
    if (Number.isNaN(id) || espnTeamId == null) {
      setLeagueMessage('Preview the league and select your team first.');
      return;
    }
    setLeagueLoading(true);
    setLeagueMessage(null);
    try {
      await confirmEspnTeam({
        leagueId: id,
        season: leagueSeason,
        teamId: espnTeamId,
        espnS2: espnS2 || undefined,
        swid: swid || undefined,
      });
      navigate('/my-team');
    } catch (err) {
      setLeagueMessage(err instanceof Error ? err.message : String(err));
    } finally {
      setLeagueLoading(false);
    }
  }

  return (
    <section className="panel">
      <PageTitle>Import ESPN Drafts</PageTitle>
      <p className="subtitle">
        Upload one or more .docx exports from ESPN (Round / NO. / Player / Team
        format). Assign season, your team, and optional place finished for each
        file, then load team names and import.
      </p>

      <label className="file-upload-label">
        Draft files (.docx)
        <input
          type="file"
          accept=".docx"
          multiple
          onChange={(e) => {
            handleFilesSelected(e.target.files);
            e.target.value = '';
          }}
        />
      </label>

      {items.length > 0 && (
        <div className="import-actions">
          <button
            type="button"
            className="button"
            onClick={handlePreviewAll}
            disabled={loading || dupes.length > 0}
          >
            Load team names ({items.length})
          </button>
          <button
            type="button"
            className="button secondary"
            onClick={() => setItems([])}
            disabled={loading}
          >
            Clear all
          </button>
        </div>
      )}

      {dupes.length > 0 && (
        <div className="alert warn-box">
          <strong>Duplicate seasons</strong>
          <p>Each file needs a unique season: {dupes.join(', ')}</p>
        </div>
      )}

      {message && <p className="error">{message}</p>}

      {items.length > 0 && (
        <div className="import-queue">
          {items.map((item) => (
            <article key={item.id} className={`import-item import-${item.status}`}>
              <div className="import-item-header">
                <div>
                  <strong>{item.file.name}</strong>
                  <p className="import-item-meta">
                    {item.draft
                      ? `${item.draft.picks.length} picks · ${item.draft.rounds} rounds · ${item.draft.fantasyTeamNames.length} teams`
                      : 'Team names not loaded yet'}
                    {item.status === 'previewing' && ' · Loading team names...'}
                  </p>
                </div>
                <button
                  type="button"
                  className="button secondary small"
                  onClick={() => removeItem(item.id)}
                  disabled={loading}
                >
                  Remove
                </button>
              </div>

              <div className="form-grid">
                <label>
                  Season
                  <select
                    value={item.season}
                    onChange={(e) => {
                      const season = parseInt(e.target.value, 10);
                      const defaults = getSeasonDefaults(season, leagueConfig);
                      updateItem(item.id, {
                        season,
                        draft: null,
                        errors: [],
                        warnings: [],
                        status: 'pending',
                        userTeamName: defaults.userTeamName,
                        finalStanding: defaults.finalStanding,
                        notes: defaults.notes,
                      });
                    }}
                  >
                    {seasonOptions.map((year) => (
                      <option key={year} value={year}>
                        {year}
                      </option>
                    ))}
                  </select>
                </label>

                <label>
                  Place finished (optional)
                  <select
                    value={item.finalStanding}
                    onChange={(e) =>
                      updateItem(item.id, { finalStanding: e.target.value })
                    }
                  >
                    <option value="">Not set</option>
                    {Array.from({ length: 10 }, (_, i) => i + 1).map((place) => (
                      <option key={place} value={place}>
                        {place}
                      </option>
                    ))}
                  </select>
                </label>

                <label>
                  Your team name
                  {item.draft ? (
                    <select
                      value={item.userTeamName}
                      onChange={(e) =>
                        updateItem(item.id, { userTeamName: e.target.value })
                      }
                    >
                      <option value="">Select team...</option>
                      {item.draft.fantasyTeamNames.map((name) => (
                        <option key={name} value={name}>
                          {name}
                        </option>
                      ))}
                    </select>
                  ) : item.userTeamName ? (
                    <input
                      type="text"
                      value={item.userTeamName}
                      disabled
                      title="Saved team name from a previous import. Load team names to confirm it appears in this draft."
                    />
                  ) : (
                    <select disabled>
                      <option>Load team names to choose</option>
                    </select>
                  )}
                </label>

                {item.draft && (
                  <label className="full-width">
                    Notes (optional)
                    <input
                      type="text"
                      value={item.notes}
                      onChange={(e) => updateItem(item.id, { notes: e.target.value })}
                    />
                  </label>
                )}
              </div>

              {item.errors.length > 0 && (
                <div className="alert error-box">
                  <strong>Parse errors</strong>
                  <ul>
                    {item.errors.map((e) => (
                      <li key={e}>{e}</li>
                    ))}
                  </ul>
                </div>
              )}

              {item.warnings.length > 0 && (
                <div className="alert warn-box">
                  <strong>Warnings</strong>
                  <ul>
                    {item.warnings.map((w) => (
                      <li key={w}>{w}</li>
                    ))}
                  </ul>
                </div>
              )}

              {item.draft && item.errors.length === 0 && (
                <details
                  open={item.expanded}
                  onToggle={(e) =>
                    updateItem(item.id, {
                      expanded: (e.target as HTMLDetailsElement).open,
                    })
                  }
                >
                  <summary>Draft board preview</summary>
                  <DraftBoard
                    picks={item.draft.picks.map((p) => ({
                      ...p,
                      grade: 'unknown' as const,
                      isUserPick: item.userTeamName
                        ? p.fantasyTeamName === item.userTeamName
                        : false,
                    }))}
                  />
                </details>
              )}
            </article>
          ))}
        </div>
      )}

      {items.length > 0 && (
        <div className="import-submit-bar">
          <div>
            <strong>
              {saveableCount > 0
                ? `${saveableCount} season${saveableCount === 1 ? '' : 's'} ready to import`
                  : hasPreviewed
                  ? 'No valid drafts to import'
                  : 'Load team names to continue'}
            </strong>
            <p className="import-submit-hint">
              {saveableCount > 0
                ? 'Confirm your team names and place finished, then import.'
                : hasPreviewed
                  ? 'Fix parse errors or remove failed files, then try again.'
                  : 'Use Load team names after assigning a season to each file.'}
            </p>
          </div>
          <button
            type="button"
            className="button import-submit-button"
            onClick={handleSaveAll}
            disabled={loading || saveableCount === 0 || dupes.length > 0}
          >
            {loading
              ? 'Importing...'
              : saveableCount > 0
                ? `Import ${saveableCount} season${saveableCount === 1 ? '' : 's'}`
                : 'Import seasons'}
          </button>
        </div>
      )}

      {items.length === 0 && (
        <p className="subtitle">
          Tip: include the year in the filename (e.g. <code>2015-draft.docx</code>)
          to auto-select the season.
        </p>
      )}

      <div id="import-league" className="import-league-section">
        <h2>Import League</h2>
        <p className="subtitle">
          Connect your ESPN fantasy league once. The roster appears under{' '}
          <strong>My Team</strong>; use Sync there to refresh. Private leagues need{' '}
          <code>espn_s2</code> and <code>SWID</code> cookies (or{' '}
          <code>ESPN_S2</code> / <code>ESPN_SWID</code> in <code>.env</code>).
        </p>

        <details className="espn-cookie-help">
          <summary>How to get espn_s2 and SWID</summary>
          <ol>
            <li>
              Log into{' '}
              <a href="https://fantasy.espn.com" target="_blank" rel="noreferrer">
                fantasy.espn.com
              </a>
              .
            </li>
            <li>
              Open DevTools (F12) → <strong>Application</strong> → Cookies →
              fantasy.espn.com
            </li>
            <li>
              Copy <code>espn_s2</code> and <code>SWID</code> into the fields below.
            </li>
          </ol>
        </details>

        <div className="form-grid">
          <label>
            League ID
            <input
              type="text"
              value={leagueId}
              onChange={(e) => {
                setLeagueId(e.target.value);
                resetLeaguePreview();
              }}
              inputMode="numeric"
            />
          </label>
          <label>
            Season
            <select
              value={leagueSeason}
              onChange={(e) => {
                setLeagueSeason(parseInt(e.target.value, 10));
                resetLeaguePreview();
              }}
            >
              {seasonOptions.map((year) => (
                <option key={year} value={year}>
                  {year}
                </option>
              ))}
            </select>
          </label>
          <label className="full-width">
            espn_s2{hasSavedAuth ? ' (optional — saved cookies available)' : ''}
            <input
              type="password"
              value={espnS2}
              onChange={(e) => setEspnS2(e.target.value)}
              autoComplete="off"
              placeholder={hasSavedAuth ? 'Leave blank to reuse saved cookies' : ''}
            />
          </label>
          <label className="full-width">
            SWID{hasSavedAuth ? ' (optional — saved cookies available)' : ''}
            <input
              type="password"
              value={swid}
              onChange={(e) => setSwid(e.target.value)}
              autoComplete="off"
              placeholder={hasSavedAuth ? 'Leave blank to reuse saved cookies' : '{…}'}
            />
          </label>
        </div>

        <div className="import-actions">
          <button
            type="button"
            className="button"
            onClick={handleLeaguePreview}
            disabled={leagueLoading}
          >
            {leagueLoading ? 'Loading…' : 'Preview league'}
          </button>
        </div>

        {leagueMessage && <p className="error">{leagueMessage}</p>}

        {espnTeams.length > 0 && (
          <>
            <div className="form-grid" style={{ marginTop: '1rem' }}>
              <label className="espn-team-field">
                Your team
                <span className="espn-team-select-wrap">
                  <select
                    className="espn-team-select"
                    value={espnTeamId ?? ''}
                    onChange={(e) => {
                      const id = parseInt(e.target.value, 10);
                      if (!Number.isNaN(id)) void handleLeagueTeamChange(id);
                    }}
                  >
                    <option value="" disabled>
                      Select team…
                    </option>
                    {espnTeams.map((team) => (
                      <option key={team.teamId} value={team.teamId}>
                        {team.name}
                        {team.abbrev ? ` (${team.abbrev})` : ''} · {team.playerCount}{' '}
                        players
                      </option>
                    ))}
                  </select>
                </span>
              </label>
            </div>

            {rosterPreview.length > 0 && (
              <div className="espn-roster-preview">
                <h3>
                  Roster preview
                  {previewTeamName ? ` · ${previewTeamName}` : ''}
                </h3>
                <div className="espn-roster-columns">
                  <div className="espn-roster-col">
                    <h4>Starters</h4>
                    <ul className="espn-roster-list">
                      {rosterPreview
                        .filter((p) => p.lineupSlot !== 'BE' && p.lineupSlot !== 'IR')
                        .map((p) => (
                          <LeagueRosterRow
                            key={`${p.espnId}-${p.lineupSlotId}`}
                            player={p}
                            slotLabel={p.lineupSlot}
                          />
                        ))}
                    </ul>
                  </div>
                  <div className="espn-roster-col">
                    <h4>Bench</h4>
                    <ul className="espn-roster-list">
                      {rosterPreview
                        .filter((p) => p.lineupSlot === 'BE' || p.lineupSlot === 'IR')
                        .map((p) => (
                          <LeagueRosterRow
                            key={`${p.espnId}-${p.lineupSlotId}`}
                            player={p}
                            slotLabel={p.lineupSlot === 'IR' ? 'IR' : p.position}
                          />
                        ))}
                    </ul>
                  </div>
                </div>
              </div>
            )}

            {espnTeamId != null && (
              <div className="import-submit-bar import-league-submit">
                <div>
                  <strong>Ready to import into My Team</strong>
                  <p className="import-submit-hint">
                    {rosterPreview.length > 0
                      ? `${rosterPreview.length} players · cookies stay off committed data.`
                      : 'Team selected. Import saves the connection for Sync on My Team.'}
                  </p>
                </div>
                <button
                  type="button"
                  className="button import-submit-button"
                  onClick={handleLeagueImport}
                  disabled={leagueLoading}
                >
                  {leagueLoading ? 'Importing…' : 'Import to My Team'}
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </section>
  );
}
