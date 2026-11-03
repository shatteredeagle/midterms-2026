import { STATES, closeTime } from './states.js?v=76e1b2c4';
import { fetchControl } from './markets.js?v=76e1b2c4';

const REPO = 'ShatteredEagle/midterms-2026';
const RAW = `https://raw.githubusercontent.com/${REPO}/data/`;
const KIND = { S: 'Senate', G: 'Governor', H: 'House' };
const $ = (s, r = document) => r.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const pct = (x, d = 0) => (x * 100).toFixed(d) + '%';
const FIPS = {};
for (const [st, v] of Object.entries(STATES)) FIPS[v[1]] = st;

const S = { pollTab: 'H', senAll: false, history: null, early: null, turnout: null, otherAvgs: null, ballot: null, bqState: 'MA', changes: null, chgF: 'all', chgAll: false, chgSeen: 0, markets: null, polls: null, results: null, status: null, exit: null, control: null, paths: null, kind: 'S', sel: null, rkind: 'S', sort: 'close', q: '', showAll: false, fetchedAt: {} };

// ---------- data ----------
// raw.githubusercontent.com caches 5 min regardless of query string, so the browser reads the bundle through the
// GitHub contents API (conditional requests: 304s are free against the rate limit) and falls back to raw, then the seed copy.
const API = `https://api.github.com/repos/${REPO}/contents/bundle.json?ref=data`;
async function getBundle() {
  const tries = [
    () => fetch(API, { headers: { Accept: 'application/vnd.github.raw' } }),
    () => fetch(`${RAW}bundle.json`),
    () => fetch('data/bundle.json'),
  ];
  for (const t of tries) {
    try { const r = await t(); if (r.ok) return await r.json(); } catch { /* next */ }
  }
  return null;
}
const HIST_API = `https://api.github.com/repos/${REPO}/contents/history.json?ref=data`;
async function loadHistory() {
  for (const t of [() => fetch(HIST_API, { headers: { Accept: 'application/vnd.github.raw' } }), () => fetch(`${RAW}history.json`)]) {
    try { const r = await t(); if (r.ok) { S.history = await r.json(); return; } } catch { /* next */ }
  }
}
async function loadAll() {
  const [b, exit] = await Promise.all([getBundle(), fetch('data/exit-polls.json', { cache: 'no-store' }).then((r) => r.json()).catch(() => null)]);
  if (b) Object.assign(S, { turnout: b.turnout || S.turnout, changes: b.changes || S.changes, markets: b.markets || S.markets, polls: b.polls || S.polls, results: b.results || S.results, status: b.status || S.status });
  if (exit) S.exit = exit;
  if (!S.early) S.early = await fetch('data/early-vote.json', { cache: 'no-store' }).then((r) => r.json()).catch(() => null);
  if (!S.otherAvgs) S.otherAvgs = await fetch('data/other-averages.json', { cache: 'no-store' }).then((r) => r.json()).catch(() => null);
  if (!S.ballot) S.ballot = await fetch('data/ballot-questions.json', { cache: 'no-store' }).then((r) => r.json()).catch(() => null);
  S.fetchedAt.main = Date.now();
}
async function loadControl() {
  try { S.control = await fetchControl(); S.fetchedAt.control = Date.now(); } catch { /* keep snapshot */ }
}

// ---------- model ----------
const now = () => Date.now();
const isClosed = (st) => now() >= closeTime(st);
function race(id) {
  const m = S.markets?.races?.[id], p = S.polls?.races?.[id], o = S.results?.races?.[id];
  if (!m && !p && !o) return null;
  const st = id.split('-')[1];
  let pD = null;
  if (m && m.d + m.r > 0) pD = m.d / (m.d + m.r);
  else if (p) { const lp = p.cands.find((c) => p.leader && c.n.includes(p.leader))?.p; if (lp) pD = lp === 'D' ? p.winProb : 1 - p.winProb; }
  const closed = isClosed(st);
  const projected = closed && pD !== null && (pD >= 0.99 || pD <= 0.01);
  return { id, kind: id[0], st, m, p, o, pD, closed, projected };
}
const binOf = (pD) => pD === null ? 'none' : pD >= .95 ? 'D3' : pD >= .8 ? 'D2' : pD >= .62 ? 'D1' : pD > .38 ? 'T' : pD > .2 ? 'R1' : pD > .05 ? 'R2' : 'R3';
const leanText = (pD) => pD === null ? 'No data' : pD >= .5 ? `D ${pct(pD)}` : `R ${pct(1 - pD)}`;
function allRaces(kind) {
  const ids = new Set([...Object.keys(S.markets?.races || {}), ...Object.keys(S.polls?.races || {})].filter((k) => k[0] === kind));
  return [...ids].map(race).filter(Boolean);
}
// A seat "flips" when the party favored to win is not the party that holds it today (holder = winner of its last election, from PollCheck).
function flipInfo(r) {
  const holder = r?.p?.holder;
  if (!r || r.pD === null || !holder || holder === 'I') return null;
  const to = holder === 'R' ? 'D' : 'R';
  const prob = holder === 'R' ? r.pD : 1 - r.pD;
  return { holder, to, prob, flipping: prob > 0.5, name: r.p.holderName };
}
function houseState(st) {
  const rs = allRaces('H').filter((r) => r.st === st && r.m && r.pD !== null);
  if (!rs.length) return null;
  const d = rs.reduce((a, r) => a + r.pD, 0);
  return { n: rs.length, d, r: rs.length - d, share: d / rs.length };
}

// ---------- trends ----------
// Sparkline for [[unixSeconds, value], ...]. Domain [lo, hi]; optional guide line at `mid`.
function spark(pts, { w = 240, h = 46, lo = 0, hi = 1, mid = null, label = 'Trend', cls = '' } = {}) {
  if (!pts || pts.length < 2) return '';
  const t0 = pts[0][0], t1 = pts[pts.length - 1][0];
  const X = (t) => 2 + ((t - t0) / (t1 - t0 || 1)) * (w - 4), Y = (v) => h - 3 - ((Math.min(hi, Math.max(lo, v)) - lo) / (hi - lo)) * (h - 6);
  const d = pts.map((p, i) => `${i ? 'L' : 'M'}${X(p[0]).toFixed(1)} ${Y(p[1]).toFixed(1)}`).join('');
  const last = pts[pts.length - 1];
  return `<svg class="spark ${cls}" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" role="img" aria-label="${esc(label)}">${mid !== null ? `<line class="mid" x1="0" x2="${w}" y1="${Y(mid)}" y2="${Y(mid)}"/>` : ''}<path class="line" d="${d}"/><circle cx="${X(last[0]).toFixed(1)}" cy="${Y(last[1]).toFixed(1)}" r="3"/></svg>`;
}
const since = (pts, secs) => { const cut = pts[pts.length - 1][0] - secs; return pts.filter((p) => p[0] >= cut); };
function oddsTrend(id, { label = 'D win odds' } = {}) {
  const s = S.history?.series?.[id];
  if (!s || s.length < 4) return '';
  const w = since(s, 7 * 86400), a = w[0][1], b = w[w.length - 1][1], d = Math.round((b - a) * 100);
  return `<div class="trend"><div class="trend-h"><span class="small">${label}, 7 days</span><span class="small"><b>${Math.round(a * 100)}% → ${Math.round(b * 100)}%</b> <span class="delta ${d > 0 ? 'up' : d < 0 ? 'down' : ''}">${d > 0 ? '+' : ''}${d} pts</span></span></div>${spark(w, { mid: 0.5, label: `${label} over the last 7 days, from ${Math.round(a * 100)}% to ${Math.round(b * 100)}%` })}</div>`;
}
function countTrend(id) {
  const c = S.history?.counts?.[id];
  if (!c || c.length < 2) return '';
  const pts = c.map((p) => [p[0], p[2]]);
  const last = c[c.length - 1], m = Math.max(5, ...pts.map((p) => Math.abs(p[1])));
  return `<div class="trend"><div class="trend-h"><span class="small">Lead over time</span><span class="small"><b>${esc(last[4])} ${last[2] >= 0 ? '+' : '−'}${Math.abs(last[2]).toFixed(1)}</b> at ${last[1]}% reporting</span></div>${spark(pts, { lo: -m, hi: m, mid: 0, label: `Lead margin over time, now ${last[4]} by ${Math.abs(last[2])} points` })}</div>`;
}

