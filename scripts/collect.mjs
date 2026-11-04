// Collector: runs in GitHub Actions every ~5 min. Writes compact JSON into ./out (published to the `data` branch).
// Dependency-free (Node 20+). Every source is independent: one failing keeps the last good file.
import { mkdir, writeFile, readFile, stat, readdir, rm } from 'node:fs/promises';
import { GAMMA, BALLOT_SLUGS, parseEvents } from '../assets/markets.js';
import { NAME_TO_ST } from '../assets/states.js';
import { FEEDS, nbcState } from './feeds.mjs';
import { spawn } from 'node:child_process';
import { gzipSync } from 'node:zlib';
import { appendFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { STATES as ST_META, closeTime } from '../assets/states.js';
import { diffSnapshots, diffManual, diffCalls } from './diff.mjs';

const OUT = process.argv[2] || 'out';
const UA = 'midterms-2026-dashboard/1.0 (+https://github.com/ShatteredEagle/midterms-2026)';
const now = () => new Date().toISOString();
const get = async (u, json = true) => {
  const r = await fetch(u, { headers: { 'User-Agent': UA, Accept: json ? 'application/json' : 'text/html' }, signal: AbortSignal.timeout(30000) });
  if (!r.ok) throw new Error(`${u} -> ${r.status}`);
  return json ? r.json() : r.text();
};
const status = {};
const readJ = async (n) => { try { return JSON.parse(await readFile(`${OUT}/${n}.json`, 'utf8')); } catch { return null; } };
// Slow-changing sources are skipped while the previous file is younger than minAgeMs (polite to small sites when looping).
async function run(name, fn, minAgeMs = 0) {
  if (minAgeMs) {
    const age = await stat(`${OUT}/${name}.json`).then((s) => Date.now() - s.mtimeMs, () => Infinity);
    if (age < minAgeMs) return;
  }
  try { const d = await fn(); await writeFile(`${OUT}/${name}.json`, JSON.stringify(d)); status[name] = { ok: true, at: now() }; }
  catch (e) { console.error(name, e.message); status[name] = { ok: false, at: now(), error: e.message }; }
}

// ---- Markets (Polymarket) ----
async function markets() {
  const events = [];
  for (let off = 0; off < 600; off += 100) {
    const page = await get(`${GAMMA}?tag_slug=midterms&active=true&closed=false&limit=100&offset=${off}`);
    events.push(...page);
    if (page.length < 100) break;
  }
  // Ballot-question markets are not tagged "midterms", so fetch them by slug.
  for (const slug of Object.keys(BALLOT_SLUGS)) events.push(...(await get(`${GAMMA}?slug=${slug}`).catch(() => [])));
  // Party hints for name-only markets (e.g. Alaska, California governor): candidates already labeled by polls or official feeds.
  const hints = {};
  for (const src of [await readJ('polls'), await readJ('results')]) for (const [id, r] of Object.entries(src?.races || {})) (hints[id] ||= []).push(...(r.cands || []).filter((x) => x.p && x.p !== 'O').map((x) => ({ n: x.n, p: x.p })));
  const d = parseEvents(events, hints);
  if (Object.keys(d.races).length < 20) throw new Error('too few races parsed');
  return { updated: now(), source: 'Polymarket', ...d };
}

// ---- Polling averages & ratings (PollCheck) ----
const toText = (h) => h.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/g, '')
  .replace(/<\/(tr|div|p|h\d|li)>/g, '\n').replace(/<\/t[dh]>/g, ' | ').replace(/<[^>]+>/g, ' ')
  .replace(/&amp;/g, '&').replace(/&#0?39;|&apos;/g, "'").replace(/&nbsp;/g, ' ').replace(/[ \t]+/g, ' ').replace(/\n\s*\n+/g, '\n');
const PC = 'https://www.pollcheck.co.uk/us-midterms-2026';
function raceTable(text, kind) {
  const lines = text.split('\n').map((l) => l.trim());
  const out = {};
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/^([A-Z][A-Za-z .]+?)(?: \((special)\))? \|$/);
    const lean = lines[i + 1]?.match(/^(Toss-up|Lean [DR]|Likely [DR]|Safe [DR]) (\S+) (\d+)% - (\d+) polls?, (\d+) pollsters?/);
    if (!m || !lean) continue;
    const st = NAME_TO_ST[m[1].toLowerCase()];
    if (!st) continue;
    const avg = lines[i + 2]?.match(/^(\S+) ([+-][\d.]+)/);
    const cands = [...(lines[i + 3] || '').matchAll(/([A-Z][^()%|]*?) \(([DRI])\) ([\d.]+)%/g)].map((c) => ({ n: c[1].trim(), p: c[2], pct: Number(c[3]) }));
    // Last result line, e.g. "2020: Joni Ernst (R) 51.8%, ...": the winner's party is who holds the seat today.
    const last = (lines[i + 4] || '').match(/^(\d{4}): (.+?) \(([DRI])\) ([\d.]+)%/);
    out[`${kind}-${st}`] = { id: `${kind}-${st}`, kind, state: st, special: !!m[2], holder: last ? last[3] : null, holderName: last ? last[2] : null, holderYear: last ? Number(last[1]) : null, rating: lean[1], leader: lean[2], winProb: Number(lean[3]) / 100, polls: Number(lean[4]), pollsters: Number(lean[5]), lead: avg ? `${avg[1]} ${avg[2]}` : null, cands };
  }
  return out;
}
async function polls() {
  const [hub, gov, gb] = await Promise.all([get(PC, false), get(`${PC}/governors`, false), get(`${PC}/generic-ballot`, false)]);
  const races = { ...raceTable(toText(hub), 'S'), ...raceTable(toText(gov), 'G') };
  const flat = toText(gb).replace(/\s*\n\s*/g, ' ').replace(/ +/g, ' ');
  const avg = flat.match(/Democratic ([\d.]+)% .*?Republican ([\d.]+)% .*?Margin ([DR])\+([\d.]+)/);
  const list = [];
  const rowRe = /([^|]+?) \| (\d{1,2} [A-Z][a-z]{2} 2026) \| ([\d,]+) (LV|RV|A) \| ([\d.]+)% \| ([\d.]+)% \| (Dem|Rep|Tie) \+?([\d.]*) \| (?:Pollster \| )?/g;
  const body = flat.slice(flat.indexOf('Latest polls'));
  let m;
  while ((m = rowRe.exec(body)) && list.length < 60) {
    const raw = m[1].replace(/^.*Source \| /, '').trim();
    list.push({ date: m[2], n: Number(m[3].replace(/,/g, '')), pop: m[4], dem: Number(m[5]), rep: Number(m[6]), margin: m[7] === 'Tie' ? 0 : (m[7] === 'Dem' ? 1 : -1) * Number(m[8]), pollster: raw.replace(/ Not in average:.*$/, ''), dup: /Not in average/.test(raw) });
  }
  if (!avg || Object.keys(races).length < 10) throw new Error('poll page layout changed');
  return { updated: now(), source: 'PollCheck', generic: { dem: Number(avg[1]), rep: Number(avg[2]), margin: (avg[3] === 'D' ? 1 : -1) * Number(avg[4]), polls: list }, races };
}

