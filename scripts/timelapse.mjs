// Timelapse: renders the dashboard as it looked at each commit, and (once the archive exists) replays the recorded results snapshots
// through the page code that was live at that moment. Usage: node scripts/timelapse.mjs <workdir> [--test] [--step=5]
// Needs: git, google-chrome-stable (headless), ffmpeg, and a clone of the `archive` branch at <workdir>/archive (see below).
import { execFileSync, execFile } from 'node:child_process';
import { promisify } from 'node:util';
const execFileP = promisify(execFile);
import { mkdirSync, writeFileSync, readFileSync, readdirSync, existsSync, rmSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import http from 'node:http';

const WORK = process.argv[2];
const TEST = process.argv.includes('--test');
const STEP = Number((process.argv.find((a) => a.startsWith('--step=')) || '--step=5').slice(7)) * 60000;
if (!WORK) throw new Error('usage: node scripts/timelapse.mjs <workdir> [--test] [--step=minutes]');
const REPO = new URL('..', import.meta.url).pathname;
const SITE = `${WORK}/site`, FRAMES = `${WORK}/frames`;
mkdirSync(FRAMES, { recursive: true });
const sh = (cmd, args, opts = {}) => execFileSync(cmd, args, { encoding: 'utf8', maxBuffer: 1 << 28, ...opts });

// commits on main, oldest first
const commits = sh('git', ['-C', REPO, 'log', '--reverse', '--format=%H|%at|%s', 'main']).trim().split('\n').map((l) => { const [sha, at, ...s] = l.split('|'); return { sha, t: Number(at) * 1000, subject: s.join('|') }; });

// recorded snapshots (archive branch clone): snap/<day>/<HHMM>.json.gz, UTC
const snaps = [];
const snapDir = `${WORK}/archive/snap`;
if (existsSync(snapDir)) for (const day of readdirSync(snapDir)) for (const f of readdirSync(`${snapDir}/${day}`)) snaps.push({ t: Date.parse(`${day}T${f.slice(0, 2)}:${f.slice(2, 4)}:00Z`), file: `${snapDir}/${day}/${f}` });
snaps.sort((a, b) => a.t - b.t);

// frames: one per commit, then one per STEP across the recorded window using the commit that was live
const frames = commits.map((c) => ({ t: c.t, commit: c, snap: null }));
if (snaps.length) {
  for (let t = snaps[0].t; t <= snaps.at(-1).t; t += STEP) {
    const s = snaps.reduce((b, x) => (Math.abs(x.t - t) < Math.abs(b.t - t) ? x : b), snaps[0]);
    frames.push({ t, commit: commits.filter((c) => c.t <= t).at(-1) || commits[0], snap: s });
  }
}
frames.sort((a, b) => a.t - b.t);
const todo = TEST ? [frames[0], frames[Math.floor(frames.length / 2)], frames.at(-1)] : frames;

// local server over SITE (swapped per frame)
const server = http.createServer((req, res) => {
  const p = decodeURIComponent(req.url.split('?')[0]);
  const f = `${SITE}${p === '/' ? '/index.html' : p}`;
  try { const b = readFileSync(f); const ext = f.split('.').pop(); res.writeHead(200, { 'content-type': { html: 'text/html', js: 'text/javascript', css: 'text/css', json: 'application/json' }[ext] || 'application/octet-stream' }); res.end(b); } catch { res.writeHead(404); res.end(); }
}).listen(0);
await new Promise((r) => server.once('listening', r));
const port = server.address().port;

let n = 0;
for (const fr of todo) {
  const out = `${FRAMES}/${String(n++).padStart(5, '0')}.png`;
  rmSync(SITE, { recursive: true, force: true });
  mkdirSync(SITE, { recursive: true });
  execFileSync('sh', ['-c', `git -C ${REPO} archive ${fr.commit.sha} | tar -x -C ${SITE}`]);
  const when = new Date(fr.t).toLocaleString('en-US', { timeZone: 'America/New_York', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
  const bundle = fr.snap ? gunzipSync(readFileSync(fr.snap.file)).toString() : null;
  const inject = `<script>(()=>{const T=${fr.t};Date.now=()=>T;${bundle ? `const B=${bundle};const of=window.fetch;window.fetch=(u,o)=>/bundle\\.json|\\/s\\d+\\.json/.test(String(u))?Promise.resolve(new Response(JSON.stringify(B),{status:200,headers:{'content-type':'application/json'}})):of(u,o);` : ''}
  addEventListener('DOMContentLoaded',()=>{const d=document.createElement('div');d.style.cssText='position:fixed;left:0;right:0;bottom:0;z-index:99999;background:#111c;color:#fff;font:600 15px system-ui;padding:8px 14px;display:flex;justify-content:space-between';d.innerHTML='<span>${when.replace(/'/g, '')} EST · ${fr.snap ? 'recorded results replay' : 'dashboard as of this commit'}</span><span style="font-weight:400;opacity:.85">${fr.commit.subject.replace(/['"\\<>]/g, '').slice(0, 90)}</span>';document.body.appendChild(d)});})()</script>`;
  const idx = `${SITE}/index.html`;
  writeFileSync(idx, readFileSync(idx, 'utf8').replace('<head>', `<head>${inject}`));
  try {
    await execFileP('google-chrome-stable', ['--headless=new', '--disable-gpu', '--no-sandbox', '--hide-scrollbars', '--window-size=1400,1000', '--virtual-time-budget=12000', `--screenshot=${out}`, `http://localhost:${port}/index.html#overview`], { timeout: 90000 }); // async: the page is fetched from this process's own server, which a sync call would block
  } catch { console.error('frame failed', n, fr.commit.sha.slice(0, 7)); if (n > 1) execFileSync('cp', [`${FRAMES}/${String(n - 2).padStart(5, '0')}.png`, out]); } // keep the numbering gapless for ffmpeg
  if (n % 10 === 0) console.log(`${n}/${todo.length}`);
}
server.close();
if (!TEST) {
  sh('ffmpeg', ['-y', '-framerate', '4', '-i', `${FRAMES}/%05d.png`, '-vf', 'scale=1400:-2', '-pix_fmt', 'yuv420p', '-c:v', 'libx264', `${WORK}/timelapse.mp4`]);
  console.log('wrote', `${WORK}/timelapse.mp4`);
}
console.log('frames', n);