// ---------- hero ----------
function renderClock() {
  const times = Object.keys(STATES).map((s) => [closeTime(s), s]).sort((a, b) => a[0] - b[0]);
  const next = times.find((t) => t[0] > now());
  const closed = times.filter((t) => t[0] <= now()).length;
  const el = $('#clock');
  const fmt = (t) => new Date(t).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', timeZoneName: 'short' });
  const row = (eyebrow, when, meta) => `<span class="eyebrow">${eyebrow}</span><span class="when">${when}</span><span class="meta">${meta}</span>`;
  if (now() < times[0][0]) {
    const same = times.filter((t) => t[0] === times[0][0]).map((t) => t[1]).join(', ');
    el.innerHTML = row('Election Day · Nov 3', countdown(times[0][0] - now()), `until the first polls close (${fmt(times[0][0])}): ${esc(same)}`);
  } else if (next) {
    const same = times.filter((t) => t[0] === next[0]).map((t) => t[1]).join(', ');
    el.innerHTML = row(`Polls closed in ${closed} of 51`, countdown(next[0] - now()), `until the next close at ${fmt(next[0])}: ${esc(same)}`);
  } else el.innerHTML = row('Polls', 'All closed', 'Counting continues; late ballots can move margins.');
}
const countdown = (ms) => { const s = Math.max(0, Math.floor(ms / 1000)); const h = Math.floor(s / 3600), m = Math.floor(s % 3600 / 60); return h ? `${h}h ${String(m).padStart(2, '0')}m` : `${m}m ${String(s % 60).padStart(2, '0')}s`; };

function renderSenate() {
  const rs = allRaces('S').filter((r) => r.pD !== null);
  const NOT_UP = { D: 34, R: 31 }; // seats not on the ballot (incl. independents caucusing)
  let dC = 0, dF = 0, t = 0, rF = 0, rC = 0;
  for (const r of rs) {
    if (r.projected) r.pD >= .5 ? dC++ : rC++;
    else if (r.pD >= .62) dF++; else if (r.pD <= .38) rF++; else t++;
  }
  const cells = [...Array(NOT_UP.D).fill('D0'), ...Array(dC).fill('D0'), ...Array(dF).fill('D1'), ...Array(t).fill('T'), ...Array(rF).fill('R1'), ...Array(rC).fill('R0'), ...Array(NOT_UP.R).fill('R0')];
  const dTot = NOT_UP.D + dC + dF, rTot = NOT_UP.R + rC + rF;
  const c = S.control?.senate || S.markets?.control?.senate;
  $('#cardSenate').innerHTML = `<h3>Senate · 51 for majority</h3>
    <div class="big"><b class="d">${dTot}</b><small>D incl. leaning</small><b class="r">${rTot}</b><small>R incl. leaning</small></div>
    <div class="waffle" role="img" aria-label="Senate seats: ${dTot} Democratic or leaning, ${t} toss-up, ${rTot} Republican or leaning">${cells.map((k) => `<i class="${k}"></i>`).join('')}</div>
    <div class="waffle-key"><span style="--c:var(--d)">Safe/called D</span><span style="--c:var(--d-2)">Leans D</span><span style="--c:var(--t)">Toss-up ${t}</span><span style="--c:var(--r-2)">Leans R</span><span style="--c:var(--r)">Safe/called R</span></div>
    ${oddsTrend('control-senate', { label: 'Democrats control Senate' })}
    <p class="meta">${c ? `Market control odds: <b>D ${pct(c.d / (c.d + c.r))}</b> · R ${pct(c.r / (c.d + c.r))}. ` : ''}Projected so far: D ${dC} · R ${rC}.</p>`;
}
function renderHouse() {
  const c = S.control?.house || S.markets?.control?.house;
  const seats = S.markets?.seats?.houseR;
  const d = c ? c.d / (c.d + c.r) : null;
  const expR = seats ? Math.round(seats.mean) : null;
  $('#cardHouse').innerHTML = `<h3>House · 218 for majority</h3>
    ${d === null ? '<p class="meta">No data yet.</p>' : `<div class="big"><b class="d">${pct(d)}</b><small>Democrats</small><b class="r">${pct(1 - d)}</b><small>Republicans</small></div>
    <div class="split" role="img" aria-label="House control odds"><i class="d" style="width:${d * 100}%"></i><i class="r" style="width:${(1 - d) * 100}%"></i></div>`}
    ${oddsTrend('control-house', { label: 'Democrats control House' })}
    <p class="meta">${expR ? `Market-implied: about <b>${435 - expR} D</b> – ${expR} R seats. ` : ''}House calls come in slowly; district results are not in a free feed, so this is odds, not a count.</p>`;
}
const row = (lbl, d, r, t = 0, fmt = (x) => Math.round(x) + '%', tl = '') => `<div class="row"><span class="lbl">${lbl}</span><div><div class="vals"><span class="d">D ${fmt(d)}</span>${t ? `<span class="t">${tl} ${fmt(t)}</span>` : ''}<span class="r">${fmt(r)} R</span></div><div class="split" role="img" aria-label="${lbl}: Democratic ${fmt(d)}, Republican ${fmt(r)}"><i class="d" style="width:${d / ((d + r + t) || 1) * 100}%"></i>${t ? `<i class="t" style="width:${t / (d + r + t) * 100}%"></i>` : ''}<i class="r" style="width:${r / ((d + r + t) || 1) * 100}%"></i></div></div></div>`;
function renderCompare() {
  const mc = S.control || S.markets?.control || {};
  const pr = (x) => (x ? [x.d / (x.d + x.r) * 100, x.r / (x.d + x.r) * 100] : null);
  const hs = pr(mc.house), ss = pr(mc.senate), bal = mc.balance || S.markets?.control?.balance;
  const sweeps = bal ? `${row('Dem. sweep', (bal['Democrats Sweep'] || 0) * 100, (bal['Republicans Sweep'] || 0) * 100)}` : '';
  $('#cardMarket').innerHTML = `<header><h3>Market odds</h3><span class="what">Chance to win, set by traders</span></header>
    ${hs ? row('House control', ...hs) : ''}${ss ? row('Senate control', ...ss) : ''}${sweeps}
    <p class="meta">Last row: Democratic sweep vs. Republican sweep of both chambers.</p>`;
  const g = S.polls?.generic;
  // Every Senate race: PollCheck rating when it has one; otherwise the market lean (PollCheck's table omits safe seats).
  const ids = new Set([...Object.keys(S.polls?.races || {}), ...Object.keys(S.markets?.races || {})].filter((k) => k[0] === 'S'));
  const sideOf = (id) => {
    const p = S.polls?.races?.[id];
    if (p) return / D$/.test(p.rating) ? 'D' : / R$/.test(p.rating) ? 'R' : 'T';
    const m = S.markets?.races?.[id];
    if (!m) return null;
    const d = m.d / ((m.d + m.r) || 1);
    return d >= .62 ? 'D' : d <= .38 ? 'R' : 'T';
  };
  const sides = [...ids].map(sideOf).filter(Boolean);
  const rs = sides;
  const nd = 34 + sides.filter((s) => s === 'D').length, nr = 31 + sides.filter((s) => s === 'R').length, nt = sides.filter((s) => s === 'T').length;
  $('#cardPolls').innerHTML = `<header><h3>Polling average</h3><span class="what">Share of voters, from surveys</span></header>
    ${g ? row('Generic ballot', g.dem, g.rep, 0, (x) => x.toFixed(1) + '%') : ''}
    ${rs.length ? row('Senate seats', nd, nr, nt, (x) => String(x), 'Toss-up') : ''}
    <p class="meta">${g ? `Generic ballot margin ${g.margin >= 0 ? 'D' : 'R'}+${Math.abs(g.margin).toFixed(1)}. ` : ''}Senate row counts each race by its PollCheck rating (market lean where unrated), plus seats not up.</p>`;
}