// ---- Official results: state election offices (see scripts/feeds.mjs) ----
// A failing feed keeps its last good races so one flaky state never blanks the map.
async function results() {
  let prev = { races: {}, feeds: {} };
  try { prev = JSON.parse(await readFile(`${OUT}/results.json`, 'utf8')); } catch {}
  const races = { ...prev.races }, feeds = { ...prev.feeds };
  // Candidate-name -> party hints for feeds that omit party (Florida), from the polls and markets files.
  const hints = {};
  for (const src of [await readJ('polls'), await readJ('markets')]) for (const [id, r] of Object.entries(src?.races || {})) (hints[id] ||= []).push(...(r.cands || []).filter((x) => x.p).map((x) => ({ n: x.n, p: x.p })));
  const ctx = { hints };
  await Promise.all(Object.entries(FEEDS).map(async ([st, fn]) => {
    try {
      const got = await fn(ctx);
      // Never delete a state's earlier races: a source that briefly answers with less must not wipe what we already have.
      Object.assign(races, got);
      feeds[st] = { ok: true, at: now(), races: Object.keys(got) };
      // Polls closed but the state's own file still shows zero votes for a Senate/governor race: use NBC's numbers until the state posts.
      if (Date.now() >= closeTime(st) + 120000 && Object.entries(got).some(([k, v]) => k[0] !== 'H' && v.totalVotes === 0)) {
        try {
          const alt = await nbcState(st, ST_META[st][0], () => true)();
          for (const [k, v] of Object.entries(alt)) if (!(races[k]?.totalVotes > 0) && v.pct > 0) { races[k] = v; feeds[st].fallback = 'NBC News (state file still empty)'; }
        } catch { /* keep as is */ }
      }
    } catch (e) {
      feeds[st] = { ...feeds[st], ok: false, at: now(), error: e.message }; console.error(st, e.message);
      // A state's own site is down (election-night overload is common): fall back to NBC's statewide Senate/governor numbers for that state.
      try { Object.assign(races, await nbcState(st, ST_META[st][0], () => true)()); feeds[st].fallback = 'NBC News'; } catch { /* keep last good data */ }
    }
  }));
  // House districts in states without a native district feed: a detached worker keeps house_nbc.json fresh; merge it here.
  try {
    const hn = await readJ('house_nbc');
    for (const [id, v] of Object.entries(hn || {})) if (!races[id] || races[id].source === 'NBC News') races[id] = v;
    feeds.NBC_HOUSE = { ok: true, at: now(), districts: Object.keys(hn || {}).length };
  } catch (e) { feeds.NBC_HOUSE = { ok: false, at: now(), error: e.message }; }
  return { updated: now(), feeds, races };
}

