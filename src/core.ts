export type Point = [number, number, number | null, number];
export interface Stroke { id: string; pointerType: string; interrupted: boolean; points: Point[]; pressureGain?: number; kind?: 'pen' | 'highlighter'; color?: string; size?: number }
export interface Snapshot {
  probeFormat: 1;
  runId: string;
  sourceHash: string;
  revision: number;
  parentHash: string | null;
  strokes: Stroke[];
}
export const LIMITS = { strokes: 200, pointsPerStroke: 10000, totalPoints: 100000, jsonChars: 8000000 };
export const validId = (s: unknown): s is string => typeof s === 'string' && /^[a-zA-Z0-9-]{1,80}$/.test(s);
export const uniqueId = (): string => globalThis.crypto?.randomUUID?.() ?? `probe-${Date.now()}-${Math.random().toString(36).slice(2)}`;
const hashPattern = /^[a-f0-9]{64}$/;

export function parseSnapshot(raw: string, runId: string, sourceHash: string): Snapshot {
  if (raw.length > LIMITS.jsonChars) throw new Error('快照过大，停止读取');
  const v = JSON.parse(raw) as Snapshot;
  if (!v || v.probeFormat !== 1 || v.runId !== runId || v.sourceHash !== sourceHash ||
      !Number.isSafeInteger(v.revision) || v.revision < 1 ||
      !(v.parentHash === null || (typeof v.parentHash === 'string' && hashPattern.test(v.parentHash))) ||
      !Array.isArray(v.strokes) || v.strokes.length > LIMITS.strokes) throw new Error('快照格式、版本或 PDF 身份不匹配');
  const ids = new Set<string>();
  let total = 0;
  for (const s of v.strokes) {
    if (!s || !validId(s.id) || ids.has(s.id) || !['pen', 'mouse'].includes(s.pointerType) ||
        typeof s.interrupted !== 'boolean' || !Array.isArray(s.points) || !s.points.length ||
        s.points.length > LIMITS.pointsPerStroke) throw new Error('笔迹结构无效');
    ids.add(s.id);
    if (s.kind !== undefined && s.kind !== 'pen' && s.kind !== 'highlighter') throw new Error('笔类型无效');
    if (s.color !== undefined && (typeof s.color !== 'string' || !/^#[0-9a-fA-F]{6}$/.test(s.color))) throw new Error('颜色无效');
    if (s.size !== undefined && (!Number.isFinite(s.size) || s.size < 0.5 || s.size > 3)) throw new Error('笔画尺寸无效');
    if (s.pressureGain !== undefined && (!Number.isFinite(s.pressureGain) || s.pressureGain < 1 || s.pressureGain > 4)) throw new Error('压感增益无效');
    let lastTime = -1;
    for (const p of s.points) {
      if (!Array.isArray(p) || p.length !== 4 || !Number.isFinite(p[0]) || !Number.isFinite(p[1]) ||
          Math.abs(p[0]) > 100000 || Math.abs(p[1]) > 100000 ||
          !(p[2] === null || (Number.isFinite(p[2]) && p[2] >= 0 && p[2] <= 1)) ||
          !Number.isFinite(p[3]) || p[3] < 0 || p[3] < lastTime) throw new Error('笔迹点无效');
      lastTime = p[3];
    }
    total += s.points.length;
  }
  if (total > LIMITS.totalPoints) throw new Error('超过探针点数上限');
  return v;
}

export function pdfPoint(transform: number[], u: number, v: number): [number, number] {
  if (transform.length !== 6 || !transform.every(Number.isFinite)) throw new Error('无效 viewport');
  const [a, b, c, d, e, f] = transform;
  const det = a * d - b * c;
  if (Math.abs(det) < 1e-12) throw new Error('不可逆 viewport');
  return [(d * (u - e) - c * (v - f)) / det, (-b * (u - e) + a * (v - f)) / det];
}

export async function sha256(bytes: Uint8Array): Promise<string> {
  if (!globalThis.crypto?.subtle) throw new Error('此 WebView 缺少 crypto.subtle；为避免误关联，探针停止写入');
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, '0')).join('');
}
export const textHash = (text: string) => sha256(new TextEncoder().encode(text));

export function penWidth(p: Point, gain = 1): number {
  return p[2] === null ? 1.8 : 0.8 + Math.min(1, Math.max(0, p[2] * gain)) * 3;
}
export function strokeWidth(s: Stroke, p: Point): number {
  return (s.kind === 'highlighter' ? 12 : penWidth(p, s.pressureGain)) * (s.size ?? 1);
}