// ---------- flips ----------
function renderFlips() {
  const el = $('#flips-body');
  const col = (kind, title) => {
    const rs = allRaces(kind).map((r) => ({ r, f: flipInfo(r) })).filter((x) => x.f);
    const flipping = rs.filter((x) => x.f.flipping), toD = flipping.filter((x) => x.f.to === 'D').length, toR = flipping.length - toD;
    const list = rs.filter((x) => x.f.prob >= 0.3).sort((a, b) => b.f.prob - a.f.prob).slice(0, 10);
    const net = toD - toR;
    const summary = `If favorites hold: <b style="color:var(--d)">D gains ${toD}</b> · <b style="color:var(--r)">R gains ${toR}</b>${net ? ` · net ${net > 0 ? 'D' : 'R'} +${Math.abs(net)}` : ''}`;
    return `<div><h3 style="font-size:15px;margin-bottom:8px">${title}</h3><p class="flip-sum">${summary}</p><ol class="flip-list">${list.map(({ r, f }) => `<li class="flip-item ${f.flipping ? 'on' : ''}" data-st="${r.st}" tabindex="0" aria-label="${STATES[r.st][0]} ${title}: held by ${f.holder}, ${pct(f.prob)} chance to flip to ${f.to}"><span class="st">${esc(STATES[r.st][0])}${r.p?.special ? ' (sp.)' : ''}</span><span class="arrow"><span class="${f.holder}">${f.holder}</span> → <span class="${f.to}">${f.to}</span></span><div class="bar" role="img" aria-label="${pct(f.prob)} chance to flip"><i style="width:${f.prob * 100}%"></i></div><span class="p">${pct(f.prob)}</span></li>`).join('') || '<li class="small">No close calls right now.</li>'}</ol></div>`;
  };
  el.innerHTML = `<div class="flip-grid">${col('S', 'Senate')}${col('G', 'Governor')}</div><p class="small" style="margin-top:12px">Gold bar = more likely than not to flip. "Holds the seat" means the winner of its last election; appointments and party switches aren't tracked. House flips aren't shown because no free source lists each district's current party.</p>`;
}
function wireFlips() {
  const pick = (t) => { const li = t.closest('.flip-item'); if (li) { select(li.dataset.st); goMap(); } };
  $('#flips-body').addEventListener('click', (e) => pick(e.target));
  $('#flips-body').addEventListener('keydown', (e) => { if (e.key === 'Enter') pick(e.target); });
}

