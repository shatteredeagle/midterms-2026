import { STATES, RACES, HOUSE_SEATS, closeTime } from './states.js?v=7351eeb1';

const REPO = 'ShatteredEagle/midterms-2026';
const RAW = `https://raw.githubusercontent.com/${REPO}/data/`;
const KIND = { S: 'Senate', G: 'Governor', H: 'House' };
const $ = (s, r = document) => r.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const pct = (x, d = 0) => (x * 100).toFixed(d) + '%';
const FIPS = {};
for (const [st, v] of Object.entries(STATES)) FIPS[v[1]] = st;

const S = { holders: null, calls: null, callsSeen: null, key: null, feedF: 'key', feedMark: 0, pollTab: 'H', senAll: false, history: null, early: null, turnout: null, otherAvgs: null, ballot: null, bqState: 'MA', changes: null, chgF: 'all', chgAll: false, chgSeen: 0, markets: null, polls: null, results: null, status: null, exit: null, control: null, paths: null, kind: 'S', sel: null, rkind: 'S', sort: 'close', q: '', showAll: false, fetchedAt: {} };

// ---------- data ----------
// raw.githubusercontent.com caches 5 min regardless of query string, so the browser reads the bundle through the
// GitHub contents API (conditional requests: 304s are free against the rate limit) and falls back to raw, then the seed copy.
const API = `https://api.github.com/repos/${REPO}/contents/bundle.json?ref=data`;
async function getBundle() {
  const bk = Math.floor(Date.now() / 30000);
  const tries = [
    () => fetch(`${RAW}s${bk}.json`),
    () => fetch(`${RAW}s${bk - 1}.json`),
    () => fetch(API, { headers: { Accept: 'application/vnd.github.raw' } }),
    () => fetch(`${RAW}bundle.json`),
    () => fetch('data/bundle.json'),
  ];
  for (const t of tries) {
    try { const r = await t(); if (r.ok) return await r.json(); } catch { /* next */ }
  }
  return null;
}
async function loadHistory() {
  for (const t of [() => fetch(`${RAW}history.json`), () => fetch(HIST_API, { headers: { Accept: 'application/vnd.github.raw' } })]) {
    try { const r = await t(); if (r.ok) { S.history = await r.json(); return; } } catch { /* next */ }
  }
}
async function loadAll() {
  const [b, exit] = await Promise.all([getBundle(), fetch('data/exit-polls.json', { cache: 'no-store' }).then((r) => r.json()).catch(() => null)]);
  if (b) Object.assign(S, { calls: b.calls || S.calls, turnout: b.turnout || S.turnout, changes: b.changes || S.changes, markets: b.markets || S.markets, polls: b.polls || S.polls, results: b.results || S.results, status: b.status || S.status });
  if (exit) S.exit = exit;
  if (!S.holders) S.holders = await fetch('data/holders.json').then((r) => r.json()).catch(() => null);
  if (!S.key) S.key = await fetch('data/key-races.json', { cache: 'no-store' }).then((r) => r.json()).catch(() => null);
  if (!S.early) S.early = await fetch('data/early-vote.json', { cache: 'no-store' }).then((r) => r.json()).catch(() => null);
  if (!S.otherAvgs) S.otherAvgs = await fetch('data/other-averages.json', { cache: 'no-store' }).then((r) => r.json()).catch(() => null);
  if (!S.ballot) S.ballot = await fetch('data/ballot-questions.json', { cache: 'no-store' }).then((r) => r.json()).catch(() => null);
  S.fetchedAt.main = Date.now();
}
// ---------- model ----------
const now = () => Date.now();
const isClosed = (st) => now() >= closeTime(st);
// Only counted votes are shown as results. No market odds or forecasts are used on this page.
const counted = (o) => !!(o && ((o.totalVotes > 0 && o.cands?.[0]?.votes > 0) || (o.shareOnly && o.pct > 0 && o.cands?.[0]?.pct > 0))); // shareOnly: NBC reports percentages without vote totals
function race(id) {
  const [k, st] = id.split('-');
  if (k !== 'H' && !RACES[k]?.includes(st)) return null;
  return { id, kind: k, st, p: S.polls?.races?.[id], o: S.results?.races?.[id], closed: isClosed(st) };
}
const allRaces = (kind) => (RACES[kind] || []).map((st) => race(`${kind}-${st}`));
const callOf = (id) => S.calls?.calls?.[id] || null;
const hasFeed = (st) => !!S.results?.feeds?.[st];
const fmtTime = (st) => new Date(closeTime(st)).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
function statusTag(r) {
  const o = r.o;
  const call = callOf(r.id);
  if (counted(o)) return `<span class="tag live">${o.pct}% in</span>${call ? ` <span class="tag called" title="Projected by ${esc(S.calls.source)}">Called ${esc(call.winner.p)} · ${esc(call.winner.n)}</span>` : ''}${o.winner ? ' <span class="tag live">state flags winner</span>' : ''}`;
  if (callOf(r.id)) return `<span class="tag called" title="Projected by ${esc(S.calls.source)}">Called ${esc(callOf(r.id).winner.p)} · ${esc(callOf(r.id).winner.n)}</span>`;
  if (r.closed) return `<span class="tag">${hasFeed(r.st) ? 'Closed · waiting for votes' : 'Closed · no feed here'}</span>`;
  return `<span class="tag">Polls close ${fmtTime(r.st)}</span>`;
}
function leadHtml(o, call) {
  if (!counted(o) && call) {
    const w = call.winner, y = call.runnerUp;
    return `<b class="lead ${esc(w.p)}">${esc(w.n)} (${esc(w.p)})</b> <span class="small">called by NBC${y ? ` · ${w.pct > 0 ? `${w.pct}%–${y.pct}% ` : ''}over ${esc(y.n)} (${esc(y.p)})` : ''}</span>`;
  }
  if (!counted(o)) return '<span class="small">—</span>';
  const x = o.cands[0], y = o.cands[1], m = x.pct - (y ? y.pct : 0);
  return `<b class="lead ${esc(x.p)}">${esc(x.n)} (${esc(x.p)})</b> <span class="small">+${m.toFixed(1)}${y ? ` over ${esc(y.n)}` : ''}</span>`;
}
function voteBar(o, call) {
  if (!counted(o) && call) {
    const w = call.winner, y = call.runnerUp;
    if (!(w.pct > 0)) return '';
    const d = w.p === 'D' ? w.pct : y?.p === 'D' ? y.pct : 0, r = w.p === 'R' ? w.pct : y?.p === 'R' ? y.pct : 0, rest = Math.max(0, 100 - d - r);
    return `<div class="split" role="img" aria-label="Vote share when called: Democrat ${d}%, Republican ${r}%"><i class="d" style="width:${d}%"></i><i style="width:${rest}%;background:var(--muted)"></i><i class="r" style="width:${r}%"></i></div>`;
  }
  if (!counted(o)) return '';
  const d = o.cands.find((c) => c.p === 'D')?.pct || 0, r = o.cands.find((c) => c.p === 'R')?.pct || 0, rest = Math.max(0, 100 - d - r);
  return `<div class="split" role="img" aria-label="Vote share: Democrat ${d}%, Republican ${r}%"><i class="d" style="width:${d}%"></i><i style="width:${rest}%;background:var(--muted)"></i><i class="r" style="width:${r}%"></i></div>`;
}
const matchup = (o) => (o?.cands?.length ? [...o.cands].sort((x, y) => ({ D: 0, R: 1 }[x.p] ?? 2) - ({ D: 0, R: 1 }[y.p] ?? 2)).slice(0, 3).map((c) => `${esc(c.n)} (${esc(c.p)})`).join(' vs ') : '');
// Leader of a race: counted votes first, otherwise an NBC call. `n` counts races with either.
// Counts under 5% in are too early to mean anything (a few precincts can show any party ahead), so they don't color the map or count in tallies unless the race is called.
const tooEarly = (o) => counted(o) && o.pct < 5;
const leaderParty = (x) => (counted(x.o) && !tooEarly(x.o) ? x.o.cands[0].p : callOf(x.id)?.winner.p || null);
const tally = (rs) => { let d = 0, r = 0, o = 0, n = 0; for (const x of rs) { const p = leaderParty(x); if (!p) continue; n++; p === 'D' ? d++ : p === 'R' ? r++ : o++; } return { d, r, o, n }; };

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

