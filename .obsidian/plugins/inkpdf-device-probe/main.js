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
  async save(strokes) {
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
      this.pending = { path: `${String(snapshot.revision).padStart(6, "0")}-${uniqueId()}.json`, raw, snapshot: frozen };
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
    return p.snapshot.strokes.length;
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
  async onload() {
    try {
      const data = await this.loadData();
      if (validId(data?.lastRun)) this.lastRun = data.lastRun;
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
    this.addRibbonIcon("pen-tool", "InkPDF \u8BBE\u5907\u63A2\u9488", () => {
      void this.open(false).catch((e) => new import_obsidian.Notice(String(e)));
    });
  }
  async open(fresh) {
    const old = this.app.workspace.getLeavesOfType(VIEW);
    if (old.length && !fresh) {
      await this.app.workspace.revealLeaf(old[0]);
      return;
    }
    for (const leaf2 of old) {
      if (leaf2.view instanceof ProbeView) await leaf2.view.flush();
      leaf2.detach();
    }
    if (fresh || !this.lastRun) {
      this.lastRun = uniqueId();
      await this.saveData({ lastRun: this.lastRun });
    }
    const leaf = this.app.workspace.getLeaf("tab");
    await leaf.setViewState({ type: VIEW, active: true });
    await this.app.workspace.revealLeaf(leaf);
  }
};
var ProbeView = class extends import_obsidian.ItemView {
  constructor(leaf, plugin) {
    super(leaf);
    this.plugin = plugin;
  }
  plugin;
  runId = "";
  store;
  strokes = [];
  savedCount = 0;
  active;
  pdf;
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
  errors = [];
  pointerStats = {
    penDown: 0,
    mouseDown: 0,
    touchDown: 0,
    canceled: 0,
    coalescedSamples: 0,
    pressureMin: null,
    pressureMax: null,
    penSamples: 0
  };
  report = {};
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
    const suffix = this.saveError ? `\u4FDD\u5B58\u5931\u8D25\uFF1A${this.saveError}` : this.savedCount === this.strokes.length ? `\u5DF2\u4FDD\u5B58\u5E76\u8BFB\u56DE\u6821\u9A8C \xB7 revision ${this.store?.revision ?? 0}` : "\u5C1A\u6709\u672A\u4FDD\u5B58\u7B14\u8FF9";
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
    this.contentEl.createEl("p", { text: "\u4EC5\u6D4B\u8BD5\u8FD9\u4E00\u9875\u5408\u6210 PDF\u3002\u7B14\u53EF\u5199\u3001\u624B\u6307\u4E0D\u753B\uFF1B\u5199\u5165\u6A21\u5F0F\u7528\u5DE5\u5177\u680F\u7F29\u653E\uFF0C\u6D4F\u89C8\u6A21\u5F0F\u7528\u624B\u6307\u6EDA\u52A8\u3002\u4E0D\u662F\u5B8C\u6574\u6279\u6CE8\u63D2\u4EF6\u3002" });
    const controls = this.contentEl.createDiv({ cls: "inkpdf-probe-controls" });
    const modeButton = this.button(controls, "\u6A21\u5F0F\uFF1A\u4E66\u5199", () => {
      this.finish(true);
      this.mode = this.mode === "write" ? "browse" : "write";
      modeButton.textContent = this.mode === "write" ? "\u6A21\u5F0F\uFF1A\u4E66\u5199" : "\u6A21\u5F0F\uFF1A\u6D4F\u89C8";
      this.ink.style.touchAction = this.mode === "write" ? "none" : "pan-x pan-y";
    });
    for (const zoom of [1, 1.5, 2]) this.button(controls, `${zoom * 100}%`, async () => {
      this.finish(true);
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
      this.report.reopenReadback = { status: "PASS", strokeCount: loaded.length, revision: this.store.revision };
      this.redraw();
      this.state();
      new import_obsidian.Notice(`InkPDF\uFF1A\u5DF2\u4ECE\u78C1\u76D8\u91CD\u65B0\u8BFB\u53D6 ${loaded.length} \u7B14`);
    });
    this.button(controls, "\u590D\u6D4B Worker", () => this.probeWorker());
    this.button(controls, "\u5BFC\u51FA\u8BCA\u65AD", () => this.exportReport());
    this.status = this.contentEl.createDiv({ cls: "inkpdf-probe-status", attr: { role: "status", "aria-live": "polite" }, text: "\u521D\u59CB\u5316\u4E2D\u2026" });
    this.capability = this.contentEl.createDiv({ cls: "inkpdf-probe-capability", text: "Worker \u68C0\u6D4B\u4E2D\u2026" });
    this.scroll = this.contentEl.createDiv({ cls: "inkpdf-probe-scroll" });
    this.sheet = this.scroll.createDiv({ cls: "inkpdf-probe-sheet" });
    this.pdfCanvas = this.sheet.createEl("canvas");
    this.ink = this.sheet.createEl("canvas", { cls: "inkpdf-probe-ink", attr: { "aria-label": "PDF \u624B\u5199\u6D4B\u8BD5\u753B\u5E03" } });
    this.ink.style.touchAction = "none";
    this.registerDomEvent(this.ink, "pointerdown", (e) => this.down(e));
    this.registerDomEvent(this.ink, "pointermove", (e) => this.move(e));
    this.registerDomEvent(this.ink, "pointerup", (e) => {
      if (e.pointerId !== this.active?.pointerId) return;
      this.finish(false);
    });
    this.registerDomEvent(this.ink, "pointercancel", (e) => {
      if (e.pointerId === this.active?.pointerId) {
        this.pointerStats.canceled++;
        this.finish(true);
      }
    });
    this.registerDomEvent(this.ink, "lostpointercapture", (e) => {
      if (e.pointerId === this.active?.pointerId) this.finish(true);
    });
    this.registerDomEvent(document, "visibilitychange", () => {
      if (document.hidden) {
        this.finish(true);
        void this.flush().catch((e) => this.fail(e));
      }
    });
    this.registerDomEvent(window, "pagehide", () => {
      this.finish(true);
      void this.flush().catch((e) => this.fail(e));
    });
    let resizeTimer;
    const observer = new ResizeObserver(() => {
      window.clearTimeout(resizeTimer);
      resizeTimer = window.setTimeout(() => {
        this.finish(true);
        void this.render().catch((e) => this.fail(e));
      }, 150);
    });
    observer.observe(this.scroll);
    this.register(() => {
      observer.disconnect();
      window.clearTimeout(resizeTimer);
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
      scope: "One synthetic PDF; no OCR, no multitouch gesture engine",
      manualResults: { pencil: "NOT RUN", pressureVariation: "NOT RUN", palmRejection: "NOT RUN", appRestart: "NOT RUN", backgroundKill: "NOT RUN" }
    };
    void this.probeWorker();
    try {
      await this.initialize();
    } catch (e) {
      this.ready = false;
      this.fail(e);
    }
  }
  async initialize() {
    const bytes = Uint8Array.from(atob(PDF_BASE64), (c) => c.charCodeAt(0));
    const sourceHash = await sha256(bytes);
    if (!this.plugin.lastRun) {
      this.plugin.lastRun = uniqueId();
      await this.plugin.saveData({ lastRun: this.plugin.lastRun });
    }
    this.runId = this.plugin.lastRun;
    const dir = `${ROOT}/${this.runId}`;
    for (const p of [ROOT, dir, `${dir}/snapshots`]) await this.folder(p);
    const pdfPath = `${dir}/probe.pdf`;
    if (!await this.app.vault.adapter.exists(pdfPath)) await this.app.vault.createBinary(pdfPath, bytes.slice().buffer);
    const diskBytes = new Uint8Array(await this.app.vault.adapter.readBinary(pdfPath));
    if (await sha256(diskBytes) !== sourceHash) throw new Error("\u6D4B\u8BD5 PDF \u5DF2\u6539\u53D8\uFF0C\u62D2\u7EDD\u8986\u76D6\u6216\u53E0\u52A0");
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
    this.report.loadedFromDisk = { strokeCount: this.savedCount, revision: this.store.revision };
    this.report.sourceHash = sourceHash;
    const started = performance.now();
    const lib = await (0, import_obsidian.loadPdfJs)();
    if (typeof lib?.getDocument !== "function") throw new Error("loadPdfJs \u672A\u63D0\u4F9B getDocument");
    this.report.pdfjsVersion = lib.version ?? "unknown";
    const task = lib.getDocument({ data: diskBytes, isEvalSupported: false, enableXfa: false, disableAutoFetch: true, disableStream: true });
    this.pdf = await task.promise;
    if (this.closed) {
      await this.pdf.destroy();
      return;
    }
    if (this.pdf.numPages !== 1) throw new Error("\u6D4B\u8BD5\u5939\u5177\u5E94\u5F53\u53EA\u6709\u4E00\u9875");
    this.page = await this.pdf.getPage(1);
    await this.render();
    if (this.closed) return;
    this.report.pdf = { status: "PASS", elapsedMs: Math.round(performance.now() - started), pages: 1 };
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
    const scale = Math.max(0.2, Math.min(1.2, (this.scroll.clientWidth - 24) / base.width)) * this.zoom;
    const viewport = this.page.getViewport({ scale });
    pdfPoint(viewport.transform, 0, 0);
    this.viewport = viewport;
    this.dpr = Math.min(devicePixelRatio || 1, 2, 4096 / Math.max(viewport.width, viewport.height));
    this.sheet.style.width = `${viewport.width}px`;
    this.sheet.style.height = `${viewport.height}px`;
    for (const canvas of [this.pdfCanvas, this.ink]) {
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
  redraw() {
    if (!this.viewport) return;
    const ctx = this.ink.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, this.ink.width, this.ink.height);
    const [a, b, c, d, e, f] = this.viewport.transform.map((n) => n * this.dpr);
    ctx.setTransform(a, b, c, d, e, f);
    ctx.strokeStyle = "#155ac4";
    ctx.fillStyle = "#155ac4";
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    for (const stroke of this.active ? [...this.strokes, this.active.stroke] : this.strokes) {
      const width = (p) => p[2] === null ? 1.8 : 0.8 + p[2] * 3;
      const first = stroke.points[0];
      if (!first) continue;
      if (stroke.points.length === 1) {
        ctx.beginPath();
        ctx.arc(first[0], first[1], width(first) / 2, 0, Math.PI * 2);
        ctx.fill();
      }
      for (let i = 1; i < stroke.points.length; i++) {
        const p = stroke.points[i], prev = stroke.points[i - 1];
        ctx.lineWidth = (width(p) + width(prev)) / 2;
        ctx.beginPath();
        ctx.moveTo(prev[0], prev[1]);
        ctx.lineTo(p[0], p[1]);
        ctx.stroke();
      }
    }
  }
  down(e) {
    if (e.pointerType === "touch") {
      this.pointerStats.touchDown++;
      return;
    }
    if (!this.ready || !this.viewport || this.mode !== "write" || this.active || !["pen", "mouse"].includes(e.pointerType) || e.button !== 0) return;
    if (this.strokes.length >= LIMITS.strokes || this.strokes.reduce((n, s) => n + s.points.length, 0) >= LIMITS.totalPoints) {
      new import_obsidian.Notice("\u5DF2\u8FBE\u63A2\u9488\u4E0A\u9650\uFF0C\u8BF7\u5BFC\u51FA\u8BCA\u65AD\u540E\u65B0\u5EFA\u72EC\u7ACB\u6D4B\u8BD5");
      return;
    }
    e.preventDefault();
    if (e.pointerType === "pen") this.pointerStats.penDown++;
    else this.pointerStats.mouseDown++;
    this.active = { pointerId: e.pointerId, started: e.timeStamp, stroke: { id: uniqueId(), pointerType: e.pointerType, interrupted: false, points: [] } };
    try {
      this.ink.setPointerCapture(e.pointerId);
    } catch {
    }
    this.sample(e);
    this.redraw();
  }
  sample(e) {
    const active = this.active;
    if (!active || !this.viewport) return;
    if (active.stroke.points.length >= LIMITS.pointsPerStroke || this.strokes.reduce((n, s) => n + s.points.length, 0) + active.stroke.points.length >= LIMITS.totalPoints) {
      this.finish(true);
      new import_obsidian.Notice("\u7B14\u8FF9\u70B9\u6570\u8FBE\u5230\u63A2\u9488\u4E0A\u9650\uFF0C\u5DF2\u7ED3\u675F\u8BE5\u7B14");
      return;
    }
    const rect = this.ink.getBoundingClientRect();
    const [x, y] = pdfPoint(
      this.viewport.transform,
      (e.clientX - rect.left) * this.viewport.width / rect.width,
      (e.clientY - rect.top) * this.viewport.height / rect.height
    );
    const pressure = e.pointerType === "pen" && Number.isFinite(e.pressure) ? Math.max(0, Math.min(1, e.pressure)) : null;
    const last = active.stroke.points.at(-1);
    const t = Math.max(last?.[3] ?? 0, e.timeStamp - active.started, 0);
    active.stroke.points.push([x, y, pressure, t]);
    if (pressure !== null) {
      this.pointerStats.penSamples++;
      this.pointerStats.pressureMin = Math.min(this.pointerStats.pressureMin ?? pressure, pressure);
      this.pointerStats.pressureMax = Math.max(this.pointerStats.pressureMax ?? pressure, pressure);
    }
  }
  move(e) {
    if (e.pointerId !== this.active?.pointerId) return;
    e.preventDefault();
    const points = typeof e.getCoalescedEvents === "function" ? e.getCoalescedEvents() : [];
    this.pointerStats.coalescedSamples += points.length;
    for (const p of points.length ? points : [e]) this.sample(p);
    this.redraw();
  }
  finish(interrupted) {
    if (!this.active) return;
    const active = this.active;
    this.active = void 0;
    active.stroke.interrupted = interrupted;
    if (active.stroke.points.length) this.strokes.push(active.stroke);
    try {
      this.ink.releasePointerCapture(active.pointerId);
    } catch {
    }
    this.redraw();
    this.state();
    void this.save().catch((e) => this.fail(e));
  }
  async save() {
    if (this.saveTask) return this.saveTask;
    if (!this.store) return;
    this.saveTask = (async () => {
      while (this.savedCount < this.strokes.length) {
        const snapshot = JSON.parse(JSON.stringify(this.strokes));
        this.savedCount = await this.store.save(snapshot);
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
    this.finish(true);
    if (!this.store) throw new Error("\u5B58\u50A8\u672A\u521D\u59CB\u5316");
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
      privacy: "No handwriting coordinates, recognized text or PDF bytes included. Local file only."
    };
    const path = `${ROOT}/diagnostic-${Date.now()}-${uniqueId()}.json`;
    await this.app.vault.create(path, JSON.stringify(report, null, 2));
    new import_obsidian.Notice(`\u8BCA\u65AD\u5DF2\u4FDD\u5B58\u5728 ${path}\uFF1B\u6CA1\u6709\u4E0A\u4F20`, 1e4);
  }
  async onClose() {
    this.closed = true;
    this.renderGeneration++;
    this.renderTask?.cancel();
    if (this.store) await this.flush().catch((e) => this.fail(e));
    await this.renderTask?.promise.catch(() => void 0);
    this.page?.cleanup();
    await this.pdf?.destroy().catch((e) => this.fail(e));
  }
};