// ---------- map ----------
function drawMap() {
  const svg = $('#usmap');
  const defs = `<defs><pattern id="hatch" width="8" height="8" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="8" height="8" fill="var(--t)"/><rect width="3" height="8" fill="var(--hatch)" opacity=".55"/></pattern></defs>`;
  const paths = Object.entries(S.paths).map(([fips, p]) => {
    const st = FIPS[fips];
    return st ? `<path id="st-${st}" data-st="${st}" d="${p.d}" tabindex="0" role="button"></path>` : '';
  }).join('');
  const labels = Object.entries(S.paths).map(([fips, p]) => {
    const st = FIPS[fips];
    return st && !['CT', 'RI', 'NJ', 'DE', 'MD', 'DC', 'VT', 'NH', 'MA', 'HI', 'AK'].includes(st) ? `<text x="${p.c[0]}" y="${p.c[1]}">${st}</text>` : '';
  }).join('');
  svg.innerHTML = defs + paths + labels;
  $('#smallStates').innerHTML = ['CT', 'RI', 'NJ', 'DE', 'MD', 'DC', 'VT', 'NH', 'MA'].map((s) => `<button class="chip" data-st="${s}" type="button" aria-label="${STATES[s][0]}">${s}</button>`).join('');
}
const earlyOf = (st) => (S.early?.states || []).find((s) => s.code === st);
const earlyPct = (s) => s.turnoutPct ?? s.turnoutApprox ?? null;
function stateInfo(st) {
  if (S.kind === 'E') {
    const s = earlyOf(st);
    if (!s) return { bin: 'none', text: 'No early-vote report this page can read' };
    const p = earlyPct(s);
    return { bin: p === null ? 'none' : p >= 40 ? 'e4' : p >= 30 ? 'e3' : p >= 20 ? 'e2' : 'e1', text: `${s.ballotsLabel || s.ballots.toLocaleString('en-US')} early ballots${p !== null ? ` · ${s.turnoutPct ? '' : '≈'}${p}% turnout` : ''} · ${s.asOf}` };
  }
  if (S.kind === 'H') {
    const h = houseState(st);
    return h ? { bin: h.share >= .95 ? 'D3' : h.share >= .75 ? 'D2' : h.share >= .55 ? 'D1' : h.share > .45 ? 'T' : h.share > .25 ? 'R1' : h.share > .05 ? 'R2' : 'R3', text: `${h.d.toFixed(1)} D · ${h.r.toFixed(1)} R of ${h.n} seats (expected)` } : { bin: 'none', text: 'No market data' };
  }
  const r = race(`${S.kind}-${st}`);
  if (!r) return { bin: 'none', text: `No ${KIND[S.kind]} race in 2026` };
  const official = r.o && r.o.totalVotes > 0;
  const fl = flipInfo(r);
  return { bin: binOf(r.pD), called: r.projected, flip: !!fl?.flipping, text: `${official ? 'Counting · ' : ''}${leanText(r.pD)}${r.projected ? ' · projected' : r.closed ? ' · polls closed' : ''}${fl?.flipping ? ` · projected flip ${fl.holder}→${fl.to}` : ''}` };
}
function paintMap() {
  for (const el of document.querySelectorAll('#usmap path')) {
    const st = el.dataset.st, i = stateInfo(st);
    el.setAttribute('class', `b-${i.bin}${i.called ? ' called' : ''}${i.flip ? ' flip' : ''}${S.sel === st ? ' sel' : ''}`);
    el.setAttribute('aria-label', `${STATES[st][0]}: ${i.text}`);
  }
  for (const c of document.querySelectorAll('.chip')) c.classList.toggle('sel', c.dataset.st === S.sel);
  const sw = (cls, label) => `<span><i class="b-${cls}" style="background:${cls === 'T' ? 'repeating-linear-gradient(45deg,var(--t) 0 3px,var(--hatch) 3px 5px)' : `var(--${{ D3: 'd', D2: 'd-2', D1: 'd-1', R1: 'r-1', R2: 'r-2', R3: 'r', none: 'none' }[cls]})`}"></i>${label}</span>`;
  $('#legend').innerHTML = sw('D3', 'D ≥95%') + sw('D2', 'D 80–95%') + sw('D1', 'D 62–80%') + sw('T', 'Toss-up') + sw('R1', 'R 62–80%') + sw('R2', 'R 80–95%') + sw('R3', 'R ≥95%') + sw('none', S.kind === 'H' ? 'No data' : 'No race') + '<span>Bold outline = projected after polls close</span><span><i style="background:none;border:2px dashed #f2b01e"></i>Gold dashed = favored to flip</span>';
  const eSw = (v, label) => `<span><i style="background:var(--${v})"></i>${label}</span>`;
  if (S.kind === 'E') $('#legend').innerHTML = eSw('e1', 'Under 20%') + eSw('e2', '20–30%') + eSw('e3', '30–40%') + eSw('e4', '40%+') + sw('none', 'No readable report') + '<span>Shade = early-vote turnout of registered or active voters</span>';
  const closedN = Object.keys(STATES).filter(isClosed).length;
  $('#mapSub').textContent = S.kind === 'E' ? 'Early-vote turnout where a state publishes a report this page can use. Most states do not, so most of the map is gray. This shows how many people voted early, not who they voted for.' : S.kind === 'H' ? 'Expected House seats by state, summed from per-district market odds. Updates as markets move.' : `${KIND[S.kind]} races colored by market odds (${closedN} states closed). Official counts appear in the detail panel as feeds publish.`;
}
const PORDER = { D: 0, R: 1, O: 2 };
const money = (n) => (n >= 1e6 ? `$${(n / 1e6).toFixed(1)}M` : `$${Math.round(n / 1e3)}k`);
function candRows(cands, mode) {
  const sorted = [...cands].sort((x, y) => (PORDER[x.p] ?? 2) - (PORDER[y.p] ?? 2));
  return sorted.map((c) => `<div class="cand" data-p="${esc(c.p)}"><span>${esc(c.n)} <span class="small">(${esc(c.p)})</span></span><b>${mode === 'votes' ? `${Number(c.pct).toFixed(1)}%` : mode === 'poll' ? `${c.pct}%` : pct(c.price)}</b><div class="bar"><i style="width:${Math.min(100, mode === 'market' ? c.price * 100 : c.pct)}%"></i></div></div>`).join('');
}
// One labeled block per data source so counts, market odds and polls never read as the same thing.
const block = (cls, title, what, meta, body) => `<section class="sb ${cls}"><header><h5>${title}</h5><span class="what">${what}</span></header>${meta ? `<p class="small sb-meta">${meta}</p>` : ''}${body}</section>`;
function raceBlock(id) {
  const r = race(id);
  if (!r) return '';
  const o = r.o;
  let h = `<div class="race"><h4>${KIND[r.kind]}${r.p?.special ? ' (special)' : ''} ${r.kind === 'H' ? esc(r.m?.district || '') : ''}</h4>`;
  const fi = flipInfo(r);
  if (fi) h += `<p class="small">Held by <b>${fi.holder}</b>${fi.name ? ` (${esc(fi.name)}, last election)` : ''} · chance to flip to ${fi.to}: <span class="tag ${fi.flipping ? 'live' : 'flip'}">${pct(fi.prob)}</span></p>`;
  if (o && o.totalVotes > 0) h += block('official', 'Votes counted', 'Official count', `${esc(o.source)} · ${esc(o.reporting)}${o.winner ? ` · <span class="tag live">State flags winner: ${esc(o.winner)}</span>` : ''}`, candRows(o.cands.map((c) => ({ ...c })), 'votes') + countTrend(id));
  else if (r.closed) h += `<p class="small">Polls closed. No free official feed for this race — check the state election office.</p>`;
  if (r.m) h += block('market', 'Market odds', 'Chance to win, set by traders', `${money(r.m.vol)} traded${r.projected ? ' · <span class="tag live">projected</span>' : ''}`, candRows(r.m.cands.filter((c) => c.price >= .01), 'market') + oddsTrend(id));
  if (r.p) h += block('poll', 'Polling average', 'Share of voters, from surveys', `${esc(r.p.rating)} · ${r.p.polls} polls, ${r.p.pollsters} pollsters${r.p.lead ? ` · <b>${esc(r.p.lead)}</b>` : ''}`, candRows(r.p.cands, 'poll'));
  return h + '</div>';
}
function renderDetail() {
  const el = $('#detail');
  if (!S.sel) {
    el.innerHTML = `<h3>Select a state</h3><p class="small">Click or tab to a state on the map, or pick one from the table, to see its races: official count when available, market odds, and the polling average.</p>`;
    return;
  }
  const st = S.sel, [name, , ] = STATES[st];
  const h = houseState(st);
  const ct = new Date(closeTime(st)).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', timeZoneName: 'short' });
  const es = earlyOf(st);
  const earlyHtml = es ? `<section class="eb"><h5>Early vote</h5><p class="small" style="margin:0"><b>${esc(es.ballotsLabel || es.ballots.toLocaleString('en-US'))}</b> ballots${earlyPct(es) !== null ? ` · ${es.turnoutPct ? '' : '≈'}${earlyPct(es)}% turnout` : ''} · ${esc(es.asOf)}. <a href="#turnout">Details ↓</a></p></section>` : '';
  const racesHtml = earlyHtml + raceBlock(`S-${st}`) + raceBlock(`G-${st}`);
  el.innerHTML = `<h3>${esc(name)}</h3><p class="small">Polls close ${isClosed(st) ? '(closed)' : 'about'} ${ct} · <a href="https://ballotpedia.org/${name.replace(/ /g, '_')}_elections,_2026" target="_blank" rel="noopener">Ballotpedia</a></p>
    ${racesHtml || '<p class="small" style="margin-top:12px">No Senate or governor race here in 2026.</p>'}
    ${h ? `<div class="race"><h4>House · ${h.n} districts</h4><p>Expected <b style="color:var(--d)">${h.d.toFixed(1)} D</b> · <b style="color:var(--r)">${h.r.toFixed(1)} R</b> <span class="small">(sum of district market odds)</span></p><p class="small">Closest: ${allRaces('H').filter((r) => r.st === st && r.m && r.pD !== null).sort((a, b) => Math.abs(a.pD - .5) - Math.abs(b.pD - .5)).slice(0, 3).map((r) => `${st}-${r.m.district} ${leanText(r.pD)}`).join(', ')}</p></div>` : ''}`;
}
function select(st) { S.sel = st; paintMap(); renderDetail(); }
function wireMap() {
  const tip = $('#tip'), wrap = $('.map-wrap');
  const show = (el, ev) => {
    const st = el.dataset.st, i = stateInfo(st);
    tip.hidden = false; tip.innerHTML = `<b>${esc(STATES[st][0])}</b>${esc(i.text)}`;
    const b = wrap.getBoundingClientRect(), x = (ev?.clientX ?? el.getBoundingClientRect().left) - b.left + 14, y = (ev?.clientY ?? el.getBoundingClientRect().top) - b.top + 14;
    tip.style.left = Math.min(x, b.width - 250) + 'px'; tip.style.top = y + 'px';
  };
  const svg = $('#usmap');
  svg.addEventListener('pointermove', (e) => { const p = e.target.closest('path'); p ? show(p, e) : (tip.hidden = true); });
  svg.addEventListener('pointerleave', () => (tip.hidden = true));
  svg.addEventListener('focusin', (e) => { if (e.target.matches('path')) show(e.target); });
  svg.addEventListener('focusout', () => (tip.hidden = true));
  svg.addEventListener('click', (e) => { const p = e.target.closest('path'); if (p) select(p.dataset.st); });
  svg.addEventListener('keydown', (e) => { if ((e.key === 'Enter' || e.key === ' ') && e.target.matches('path')) { e.preventDefault(); select(e.target.dataset.st); } });
  $('#smallStates').addEventListener('click', (e) => { const c = e.target.closest('.chip'); if (c) select(c.dataset.st); });
  $('#mapTabs').addEventListener('click', (e) => {
    const b = e.target.closest('button'); if (!b) return;
    S.kind = b.dataset.m;
    for (const x of document.querySelectorAll('#mapTabs button')) x.setAttribute('aria-selected', x === b);
    paintMap();
  });
}