// Who held each Senate seat before this election (PollCheck's last-result winner, else the fixed key-race list). Used only to mark flips.
const holderOf = (st) => S.holders?.senate?.[st] || S.polls?.races?.[`S-${st}`]?.holder || S.key?.senate?.races?.find((k) => k.st === st)?.holder || null;
function renderSenate() {
  const rs = allRaces('S'), t = tally(rs), unc = rs.length - t.n;
  const lead = rs.map((r) => ({ r, p: leaderParty(r) })).filter((x) => x.p);
  const cellFor = ({ r, p }) => {
    const holder = holderOf(r.st), flip = !!holder && holder !== 'I' && p !== holder;
    const w = counted(r.o) ? r.o.cands[0].n : callOf(r.id)?.winner.n;
    return { cls: p === 'D' ? 'D1' : p === 'R' ? 'R1' : 'O', flip, holder, p, title: `${STATES[r.st][0]}: ${w || p} (${p}) ${callOf(r.id) ? 'wins' : 'leads'}${flip ? ` · FLIP from ${holder} to ${p}` : holder ? ` · ${holder} hold` : ''}` };
  };
  const dC = lead.filter((x) => x.p === 'D').map(cellFor).sort((a, b) => a.flip - b.flip), rC = lead.filter((x) => x.p === 'R').map(cellFor).sort((a, b) => b.flip - a.flip), oC = lead.filter((x) => x.p !== 'D' && x.p !== 'R').map(cellFor);
  const undecided = rs.filter((r) => !leaderParty(r)).map((r) => { const h = holderOf(r.st); return { cls: 'N', hold: h === 'D' || h === 'R' ? h : null, title: `${STATES[r.st][0]}: not decided yet${h ? ` · currently held by ${h}` : ''}` }; });
  const cells = [...Array(34).fill({ cls: 'D0', title: 'Democratic seat, not up this year' }), ...dC, ...undecided, ...oC, ...rC, ...Array(31).fill({ cls: 'R0', title: 'Republican seat, not up this year' })];
  const d = 34 + t.d, r = 31 + t.r;
  const flipsD = dC.filter((c) => c.flip).length, flipsR = rC.filter((c) => c.flip).length, flipsO = oC.filter((c) => c.flip).length;
  const majWho = { D0: 'a Democratic seat', D1: 'a Democratic seat', N: 'in a race not yet counted', O: 'held by an independent', R1: 'a Republican seat', R0: 'a Republican seat' }[cells[50].cls];
  $('#cardSenate').innerHTML = `<h3>Senate · 51 for majority</h3>
    <div class="big"><b class="d">${d}</b><small>D holding or leading</small><b class="r">${r}</b><small>R holding or leading</small></div>
    <div class="waffle" role="img" aria-label="Senate seats: ${d} Democratic holding or leading, ${r} Republican, ${unc} races not yet counted. Flipped seats so far: Democrats ${flipsD}, Republicans ${flipsR}. The outlined 51st square decides control: it is currently ${majWho}.">${cells.map((c, i) => `<i class="${c.cls}${c.flip ? ' flip' : ''}${i === 50 ? ' maj' : ''}"${c.hold ? ` data-h="${c.hold}"` : ''} title="${esc(i === 50 ? `The 51st seat decides control: currently ${majWho}${c.title ? ` (${c.title})` : ''}` : c.title)}"></i>`).join('')}</div>
    <div class="waffle-key"><span style="--c:var(--d)">D not up</span><span style="--c:var(--d-2)">D leading</span><span style="--c:var(--none)">Not decided ${unc}</span><span style="--c:var(--r-2)">R leading</span><span style="--c:var(--r)">R not up</span><span class="majkey">Outlined = the 51st seat</span><span class="flipkey">Gold corner = flipped seat</span><span class="dotkey">Dot = party holding an undecided seat now</span></div>
    <p class="meta"><b>Flipped so far:</b> Democrats +${flipsD}, Republicans +${flipsR}${flipsO ? `, independents +${flipsO}` : ''} (net ${flipsD - flipsR === 0 ? 'even' : flipsD > flipsR ? `D +${flipsD - flipsR}` : `R +${flipsR - flipsD}`}). A flip is a seat won or led by a different party than the one that held it. Hover a square for the state.</p>
    <p class="meta"><b>The outlined square is where control lands:</b> Democrats need it for 51 seats; if Republicans hold it they keep 50 or more, and the Vice President breaks a 50–50 tie for them. It is currently <b>${majWho}</b>.</p>
    <p class="meta">Votes counted or races called in ${t.n} of ${rs.length}. D leads ${t.d}, R leads ${t.r}. Seats not up: D 34, R 31. Calls are NBC News projections; the rest is counted votes. <a href="#control">What Democrats need ↗</a></p>`;
}
// Who held a House seat before: the incumbent's party when an incumbent was running (from NBC's data or the state feed). Open seats have no known holder, so they never show a flip marker.
function houseHolder(id) {
  const call = callOf(id)?.incumbentParty;
  if (call) return call;
  const inc = S.results?.races?.[id]?.cands?.find((c) => c.inc);
  if (inc) return inc.p;
  const h = S.holders?.house?.[id.slice(2)];
  return h === 'D' || h === 'R' ? h : null;
}
function renderHouse() {
  const ids = [];
  for (const [st, n] of Object.entries(HOUSE_SEATS)) for (let k = 1; k <= n; k++) ids.push(`H-${st}-${String(k).padStart(2, '0')}`);
  const items = ids.map((id) => ({ id, o: S.results?.races?.[id] }));
  const t = tally(items);
  const cell = (x) => {
    const p = leaderParty(x);
    if (!p) { const h = houseHolder(x.id); return { cls: 'N', hold: h, title: `${x.id.slice(2)}: not decided yet${h ? ` · currently held by ${h}` : ''}` }; }
    const holder = houseHolder(x.id), flip = !!holder && p !== holder, call = callOf(x.id);
    const w = counted(x.o) && !tooEarly(x.o) ? x.o.cands[0].n : call?.winner.n;
    return { cls: p === 'D' ? 'D1' : p === 'R' ? 'R1' : 'O', flip, title: `${x.id.slice(2)}: ${w || p} (${p}) ${call ? 'wins' : 'leads'}${flip ? ` · FLIP from ${holder} to ${p}` : holder ? ` · ${holder} hold` : ''}` };
  };
  const all = items.map((x) => ({ x, c: cell(x) }));
  const dC = all.filter((e) => e.c.cls === 'D1').map((e) => e.c).sort((a, b) => a.flip - b.flip);
  const rC = all.filter((e) => e.c.cls === 'R1').map((e) => e.c).sort((a, b) => b.flip - a.flip);
  const oC = all.filter((e) => e.c.cls === 'O').map((e) => e.c);
  const nC = all.filter((e) => e.c.cls === 'N').map((e) => e.c);
  const cells = [...dC, ...nC, ...oC, ...rC];
  const flipsD = dC.filter((c) => c.flip).length, flipsR = rC.filter((c) => c.flip).length;
  const known = [...dC, ...rC].filter((c) => /hold|FLIP/.test(c.title)).length;
  const majWho = { D1: 'a Democratic seat', N: 'in a district not yet decided', O: 'held by another party', R1: 'a Republican seat' }[cells[217].cls];
  $('#cardHouse').innerHTML = `<h3>House · 218 for majority</h3>
    <div class="big"><b class="d">${t.d}</b><small>districts D leads</small><b class="r">${t.r}</b><small>districts R leads</small></div>
    <div class="waffle house" role="img" aria-label="435 House districts: ${t.d} Democratic leading or called, ${t.r} Republican, ${nC.length} not decided. Flips so far: Democrats ${flipsD}, Republicans ${flipsR}. The outlined 218th square decides control: it is currently ${majWho}.">${cells.map((c, i) => `<i class="${c.cls}${c.flip ? ' flip' : ''}${i === 217 ? ' maj' : ''}"${c.hold ? ` data-h="${c.hold}"` : ''} title="${esc(i === 217 ? `The 218th seat decides control: currently ${majWho}${c.title ? ` (${c.title})` : ''}` : c.title)}"></i>`).join('')}</div>
    <div class="waffle-key"><span style="--c:var(--d-2)">D leading or called</span><span style="--c:var(--none)">Not decided ${nC.length}</span><span style="--c:var(--r-2)">R leading or called</span><span class="majkey">Outlined = the 218th seat</span><span class="flipkey">Gold corner = flipped seat</span><span class="dotkey">Dot = party holding an undecided seat now</span></div>
    <p class="meta"><b>Flipped so far:</b> Democrats +${flipsD}, Republicans +${flipsR} (net ${flipsD === flipsR ? 'even' : flipsD > flipsR ? `D +${flipsD - flipsR}` : `R +${flipsR - flipsD}`}). The holder is the party of the member now holding that district number (congress-legislators data); in states that redrew maps, a few flips may be redistricting rather than a change in who represents the same voters. Two vacant seats show no dot.</p>
    <p class="meta"><b>The outlined square is where control lands:</b> a party needs 218 of 435 seats, so the 218th seat from the Democratic side decides it. It is currently <b>${majWho}</b>. Squares fill in from vote feeds (CA, CO, FL, GA, IA, MN, NC, NE) and NBC News calls; other districts stay undecided here. Follow <a href="https://apnews.com/" target="_blank" rel="noopener">AP</a> or <a href="https://www.nbcnews.com/politics/2026-elections/midterms" target="_blank" rel="noopener">NBC</a> for the full count. <a href="#control">Key districts ↗</a></p>`;
}

