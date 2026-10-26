import { ItemView, Notice, Plugin, WorkspaceLeaf, loadPdfJs, apiVersion } from 'obsidian';
import { LIMITS, Point, ProbeStore, Stroke, pdfPoint, sha256, validId, uniqueId, penWidth, hitsStroke } from './core';
import { workerProbe } from './capabilities';
import { PDF_BASE64 } from './generated/fixture';

const VIEW = 'inkpdf-device-probe';
const ROOT = 'InkPDF-Probe';
type Viewport = { width: number; height: number; transform: number[] };
type RenderTask = { promise: Promise<void>; cancel(): void };
type PdfPage = { getViewport(options: { scale: number }): Viewport; render(options: unknown): RenderTask; cleanup(): void };
type PdfDocument = { numPages: number; getPage(n: number): Promise<PdfPage>; destroy(): Promise<void> };

export default class InkPDFProbe extends Plugin {
  lastRun: string | null = null;
  async onload(): Promise<void> {
    try {
      const data = await this.loadData();
      if (validId(data?.lastRun)) this.lastRun = data.lastRun;
    } catch { new Notice('InkPDF：设置读取失败，可新建测试；未删除旧测试文件'); }
    this.registerView(VIEW, leaf => new ProbeView(leaf, this));
    this.addCommand({ id: 'open', name: '打开 / 继续设备探针', callback: () => { void this.open(false).catch(e => new Notice(String(e))); } });
    this.addCommand({ id: 'new-run', name: '新建独立设备测试', callback: () => { void this.open(true).catch(e => new Notice(String(e))); } });
    this.addRibbonIcon('pen-tool', 'InkPDF 设备探针', () => { void this.open(false).catch(e => new Notice(String(e))); });
  }
  async open(fresh: boolean): Promise<void> {
    const old = this.app.workspace.getLeavesOfType(VIEW);
    if (old.length && !fresh) { await this.app.workspace.revealLeaf(old[0]); return; }
    for (const leaf of old) {
      if (leaf.view instanceof ProbeView) await leaf.view.flush();
      leaf.detach();
    }
    if (fresh || !this.lastRun) {
      this.lastRun = uniqueId();
      await this.saveData({ lastRun: this.lastRun });
    }
    const leaf = this.app.workspace.getLeaf('tab');
    await leaf.setViewState({ type: VIEW, active: true });
    await this.app.workspace.revealLeaf(leaf);
  }
}

class ProbeView extends ItemView {
  private runId = '';
  private store?: ProbeStore;
  private strokes: Stroke[] = [];
  private savedCount = 0;
  private editVersion = 0;
  private savedEditVersion = 0;
  private active?: { pointerId: number; started: number; stroke: Stroke };
  private erasing?: { pointerId: number; before: Stroke[]; last: [number, number]; changed: boolean };
  private erasedBefore?: Stroke[];
  private eraseUndoButton!: HTMLButtonElement;
  private tool: 'pen' | 'eraser' = 'pen';
  private pressureGain = 2.5;
  private touches = new Set<number>();
  private pan?: { id: number; x: number; y: number; moving: boolean };
  private lastPenAt = -Infinity;
  private totalPoints = 0;
  private frame = 0;
  private paintedPoints = 0;
  private saveTimer?: number;
  private saveDue = 0;
  private renderedWidth = 0;
  private pdf?: PdfDocument;
  private page?: PdfPage;
  private viewport?: Viewport;
  private renderTask?: RenderTask;
  private renderGeneration = 0;
  private closed = false;
  private ready = false;
  private mode: 'write' | 'browse' = 'write';
  private zoom = 1;
  private dpr = 1;
  private saveTask?: Promise<void>;
  private saveError = '';
  private status!: HTMLElement;
  private capability!: HTMLElement;
  private scroll!: HTMLElement;
  private sheet!: HTMLElement;
  private pdfCanvas!: HTMLCanvasElement;
  private ink!: HTMLCanvasElement;
  private committedInk!: HTMLCanvasElement;
  private inputStatus!: HTMLElement;
  private timings = { paints: 0, maxPaintMs: 0, saves: 0, maxSaveMs: 0, maxEventGapMs: 0 };
  private endings: { reason: string; samples: number; durationMs: number }[] = [];
  private lastSampleTime = 0;
  private errors: string[] = [];
  private pointerStats = { penDown: 0, mouseDown: 0, touchDown: 0, canceled: 0, coalescedSamples: 0,
    pressureMin: null as number | null, pressureMax: null as number | null, penSamples: 0,
    lostCapture: 0, captureFailed: 0, touchPanMoves: 0, ignoredTouches: 0 };
  private report: Record<string, unknown> = {};
  constructor(leaf: WorkspaceLeaf, private plugin: InkPDFProbe) { super(leaf); }
  getViewType(): string { return VIEW; }
  getDisplayText(): string { return 'InkPDF 设备探针'; }
  getIcon(): string { return 'pen-tool'; }

