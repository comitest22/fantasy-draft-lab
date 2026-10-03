export const CONTEXT_CAP = 4;

export type SurvivorMode = 'win' | 'lose';

export interface ContextFactor {
  id: string;
  label: string;
  points: number;
}

export interface ContextInput {
  home: boolean;
  consecutiveAwayBefore: number;
  restDays?: number;
  traveling: boolean;
  divisional: boolean;
  tzHoursWestToEast?: number;
  earlyWindow?: boolean;
  teamRoadWinPct?: number;
  qbRoadWinPct?: number;
  outdoor: boolean;
  forecastWindMph?: number;
  forecastPrecipIn?: number;
  forecastTempF?: number;
  qbBadWeather?: boolean;
}

export function clampContext(n: number, cap = CONTEXT_CAP): number {
  return Math.max(-cap, Math.min(cap, n));
}

export function contextFactors(input: ContextInput): ContextFactor[] {
  const factors: ContextFactor[] = [];
  if (input.home && input.consecutiveAwayBefore >= 2) {
    factors.push({ id: 'homeAfterRoad', label: 'Home after 2+ road games', points: 1.5 });
  }
  if (input.restDays != null && input.restDays < 6) {
    factors.push({ id: 'shortWeek', label: 'Short week', points: -1.2 });
    if (input.traveling) {
      factors.push({ id: 'shortWeekTravel', label: 'Short week on the road', points: -0.8 });
    }
  }
  if (input.divisional) {
    factors.push({ id: 'divisional', label: 'Divisional', points: -0.8 });
  }
  if (!input.home && (input.tzHoursWestToEast ?? 0) >= 3 && input.earlyWindow) {
    factors.push({ id: 'tzTravel', label: '3-hour eastbound early window', points: -1 });
  } else if (!input.home && Math.abs(input.tzHoursWestToEast ?? 0) >= 3) {
    factors.push({ id: 'tzTravel', label: '3-hour timezone travel', points: -1 });
  }
  if (!input.home && input.teamRoadWinPct != null && input.teamRoadWinPct < 0.4) {
    factors.push({ id: 'poorRoad', label: 'Poor road record', points: -1.2 });
  }
  if (!input.home && input.qbRoadWinPct != null && input.qbRoadWinPct < 0.4) {
    factors.push({ id: 'qbRoad', label: 'QB struggles on the road', points: -0.8 });
  }
  const badWeather =
    input.outdoor &&
    ((input.forecastWindMph != null && input.forecastWindMph >= 15) ||
      (input.forecastPrecipIn != null && input.forecastPrecipIn >= 0.1) ||
      (input.forecastTempF != null && input.forecastTempF <= 32));
  if (badWeather) {
    factors.push({ id: 'weather', label: 'Outdoor wind/precip/cold', points: -0.6 });
    if (input.qbBadWeather) {
      factors.push({ id: 'qbWeather', label: 'QB poor weather split', points: -0.8 });
    }
  }
  return factors;
}

export function contextAdjustment(input: ContextInput, mode: SurvivorMode = 'win'): {
  adj: number;
  notes: string[];
  factors: ContextFactor[];
} {
  const factors = contextFactors(input);
  const signed = mode === 'lose' ? factors.map((f) => ({ ...f, points: -f.points })) : factors;
  const raw = signed.reduce((sum, f) => sum + f.points, 0);
  return {
    adj: Math.round(clampContext(raw) * 10) / 10,
    notes: signed.filter((f) => f.points !== 0).map((f) => f.label),
    factors: signed,
  };
}

export function tzOffsetHours(tz: string, at: Date): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    timeZoneName: 'shortOffset',
    hour: '2-digit',
  }).formatToParts(at);
  const name = parts.find((p) => p.type === 'timeZoneName')?.value ?? 'GMT-0';
  const match = name.match(/GMT([+-]?\d+)/i) ?? name.match(/([+-]\d+)/);
  return match ? Number(match[1]) : 0;
}

export function sameDivision(a?: string, b?: string): boolean {
  return Boolean(a && b && a === b);
}

export interface VenueInfo {
  team: string;
  name?: string;
  tz: string;
  roof: 'dome' | 'retractable' | 'outdoor';
  division: string;
}

export type WeatherKind = 'dome' | 'sun' | 'hot' | 'rain' | 'snow' | 'wind' | 'cold';

export interface GameWeather {
  kind: WeatherKind;
  label: string;
}

