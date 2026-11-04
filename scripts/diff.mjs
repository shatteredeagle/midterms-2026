// Compares two collector snapshots and returns human-readable change events (newest data wins).
import { STATES, closeTime } from '../assets/states.js';

const KIND = { S: 'Senate', G: 'Governor', H: 'House' };
const label = (id) => { const [k, st, d] = id.split('-'); return k === 'H' ? `${st}-${d} House` : `${STATES[st]?.[0] || st} ${KIND[k]}`; };
const pD = (r) => r.d / ((r.d + r.r) || 1);
const side = (p) => (p >= 0.5 ? `D ${Math.round(p * 100)}%` : `R ${Math.round((1 - p) * 100)}%`);
const MILESTONES = [10, 25, 50, 75, 90, 100];

// `anchors` holds the last LOGGED level per race/control so slow drifts still fire once they total the threshold
// (comparing only to the previous 30-second snapshot misses any move smaller than the threshold per run).
export function diffSnapshots(prev, next, nowMs = Date.now(), anchors = { odds: {}, control: {} }) {
  const t = new Date(nowMs).toISOString();
  const out = [];
  const ev = (type, id, text, extra = {}) => out.push({ t, type, id, text, ...extra });

  // Market odds
  if (prev.markets && next.markets) {
    for (const [id, r] of Object.entries(next.markets.races)) {
      const p = prev.markets.races[id];
      if (!p) continue;
      if (p.d + p.r === 0 || r.d + r.r === 0) { delete anchors.odds[id]; continue; } // party labels were missing: no real odds to compare
      const b = pD(r), thr = id[0] === 'H' ? 0.05 : 0.03;
      const a = anchors.odds[id] ?? pD(p);
      if (Math.abs(b - a) >= thr) { ev('odds', id, `${label(id)}: ${side(a)} → ${side(b)}`, { from: a, to: b }); anchors.odds[id] = b; } else anchors.odds[id] = a;
      const st = id.split('-')[1], pa = pD(p);
      if (STATES[st] && nowMs >= closeTime(st) && (b >= 0.99 || b <= 0.01) && !(pa >= 0.99 || pa <= 0.01)) ev('projected', id, `${label(id)}: market now projects ${b >= 0.5 ? 'D' : 'R'} (${side(b)})`, { to: b });
    }
    for (const ch of ['senate', 'house']) {
      const p = prev.markets.control?.[ch], n = next.markets.control?.[ch];
      if (!p || !n) continue;
      const b = n.d / (n.d + n.r), a = anchors.control[ch] ?? p.d / (p.d + p.r);
      if (Math.abs(b - a) >= 0.01) { ev('control', ch, `${ch === 'senate' ? 'Senate' : 'House'} control: ${side(a)} → ${side(b)}`, { from: a, to: b }); anchors.control[ch] = b; } else anchors.control[ch] = a;
    }
  }

  // Official results
  if (prev.results && next.results) {
    for (const [id, r] of Object.entries(next.results.races)) {
      const p = prev.results.races[id];
      if (!p) continue;
      if (!p.totalVotes && r.totalVotes) ev('count', id, `${label(id)}: first votes reported (${r.pct}% of ${/counties/.test(r.reporting) ? 'counties' : 'precincts'})`, { source: r.source });
      const lead = (x) => x.cands[0]?.votes > 0 ? x.cands[0].n : null;
      if (p.totalVotes && lead(p) && lead(r) && lead(p) !== lead(r)) ev('lead', id, `${label(id)}: lead changes to ${lead(r)} (${r.cands[0].pct}%)`, { source: r.source });
      const unit = /counties/.test(r.reporting) ? 'counties' : 'precincts';
      for (const m of MILESTONES) if (p.pct < m && r.pct >= m) ev('count', id, `${label(id)}: ${m}% of ${unit} reporting${r.cands[0]?.votes ? ` · ${r.cands[0].n} ${r.cands[0].pct}%` : ''}`, { source: r.source });
    }
    for (const [st, f] of Object.entries(next.results.feeds || {})) {
      const was = prev.results.feeds?.[st];
      if (was && was.ok && !f.ok) ev('source', st, `${st} official feed is failing; showing last good data`);
      if (was && !was.ok && f.ok) ev('source', st, `${st} official feed recovered`);
    }
  }

  // Polls
  if (prev.polls && next.polls) {
    const a = prev.polls.generic, b = next.polls.generic;
    if (a && b && Math.abs(b.margin - a.margin) >= 0.1) ev('polls', 'generic', `Generic ballot average: ${a.margin >= 0 ? 'D' : 'R'}+${Math.abs(a.margin).toFixed(1)} → ${b.margin >= 0 ? 'D' : 'R'}+${Math.abs(b.margin).toFixed(1)}`, { from: a.margin, to: b.margin });
    const seen = new Set((a?.polls || []).map((x) => `${x.pollster}|${x.date}|${x.n}`));
    for (const x of (b?.polls || []).filter((y) => !y.dup && !seen.has(`${y.pollster}|${y.date}|${y.n}`)).slice(0, 5)) ev('polls', 'generic', `New generic-ballot poll: ${x.pollster} ${x.margin >= 0 ? 'D' : 'R'}+${Math.abs(x.margin)} (${x.date})`);
    for (const [id, r] of Object.entries(next.polls.races)) {
      const p = prev.polls.races[id];
      if (p && p.rating !== r.rating) ev('rating', id, `${label(id)} rating: ${p.rating} → ${r.rating}`);
    }
  }
  return out;
}