  private button(parent: HTMLElement, text: string, fn: () => Promise<void> | void): HTMLButtonElement {
    const b = parent.createEl('button', { text });
    b.addEventListener('click', () => { void Promise.resolve().then(fn).catch(e => this.fail(e)); });
    return b;
  }
  private fail(error: unknown): void {
    const message = String(error);
    this.errors.push(message.slice(0, 400));
    this.errors = this.errors.slice(-20);
    this.status.textContent = `失败：${message}。文件保留；请导出诊断。`;
    new Notice(`InkPDF：${message}`, 8000);
  }
  private state(): void {
    if (!this.ready) return;
    const suffix = this.active || this.erasing ? '操作中，抬笔后保存' : this.saveError ? `保存失败：${this.saveError}` : this.savedEditVersion === this.editVersion ?
      `已保存并读回校验 · revision ${this.store?.revision ?? 0}` : '尚有未保存笔迹';
    this.status.textContent = `${this.strokes.length} 笔 / ${LIMITS.strokes} · ${suffix}`;
  }
  private async folder(path: string): Promise<void> {
    if (!await this.app.vault.adapter.exists(path)) {
      try { await this.app.vault.createFolder(path); }
      catch (e) { if (!await this.app.vault.adapter.exists(path)) throw e; }
    }
  }
  async onOpen(): Promise<void> {
    this.contentEl.empty();
    this.contentEl.addClass('inkpdf-probe');
    this.contentEl.createEl('h2', { text: 'InkPDF · 最小设备探针' });
    this.contentEl.createEl('p', { text: '仅测试单页 PDF。请先关闭 iPad 随手写 / Scribble。笔抬起后可单指滚动；笔落下时暂停手指导航。整笔橡皮可恢复最近一次擦除。' });
    const controls = this.contentEl.createDiv({ cls: 'inkpdf-probe-controls' });
    const modeButton = this.button(controls, '模式：书写', () => {
      this.finish('mode-change');
      this.pan = undefined;
      this.mode = this.mode === 'write' ? 'browse' : 'write';
      modeButton.textContent = this.mode === 'write' ? '模式：书写' : '模式：浏览';
      this.ink.style.touchAction = this.mode === 'write' ? 'none' : 'pan-x pan-y';
      this.scroll.style.touchAction = this.ink.style.touchAction;
    });
    const toolButton = this.button(controls, '工具：钢笔', () => {
      this.finish('tool-change');
      this.tool = this.tool === 'pen' ? 'eraser' : 'pen';
      toolButton.textContent = this.tool === 'pen' ? '工具：钢笔' : '工具：整笔橡皮';
    });
    this.eraseUndoButton = this.button(controls, '恢复上次擦除', () => {
      this.finish('restore');
      if (!this.erasedBefore) return;
      this.strokes = this.erasedBefore;
      this.erasedBefore = undefined;
      this.eraseUndoButton.disabled = true;
      this.changed(); this.redraw();
    });
    this.eraseUndoButton.disabled = true;
    const gainLabel = controls.createEl('label', { cls: 'inkpdf-probe-gain', text: '压感增益 ' });
    const gain = gainLabel.createEl('select', { attr: { 'aria-label': '压感增益（只影响新笔迹）' } });
    for (const n of [1, 2.5, 4]) gain.createEl('option', { text: `${n}×`, attr: { value: String(n) } });
    gain.value = '2.5';
    gain.addEventListener('change', () => { this.finish('pressure-change'); this.pressureGain = Number(gain.value); });
    for (const zoom of [1, 1.5, 2]) this.button(controls, `${zoom * 100}%`, async () => {
      this.finish('zoom'); this.zoom = zoom; await this.render();
    });
    this.button(controls, '保存 / 重试', () => this.flush());
    this.button(controls, '保存并重新读取', async () => {
      await this.flush();
      if (!this.store) throw new Error('存储尚未初始化');
      const loaded = await this.store.load();
      if (JSON.stringify(loaded) !== JSON.stringify(this.strokes)) {
        this.ready = false;
        throw new Error('重读数据不同，停止编辑');
      }
      this.strokes = loaded; this.savedCount = loaded.length;
      this.totalPoints = loaded.reduce((n, s) => n + s.points.length, 0);
      this.report.reopenReadback = { status: 'PASS', strokeCount: loaded.length, revision: this.store.revision };
      this.redraw(); this.state();
      new Notice(`InkPDF：已从磁盘重新读取 ${loaded.length} 笔`);
    });
    this.button(controls, '复测 Worker', () => this.probeWorker());
    this.button(controls, '导出诊断', () => this.exportReport());
    this.status = this.contentEl.createDiv({ cls: 'inkpdf-probe-status', attr: { role: 'status', 'aria-live': 'polite' }, text: '初始化中…' });
    this.capability = this.contentEl.createDiv({ cls: 'inkpdf-probe-capability', text: 'Worker 检测中…' });
    this.inputStatus = this.contentEl.createDiv({ cls: 'inkpdf-probe-capability', text: '笔压力：尚无采样。Scribble 状态需在系统设置中确认。' });
    this.scroll = this.contentEl.createDiv({ cls: 'inkpdf-probe-scroll' });
    this.scroll.style.touchAction = 'none';
    this.sheet = this.scroll.createDiv({ cls: 'inkpdf-probe-sheet' });
    this.pdfCanvas = this.sheet.createEl('canvas');
    this.committedInk = this.sheet.createEl('canvas', { cls: 'inkpdf-probe-committed' });
    this.ink = this.sheet.createEl('canvas', { cls: 'inkpdf-probe-ink', attr: { 'aria-label': 'PDF 手写测试画布' } });
    this.ink.style.touchAction = 'none';
    this.registerDomEvent(this.scroll, 'pointerdown', e => { if (e.pointerType === 'touch' || e.target === this.ink) this.down(e); });
    this.registerDomEvent(document, 'pointermove', e => this.move(e));
    this.registerDomEvent(document, 'pointerup', e => {
      this.endTouch(e);
      if (e.pointerId === this.erasing?.pointerId) { this.eraseAt(e); this.finish('pointerup'); return; }
      if (e.pointerId !== this.active?.pointerId) return;
      this.sample(e, true);
      this.finish('pointerup');
    });
    this.registerDomEvent(document, 'pointercancel', e => {
      this.endTouch(e);
      if (e.pointerId === this.active?.pointerId || e.pointerId === this.erasing?.pointerId) { this.pointerStats.canceled++; this.finish('pointercancel'); }
    });
    this.registerDomEvent(this.ink, 'lostpointercapture', e => {
      if (e.pointerId === this.active?.pointerId || e.pointerId === this.erasing?.pointerId) this.pointerStats.lostCapture++;
      // Document-level move/up handlers continue the same stroke after capture loss.
    });
    this.registerDomEvent(document, 'visibilitychange', () => {
      if (document.hidden) { this.finish('hidden'); void this.flush().catch(e => this.fail(e)); }
    });
    this.registerDomEvent(window, 'pagehide', () => { this.finish('pagehide'); void this.flush().catch(e => this.fail(e)); });
    let resizeTimer: number | undefined;
    const observer = new ResizeObserver(() => {
      window.clearTimeout(resizeTimer);
      resizeTimer = window.setTimeout(() => {
        if (Math.abs(this.scroll.clientWidth - this.renderedWidth) < 1) return;
        this.finish('resize-width'); void this.render().catch(e => this.fail(e));
      }, 150);
    });
    observer.observe(this.scroll);
    this.register(() => { observer.disconnect(); window.clearTimeout(resizeTimer); });
    this.register(() => { cancelAnimationFrame(this.frame); window.clearTimeout(this.saveTimer); });
    this.report = { probeVersion: this.plugin.manifest.version, obsidianApiVersion: apiVersion,
      userAgent: navigator.userAgent, devicePixelRatio, secureContext: isSecureContext,
      pointerEvents: typeof PointerEvent !== 'undefined', coalescedEvents: typeof PointerEvent !== 'undefined' && 'getCoalescedEvents' in PointerEvent.prototype,
      cryptoSubtle: !!globalThis.crypto?.subtle, crossOriginIsolated: globalThis.crossOriginIsolated,
      limits: LIMITS, scope: 'One synthetic PDF; no OCR, no multitouch gesture engine',
      manualResults: { pencil: 'NOT RUN', pressureVariation: 'NOT RUN', palmRejection: 'NOT RUN', appRestart: 'NOT RUN', backgroundKill: 'NOT RUN' } };
    void this.probeWorker();
    try { await this.initialize(); }
    catch (e) { this.ready = false; this.fail(e); }
  }

