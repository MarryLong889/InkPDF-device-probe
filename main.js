"use strict";
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/main.ts
var main_exports = {};
__export(main_exports, {
  default: () => InkPDFProbe
});
module.exports = __toCommonJS(main_exports);
var import_obsidian = require("obsidian");

// src/core.ts
var LIMITS = { strokes: 200, pointsPerStroke: 1e4, totalPoints: 1e5, jsonChars: 8e6 };
var validId = (s) => typeof s === "string" && /^[a-zA-Z0-9-]{1,80}$/.test(s);
var uniqueId = () => globalThis.crypto?.randomUUID?.() ?? `probe-${Date.now()}-${Math.random().toString(36).slice(2)}`;
var hashPattern = /^[a-f0-9]{64}$/;
function parseSnapshot(raw, runId, sourceHash) {
  if (raw.length > LIMITS.jsonChars) throw new Error("\u5FEB\u7167\u8FC7\u5927\uFF0C\u505C\u6B62\u8BFB\u53D6");
  const v = JSON.parse(raw);
  if (!v || v.probeFormat !== 1 || v.runId !== runId || v.sourceHash !== sourceHash || !Number.isSafeInteger(v.revision) || v.revision < 1 || !(v.parentHash === null || typeof v.parentHash === "string" && hashPattern.test(v.parentHash)) || !Array.isArray(v.strokes) || v.strokes.length > LIMITS.strokes) throw new Error("\u5FEB\u7167\u683C\u5F0F\u3001\u7248\u672C\u6216 PDF \u8EAB\u4EFD\u4E0D\u5339\u914D");
  const ids = /* @__PURE__ */ new Set();
  let total = 0;
  for (const s of v.strokes) {
    if (!s || !validId(s.id) || ids.has(s.id) || !["pen", "mouse"].includes(s.pointerType) || typeof s.interrupted !== "boolean" || !Array.isArray(s.points) || !s.points.length || s.points.length > LIMITS.pointsPerStroke) throw new Error("\u7B14\u8FF9\u7ED3\u6784\u65E0\u6548");
    ids.add(s.id);
    if (s.kind !== void 0 && s.kind !== "pen" && s.kind !== "highlighter") throw new Error("\u7B14\u7C7B\u578B\u65E0\u6548");
    if (s.color !== void 0 && (typeof s.color !== "string" || !/^#[0-9a-fA-F]{6}$/.test(s.color))) throw new Error("\u989C\u8272\u65E0\u6548");
    if (s.size !== void 0 && (!Number.isFinite(s.size) || s.size < 0.5 || s.size > 3)) throw new Error("\u7B14\u753B\u5C3A\u5BF8\u65E0\u6548");
    if (s.pressureGain !== void 0 && (!Number.isFinite(s.pressureGain) || s.pressureGain < 1 || s.pressureGain > 4)) throw new Error("\u538B\u611F\u589E\u76CA\u65E0\u6548");
    let lastTime = -1;
    for (const p of s.points) {
      if (!Array.isArray(p) || p.length !== 4 || !Number.isFinite(p[0]) || !Number.isFinite(p[1]) || Math.abs(p[0]) > 1e5 || Math.abs(p[1]) > 1e5 || !(p[2] === null || Number.isFinite(p[2]) && p[2] >= 0 && p[2] <= 1) || !Number.isFinite(p[3]) || p[3] < 0 || p[3] < lastTime) throw new Error("\u7B14\u8FF9\u70B9\u65E0\u6548");
      lastTime = p[3];
    }
    total += s.points.length;
  }
  if (total > LIMITS.totalPoints) throw new Error("\u8D85\u8FC7\u63A2\u9488\u70B9\u6570\u4E0A\u9650");
  return v;
}
function pdfPoint(transform, u, v) {
  if (transform.length !== 6 || !transform.every(Number.isFinite)) throw new Error("\u65E0\u6548 viewport");
  const [a, b, c, d, e, f] = transform;
  const det = a * d - b * c;
  if (Math.abs(det) < 1e-12) throw new Error("\u4E0D\u53EF\u9006 viewport");
  return [(d * (u - e) - c * (v - f)) / det, (-b * (u - e) + a * (v - f)) / det];
}
async function sha256(bytes) {
  if (!globalThis.crypto?.subtle) throw new Error("\u6B64 WebView \u7F3A\u5C11 crypto.subtle\uFF1B\u4E3A\u907F\u514D\u8BEF\u5173\u8054\uFF0C\u63A2\u9488\u505C\u6B62\u5199\u5165");
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}
var textHash = (text) => sha256(new TextEncoder().encode(text));
function penWidth(p, gain = 1) {
  return p[2] === null ? 1.8 : 0.8 + Math.min(1, Math.max(0, p[2] * gain)) * 3;
}
function strokeWidth(s, p) {
  return (s.kind === "highlighter" ? 12 : penWidth(p, s.pressureGain)) * (s.size ?? 1);
}
function hitsStroke(stroke, from, to, radius) {
  const pointDistance = (p, a, b) => {
    const dx = b[0] - a[0], dy = b[1] - a[1];
    const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / (dx * dx + dy * dy || 1)));
    return Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dy);
  };
  const cross = (a, b, p) => (b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0]);
  for (let i = 0; i < stroke.points.length; i++) {
    const a = stroke.points[Math.max(0, i - 1)], b = stroke.points[i];
    const intersects = cross(from, to, a) * cross(from, to, b) < 0 && cross(a, b, from) * cross(a, b, to) < 0;
    const distance = Math.min(pointDistance(a, from, to), pointDistance(b, from, to), pointDistance(from, a, b), pointDistance(to, a, b));
    if (intersects || distance <= radius + Math.max(strokeWidth(stroke, a), strokeWidth(stroke, b)) / 2) return true;
  }
  return false;
}
var EditHistory = class {
  past = [];
  future = [];
  get undoDepth() {
    return this.past.length;
  }
  get redoDepth() {
    return this.future.length;
  }
  record(before, after) {
    this.past.push({ before: before.slice(), after: after.slice() });
    this.future = [];
    while (this.past.length > 20 || this.retainedPoints() > 2e5) this.past.shift();
  }
  retainedPoints() {
    const strokes = new Set(this.past.flatMap((e) => [...e.before, ...e.after]));
    return [...strokes].reduce((n, s) => n + s.points.length, 0);
  }
  undo(current) {
    const e = this.past.pop();
    if (!e) return current;
    this.future.push(e);
    return e.before.slice();
  }
  redo(current) {
    const e = this.future.pop();
    if (!e) return current;
    this.past.push(e);
    return e.after.slice();
  }
};
var ProbeStore = class _ProbeStore {
  constructor(files, runId, sourceHash) {
    this.files = files;
    this.runId = runId;
    this.sourceHash = sourceHash;
    if (!validId(runId) || !hashPattern.test(sourceHash)) throw new Error("\u65E0\u6548\u6D4B\u8BD5\u8EAB\u4EFD");
  }
  files;
  runId;
  sourceHash;
  revision = 0;
  baseline = null;
  pending = null;
  async load() {
    const paths = (await this.files.list()).sort();
    let revision = 0, parent = null;
    let strokes = [];
    for (const path of paths) {
      const raw = await this.files.read(path);
      const snapshot = parseSnapshot(raw, this.runId, this.sourceHash);
      if (snapshot.revision !== revision + 1 || snapshot.parentHash !== parent) throw new Error("\u5FEB\u7167\u94FE\u65AD\u88C2\u6216\u540C\u6B65\u51B2\u7A81\uFF1B\u4FDD\u7559\u5168\u90E8\u6587\u4EF6\uFF0C\u505C\u6B62\u5199\u5165");
      revision = snapshot.revision;
      parent = await textHash(raw);
      strokes = snapshot.strokes;
    }
    this.revision = revision;
    this.baseline = parent;
    return strokes;
  }
  async save(strokes, editVersion = 0) {
    if (!this.pending) {
      const check2 = new _ProbeStore(this.files, this.runId, this.sourceHash);
      await check2.load();
      if (check2.baseline !== this.baseline) throw new Error("\u78C1\u76D8\u5DF2\u88AB\u5176\u4ED6\u4F1A\u8BDD\u4FEE\u6539\uFF1B\u505C\u6B62\u5199\u5165\uFF0C\u8BF7\u4FDD\u7559\u672C\u6B21\u8BCA\u65AD");
      const snapshot = {
        probeFormat: 1,
        runId: this.runId,
        sourceHash: this.sourceHash,
        revision: this.revision + 1,
        parentHash: this.baseline,
        strokes
      };
      const raw = JSON.stringify(snapshot);
      const frozen = parseSnapshot(raw, this.runId, this.sourceHash);
      this.pending = { path: `${String(snapshot.revision).padStart(6, "0")}-${uniqueId()}.json`, raw, snapshot: frozen, editVersion };
    }
    const p = this.pending;
    if (!(await this.files.list()).includes(p.path)) await this.files.create(p.path, p.raw);
    if (await this.files.read(p.path) !== p.raw) throw new Error("\u5FEB\u7167\u8BFB\u56DE\u6821\u9A8C\u5931\u8D25\uFF1B\u539F\u59CB\u6587\u4EF6\u5DF2\u4FDD\u7559");
    const check = new _ProbeStore(this.files, this.runId, this.sourceHash);
    await check.load();
    if (check.baseline !== await textHash(p.raw)) throw new Error("\u4FDD\u5B58\u671F\u95F4\u51FA\u73B0\u5E76\u53D1\u7248\u672C\uFF1B\u4FDD\u7559\u53CC\u65B9\u6587\u4EF6");
    this.baseline = check.baseline;
    this.revision = check.revision;
    this.pending = null;
    return { count: p.snapshot.strokes.length, editVersion: p.editVersion };
  }
};