// ---------- races table ----------
function renderTable() {
  let rs = allRaces(S.rkind);
  const q = S.q.trim().toLowerCase();
  if (q) rs = rs.filter((r) => `${STATES[r.st][0]} ${r.st} ${(r.m?.cands || []).map((c) => c.n).join(' ')} ${(r.p?.cands || []).map((c) => c.n).join(' ')}`.toLowerCase().includes(q));
  rs.sort((a, b) => {
    const ca = a.pD === null ? 9 : Math.abs(a.pD - .5), cb = b.pD === null ? 9 : Math.abs(b.pD - .5);
    return S.sort === 'close' ? ca - cb : STATES[a.st][0].localeCompare(STATES[b.st][0]);
  });
  const LIMIT = 25, shown = S.showAll || q ? rs : rs.slice(0, LIMIT);
  const hasPolls = S.rkind !== 'H';
  const row = (r) => {
    const name = S.rkind === 'H' ? `${r.st}-${r.m.district}` : STATES[r.st][0] + (r.p?.special ? ' (special)' : '');
    const d = r.pD ?? .5;
    const o = r.o && r.o.totalVotes > 0 ? `<span class="tag live">Counting ${r.o.pct}%</span>` : r.projected ? `<span class="tag live">Projected ${r.pD >= .5 ? 'D' : 'R'}</span>` : r.closed ? '<span class="tag">Polls closed</span>' : `<span class="tag">Polls close ${new Date(closeTime(r.st)).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}</span>`;
    const fi = flipInfo(r), fb = fi && fi.prob >= 0.3 ? ` <span class="tag ${fi.flipping ? 'flip' : ''}" title="Chance the seat changes party">${fi.flipping ? 'flip' : 'could flip'} ${fi.holder}→${fi.to} ${pct(fi.prob)}</span>` : '';
    return `<tr data-st="${r.st}" tabindex="0"><th scope="row" style="text-transform:none;letter-spacing:0;font-size:14px;color:var(--text)">${esc(name)}${fb}</th>
      ${hasPolls ? `<td class="rate" data-s="${esc(r.p?.rating || '')}">${esc(r.p?.rating || '—')}</td><td>${esc(r.p?.lead || '—')}</td>` : `<td>${esc(r.m.cands.slice(0, 2).map((c) => c.n.split(' ').pop()).join(' vs '))}</td>`}
      <td><div class="odds" role="img" aria-label="Market odds: Democrat ${pct(d)}, Republican ${pct(1 - d)}"><span>${(d * 100).toFixed(0)}</span><div class="split"><i class="d" style="width:${d * 100}%"></i><i class="r" style="width:${(1 - d) * 100}%"></i></div><span>${((1 - d) * 100).toFixed(0)}</span></div></td>
      <td>${o}</td></tr>`;
  };
  $('#raceTable').innerHTML = `<thead><tr><th>${S.rkind === 'H' ? 'District' : 'State'}</th>${hasPolls ? '<th>Rating</th><th>Poll average</th>' : '<th>Candidates</th>'}<th>Market odds D · R (%)</th><th>Status</th></tr></thead><tbody>${shown.map(row).join('') || '<tr><td colspan="5">No races match.</td></tr>'}</tbody>`;
  const more = $('#moreRow');
  more?.remove();
  if (!q && rs.length > LIMIT) $('#raceTable').insertAdjacentHTML('afterend', `<div class="more" id="moreRow"><button type="button" id="moreBtn">${S.showAll ? 'Show fewer' : `Show all ${rs.length}`}</button></div>`);
}
function wireTable() {
  $('#raceTabs').addEventListener('click', (e) => {
    const b = e.target.closest('button'); if (!b) return;
    S.rkind = b.dataset.k; S.showAll = false;
    for (const x of document.querySelectorAll('#raceTabs button')) x.setAttribute('aria-selected', x === b);
    renderTable();
  });
  $('#q').addEventListener('input', (e) => { S.q = e.target.value; renderTable(); });
  const pick = (t) => { const tr = t.closest('tr[data-st]'); if (tr) { select(tr.dataset.st); goMap(); } };
  $('#raceTable').addEventListener('click', (e) => pick(e.target));
  $('#raceTable').addEventListener('keydown', (e) => { if (e.key === 'Enter') pick(e.target); });
  document.addEventListener('click', (e) => { if (e.target.id === 'moreBtn') { S.showAll = !S.showAll; renderTable(); } });
}

