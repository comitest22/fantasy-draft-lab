import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import DraftBoard from '../components/DraftBoard';
import { getLeagueConfig, previewImport } from '../services/api';
import { confirmImportBatch } from '../services/importBatch';
import type { DraftFile, LeagueConfig } from '../types';
import {
  createImportId,
  getSeasonOptions,
  guessSeasonFromFilename,
} from '../utils/import';

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

export default function ImportPage() {
  const navigate = useNavigate();
  const [items, setItems] = useState<ImportItem[]>([]);
  const [leagueConfig, setLeagueConfig] = useState<LeagueConfig | null>(null);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    getLeagueConfig()
      .then(setLeagueConfig)
      .catch(() => setLeagueConfig(null));
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
      navigate('/');
    }

    setLoading(false);
  }

  const saveableItems = items.filter(
    (item) => item.draft && item.errors.length === 0
  );
  const saveableCount = saveableItems.length;
  const dupes = duplicateSeasons(items);
  const hasPreviewed = items.some((item) => item.draft != null);

  return (
    <section className="panel">
      <h1>Import ESPN Drafts</h1>
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
    </section>
  );
}