// ---------- results so far (overview) ----------
function renderResultsSo() {
  const col = (kind, title) => {
    const rs = allRaces(kind).filter((r) => counted(r.o) || callOf(r.id)).sort((a, b) => (counted(b.o) ? b.o.pct : 101) - (counted(a.o) ? a.o.pct : 101));
    return `<div><h3 style="font-size:15px;margin-bottom:8px">${title}</h3><ol class="flip-list">${rs.map((r) => `<li class="res-item" data-st="${r.st}" tabindex="0"><span class="st">${esc(STATES[r.st][0])}${r.p?.special ? ' (sp.)' : ''}</span><span class="rl">${leadHtml(r.o, callOf(r.id))}</span>${voteBar(r.o, callOf(r.id))}<span class="p">${counted(r.o) ? `${r.o.pct}% in` : 'Called'}</span></li>`).join('') || '<li class="small">No votes counted or races called yet. Rows appear as states report.</li>'}</ol></div>`;
  };
  $('#results-body').innerHTML = `<div class="flip-grid">${col('S', 'Senate')}${col('G', 'Governor')}</div><p class="small" style="margin-top:12px">Unofficial totals from state election offices. Early returns often lean toward early and mail ballots and can swing as more votes arrive.</p>`;
}
function wireResults() {
  const pick = (t) => { const li = t.closest('.res-item'); if (li) { select(li.dataset.st); goMap(); } };
  $('#results-body').addEventListener('click', (e) => pick(e.target));
  $('#results-body').addEventListener('keydown', (e) => { if (e.key === 'Enter') pick(e.target); });
}