// ---- Turnout so far (Florida publishes live Election Day turnout by county) ----
async function turnout() {
  const t = (await get('https://floridaelectionwatch.gov/ElectionDayTurnout', false)).replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/g, ' ').replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ');
  const body = t.slice(t.indexOf('County Turnout Last Reported Time Zone') + 'County Turnout Last Reported Time Zone'.length);
  const rows = [...body.matchAll(/([A-Z][A-Za-z.\- ]+?) ([\d,]+) (\d{1,2}:\d{2} [AP]M) (Eastern|Central)/g)].map((m) => ({ county: m[1].trim(), votes: Number(m[2].replace(/,/g, '')), at: m[3], tz: m[4] }));
  if (rows.length < 60) throw new Error('florida turnout layout changed');
  const latest = rows.filter((r) => r.tz === 'Eastern').map((r) => r.at).sort((a, b) => Date.parse(`1/1/2000 ${b}`) - Date.parse(`1/1/2000 ${a}`))[0];
  return { updated: now(), FL: { electionDay: rows.reduce((a, r) => a + r.votes, 0), counties: rows.length, lastReportedET: latest || null, source: 'Florida Division of Elections', url: 'https://floridaelectionwatch.gov/ElectionDayTurnout' } };
}

// ---- Trends: Polymarket price history (backfill) plus our own samples of counts and the generic ballot ----
const GAP = 25; // seconds-per-request pacing is not needed; requests run in small batches
async function history() {
  const [m, po, re] = await Promise.all([readJ('markets'), readJ('polls'), readJ('results')]);
  const h = (await readJ('history')) || { series: {}, counts: {}, generic: [], backfilledAt: 0 };
  const t = Math.floor(Date.now() / 1000);
  // 1) Odds history for chamber control and every Senate/governor race that is not a foregone conclusion. Refreshed every 10 minutes.
  if (m && Date.now() - (h.backfilledAt || 0) > 600000) {
    const targets = [];
    for (const k of ['senate', 'house']) if (m.control?.[k]?.dTok) targets.push([`control-${k}`, m.control[k].dTok]);
    for (const r of Object.values(m.races)) if (r.kind !== 'H' && r.dTok && r.d / ((r.d + r.r) || 1) > 0.03 && r.d / ((r.d + r.r) || 1) < 0.97) targets.push([r.id, r.dTok]);
    for (let i = 0; i < targets.length; i += 6) {
      await Promise.all(targets.slice(i, i + 6).map(async ([id, tok]) => {
        try {
          const j = await get(`https://clob.polymarket.com/prices-history?market=${tok}&interval=1w&fidelity=60`);
          if (j.history?.length > 3) h.series[id] = j.history.map((x) => [x.t, Math.round(x.p * 1000) / 1000]);
        } catch (e) { console.error('history', id, e.message); }
      }));
    }
    h.backfilledAt = Date.now();
  }
  // 2) Our own live samples: official count margin (percentage points, leader minus runner-up) and PollCheck's generic ballot margin.
  for (const r of Object.values(re?.races || {})) {
    if (r.id?.[0] === 'H' || r.cands.length < 2 || !(r.totalVotes > 0 || (r.shareOnly && r.pct > 0 && r.cands[0].pct > 0))) continue;
    const arr = (h.counts[r.id] ||= []);
    const pt = [t, r.pct, Math.round((r.cands[0].pct - r.cands[1].pct) * 10) / 10, r.totalVotes, r.cands[0].n, r.cands[1].n, r.cands[0].p];
    const last = arr[arr.length - 1];
    if (!last || last[1] !== pt[1] || last[3] !== pt[3] || last[2] !== pt[2]) arr.push(pt);
    if (arr.length > 800) arr.splice(0, arr.length - 800);
  }
  const gm = po?.generic?.margin;
  if (typeof gm === 'number' && h.generic[h.generic.length - 1]?.[1] !== gm) h.generic.push([t, gm]);
  if (h.generic.length > 2000) h.generic.splice(0, h.generic.length - 2000);
  // Senate polling index: mean of (D% - R%) across Senate races with both parties in the polling average.
  const sm = Object.values(po?.races || {}).filter((r) => r.kind === 'S').map((r) => { const d = r.cands.find((x) => x.p === 'D'), q = r.cands.find((x) => x.p === 'R'); return d && q ? d.pct - q.pct : null; }).filter((x) => x !== null);
  h.senate ||= [];
  if (sm.length) { const idx = Math.round((sm.reduce((a, b) => a + b, 0) / sm.length) * 100) / 100; if (h.senate[h.senate.length - 1]?.[1] !== idx) h.senate.push([t, idx]); if (h.senate.length > 2000) h.senate.splice(0, h.senate.length - 2000); }
  return { ...h, updated: now() };
}