// ---------- polls ----------
const MONTHS = { Jan: 0, Feb: 1, Mar: 2, Apr: 3, May: 4, Jun: 5, Jul: 6, Aug: 7, Sep: 8, Oct: 9, Nov: 10, Dec: 11 };
const parseDate = (s) => { const [d, m, y] = s.split(' '); return Date.UTC(+y, MONTHS[m], +d); };
// Senate has no national ballot, so this is an index: the plain average of every polled Senate race's polling-average margin.
function senatePollRows() {
  return Object.values(S.polls?.races || {}).filter((r) => r.kind === 'S').map((r) => {
    const d = r.cands.find((c) => c.p === 'D'), q = r.cands.find((c) => c.p === 'R');
    return d && q ? { st: r.state, id: r.id, rating: r.rating, special: r.special, d: d.pct, r: q.pct, margin: Math.round((d.pct - q.pct) * 10) / 10, polls: r.polls, dn: d.n, rn: q.n } : null;
  }).filter(Boolean);
}
const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
const fm = (m) => `${m >= 0 ? 'D' : 'R'}+${Math.abs(m).toFixed(1)}`;
function renderSenatePolls() {
  const el = $('#polls-body'), rows = senatePollRows();
  if (!rows.length) { el.innerHTML = '<p class="small">No Senate polling averages available.</p>'; return; }
  const all = mean(rows.map((x) => x.margin)), comp = rows.filter((x) => /Toss|Lean/.test(x.rating)), cm = mean(comp.map((x) => x.margin));
  const dLead = rows.filter((x) => x.margin > 0).length;
  const shown = [...rows].sort((a, b) => Math.abs(a.margin) - Math.abs(b.margin)).slice(0, S.senAll ? rows.length : 12).sort((a, b) => b.margin - a.margin);
  const SC = 20; // bar scale: +/-20 points fills each half
  const hist = (S.history?.senate || []);
  el.innerHTML = `<div class="sen-stats"><div><b style="color:var(--${all >= 0 ? 'd' : 'r'})">${fm(all)}</b><span class="small">all ${rows.length} polled races</span></div>
      <div><b style="color:var(--${cm >= 0 ? 'd' : 'r'})">${comp.length ? fm(cm) : '—'}</b><span class="small">${comp.length} competitive (toss-up and lean)</span></div>
      <div><b>${dLead}<span class="small"> of ${rows.length}</span></b><span class="small">races where D leads</span></div></div>
    ${hist.length > 2 ? `<div class="trend"><div class="trend-h"><span class="small">Index over time (recorded since tonight)</span></div>${spark(hist, { lo: -5, hi: 8, mid: 0, label: 'Senate polling index over time' })}</div>` : ''}
    <p class="small" style="margin:6px 0 12px">Simple average of each race's polling-average margin. It is an index of the races that have polls, not a national poll or a vote forecast: states differ in size and 16 Senate races have no polling average. Click a row to open the state.</p>
    <div role="list">${shown.map((x) => `<div class="sen-row" role="listitem" tabindex="0" data-st="${x.st}"><span class="nm">${esc(STATES[x.st][0])}${x.special ? ' (sp.)' : ''}<span class="rt">${esc(x.rating)} · ${x.polls} polls</span></span><div class="sen-bar" role="img" aria-label="${esc(STATES[x.st][0])}: ${fm(x.margin)}"><i class="${x.margin >= 0 ? 'D' : 'R'}" style="${x.margin >= 0 ? `left:50%;width:${Math.min(50, x.margin / SC * 50)}%` : `right:50%;width:${Math.min(50, -x.margin / SC * 50)}%`}"></i></div><span class="sen-val ${x.margin >= 0 ? 'D' : 'R'}">${fm(x.margin)}</span></div>`).join('')}</div>
    <div class="more"><button type="button" id="senMore">${S.senAll ? 'Show closest 12' : `Show all ${rows.length}`}</button></div>`;
  $('#senMore').onclick = () => { S.senAll = !S.senAll; renderSenatePolls(); };
}
function wirePolls() {
  $('#pollTabs').addEventListener('click', (e) => {
    const b = e.target.closest('button'); if (!b) return;
    S.pollTab = b.dataset.p;
    for (const x of document.querySelectorAll('#pollTabs button')) x.setAttribute('aria-selected', x === b);
    renderPolls();
  });
  const pick = (t) => { const r = t.closest('.sen-row'); if (r) { select(r.dataset.st); goMap(); } };
  $('#polls-body').addEventListener('click', (e) => pick(e.target));
  $('#polls-body').addEventListener('keydown', (e) => { if (e.key === 'Enter') pick(e.target); });
}
function renderPolls() {
  $('#pollsH').textContent = S.pollTab === 'S' ? 'Senate polling' : 'Generic ballot';
  $('#pollsSub').textContent = S.pollTab === 'S' ? 'There is no national Senate ballot, so this combines the polling average in each contested race.' : 'National House polling average, with the individual polls behind it.';
  if (S.pollTab === 'S') return renderSenatePolls();
  const g = S.polls?.generic;
  const el = $('#polls-body');
  if (!g) { el.innerHTML = '<p class="small">Polling data unavailable.</p>'; return; }
  const ps = g.polls.map((p) => ({ ...p, t: parseDate(p.date) }));
  const t0 = Math.min(...ps.map((p) => p.t)), t1 = Math.max(...ps.map((p) => p.t), t0 + 864e5);
  const W = 640, H = 230, L = 34, B = 24, T = 10, R = 10;
  const X = (t) => L + ((t - t0) / (t1 - t0)) * (W - L - R), Y = (m) => T + (1 - (m - 0) / 16) * (H - T - B);
  // 7-day rolling mean of the polls in the average (one point per poll date)
  const incl = ps.filter((p) => !p.dup).sort((x, y) => x.t - y.t);
  const roll = [...new Set(incl.map((p) => p.t))].map((day) => { const w = incl.filter((p) => p.t <= day && p.t > day - 7 * 864e5); return [day, w.reduce((s, p) => s + p.margin, 0) / w.length]; });
  const rollPath = roll.length > 1 ? `<path d="${roll.map((p, i) => `${i ? 'L' : 'M'}${X(p[0]).toFixed(1)} ${Y(p[1]).toFixed(1)}`).join('')}" fill="none" stroke="#e0a21b" stroke-width="2.5"/>` : '';
  const grid = [0, 4, 8, 12, 16].map((v) => `<line class="grid" x1="${L}" x2="${W - R}" y1="${Y(v)}" y2="${Y(v)}"/><text x="${L - 6}" y="${Y(v) + 4}" text-anchor="end">${v ? 'D+' + v : '0'}</text>`).join('');
  const dots = ps.map((p) => { const c = p.margin >= 0 ? 'var(--d)' : 'var(--r)'; return `<circle cx="${X(p.t)}" cy="${Y(Math.abs(p.margin) > 16 ? 16 : p.margin)}" r="5" fill="${p.dup ? 'none' : c}" stroke="${c}" stroke-width="1.5" opacity="${p.dup ? .8 : .75}"><title>${esc(p.pollster)} · ${esc(p.date)} · ${p.margin >= 0 ? 'D' : 'R'}+${Math.abs(p.margin)} (${p.pop}, n=${p.n})${p.dup ? ' · not in average' : ''}</title></circle>`; }).join('');
  const fmtD = (t) => new Date(t).toLocaleDateString([], { month: 'short', day: 'numeric', timeZone: 'UTC' });
  const rows = ps.slice(0, S.showPolls ? 40 : 8).map((p) => `<tr><td>${esc(p.pollster)}${p.dup ? ' <span class="tag" title="Another version of the same survey is in the average">alt. version</span>' : ''}</td><td>${esc(p.date)}</td><td class="num">${p.n.toLocaleString()} ${p.pop}</td><td class="num" style="color:var(--d)">${p.dem}</td><td class="num" style="color:var(--r)">${p.rep}</td><td class="num"><b>${p.margin >= 0 ? 'D' : 'R'}+${Math.abs(p.margin)}</b></td></tr>`).join('');
  const oa = S.otherAvgs?.generic || [];
  const avgCards = `<div class="avgs" aria-label="Generic ballot averages from other publishers"><div class="avg"><b>PollCheck</b><span class="lbl">${g.margin >= 0 ? 'D' : 'R'}+${Math.abs(g.margin).toFixed(1)}</span><span class="small">${g.dem}% – ${g.rep}% · live</span></div>${oa.map((x) => `<a class="avg" href="${esc(x.url)}" target="_blank" rel="noopener"><b>${esc(x.source)} ↗</b><span class="lbl">${esc(x.label)}</span><span class="small">${x.dem ? `${x.dem}% – ${x.rep}% · ` : ''}${esc(x.asOf)}</span></a>`).join('')}</div>`;
  el.innerHTML = `<div><div class="gb"><div><b class="d">${g.dem}%</b><div class="small">Democratic</div></div><div><b class="r">${g.rep}%</b><div class="small">Republican</div></div><div><b>${g.margin >= 0 ? 'D' : 'R'}+${Math.abs(g.margin).toFixed(1)}</b><div class="small">Margin</div></div></div>
    ${avgCards}<p class="small" style="margin-top:14px">Chart and table: PollCheck average across likely-voter polls. Filled dots are in the average; hollow dots are alternate versions of the same survey. The gold line is a 7-day rolling mean of those polls. Hover a dot for details.</p>
    <svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Generic ballot polls by date, margin in points">${grid}<line x1="${L}" x2="${W - R}" y1="${Y(g.margin)}" y2="${Y(g.margin)}" stroke="var(--text)" stroke-dasharray="4 4"/><text x="${W - R}" y="${Y(g.margin) - 6}" text-anchor="end" style="fill:var(--text)">avg ${g.margin >= 0 ? 'D' : 'R'}+${Math.abs(g.margin).toFixed(1)}</text>${rollPath}${dots}<text x="${L}" y="${H - 6}">${fmtD(t0)}</text><text x="${W - R}" y="${H - 6}" text-anchor="end">${fmtD(t1)}</text></svg></div>
    <div class="table-scroll"><table><thead><tr><th>Pollster</th><th>Fielded</th><th class="num">Sample</th><th class="num">D</th><th class="num">R</th><th class="num">Spread</th></tr></thead><tbody>${rows}</tbody></table>
    <div class="more"><button type="button" id="morePolls">${S.showPolls ? 'Show fewer' : 'Show 40 latest'}</button></div></div>`;
  $('#morePolls').onclick = () => { S.showPolls = !S.showPolls; renderPolls(); };
}

// ---------- exit polls ----------
const EXIT_LINKS = [['AP VoteCast / Voter Poll', 'https://apnews.com/hub/ap-votecast'], ['SSRS / Edison Research', 'https://www.edisonresearch.com/'], ['CNN', 'https://www.cnn.com/politics'], ['NBC News', 'https://www.nbcnews.com/politics'], ['ABC News', 'https://abcnews.go.com/Politics'], ['CBS News', 'https://www.cbsnews.com/politics/'], ['Fox News', 'https://www.foxnews.com/politics']];
function renderExit() {
  const x = S.exit, el = $('#exit-body');
  const links = `<div class="links">${EXIT_LINKS.map(([n, u]) => `<a href="${u}" target="_blank" rel="noopener">${n} ↗</a>`).join('')}</div>`;
  if (!x?.questions?.length) {
    $('#exitSub').textContent = 'Aggregated across outlets once published.';
    el.innerHTML = `<div class="pending"><div><b>Waiting for the first release.</b><p class="small" style="margin:6px 0 0">Exit polls and AP VoteCast are not published as open data, and outlets embargo results until polls close in each state. When they appear, this section shows each source side by side with their average. Early waves are preliminary and get re-weighted to the final count, so treat them with caution.</p></div>${links}</div>`;
    return;
  }
  $('#exitSub').textContent = `${x.status === 'final' ? 'Final-weighted' : 'Preliminary'} · updated ${new Date(x.updated).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', timeZoneName: 'short' })}. Average is the unweighted mean across sources.`;
  const src = x.sources;
  el.innerHTML = x.questions.map((q) => `<div class="q"><h3>${esc(q.title)}</h3><div class="table-scroll"><table><thead><tr><th>Group</th>${src.map((s) => `<th class="num">${esc(s.name)}</th>`).join('')}<th>Average D · R</th></tr></thead><tbody>${q.groups.map((g) => {
    const vals = src.map((s) => g.values?.[s.id]);
    const have = vals.filter(Boolean), d = have.length ? have.reduce((a, v) => a + v.dem, 0) / have.length : null, r = have.length ? have.reduce((a, v) => a + v.rep, 0) / have.length : null;
    return `<tr><th scope="row" style="text-transform:none;letter-spacing:0;font-size:14px;color:var(--text)">${esc(g.label)}</th>${vals.map((v) => `<td class="num">${v ? `<span style="color:var(--d)">${v.dem}</span> · <span style="color:var(--r)">${v.rep}</span>` : '—'}</td>`).join('')}<td>${d === null ? '—' : `<div class="odds"><span>${d.toFixed(0)}</span><div class="split"><i class="d" style="width:${d / (d + r) * 100}%"></i><i class="r" style="width:${r / (d + r) * 100}%"></i></div><span>${r.toFixed(0)}</span></div>`}</td></tr>`;
  }).join('')}</tbody></table></div></div>`).join('') + links;
}