// ---------- control: what Democrats need ----------
function ctlRows(rows) {
  return `<div class="table-scroll"><table class="ctl"><thead><tr><th>${rows[0]?.house ? 'District' : 'State'}</th><th>Current result</th><th>Vote share</th><th>Status</th></tr></thead><tbody>${rows.map((x) => `<tr data-st="${x.st}" tabindex="0"><th scope="row" style="text-transform:none;letter-spacing:0;font-size:14px;color:var(--text)">${esc(x.label)}${x.sub ? `<div class="small">${x.sub}</div>` : ''}</th><td>${counted(x.o) || callOf(x.id) ? leadHtml(x.o, callOf(x.id)) : `<span class="small">${x.o?.cands?.length ? matchup(x.o) : '—'}</span>`}</td><td style="min-width:150px">${voteBar(x.o, callOf(x.id))}</td><td>${x.status}</td></tr>`).join('') || '<tr><td colspan="4" class="small">None.</td></tr>'}</tbody></table></div>`;
}
function renderControl() {
  const K = S.key;
  if (!K) return;
  // Senate
  const sRows = K.senate.races.map((k) => { const r = race(`S-${k.st}`); return { ...k, r, id: `S-${k.st}`, o: r?.o, st: k.st, label: STATES[k.st][0] + (r?.p?.special ? ' (special)' : ''), sub: !counted(r?.o) && r?.p?.lead ? `Polling average: ${esc(r.p.lead)}` : '', status: r ? statusTag(r) : '' }; });
  const order = (x, y) => (counted(y.o) ? y.o.pct : callOf(y.id) ? 100 : -1) - (counted(x.o) ? x.o.pct : callOf(x.id) ? 100 : -1) || closeTime(x.st) - closeTime(y.st);
  const targets = sRows.filter((x) => x.holder === 'R').sort(order), defend = sRows.filter((x) => x.holder === 'D').sort(order);
  const all = tally(allRaces('S')), tT = tally(targets), tD = tally(defend);
  const ledBy = (x) => leaderParty(x);
  const d = K.senate.notUp.D + all.d, need = K.senate.need;
  const dFlip = targets.filter((x) => ledBy(x) === 'D').length, dLost = defend.filter((x) => ledBy(x) && ledBy(x) !== 'D').length;
  $('#ctlSenateSub').textContent = `Democrats hold 47 seats and 34 are not up, so they need 17 of the 35 races on the ballot (51 seats; the Vice President breaks a 50–50 tie for Republicans). That means holding all ${K.senate.dHeldUp} Democratic-held seats and flipping 4 Republican-held ones.`;
  $('#ctl-senate-body').innerHTML = `<div class="ctl-meter"><div class="ctl-nums"><b class="d">${d}</b><span class="small">Democratic seats (34 not up + ${all.d} leading)</span><span class="small need">Need ${need}</span></div>
      <div class="meter" role="img" aria-label="Democrats have ${d} seats of ${need} needed"><i class="d" style="width:${d}%"></i><i class="r" style="width:${31 + all.r}%;margin-left:auto"></i><span class="mark" style="left:${need}%"></span></div>
      <p class="small">Counted or called so far: Democrats lead in ${all.d} of 35 races, Republicans in ${all.r}${all.o ? `, others in ${all.o}` : ''}; ${35 - all.n} undecided. Key targets: Democrats lead ${dFlip} of the ${targets.length} Republican-held seats on this list (they need 4). Seats Democrats hold where they trail: ${dLost}.</p></div>
    <h3 class="ctl-h">Republican-held seats Democrats can flip <span class="small">(${tT.n} of ${targets.length} counted or called)</span></h3>${ctlRows(targets)}
    <h3 class="ctl-h">Democratic-held seats Democrats must defend <span class="small">(${tD.n} of ${defend.length} counted or called)</span></h3>${ctlRows(defend)}
    <p class="small">${esc(K.note)}</p>`;
  // House
  const hRows = K.house.districts.map((dist) => { const [st, n] = dist.split('-'); const r = race(`H-${st}-${n}`); return { house: true, id: `H-${st}-${n}`, st, label: dist, o: r?.o, status: r ? statusTag(r) : '' }; }).sort(order);
  const hKey = tally(hRows), hAll = tally([...new Set([...Object.keys(S.results?.races || {}), ...Object.keys(S.calls?.calls || {})].filter((k) => k[0] === 'H'))].map((id) => ({ id, o: S.results?.races?.[id] })));
  $('#ctlHouseSub').textContent = 'Democrats need 218 of 435 seats. District results come only from states whose election offices publish a feed (CA, CO, FL, GA, IA, MN, NC, NE); other key districts show their poll-closing time.';
  $('#ctl-house-body').innerHTML = `<div class="ctl-meter"><div class="ctl-nums"><b>${hKey.n}</b><span class="small">of ${hRows.length} key districts counted or called</span></div>
      <p class="small">Key districts counted or called: Democrats lead ${hKey.d}, Republicans lead ${hKey.r}${hKey.o ? `, others ${hKey.o}` : ''}. All House districts counted or called so far: Democrats lead ${hAll.d}, Republicans ${hAll.r}. A national House majority tally needs every district, so follow AP or NBC for that.</p></div>${ctlRows(hRows)}`;
}
function wireControl() {
  const pick = (t) => { const tr = t.closest('tr[data-st]'); if (tr) { select(tr.dataset.st); goMap(); } };
  for (const id of ['#ctl-senate-body', '#ctl-house-body']) { $(id).addEventListener('click', (e) => pick(e.target)); $(id).addEventListener('keydown', (e) => { if (e.key === 'Enter') pick(e.target); }); }
}