// ---- Race calls: NBC News "latest results" module (projected winners from the NBC News Decision Desk) ----
// The page embeds Next.js JSON with the most recent called races across all offices. We keep every call we have seen.
async function calls() {
  // The "latest results" module (most recent calls nationwide) rides along in every state API payload; the HTML pages refuse automated requests.
  // Several states are read and unioned, since each answer shows a slightly different recent window.
  const found = [];
  const seenRace = new Set();
  const payloads = await Promise.allSettled(['ohio', 'texas', 'georgia', 'pennsylvania', 'north-carolina'].map((s) => get(`https://www.nbcnews.com/firecracker/api/v2/state-results/2026-elections/${s}-results`, true)));
  if (payloads.every((p) => p.status === 'rejected')) throw new Error(`nbc latest results unavailable: ${payloads[0].reason?.message}`);
  for (const p of payloads) if (p.status === 'fulfilled') (function walk(o) { if (Array.isArray(o)) o.forEach(walk); else if (o && typeof o === 'object') { if (o.raceId && o.candidates && !seenRace.has(o.raceId + (o.percentInFormatted || ''))) { seenRace.add(o.raceId + (o.percentInFormatted || '')); found.push(o); } Object.values(o).forEach(walk); } })(p.value);
  const prev = (await readJ('calls')) || { calls: {} };
  const out = { ...prev.calls };
  for (const r of found) {
    const w = r.candidates.find((c) => c.isWinner);
    if (!w || !/^[PW]$/.test(r.callStatusCode || '')) continue;
    const mm = r.raceId.match(/~([A-Z]{2})(\d{0,3})[A-Z0-9]*~([HSG])/);
    if (!mm) continue;
    const id = mm[3] === 'H' ? `H-${mm[1]}-${String(Number(mm[2] || 1)).padStart(2, '0')}` : `${mm[3]}-${mm[1]}`;
    const party = { Dem: 'D', Rep: 'R' }[w.party] || 'O';
    const lose = r.candidates.filter((c) => !c.isWinner).sort((a, b) => b.percentVote - a.percentVote)[0];
    out[id] = out[id] || { id, firstSeen: now() };
    const inc = r.candidates.find((x) => x.isIncumbent);
    Object.assign(out[id], { incumbentParty: inc ? ({ Dem: 'D', Rep: 'R' }[inc.party] || 'O') : null, raceId: r.raceId, status: r.callStatusCode, winner: { n: w.lastName, p: party, pct: w.percentVote }, runnerUp: lose ? { n: lose.lastName, p: { Dem: 'D', Rep: 'R' }[lose.party] || 'O', pct: lose.percentVote } : null, pctIn: r.percentInFormatted || null, url: r.href ? `https://www.nbcnews.com${r.href}` : null });
  }
  // Any race that NBC's own state or district data marks with a winner counts as a call, even if it has scrolled out of the latest-results window.
  const flagged = { ...((await readJ('results'))?.races || {}), ...((await readJ('house_nbc')) || {}) };
  for (const [id, r] of Object.entries(flagged)) {
    if (!r.winner || r.source !== 'NBC News' || out[id]) continue;
    const w = r.cands.find((x) => x.winner) || r.cands[0], u = r.cands.find((x) => x !== w);
    out[id] = { id, firstSeen: now(), status: 'P', incumbentParty: null, winner: { n: w.n.split(' ').pop(), p: w.p, pct: w.pct }, runnerUp: u ? { n: u.n.split(' ').pop(), p: u.p, pct: u.pct } : null, pctIn: r.reporting?.split(' ')[0] || null, url: null };
  }
  // Massachusetts ballot questions that NBC tracks (it lists only some of the nine), keyed MA-<question number>.
  const measures = {};
  try {
    // The ballot-measures endpoint is a plain JSON API (the HTML page refuses automated requests).
    const mj = await get('https://www.nbcnews.com/firecracker/api/v2/state-results/2026-elections/massachusetts-ballot-measures', true);
    const ms = [];
    (function walk(o) { if (Array.isArray(o)) o.forEach(walk); else if (o && typeof o === 'object') { if (o.raceId && o.candidates) ms.push(o); Object.values(o).forEach(walk); } })(mj);
    for (const r of ms) {
      const q = /~MA~/.test(r.raceId) && /^Question (\d+)/.exec(r.raceName || '');
      if (!q) continue;
      const y = r.candidates.find((x) => /yes/i.test(x.lastName)), n = r.candidates.find((x) => /no/i.test(x.lastName));
      measures[`MA-${q[1]}`] = { yes: y?.percentVote ?? 0, no: n?.percentVote ?? 0, pctIn: r.percentInFormatted || null, status: r.callStatusCode || '', passed: !!y?.isWinner, source: 'NBC News', url: 'https://www.nbcnews.com/politics/2026-elections/massachusetts-ballot-measures' };
    }
  } catch (e) { console.error('measures', e.message); }
  return { updated: now(), source: 'NBC News Decision Desk (projections)', url: 'https://www.nbcnews.com/politics/2026-elections/senate-results', calls: out, measures };
}