// ---------- change feed ----------
const CHG_GROUP = { odds: 'odds', control: 'odds', projected: 'count', count: 'count', lead: 'count', polls: 'polls', rating: 'polls', source: 'count', exit: 'reports', ballot: 'reports', average: 'reports', early: 'reports' };
const ago = (iso) => { const s = Math.max(0, Math.round((now() - Date.parse(iso)) / 1000)); return s < 90 ? `${s}s ago` : s < 5400 ? `${Math.round(s / 60)}m ago` : `${Math.round(s / 3600)}h ago`; };
function renderChanges() {
  const evs = (S.changes?.events || []).filter((e) => S.chgF === 'all' || CHG_GROUP[e.type] === S.chgF);
  const shown = S.chgAll ? evs.slice(0, 100) : evs.slice(0, 12);
  const el = $('#chgList');
  el.innerHTML = shown.length ? shown.map((e) => `<li class="${Date.parse(e.t) > S.chgSeen && S.chgSeen ? 'new' : ''}"><span class="k ${esc(e.type)}">${esc(e.type)}</span><span>${esc(e.text)}</span><time datetime="${esc(e.t)}" title="${esc(new Date(e.t).toLocaleString())}">${ago(e.t)}</time></li>`).join('') : '<li class="empty">No changes logged yet. Entries appear here as odds move, counts come in, and polls update.</li>';
  $('#chgMore').innerHTML = evs.length > 12 ? `<button type="button" id="chgBtn">${S.chgAll ? 'Show fewer' : `Show more (${Math.min(evs.length, 100)})`}</button>` : '';
  $('#chgJson').href = `${RAW}changes.json`;
  if (S.changes?.events?.length) S.chgSeen = Date.parse(S.changes.events[0].t);
}
function wireChanges() {
  $('#chgTabs').addEventListener('click', (e) => {
    const b = e.target.closest('button'); if (!b) return;
    S.chgF = b.dataset.f; S.chgAll = false;
    for (const x of document.querySelectorAll('#chgTabs button')) x.setAttribute('aria-selected', x === b);
    renderChanges();
  });
  document.addEventListener('click', (e) => { if (e.target.id === 'chgBtn') { S.chgAll = !S.chgAll; renderChanges(); } });
}

// ---------- turnout & early vote ----------
function renderTurnout() {
  const n = (x) => Number(x).toLocaleString('en-US');
  const cards = [];
  for (const s of S.early?.states || []) {
    const up = s.total2022 ? ((s.ballots / s.total2022 - 1) * 100).toFixed(0) : null;
    const links = [{ label: s.source, url: s.url }, ...(s.links || [])];
    cards.push(`<article class="tcard"><h3><span>${esc(s.name)} · early vote</span><span class="asof">${esc(s.asOf)}</span></h3>
      <div class="big2 ${s.ballotsLabel ? 'txt' : ''}">${s.ballotsLabel ? esc(s.ballotsLabel) : n(s.ballots)} <span class="small">ballots${s.turnoutPct ? ` · ${s.turnoutPct}% of registered` : ''}</span></div>
      ${up !== null ? `<p class="small" style="margin:0"><b>${up > 0 ? '+' : ''}${up}%</b> vs. ${n(s.total2022)} total absentee and early ballots in 2022.${s.inPerson ? ` In person ${n(s.inPerson)}, mail ${n(s.mail)}.` : ''}</p>` : ''}
      ${s.byParty ? `<div class="stack" role="img" aria-label="Early ballots by party: ${s.byParty.map((p) => `${p.label} ${p.share}%`).join(', ')}">${s.byParty.map((p) => `<i class="${p.party}" style="width:${p.share}%"></i>`).join('')}</div>
      <div class="legend2">${s.byParty.filter((p) => p.share >= 1).map((p) => `<span class="${p.party}">${esc(p.label)} ${p.share}%</span>`).join('')}</div>` : ''}
      ${(s.notes || []).length ? `<details><summary>Details and caveats</summary>${s.notes.map((t) => `<p class="small">${esc(t)}</p>`).join('')}</details>` : ''}
      <p class="small" style="margin:0">${s.byParty ? 'Who voted early, not how they voted. ' : ''}${links.map((l) => `<a href="${esc(l.url)}" target="_blank" rel="noopener">${esc(l.label)} ↗</a>`).join(' · ')}</p></article>`);
  }
  const fl = S.turnout?.FL;
  if (fl) cards.push(`<article class="tcard"><h3><span>Florida · Election Day turnout</span><span class="asof">Live, updates as counties report</span></h3>
      <div class="big2">${n(fl.electionDay)} <span class="small">in-person votes so far</span></div>
      <p class="small" style="margin:0">Sum of ${fl.counties} counties, last reported ${esc(fl.lastReportedET || '')} ET. Excludes early and mail ballots, which Florida counts separately.</p>
      <p class="small" style="margin:0"><a href="${esc(fl.url)}" target="_blank" rel="noopener">${esc(fl.source)} ↗</a></p></article>`);
  $('#turnoutSub').textContent = 'Official early-vote and Election Day turnout reports. Few states publish these in a form this page can read.';
  $('#turnout-body').innerHTML = cards.join('') || '<p class="small">No turnout data yet.</p>';
}

// ---------- ballot questions (MA, RI) ----------
function renderBallot() {
  const b = S.ballot?.states?.[S.bqState], el = $('#ballot-body');
  if (!b) { el.innerHTML = '<p class="small">Ballot question data unavailable.</p>'; return; }
  $('#ballotSub').textContent = `${b.name} statewide questions on the Nov 3 ballot. ${b.threshold}`;
  const card = (q) => {
    const mk = S.markets?.ballot?.[q.id], r = q.result;
    const res = r ? `<div class="res"><div class="cand" data-p="D"><span>Yes</span><b>${r.yes.toFixed(1)}%</b></div><div class="split" role="img" aria-label="Yes ${r.yes}%, No ${(100 - r.yes).toFixed(1)}%"><i class="d" style="width:${r.yes}%"></i><i class="r" style="width:${100 - r.yes}%"></i></div><p class="small">${esc(r.reporting || '')} · ${esc(r.source || '')}</p></div>` : '<span class="tag">Results pending</span>';
    return `<article class="bq"><h3>${q.n ? `<span class="n">Q${q.n}</span>` : ''}<span>${esc(q.title)}${q.amount ? ` <span class="small">· ${money(q.amount)}</span>` : ''}</span></h3>
      <p><b>Yes:</b> ${esc(q.yes)}</p>${q.flag ? `<p class="small"><span class="tag">${esc(q.flag)}</span></p>` : ''}
      ${res}${mk ? `<p class="small">Market odds this passes: <b>${pct(mk.yes)}</b> · ${money(mk.vol)} traded</p>` : ''}</article>`;
  };
  el.innerHTML = `<div class="bq-grid">${b.questions.map(card).join('')}</div>${b.orderNote ? `<p class="small bq-note">${esc(b.orderNote)}</p>` : ''}
    <p class="small bq-note">${esc(S.ballot.note)}</p><div class="links" style="margin-top:10px">${b.links.map((l) => `<a href="${esc(l.url)}" target="_blank" rel="noopener">${esc(l.label)} ↗</a>`).join('')}</div>`;
}
function wireBallot() {
  $('#ballotTabs').addEventListener('click', (e) => {
    const b = e.target.closest('button'); if (!b) return;
    S.bqState = b.dataset.s;
    for (const x of document.querySelectorAll('#ballotTabs button')) x.setAttribute('aria-selected', x === b);
    renderBallot();
  });
}

