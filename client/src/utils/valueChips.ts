import type { RankedPlayer } from '../types';

export type ChipTone = 'good' | 'bad' | 'mid';

export type ValueChipOpts = {
  /** Next overall pick in a live board. Live Steal/Reach vs ESPN rank (how far they have fallen). */
  currentOverall?: number;
};

function signed(n: number): string {
  return n > 0 ? `+${n}` : String(n);
}

export function valueChips(
  player: RankedPlayer,
  limit = 4,
  opts?: ValueChipOpts
): Array<{ text: string; tone: ChipTone; title?: string }> {
  const chips: Array<{ text: string; tone: ChipTone; title?: string }> = [];
  if (player.expectedPoints != null) {
    chips.push({ text: `${Math.round(player.expectedPoints)} proj`, tone: 'mid' });
  }
  if (player.sosRank != null) {
    chips.push({
      text:
        player.sosRank <= 8
          ? `SOS #${player.sosRank} easiest`
          : player.sosRank >= 25
            ? `SOS #${player.sosRank} toughest`
            : `SOS #${player.sosRank}`,
      tone: player.sosRank <= 8 ? 'good' : 'mid',
    });
  } else if (player.sos != null) {
    chips.push({
      text:
        player.sos >= 4
          ? `SOS ${player.sos.toFixed(1)} easy`
          : player.sos <= 2
            ? `SOS ${player.sos.toFixed(1)} tough`
            : `SOS ${player.sos.toFixed(1)}`,
      tone: player.sos >= 4 ? 'good' : 'mid',
    });
  }
  const gap =
    player.espnMinusEcr ??
    (player.ecr != null ? player.rank - player.ecr : undefined);
  if (gap != null && Math.abs(gap) >= 8) {
    const n = Math.round(gap);
    const live =
      opts?.currentOverall != null
        ? Math.round(n + Math.max(0, opts.currentOverall - player.rank))
        : undefined;
    const liveLabel = live == null ? '' : ` (${signed(live)})`;
    chips.push({
      text: `${n > 0 ? `Steal +${n}` : `Reach ${n}`}${liveLabel}`,
      tone: n > 0 ? 'good' : 'bad',
      title:
        live == null
          ? n > 0
            ? `ESPN ranks this player ${n} spots later than industry ECR`
            : `ESPN ranks this player ${Math.abs(n)} spots earlier than industry ECR`
          : n > 0
            ? `ESPN ranks ${n} later than ECR. Live ${signed(live)} after falling past ESPN #${player.rank} (pick ${opts?.currentOverall})`
            : `ESPN ranks ${Math.abs(n)} earlier than ECR. Live ${signed(live)} after falling past ESPN #${player.rank} (pick ${opts?.currentOverall})`,
    });
  } else if (player.ecr != null) {
    chips.push({ text: `ECR ${player.ecr}`, tone: 'mid' });
  }
  if (player.ecrMinusAdp != null && player.ecrMinusAdp <= -8) {
    chips.push({ text: `Sleeper ${player.ecrMinusAdp.toFixed(0)} vs ADP`, tone: 'good' });
  }
  if (player.expertSpread != null && player.expertSpread >= 8) {
    chips.push({ text: `Spread ${player.expertSpread.toFixed(1)}`, tone: 'bad' });
  }
  return chips.slice(0, limit);
}

export function statusBadge(status?: string): { label: string; title: string } | null {
  const raw = (status ?? '').trim().toUpperCase();
  if (!raw || raw === 'ACTIVE' || raw === 'HEALTHY') return null;
  if (/SUSPEND/.test(raw)) return { label: 'SUS', title: 'Suspended' };
  if (raw === 'IR' || raw === 'INJURY_RESERVE' || raw.includes('INJURY RESERVE')) {
    return { label: 'IR', title: 'Injured reserve' };
  }
  if (/EXEMPT|NFI|PUP/.test(raw)) return { label: 'Exempt', title: raw.replace(/_/g, ' ') };
  return null;
}
