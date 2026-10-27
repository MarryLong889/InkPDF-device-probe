import type { Point } from './core';

// Resample by distance so endpoint dwell and event frequency do not bias fitting.
export function fitShape(raw: Point[]): { kind: string; points: Point[] } | null {
  if (raw.length < 5) return null;
  const distances = [0];
  for (let i = 1; i < raw.length; i++) distances.push(distances[i - 1] + Math.hypot(raw[i][0] - raw[i - 1][0], raw[i][1] - raw[i - 1][1]));
  const length = distances.at(-1)!;
  if (length < 30) return null;
  const samples: number[][] = [];
  let j = 1;
  for (let i = 0; i <= 64; i++) {
    const d = length * i / 64;
    while (j < raw.length - 1 && distances[j] < d) j++;
    const t = (d - distances[j - 1]) / (distances[j] - distances[j - 1] || 1);
    samples.push([raw[j - 1][0] + t * (raw[j][0] - raw[j - 1][0]), raw[j - 1][1] + t * (raw[j][1] - raw[j - 1][1])]);
  }
  const first = samples[0], last = samples.at(-1)!;
  const chord = Math.hypot(last[0] - first[0], last[1] - first[1]);
  const pressure = raw.reduce((n, p) => n + (p[2] ?? .3), 0) / raw.length;
  const result = (kind: string, xy: number[][]) => ({ kind, points: xy.map((p, i): Point => [p[0], p[1], pressure, raw.at(-1)![3] * i / (xy.length - 1)]) });
  if (chord >= 30 && length / chord < 1.15 && samples.every(p => Math.abs((p[0] - first[0]) * (last[1] - first[1]) - (p[1] - first[1]) * (last[0] - first[0])) / chord < Math.max(3, chord * .045))) return result('line', [first, last]);
  const xs = samples.map(p => p[0]), ys = samples.map(p => p[1]);
  const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
  const w = x1 - x0, h = y1 - y0;
  if (Math.min(w, h) < 20 || chord > Math.min(w, h) * .25) return null;
  // shortcut: rectangles are axis-aligned; add rotated fitting only after device acceptance.
  const perimeter = 2 * (w + h);
  const corners = [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
  const tolerance = Math.min(w, h) * .12;
  if (length / perimeter > .85 && length / perimeter < 1.15 &&
      samples.every(p => Math.min(p[0] - x0, x1 - p[0], p[1] - y0, y1 - p[1]) < tolerance) &&
      corners.every(c => samples.some(p => Math.hypot(p[0] - c[0], p[1] - c[1]) < tolerance * 1.5))) return result('rectangle', [...corners, corners[0]]);
  const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2, radius = (w + h) / 4;
  if (w / h < .8 || w / h > 1.25 || length / (2 * Math.PI * radius) < .85 || length / (2 * Math.PI * radius) > 1.15) return null;
  if (!samples.every(p => Math.abs(Math.hypot(p[0] - cx, p[1] - cy) - radius) < radius * .15)) return null;
  const bins = new Set(samples.map(p => Math.floor((Math.atan2(p[1] - cy, p[0] - cx) + Math.PI) / (2 * Math.PI) * 12) % 12));
  if (bins.size !== 12) return null;
  return result('circle', Array.from({ length: 65 }, (_, i) => [cx + radius * Math.cos(i * Math.PI / 32), cy + radius * Math.sin(i * Math.PI / 32)]));
}
