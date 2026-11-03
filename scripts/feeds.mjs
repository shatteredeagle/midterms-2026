// Official state results feeds. Each feed returns { "S-XX"|"G-XX": { id, source, reporting, pct, totalVotes, cands:[{n,p,votes,pct}] } }.
// pct = percent of precincts reporting. No winner flags are inferred; counts are unofficial until certified.
const UA = 'midterms-2026-dashboard/1.0 (+https://github.com/ShatteredEagle/midterms-2026)';
const get = async (u, json = false) => {
  const r = await fetch(u, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(25000) });
  if (!r.ok) throw new Error(`${u} -> ${r.status}`);
  return json ? r.json() : r.text();
};
const party = (p = '') => ({ DEM: 'D', DFL: 'D', D: 'D', REP: 'R', R: 'R', GOP: 'R' }[String(p).trim().toUpperCase()] || 'O');
const num = (x) => Number(String(x).replace(/[^\d.-]/g, '')) || 0;
const tidy = (s) => String(s).replace(/\s+/g, ' ').trim();
const kindOf = (name) => (/^(for )?(the )?(united states|u\.?s\.?) senator|^us senate/i.test(name.trim()) ? 'S' : /^(for )?governor/i.test(name.trim()) ? 'G' : null);

function build(id, source, prRep, prTot, cands) {
  const total = cands.reduce((a, c) => a + c.votes, 0);
  return {
    id, source, reporting: `${prRep.toLocaleString('en-US')} of ${prTot.toLocaleString('en-US')} precincts reporting`,
    pct: prTot ? Number(((prRep / prTot) * 100).toFixed(1)) : 0, totalVotes: total,
    cands: cands.map((c) => ({ ...c, pct: total ? Number(((c.votes / total) * 100).toFixed(1)) : 0 })).sort((a, b) => b.votes - a.votes),
  };
}

// ---- California: Secretary of State media JSON (governor) ----
export async function CA() {
  const gov = await get('https://media.sos.ca.gov/media/governor.json', true);
  const r = gov.find((x) => /^Governor/i.test(x.raceTitle));
  if (!r) return {};
  const m = r.Reporting.match(/\(([\d,]+) of ([\d,]+)/);
  return { 'G-CA': build('G-CA', 'California Secretary of State', num(m?.[1]), num(m?.[2]), r.candidates.map((c) => ({ n: tidy(c.Name), p: party(c.Party), votes: num(c.Votes) }))) };
}

// ---- North Carolina: State Board of Elections ENR (statewide rows have cid "0") ----
export async function NC() {
  const rows = await get('https://er.ncsbe.gov/enr/20261103/data/results_0.txt', true);
  const sen = rows.filter((r) => r.cid === '0' && /^US SENATE/i.test(r.cnm));
  if (!sen.length) return {};
  const prRep = Math.max(...sen.map((r) => num(r.prt))), prTot = Math.max(...sen.map((r) => num(r.ptl)));
  return { 'S-NC': build('S-NC', 'NC State Board of Elections', prRep, prTot, sen.map((r) => ({ n: tidy(r.bnm), p: party(r.pty), votes: num(r.vct) }))) };
}

// ---- Minnesota: semicolon media files ----
async function mnFile(file, kind) {
  const lines = (await get(`https://electionresultsfiles.sos.mn.gov/20261103/${file}`)).split(/\r?\n/).filter(Boolean).map((l) => l.split(';'));
  const rows = lines.filter((f) => f.length >= 15 && !/write-?in/i.test(f[7]) && f[10] !== 'WI');
  if (!rows.length) return {};
  const pr = rows.map((f) => num(f[11])), tot = rows.map((f) => num(f[12]));
  return { [`${kind}-MN`]: build(`${kind}-MN`, 'Minnesota Secretary of State', Math.max(...pr), Math.max(...tot), rows.map((f) => ({ n: tidy(f[7]), p: party(f[10]), votes: num(f[13]) }))) };
}
export const MN = async () => ({ ...(await mnFile('ussenate.txt', 'S')), ...(await mnFile('governor.txt', 'G')) });

// ---- Nebraska / South Dakota: results CSV ----
function csv(text) {
  const out = []; let row = [], cur = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) { if (c === '"' && text[i + 1] === '"') { cur += '"'; i++; } else if (c === '"') q = false; else cur += c; }
    else if (c === '"') q = true; else if (c === ',') { row.push(cur); cur = ''; } else if (c === '\n' || c === '\r') { if (c === '\r' && text[i + 1] === '\n') i++; row.push(cur); if (row.length > 1) out.push(row); row = []; cur = ''; } else cur += c;
  }
  if (cur || row.length) { row.push(cur); out.push(row); }
  return out;
}
async function csvFeed(url, source, stateCode) {
  const [head, ...rows] = csv(await get(url));
  const ix = Object.fromEntries(head.map((h, i) => [h.trim(), i]));
  const races = {};
  for (const r of rows) {
    const kind = kindOf(r[ix.RaceName] || '');
    if (!kind) continue;
    const key = `${kind}-${stateCode}`, rid = r[ix.RaceID];
    (races[key] ||= { rid, rows: [] });
    if (races[key].rid === rid) races[key].rows.push(r);
  }
  const out = {};
  for (const [key, { rows: rs }] of Object.entries(races)) {
    const ids = rs.map((r) => r[ix.CandidateID]);
    if (new Set(ids).size !== ids.length) continue; // duplicate candidate rows: not a clean statewide file, skip rather than guess
    const pr = rs[0][ix.PrecinctsReporting].replace(/[^\d/]/g, '').split('/');
    out[key] = build(key, source, num(pr[0]), num(pr[1]), rs.map((r) => ({ n: tidy(r[ix.CandidateName]), p: party(r[ix.PartyCode]), votes: num(r[ix.CandidateVotes]) })));
  }
  return out;
}
export const NE = () => csvFeed('https://electionresults.nebraska.gov/resultsCSV.aspx?text=All&type=SW&map=CTY', 'Nebraska Secretary of State', 'NE');
export const SD = () => csvFeed('https://electionresults.sd.gov/resultsCSV.aspx?text=All&type=SWR&map=CTY', 'South Dakota Secretary of State', 'SD');

// ---- Clarity (Colorado, Iowa) ----
async function clarity(base, st, source) {
  const els = await get(`${base}/elections.json`, true);
  const el = els.find((e) => /2026/.test(e.ElectionName) && /general/i.test(e.ElectionName) && /11\/3\/2026/.test(e.Date));
  if (!el) return {};
  const ver = (await get(`${base}/${el.EID}/current_ver.txt`)).trim();
  const sum = await get(`${base}/${el.EID}/${ver}/json/en/summary.json`, true);
  const out = {};
  for (const c of sum) {
    const kind = kindOf(c.C || '');
    const key = kind && `${kind}-${st}`;
    if (!key || out[key]) continue;
    out[key] = build(key, source, num(c.PR), num(c.TP), c.CH.map((n, i) => ({ n: tidy(n), p: party(c.P[i]), votes: num(c.V[i]) })));
  }
  return out;
}
export const CO = () => clarity('https://results.enr.clarityelections.com/CO', 'CO', 'Colorado Secretary of State');
export const IA = () => clarity('https://electionresults.iowa.gov/IA', 'IA', 'Iowa Secretary of State');

export const FEEDS = { CA, CO, IA, MN, NC, NE, SD };