// Hand-maintained files (exit polls, ballot results, other averages, early vote) get log entries when they change,
// so everything added to the page also shows up in "What changed". `prev` null/empty means everything present counts as added.
const n0 = (x) => Number(x).toLocaleString('en-US');
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
export function diffManual(prev = {}, next = {}, nowMs = Date.now()) {
  const t = new Date(nowMs).toISOString();
  const out = [];
  const ev = (type, id, text) => out.push({ t, type, id, text });

  const pe = prev.exit || {}, ne = next.exit || {};
  if ((ne.questions?.length || 0) > 0 && !same([pe.sources, pe.questions], [ne.sources, ne.questions])) {
    const names = (ne.sources || []).map((s) => s.name).join(', ');
    ev('exit', 'exit', `Exit polls ${pe.questions?.length ? 'updated' : 'added'} (${ne.status || 'preliminary'}): ${ne.questions.length} question${ne.questions.length > 1 ? 's' : ''}${names ? ` from ${names}` : ''}`);
  }

  const pb = prev.ballot?.states || {}, nb = next.ballot?.states || {};
  for (const [st, s] of Object.entries(nb)) {
    for (const q of s.questions || []) {
      const old = (pb[st]?.questions || []).find((x) => x.id === q.id);
      if (q.result && !same(old?.result, q.result)) ev('ballot', q.id, `${s.name} ${q.n ? `Question ${q.n}` : q.title}: ${old?.result ? 'updated, ' : ''}Yes ${q.result.yes}%${q.result.reporting ? ` (${q.result.reporting})` : ''}${q.result.source ? ` · ${q.result.source}` : ''}`);
    }
  }

  const pa = Object.fromEntries((prev.averages?.generic || []).map((x) => [x.source, x]));
  for (const x of next.averages?.generic || []) if (!same(pa[x.source], x)) ev('average', x.source, `${x.source} generic ballot average ${pa[x.source] ? 'updated' : 'added'}: ${x.label} (${x.asOf})`);

  const pv = Object.fromEntries((prev.early?.states || []).map((x) => [x.code, x]));
  for (const x of next.early?.states || []) if (!same(pv[x.code], x)) ev('early', x.code, `${x.name} early vote report ${pv[x.code] ? 'updated' : 'added'}: ${n0(x.ballots)} ballots${x.turnoutPct ? ` (${x.turnoutPct}% turnout)` : ''} · ${x.asOf}`);
  return out;
}
