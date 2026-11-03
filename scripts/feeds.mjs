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

function build(id, source, prRep, prTot, cands, unit = 'precincts') {
  const total = cands.reduce((a, c) => a + c.votes, 0);
  return {
    id, source, reporting: `${prRep.toLocaleString('en-US')} of ${prTot.toLocaleString('en-US')} ${unit} reporting`,
    pct: prTot ? Number(((prRep / prTot) * 100).toFixed(1)) : 0, totalVotes: total,
    cands: cands.map((c) => ({ ...c, pct: total ? Number(((c.votes / total) * 100).toFixed(1)) : 0 })).sort((a, b) => b.votes - a.votes),
    ...(cands.some((c) => c.winner) ? { winner: cands.find((c) => c.winner).n } : {}),
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

// ---- Georgia: Secretary of State results API (Enhanced Voting). Reporting is counted in counties, not precincts. ----
export async function GA() {
  const base = 'https://results.sos.ga.gov/results/public/api';
  const jur = await get(`${base}/jurisdictions/Georgia`, true);
  const el = (jur.elections || []).find((e) => e.electionDate === '2026-11-03' && /General/i.test(e.publicElectionId));
  if (!el) return {};
  const items = (await get(`${base}/elections/Georgia/${el.publicElectionId}/ballot-items`, true)).data || [];
  const out = {};
  for (const it of items) {
    const nm = it.name?.[0]?.text?.trim();
    const key = nm === 'US Senate' ? 'S-GA' : nm === 'Governor' ? 'G-GA' : null;
    if (!key || !it.summaryResults?.ballotOptions) continue;
    const rs = it.reportingStatus || {};
    out[key] = build(key, 'Georgia Secretary of State', num(rs.reportingUnits), num(rs.totalUnits), it.summaryResults.ballotOptions.filter((o) => !o.isWriteIn).map((o) => ({
      n: tidy(o.name[0].text.replace(/\s*\((Rep|Dem|Lib|Ind|Grn|[A-Za-z]{2,4})\)\s*$/i, '').replace(/\s*\(I\)\s*$/, '')),
      p: party(o.party?.abbreviation?.replace(/^Dem$/i, 'DEM').replace(/^Rep$/i, 'REP')), votes: num(o.voteCount), winner: o.isWinner === true,
    })), 'counties');
  }
  return out;
}

// ---- Florida: Division of Elections pipe-delimited files (layout PDF: flelectionfiles.floridados.gov/.../ResultsFileLayoutPipeDelimited.pdf) ----
// The files carry no party, so parties come from names already known to the polls/markets feeds (ctx.hints).
export async function FL(ctx = {}) {
  const base = 'https://flelectionfiles.floridados.gov/enightfilespublic/20261103_ElecResultsFL_PipeDlm_';
  const recs = (t) => t.split(/\r?\n/).map((l) => l.trim()).filter((l) => l.startsWith('[')).map((l) => l.slice(1, l.lastIndexOf(']')).split('|').map((s) => s.trim()));
  const [info, votes] = await Promise.all([get(`${base}Info.txt`).then(recs), get(`${base}Votes.txt`).then(recs)]);
  const races = {};
  for (const r of info.filter((x) => x[0] === 'r' && /general/i.test(x[4]))) {
    const kind = kindOf(r[3]);
    if (kind) races[r[5]] = { key: `${kind}-FL`, cands: {}, tot: 0, units: {}, votes: {} };
  }
  for (const x of info) {
    if (x[0] === 'c' && races[x[3]]) races[x[3]].cands[x[6]] = { last: x[4], first: x[5] };
    if (x[0] === 'p' && races[x[3]]) races[x[3]].tot += num(x[5]);
  }
  for (const x of votes) { // V|src|seq|status|race|unit|precinctsReporting|cand|votes
    const r = x[0] === 'V' && races[x[4]];
    if (!r) continue;
    r.units[x[5]] = Math.max(r.units[x[5]] || 0, num(x[6]));
    r.votes[x[7]] = (r.votes[x[7]] || 0) + num(x[8]);
  }
  const out = {};
  for (const r of Object.values(races)) {
    const hints = ctx.hints?.[r.key] || [];
    const gov = r.key.startsWith('G'); // governor rows are tickets: Florida puts the governor candidate in the first-name field and the running mate in the last-name field
    const cands = Object.entries(r.cands).map(([id, c]) => {
      const key = (gov ? c.first : c.last).toLowerCase();
      const h = hints.find((x) => { const t = x.n.toLowerCase(); return t.endsWith(key) || t.includes(key); });
      return { n: gov ? `${h ? h.n : c.first} / ${c.last}` : tidy(`${c.first} ${c.last}`), p: h ? h.p : 'O', votes: r.votes[id] || 0 };
    });
    out[r.key] = build(r.key, 'Florida Division of Elections', Object.values(r.units).reduce((a, b) => a + b, 0), r.tot, cands);
  }
  return out;
}

export const FEEDS = { CA, CO, FL, GA, IA, MN, NC, NE, SD };
