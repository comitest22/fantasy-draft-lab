/**
 * Extract ESPN PPR Top 300 cheat-sheet PDFs -> data/enrichment/espn-ppr-overall/{year}.csv
 * PDFs live in %TEMP%/espn-ppr-pdfs/{year}.pdf (downloaded from g.espncdn.com ffldraftkit).
 */
const fs = require('fs');
const path = require('path');
const pdf = require('pdf-parse');

const PDF_DIR = path.join(process.env.TEMP, 'espn-ppr-pdfs');
const OUT_DIR = path.resolve(__dirname, '../../data/enrichment/espn-ppr-overall');
const YEARS = [2014, 2015, 2016, 2017, 2018, 2019, 2020, 2021, 2022, 2023, 2024, 2025, 2026];
const POS_RE = 'WR|RB|TE|QB|K|DST|DEF';
const VALID_BYE = new Set([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14]);

const NAME_ALIASES = {
  'Bill Croskey-Merritt': 'Jacory Croskey-Merritt',
  'Hollywood Brown': 'Marquise Brown',
};

const TEAM_TO_DST = {
  'Arizona Cardinals': 'Cardinals D/ST',
  'Atlanta Falcons': 'Falcons D/ST',
  'Baltimore Ravens': 'Ravens D/ST',
  'Buffalo Bills': 'Bills D/ST',
  'Carolina Panthers': 'Panthers D/ST',
  'Chicago Bears': 'Bears D/ST',
  'Cincinnati Bengals': 'Bengals D/ST',
  'Cleveland Browns': 'Browns D/ST',
  'Dallas Cowboys': 'Cowboys D/ST',
  'Denver Broncos': 'Broncos D/ST',
  'Detroit Lions': 'Lions D/ST',
  'Green Bay Packers': 'Packers D/ST',
  'Houston Texans': 'Texans D/ST',
  'Indianapolis Colts': 'Colts D/ST',
  'Jacksonville Jaguars': 'Jaguars D/ST',
  'Kansas City Chiefs': 'Chiefs D/ST',
  'Las Vegas Raiders': 'Raiders D/ST',
  'Oakland Raiders': 'Raiders D/ST',
  'Los Angeles Chargers': 'Chargers D/ST',
  'San Diego Chargers': 'Chargers D/ST',
  'Los Angeles Rams': 'Rams D/ST',
  'St. Louis Rams': 'Rams D/ST',
  'Miami Dolphins': 'Dolphins D/ST',
  'Minnesota Vikings': 'Vikings D/ST',
  'New England Patriots': 'Patriots D/ST',
  'New Orleans Saints': 'Saints D/ST',
  'New York Giants': 'Giants D/ST',
  'New York Jets': 'Jets D/ST',
  'Philadelphia Eagles': 'Eagles D/ST',
  'Pittsburgh Steelers': 'Steelers D/ST',
  'San Francisco 49ers': '49ers D/ST',
  'Seattle Seahawks': 'Seahawks D/ST',
  'Tampa Bay Buccaneers': 'Buccaneers D/ST',
  'Tennessee Titans': 'Titans D/ST',
  'Washington Redskins': 'Redskins D/ST',
  'Washington Football Team': 'Football Team D/ST',
  'Washington Commanders': 'Commanders D/ST',
};

function normalizePos(raw) {
  if (raw === 'DST' || raw === 'DEF') return 'D/ST';
  return raw;
}

function normalizeName(name, pos) {
  let n = name.replace(/\s+/g, ' ').trim();
  n = NAME_ALIASES[n] || n;
  if (pos === 'D/ST') {
    if (TEAM_TO_DST[n]) return TEAM_TO_DST[n];
    if (!/D\/ST$/i.test(n)) {
      const nick = n.replace(/^(New York|New England|Green Bay|Kansas City|Tampa Bay|Los Angeles|San Francisco|Las Vegas|San Diego|St\. Louis|Washington)\s+/i, '');
      return `${nick} D/ST`;
    }
  }
  return n;
}

function splitAuctionBye(digits) {
  if (!digits) return { auction: 0, bye: 0 };
  const tries = [];
  if (digits.length >= 2) tries.push({ bye: parseInt(digits.slice(-2), 10), auc: digits.slice(0, -2) });
  tries.push({ bye: parseInt(digits.slice(-1), 10), auc: digits.slice(0, -1) });
  for (const t of tries) {
    if (!VALID_BYE.has(t.bye)) continue;
    if (t.auc.length > 2) continue;
    const auction = t.auc.length ? parseInt(t.auc, 10) : 0;
    if (t.bye >= 10 && t.auc.length === 0) continue;
    return { auction, bye: t.bye };
  }
  return null;
}