  private async initialize(): Promise<void> {
    const bytes = Uint8Array.from(atob(PDF_BASE64), c => c.charCodeAt(0));
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
    if (await sha256(diskBytes) !== sourceHash) throw new Error('测试 PDF 已改变，拒绝覆盖或叠加');
    this.store = new ProbeStore({
      list: async () => {
        const { files } = await this.app.vault.adapter.list(`${dir}/snapshots`);
        return files.filter(f => f.endsWith('.json')).map(f => f.slice(f.lastIndexOf('/') + 1));
      },
      read: path => this.app.vault.adapter.read(`${dir}/snapshots/${path}`),
      create: async (path, text) => { await this.app.vault.create(`${dir}/snapshots/${path}`, text); }
    }, this.runId, sourceHash);
    this.strokes = await this.store.load();
    this.savedCount = this.strokes.length;
    this.totalPoints = this.strokes.reduce((n, s) => n + s.points.length, 0);
    this.report.loadedFromDisk = { strokeCount: this.savedCount, revision: this.store.revision };
    this.report.sourceHash = sourceHash;
    const started = performance.now();
    const lib = await loadPdfJs();
    if (typeof lib?.getDocument !== 'function') throw new Error('loadPdfJs 未提供 getDocument');
    this.report.pdfjsVersion = lib.version ?? 'unknown';
    const task = lib.getDocument({ data: diskBytes, isEvalSupported: false, enableXfa: false, disableAutoFetch: true, disableStream: true });
    // shortcut: this fixture is unencrypted; general PDF/password support belongs to a later stage.
    this.pdf = await task.promise as PdfDocument;
    if (this.closed) { await this.pdf.destroy(); return; }
    if (this.pdf.numPages !== 1) throw new Error('测试夹具应当只有一页');
    this.page = await this.pdf.getPage(1);
    await this.render();
    if (this.closed) return;
    this.report.pdf = { status: 'PASS', elapsedMs: Math.round(performance.now() - started), pages: 1 };
    this.ready = true;
    this.state();
  }
  private async probeWorker(): Promise<void> {
    const result = await workerProbe();
    this.report.worker = result;
    if (!this.closed) this.capability.textContent = `Blob module Worker + 基础 WASM：${result.status}（不代表 ORT/SIMD 或 OCR 已通过）`;
  }
  private async render(): Promise<void> {
    if (!this.page || this.closed) return;
    const generation = ++this.renderGeneration;
    const previous = this.renderTask;
    previous?.cancel();
    await previous?.promise.catch(() => undefined);
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
    const context = this.pdfCanvas.getContext('2d');
    if (!context) throw new Error('Canvas 2D unavailable');
    const task = this.page.render({ canvas: this.pdfCanvas, canvasContext: context, viewport,
      transform: [this.dpr, 0, 0, this.dpr, 0, 0] });
    this.renderTask = task;
    try { await task.promise; }
    catch (e) { if (generation === this.renderGeneration && !this.closed) throw e; }
    if (generation === this.renderGeneration && !this.closed) this.redraw();
  }
  private context(canvas: HTMLCanvasElement, clear = false): CanvasRenderingContext2D | null {
    if (!this.viewport) return null;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    if (clear) ctx.clearRect(0, 0, canvas.width, canvas.height);
    const [a, b, c, d, e, f] = this.viewport.transform.map(n => n * this.dpr);
    ctx.setTransform(a, b, c, d, e, f);
    ctx.strokeStyle = '#155ac4'; ctx.fillStyle = '#155ac4'; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    return ctx;
  }
  private drawStroke(ctx: CanvasRenderingContext2D, stroke: Stroke, start = 0): void {
      const width = (p: Point) => penWidth(p, stroke.pressureGain);
      const first = stroke.points[0];
      if (!first) return;
      if (start === 0) {
        ctx.beginPath(); ctx.arc(first[0], first[1], width(first) / 2, 0, Math.PI * 2); ctx.fill();
      }
      for (let i = Math.max(1, start); i < stroke.points.length; i++) {
        const p = stroke.points[i], prev = stroke.points[i - 1];
        ctx.lineWidth = (width(p) + width(prev)) / 2;
        ctx.beginPath(); ctx.moveTo(prev[0], prev[1]); ctx.lineTo(p[0], p[1]); ctx.stroke();
      }
  }
  private redraw(): void {
    const ctx = this.context(this.committedInk, true);
    if (ctx) for (const s of this.strokes) this.drawStroke(ctx, s);
    this.context(this.ink, true);
    this.paintedPoints = 0;
    this.paintActive();
  }
  private paintActive(): void {
    const started = performance.now();
    const ctx = this.context(this.ink);
    if (ctx && this.active) {
      this.drawStroke(ctx, this.active.stroke, this.paintedPoints);
      this.paintedPoints = this.active.stroke.points.length;
      const p = this.active.stroke.points.at(-1)?.[2];
      this.inputStatus.textContent = `当前原始压力 ${p?.toFixed(3) ?? '无'} · 本次范围 ${this.pointerStats.pressureMin?.toFixed(3) ?? '-'}～${this.pointerStats.pressureMax?.toFixed(3) ?? '-'} · 增益 ${this.pressureGain}×`;
    }
    this.timings.paints++;
    this.timings.maxPaintMs = Math.max(this.timings.maxPaintMs, performance.now() - started);
  }
  private schedulePaint(): void {
    if (this.frame) return;
    this.frame = requestAnimationFrame(() => { this.frame = 0; this.paintActive(); });
  }
  private down(e: PointerEvent): void {
    if (e.pointerType === 'touch') {
      this.pointerStats.touchDown++;
      this.touches.add(e.pointerId);
      if (this.mode === 'browse') return;
      e.preventDefault();
      if (this.touches.size !== 1 || this.active || this.erasing || performance.now() - this.lastPenAt < 180 || Math.max(e.width, e.height) > 40) {
        this.pan = undefined; this.pointerStats.ignoredTouches++; return;
      }
      this.pan = { id: e.pointerId, x: e.clientX, y: e.clientY, moving: false };
      try { this.ink.setPointerCapture(e.pointerId); } catch { this.pointerStats.captureFailed++; }
      return;
    }
    if (!this.ready || !this.viewport || this.mode !== 'write' || !['pen', 'mouse'].includes(e.pointerType) || e.button !== 0) return;
    if (this.active || this.erasing) this.finish('superseded-down');
    if (this.tool === 'pen' && (this.strokes.length >= LIMITS.strokes || this.totalPoints >= LIMITS.totalPoints)) {
      new Notice('已达探针上限，请导出诊断后新建独立测试'); return;
    }
    e.preventDefault();
    this.pan = undefined;
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
    this.lastPenAt = performance.now();
    if (e.pointerType === 'pen') this.pointerStats.penDown++; else this.pointerStats.mouseDown++;
    try { this.ink.setPointerCapture(e.pointerId); } catch { this.pointerStats.captureFailed++; }
    if (this.tool === 'eraser') {
      this.erasing = { pointerId: e.pointerId, before: this.strokes.slice(), last: this.eventPoint(e), changed: false };
      this.eraseAt(e); this.state(); return;
    }
    this.erasedBefore = undefined; this.eraseUndoButton.disabled = true;
    this.paintedPoints = 0;
    this.lastSampleTime = e.timeStamp;
    this.active = { pointerId: e.pointerId, started: e.timeStamp, stroke: { id: uniqueId(), pointerType: e.pointerType, interrupted: false, points: [], pressureGain: this.pressureGain } };
    this.sample(e); this.schedulePaint(); this.state();
  }
  private eventPoint(e: PointerEvent): [number, number] {
    const rect = this.ink.getBoundingClientRect();
    return pdfPoint(this.viewport!.transform,
      (e.clientX - rect.left) * this.viewport!.width / rect.width,
      (e.clientY - rect.top) * this.viewport!.height / rect.height);
  }
  private endTouch(e: PointerEvent): void {
    if (e.pointerType !== 'touch') return;
    this.touches.delete(e.pointerId);
    if (this.pan?.id === e.pointerId) this.pan = undefined;
    try { this.ink.releasePointerCapture(e.pointerId); } catch { /* Capture may already be released. */ }
  }
  private eraseAt(e: PointerEvent): void {
    const erase = this.erasing;
    if (!erase || !this.viewport) return;
    const to = this.eventPoint(e);
    const radius = 10 / Math.hypot(this.viewport.transform[0], this.viewport.transform[1]);
    const retained = this.strokes.filter(s => !hitsStroke(s, erase.last, to, radius));
    erase.last = to;
    if (retained.length === this.strokes.length) return;
    this.strokes = retained; erase.changed = true;
    this.redraw(); this.state();
  }
  private sample(e: PointerEvent, ending = false): void {
    const active = this.active;
    if (!active || !this.viewport) return;
    if (active.stroke.points.length >= LIMITS.pointsPerStroke ||
        this.totalPoints + active.stroke.points.length >= LIMITS.totalPoints) {
      this.finish('sample-limit'); new Notice('笔迹点数达到探针上限，已结束该笔'); return;
    }
    const [x, y] = this.eventPoint(e);
    const last = active.stroke.points.at(-1);
    const pressure = ending && last ? last[2] : active.stroke.pointerType === 'pen' && Number.isFinite(e.pressure) ? Math.max(0, Math.min(1, e.pressure)) : null;
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
  private move(e: PointerEvent): void {
    if (e.pointerType === 'touch') {
      if (this.mode === 'browse' || e.pointerId !== this.pan?.id || this.active || this.erasing) return;
      e.preventDefault();
      const p = this.pan;
      if (!p.moving && Math.hypot(e.clientX - p.x, e.clientY - p.y) < 8) return;
      p.moving = true;
      this.scroll.scrollLeft += p.x - e.clientX;
      this.scroll.scrollTop += p.y - e.clientY;
      p.x = e.clientX; p.y = e.clientY;
      this.pointerStats.touchPanMoves++; return;
    }
    if (e.pointerId === this.erasing?.pointerId) { e.preventDefault(); this.eraseAt(e); return; }
    if (e.pointerId !== this.active?.pointerId) return;
    e.preventDefault();
    const points = typeof e.getCoalescedEvents === 'function' ? e.getCoalescedEvents() : [];
    this.pointerStats.coalescedSamples += points.length;
    for (const p of points) this.sample(p);
    this.sample(e);
    this.schedulePaint();
  }
  private finish(reason: string): void {
    if (this.erasing) {
      const erase = this.erasing; this.erasing = undefined;
      this.lastPenAt = performance.now();
      try { this.ink.releasePointerCapture(erase.pointerId); } catch { /* The system can revoke capture. */ }
      if (erase.changed) {
        this.erasedBefore = erase.before; this.eraseUndoButton.disabled = false;
        this.changed();
      }
      this.state(); return;
    }
    if (!this.active) return;
    const active = this.active;
    this.active = undefined;
    active.stroke.interrupted = reason !== 'pointerup';
    this.lastPenAt = performance.now();
    this.endings.push({ reason, samples: active.stroke.points.length, durationMs: active.stroke.points.at(-1)?.[3] ?? 0 });
    this.endings = this.endings.slice(-30);
    if (active.stroke.points.length) {
      this.strokes.push(active.stroke);
      const ctx = this.context(this.committedInk);
      if (ctx) this.drawStroke(ctx, active.stroke);
      this.changed();
    }
    try { this.ink.releasePointerCapture(active.pointerId); } catch { /* Capture can be revoked by WebView. */ }
    this.context(this.ink, true); this.paintedPoints = 0; this.state();
  }
  private changed(): void {
    this.editVersion++;
    this.totalPoints = this.strokes.reduce((n, s) => n + s.points.length, 0);
    this.state();
    if (!this.saveDue) this.saveDue = performance.now() + 1500;
    window.clearTimeout(this.saveTimer);
    this.saveTimer = window.setTimeout(() => {
      this.saveDue = 0;
      if (this.active || this.erasing) return; // The next completed edit schedules another save.
      void this.save().catch(e => this.fail(e));
    }, Math.max(0, Math.min(250, this.saveDue - performance.now())));
  }
  private async save(): Promise<void> {
    if (this.saveTask) return this.saveTask;
    if (!this.store) return;
    this.saveTask = (async () => {
      while (this.savedEditVersion < this.editVersion) {
        if (this.active || this.erasing) break;
        const version = this.editVersion;
        const started = performance.now();
        const snapshot = JSON.parse(JSON.stringify(this.strokes)) as Stroke[];
        const result = await this.store!.save(snapshot, version);
        this.savedCount = result.count;
        this.savedEditVersion = result.editVersion;
        this.timings.saves++;
        this.timings.maxSaveMs = Math.max(this.timings.maxSaveMs, performance.now() - started);
        this.saveError = '';
        this.state();
      }
    })().catch(e => { this.saveError = String(e); this.state(); throw e; }).finally(() => { this.saveTask = undefined; });
    return this.saveTask;
  }
  async flush(): Promise<void> {
    this.finish('flush');
    window.clearTimeout(this.saveTimer); this.saveDue = 0;
    if (!this.store) throw new Error('存储未初始化');
    await this.save();
    this.state();
  }
  private async exportReport(): Promise<void> {
    await this.folder(ROOT);
    const report = { ...this.report, exportedAt: new Date().toISOString(), runId: this.runId,
      strokesInMemory: this.strokes.length, strokesSaved: this.savedCount, revision: this.store?.revision ?? 0,
      saveError: this.saveError, pointer: this.pointerStats, errors: this.errors,
      editVersion: this.editVersion, savedEditVersion: this.savedEditVersion,
      inputEndings: this.endings, timings: this.timings, pressureGain: this.pressureGain,
      drawing: 'Incremental active ink + committed canvas; finger pan while pen is up; whole-stroke eraser',
      privacy: 'No handwriting coordinates, recognized text or PDF bytes included. Local file only.' };
    const path = `${ROOT}/diagnostic-${Date.now()}-${uniqueId()}.json`;
    await this.app.vault.create(path, JSON.stringify(report, null, 2));
    new Notice(`诊断已保存在 ${path}；没有上传`, 10000);
  }
  async onClose(): Promise<void> {
    this.finish('view-close');
    this.closed = true;
    this.renderGeneration++;
    this.renderTask?.cancel();
    if (this.store) await this.flush().catch(e => this.fail(e));
    await this.renderTask?.promise.catch(() => undefined);
    this.page?.cleanup();
    await this.pdf?.destroy().catch(e => this.fail(e));
  }
}