// src/shapes.ts
function fitShape(raw) {
  if (raw.length < 5) return null;
  const distances = [0];
  for (let i = 1; i < raw.length; i++) distances.push(distances[i - 1] + Math.hypot(raw[i][0] - raw[i - 1][0], raw[i][1] - raw[i - 1][1]));
  const length = distances.at(-1);
  if (length < 30) return null;
  const samples = [];
  let j = 1;
  for (let i = 0; i <= 64; i++) {
    const d = length * i / 64;
    while (j < raw.length - 1 && distances[j] < d) j++;
    const t = (d - distances[j - 1]) / (distances[j] - distances[j - 1] || 1);
    samples.push([raw[j - 1][0] + t * (raw[j][0] - raw[j - 1][0]), raw[j - 1][1] + t * (raw[j][1] - raw[j - 1][1])]);
  }
  const first = samples[0], last = samples.at(-1);
  const chord = Math.hypot(last[0] - first[0], last[1] - first[1]);
  const pressure = raw.reduce((n, p) => n + (p[2] ?? 0.3), 0) / raw.length;
  const result = (kind, xy) => ({ kind, points: xy.map((p, i) => [p[0], p[1], pressure, raw.at(-1)[3] * i / (xy.length - 1)]) });
  if (chord >= 30 && length / chord < 1.15 && samples.every((p) => Math.abs((p[0] - first[0]) * (last[1] - first[1]) - (p[1] - first[1]) * (last[0] - first[0])) / chord < Math.max(3, chord * 0.045))) return result("line", [first, last]);
  const xs = samples.map((p) => p[0]), ys = samples.map((p) => p[1]);
  const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
  const w = x1 - x0, h = y1 - y0;
  if (Math.min(w, h) < 20 || chord > Math.min(w, h) * 0.25) return null;
  const perimeter = 2 * (w + h);
  const corners = [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
  const tolerance = Math.min(w, h) * 0.12;
  if (length / perimeter > 0.85 && length / perimeter < 1.15 && samples.every((p) => Math.min(p[0] - x0, x1 - p[0], p[1] - y0, y1 - p[1]) < tolerance) && corners.every((c) => samples.some((p) => Math.hypot(p[0] - c[0], p[1] - c[1]) < tolerance * 1.5))) return result("rectangle", [...corners, corners[0]]);
  const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2, radius = (w + h) / 4;
  if (w / h < 0.8 || w / h > 1.25 || length / (2 * Math.PI * radius) < 0.85 || length / (2 * Math.PI * radius) > 1.15) return null;
  if (!samples.every((p) => Math.abs(Math.hypot(p[0] - cx, p[1] - cy) - radius) < radius * 0.15)) return null;
  const bins = new Set(samples.map((p) => Math.floor((Math.atan2(p[1] - cy, p[0] - cx) + Math.PI) / (2 * Math.PI) * 12) % 12));
  if (bins.size !== 12) return null;
  return result("circle", Array.from({ length: 65 }, (_, i) => [cx + radius * Math.cos(i * Math.PI / 32), cy + radius * Math.sin(i * Math.PI / 32)]));
}

// src/capabilities.ts
async function workerProbe() {
  if (typeof Worker === "undefined") return { status: "FAIL", error: "Worker unavailable" };
  const code = `onmessage = async e => {
    try {
      const m = await WebAssembly.instantiate(new Uint8Array([0,97,115,109,1,0,0,0]));
      postMessage({ token: e.data, wasm: !!m.instance, moduleWorker: true });
    } catch (e) { postMessage({ token: e.data, wasm: false, error: String(e) }); }
  }`;
  const url = URL.createObjectURL(new Blob([code], { type: "application/javascript" }));
  let worker;
  let timer;
  const started = performance.now();
  try {
    worker = new Worker(url, { type: "module", name: "inkpdf-probe" });
    const w = worker;
    return await new Promise((resolve, reject) => {
      timer = window.setTimeout(() => reject(new Error("Worker timeout after 5s")), 5e3);
      w.onerror = () => reject(new Error("Blob module Worker failed"));
      w.onmessageerror = () => reject(new Error("Worker message decode failed"));
      w.onmessage = (e) => {
        if (e.data?.token !== "inkpdf-ping-v1") return;
        resolve({ status: e.data.wasm ? "PASS" : "FAIL", ...e.data, elapsedMs: Math.round(performance.now() - started) });
      };
      w.postMessage("inkpdf-ping-v1");
    });
  } catch (error) {
    return { status: "FAIL", error: String(error) };
  } finally {
    window.clearTimeout(timer);
    worker?.terminate();
    URL.revokeObjectURL(url);
  }
}

// src/generated/fixture.ts
var PDF_BASE64 = "JVBERi0xLjMKJZOMi54gUmVwb3J0TGFiIEdlbmVyYXRlZCBQREYgZG9jdW1lbnQgKG9wZW5zb3VyY2UpCjEgMCBvYmoKPDwKL0YxIDIgMCBSIC9GMiAzIDAgUgo+PgplbmRvYmoKMiAwIG9iago8PAovQmFzZUZvbnQgL0hlbHZldGljYSAvRW5jb2RpbmcgL1dpbkFuc2lFbmNvZGluZyAvTmFtZSAvRjEgL1N1YnR5cGUgL1R5cGUxIC9UeXBlIC9Gb250Cj4+CmVuZG9iagozIDAgb2JqCjw8Ci9CYXNlRm9udCAvSGVsdmV0aWNhLUJvbGQgL0VuY29kaW5nIC9XaW5BbnNpRW5jb2RpbmcgL05hbWUgL0YyIC9TdWJ0eXBlIC9UeXBlMSAvVHlwZSAvRm9udAo+PgplbmRvYmoKNCAwIG9iago8PAovQ29udGVudHMgOCAwIFIgL01lZGlhQm94IFsgMCAwIDU5NSA4NDIgXSAvUGFyZW50IDcgMCBSIC9SZXNvdXJjZXMgPDwKL0ZvbnQgMSAwIFIgL1Byb2NTZXQgWyAvUERGIC9UZXh0IC9JbWFnZUIgL0ltYWdlQyAvSW1hZ2VJIF0KPj4gL1JvdGF0ZSAwIC9UcmFucyA8PAoKPj4gCiAgL1R5cGUgL1BhZ2UKPj4KZW5kb2JqCjUgMCBvYmoKPDwKL1BhZ2VNb2RlIC9Vc2VOb25lIC9QYWdlcyA3IDAgUiAvVHlwZSAvQ2F0YWxvZwo+PgplbmRvYmoKNiAwIG9iago8PAovQXV0aG9yIChhbm9ueW1vdXMpIC9DcmVhdGlvbkRhdGUgKEQ6MjAwMDAxMDEwMDAwMDArMDAnMDAnKSAvQ3JlYXRvciAoYW5vbnltb3VzKSAvS2V5d29yZHMgKCkgL01vZERhdGUgKEQ6MjAwMDAxMDEwMDAwMDArMDAnMDAnKSAvUHJvZHVjZXIgKFJlcG9ydExhYiBQREYgTGlicmFyeSAtIFwob3BlbnNvdXJjZVwpKSAKICAvU3ViamVjdCAodW5zcGVjaWZpZWQpIC9UaXRsZSAoSW5rUERGIHN5bnRoZXRpYyBkZXZpY2UgcHJvYmUpIC9UcmFwcGVkIC9GYWxzZQo+PgplbmRvYmoKNyAwIG9iago8PAovQ291bnQgMSAvS2lkcyBbIDQgMCBSIF0gL1R5cGUgL1BhZ2VzCj4+CmVuZG9iago4IDAgb2JqCjw8Ci9GaWx0ZXIgWyAvQVNDSUk4NURlY29kZSAvRmxhdGVEZWNvZGUgXSAvTGVuZ3RoIDYwNwo+PgpzdHJlYW0KR2FyVzdoLzpxMyY0Wiw2TVhSalFnPEtXT2M8VUtHPE4tYz9xdVZuYiUxXjNEW1tYXicrMjVAJlpWMUtnTWFkc0xib0dASmk7UCVeSFtQbl45QURXOCNgOCsiS091LmEldCNyRk9cPGQ6VjU3R0AmUiRBLzM2RD1lSHVKY0ZlSDxObmprY0hbQEdRLWdtTl1qalBiMWpCbWlsM1dgVDZcS0NMYylsRGBkQ0JmW0xibzBdSDF0NCEzOiUzNGFTJmc/S0VIPW1PayxIWz1TJkw/VS4nZVE5TC8zSk9nLXAyNDlqPGM9IixqMTsiJCk0IT9jbik8I3BtXmxvWzxEPlwzJyQ+NyE+bDBecG81Mm0wQUFMODkwTGolSCgjJ1YsS0dESGFAN3RVJkUnXl5tLVFLLUIyQDE9W283VjE6UHJSYCFTWnRwbDtrLC8oJlpoMW1WTnM4R0MyMGAzVjVCUD49X19cY1AsNGs8LTxWNyVCcCw8ZFE4VmxMQzImbS5WM1gjQj4mJ0hPYkE9VXRfTE8oYk4xJ1piUEpda0w+Zkw2IWVxX20vcFhCdXNRXVtGPWtjW1wiRmhFNktqPlFmalUjbj4wMTZROkdSMCxnISx1R0kuN0diZT9ibC5DYCF0JVUoJ1JVcnVXK3VKQjI1TWxYIytYXGlKRU9SIWVlQXQlYkpaKm0uPDlSQXFhRmI8bWU+dSJsTURZYjRMWWckL29danNeVVdAPiMxbT9FPGpmUG4uMUg0Tl81NzBKZmxvci5JSWw3JFwpPG1oOCI0Q3Q3ZlA+QEg9UUllJGolOjJ+PmVuZHN0cmVhbQplbmRvYmoKeHJlZgowIDkKMDAwMDAwMDAwMCA2NTUzNSBmIAowMDAwMDAwMDYxIDAwMDAwIG4gCjAwMDAwMDAxMDIgMDAwMDAgbiAKMDAwMDAwMDIwOSAwMDAwMCBuIAowMDAwMDAwMzIxIDAwMDAwIG4gCjAwMDAwMDA1MTQgMDAwMDAgbiAKMDAwMDAwMDU4MiAwMDAwMCBuIAowMDAwMDAwODY0IDAwMDAwIG4gCjAwMDAwMDA5MjMgMDAwMDAgbiAKdHJhaWxlcgo8PAovSUQgCls8YTZmYWJjODZjMWIwMzVmZjU5NmM0MjE1MDhlMmVmM2Y+PGE2ZmFiYzg2YzFiMDM1ZmY1OTZjNDIxNTA4ZTJlZjNmPl0KJSBSZXBvcnRMYWIgZ2VuZXJhdGVkIFBERiBkb2N1bWVudCAtLSBkaWdlc3QgKG9wZW5zb3VyY2UpCgovSW5mbyA2IDAgUgovUm9vdCA1IDAgUgovU2l6ZSA5Cj4+CnN0YXJ0eHJlZgoxNjIwCiUlRU9GCg==";

// src/main.ts
var VIEW = "inkpdf-device-probe";
var ROOT = "InkPDF-Probe";
var InkPDFProbe = class extends import_obsidian.Plugin {
  lastRun = null;
  lastPdfPath = null;
  lastPage = 1;
  opening = false;
  async remember() {
    await this.saveData({ lastRun: this.lastRun, lastPdfPath: this.lastPdfPath, lastPage: this.lastPage });
  }
  choosePdf() {
    const plugin = this;
    new class extends import_obsidian.FuzzySuggestModal {
      getItems() {
        return plugin.app.vault.getFiles().filter((f) => f.extension.toLowerCase() === "pdf");
      }
      getItemText(file) {
        return file.path;
      }
      onChooseItem(file) {
        void plugin.open(true, file.path).catch((e) => new import_obsidian.Notice(String(e)));
      }
    }(this.app).open();
  }
  async onload() {
    try {
      const data = await this.loadData();
      if (validId(data?.lastRun)) this.lastRun = data.lastRun;
      if (typeof data?.lastPdfPath === "string" && data.lastPdfPath.toLowerCase().endsWith(".pdf")) this.lastPdfPath = data.lastPdfPath;
      if (Number.isSafeInteger(data?.lastPage) && data.lastPage > 0) this.lastPage = data.lastPage;
    } catch {
      new import_obsidian.Notice("InkPDF\uFF1A\u8BBE\u7F6E\u8BFB\u53D6\u5931\u8D25\uFF0C\u53EF\u65B0\u5EFA\u6D4B\u8BD5\uFF1B\u672A\u5220\u9664\u65E7\u6D4B\u8BD5\u6587\u4EF6");
    }
    this.registerView(VIEW, (leaf) => new ProbeView(leaf, this));
    this.addCommand({ id: "open", name: "\u6253\u5F00 / \u7EE7\u7EED\u8BBE\u5907\u63A2\u9488", callback: () => {
      void this.open(false).catch((e) => new import_obsidian.Notice(String(e)));
    } });
    this.addCommand({ id: "new-run", name: "\u65B0\u5EFA\u72EC\u7ACB\u8BBE\u5907\u6D4B\u8BD5", callback: () => {
      void this.open(true).catch((e) => new import_obsidian.Notice(String(e)));
    } });
    this.addCommand({ id: "open-pdf", name: "\u6253\u5F00\u4ED3\u5E93 PDF", callback: () => this.choosePdf() });
    this.addCommand({ id: "toggle-pen-eraser", name: "\u5207\u6362\u94A2\u7B14 / \u6A61\u76AE\u64E6", callback: () => {
      const view = this.app.workspace.getLeavesOfType(VIEW)[0]?.view;
      if (view instanceof ProbeView) view.toggleTool();
    } });
    this.addRibbonIcon("pen-tool", "InkPDF \u8BBE\u5907\u63A2\u9488", () => {
      void this.open(false).catch((e) => new import_obsidian.Notice(String(e)));
    });
  }
  async open(fresh, pdfPath, page = 1) {
    if (this.opening) return;
    this.opening = true;
    try {
      const old = this.app.workspace.getLeavesOfType(VIEW);
      if (old.length && !fresh) {
        await this.app.workspace.revealLeaf(old[0]);
        return;
      }
      for (const leaf2 of old) {
        if (leaf2.view instanceof ProbeView) await leaf2.view.prepareNavigation();
        leaf2.detach();
      }
      if (fresh || !this.lastRun) {
        this.lastRun = uniqueId();
        if (fresh) this.lastPdfPath = pdfPath ?? null;
        if (fresh) this.lastPage = Number.isSafeInteger(page) && page > 0 ? page : 1;
        await this.remember();
      }
      const leaf = this.app.workspace.getLeaf("tab");
      await leaf.setViewState({ type: VIEW, active: true });
      await this.app.workspace.revealLeaf(leaf);
    } finally {
      this.opening = false;
    }
  }
};
var PageState = class {
  constructor(number) {
    this.number = number;
  }
  number;
  loading;
  rendered = false;
  runId = "";
  store = void 0;
  strokes = [];
  savedCount = 0;
  editVersion = 0;
  savedEditVersion = 0;
  history = new EditHistory();
  totalPoints = 0;
  saveTimer = void 0;
  saveDue = 0;
  page = void 0;
  viewport = void 0;
  renderTask = void 0;
  renderGeneration = 0;
  ready = false;
  dpr = 1;
  saveTask = void 0;
  saveError = "";
  sheet = void 0;
  pdfCanvas = void 0;
  ink = void 0;
  committedInk = void 0;
};
var ProbeView = class extends import_obsidian.ItemView {
  constructor(leaf, plugin) {
    super(leaf);
    this.plugin = plugin;
    this.pdfPath = plugin.lastPdfPath;
    this.pageNumber = this.pdfPath ? plugin.lastPage : 1;
  }
  plugin;
  pages = /* @__PURE__ */ new Map();
  current = new PageState(1);
  refreshTask;
  sourceHash = "";
  shapeTimer;
  shapeAnchor;
  fitted;
  shapeCounts = {};
  active;
  erasing;
  undoButton;
  redoButton;
  tool = "pen";
  color = "#155ac4";
  size = 1;
  toolButton;
  pageNumber;
  navigating = false;
  prevButton;
  nextButton;
  pageLabel;
  pressureGain = 2.5;
  touches = /* @__PURE__ */ new Set();
  pan;
  lastPenAt = -Infinity;
  touchDiagnostics = { moves: 0, blockedPen: 0, blockedMulti: 0, cooldownMoves: 0, maxContact: 0, scrollChanges: 0 };
  frame = 0;
  paintedPoints = 0;
  renderedWidth = 0;
  pdf;
  pdfTask;
  closed = false;
  mode = "write";
  zoom = 1;
  status;
  capability;
  scroll;
  inputStatus;
  timings = { paints: 0, maxPaintMs: 0, saves: 0, maxSaveMs: 0, maxEventGapMs: 0 };
  endings = [];
  lastSampleTime = 0;
  errors = [];
  pointerStats = {
    penDown: 0,
    mouseDown: 0,
    touchDown: 0,
    canceled: 0,
    coalescedSamples: 0,
    pressureMin: null,
    pressureMax: null,
    penSamples: 0,
    lostCapture: 0,
    captureFailed: 0,
    touchPanMoves: 0,
    ignoredTouches: 0
  };
  report = {};
  pdfPath;
  async prepareNavigation() {
    this.navigating = true;
    try {
      await this.flush();
    } catch (e) {
      this.navigating = false;
      throw e;
    }
  }
  toggleTool() {
    if (!this.current.ready || this.navigating) return;
    this.finish("tool-change");
    this.tool = this.tool === "pen" ? "eraser" : "pen";
    this.toolButton.textContent = this.tool === "pen" ? "\u94A2\u7B14" : "\u6A61\u76AE";
    this.toolButton.setAttribute("aria-label", this.tool === "pen" ? "\u5DE5\u5177\uFF1A\u94A2\u7B14" : "\u5DE5\u5177\uFF1A\u6574\u7B14\u6A61\u76AE");
  }
  getViewType() {
    return VIEW;
  }
  getDisplayText() {
    return "InkPDF \u8BBE\u5907\u63A2\u9488";
  }
  getIcon() {
    return "pen-tool";
  }
  button(parent, text, fn) {
    const b = parent.createEl("button", { text, attr: { "aria-label": text, title: text } });
    b.addEventListener("click", () => {
      void Promise.resolve().then(fn).catch((e) => this.fail(e));
    });
    return b;
  }
  fail(error) {
    const message = String(error);
    this.errors.push(message.slice(0, 400));
    this.errors = this.errors.slice(-20);
    this.status.textContent = `\u5931\u8D25\uFF1A${message}\u3002\u6587\u4EF6\u4FDD\u7559\uFF1B\u8BF7\u5BFC\u51FA\u8BCA\u65AD\u3002`;
    new import_obsidian.Notice(`InkPDF\uFF1A${message}`, 8e3);
  }
  state() {
    if (!this.current.ready) return;
    const suffix = this.active || this.erasing ? "\u64CD\u4F5C\u4E2D\uFF0C\u62AC\u7B14\u540E\u4FDD\u5B58" : this.current.saveError ? `\u4FDD\u5B58\u5931\u8D25\uFF1A${this.current.saveError}` : this.current.savedEditVersion === this.current.editVersion ? `\u5DF2\u4FDD\u5B58\u5E76\u8BFB\u56DE\u6821\u9A8C \xB7 revision ${this.current.store?.revision ?? 0}` : "\u5C1A\u6709\u672A\u4FDD\u5B58\u7B14\u8FF9";
    const other = [...this.pages.values()].filter((p) => p !== this.current && (p.saveError || p.editVersion !== p.savedEditVersion));
    this.status.textContent = `${other.length ? `\u53E6 ${other.length} \u9875\u672A\u4FDD\u5B58 / \u5931\u8D25 \xB7 ` : ""}${this.current.strokes.length} \u7B14 / ${LIMITS.strokes} \xB7 ${suffix}`;
  }
  async folder(path) {
    if (!await this.app.vault.adapter.exists(path)) {
      try {
        await this.app.vault.createFolder(path);
      } catch (e) {
        if (!await this.app.vault.adapter.exists(path)) throw e;
      }
    }
  }
  async onOpen() {
    this.contentEl.empty();
    this.contentEl.addClass("inkpdf-probe");
    const controls = this.contentEl.createDiv({ cls: "inkpdf-probe-controls" });
    this.button(controls, "\u6253\u5F00\u4ED3\u5E93 PDF", () => this.plugin.choosePdf()).textContent = "\u6253\u5F00";
    const more = this.contentEl.createEl("details", { cls: "inkpdf-probe-more" });
    more.createEl("summary", { text: "\u66F4\u591A \xB7 \u8BBE\u7F6E\u4E0E\u8BCA\u65AD" });
    more.createEl("p", { text: "\u5173\u95ED iPad \u968F\u624B\u5199 / Scribble\u3002\u5355\u6307\u8FDE\u7EED\u6EDA\u52A8\uFF1B\u94A2\u7B14\u753B\u5B8C\u4FDD\u6301\u63A5\u89E6 1 \u79D2\u53EF\u62DF\u5408\u76F4\u7EBF\u3001\u6B63\u653E\u65B9\u6846\u6216\u5706\u3002\u64A4\u9500\u4E00\u6B21\u6062\u590D\u539F\u624B\u7ED8\uFF0C\u518D\u64A4\u9500\u5220\u9664\u3002\u539F PDF \u53EA\u8BFB\u3002\u7B14\u4F53\u53CC\u51FB\u6682\u4E0D\u652F\u6301\u3002" });
    const options = more.createDiv({ cls: "inkpdf-probe-options" });
    const sourceLabel = more.createDiv({ cls: "inkpdf-probe-source" });
    sourceLabel.textContent = this.pdfPath ? `${this.pdfPath} \xB7 \u539F\u6587\u4EF6\u53EA\u8BFB\uFF1B\u76F8\u540C\u5185\u5BB9\u526F\u672C\u5171\u4EAB\u9010\u9875\u7B14\u8FF9` : "\u5408\u6210 PDF \u8BBE\u5907\u6D4B\u8BD5";
    this.prevButton = this.button(options, "\u4E0A\u4E00\u9875", () => this.jump(this.pageNumber - 1));
    this.pageLabel = controls.createEl("span", { text: "\u52A0\u8F7D\u9875\u7801\u4E2D\u2026", attr: { role: "status" } });
    this.nextButton = this.button(options, "\u4E0B\u4E00\u9875", () => this.jump(this.pageNumber + 1));
    this.prevButton.disabled = this.nextButton.disabled = true;
    const modeButton = this.button(options, "\u6A21\u5F0F\uFF1A\u4E66\u5199", () => {
      this.finish("mode-change");
      this.pan = void 0;
      this.mode = this.mode === "write" ? "browse" : "write";
      modeButton.textContent = this.mode === "write" ? "\u6A21\u5F0F\uFF1A\u4E66\u5199" : "\u6A21\u5F0F\uFF1A\u6D4F\u89C8";
      for (const p of this.pages.values()) p.ink.style.touchAction = this.mode === "write" ? "none" : "pan-x pan-y";
      this.scroll.style.touchAction = this.mode === "write" ? "none" : "pan-x pan-y";
    });
    this.toolButton = this.button(controls, "\u5DE5\u5177\uFF1A\u94A2\u7B14", () => this.toggleTool());
    this.toolButton.textContent = "\u94A2\u7B14";
    this.button(controls, "\u8367\u5149\u7B14", () => {
      if (!this.current.ready || this.navigating) return;
      this.finish("tool-change");
      this.tool = "highlighter";
      this.toolButton.textContent = "\u8367\u5149";
      this.toolButton.setAttribute("aria-label", "\u5DE5\u5177\uFF1A\u8367\u5149\u7B14");
      this.color = "#f4d03f";
      color.value = this.color;
    });
    const colorLabel = controls.createEl("label", { cls: "inkpdf-probe-gain", text: "\u989C\u8272 " });
    const color = colorLabel.createEl("select", { attr: { "aria-label": "\u989C\u8272\uFF08\u53EA\u5F71\u54CD\u65B0\u7B14\u8FF9\uFF09" } });
    for (const [name, value] of [["\u84DD", "#155ac4"], ["\u9ED1", "#202020"], ["\u7EA2", "#d93025"], ["\u9EC4", "#f4d03f"], ["\u7EFF", "#16803c"]]) color.createEl("option", { text: name, attr: { value } });
    color.addEventListener("change", () => {
      this.finish("style-change");
      this.color = color.value;
    });
    const sizeLabel = controls.createEl("label", { cls: "inkpdf-probe-gain", text: "\u7C97\u7EC6 " });
    const size = sizeLabel.createEl("select", { attr: { "aria-label": "\u7C97\u7EC6\uFF08\u53EA\u5F71\u54CD\u65B0\u7B14\u8FF9\uFF09" } });
    for (const [name, value] of [["\u7EC6", "0.5"], ["\u6807\u51C6", "1"], ["\u7C97", "2"]]) size.createEl("option", { text: name, attr: { value } });
    size.value = "1";
    size.addEventListener("change", () => {
      this.finish("style-change");
      this.size = Number(size.value);
    });
    this.undoButton = this.button(controls, "\u64A4\u9500\uFF080\uFF09", () => this.undoRedo(false));
    this.redoButton = this.button(controls, "\u91CD\u505A\uFF080\uFF09", () => this.undoRedo(true));
    this.updateHistory();
    const gainLabel = options.createEl("label", { cls: "inkpdf-probe-gain", text: "\u538B\u611F\u589E\u76CA " });
    const gain = gainLabel.createEl("select", { attr: { "aria-label": "\u538B\u611F\u589E\u76CA\uFF08\u53EA\u5F71\u54CD\u65B0\u7B14\u8FF9\uFF09" } });
    for (const n of [1, 2.5, 4]) gain.createEl("option", { text: `${n}\xD7`, attr: { value: String(n) } });
    gain.value = "2.5";
    gain.addEventListener("change", () => {
      this.finish("pressure-change");
      this.pressureGain = Number(gain.value);
    });
    for (const zoom of [1, 1.5, 2]) this.button(options, `${zoom * 100}%`, async () => {
      this.finish("zoom");
      this.zoom = zoom;
      await this.resizePages();
    });
    this.button(options, "\u4FDD\u5B58 / \u91CD\u8BD5", () => this.flush());
    this.button(options, "\u4FDD\u5B58\u5E76\u91CD\u65B0\u8BFB\u53D6", async () => {
      const p = this.current;
      this.navigating = true;
      try {
        await this.flush();
        if (!p.store) throw new Error("\u5B58\u50A8\u5C1A\u672A\u521D\u59CB\u5316");
        const loaded = await p.store.load();
        if (JSON.stringify(loaded) !== JSON.stringify(p.strokes)) {
          p.ready = false;
          throw new Error("\u91CD\u8BFB\u6570\u636E\u4E0D\u540C\uFF0C\u505C\u6B62\u7F16\u8F91");
        }
        p.strokes = loaded;
        p.savedCount = loaded.length;
        p.totalPoints = loaded.reduce((n, s) => n + s.points.length, 0);
        this.report.reopenReadback = { status: "PASS", strokeCount: loaded.length, revision: p.store.revision };
        this.redraw(p);
        this.state();
        new import_obsidian.Notice(`InkPDF\uFF1A\u5DF2\u4ECE\u78C1\u76D8\u91CD\u65B0\u8BFB\u53D6 ${loaded.length} \u7B14`);
      } finally {
        this.navigating = false;
      }
    });
    this.button(options, "\u590D\u6D4B Worker", () => this.probeWorker());
    this.button(options, "\u5BFC\u51FA\u8BCA\u65AD", () => this.exportReport());
    this.status = this.contentEl.createDiv({ cls: "inkpdf-probe-status", attr: { role: "status", "aria-live": "polite" }, text: "\u521D\u59CB\u5316\u4E2D\u2026" });
    this.capability = more.createDiv({ cls: "inkpdf-probe-capability", text: "Worker \u68C0\u6D4B\u4E2D\u2026" });
    this.inputStatus = more.createDiv({ cls: "inkpdf-probe-capability", text: "\u7B14\u538B\u529B\uFF1A\u5C1A\u65E0\u91C7\u6837\u3002Scribble \u72B6\u6001\u9700\u5728\u7CFB\u7EDF\u8BBE\u7F6E\u4E2D\u786E\u8BA4\u3002" });
    this.scroll = this.contentEl.createDiv({ cls: "inkpdf-probe-scroll" });
    this.scroll.style.touchAction = "none";
    this.registerDomEvent(this.scroll, "pointerdown", (e) => {
      if (e.pointerType !== "touch") {
        const target = [...this.pages.values()].find((p) => p.ink === e.target);
        if (!target?.ready || !target.rendered || this.active || this.erasing) return;
        this.activate(target);
      }
      this.down(e);
    });
    this.registerDomEvent(this.scroll, "scroll", () => {
      void this.refreshPages().catch((e) => this.fail(e));
    });
    this.registerDomEvent(document, "pointermove", (e) => this.move(e));
    this.registerDomEvent(document, "pointerup", (e) => {
      this.endTouch(e);
      if (e.pointerId === this.erasing?.pointerId) {
        this.eraseAt(e);
        this.finish("pointerup");
        return;
      }
      if (e.pointerId !== this.active?.pointerId) return;
      if (this.shapeAnchor && Math.hypot(e.clientX - this.shapeAnchor[0], e.clientY - this.shapeAnchor[1]) >= 4) this.fitted = void 0;
      this.sample(e, true);
      this.finish("pointerup");
    });
    this.registerDomEvent(document, "pointercancel", (e) => {
      this.endTouch(e);
      if (e.pointerId === this.active?.pointerId || e.pointerId === this.erasing?.pointerId) {
        this.pointerStats.canceled++;
        this.finish("pointercancel");
      }
    });
    this.registerDomEvent(this.scroll, "lostpointercapture", (e) => {
      if (e.pointerId === this.active?.pointerId || e.pointerId === this.erasing?.pointerId) this.pointerStats.lostCapture++;
    });
    this.registerDomEvent(document, "visibilitychange", () => {
      if (document.hidden) {
        this.finish("hidden");
        void this.flush().catch((e) => this.fail(e));
      }
    });
    this.registerDomEvent(window, "pagehide", () => {
      this.finish("pagehide");
      void this.flush().catch((e) => this.fail(e));
    });
    let resizeTimer;
    const observer = new ResizeObserver(() => {
      window.clearTimeout(resizeTimer);
      resizeTimer = window.setTimeout(() => {
        if (Math.abs(this.scroll.clientWidth - this.renderedWidth) < 1) return;
        this.finish("resize-width");
        void this.resizePages().catch((e) => this.fail(e));
      }, 150);
    });
    observer.observe(this.scroll);
    this.register(() => {
      observer.disconnect();
      window.clearTimeout(resizeTimer);
    });
    this.register(() => {
      cancelAnimationFrame(this.frame);
      window.clearTimeout(this.current.saveTimer);
    });
    this.report = {
      probeVersion: this.plugin.manifest.version,
      obsidianApiVersion: import_obsidian.apiVersion,
      userAgent: navigator.userAgent,
      devicePixelRatio,
      secureContext: isSecureContext,
      pointerEvents: typeof PointerEvent !== "undefined",
      coalescedEvents: typeof PointerEvent !== "undefined" && "getCoalescedEvents" in PointerEvent.prototype,
      cryptoSubtle: !!globalThis.crypto?.subtle,
      crossOriginIsolated: globalThis.crossOriginIsolated,
      limits: LIMITS,
      scope: this.pdfPath ? "Vault PDF per-page ink; read-only source; no OCR" : "One synthetic PDF; no OCR",
      pencilDoubleTap: "UNAVAILABLE_NO_PUBLIC_HOST_API",
      manualResults: { pencil: "NOT RUN", pressureVariation: "NOT RUN", palmRejection: "NOT RUN", appRestart: "NOT RUN", backgroundKill: "NOT RUN" }
    };
    void this.probeWorker();
    try {
      await this.initialize();
    } catch (e) {
      this.current.ready = false;
      if (!this.closed) this.fail(e);
    }
  }
  async initialize() {
    let bytes;
    if (this.pdfPath) {
      const file = this.app.vault.getAbstractFileByPath(this.pdfPath);
      if (!(file instanceof import_obsidian.TFile) || file.extension.toLowerCase() !== "pdf") throw new Error("PDF \u4E0D\u5B58\u5728\u6216\u5DF2\u6539\u540D\uFF0C\u8BF7\u91CD\u65B0\u9009\u62E9\uFF1B\u65E7\u6279\u6CE8\u4FDD\u7559");
      if (file.stat.size > 20 * 1024 * 1024) throw new Error("\u5F53\u524D\u8BD5\u9A8C\u4EC5\u652F\u6301\u4E0D\u8D85\u8FC7 20 MiB \u7684 PDF");
      bytes = new Uint8Array(await this.app.vault.readBinary(file));
      if (!bytes.length || bytes.length > 20 * 1024 * 1024) throw new Error("PDF \u4E3A\u7A7A\u6216\u8D85\u8FC7 20 MiB");
    } else bytes = Uint8Array.from(atob(PDF_BASE64), (c) => c.charCodeAt(0));
    const sourceHash = await sha256(bytes);
    if (!this.plugin.lastRun) {
      this.plugin.lastRun = uniqueId();
      await this.plugin.remember();
    }
    const started = performance.now();
    const lib = await (0, import_obsidian.loadPdfJs)();
    if (this.closed) return;
    if (typeof lib?.getDocument !== "function") throw new Error("loadPdfJs \u672A\u63D0\u4F9B getDocument");
    this.report.pdfjsVersion = lib.version ?? "unknown";
    const task = lib.getDocument({ data: bytes.slice(), isEvalSupported: false, enableXfa: false, disableAutoFetch: true, disableStream: true });
    this.pdfTask = task;
    this.pdf = await task.promise;
    if (this.closed) return;
    if (!this.pdfPath && this.pdf.numPages !== 1) throw new Error("\u6D4B\u8BD5\u5939\u5177\u5E94\u5F53\u53EA\u6709\u4E00\u9875");
    this.pageNumber = Math.min(this.pageNumber, this.pdf.numPages);
    this.sourceHash = sourceHash;
    await this.folder(ROOT);
    for (let n = 1; n <= this.pdf.numPages; n++) {
      if (this.closed) return;
      const p = new PageState(n);
      p.page = await this.pdf.getPage(n);
      p.sheet = this.scroll.createDiv({ cls: "inkpdf-probe-sheet", attr: { "data-page": String(n), "aria-label": `\u7B2C ${n} \u9875` } });
      p.pdfCanvas = p.sheet.createEl("canvas");
      p.committedInk = p.sheet.createEl("canvas", { cls: "inkpdf-probe-committed" });
      p.ink = p.sheet.createEl("canvas", { cls: "inkpdf-probe-ink", attr: { "aria-label": `\u7B2C ${n} \u9875\u624B\u5199\u753B\u5E03` } });
      p.ink.style.touchAction = "none";
      p.runId = this.pdfPath ? `pdf-${sourceHash}-p${n}` : this.plugin.lastRun;
      this.pages.set(n, p);
      this.layout(p);
    }
    if (!this.pdfPath) {
      const dir = `${ROOT}/${this.pages.get(1).runId}`;
      await this.folder(dir);
      const path = `${dir}/probe.pdf`;
      if (!await this.app.vault.adapter.exists(path)) await this.app.vault.createBinary(path, bytes.slice().buffer);
      if (await sha256(new Uint8Array(await this.app.vault.adapter.readBinary(path))) !== sourceHash) throw new Error("\u6D4B\u8BD5 PDF \u5DF2\u6539\u53D8\uFF0C\u62D2\u7EDD\u8986\u76D6\u6216\u53E0\u52A0");
    }
    this.current = this.pages.get(this.pageNumber);
    await this.loadPage(this.current);
    this.report.pdf = { status: "PASS", elapsedMs: Math.round(performance.now() - started), pages: this.pdf.numPages, selectedPage: this.pageNumber, sourceReadOnly: true };
    this.scroll.scrollTop += this.current.sheet.getBoundingClientRect().top - this.scroll.getBoundingClientRect().top - 12;
    this.activate(this.current);
    await this.refreshPages();
  }
  layout(p) {
    const base = p.page.getViewport({ scale: 1 });
    const scale = Math.max(0.2, Math.min(1.2, (this.scroll.clientWidth - 24) / base.width)) * this.zoom;
    p.viewport = p.page.getViewport({ scale });
    p.sheet.style.width = `${p.viewport.width}px`;
    p.sheet.style.height = `${p.viewport.height}px`;
    this.renderedWidth = this.scroll.clientWidth;
  }
  loadPage(p) {
    if (p.loading) return p.loading;
    p.loading = (async () => {
      if (!p.store) {
        const dir = `${ROOT}/${p.runId}`;
        for (const path of [dir, `${dir}/snapshots`]) await this.folder(path);
        p.store = new ProbeStore({
          list: async () => (await this.app.vault.adapter.list(`${dir}/snapshots`)).files.filter((f) => f.endsWith(".json")).map((f) => f.slice(f.lastIndexOf("/") + 1)),
          read: (path) => this.app.vault.adapter.read(`${dir}/snapshots/${path}`),
          create: async (path, text) => {
            await this.app.vault.create(`${dir}/snapshots/${path}`, text);
          }
        }, p.runId, this.sourceHash);
        try {
          p.strokes = await p.store.load();
        } catch (e) {
          p.store = void 0;
          throw e;
        }
        p.savedCount = p.strokes.length;
        p.totalPoints = p.strokes.reduce((n, s) => n + s.points.length, 0);
      }
      if (!p.rendered) await this.render(p);
      p.ready = true;
      p.sheet.dataset.loaded = "true";
    })().finally(() => {
      p.loading = void 0;
    });
    return p.loading;
  }
  activate(p) {
    if (!p.ready || this.active || this.erasing || this.closed) return;
    this.current.ink?.removeAttribute("data-active");
    this.current.committedInk?.removeAttribute("data-active");
    this.current = p;
    this.pageNumber = p.number;
    p.ink.setAttribute("data-active", "true");
    p.committedInk.setAttribute("data-active", "true");
    this.pageLabel.textContent = `\u7B2C ${p.number} / ${this.pdf.numPages} \u9875`;
    this.prevButton.disabled = p.number === 1;
    this.nextButton.disabled = p.number === this.pdf.numPages;
    this.report.pdf = { ...this.report.pdf, selectedPage: p.number };
    this.report.sourceHash = this.sourceHash;
    this.report.loadedFromDisk = { strokeCount: p.savedCount, revision: p.store?.revision };
    if (this.plugin.lastPage !== p.number) {
      this.plugin.lastPage = p.number;
      void this.plugin.remember().catch((e) => this.fail(e));
    }
    this.updateHistory();
    this.state();
  }
  visiblePage() {
    const mid = this.scroll.getBoundingClientRect().top + Math.min(this.scroll.clientHeight / 2, 250);
    return [...this.pages.values()].reduce((best, p) => {
      const distance = (q) => {
        const r = q.sheet.getBoundingClientRect();
        return Math.max(r.top - mid, mid - r.bottom, 0);
      };
      return distance(p) < distance(best) ? p : best;
    }, this.current);
  }
  refreshPages() {
    if (this.refreshTask) return this.refreshTask;
    this.refreshTask = (async () => {
      if (!this.pages.size || !this.report.pdf || this.closed) return;
      let target;
      do {
        target = this.visiblePage();
        await this.loadPage(target);
        this.activate(target);
        for (const p of this.pages.values()) {
          if (Math.abs(p.number - target.number) > 1 && p !== this.current && p.rendered) {
            p.rendered = false;
            p.sheet.dataset.loaded = "false";
            for (const c of [p.pdfCanvas, p.ink, p.committedInk]) {
              c.width = 0;
              c.height = 0;
            }
            p.page?.cleanup();
            if (!this.navigating && !p.saveTask && !p.saveError && p.editVersion === p.savedEditVersion) {
              p.store = void 0;
              p.strokes = [];
              p.history = new EditHistory();
              p.ready = false;
            }
          }
        }
        for (const n of [target.number - 1, target.number + 1]) {
          const p = this.pages.get(n);
          if (p && !this.closed) await this.loadPage(p);
        }
      } while (!this.closed && target !== this.visiblePage());
    })().finally(() => {
      this.refreshTask = void 0;
    });
    return this.refreshTask;
  }
  async jump(n) {
    const p = this.pages.get(n);
    if (!p) return;
    await this.flush();
    await this.loadPage(p);
    this.activate(p);
    this.scroll.scrollTop += p.sheet.getBoundingClientRect().top - this.scroll.getBoundingClientRect().top - 12;
    await this.refreshPages();
  }
  async resizePages() {
    await this.refreshTask;
    if (!this.pages.size || !this.report.pdf || this.closed) return;
    const offset = this.current.sheet.getBoundingClientRect().top - this.scroll.getBoundingClientRect().top;
    for (const p of this.pages.values()) {
      this.layout(p);
      p.rendered = false;
      p.sheet.dataset.loaded = "false";
      for (const c of [p.pdfCanvas, p.ink, p.committedInk]) {
        c.width = 0;
        c.height = 0;
      }
    }
    this.scroll.scrollTop += this.current.sheet.getBoundingClientRect().top - this.scroll.getBoundingClientRect().top - offset;
    await this.refreshPages();
  }
  async probeWorker() {
    const result = await workerProbe();
    this.report.worker = result;
    if (!this.closed) this.capability.textContent = `Blob module Worker + \u57FA\u7840 WASM\uFF1A${result.status}\uFF08\u4E0D\u4EE3\u8868 ORT/SIMD \u6216 OCR \u5DF2\u901A\u8FC7\uFF09`;
  }
  async render(p = this.current) {
    if (!p.page || this.closed) return;
    const generation = ++p.renderGeneration;
    const previous = p.renderTask;
    previous?.cancel();
    await previous?.promise.catch(() => void 0);
    if (generation !== p.renderGeneration || this.closed) return;
    const base = p.page.getViewport({ scale: 1 });
    this.renderedWidth = this.scroll.clientWidth;
    const scale = Math.max(0.2, Math.min(1.2, (this.scroll.clientWidth - 24) / base.width)) * this.zoom;
    const viewport = p.page.getViewport({ scale });
    pdfPoint(viewport.transform, 0, 0);
    p.viewport = viewport;
    p.dpr = Math.min(devicePixelRatio || 1, 2, 4096 / Math.max(viewport.width, viewport.height));
    p.sheet.style.width = `${viewport.width}px`;
    p.sheet.style.height = `${viewport.height}px`;
    for (const canvas of [p.pdfCanvas, p.committedInk, p.ink]) {
      canvas.width = Math.ceil(viewport.width * p.dpr);
      canvas.height = Math.ceil(viewport.height * p.dpr);
      canvas.style.width = `${viewport.width}px`;
      canvas.style.height = `${viewport.height}px`;
    }
    const context = p.pdfCanvas.getContext("2d");
    if (!context) throw new Error("Canvas 2D unavailable");
    const task = p.page.render({
      canvas: p.pdfCanvas,
      canvasContext: context,
      viewport,
      transform: [p.dpr, 0, 0, p.dpr, 0, 0]
    });
    p.renderTask = task;
    try {
      await task.promise;
    } catch (e) {
      if (generation === p.renderGeneration && !this.closed) throw e;
    }
    if (generation === p.renderGeneration && !this.closed) {
      p.rendered = true;
      this.redraw(p);
    }
  }
  context(canvas, clear = false, p = this.current) {
    if (!p.viewport) return null;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    if (clear) ctx.clearRect(0, 0, canvas.width, canvas.height);
    const [a, b, c, d, e, f] = p.viewport.transform.map((n) => n * p.dpr);
    ctx.setTransform(a, b, c, d, e, f);
    ctx.strokeStyle = "#155ac4";
    ctx.fillStyle = "#155ac4";
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    return ctx;
  }
  drawStroke(ctx, stroke, start = 0) {
    const width = (p) => strokeWidth(stroke, p);
    const first = stroke.points[0];
    if (!first) return;
    ctx.save();
    ctx.strokeStyle = ctx.fillStyle = stroke.color ?? "#155ac4";
    if (stroke.kind === "highlighter") {
      ctx.globalAlpha = 0.3;
      ctx.lineWidth = width(first);
      ctx.beginPath();
      if (stroke.points.length === 1) {
        ctx.arc(first[0], first[1], width(first) / 2, 0, Math.PI * 2);
        ctx.fill();
      } else {
        ctx.moveTo(first[0], first[1]);
        for (const p of stroke.points.slice(1)) ctx.lineTo(p[0], p[1]);
        ctx.stroke();
      }
      ctx.restore();
      return;
    }
    if (start === 0) {
      ctx.beginPath();
      ctx.arc(first[0], first[1], width(first) / 2, 0, Math.PI * 2);
      ctx.fill();
    }
    for (let i = Math.max(1, start); i < stroke.points.length; i++) {
      const p = stroke.points[i], prev = stroke.points[i - 1];
      ctx.lineWidth = (width(p) + width(prev)) / 2;
      ctx.beginPath();
      ctx.moveTo(prev[0], prev[1]);
      ctx.lineTo(p[0], p[1]);
      ctx.stroke();
    }
    ctx.restore();
  }
  redraw(p = this.current) {
    const ctx = this.context(p.committedInk, true, p);
    if (ctx) for (const s of p.strokes) this.drawStroke(ctx, s);
    this.context(p.ink, true, p);
    if (p !== this.current) return;
    this.paintedPoints = 0;
    this.paintActive();
  }
  paintActive() {
    const started = performance.now();
    const ctx = this.context(this.current.ink, !!this.fitted || this.active?.stroke.kind === "highlighter");
    if (ctx && this.active) {
      this.drawStroke(ctx, this.fitted ? { ...this.active.stroke, points: this.fitted.points } : this.active.stroke, this.fitted ? 0 : this.paintedPoints);
      this.paintedPoints = this.active.stroke.points.length;
      const p = this.active.stroke.points.at(-1)?.[2];
      this.inputStatus.textContent = `\u5F53\u524D\u539F\u59CB\u538B\u529B ${p?.toFixed(3) ?? "\u65E0"} \xB7 \u672C\u6B21\u8303\u56F4 ${this.pointerStats.pressureMin?.toFixed(3) ?? "-"}\uFF5E${this.pointerStats.pressureMax?.toFixed(3) ?? "-"} \xB7 \u589E\u76CA ${this.pressureGain}\xD7`;
    }
    this.timings.paints++;
    this.timings.maxPaintMs = Math.max(this.timings.maxPaintMs, performance.now() - started);
  }
  schedulePaint() {
    if (this.frame) return;
    this.frame = requestAnimationFrame(() => {
      this.frame = 0;
      this.paintActive();
    });
  }
  down(e) {
    if (e.pointerType === "touch") {
      this.pointerStats.touchDown++;
      this.touches.add(e.pointerId);
      if (this.mode === "browse") return;
      e.preventDefault();
      this.touchDiagnostics.maxContact = Math.max(this.touchDiagnostics.maxContact, e.width, e.height);
      if (this.touches.size !== 1 || this.active || this.erasing) {
        if (this.active || this.erasing) this.touchDiagnostics.blockedPen++;
        else this.touchDiagnostics.blockedMulti++;
        this.pan = void 0;
        this.pointerStats.ignoredTouches++;
        return;
      }
      this.pan = { id: e.pointerId, x: e.clientX, y: e.clientY, moving: false };
      try {
        this.current.ink.setPointerCapture(e.pointerId);
      } catch {
        this.pointerStats.captureFailed++;
      }
      return;
    }
    if (!this.current.ready || this.navigating || !this.current.viewport || this.mode !== "write" || !["pen", "mouse"].includes(e.pointerType) || e.button !== 0) return;
    if (this.active || this.erasing) this.finish("superseded-down");
    if (this.tool !== "eraser" && (this.current.strokes.length >= LIMITS.strokes || this.current.totalPoints >= LIMITS.totalPoints)) {
      new import_obsidian.Notice("\u5DF2\u8FBE\u63A2\u9488\u4E0A\u9650\uFF0C\u8BF7\u5BFC\u51FA\u8BCA\u65AD\u540E\u65B0\u5EFA\u72EC\u7ACB\u6D4B\u8BD5");
      return;
    }
    e.preventDefault();
    this.pan = void 0;
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
    this.lastPenAt = performance.now();
    if (e.pointerType === "pen") this.pointerStats.penDown++;
    else this.pointerStats.mouseDown++;
    try {
      this.current.ink.setPointerCapture(e.pointerId);
    } catch {
      this.pointerStats.captureFailed++;
    }
    if (this.tool === "eraser") {
      this.erasing = { pointerId: e.pointerId, before: this.current.strokes.slice(), last: this.eventPoint(e), changed: false };
      this.eraseAt(e);
      this.state();
      return;
    }
    this.paintedPoints = 0;
    this.lastSampleTime = e.timeStamp;
    this.active = { pointerId: e.pointerId, started: e.timeStamp, stroke: { id: uniqueId(), pointerType: e.pointerType, interrupted: false, points: [], pressureGain: this.pressureGain, kind: this.tool, color: this.color, size: this.size } };
    this.sample(e);
    this.holdShape(e);
    this.schedulePaint();
    this.state();
  }
  eventPoint(e) {
    const rect = this.current.ink.getBoundingClientRect();
    return pdfPoint(
      this.current.viewport.transform,
      (e.clientX - rect.left) * this.current.viewport.width / rect.width,
      (e.clientY - rect.top) * this.current.viewport.height / rect.height
    );
  }
  endTouch(e) {
    if (e.pointerType !== "touch") return;
    this.touches.delete(e.pointerId);
    if (this.pan?.id === e.pointerId) this.pan = void 0;
    try {
      this.current.ink.releasePointerCapture(e.pointerId);
    } catch {
    }
  }
  eraseAt(e) {
    const erase = this.erasing;
    if (!erase || !this.current.viewport) return;
    const to = this.eventPoint(e);
    const radius = 10 / Math.hypot(this.current.viewport.transform[0], this.current.viewport.transform[1]);
    const retained = this.current.strokes.filter((s) => !hitsStroke(s, erase.last, to, radius));
    erase.last = to;
    if (retained.length === this.current.strokes.length) return;
    this.current.strokes = retained;
    erase.changed = true;
    this.redraw();
    this.state();
  }
  sample(e, ending = false) {
    const active = this.active;
    if (!active || !this.current.viewport) return;
    if (active.stroke.points.length >= LIMITS.pointsPerStroke || this.current.totalPoints + active.stroke.points.length >= LIMITS.totalPoints) {
      this.finish("sample-limit");
      new import_obsidian.Notice("\u7B14\u8FF9\u70B9\u6570\u8FBE\u5230\u63A2\u9488\u4E0A\u9650\uFF0C\u5DF2\u7ED3\u675F\u8BE5\u7B14");
      return;
    }
    const [x, y] = this.eventPoint(e);
    const last = active.stroke.points.at(-1);
    const pressure = ending && last ? last[2] : active.stroke.pointerType === "pen" && Number.isFinite(e.pressure) ? Math.max(0, Math.min(1, e.pressure)) : null;
    const t = Math.max(last?.[3] ?? 0, e.timeStamp - active.started, 0);
    if (last && last[0] === x && last[1] === y && last[2] === pressure && last[3] === t) return;
    active.stroke.points.push([x, y, pressure, t]);
    this.timings.maxEventGapMs = Math.max(this.timings.maxEventGapMs, e.timeStamp - this.lastSampleTime);
    this.lastSampleTime = Math.max(e.timeStamp, this.lastSampleTime);
    if (pressure !== null && !ending) {
      this.pointerStats.penSamples++;
      this.pointerStats.pressureMin = Math.min(this.pointerStats.pressureMin ?? pressure, pressure);
      this.pointerStats.pressureMax = Math.max(this.pointerStats.pressureMax ?? pressure, pressure);
    }
  }
  move(e) {
    if (e.pointerType === "touch") {
      this.touchDiagnostics.moves++;
      if (this.mode === "browse" || e.pointerId !== this.pan?.id || this.active || this.erasing) return;
      e.preventDefault();
      const p = this.pan;
      if (performance.now() - this.lastPenAt < 180) {
        p.x = e.clientX;
        p.y = e.clientY;
        this.touchDiagnostics.cooldownMoves++;
        return;
      }
      if (!p.moving && Math.hypot(e.clientX - p.x, e.clientY - p.y) < 8) return;
      p.moving = true;
      const oldX = this.scroll.scrollLeft, oldY = this.scroll.scrollTop;
      this.scroll.scrollLeft += p.x - e.clientX;
      this.scroll.scrollTop += p.y - e.clientY;
      if (this.scroll.scrollLeft !== oldX || this.scroll.scrollTop !== oldY) this.touchDiagnostics.scrollChanges++;
      p.x = e.clientX;
      p.y = e.clientY;
      this.pointerStats.touchPanMoves++;
      return;
    }
    if (e.pointerId === this.erasing?.pointerId) {
      e.preventDefault();
      this.eraseAt(e);
      return;
    }
    if (e.pointerId !== this.active?.pointerId) return;
    e.preventDefault();
    const points = typeof e.getCoalescedEvents === "function" ? e.getCoalescedEvents() : [];
    this.pointerStats.coalescedSamples += points.length;
    for (const p of points) this.sample(p);
    this.sample(e);
    this.holdShape(e);
    this.schedulePaint();
  }
  holdShape(e) {
    if (!this.active || this.active.stroke.pointerType !== "pen" || this.active.stroke.kind !== "pen") return;
    if (this.shapeAnchor && Math.hypot(e.clientX - this.shapeAnchor[0], e.clientY - this.shapeAnchor[1]) < 4) return;
    window.clearTimeout(this.shapeTimer);
    this.shapeAnchor = [e.clientX, e.clientY];
    if (this.fitted) {
      this.fitted = void 0;
      this.context(this.current.ink, true);
      this.paintedPoints = 0;
    }
    const active = this.active;
    this.shapeTimer = window.setTimeout(() => {
      if (this.active !== active || this.closed) return;
      this.fitted = fitShape(active.stroke.points);
      if (this.fitted && this.current.totalPoints + this.fitted.points.length > LIMITS.totalPoints) this.fitted = void 0;
      if (this.fitted) {
        this.context(this.current.ink, true);
        this.schedulePaint();
      }
    }, 1e3);
  }
  finish(reason) {
    window.clearTimeout(this.shapeTimer);
    this.shapeAnchor = void 0;
    const fitted = reason === "pointerup" ? this.fitted : void 0;
    this.fitted = void 0;
    if (this.erasing) {
      const erase = this.erasing;
      this.erasing = void 0;
      this.lastPenAt = performance.now();
      try {
        this.current.ink.releasePointerCapture(erase.pointerId);
      } catch {
      }
      if (erase.changed) {
        this.current.history.record(erase.before, this.current.strokes);
        this.updateHistory();
        this.changed();
      }
      this.state();
      return;
    }
    if (!this.active) return;
    const active = this.active;
    this.active = void 0;
    active.stroke.interrupted = reason !== "pointerup";
    this.lastPenAt = performance.now();
    this.endings.push({ reason, samples: active.stroke.points.length, durationMs: active.stroke.points.at(-1)?.[3] ?? 0 });
    this.endings = this.endings.slice(-30);
    if (active.stroke.points.length) {
      const before = this.current.strokes.slice();
      this.current.strokes.push(active.stroke);
      this.current.history.record(before, this.current.strokes);
      if (fitted) {
        const raw = this.current.strokes.slice();
        active.stroke = { ...active.stroke, points: fitted.points };
        this.current.strokes = [...before, active.stroke];
        this.current.history.record(raw, this.current.strokes);
        this.shapeCounts[fitted.kind] = (this.shapeCounts[fitted.kind] ?? 0) + 1;
      }
      this.updateHistory();
      const ctx = this.context(this.current.committedInk);
      if (ctx) this.drawStroke(ctx, active.stroke);
      this.changed();
    }
    try {
      this.current.ink.releasePointerCapture(active.pointerId);
    } catch {
    }
    this.context(this.current.ink, true);
    this.paintedPoints = 0;
    this.state();
  }
  changed() {
    this.current.editVersion++;
    this.current.totalPoints = this.current.strokes.reduce((n, s) => n + s.points.length, 0);
    this.state();
    if (!this.current.saveDue) this.current.saveDue = performance.now() + 1500;
    window.clearTimeout(this.current.saveTimer);
    const p = this.current;
    this.current.saveTimer = window.setTimeout(() => {
      p.saveDue = 0;
      if (p === this.current && (this.active || this.erasing)) return;
      void this.save(p).catch((e) => this.fail(e));
    }, Math.max(0, Math.min(250, this.current.saveDue - performance.now())));
  }
  undoRedo(redo) {
    if (!this.current.ready || this.navigating) return;
    this.finish("history");
    if (redo ? !this.current.history.redoDepth : !this.current.history.undoDepth) return;
    this.current.strokes = redo ? this.current.history.redo(this.current.strokes) : this.current.history.undo(this.current.strokes);
    this.updateHistory();
    this.changed();
    this.redraw();
  }
  updateHistory() {
    this.undoButton.disabled = !this.current.history.undoDepth;
    this.redoButton.disabled = !this.current.history.redoDepth;
    this.undoButton.textContent = "\u21B6";
    this.undoButton.setAttribute("aria-label", `\u64A4\u9500\uFF08${this.current.history.undoDepth}\uFF09`);
    this.redoButton.textContent = "\u21B7";
    this.redoButton.setAttribute("aria-label", `\u91CD\u505A\uFF08${this.current.history.redoDepth}\uFF09`);
  }
  async save(p = this.current) {
    if (p.saveTask) return p.saveTask;
    if (!p.store) return;
    p.saveTask = (async () => {
      while (p.savedEditVersion < p.editVersion) {
        if (p === this.current && (this.active || this.erasing)) break;
        const version = p.editVersion;
        const started = performance.now();
        const snapshot = JSON.parse(JSON.stringify(p.strokes));
        const result = await p.store.save(snapshot, version);
        p.savedCount = result.count;
        p.savedEditVersion = result.editVersion;
        this.timings.saves++;
        this.timings.maxSaveMs = Math.max(this.timings.maxSaveMs, performance.now() - started);
        p.saveError = "";
        this.state();
      }
    })().catch((e) => {
      p.saveError = String(e);
      this.state();
      throw e;
    }).finally(() => {
      p.saveTask = void 0;
    });
    return p.saveTask;
  }
  async flush() {
    this.finish("flush");
    const results = await Promise.allSettled([...this.pages.values()].map((p) => {
      window.clearTimeout(p.saveTimer);
      p.saveDue = 0;
      return this.save(p);
    }));
    this.state();
    const failure = results.find((r) => r.status === "rejected");
    if (failure?.status === "rejected") throw failure.reason;
  }
  async exportReport() {
    await this.folder(ROOT);
    const report = {
      ...this.report,
      exportedAt: (/* @__PURE__ */ new Date()).toISOString(),
      runId: this.current.runId,
      pages: [...this.pages.values()].filter((p) => p.store).map((p) => ({ page: p.number, strokes: p.strokes.length, saved: p.savedCount, revision: p.store?.revision, editVersion: p.editVersion, savedEditVersion: p.savedEditVersion, saveError: p.saveError })),
      shapeCounts: this.shapeCounts,
      strokesInMemory: this.current.strokes.length,
      strokesSaved: this.current.savedCount,
      revision: this.current.store?.revision ?? 0,
      saveError: this.current.saveError,
      pointer: this.pointerStats,
      errors: this.errors,
      editVersion: this.current.editVersion,
      savedEditVersion: this.current.savedEditVersion,
      inputEndings: this.endings,
      timings: this.timings,
      pressureGain: this.pressureGain,
      touchDiagnostics: {
        ...this.touchDiagnostics,
        activeTouches: this.touches.size,
        mode: this.mode,
        scrollTop: this.scroll.scrollTop,
        maxScrollTop: this.scroll.scrollHeight - this.scroll.clientHeight
      },
      undoDepth: this.current.history.undoDepth,
      redoDepth: this.current.history.redoDepth,
      drawing: "Incremental active ink + committed canvas; finger pan while pen is up; whole-stroke eraser",
      privacy: "No handwriting coordinates, recognized text or PDF bytes included. Local file only."
    };
    const path = `${ROOT}/diagnostic-${Date.now()}-${uniqueId()}.json`;
    await this.app.vault.create(path, JSON.stringify(report, null, 2));
    new import_obsidian.Notice(`\u8BCA\u65AD\u5DF2\u4FDD\u5B58\u5728 ${path}\uFF1B\u6CA1\u6709\u4E0A\u4F20`, 1e4);
  }
  async onClose() {
    this.finish("view-close");
    this.closed = true;
    for (const p of this.pages.values()) {
      p.renderGeneration++;
      p.renderTask?.cancel();
      window.clearTimeout(p.saveTimer);
    }
    await this.flush().catch((e) => this.fail(e));
    await this.refreshTask?.catch(() => void 0);
    for (const p of this.pages.values()) {
      await p.renderTask?.promise.catch(() => void 0);
      p.page?.cleanup();
    }
    await this.pdfTask?.destroy().catch((e) => this.fail(e));
  }
};
