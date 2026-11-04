// Parses Polymarket gamma events into compact race records. Used by the collector (Node) and the browser.
import { NAME_TO_ST } from './states.js?v=78b41692';

const yes = (m) => { try { return Number(JSON.parse(m.outcomePrices)[0]); } catch { return NaN; } };
const party = (m) => {
  const t = `${m.groupItemTitle || ''} ${m.question || ''}`;
  if (/\(D\)|democrat/i.test(t)) return 'D';
  if (/\(R\)|republican/i.test(t)) return 'R';
  return 'O';
};
const clean = (s) => (s || '').replace(/\s*\([A-Z]\)\s*$/, '').trim();

// Markets that label candidates by name only (no party) take their party from `hints` (polls / official feeds), matched on last name.
const lastName = (n) => String(n).toLowerCase().replace(/[^a-z\s'-]/g, ' ').trim().split(/\s+/).pop();

function raceFrom(ev, id, kind, state, extra = {}, hints = []) {
  const hintMap = new Map(hints.map((h) => [lastName(h.n), h.p]));
  const cands = [];
  for (const mk of ev.markets || []) {
    const m = mk;
    const p = yes(m);
    if (!Number.isFinite(p) || /^(Person|Party|Candidate) [A-Z]$/.test(m.groupItemTitle || '')) continue;
    const name = clean(m.groupItemTitle);
    let pty = party(m);
    if (pty === 'O' && hintMap.has(lastName(name))) pty = hintMap.get(lastName(name));
    let tok = null;
    try { tok = JSON.parse(mk.clobTokenIds)[0]; } catch { /* no token */ }
    cands.push({ n: name, p: pty, price: p, tok });
  }
  if (!cands.length) return null;
  const sum = (k) => cands.filter((c) => c.p === k).reduce((a, c) => a + c.price, 0);
  const d = sum('D'), r = sum('R'), o = sum('O'), tot = d + r + o || 1;
  // Token of the Democratic "Yes" market, used for price history (kept for Senate, governor and chamber control only).
  const dTok = kind === 'H' ? null : cands.filter((c) => c.p === 'D' && c.tok).sort((a, b) => b.price - a.price)[0]?.tok || null;
  return { id, kind, state, d: d / tot, r: r / tot, o: o / tot, vol: Math.round(Number(ev.volume) || 0), cands: cands.sort((a, b) => b.price - a.price).slice(0, 4).map(({ tok, ...c }) => c), slug: ev.slug, ...(dTok ? { dTok } : {}), ...extra };
}

const bucketMid = (label) => {
  const nums = label.match(/\d+/g)?.map(Number) || [];
  if (/below|≤/i.test(label)) return nums[0] - 2.5;
  if (/\+/.test(label)) return nums[0] + 2.5;
  return nums.length === 2 ? (nums[0] + nums[1]) / 2 : nums[0];
};
function seatDist(ev) {
  const b = (ev.markets || []).map((m) => ({ label: m.groupItemTitle, p: yes(m) })).filter((x) => Number.isFinite(x.p));
  const tot = b.reduce((a, x) => a + x.p, 0) || 1;
  return { buckets: b.map((x) => ({ label: x.label, p: x.p / tot })), mean: b.reduce((a, x) => a + (x.p / tot) * bucketMid(x.label), 0) };
}

// Ballot-question markets (only a few exist): event slug -> question id.
export const BALLOT_SLUGS = { 'massachusetts-passes-jungle-primary-ballot-measure': 'MA-3' };

export function parseEvents(events, hints = {}) {
  const out = { races: {}, control: {}, seats: {}, ballot: {} };
  for (const ev of events) {
    const t = (ev.title || '').trim();
    let m;
    if (BALLOT_SLUGS[ev.slug]) {
      const mk = (ev.markets || [])[0];
      if (mk && Number.isFinite(yes(mk))) out.ballot[BALLOT_SLUGS[ev.slug]] = { yes: yes(mk), vol: Math.round(Number(ev.volume) || 0), slug: ev.slug };
    } else if ((m = t.match(/^(.+?) Senate Election Winner/))) {
      const st = NAME_TO_ST[m[1].trim().toLowerCase()];
      const r = st && raceFrom(ev, `S-${st}`, 'S', st, {}, hints[`S-${st}`]);
      if (r) out.races[r.id] = r;
    } else if ((m = t.match(/^(.+?) Governor Election Winner/))) {
      const st = NAME_TO_ST[m[1].trim().toLowerCase()];
      const r = st && raceFrom(ev, `G-${st}`, 'G', st, {}, hints[`G-${st}`]);
      if (r) out.races[r.id] = r;
    } else if ((m = t.match(/^([A-Z]{2})-(\d{2}) House Election Winner/))) {
      const r = raceFrom(ev, `H-${m[1]}-${m[2]}`, 'H', m[1], { district: m[2] }, hints[`H-${m[1]}-${m[2]}`]);
      if (r) out.races[r.id] = r;
    } else if (ev.slug === 'which-party-will-win-the-senate-in-2026' || ev.slug === 'which-party-will-win-the-house-in-2026') {
      const r = raceFrom(ev, 'x', 'C', '');
      if (r) out.control[ev.slug.includes('senate') ? 'senate' : 'house'] = { d: r.d, r: r.r, vol: r.vol, ...(r.dTok ? { dTok: r.dTok } : {}) };
    } else if (ev.slug === 'republican-house-seats-after-the-2026-midterm-elections') out.seats.houseR = seatDist(ev);
    else if (ev.slug.startsWith('republican-senate-seats-after-the-2026-midterm-elections')) out.seats.senateR = seatDist(ev);
    else if (ev.slug === 'balance-of-power-2026-midterms') {
      out.control.balance = Object.fromEntries((ev.markets || []).map((x) => [x.groupItemTitle, yes(x)]));
    }
  }
  return out;
}

export const GAMMA = 'https://gamma-api.polymarket.com/events';
export async function fetchControl(fetchFn = fetch) {
  const slugs = ['which-party-will-win-the-senate-in-2026', 'which-party-will-win-the-house-in-2026'];
  const evs = [];
  for (const s of slugs) evs.push(...(await (await fetchFn(`${GAMMA}?slug=${s}`)).json()));
  return parseEvents(evs).control;
}