function parseDigitsAfterTeam(rest) {
  const dollar = rest.match(/^\$(\d+)/);
  if (dollar) {
    const digits = dollar[1];
    if (digits.startsWith('0') && digits.length >= 2) {
      const afterZero = digits.slice(1);
      if (afterZero.length >= 2) {
        const bye2 = parseInt(afterZero.slice(0, 2), 10);
        if (VALID_BYE.has(bye2) && bye2 >= 10) return { auction: 0, bye: bye2 };
      }
      const bye1 = parseInt(afterZero.slice(0, 1), 10);
      if (VALID_BYE.has(bye1)) return { auction: 0, bye: bye1 };
    }
    return splitAuctionBye(digits);
  }
  const plain = rest.match(/^(\d+)/);
  if (!plain) return { auction: 0, bye: 0 };
  const digits = plain[1];
  if (digits.length >= 2) {
    const bye2 = parseInt(digits.slice(0, 2), 10);
    if (VALID_BYE.has(bye2) && bye2 >= 10) return { auction: 0, bye: bye2 };
  }
  const bye1 = parseInt(digits.slice(0, 1), 10);
  if (VALID_BYE.has(bye1)) return { auction: 0, bye: bye1 };
  return null;
}

function parsePayload(payload, pos) {
  const cleaned = payload.replace(/\s+/g, ' ').trim();
  const m = cleaned.match(/^(.+?),\s*([A-Z]{2,3}|FA)(.*)$/);
  if (!m) return null;
  const split = parseDigitsAfterTeam(m[3].trim());
  if (!split) return null;
  return {
    playerName: normalizeName(m[1], pos),
    position: pos,
  };
}

function parseLine(line) {
  const start = line.match(/^(\d{1,3})\.\s*\((?:WR|RB|TE|QB|K|DST|DEF)\d+\)/);
  if (!start) return [];
  const n = parseInt(start[1], 10);
  if (n < 1 || n > 80) return [];
  const ranks = [n, n + 80, n + 160, n + 240].filter((r) => r <= 300);
  const players = [];
  for (let i = 0; i < ranks.length; i++) {
    const rank = ranks[i];
    const marker = new RegExp(`${rank}\\.\\s*\\((${POS_RE})(\\d+)\\)`);
    const m = marker.exec(line);
    if (!m) continue;
    const pos = normalizePos(m[1]);
    const after = m.index + m[0].length;
    let payload;
    if (i + 1 < ranks.length) {
      const next = new RegExp(`${ranks[i + 1]}\\.\\s*\\((${POS_RE})\\d+\\)`);
      const nMatch = next.exec(line.slice(after));
      payload = nMatch ? line.slice(after, after + nMatch.index) : line.slice(after);
    } else {
      payload = line.slice(after);
    }
    const parsed = parsePayload(payload, pos);
    if (parsed) players.push({ ...parsed, adp: rank });
  }
  return players;
}

function parsePdfText(text) {
  const byRank = new Map();
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    for (const p of parseLine(line)) {
      if (!byRank.has(p.adp)) byRank.set(p.adp, p);
    }
  }
  return [...byRank.values()].sort((a, b) => a.adp - b.adp);
}

function csvEscape(value) {
  const s = String(value);
  if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  for (const year of YEARS) {
    const pdfPath = path.join(PDF_DIR, `${year}.pdf`);
    if (!fs.existsSync(pdfPath) || fs.statSync(pdfPath).size < 1000) {
      console.log(`${year}: missing PDF`);
      continue;
    }
    const data = await pdf(fs.readFileSync(pdfPath));
    fs.writeFileSync(path.join(PDF_DIR, `${year}.txt`), data.text);
    const rows = parsePdfText(data.text);
    const missing = [];
    for (let r = 1; r <= 300; r++) {
      if (!rows.some((p) => p.adp === r)) missing.push(r);
    }
    const lines = [
      'playerName,season,position,adp,expectedPoints',
      ...rows.map((p) =>
        [p.playerName, year, p.position, p.adp, '']
          .map(csvEscape)
          .join(',')
      ),
    ];
    fs.writeFileSync(path.join(OUT_DIR, `${year}.csv`), lines.join('\n') + '\n');
    const top = rows.slice(0, 5).map((p) => `${p.adp}. ${p.playerName} (${p.position})`).join('; ');
    console.log(`${year}: ${rows.length}/300 missing=${missing.length} [${missing.slice(0, 15).join(',')}${missing.length > 15 ? '…' : ''}]`);
    console.log(`  ${top}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