/** Capsule hit-test between consecutive eraser positions and stroke segments. */
export function hitsStroke(stroke: Stroke, from: [number, number], to: [number, number], radius: number): boolean {
  type XY = { 0: number; 1: number };
  const pointDistance = (p: XY, a: XY, b: XY) => {
    const dx = b[0] - a[0], dy = b[1] - a[1];
    const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / (dx * dx + dy * dy || 1)));
    return Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dy);
  };
  const cross = (a: XY, b: XY, p: XY) => (b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0]);
  for (let i = 0; i < stroke.points.length; i++) {
    const a = stroke.points[Math.max(0, i - 1)], b = stroke.points[i];
    const intersects = cross(from, to, a) * cross(from, to, b) < 0 && cross(a, b, from) * cross(a, b, to) < 0;
    const distance = Math.min(pointDistance(a, from, to), pointDistance(b, from, to), pointDistance(from, a, b), pointDistance(to, a, b));
    if (intersects || distance <= radius + Math.max(strokeWidth(stroke, a), strokeWidth(stroke, b)) / 2) return true;
  }
  return false;
}

export interface ProbeFiles {
  list(): Promise<string[]>;
  read(path: string): Promise<string>;
  create(path: string, text: string): Promise<void>;
}

// shortcut: history is bounded and session-only; persisted undo is outside this stage.
export class EditHistory {
  private past: { before: Stroke[]; after: Stroke[] }[] = [];
  private future: { before: Stroke[]; after: Stroke[] }[] = [];
  get undoDepth(): number { return this.past.length; }
  get redoDepth(): number { return this.future.length; }
  record(before: Stroke[], after: Stroke[]): void {
    this.past.push({ before: before.slice(), after: after.slice() });
    this.future = [];
    while (this.past.length > 20 || this.retainedPoints() > 200000) this.past.shift();
  }
  private retainedPoints(): number {
    const strokes = new Set(this.past.flatMap(e => [...e.before, ...e.after]));
    return [...strokes].reduce((n, s) => n + s.points.length, 0);
  }
  undo(current: Stroke[]): Stroke[] {
    const e = this.past.pop();
    if (!e) return current;
    this.future.push(e); return e.before.slice();
  }
  redo(current: Stroke[]): Stroke[] {
    const e = this.future.pop();
    if (!e) return current;
    this.past.push(e); return e.after.slice();
  }
}
// shortcut: cumulative immutable snapshots cost space; replace after T3 fault-tested journal exists.
export class ProbeStore {
  revision = 0;
  baseline: string | null = null;
  private pending: { path: string; raw: string; snapshot: Snapshot; editVersion: number } | null = null;
  constructor(private files: ProbeFiles, readonly runId: string, readonly sourceHash: string) {
    if (!validId(runId) || !hashPattern.test(sourceHash)) throw new Error('无效测试身份');
  }
  async load(): Promise<Stroke[]> {
    const paths = (await this.files.list()).sort();
    let revision = 0, parent: string | null = null;
    let strokes: Stroke[] = [];
    for (const path of paths) {
      const raw = await this.files.read(path);
      const snapshot = parseSnapshot(raw, this.runId, this.sourceHash);
      if (snapshot.revision !== revision + 1 || snapshot.parentHash !== parent) throw new Error('快照链断裂或同步冲突；保留全部文件，停止写入');
      revision = snapshot.revision;
      parent = await textHash(raw);
      strokes = snapshot.strokes;
    }
    this.revision = revision;
    this.baseline = parent;
    return strokes;
  }
  async save(strokes: Stroke[], editVersion = 0): Promise<{ count: number; editVersion: number }> {
    if (!this.pending) {
      const check = new ProbeStore(this.files, this.runId, this.sourceHash);
      await check.load();
      if (check.baseline !== this.baseline) throw new Error('磁盘已被其他会话修改；停止写入，请保留本次诊断');
      const snapshot: Snapshot = { probeFormat: 1, runId: this.runId, sourceHash: this.sourceHash,
        revision: this.revision + 1, parentHash: this.baseline, strokes };
      const raw = JSON.stringify(snapshot);
      const frozen = parseSnapshot(raw, this.runId, this.sourceHash);
      this.pending = { path: `${String(snapshot.revision).padStart(6, '0')}-${uniqueId()}.json`, raw, snapshot: frozen, editVersion };
    }
    const p = this.pending;
    if (!(await this.files.list()).includes(p.path)) await this.files.create(p.path, p.raw);
    if (await this.files.read(p.path) !== p.raw) throw new Error('快照读回校验失败；原始文件已保留');
    const check = new ProbeStore(this.files, this.runId, this.sourceHash);
    await check.load();
    if (check.baseline !== await textHash(p.raw)) throw new Error('保存期间出现并发版本；保留双方文件');
    this.baseline = check.baseline;
    this.revision = check.revision;
    this.pending = null;
    return { count: p.snapshot.strokes.length, editVersion: p.editVersion };
  }
}
