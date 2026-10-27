import type { Point } from './core';

export type ShapeFitMetrics = Record<string, number | string>;

// Simplify only the recognition copy; saved/undo ink retains every original sample.
function simplify(raw: Point[]): Point[] | null {
  const keep = new Set([0, raw.length - 1]);
  const pending: [number, number][] = [[0, raw.length - 1]];
  let work = 0;
  while (pending.length) {
    const [start, end] = pending.pop()!;
    const a = raw[start], b = raw[end], dx = b[0] - a[0], dy = b[1] - a[1], squared = dx * dx + dy * dy;
    let greatest = 1, split = -1; // One PDF unit removes sensor noise without erasing small corners.
    for (let i = start + 1; i < end; i++) {
      if (++work > 200000) return null;
      const p = raw[i], t = squared ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / squared)) : 0;
      const distance = Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dy);
      if (distance > greatest) { greatest = distance; split = i; }
    }
    if (split >= 0) { keep.add(split); pending.push([start, split], [split, end]); }
  }
  return [...keep].sort((a, b) => a - b).map(i => raw[i]);
}

// Distance resampling follows denoising: resampling alone cannot remove inflated path length.
export function fitShape(raw: Point[], metrics: ShapeFitMetrics = {}): { kind: string; points: Point[] } | null {
  const reject = (reason: string) => { metrics.reason = reason; return null; };
  metrics.rawSamples = raw.length;
  if (raw.length < 5) return reject('too-few-samples');
  const geometry = simplify(raw);
  if (!geometry) return reject('too-complex');
  metrics.simplifiedSamples = geometry.length;
  let rawLength = 0;
  for (let i = 1; i < raw.length; i++) rawLength += Math.hypot(raw[i][0] - raw[i - 1][0], raw[i][1] - raw[i - 1][1]);
  const distances = [0];
  for (let i = 1; i < geometry.length; i++) distances.push(distances[i - 1] + Math.hypot(geometry[i][0] - geometry[i - 1][0], geometry[i][1] - geometry[i - 1][1]));
  const length = distances.at(-1)!;
  metrics.pathLengthPdf = length;
  metrics.rawToCleanLengthRatio = length ? rawLength / length : 0;
  if (length < 30) return reject('too-short');
  const samples: number[][] = [];
  let j = 1;
  for (let i = 0; i <= 64; i++) {
    const d = length * i / 64;
    while (j < geometry.length - 1 && distances[j] < d) j++;
    const t = (d - distances[j - 1]) / (distances[j] - distances[j - 1] || 1);
    samples.push([geometry[j - 1][0] + t * (geometry[j][0] - geometry[j - 1][0]), geometry[j - 1][1] + t * (geometry[j][1] - geometry[j - 1][1])]);
  }
  const first = samples[0], last = samples.at(-1)!;
  const chord = Math.hypot(last[0] - first[0], last[1] - first[1]);
  const pressure = raw.reduce((n, p) => n + (p[2] ?? .3), 0) / raw.length;
  const result = (kind: string, xy: number[][]) => { metrics.reason = `accepted-${kind}`; return { kind, points: xy.map((p, i): Point => [p[0], p[1], pressure, raw.at(-1)![3] * i / (xy.length - 1)]) }; };
  const lineDeviation = chord ? Math.max(...samples.map(p => Math.abs((p[0] - first[0]) * (last[1] - first[1]) - (p[1] - first[1]) * (last[0] - first[0])) / chord)) : 0;
  metrics.chordPdf = chord;
  metrics.lineLengthRatio = chord ? length / chord : 0;
  metrics.lineDeviationPdf = lineDeviation;
  if (chord >= 30 && length / chord < 1.15 && lineDeviation < Math.max(3, chord * .045)) return result('line', [first, last]);
  const xs = samples.map(p => p[0]), ys = samples.map(p => p[1]);
  const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
  const w = x1 - x0, h = y1 - y0;
  metrics.minSidePdf = Math.min(w, h);
  metrics.closureRatio = Math.min(w, h) ? chord / Math.min(w, h) : 0;
  if (Math.min(w, h) < 20) return reject('not-line-and-too-narrow');
  if (chord > Math.min(w, h) * .25) return reject('not-line-and-not-closed');
  // shortcut: rectangles are axis-aligned; add rotated fitting only after device acceptance.
  const perimeter = 2 * (w + h);
  const corners = [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
  const tolerance = Math.min(w, h) * .12;
  const edgeError = Math.max(...samples.map(p => Math.min(p[0] - x0, x1 - p[0], p[1] - y0, y1 - p[1])));
  const cornerError = Math.max(...corners.map(c => Math.min(...samples.map(p => Math.hypot(p[0] - c[0], p[1] - c[1])))));
  metrics.rectangleLengthRatio = length / perimeter;
  metrics.rectangleEdgeRatio = edgeError / Math.min(w, h);
  metrics.rectangleCornerRatio = cornerError / Math.min(w, h);
  if (length / perimeter > .85 && length / perimeter < 1.15 && edgeError < tolerance && cornerError < tolerance * 1.5) return result('rectangle', [...corners, corners[0]]);
  const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2, radius = (w + h) / 4;
  metrics.circleAspect = w / h;
  metrics.circleLengthRatio = length / (2 * Math.PI * radius);
  if (w / h < .8 || w / h > 1.25 || length / (2 * Math.PI * radius) < .85 || length / (2 * Math.PI * radius) > 1.15) return reject('rectangle-and-circle-proportions');
  const radialError = Math.max(...samples.map(p => Math.abs(Math.hypot(p[0] - cx, p[1] - cy) - radius)));
  metrics.circleRadialErrorRatio = radialError / radius;
  if (radialError >= radius * .15) return reject('rectangle-and-circle-deviation');
  const bins = new Set(samples.map(p => Math.floor((Math.atan2(p[1] - cy, p[0] - cx) + Math.PI) / (2 * Math.PI) * 12) % 12));
  metrics.circleBins = bins.size;
  if (bins.size !== 12) return reject('incomplete-circle');
  return result('circle', Array.from({ length: 65 }, (_, i) => [cx + radius * Math.cos(i * Math.PI / 32), cy + radius * Math.sin(i * Math.PI / 32)]));
}