// ---------- map ----------
function drawMap() {
  const svg = $('#usmap');
  const defs = `<defs><pattern id="hatch" width="8" height="8" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="8" height="8" fill="var(--t)"/><rect width="3" height="8" fill="var(--hatch)" opacity=".55"/></pattern><pattern id="hatchGray" width="8" height="8" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="8" height="8" fill="var(--none)"/><rect width="2" height="8" fill="var(--hatch)" opacity=".45"/></pattern></defs>`;
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
  // Senate / Governor: only counted votes color the map (no odds, no polls).
  const r = race(`${S.kind}-${st}`);
  if (!r) return { bin: 'none', text: `No ${KIND[S.kind]} race in 2026` };
  const o = r.o;
  if (tooEarly(o) && !callOf(`${S.kind}-${st}`)) return { bin: 'tooearly', text: `Too early to show: only ${o.pct}% in (${o.cands[0].n} (${o.cands[0].p}) ahead so far)` };
  if (counted(o)) {
    const a = o.cands[0], b = o.cands[1], m = a.pct - (b ? b.pct : 0), party = a.p;
    const mag = m >= 20 ? 3 : m >= 10 ? 2 : 1;
    const bin = m < 1 ? 'T' : party === 'D' ? `D${mag}` : party === 'R' ? `R${mag}` : 'O';
    return { bin, early: o.pct < 50, called: !!o.winner || !!callOf(`${S.kind}-${st}`), text: `${a.n} (${a.p}) leads${b ? ` ${b.n}` : ''} ${a.pct}%–${b ? b.pct : 0}% · ${o.reporting}${o.winner ? ` · state flags winner: ${o.winner}` : ''}${callOf(`${S.kind}-${st}`) ? ` · NBC News projects ${callOf(`${S.kind}-${st}`).winner.n} (${callOf(`${S.kind}-${st}`).winner.p})` : ''}` };
  }
  const call = callOf(`${S.kind}-${st}`);
  if (call) {
    const w = call.winner, m = w.pct > 0 ? w.pct - (call.runnerUp ? call.runnerUp.pct : 0) : 50, mag = m >= 20 ? 3 : m >= 10 ? 2 : 1;
    return { bin: m < 1 ? 'T' : w.p === 'D' ? `D${mag}` : w.p === 'R' ? `R${mag}` : 'O', called: true, text: `NBC News projects ${w.n} (${w.p}) wins${call.runnerUp ? ` · ${w.pct > 0 ? `${w.pct}%–${call.runnerUp.pct}% ` : ''}over ${call.runnerUp.n} (${call.runnerUp.p})` : ''}${call.pctIn ? ` · ${call.pctIn} in` : ''}` };
  }
  return r.closed ? { bin: 'closed', text: o ? 'Polls closed · no votes counted yet' : 'Polls closed · no results feed on this page for this state' } : { bin: 'pend', text: `Polls close ${new Date(closeTime(st)).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}` };
}
function mapTally() {
  const rs = allRaces(S.kind), t = tally(rs);
  return `${KIND[S.kind]} races fill in as official votes are counted or NBC News calls the race (bold outline = called): color shows who leads, shade shows the margin. Counted or called in ${t.n} of ${rs.length} races (D leads ${t.d}, R leads ${t.r}${t.o ? `, other ${t.o}` : ''}). States with no vote feed fill in only when NBC calls them; the rest stay gray. Early returns can swing as more votes come in.`;
}
const prevFill = {};
function paintMap() {
  for (const el of document.querySelectorAll('#usmap path')) {
    const st = el.dataset.st, i = stateInfo(st);
    const key = `${S.kind}|${i.bin}|${i.called ? 1 : 0}`;
    const changed = prevFill[st] && prevFill[st].startsWith(`${S.kind}|`) && prevFill[st] !== key;
    prevFill[st] = key;
    el.setAttribute('class', `b-${i.bin}${i.called ? ' called' : ''}${i.early ? ' early' : ''}${S.sel === st ? ' sel' : ''}${changed ? ' pulse' : ''}`);
    el.setAttribute('aria-label', `${STATES[st][0]}: ${i.text}`);
  }
  for (const c of document.querySelectorAll('.chip')) c.classList.toggle('sel', c.dataset.st === S.sel);
  const sw = (cls, label) => `<span><i class="b-${cls}" style="background:${cls === 'T' ? 'repeating-linear-gradient(45deg,var(--t) 0 3px,var(--hatch) 3px 5px)' : cls === 'closed' || cls === 'tooearly' ? 'repeating-linear-gradient(45deg,var(--none) 0 3px,var(--hatch) 3px 5px)' : `var(--${{ D3: 'd', D2: 'd-2', D1: 'd-1', R1: 'r-1', R2: 'r-2', R3: 'r', none: 'none', pend: 'pend', tooearly: 'none', O: 'muted' }[cls]})`}"></i>${label}</span>`;
  if (S.kind !== 'E') $('#legend').innerHTML = sw('D3', 'D leads by 20+') + sw('D2', 'D by 10–20') + sw('D1', 'D by under 10') + sw('T', 'Within 1 pt') + sw('R1', 'R by under 10') + sw('R2', 'R by 10–20') + sw('R3', 'R leads by 20+') + sw('O', 'Other leads') + sw('tooearly', 'Under 5% in') + sw('pend', 'Polls not closed') + sw('closed', 'Closed, no votes shown') + sw('none', 'No race') + '<span><i style="background:none;border:2px dashed var(--text)"></i>Dashed = under 50% reporting</span>';
  const eSw = (v, label) => `<span><i style="background:var(--${v})"></i>${label}</span>`;
  if (S.kind === 'E') $('#legend').innerHTML = eSw('e1', 'Under 20%') + eSw('e2', '20–30%') + eSw('e3', '30–40%') + eSw('e4', '40%+') + sw('none', 'No readable report') + '<span>Shade = early-vote turnout of registered or active voters</span>';
  $('#mapSub').textContent = S.kind === 'E' ? 'Early-vote turnout where a state publishes a report this page can use. Most states do not, so most of the map is gray. This shows how many people voted early, not who they voted for.' : mapTally();
}
const PORDER = { D: 0, R: 1, O: 2 };
const money = (n) => (n >= 1e6 ? `$${(n / 1e6).toFixed(1)}M` : `$${Math.round(n / 1e3)}k`);
function candRows(cands, mode) {
  const sorted = [...cands].sort((x, y) => (PORDER[x.p] ?? 2) - (PORDER[y.p] ?? 2));
  return sorted.map((c) => `<div class="cand" data-p="${esc(c.p)}"><span>${esc(c.n)} <span class="small">(${esc(c.p)})</span></span><b>${mode === 'votes' ? `${Number(c.pct).toFixed(1)}%` : `${c.pct}%`}</b><div class="bar"><i style="width:${Math.min(100, c.pct)}%"></i></div></div>`).join('');
}
const block = (cls, title, what, meta, body) => `<section class="sb ${cls}"><header><h5>${title}</h5><span class="what">${what}</span></header>${meta ? `<p class="small sb-meta">${meta}</p>` : ''}${body}</section>`;
function raceBlock(id) {
  const r = race(id);
  if (!r) return '';
  const o = r.o;
  let h = `<div class="race"><h4>${KIND[r.kind]}${r.p?.special ? ' (special)' : ''}</h4>`;
  if (counted(o)) h += block('official', 'Votes counted', 'Official count', `${esc(o.source)} · ${esc(o.reporting)}${o.winner ? ` · <span class="tag live">State flags winner: ${esc(o.winner)}</span>` : ''}`, candRows(o.cands.map((c) => ({ ...c })), 'votes') + countTrend(id));
  else h += `<p class="small">${r.closed ? (hasFeed(r.st) ? 'Polls closed. Waiting for the state to post votes.' : 'Polls closed. This page has no results feed for this state; check the state election office.') : `Polls close ${fmtTime(r.st)}.`}</p>`;
  if (r.p) h += block('poll', 'Polling average', 'Share of voters, from surveys before the election', `${r.p.polls} polls, ${r.p.pollsters} pollsters${r.p.lead ? ` · <b>${esc(r.p.lead)}</b>` : ''}`, candRows(r.p.cands, 'poll'));
  return h + '</div>';
}
function houseBlock(st) {
  const ds = Object.values(S.results?.races || {}).filter((r) => r.id?.startsWith(`H-${st}-`)).sort((a, b) => a.id.localeCompare(b.id));
  if (!ds.length) return '';
  const t = tally(ds.map((o) => ({ o })));
  return `<div class="race"><h4>House · ${ds.length} districts</h4><p class="small">Votes counted in ${t.n}. Democrats lead ${t.d}, Republicans lead ${t.r}.</p>${ds.filter((o) => counted(o)).slice(0, 12).map((o) => `<p class="small" style="margin:2px 0">${esc(o.id.slice(2))}: ${leadHtml(o)} · ${o.pct}% in</p>`).join('')}</div>`;
}
function renderDetail() {
  const el = $('#detail');
  if (!S.sel) {
    el.innerHTML = `<h3>Select a state</h3><p class="small">Click or tab to a state on the map, or pick one from a table, to see its official vote count and the pre-election polling average.</p>`;
    return;
  }
  const st = S.sel, name = STATES[st][0];
  const ct = new Date(closeTime(st)).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', timeZoneName: 'short' });
  const es = earlyOf(st);
  const earlyHtml = es ? `<section class="eb"><h5>Early vote</h5><p class="small" style="margin:0"><b>${esc(es.ballotsLabel || es.ballots.toLocaleString('en-US'))}</b> ballots${earlyPct(es) !== null ? ` · ${es.turnoutPct ? '' : '≈'}${earlyPct(es)}% turnout` : ''} · ${esc(es.asOf)}. <a href="#turnout">Details ↓</a></p></section>` : '';
  const racesHtml = earlyHtml + raceBlock(`S-${st}`) + raceBlock(`G-${st}`) + houseBlock(st);
  el.innerHTML = `<h3>${esc(name)}</h3><p class="small">Polls close ${isClosed(st) ? '(closed)' : 'about'} ${ct} · <a href="https://ballotpedia.org/${name.replace(/ /g, '_')}_elections,_2026" target="_blank" rel="noopener">Ballotpedia</a></p>
    ${racesHtml || '<p class="small" style="margin-top:12px">No Senate or governor race here in 2026.</p>'}`;
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
  if (q) rs = rs.filter((r) => `${STATES[r.st][0]} ${r.st} ${(r.p?.cands || []).map((c) => c.n).join(' ')} ${(r.o?.cands || []).map((c) => c.n).join(' ')}`.toLowerCase().includes(q));
  rs.sort((a, b) => (counted(b.o) ? b.o.pct : callOf(b.id) ? 100 : -1) - (counted(a.o) ? a.o.pct : callOf(a.id) ? 100 : -1) || (S.sort === 'close' ? closeTime(a.st) - closeTime(b.st) : 0) || STATES[a.st][0].localeCompare(STATES[b.st][0]));
  const LIMIT = 25, shown = S.showAll || q ? rs : rs.slice(0, LIMIT);
  const row = (r) => `<tr data-st="${r.st}" tabindex="0"><th scope="row" style="text-transform:none;letter-spacing:0;font-size:14px;color:var(--text)">${esc(STATES[r.st][0])}${r.p?.special ? ' (special)' : ''}</th>
      <td>${counted(r.o) || callOf(r.id) ? leadHtml(r.o, callOf(r.id)) : `<span class="small">${r.o?.cands?.length ? matchup(r.o) : '—'}</span>`}</td>
      <td style="min-width:150px">${voteBar(r.o, callOf(r.id))}</td>
      <td>${esc(r.p?.lead || '—')}</td>
      <td>${statusTag(r)}</td></tr>`;
  $('#raceTable').innerHTML = `<thead><tr><th>State</th><th>Current result</th><th>Vote share</th><th>Polling average</th><th>Status</th></tr></thead><tbody>${shown.map(row).join('') || '<tr><td colspan="5">No races match.</td></tr>'}</tbody>`;
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
  const srcMeta = `<p class="small" style="margin:0 0 14px">${src.map((s) => `<b>${esc(s.name)}</b> · ${esc(s.published || '')}${s.kind ? ` · ${esc(s.kind)}` : ''}${s.url ? ` · <a href="${esc(s.url)}" target="_blank" rel="noopener">source ↗</a>` : ''}`).join('<br>')}</p>${x.note ? `<p class="small" style="margin:0 0 14px">${esc(x.note)}</p>` : ''}`;
  const rowTh = 'style="text-transform:none;letter-spacing:0;font-size:14px;color:var(--text)"';
  const shareQ = (q) => `<div class="q"><div class="table-scroll"><table><thead><tr><th>Question</th>${src.map((s) => `<th class="num">${esc(s.name.replace(/ \(.*/, ''))}</th>`).join('')}<th>Share</th></tr></thead><tbody>${q.items.map((it) => {
    const vals = src.map((s) => it.values?.[s.id]).filter(Boolean), avg = vals.length ? vals.reduce((a, v) => a + v.pct, 0) / vals.length : null;
    const notes = src.map((s) => it.values?.[s.id]?.note).filter(Boolean);
    return `<tr><th scope="row" ${rowTh}>${esc(it.label)}${notes.length ? `<div class="small">${esc(notes.join(' · '))}</div>` : ''}</th>${src.map((s) => `<td class="num">${it.values?.[s.id] ? `${it.values[s.id].pct}%` : '—'}</td>`).join('')}<td style="min-width:140px">${avg === null ? '—' : `<div class="split" role="img" aria-label="${avg.toFixed(0)} percent"><i style="width:${avg}%;background:#e0a21b"></i></div>`}</td></tr>`;
  }).join('')}</tbody></table></div></div>`;
  const dirQ = (q) => `<div class="q"><div class="table-scroll"><table><thead><tr><th>Group</th>${src.map((s) => `<th class="num">${esc(s.name)}</th>`).join('')}<th>Average D · R</th></tr></thead><tbody>${q.groups.map((g) => {
    const vals = src.map((s) => g.values?.[s.id]);
    const have = vals.filter(Boolean), d = have.length ? have.reduce((a, v) => a + v.dem, 0) / have.length : null, r = have.length ? have.reduce((a, v) => a + v.rep, 0) / have.length : null;
    return `<tr><th scope="row" ${rowTh}>${esc(g.label)}</th>${vals.map((v) => `<td class="num">${v ? `<span style="color:var(--d)">${v.dem}</span> · <span style="color:var(--r)">${v.rep}</span>` : '—'}</td>`).join('')}<td>${d === null ? '—' : `<div class="odds"><span>${d.toFixed(0)}</span><div class="split"><i class="d" style="width:${d / (d + r) * 100}%"></i><i class="r" style="width:${r / (d + r) * 100}%"></i></div><span>${r.toFixed(0)}</span></div>`}</td></tr>`;
  }).join('')}</tbody></table></div></div>`;
  el.innerHTML = srcMeta + x.questions.map((q, i) => `<details class="qd" ${i < 4 ? 'open' : ''}><summary>${esc(q.title)}</summary>${q.kind === 'share' ? shareQ(q) : dirQ(q)}</details>`).join('') + links;
}

// Adds (D)/(R)/(O) after candidate names in event text, using the candidates of the race the event is about.
const escRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
function withParty(e) {
  const cs = S.results?.races?.[e.id]?.cands;
  if (!cs || !e.text) return e.text;
  let t = e.text;
  for (const c of [...cs].sort((x, y) => y.n.length - x.n.length)) if (c.n.length > 3) t = t.replace(new RegExp(`${escRe(c.n)}(?! \\([DRO]\\))`, 'g'), `${c.n} (${c.p})`);
  return t;
}
// ---------- change feed ----------
const HIDDEN = new Set(['odds', 'control', 'projected', 'rating']); // prediction events are no longer shown
const CHG_GROUP = { call: 'count', count: 'count', lead: 'count', close: 'count', polls: 'polls', source: 'count', exit: 'reports', ballot: 'reports', average: 'reports', early: 'reports' };
const ago = (iso) => { const s = Math.max(0, Math.round((now() - Date.parse(iso)) / 1000)); return s < 90 ? `${s}s ago` : s < 5400 ? `${Math.round(s / 60)}m ago` : `${Math.round(s / 3600)}h ago`; };
function renderChanges() {
  const evs = (S.changes?.events || []).filter((e) => !HIDDEN.has(e.type) && (S.chgF === 'all' || CHG_GROUP[e.type] === S.chgF));
  const shown = S.chgAll ? evs.slice(0, 100) : evs.slice(0, 12);
  const el = $('#chgList');
  el.innerHTML = shown.length ? shown.map((e) => `<li class="${Date.parse(e.t) > S.chgSeen && S.chgSeen ? 'new' : ''}"><span class="k ${esc(e.type)}">${esc(e.type)}</span><span>${esc(withParty(e))}</span><time datetime="${esc(e.t)}" title="${esc(new Date(e.t).toLocaleString())}">${ago(e.t)}</time></li>`).join('') : '<li class="empty">No changes logged yet. Entries appear here as polls close, counts come in, and reports are added.</li>';
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
    const nm = S.calls?.measures?.[q.id], r = q.result || (nm && nm.yes + nm.no > 0 ? { yes: nm.yes, no: nm.no, reporting: `${nm.pctIn || ''} counted${nm.status === 'P' ? (nm.passed ? ' · NBC projects it passes' : ' · NBC projects it fails') : ''}`, source: 'NBC News' } : null);
    const res = r ? `<div class="res"><div class="cand" data-p="D"><span>Yes</span><b>${r.yes.toFixed(1)}%</b></div><div class="split" role="img" aria-label="Yes ${r.yes}%, No ${(100 - r.yes).toFixed(1)}%"><i class="d" style="width:${r.yes}%"></i><i class="r" style="width:${100 - r.yes}%"></i></div><p class="small">${esc(r.reporting || '')} · ${esc(r.source || '')}</p></div>` : '<span class="tag">Results pending</span>';
    return `<article class="bq"><h3>${q.n ? `<span class="n">Q${q.n}</span>` : ''}<span>${esc(q.title)}${q.amount ? ` <span class="small">· ${money(q.amount)}</span>` : ''}</span></h3>
      <p><b>Yes:</b> ${esc(q.yes)}</p>${q.flag ? `<p class="small"><span class="tag">${esc(q.flag)}</span></p>` : ''}
      ${res}</article>`;
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

// ---------- live feed rail ----------
const FEED_KIND = { call: 'Race called', close: 'Polls', count: 'Count', lead: 'Lead change', projected: 'Projected', exit: 'Exit poll', ballot: 'Ballot', early: 'Early vote', average: 'Polls', polls: 'Polls', rating: 'Rating', control: 'Control', odds: 'Odds', source: 'Feed' };
const feedKey = (e) => !HIDDEN.has(e.type) && (S.feedF === 'all' || e.type !== 'source');
function renderFeed() {
  const evs = (S.changes?.events || []).filter(feedKey).slice(0, 60);
  const list = $('#railList');
  list.innerHTML = evs.length ? evs.map((e, i) => `<li class="fi ${S.feedMark && Date.parse(e.t) > S.feedMark ? 'new' : ''}" tabindex="0" data-id="${esc(e.id || '')}" data-type="${esc(e.type)}"><div class="top"><span class="kind ${esc(e.type)}">${esc(FEED_KIND[e.type] || e.type)}</span><time datetime="${esc(e.t)}">${ago(e.t)}</time></div><div class="txt">${esc(withParty(e))}</div></li>`).join('') : '<li class="rail-empty">Nothing yet. Items appear as polls close, votes come in and reports are added.</li>';
  const fresh = (S.changes?.events || []).filter((e) => Date.parse(e.t) > S.feedMark && !HIDDEN.has(e.type) && e.type !== 'source').length;
  const b = $('#railBadge');
  if (b) { b.textContent = fresh > 99 ? '99+' : fresh; b.hidden = !fresh || document.body.classList.contains('rail-open'); }
}
function wireFeed() {
  const open = (v) => { document.body.classList.toggle('rail-open', v); $('#railBtn').setAttribute('aria-expanded', v); $('#railBackdrop').hidden = !v; if (v) { S.feedMark = Date.now(); renderFeed(); } };
  $('#railBtn').addEventListener('click', () => open(!document.body.classList.contains('rail-open')));
  $('#railClose').addEventListener('click', () => open(false));
  $('#railBackdrop').addEventListener('click', () => open(false));
  $('#railTabs').addEventListener('click', (e) => { const b = e.target.closest('button'); if (!b) return; S.feedF = b.dataset.f; for (const x of document.querySelectorAll('#railTabs button')) x.setAttribute('aria-selected', x === b); renderFeed(); });
  const go = (li) => {
    if (!li) return;
    const id = li.dataset.id, ty = li.dataset.type, st = id.split('-')[1];
    if (/^[SGH]-/.test(id) && STATES[st]) { select(st); goMap(); }
    else if (ty === 'exit') location.hash = '#exit';
    else if (ty === 'ballot') location.hash = '#ballot';
    else if (ty === 'early') location.hash = '#turnout';
    else if (ty === 'average' || ty === 'polls') location.hash = '#polls';
    else location.hash = '#changes';
    if (window.matchMedia('(max-width:1199px)').matches) open(false);
  };
  $('#railList').addEventListener('click', (e) => go(e.target.closest('.fi')));
  $('#railList').addEventListener('keydown', (e) => { if (e.key === 'Enter') go(e.target.closest('.fi')); });
  setInterval(() => { for (const t of document.querySelectorAll('#railList time')) t.textContent = ago(t.getAttribute('datetime')); }, 5000);
}

// ---------- race-called banner ----------
// Shows only for calls that happen while the page is open: everything already called at load is treated as seen.
// Calls that arrive together are merged into one banner (newest first) with an expandable list, never stacked.
let cbTimer = null;
const cbState = { items: [], collapsed: false }; // expanded by default when more than one race was called
const raceLabel = (id) => { const [k, st, n] = id.split('-'); return k === 'H' ? `${st}-${n} House` : `${STATES[st]?.[0] || st} ${KIND[k]}`; };
function callItem(c) {
  const cands = S.results?.races?.[c.id]?.cands || [];
  const hit = cands.find((x) => x.p === c.winner.p && x.n.toLowerCase().includes(String(c.winner.n).toLowerCase()));
  return { id: c.id, label: raceLabel(c.id), name: hit ? hit.n : c.winner.n, p: c.winner.p, pct: c.winner.pct };
}
function renderBanner(flash) {
  const b = $('#callBanner'), n = cbState.items.length;
  if (!n) { b.hidden = true; b.classList.remove('flash'); return; }
  const first = cbState.items[0];
  $('#cbTag').textContent = n > 1 ? `${n} races called` : 'Race called';
  $('#cbText').textContent = `${first.label}: ${first.name} (${first.p}) wins`;
  $('#cbText').dataset.id = first.id;
  const more = $('#cbMore');
  more.hidden = n < 2;
  const list = $('#cbList');
  list.hidden = n < 2 || cbState.collapsed;
  more.textContent = cbState.collapsed ? `Show all ${n} ▾` : 'Collapse ▴';
  more.setAttribute('aria-expanded', String(!list.hidden));
  $('#cbList').innerHTML = cbState.items.map((c) => `<li><button type="button" data-id="${esc(c.id)}">${esc(c.label)}: ${esc(c.name)}<span class="pty">${esc(c.p)}</span></button></li>`).join('');
  b.hidden = false;
  if (flash) { b.classList.remove('flash'); void b.offsetWidth; b.classList.add('flash'); }
  clearTimeout(cbTimer); cbTimer = setTimeout(() => { cbState.items = []; cbState.collapsed = false; renderBanner(false); }, 120000);
}
function checkCalls() {
  const ids = Object.keys(S.calls?.calls || {});
  if (S.callsSeen === null) { if (S.calls) S.callsSeen = new Set(ids); return; } // first load: nothing flashes
  const fresh = ids.filter((id) => !S.callsSeen.has(id));
  if (!fresh.length) return;
  for (const id of fresh) S.callsSeen.add(id);
  cbState.items = [...fresh.map((id) => callItem(S.calls.calls[id])), ...cbState.items];
  cbState.collapsed = false; // new calls always open the list
  renderBanner(true);
}
function openRace(id) { const st = id?.split('-')[1]; if (id && STATES[st]) { select(st); goMap(); } }
function wireBanner() {
  $('#cbClose').addEventListener('click', () => { clearTimeout(cbTimer); cbState.items = []; cbState.collapsed = false; renderBanner(false); });
  $('#cbText').addEventListener('click', (e) => openRace(e.currentTarget.dataset.id));
  $('#cbMore').addEventListener('click', () => { cbState.collapsed = !cbState.collapsed; renderBanner(false); });
  $('#cbList').addEventListener('click', (e) => { const btn = e.target.closest('button[data-id]'); if (btn) openRace(btn.dataset.id); });
}

// ---------- sources ----------
function renderSources() {
  const st = S.status?.sources || {};
  const age = (k) => { const t = st[k]?.at; if (!t) return '<span class="tag">no data</span>'; const m = Math.round((now() - Date.parse(t)) / 60000); return `<span class="tag ${st[k].ok && m < 20 ? 'live' : ''}">${st[k].ok ? `${m}m ago` : 'last fetch failed'}</span>`; };
  const cards = [
    ['PollCheck', 'Polling averages and ratings for Senate, governor races, and the generic ballot.', 'https://www.pollcheck.co.uk/us-midterms-2026', age('polls')],
    ['State election offices', `Official vote counts (Senate, governor and U.S. House districts), straight from the states that publish machine-readable files (all other states use NBC News\' results API): ${Object.entries(S.results?.feeds || {}).map(([k, v]) => `${k}${v.ok ? '' : ' (failing)'}`).join(', ') || 'CA, CO, FL, GA, IA, MN, NC, NE, SD'}. `, 'https://www.usa.gov/election-results', age('results')],
    ['NBC News Decision Desk', 'Race calls (projected winners) and statewide Senate and governor results for states without their own feed. The collector reads NBC\'s results data every 30 seconds and flashes a banner on a new call. NBC\'s counts and projections are not official results.', 'https://www.nbcnews.com/politics/2026-elections/senate-results', age('calls')],
    ['Exit polls', 'No open feed exists. Entered from published outlet releases (AP VoteCast, SSRS/Edison, networks).', 'https://apnews.com/hub/ap-votecast', S.exit?.updated ? `<span class="tag live">updated ${new Date(S.exit.updated).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}</span>` : '<span class="tag">waiting</span>'],
  ];
  const xs = [['AP', 'https://apnews.com/'], ['Decision Desk HQ', 'https://decisiondeskhq.com/'], ['Silver Bulletin', 'https://www.natesilver.net/'], ['RealClearPolling', 'https://www.realclearpolling.com/'], ['FiftyPlusOne', 'https://www.fiftyplusone.news/'], ['Cook Political', 'https://www.cookpolitical.com/'], ['Sabato’s Crystal Ball', 'https://centerforpolitics.org/crystalball/'], ['Inside Elections', 'https://insideelections.com/'], ['270toWin', 'https://www.270towin.com/']];
  $('#src-body').innerHTML = `<div class="src-grid">${cards.map(([n, d, u, s]) => `<div class="src"><h3><a href="${u}" target="_blank" rel="noopener">${n} ↗</a></h3><p class="small" style="margin:0 0 8px">${d}</p>${s}</div>`).join('')}</div>
  <h3 style="font-size:15px;margin-bottom:8px">Cross-check elsewhere</h3><div class="links">${xs.map(([n, u]) => `<a href="${u}" target="_blank" rel="noopener">${n} ↗</a>`).join('')}</div>
  <h3 style="font-size:15px;margin:18px 0 6px">How to read this page</h3>
  <ul class="small" style="margin:0;padding-left:18px;max-width:80ch"><li><b>Map colors</b> show who leads in the official votes counted so far. Nothing on this page is a forecast, projection or betting odds.</li><li><b>Official count</b> badges appear only where a state publishes a machine-readable file. Everything else links you to the authoritative source.</li><li>Poll-close times are approximate and use the last time any part of a state closes.</li><li>Polling averages are from before the election and are shown for context, separate from the vote counts.</li></ul>`;
}

// ---------- status pill ----------
function renderLive() {
  const el = $('#live'), t = $('#liveText');
  const at = S.status?.updated || S.results?.updated;
  const s = at ? Math.round((now() - Date.parse(at)) / 1000) : null;
  el.className = 'pill ' + (s === null ? 'bad' : s <= 240 ? 'ok' : s <= 900 ? 'stale' : 'bad');
  t.textContent = s === null ? 'Data unavailable' : `Live · counts updated ${s < 90 ? `${s}s` : `${Math.round(s / 60)}m`} ago`;
}

// ---------- views (hash router) ----------
const VIEWS = ['overview', 'control', 'races', 'polls', 'reports', 'changes', 'sources'];
const ALIAS = { map: 'overview', results: 'overview', 'ctl-senate': 'control', 'ctl-house': 'control', turnout: 'reports', exit: 'reports', ballot: 'reports' };
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
function renderAll() { renderClock(); checkCalls(); renderSenate(); renderHouse(); renderResultsSo(); renderControl(); paintMap(); renderDetail(); renderChanges(); renderFeed(); renderTurnout(); renderBallot(); renderTable(); renderPolls(); renderExit(); renderSources(); renderLive(); }
async function boot() {
  const th = $('#theme');
  th.onclick = () => { const cur = document.documentElement.dataset.theme || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'); const n = cur === 'dark' ? 'light' : 'dark'; document.documentElement.dataset.theme = n; try { localStorage.setItem('theme', n); } catch {} };
  S.paths = await (await fetch('assets/map-paths.json')).json();
  drawMap(); wireMap(); wireTable(); wireChanges(); wireBallot(); wireResults(); wireControl(); wirePolls(); wireFeed(); wireBanner();
  await Promise.all([loadAll(), loadHistory()]);
  S.feedMark = Date.now();
  renderAll();
  setInterval(() => { renderClock(); renderLive(); }, 1000);
  let busy = false;
  let n = 0;
  const tick = async () => { if (document.hidden || busy) return; busy = true; try { await Promise.all([loadAll(), ...(++n % 6 === 0 ? [loadHistory()] : [])]); renderAll(); } finally { busy = false; } };
  setInterval(tick, 30000);
  window.addEventListener('hashchange', route);
  route();
  if (/[?&]demoCall/.test(location.search)) { cbState.items = ['S-GA', 'G-GA', 'S-NC', 'H-FL-07', 'H-NC-01'].map((id) => ({ id, label: raceLabel(id), name: 'Demo', p: 'D' })); renderBanner(true); } // preview only
  document.addEventListener('visibilitychange', () => !document.hidden && tick());
}
boot().catch((e) => { console.error(e); $('#liveText').textContent = 'Failed to load'; });
