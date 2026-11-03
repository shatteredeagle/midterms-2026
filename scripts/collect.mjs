// Collector: runs in GitHub Actions every ~5 min. Writes compact JSON into ./out (published to the `data` branch).
// Dependency-free (Node 20+). Every source is independent: one failing keeps the last good file.
import { mkdir, writeFile, readFile, stat } from 'node:fs/promises';
import { GAMMA, BALLOT_SLUGS, parseEvents } from '../assets/markets.js';
import { NAME_TO_ST } from '../assets/states.js';
import { FEEDS } from './feeds.mjs';
import { diffSnapshots } from './diff.mjs';

const OUT = process.argv[2] || 'out';
const UA = 'midterms-2026-dashboard/1.0 (+https://github.com/ShatteredEagle/midterms-2026)';
const now = () => new Date().toISOString();
const get = async (u, json = true) => {
  const r = await fetch(u, { headers: { 'User-Agent': UA, Accept: json ? 'application/json' : 'text/html' }, signal: AbortSignal.timeout(30000) });
  if (!r.ok) throw new Error(`${u} -> ${r.status}`);
  return json ? r.json() : r.text();
};
const status = {};
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
  const d = parseEvents(events);
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

const readJ = async (n) => { try { return JSON.parse(await readFile(`${OUT}/${n}.json`, 'utf8')); } catch { return null; } };

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
      for (const k of Object.keys(races)) if (k.endsWith(`-${st}`)) delete races[k];
      Object.assign(races, got);
      feeds[st] = { ok: true, at: now(), races: Object.keys(got) };
    } catch (e) { feeds[st] = { ...feeds[st], ok: false, at: now(), error: e.message }; console.error(st, e.message); }
  }));
  return { updated: now(), feeds, races };
}

await mkdir(OUT, { recursive: true });
const before = { markets: await readJ('markets'), polls: await readJ('polls'), results: await readJ('results') };
const log = (await readJ('changes')) || { events: [] };
await Promise.all([run('markets', markets), run('polls', polls, 270000), run('results', results)]);
let prev = {};
try { prev = JSON.parse(await readFile(`${OUT}/status.json`, 'utf8')); } catch {}
await writeFile(`${OUT}/status.json`, JSON.stringify({ updated: now(), sources: { ...prev.sources, ...status } }));
// One file for the browser: a single request per refresh (kept under the GitHub API's unauthenticated rate limit).
const [m, po, re, st] = await Promise.all(['markets', 'polls', 'results', 'status'].map(readJ));
// Change feed: diff against the previous run, keep the newest 300 events.
const anchors = log.anchors || { odds: {}, control: {} };
const fresh = diffSnapshots(before, { markets: m, polls: po, results: re }, Date.now(), anchors);
const changes = { updated: now(), events: [...fresh.reverse(), ...(log.events || [])].slice(0, 300) };
await writeFile(`${OUT}/changes.json`, JSON.stringify({ ...changes, anchors })); // anchors stay server-side; the bundle and site get events only
await writeFile(`${OUT}/bundle.json`, JSON.stringify({ updated: now(), markets: m, polls: po, results: re, status: st, changes }));
console.log(JSON.stringify(status));