// ---- VoteHub polling API (Creative Commons Attribution 4.0: https://votehub.com/polls/api) ----
async function votehub() {
  const base = 'https://api.votehub.com/polls';
  const [gen, sen, gov] = await Promise.all([
    get(`${base}?poll_type=generic-ballot&from_date=2026-08-01`, true),
    get(`${base}?poll_type=us-senator&from_date=2026-09-15`, true),
    get(`${base}?poll_type=governor&from_date=2026-09-15`, true),
  ]);
  const slim = (p) => ({ pollster: p.pollster, end: p.end_date, pop: p.population, n: p.sample_size, answers: (p.answers || []).map((a) => ({ n: a.choice, pct: a.pct })), url: p.url || null, partisan: p.partisan || null });
  const generic = gen.filter((p) => p.answers?.some((a) => a.choice === 'Dem') && p.answers?.some((a) => a.choice === 'Rep')).map((p) => ({ ...slim(p), dem: p.answers.find((a) => a.choice === 'Dem').pct, rep: p.answers.find((a) => a.choice === 'Rep').pct })).sort((a, b) => b.end.localeCompare(a.end));
  const recent = generic.filter((p) => Date.now() - Date.parse(p.end) < 60 * 86400000 && !p.partisan);
  const races = {};
  for (const [kind, list] of [['S', sen], ['G', gov]]) {
    for (const p of list) {
      const st = NAME_TO_ST[String(p.subject || '').replace(/^\d{4}\s+/, '').trim().toLowerCase()];
      if (!st || !p.answers?.length) continue;
      (races[`${kind}-${st}`] ||= []).push(slim(p));
    }
  }
  for (const k of Object.keys(races)) races[k] = races[k].sort((a, b) => b.end.localeCompare(a.end)).slice(0, 8);
  const avg = (key) => (recent.length ? Math.round((recent.reduce((s, p) => s + p[key], 0) / recent.length) * 10) / 10 : null);
  return { updated: now(), source: 'VoteHub', license: 'CC BY 4.0', url: 'https://votehub.com/polls/', generic: { polls: generic.slice(0, 40), avg: { dem: avg('dem'), rep: avg('rep'), n: recent.length, days: 60 } }, races };
}