// ---------- sources ----------
function renderSources() {
  const st = S.status?.sources || {};
  const age = (k) => { const t = st[k]?.at; if (!t) return '<span class="tag">no data</span>'; const m = Math.round((now() - Date.parse(t)) / 60000); return `<span class="tag ${st[k].ok && m < 20 ? 'live' : ''}">${st[k].ok ? `${m}m ago` : 'last fetch failed'}</span>`; };
  const cards = [
    ['Polymarket', 'Per-race win odds for every Senate, governor and House race; chamber control; seat totals.', 'https://polymarket.com/event/which-party-will-win-the-house-in-2026', age('markets') + ' · control odds refresh live in your browser'],
    ['PollCheck', 'Polling averages and ratings for Senate, governor races, and the generic ballot.', 'https://www.pollcheck.co.uk/us-midterms-2026', age('polls')],
    ['State election offices', `Official unofficial counts, straight from the states that publish machine-readable files: ${Object.entries(S.results?.feeds || {}).map(([k, v]) => `${k}${v.ok ? '' : ' (failing)'}`).join(', ') || 'CA, CO, FL, GA, IA, MN, NC, NE, SD'}. Other states link out; Texas, Washington, Utah and most others had no usable open file.`, 'https://www.usa.gov/election-results', age('results')],
    ['Exit polls', 'No open feed exists. Entered from published outlet releases (AP VoteCast, SSRS/Edison, networks).', 'https://apnews.com/hub/ap-votecast', S.exit?.updated ? `<span class="tag live">updated ${new Date(S.exit.updated).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}</span>` : '<span class="tag">waiting</span>'],
  ];
  const xs = [['AP', 'https://apnews.com/'], ['Decision Desk HQ', 'https://decisiondeskhq.com/'], ['Silver Bulletin', 'https://www.natesilver.net/'], ['RealClearPolling', 'https://www.realclearpolling.com/'], ['FiftyPlusOne', 'https://www.fiftyplusone.news/'], ['Cook Political', 'https://www.cookpolitical.com/'], ['Sabato’s Crystal Ball', 'https://centerforpolitics.org/crystalball/'], ['Inside Elections', 'https://insideelections.com/'], ['270toWin', 'https://www.270towin.com/']];
  $('#src-body').innerHTML = `<div class="src-grid">${cards.map(([n, d, u, s]) => `<div class="src"><h3><a href="${u}" target="_blank" rel="noopener">${n} ↗</a></h3><p class="small" style="margin:0 0 8px">${d}</p>${s}</div>`).join('')}</div>
  <h3 style="font-size:15px;margin-bottom:8px">Cross-check elsewhere</h3><div class="links">${xs.map(([n, u]) => `<a href="${u}" target="_blank" rel="noopener">${n} ↗</a>`).join('')}</div>
  <h3 style="font-size:15px;margin:18px 0 6px">How to read this page</h3>
  <ul class="small" style="margin:0;padding-left:18px;max-width:80ch"><li><b>Map colors</b> are market-implied win probabilities, not votes counted. A race is marked <i>projected</i> only after its state’s polls close and the market reaches 99%.</li><li><b>Official count</b> badges appear only where a state publishes a machine-readable file. Everything else links you to the authoritative source.</li><li>Poll-close times are approximate and use the last time any part of a state closes.</li><li>Prediction markets reflect traders’ views and can be wrong or manipulated; they are shown alongside, not instead of, polls.</li></ul>`;
}

// ---------- status pill ----------
function renderLive() {
  const el = $('#live'), t = $('#liveText');
  const m = S.markets?.updated ? Math.round((now() - Date.parse(S.markets.updated)) / 60000) : null;
  const c = S.fetchedAt.control ? Math.round((now() - S.fetchedAt.control) / 1000) : null;
  el.className = 'pill ' + (m === null ? 'bad' : m <= 12 ? 'ok' : m <= 30 ? 'stale' : 'bad');
  t.textContent = m === null ? 'Data unavailable' : c !== null && c < 120 ? `Live · control odds ${c}s ago · races ${m}m ago` : `Races updated ${m}m ago`;
}

// ---------- views (hash router) ----------
const VIEWS = ['overview', 'races', 'polls', 'reports', 'changes', 'sources'];
const ALIAS = { map: 'overview', flips: 'overview', turnout: 'reports', exit: 'reports', ballot: 'reports' };
function showView(v, anchor) {
  for (const el of document.querySelectorAll('.view')) el.hidden = el.dataset.view !== v;
  for (const a of document.querySelectorAll('#nav a')) a.toggleAttribute('aria-current', a.dataset.v === v) || a.removeAttribute('aria-current');
  for (const a of document.querySelectorAll('#nav a')) if (a.dataset.v === v) a.setAttribute('aria-current', 'page');
  document.title = `${v[0].toUpperCase() + v.slice(1)} · 2026 Midterm Election Dashboard`;
  const t = anchor && document.getElementById(anchor);
  t ? t.scrollIntoView({ behavior: 'smooth', block: 'start' }) : window.scrollTo(0, 0);
}
function route() {
  const h = location.hash.slice(1);
  if (VIEWS.includes(h)) showView(h);
  else showView(ALIAS[h] || (document.getElementById(h) ? VIEWS.find((v) => document.querySelector(`#view-${v} #${h}`)) : null) || 'overview', document.getElementById(h) ? h : null);
}
const goMap = () => { if (location.hash !== '#map') history.replaceState(null, '', '#map'); showView('overview', 'map'); };

// ---------- boot ----------
function renderAll() { renderClock(); renderSenate(); renderHouse(); renderCompare(); renderFlips(); paintMap(); renderDetail(); renderChanges(); renderTurnout(); renderBallot(); renderTable(); renderPolls(); renderExit(); renderSources(); renderLive(); }
async function boot() {
  const th = $('#theme');
  th.onclick = () => { const cur = document.documentElement.dataset.theme || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'); const n = cur === 'dark' ? 'light' : 'dark'; document.documentElement.dataset.theme = n; try { localStorage.setItem('theme', n); } catch {} };
  S.paths = await (await fetch('assets/map-paths.json')).json();
  drawMap(); wireMap(); wireTable(); wireChanges(); wireBallot(); wireFlips(); wirePolls();
  await Promise.all([loadAll(), loadControl(), loadHistory()]);
  renderAll();
  setInterval(() => { renderClock(); renderLive(); }, 1000);
  let busy = false;
  let n = 0;
  const tick = async (full) => { if (document.hidden || busy) return; busy = true; try { await (full ? Promise.all([loadAll(), loadControl(), ...(++n % 4 === 0 ? [loadHistory()] : [])]) : loadControl()); renderAll(); } finally { busy = false; } };
  setInterval(() => tick(false), 30000);
  setInterval(() => tick(true), 90000);
  window.addEventListener('hashchange', route);
  route();
  document.addEventListener('visibilitychange', () => !document.hidden && tick(true));
}
boot().catch((e) => { console.error(e); $('#liveText').textContent = 'Failed to load'; });
