// One-off: converts us-atlas (pre-projected Albers USA, 975x610) into compact SVG paths per state. Output: assets/map-paths.json
import { writeFile } from 'node:fs/promises';
const topo = await (await fetch('https://cdn.jsdelivr.net/npm/us-atlas@3.0.1/states-albers-10m.json')).json();
const { scale, translate } = topo.transform;
const arcs = topo.arcs.map((a) => { let x = 0, y = 0; return a.map(([dx, dy]) => [(x += dx) * scale[0] + translate[0], (y += dy) * scale[1] + translate[1]]); });
const ring = (idxs) => idxs.flatMap((i, k) => { const pts = i < 0 ? [...arcs[~i]].reverse() : arcs[i]; return k ? pts.slice(1) : pts; });
const r1 = (n) => Math.round(n * 10) / 10;
const out = {};
for (const g of topo.objects.states.geometries) {
  const polys = g.type === 'Polygon' ? [g.arcs] : g.arcs;
  let d = '', best = { area: 0, c: [0, 0] };
  for (const poly of polys) for (const [ri, rg] of poly.entries()) {
    const pts = ring(rg);
    d += 'M' + pts.map(([x, y]) => `${r1(x)} ${r1(y)}`).join('L') + 'Z';
    if (ri === 0) {
      let a = 0, cx = 0, cy = 0;
      for (let i = 0; i < pts.length - 1; i++) { const [x0, y0] = pts[i], [x1, y1] = pts[i + 1], f = x0 * y1 - x1 * y0; a += f; cx += (x0 + x1) * f; cy += (y0 + y1) * f; }
      a /= 2; if (Math.abs(a) > best.area) best = { area: Math.abs(a), c: [r1(cx / (6 * a)), r1(cy / (6 * a))] };
    }
  }
  out[g.id] = { d, c: best.c };
}
await writeFile('assets/map-paths.json', JSON.stringify(out));
console.log(Object.keys(out).length, 'states');