await mkdir(OUT, { recursive: true });
// Start the House worker once (detached) if it is not running.
try {
  const pid = Number((await readFile(`${OUT}/house.pid`, 'utf8').catch(() => '0')).trim());
  let alive = false; if (pid) { try { process.kill(pid, 0); alive = true; } catch { alive = false; } }
  if (!alive) {
    const child = spawn(process.execPath, [new URL('./house-loop.mjs', import.meta.url).pathname, OUT], { detached: true, stdio: 'ignore' });
    child.unref();
    await writeFile(`${OUT}/house.pid`, String(child.pid));
  }
} catch (e) { console.error('house worker', e.message); }
const before = { markets: await readJ('markets'), polls: await readJ('polls'), results: await readJ('results') };
const log = (await readJ('changes')) || { events: [] };
await Promise.all([run('markets', markets), run('polls', polls, 270000), run('results', results), run('turnout', turnout), run('calls', calls, 40000), run('votehub', votehub, 600000)]);
await run('history', history); // after the others: reads this run's markets/results
let prev = {};
try { prev = JSON.parse(await readFile(`${OUT}/status.json`, 'utf8')); } catch {}
await writeFile(`${OUT}/status.json`, JSON.stringify({ updated: now(), sources: { ...prev.sources, ...status } }));
// One file for the browser: a single request per refresh (kept under the GitHub API's unauthenticated rate limit).
const [m, po, re, st, tu, ca, vhub] = await Promise.all(['markets', 'polls', 'results', 'status', 'turnout', 'calls', 'votehub'].map(readJ));
// Change feed: diff against the previous run, keep the newest 300 events.
// Hand-entered data files from the repo (data/*.json): diffed against the last seen copy.
const DATA = new URL('../data/', import.meta.url);
const readData = async (f) => { try { return JSON.parse(await readFile(new URL(f, DATA), 'utf8')); } catch { return null; } };
const manualNow = { exit: await readData('exit-polls.json'), ballot: await readData('ballot-questions.json'), averages: await readData('other-averages.json'), early: await readData('early-vote.json') };
const manualPrev = (await readJ('manual')) || {};
await writeFile(`${OUT}/manual.json`, JSON.stringify(manualNow));
const anchors = log.anchors || { odds: {}, control: {} };
const fresh = diffSnapshots(before, { markets: m, polls: po, results: re }, Date.now(), anchors);
anchors.announced ||= {};
const added = [...diffManual(manualPrev, manualNow), ...diffCalls(ca, re, anchors.announced)];
const changes = { updated: now(), events: [...added, ...fresh.reverse(), ...(log.events || [])].slice(0, 300) };
await writeFile(`${OUT}/changes.json`, JSON.stringify({ ...changes, anchors })); // anchors stay server-side; the bundle and site get events only
const bundleJson = JSON.stringify({ updated: now(), markets: m, polls: po, results: re, status: st, turnout: tu, calls: ca, votehub: vhub, changes });
await writeFile(`${OUT}/bundle.json`, bundleJson);
// 30-second stamped copies (this bucket and the next). raw.githubusercontent caches each URL for 5 minutes and ignores query strings,
// so the browser asks for s<bucket>.json: a URL nobody has requested yet is always fresh, keeping data about a minute old at most.
const bucket = Math.floor(Date.now() / 30000);
for (const bb of [bucket, bucket + 1]) await writeFile(`${OUT}/s${bb}.json`, bundleJson);
for (const f of await readdir(OUT)) { const k = /^[ms](\d+)\.json$/.exec(f); if (k && (f[0] === 'm' || Number(k[1]) < bucket - 1)) await rm(`${OUT}/${f}`); }
// ---- permanent archive (Tower only: OUT is /app/out, the archive lives beside it and is never force-pushed away) ----
// Per-minute gzipped bundle snapshots (every race incl. House), every change event ever (the live log is capped at 300),
// and 10-minute copies of history.json. A separate `archive` branch is pushed (not forced) every 20 minutes.
const ARCHIVE = process.env.ARCHIVE_DIR || (OUT === '/app/out' ? '/app/archive' : null);
if (ARCHIVE) {
  try {
    const d = new Date(), day = d.toISOString().slice(0, 10), hm = d.toISOString().slice(11, 16).replace(':', '');
    await mkdir(`${ARCHIVE}/snap/${day}`, { recursive: true });
    const snap = `${ARCHIVE}/snap/${day}/${hm}.json.gz`;
    if (Number(hm.slice(2)) % 10 === 0 && !(await stat(snap).catch(() => null))) await writeFile(snap, gzipSync(bundleJson)); // one snapshot per 10 minutes now that counting has quieted
    if (Number(hm.slice(2)) % 10 === 0) {
      const hp = `${ARCHIVE}/history/${day}-${hm}.json.gz`;
      await mkdir(`${ARCHIVE}/history`, { recursive: true });
      if (!(await stat(hp).catch(() => null))) await writeFile(hp, gzipSync(await readFile(`${OUT}/history.json`)));
    }
    const st0 = (() => { try { return JSON.parse(readFileSync(`${ARCHIVE}/.state.json`, 'utf8')); } catch { return { t: '', keys: [] }; } })();
    const fresh2 = changes.events.filter((e) => e.t > st0.t || (e.t === st0.t && !st0.keys.includes(e.text))).reverse();
    if (fresh2.length) {
      await appendFile(`${ARCHIVE}/changes.ndjson`, fresh2.map((e) => JSON.stringify(e)).join('\n') + '\n');
      const top = fresh2[fresh2.length - 1].t;
      await writeFile(`${ARCHIVE}/.state.json`, JSON.stringify({ t: top, keys: changes.events.filter((e) => e.t === top).map((e) => e.text) }));
    }
    const last = await stat(`${ARCHIVE}/.pushed`).then((s) => Date.now() - s.mtimeMs, () => Infinity);
    if (last > 30 * 60000) {
      await writeFile(`${ARCHIVE}/.pushed`, now());
      const sh = `cd ${ARCHIVE} && ( [ -d .git ] || git init -q -b archive ) && git config user.name midterms-bot && git config user.email tower@users.noreply.github.com && git remote get-url origin >/dev/null 2>&1 || git remote add origin git@github.com:ShatteredEagle/midterms-2026.git; cd ${ARCHIVE} && printf '.pushed\\n.state.json\\n' > .gitignore && git add -A && git commit -qm "archive $(date -u +%FT%TZ)" ; git push -q origin archive`;
      spawn('sh', ['-c', sh], { detached: true, stdio: 'ignore' }).unref();
    }
  } catch (e) { console.error('archive failed', e.message); }
}
console.log(JSON.stringify(status));
