const FIRST_SEASON = 2010;

export function getSeasonOptions(): number[] {
  const currentYear = new Date().getFullYear();
  return Array.from(
    { length: currentYear - FIRST_SEASON + 1 },
    (_, i) => currentYear - i
  );
}

export function guessSeasonFromFilename(filename: string): number | null {
  const match = filename.match(/\b(20\d{2})\b/);
  if (!match) return null;
  const year = parseInt(match[1], 10);
  const currentYear = new Date().getFullYear();
  if (year < FIRST_SEASON || year > currentYear + 1) return null;
  return year;
}

export function createImportId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}
