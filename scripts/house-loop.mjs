// Background worker: keeps U.S. House district results for states without a native district feed fresh in <out>/house_nbc.json.
// Started (once, detached) by collect.mjs. Key districts are refreshed every pass; the rest are rotated.
import { readFile, writeFile, rename } from 'node:fs/promises';
import { nbcHouseDistrict, HOUSE_NATIVE } from './feeds.mjs';
import { HOUSE_SEATS, closeTime } from '../assets/states.js';

const OUT = process.argv[2] || 'out';
const FILE = `${OUT}/house_nbc.json`;
const key = JSON.parse(await readFile(new URL('../data/key-races.json', import.meta.url), 'utf8')).house.districts.map((d) => d.split('-')).map(([s, n]) => [s, Number(n)]);
const rest = [];
for (const [st, c] of Object.entries(HOUSE_SEATS)) for (let n = 1; n <= c; n++) if (!HOUSE_NATIVE.has(st)) rest.push([st, n]);
let cur = {};
try { cur = JSON.parse(await readFile(FILE, 'utf8')); } catch { /* first run */ }
let kc = 0, rc = 0;
const take = (list, cursor, n) => Array.from({ length: Math.min(n, list.length) }, (_, i) => list[(cursor + i) % list.length]);
for (;;) {
  const open = (st) => Date.now() >= closeTime(st);
  const batch = [...take(key.filter(([s]) => !HOUSE_NATIVE.has(s)), kc, 12), ...take(rest, rc, 24)].filter(([s]) => open(s));
  kc += 12; rc += 24;
  for (let i = 0; i < batch.length; i += 6) {
    await Promise.all(batch.slice(i, i + 6).map(async ([st, n]) => { try { const r = await nbcHouseDistrict(st, n); if (r) cur[r.id] = r; } catch { /* keep previous */ } }));
  }
  await writeFile(`${FILE}.tmp`, JSON.stringify(cur)); await rename(`${FILE}.tmp`, FILE);
  await new Promise((r) => setTimeout(r, 3000));
}