export function describeGameWeather(input: {
  roof?: VenueInfo['roof'];
  stadium?: string;
  forecast?: ForecastRow;
}): GameWeather | undefined {
  const indoor =
    input.forecast?.outdoor === false || input.roof === 'dome' || input.roof === 'retractable';
  if (indoor) {
    const place = input.stadium ?? (input.roof === 'retractable' ? 'Retractable-roof stadium' : 'Indoor stadium');
    const roofBit = input.roof === 'retractable' ? 'retractable roof, treated as closed' : 'closed dome';
    return {
      kind: 'dome',
      label: `${place} is a ${roofBit}. Weather should not affect TD odds.`,
    };
  }

  const f = input.forecast;
  const outdoor = f?.outdoor === true || input.roof === 'outdoor';
  if (!outdoor) return undefined;
  if (!f || f.outdoor !== true || (f.tempF == null && f.windMph == null && f.precipIn == null)) {
    return {
      kind: 'sun',
      label: 'Outdoor stadium. Forecast fills in for the current NFL week.',
    };
  }

  const bits: string[] = [];
  if (f.tempF != null) bits.push(`${Math.round(f.tempF)}°F`);
  if (f.windMph != null) bits.push(`${Math.round(f.windMph)} mph wind`);
  if (f.precipIn != null && f.precipIn > 0.004) bits.push(`${f.precipIn.toFixed(2)}" rain`);
  else bits.push('no rain');

  const snow = (f.tempF ?? 99) <= 32 && (f.precipIn ?? 0) >= 0.05;
  const rain = (f.precipIn ?? 0) >= 0.1;
  const windy = (f.windMph ?? 0) >= 15;
  const cold = (f.tempF ?? 99) <= 32;
  const hot = (f.tempF ?? 0) >= 90;

  let kind: WeatherKind = 'sun';
  let effect = 'Weather is not expected to change TD odds much.';
  if (snow) {
    kind = 'snow';
    effect =
      'Snow and cold usually suppress passing TDs and overall scoring; rushing TDs can tick up if the game stays on the ground.';
  } else if (rain) {
    kind = 'rain';
    effect = 'Rain can cut passing TDs and overall scoring a bit, with a slight lean toward rushing scores.';
  } else if (windy) {
    kind = 'wind';
    effect = 'Wind at 15+ mph makes downfield passing harder, so passing TDs are a bit less likely.';
  } else if (cold) {
    kind = 'cold';
    effect = 'Freezing temps can slow the passing game and scoring a little.';
  } else if (hot) {
    kind = 'hot';
    effect = 'Heat rarely changes TD odds on its own.';
  }

  return { kind, label: `${bits.join(' · ')}. ${effect}` };
}

export interface ScheduleCell {
  team: string;
  week: number;
  opponent?: string;
  home?: boolean;
  bye?: boolean;
  kickoff?: string;
}

export interface TeamContextRow {
  roadWinPct?: number;
  qbName?: string;
  qbRoadWinPct?: number;
  qbBadWeather?: boolean;
}

export interface ForecastRow {
  tempF?: number;
  windMph?: number;
  precipIn?: number;
  outdoor: boolean;
}

export function consecutiveAwayBefore(games: ScheduleCell[], week: number): number {
  const prior = [...games]
    .filter((g) => !g.bye && g.week < week)
    .sort((a, b) => b.week - a.week);
  let n = 0;
  for (const g of prior) {
    if (g.home) break;
    n += 1;
  }
  return n;
}

export function restDaysBetween(prevKickoff?: string, kickoff?: string): number | undefined {
  if (!prevKickoff || !kickoff) return undefined;
  const a = Date.parse(prevKickoff);
  const b = Date.parse(kickoff);
  if (!Number.isFinite(a) || !Number.isFinite(b) || b <= a) return undefined;
  return (b - a) / (1000 * 60 * 60 * 24);
}

export function previousKickoff(games: ScheduleCell[], week: number): string | undefined {
  const prior = [...games]
    .filter((g) => !g.bye && g.week < week && g.kickoff)
    .sort((a, b) => b.week - a.week)[0];
  return prior?.kickoff;
}

export function buildContextInput(args: {
  game: ScheduleCell;
  games: ScheduleCell[];
  venues: Record<string, VenueInfo>;
  teamRow?: TeamContextRow;
  forecast?: ForecastRow;
}): ContextInput | null {
  const { game, games, venues, teamRow, forecast } = args;
  if (game.bye || !game.opponent) return null;
  const home = Boolean(game.home);
  const self = venues[game.team];
  const opp = venues[game.opponent];
  const venue = home ? self : opp;
  const prev = previousKickoff(games, game.week);
  const restDays = restDaysBetween(prev, game.kickoff);
  let tzHoursWestToEast: number | undefined;
  let earlyWindow = false;
  if (game.kickoff && self && venue) {
    const at = new Date(game.kickoff);
    tzHoursWestToEast = tzOffsetHours(venue.tz, at) - tzOffsetHours(self.tz, at);
    const hour = Number(
      new Intl.DateTimeFormat('en-US', { timeZone: venue.tz, hour: 'numeric', hourCycle: 'h23' }).format(at)
    );
    earlyWindow = hour < 17;
  }
  return {
    home,
    consecutiveAwayBefore: consecutiveAwayBefore(games, game.week),
    restDays,
    traveling: !home,
    divisional: sameDivision(self?.division, opp?.division),
    tzHoursWestToEast,
    earlyWindow,
    teamRoadWinPct: teamRow?.roadWinPct,
    qbRoadWinPct: teamRow?.qbRoadWinPct,
    outdoor: forecast?.outdoor ?? venue?.roof === 'outdoor',
    forecastWindMph: forecast?.windMph,
    forecastPrecipIn: forecast?.precipIn,
    forecastTempF: forecast?.tempF,
    qbBadWeather: teamRow?.qbBadWeather,
  };
}
