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
    if (intersects || distance <= radius + Math.max(penWidth(a, stroke.pressureGain), penWidth(b, stroke.pressureGain)) / 2) return true;
  }
  return false;
}
var EraseHistory = class {
  entries = [];
  get depth() {
    return this.entries.length;
  }
  record(before, after) {
    const remaining = new Set(after.map((s) => s.id));
    const removed = before.flatMap((stroke, index) => remaining.has(stroke.id) ? [] : [{ stroke, index }]);
    if (!removed.length) return;
    this.entries.push(removed);
    while (this.entries.length > 20 || this.entries.reduce((n, entry) => n + entry.reduce((m, item) => m + item.stroke.points.length, 0), 0) > LIMITS.totalPoints) this.entries.shift();
  }
  restore(current) {
    const entry = this.entries.at(-1);
    if (!entry) return current;
    const restored = current.slice();
    for (const { stroke, index } of entry) {
      if (!restored.some((s) => s.id === stroke.id)) restored.splice(index, 0, stroke);
    }
    if (restored.length > LIMITS.strokes || restored.reduce((n, s) => n + s.points.length, 0) > LIMITS.totalPoints) throw new Error("\u6062\u590D\u4F1A\u8D85\u8FC7\u63A2\u9488\u4E0A\u9650\uFF1B\u5386\u53F2\u4FDD\u7559\uFF0C\u8BF7\u5148\u64E6\u9664\u5176\u4ED6\u7B14\u8FF9");
    this.entries.pop();
    return restored;
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
var ProbeView = class extends import_obsidian.ItemView {
  constructor(leaf, plugin) {
    super(leaf);
    this.plugin = plugin;
    this.pdfPath = plugin.lastPdfPath;
    this.pageNumber = this.pdfPath ? plugin.lastPage : 1;
  }
  plugin;
  runId = "";
  store;
  strokes = [];
  savedCount = 0;
  editVersion = 0;
  savedEditVersion = 0;
  active;
  erasing;
  eraseHistory = new EraseHistory();
  eraseUndoButton;
  tool = "pen";
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
  totalPoints = 0;
  frame = 0;
  paintedPoints = 0;
  saveTimer;
  saveDue = 0;
  renderedWidth = 0;
  pdf;
  pdfTask;
  page;
  viewport;
  renderTask;
  renderGeneration = 0;
  closed = false;
  ready = false;
  mode = "write";
  zoom = 1;
  dpr = 1;
  saveTask;
  saveError = "";
  status;
  capability;
  scroll;
  sheet;
  pdfCanvas;
  ink;
  committedInk;
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
    if (!this.ready || this.navigating) return;
    this.finish("tool-change");
    this.tool = this.tool === "pen" ? "eraser" : "pen";
    this.toolButton.textContent = this.tool === "pen" ? "\u5DE5\u5177\uFF1A\u94A2\u7B14" : "\u5DE5\u5177\uFF1A\u6574\u7B14\u6A61\u76AE";
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
    const b = parent.createEl("button", { text });
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
    if (!this.ready) return;
    const suffix = this.active || this.erasing ? "\u64CD\u4F5C\u4E2D\uFF0C\u62AC\u7B14\u540E\u4FDD\u5B58" : this.saveError ? `\u4FDD\u5B58\u5931\u8D25\uFF1A${this.saveError}` : this.savedEditVersion === this.editVersion ? `\u5DF2\u4FDD\u5B58\u5E76\u8BFB\u56DE\u6821\u9A8C \xB7 revision ${this.store?.revision ?? 0}` : "\u5C1A\u6709\u672A\u4FDD\u5B58\u7B14\u8FF9";
    this.status.textContent = `${this.strokes.length} \u7B14 / ${LIMITS.strokes} \xB7 ${suffix}`;
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
    this.contentEl.createEl("h2", { text: "InkPDF \xB7 \u6700\u5C0F\u8BBE\u5907\u63A2\u9488" });
    this.contentEl.createEl("p", { text: "\u9010\u9875 PDF \u4E66\u5199\u6D4B\u8BD5\u3002\u8BF7\u5148\u5173\u95ED iPad \u968F\u624B\u5199 / Scribble\u3002\u7B14\u62AC\u8D77\u540E\u53EF\u5355\u6307\u6EDA\u52A8\uFF1B\u7B14\u843D\u4E0B\u65F6\u6682\u505C\u624B\u6307\u5BFC\u822A\u3002\u6574\u7B14\u6A61\u76AE\u652F\u6301\u8FDE\u7EED\u6062\u590D\uFF0C\u6700\u591A\u4FDD\u7559 20 \u6B65\uFF08\u5F53\u524D\u9875\u6253\u5F00\u671F\u95F4\uFF09\u3002\u7B14\u4F53\u53CC\u51FB\u6682\u4E0D\u53EF\u7528\uFF0C\u8BF7\u7528\u5DE5\u5177\u6309\u94AE\u5207\u6362\u3002" });
    const controls = this.contentEl.createDiv({ cls: "inkpdf-probe-controls" });
    this.button(controls, "\u6253\u5F00\u4ED3\u5E93 PDF", () => this.plugin.choosePdf());
    const sourceLabel = this.contentEl.createDiv({ cls: "inkpdf-probe-source" });
    sourceLabel.textContent = this.pdfPath ? `${this.pdfPath} \xB7 \u539F\u6587\u4EF6\u53EA\u8BFB\uFF1B\u76F8\u540C\u5185\u5BB9\u526F\u672C\u5171\u4EAB\u9010\u9875\u7B14\u8FF9` : "\u5408\u6210 PDF \u8BBE\u5907\u6D4B\u8BD5";
    this.prevButton = this.button(controls, "\u4E0A\u4E00\u9875", () => this.ready && this.pdfPath && this.pageNumber > 1 ? this.plugin.open(true, this.pdfPath, this.pageNumber - 1) : void 0);
    this.pageLabel = controls.createEl("span", { text: "\u52A0\u8F7D\u9875\u7801\u4E2D\u2026", attr: { role: "status" } });
    this.nextButton = this.button(controls, "\u4E0B\u4E00\u9875", () => this.ready && this.pdfPath && this.pdf && this.pageNumber < this.pdf.numPages ? this.plugin.open(true, this.pdfPath, this.pageNumber + 1) : void 0);
    this.prevButton.disabled = this.nextButton.disabled = true;
    const modeButton = this.button(controls, "\u6A21\u5F0F\uFF1A\u4E66\u5199", () => {
      this.finish("mode-change");
      this.pan = void 0;
      this.mode = this.mode === "write" ? "browse" : "write";
      modeButton.textContent = this.mode === "write" ? "\u6A21\u5F0F\uFF1A\u4E66\u5199" : "\u6A21\u5F0F\uFF1A\u6D4F\u89C8";
      this.ink.style.touchAction = this.mode === "write" ? "none" : "pan-x pan-y";
      this.scroll.style.touchAction = this.ink.style.touchAction;
    });
    this.toolButton = this.button(controls, "\u5DE5\u5177\uFF1A\u94A2\u7B14", () => this.toggleTool());
    this.eraseUndoButton = this.button(controls, "\u6062\u590D\u64E6\u9664\uFF08\u5269\u4F59 0 \u6B65\uFF09", () => {
      this.finish("restore");
      this.strokes = this.eraseHistory.restore(this.strokes);
      this.updateEraseHistory();
      this.changed();
      this.redraw();
    });
    this.eraseUndoButton.disabled = true;
    const gainLabel = controls.createEl("label", { cls: "inkpdf-probe-gain", text: "\u538B\u611F\u589E\u76CA " });
    const gain = gainLabel.createEl("select", { attr: { "aria-label": "\u538B\u611F\u589E\u76CA\uFF08\u53EA\u5F71\u54CD\u65B0\u7B14\u8FF9\uFF09" } });
    for (const n of [1, 2.5, 4]) gain.createEl("option", { text: `${n}\xD7`, attr: { value: String(n) } });
    gain.value = "2.5";
    gain.addEventListener("change", () => {
      this.finish("pressure-change");
      this.pressureGain = Number(gain.value);
    });
    for (const zoom of [1, 1.5, 2]) this.button(controls, `${zoom * 100}%`, async () => {
      this.finish("zoom");
      this.zoom = zoom;
      await this.render();
    });
    this.button(controls, "\u4FDD\u5B58 / \u91CD\u8BD5", () => this.flush());
    this.button(controls, "\u4FDD\u5B58\u5E76\u91CD\u65B0\u8BFB\u53D6", async () => {
      await this.flush();
      if (!this.store) throw new Error("\u5B58\u50A8\u5C1A\u672A\u521D\u59CB\u5316");
      const loaded = await this.store.load();
      if (JSON.stringify(loaded) !== JSON.stringify(this.strokes)) {
        this.ready = false;
        throw new Error("\u91CD\u8BFB\u6570\u636E\u4E0D\u540C\uFF0C\u505C\u6B62\u7F16\u8F91");
      }
      this.strokes = loaded;
      this.savedCount = loaded.length;
      this.totalPoints = loaded.reduce((n, s) => n + s.points.length, 0);
      this.report.reopenReadback = { status: "PASS", strokeCount: loaded.length, revision: this.store.revision };
      this.redraw();
      this.state();
      new import_obsidian.Notice(`InkPDF\uFF1A\u5DF2\u4ECE\u78C1\u76D8\u91CD\u65B0\u8BFB\u53D6 ${loaded.length} \u7B14`);
    });
    this.button(controls, "\u590D\u6D4B Worker", () => this.probeWorker());
    this.button(controls, "\u5BFC\u51FA\u8BCA\u65AD", () => this.exportReport());
    this.status = this.contentEl.createDiv({ cls: "inkpdf-probe-status", attr: { role: "status", "aria-live": "polite" }, text: "\u521D\u59CB\u5316\u4E2D\u2026" });
    this.capability = this.contentEl.createDiv({ cls: "inkpdf-probe-capability", text: "Worker \u68C0\u6D4B\u4E2D\u2026" });
    this.inputStatus = this.contentEl.createDiv({ cls: "inkpdf-probe-capability", text: "\u7B14\u538B\u529B\uFF1A\u5C1A\u65E0\u91C7\u6837\u3002Scribble \u72B6\u6001\u9700\u5728\u7CFB\u7EDF\u8BBE\u7F6E\u4E2D\u786E\u8BA4\u3002" });
    this.scroll = this.contentEl.createDiv({ cls: "inkpdf-probe-scroll" });
    this.scroll.style.touchAction = "none";
    this.sheet = this.scroll.createDiv({ cls: "inkpdf-probe-sheet" });
    this.pdfCanvas = this.sheet.createEl("canvas");
    this.committedInk = this.sheet.createEl("canvas", { cls: "inkpdf-probe-committed" });
    this.ink = this.sheet.createEl("canvas", { cls: "inkpdf-probe-ink", attr: { "aria-label": "PDF \u624B\u5199\u6D4B\u8BD5\u753B\u5E03" } });
    this.ink.style.touchAction = "none";
    this.registerDomEvent(this.scroll, "pointerdown", (e) => {
      if (e.pointerType === "touch" || e.target === this.ink) this.down(e);
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
    this.registerDomEvent(this.ink, "lostpointercapture", (e) => {
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
        void this.render().catch((e) => this.fail(e));
      }, 150);
    });
    observer.observe(this.scroll);
    this.register(() => {
      observer.disconnect();
      window.clearTimeout(resizeTimer);
    });
    this.register(() => {
      cancelAnimationFrame(this.frame);
      window.clearTimeout(this.saveTimer);
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
      this.ready = false;
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
    this.runId = this.pdfPath ? `pdf-${sourceHash}-p${this.pageNumber}` : this.plugin.lastRun;
    const dir = `${ROOT}/${this.runId}`;
    for (const p of [ROOT, dir, `${dir}/snapshots`]) await this.folder(p);
    if (!this.pdfPath) {
      const pdfPath = `${dir}/probe.pdf`;
      if (!await this.app.vault.adapter.exists(pdfPath)) await this.app.vault.createBinary(pdfPath, bytes.slice().buffer);
      const diskBytes = new Uint8Array(await this.app.vault.adapter.readBinary(pdfPath));
      if (await sha256(diskBytes) !== sourceHash) throw new Error("\u6D4B\u8BD5 PDF \u5DF2\u6539\u53D8\uFF0C\u62D2\u7EDD\u8986\u76D6\u6216\u53E0\u52A0");
    }
    this.store = new ProbeStore({
      list: async () => {
        const { files } = await this.app.vault.adapter.list(`${dir}/snapshots`);
        return files.filter((f) => f.endsWith(".json")).map((f) => f.slice(f.lastIndexOf("/") + 1));
      },
      read: (path) => this.app.vault.adapter.read(`${dir}/snapshots/${path}`),
      create: async (path, text) => {
        await this.app.vault.create(`${dir}/snapshots/${path}`, text);
      }
    }, this.runId, sourceHash);
    this.strokes = await this.store.load();
    this.savedCount = this.strokes.length;
    this.totalPoints = this.strokes.reduce((n, s) => n + s.points.length, 0);
    this.report.loadedFromDisk = { strokeCount: this.savedCount, revision: this.store.revision };
    this.report.sourceHash = sourceHash;
    this.page = await this.pdf.getPage(this.pageNumber);
    await this.render();
    if (this.closed) return;
    this.report.pdf = { status: "PASS", elapsedMs: Math.round(performance.now() - started), pages: this.pdf.numPages, selectedPage: this.pageNumber, sourceReadOnly: true };
    this.pageLabel.textContent = `\u7B2C ${this.pageNumber} / ${this.pdf.numPages} \u9875`;
    this.prevButton.disabled = !this.pdfPath || this.pageNumber === 1;
    this.nextButton.disabled = !this.pdfPath || this.pageNumber === this.pdf.numPages;
    this.plugin.lastPage = this.pageNumber;
    await this.plugin.remember();
    this.ready = true;
    this.state();
  }
  async probeWorker() {
    const result = await workerProbe();
    this.report.worker = result;
    if (!this.closed) this.capability.textContent = `Blob module Worker + \u57FA\u7840 WASM\uFF1A${result.status}\uFF08\u4E0D\u4EE3\u8868 ORT/SIMD \u6216 OCR \u5DF2\u901A\u8FC7\uFF09`;
  }
  async render() {
    if (!this.page || this.closed) return;
    const generation = ++this.renderGeneration;
    const previous = this.renderTask;
    previous?.cancel();
    await previous?.promise.catch(() => void 0);
    if (generation !== this.renderGeneration || this.closed) return;
    const base = this.page.getViewport({ scale: 1 });
    this.renderedWidth = this.scroll.clientWidth;
    const scale = Math.max(0.2, Math.min(1.2, (this.scroll.clientWidth - 24) / base.width)) * this.zoom;
    const viewport = this.page.getViewport({ scale });
    pdfPoint(viewport.transform, 0, 0);
    this.viewport = viewport;
    this.dpr = Math.min(devicePixelRatio || 1, 2, 4096 / Math.max(viewport.width, viewport.height));
    this.sheet.style.width = `${viewport.width}px`;
    this.sheet.style.height = `${viewport.height}px`;
    for (const canvas of [this.pdfCanvas, this.committedInk, this.ink]) {
      canvas.width = Math.ceil(viewport.width * this.dpr);
      canvas.height = Math.ceil(viewport.height * this.dpr);
      canvas.style.width = `${viewport.width}px`;
      canvas.style.height = `${viewport.height}px`;
    }
    const context = this.pdfCanvas.getContext("2d");
    if (!context) throw new Error("Canvas 2D unavailable");
    const task = this.page.render({
      canvas: this.pdfCanvas,
      canvasContext: context,
      viewport,
      transform: [this.dpr, 0, 0, this.dpr, 0, 0]
    });
    this.renderTask = task;
    try {
      await task.promise;
    } catch (e) {
      if (generation === this.renderGeneration && !this.closed) throw e;
    }
    if (generation === this.renderGeneration && !this.closed) this.redraw();
  }
  context(canvas, clear = false) {
    if (!this.viewport) return null;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    if (clear) ctx.clearRect(0, 0, canvas.width, canvas.height);
    const [a, b, c, d, e, f] = this.viewport.transform.map((n) => n * this.dpr);
    ctx.setTransform(a, b, c, d, e, f);
    ctx.strokeStyle = "#155ac4";
    ctx.fillStyle = "#155ac4";
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    return ctx;
  }
  drawStroke(ctx, stroke, start = 0) {
    const width = (p) => penWidth(p, stroke.pressureGain);
    const first = stroke.points[0];
    if (!first) return;
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
  }
  redraw() {
    const ctx = this.context(this.committedInk, true);
    if (ctx) for (const s of this.strokes) this.drawStroke(ctx, s);
    this.context(this.ink, true);
    this.paintedPoints = 0;
    this.paintActive();
  }
  paintActive() {
    const started = performance.now();
    const ctx = this.context(this.ink);
    if (ctx && this.active) {
      this.drawStroke(ctx, this.active.stroke, this.paintedPoints);
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
        this.ink.setPointerCapture(e.pointerId);
      } catch {
        this.pointerStats.captureFailed++;
      }
      return;
    }
    if (!this.ready || this.navigating || !this.viewport || this.mode !== "write" || !["pen", "mouse"].includes(e.pointerType) || e.button !== 0) return;
    if (this.active || this.erasing) this.finish("superseded-down");
    if (this.tool === "pen" && (this.strokes.length >= LIMITS.strokes || this.totalPoints >= LIMITS.totalPoints)) {
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
      this.ink.setPointerCapture(e.pointerId);
    } catch {
      this.pointerStats.captureFailed++;
    }
    if (this.tool === "eraser") {
      this.erasing = { pointerId: e.pointerId, before: this.strokes.slice(), last: this.eventPoint(e), changed: false };
      this.eraseAt(e);
      this.state();
      return;
    }
    this.paintedPoints = 0;
    this.lastSampleTime = e.timeStamp;
    this.active = { pointerId: e.pointerId, started: e.timeStamp, stroke: { id: uniqueId(), pointerType: e.pointerType, interrupted: false, points: [], pressureGain: this.pressureGain } };
    this.sample(e);
    this.schedulePaint();
    this.state();
  }
  eventPoint(e) {
    const rect = this.ink.getBoundingClientRect();
    return pdfPoint(
      this.viewport.transform,
      (e.clientX - rect.left) * this.viewport.width / rect.width,
      (e.clientY - rect.top) * this.viewport.height / rect.height
    );
  }
  endTouch(e) {
    if (e.pointerType !== "touch") return;
    this.touches.delete(e.pointerId);
    if (this.pan?.id === e.pointerId) this.pan = void 0;
    try {
      this.ink.releasePointerCapture(e.pointerId);
    } catch {
    }
  }
  eraseAt(e) {
    const erase = this.erasing;
    if (!erase || !this.viewport) return;
    const to = this.eventPoint(e);
    const radius = 10 / Math.hypot(this.viewport.transform[0], this.viewport.transform[1]);
    const retained = this.strokes.filter((s) => !hitsStroke(s, erase.last, to, radius));
    erase.last = to;
    if (retained.length === this.strokes.length) return;
    this.strokes = retained;
    erase.changed = true;
    this.redraw();
    this.state();
  }
  sample(e, ending = false) {
    const active = this.active;
    if (!active || !this.viewport) return;
    if (active.stroke.points.length >= LIMITS.pointsPerStroke || this.totalPoints + active.stroke.points.length >= LIMITS.totalPoints) {
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
    this.schedulePaint();
  }
  finish(reason) {
    if (this.erasing) {
      const erase = this.erasing;
      this.erasing = void 0;
      this.lastPenAt = performance.now();
      try {
        this.ink.releasePointerCapture(erase.pointerId);
      } catch {
      }
      if (erase.changed) {
        this.eraseHistory.record(erase.before, this.strokes);
        this.updateEraseHistory();
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
      this.strokes.push(active.stroke);
      const ctx = this.context(this.committedInk);
      if (ctx) this.drawStroke(ctx, active.stroke);
      this.changed();
    }
    try {
      this.ink.releasePointerCapture(active.pointerId);
    } catch {
    }
    this.context(this.ink, true);
    this.paintedPoints = 0;
    this.state();
  }
  changed() {
    this.editVersion++;
    this.totalPoints = this.strokes.reduce((n, s) => n + s.points.length, 0);
    this.state();
    if (!this.saveDue) this.saveDue = performance.now() + 1500;
    window.clearTimeout(this.saveTimer);
    this.saveTimer = window.setTimeout(() => {
      this.saveDue = 0;
      if (this.active || this.erasing) return;
      void this.save().catch((e) => this.fail(e));
    }, Math.max(0, Math.min(250, this.saveDue - performance.now())));
  }
  updateEraseHistory() {
    this.eraseUndoButton.disabled = !this.eraseHistory.depth;
    this.eraseUndoButton.textContent = `\u6062\u590D\u64E6\u9664\uFF08\u5269\u4F59 ${this.eraseHistory.depth} \u6B65\uFF09`;
  }
  async save() {
    if (this.saveTask) return this.saveTask;
    if (!this.store) return;
    this.saveTask = (async () => {
      while (this.savedEditVersion < this.editVersion) {
        if (this.active || this.erasing) break;
        const version = this.editVersion;
        const started = performance.now();
        const snapshot = JSON.parse(JSON.stringify(this.strokes));
        const result = await this.store.save(snapshot, version);
        this.savedCount = result.count;
        this.savedEditVersion = result.editVersion;
        this.timings.saves++;
        this.timings.maxSaveMs = Math.max(this.timings.maxSaveMs, performance.now() - started);
        this.saveError = "";
        this.state();
      }
    })().catch((e) => {
      this.saveError = String(e);
      this.state();
      throw e;
    }).finally(() => {
      this.saveTask = void 0;
    });
    return this.saveTask;
  }
  async flush() {
    this.finish("flush");
    window.clearTimeout(this.saveTimer);
    this.saveDue = 0;
    if (!this.store) return;
    await this.save();
    this.state();
  }
  async exportReport() {
    await this.folder(ROOT);
    const report = {
      ...this.report,
      exportedAt: (/* @__PURE__ */ new Date()).toISOString(),
      runId: this.runId,
      strokesInMemory: this.strokes.length,
      strokesSaved: this.savedCount,
      revision: this.store?.revision ?? 0,
      saveError: this.saveError,
      pointer: this.pointerStats,
      errors: this.errors,
      editVersion: this.editVersion,
      savedEditVersion: this.savedEditVersion,
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
      eraseUndoDepth: this.eraseHistory.depth,
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
    this.renderGeneration++;
    this.renderTask?.cancel();
    if (this.store) await this.flush().catch((e) => this.fail(e));
    await this.renderTask?.promise.catch(() => void 0);
    this.page?.cleanup();
    await this.pdfTask?.destroy().catch((e) => this.fail(e));
  }
};
