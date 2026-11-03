// Stamps ?v=<content hash> onto the stylesheet, scripts and module imports so a browser can never mix
// old and new files after a deploy (GitHub Pages caches each file for 10 minutes). Run before committing.
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';

const strip = (s) => s.replace(/\?v=[a-f0-9]{8}/g, '');
const files = ['assets/app.js', 'assets/markets.js', 'assets/states.js', 'assets/styles.css'];
const h = createHash('sha256');
for (const f of files) h.update(strip(await readFile(f, 'utf8')));
const v = h.digest('hex').slice(0, 8);

const put = async (f, fn) => { const s = await readFile(f, 'utf8'); const t = fn(strip(s)); if (t !== s) await writeFile(f, t); };
await put('index.html', (s) => s.replace('assets/styles.css', `assets/styles.css?v=${v}`).replace('assets/app.js', `assets/app.js?v=${v}`));
await put('assets/app.js', (s) => s.replace(/from '\.\/(states|markets)\.js'/g, `from './$1.js?v=${v}'`));
await put('assets/markets.js', (s) => s.replace(/from '\.\/states\.js'/g, `from './states.js?v=${v}'`));
console.log('stamped', v);
