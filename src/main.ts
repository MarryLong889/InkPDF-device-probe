import { ItemView, Notice, Plugin, WorkspaceLeaf, loadPdfJs, apiVersion, FuzzySuggestModal, TFile } from 'obsidian';
import { LIMITS, Point, ProbeStore, Stroke, pdfPoint, sha256, validId, uniqueId, strokeWidth, hitsStroke, EditHistory } from './core';
import { fitShape, ShapeFitMetrics } from './shapes';
import { workerProbe } from './capabilities';
import { PDF_BASE64 } from './generated/fixture';

const VIEW = 'inkpdf-device-probe';
const ROOT = 'InkPDF-Probe';
const SHAPE_HOLD_MS = 1000;
const SHAPE_SLOP_PX = 4;
type Viewport = { width: number; height: number; transform: number[] };
type RenderTask = { promise: Promise<void>; cancel(): void };
type PdfPage = { getViewport(options: { scale: number }): Viewport; render(options: unknown): RenderTask; cleanup(): void };
type PdfDocument = { numPages: number; getPage(n: number): Promise<PdfPage> };

export default class InkPDFProbe extends Plugin {
  lastRun: string | null = null;
  lastPdfPath: string | null = null;
  lastPage = 1;
  private opening = false;
  async remember(): Promise<void> { await this.saveData({ lastRun: this.lastRun, lastPdfPath: this.lastPdfPath, lastPage: this.lastPage }); }
  choosePdf(): void {
    const plugin = this;
    new class extends FuzzySuggestModal<TFile> {
      getItems(): TFile[] { return plugin.app.vault.getFiles().filter(f => f.extension.toLowerCase() === 'pdf'); }
      getItemText(file: TFile): string { return file.path; }
      onChooseItem(file: TFile): void { void plugin.open(true, file.path).catch(e => new Notice(String(e))); }
    }(this.app).open();
  }
  async onload(): Promise<void> {
    try {
      const data = await this.loadData();
      if (validId(data?.lastRun)) this.lastRun = data.lastRun;
      if (typeof data?.lastPdfPath === 'string' && data.lastPdfPath.toLowerCase().endsWith('.pdf')) this.lastPdfPath = data.lastPdfPath;
      if (Number.isSafeInteger(data?.lastPage) && data.lastPage > 0) this.lastPage = data.lastPage;
    } catch { new Notice('InkPDF：设置读取失败，可新建测试；未删除旧测试文件'); }
    this.registerView(VIEW, leaf => new ProbeView(leaf, this));
    this.addCommand({ id: 'open', name: '打开 / 继续设备探针', callback: () => { void this.open(false).catch(e => new Notice(String(e))); } });
    this.addCommand({ id: 'new-run', name: '新建独立设备测试', callback: () => { void this.open(true).catch(e => new Notice(String(e))); } });
    this.addCommand({ id: 'open-pdf', name: '打开仓库 PDF', callback: () => this.choosePdf() });
    this.addCommand({ id: 'toggle-pen-eraser', name: '切换钢笔 / 橡皮擦', callback: () => {
      const view = this.app.workspace.getLeavesOfType(VIEW)[0]?.view;
      if (view instanceof ProbeView) view.toggleTool();
    } });
    this.addRibbonIcon('pen-tool', 'InkPDF 设备探针', () => { void this.open(false).catch(e => new Notice(String(e))); });
  }
  async open(fresh: boolean, pdfPath?: string, page = 1): Promise<void> {
    if (this.opening) return;
    this.opening = true;
    try {
      const old = this.app.workspace.getLeavesOfType(VIEW);
      if (old.length && !fresh) { await this.app.workspace.revealLeaf(old[0]); return; }
      for (const leaf of old) {
        if (leaf.view instanceof ProbeView) await leaf.view.prepareNavigation();
        leaf.detach();
      }
      if (fresh || !this.lastRun) {
        this.lastRun = uniqueId();
        if (fresh) this.lastPdfPath = pdfPath ?? null;
        if (fresh) this.lastPage = Number.isSafeInteger(page) && page > 0 ? page : 1;
        await this.remember();
      }
      const leaf = this.app.workspace.getLeaf('tab');
      await leaf.setViewState({ type: VIEW, active: true });
      await this.app.workspace.revealLeaf(leaf);
      } finally { this.opening = false; }
  }
}

class PageState {
  loading?: Promise<void>;
  rendered = false;
  constructor(public number: number) {}
  runId: string = '';
  store: ProbeStore | undefined = undefined;
  strokes: Stroke[] = [];
  savedCount: number = 0;
  editVersion: number = 0;
  savedEditVersion: number = 0;
  history: EditHistory = new EditHistory();
  totalPoints: number = 0;
  saveTimer: number | undefined = undefined;
  saveDue: number = 0;
  page: PdfPage | undefined = undefined;
  viewport: Viewport | undefined = undefined;
  renderTask: RenderTask | undefined = undefined;
  renderGeneration: number = 0;
  ready: boolean = false;
  dpr: number = 1;
  saveTask: Promise<void> | undefined = undefined;
  saveError: string = '';
  sheet: HTMLElement = undefined!;
  pdfCanvas: HTMLCanvasElement = undefined!;
  ink: HTMLCanvasElement = undefined!;
  committedInk: HTMLCanvasElement = undefined!;
}

class ProbeView extends ItemView {
  private pages = new Map<number, PageState>();
  private current = new PageState(1);
  private refreshTask?: Promise<void>;
  private sourceHash = '';
  private shapeTimer?: number;
  private shapeAnchor?: { x: number; y: number; since: number; pointCount: number; attempted: boolean };
  private fitted?: ReturnType<typeof fitShape>;
  private shapeCounts: Record<string, number> = {};
  private shapeDiagnostics = { eligibleStrokes: 0, skippedHighlighter: 0, armed: 0, movementResets: 0,
    timerFired: 0, attempts: 0, rejected: 0, pointLimit: 0, previews: 0, canceledPreviews: 0,
    pointerUpFallbacks: 0, maxHoldMs: 0, ignoredDwellSamples: 0, lastOutcome: 'not-started' };
  private shapeStatus = '';
  private shapeFitAttempts: ShapeFitMetrics[] = [];
  private active?: { pointerId: number; started: number; stroke: Stroke };
  private erasing?: { pointerId: number; before: Stroke[]; last: [number, number]; changed: boolean };
  private undoButton!: HTMLButtonElement;
  private redoButton!: HTMLButtonElement;
  private tool: 'pen' | 'eraser' | 'highlighter' = 'pen';
  private color = '#155ac4';
  private size = 1;
  private toolButton!: HTMLButtonElement;
  private pageNumber: number;
  private navigating = false;
  private prevButton!: HTMLButtonElement;
  private nextButton!: HTMLButtonElement;
  private pageLabel!: HTMLElement;
  private pressureGain = 2.5;
  private touches = new Set<number>();
  private pan?: { id: number; x: number; y: number; moving: boolean };
  private lastPenAt = -Infinity;
  private touchDiagnostics = { moves: 0, blockedPen: 0, blockedMulti: 0, cooldownMoves: 0, maxContact: 0, scrollChanges: 0 };
  private frame = 0;
  private paintedPoints = 0;
  private renderedWidth = 0;
  private pdf?: PdfDocument;
  private pdfTask?: { promise: Promise<PdfDocument>; destroy(): Promise<void> };
  private closed = false;
  private mode: 'write' | 'browse' = 'write';
  private zoom = 1;
  private status!: HTMLElement;
  private capability!: HTMLElement;
  private scroll!: HTMLElement;
  private inputStatus!: HTMLElement;
  private timings = { paints: 0, maxPaintMs: 0, saves: 0, maxSaveMs: 0, maxEventGapMs: 0 };
  private endings: { reason: string; samples: number; durationMs: number }[] = [];
  private lastSampleTime = 0;
  private errors: string[] = [];
  private pointerStats = { penDown: 0, mouseDown: 0, touchDown: 0, canceled: 0, coalescedSamples: 0,
    pressureMin: null as number | null, pressureMax: null as number | null, penSamples: 0,
    lostCapture: 0, captureFailed: 0, touchPanMoves: 0, ignoredTouches: 0 };
  private report: Record<string, unknown> = {};
  private readonly pdfPath: string | null;
  constructor(leaf: WorkspaceLeaf, private plugin: InkPDFProbe) { super(leaf); this.pdfPath = plugin.lastPdfPath; this.pageNumber = this.pdfPath ? plugin.lastPage : 1; }
  async prepareNavigation(): Promise<void> {
    this.navigating = true;
    try { await this.flush(); }
    catch (e) { this.navigating = false; throw e; }
  }
  toggleTool(): void {
    if (!this.current.ready || this.navigating) return;
    this.finish('tool-change');
    this.tool = this.tool === 'pen' ? 'eraser' : 'pen';
    this.toolButton.textContent = this.tool === 'pen' ? '钢笔' : '橡皮';
    this.toolButton.setAttribute('aria-label', this.tool === 'pen' ? '工具：钢笔' : '工具：整笔橡皮');
  }
  getViewType(): string { return VIEW; }
  getDisplayText(): string { return 'InkPDF 设备探针'; }
  getIcon(): string { return 'pen-tool'; }

  private button(parent: HTMLElement, text: string, fn: () => Promise<void> | void): HTMLButtonElement {
    const b = parent.createEl('button', { text, attr: { 'aria-label': text, title: text } });
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
    if (!this.current.ready) return;
    const suffix = this.active || this.erasing ? this.shapeStatus || '操作中，抬笔后保存' : this.current.saveError ? `保存失败：${this.current.saveError}` : this.current.savedEditVersion === this.current.editVersion ?
      `已保存并读回校验 · revision ${this.current.store?.revision ?? 0}` : '尚有未保存笔迹';
    const other = [...this.pages.values()].filter(p => p !== this.current && (p.saveError || p.editVersion !== p.savedEditVersion));
    this.status.textContent = `${other.length ? `另 ${other.length} 页未保存 / 失败 · ` : ''}${this.current.strokes.length} 笔 / ${LIMITS.strokes} · ${suffix}`;
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
    const controls = this.contentEl.createDiv({ cls: 'inkpdf-probe-controls' });
    this.button(controls, '打开仓库 PDF', () => this.plugin.choosePdf()).textContent = '打开';
    const more = this.contentEl.createEl('details', { cls: 'inkpdf-probe-more' });
    more.createEl('summary', { text: '更多 · 设置与诊断' });
    more.createEl('p', { text: '关闭 iPad 随手写 / Scribble。单指连续滚动；钢笔画完保持接触 1 秒可拟合直线、正放方框或圆。撤销一次恢复原手绘，再撤销删除。原 PDF 只读。笔体双击暂不支持。' });
    const options = more.createDiv({ cls: 'inkpdf-probe-options' });
    const sourceLabel = more.createDiv({ cls: 'inkpdf-probe-source' });
    sourceLabel.textContent = this.pdfPath ? `${this.pdfPath} · 原文件只读；相同内容副本共享逐页笔迹` : '合成 PDF 设备测试';
    this.prevButton = this.button(options, '上一页', () => this.jump(this.pageNumber - 1));
    this.pageLabel = controls.createEl('span', { text: '加载页码中…', attr: { role: 'status' } });
    this.nextButton = this.button(options, '下一页', () => this.jump(this.pageNumber + 1));
    this.prevButton.disabled = this.nextButton.disabled = true;
    const modeButton = this.button(options, '模式：书写', () => {
      this.finish('mode-change');
      this.pan = undefined;
      this.mode = this.mode === 'write' ? 'browse' : 'write';
      modeButton.textContent = this.mode === 'write' ? '模式：书写' : '模式：浏览';
      for (const p of this.pages.values()) p.ink.style.touchAction = this.mode === 'write' ? 'none' : 'pan-x pan-y';
      this.scroll.style.touchAction = this.mode === 'write' ? 'none' : 'pan-x pan-y';
    });
    this.toolButton = this.button(controls, '工具：钢笔', () => this.toggleTool());
    this.toolButton.textContent = '钢笔';
    this.button(controls, '荧光笔', () => {
      if (!this.current.ready || this.navigating) return;
      this.finish('tool-change'); this.tool = 'highlighter'; this.toolButton.textContent = '荧光'; this.toolButton.setAttribute('aria-label', '工具：荧光笔');
      this.color = '#f4d03f'; color.value = this.color;
    });
    const colorLabel = controls.createEl('label', { cls: 'inkpdf-probe-gain', text: '颜色 ' });
    const color = colorLabel.createEl('select', { attr: { 'aria-label': '颜色（只影响新笔迹）' } });
    for (const [name, value] of [['蓝', '#155ac4'], ['黑', '#202020'], ['红', '#d93025'], ['黄', '#f4d03f'], ['绿', '#16803c']]) color.createEl('option', { text: name, attr: { value } });
    color.addEventListener('change', () => { this.finish('style-change'); this.color = color.value; });
    const sizeLabel = controls.createEl('label', { cls: 'inkpdf-probe-gain', text: '粗细 ' });
    const size = sizeLabel.createEl('select', { attr: { 'aria-label': '粗细（只影响新笔迹）' } });
    for (const [name, value] of [['细', '0.5'], ['标准', '1'], ['粗', '2']]) size.createEl('option', { text: name, attr: { value } });
    size.value = '1';
    size.addEventListener('change', () => { this.finish('style-change'); this.size = Number(size.value); });
    this.undoButton = this.button(controls, '撤销（0）', () => this.undoRedo(false));
    this.redoButton = this.button(controls, '重做（0）', () => this.undoRedo(true));
    this.updateHistory();
    const gainLabel = options.createEl('label', { cls: 'inkpdf-probe-gain', text: '压感增益 ' });
    const gain = gainLabel.createEl('select', { attr: { 'aria-label': '压感增益（只影响新笔迹）' } });
    for (const n of [1, 2.5, 4]) gain.createEl('option', { text: `${n}×`, attr: { value: String(n) } });
    gain.value = '2.5';
    gain.addEventListener('change', () => { this.finish('pressure-change'); this.pressureGain = Number(gain.value); });
    for (const zoom of [1, 1.5, 2]) this.button(options, `${zoom * 100}%`, async () => {
      this.finish('zoom'); this.zoom = zoom; await this.resizePages();
    });
    this.button(options, '保存 / 重试', () => this.flush());
    this.button(options, '保存并重新读取', async () => {
      const p = this.current;
      this.navigating = true;
      try {
      await this.flush();
      if (!p.store) throw new Error('存储尚未初始化');
      const loaded = await p.store.load();
      if (JSON.stringify(loaded) !== JSON.stringify(p.strokes)) {
        p.ready = false;
        throw new Error('重读数据不同，停止编辑');
      }
      p.strokes = loaded; p.savedCount = loaded.length;
      p.totalPoints = loaded.reduce((n, s) => n + s.points.length, 0);
      this.report.reopenReadback = { status: 'PASS', strokeCount: loaded.length, revision: p.store.revision };
      this.redraw(p); this.state();
      new Notice(`InkPDF：已从磁盘重新读取 ${loaded.length} 笔`);
      } finally { this.navigating = false; }
    });
    this.button(options, '复测 Worker', () => this.probeWorker());
    this.button(options, '导出诊断', () => this.exportReport());
    this.status = this.contentEl.createDiv({ cls: 'inkpdf-probe-status', attr: { role: 'status', 'aria-live': 'polite' }, text: '初始化中…' });
    this.capability = more.createDiv({ cls: 'inkpdf-probe-capability', text: 'Worker 检测中…' });
    this.inputStatus = more.createDiv({ cls: 'inkpdf-probe-capability', text: '笔压力：尚无采样。Scribble 状态需在系统设置中确认。' });
    this.scroll = this.contentEl.createDiv({ cls: 'inkpdf-probe-scroll' });
    this.scroll.style.touchAction = 'none';
    this.registerDomEvent(this.scroll, 'pointerdown', e => {
      if (e.pointerType !== 'touch') {
        const target = [...this.pages.values()].find(p => p.ink === e.target);
        if (!target?.ready || !target.rendered || this.active || this.erasing) return;
        this.activate(target);
      }
      this.down(e);
    });
    this.registerDomEvent(this.scroll, 'scroll', () => { void this.refreshPages().catch(e => this.fail(e)); });
    this.registerDomEvent(document, 'pointermove', e => this.move(e));
    this.registerDomEvent(document, 'pointerup', e => {
      this.endTouch(e);
      if (e.pointerId === this.erasing?.pointerId) { this.eraseAt(e); this.finish('pointerup'); return; }
      if (e.pointerId !== this.active?.pointerId) return;
      if (this.shapeAnchor) {
        if (Math.hypot(e.clientX - this.shapeAnchor.x, e.clientY - this.shapeAnchor.y) >= SHAPE_SLOP_PX) {
          if (this.fitted) this.shapeDiagnostics.canceledPreviews++;
          this.fitted = undefined;
          this.shapeDiagnostics.lastOutcome = 'moved-at-lift';
        } else this.tryShape('pointerup');
      }
      this.sample(e, true);
      this.finish('pointerup');
    });
    this.registerDomEvent(document, 'pointercancel', e => {
      this.endTouch(e);
      if (e.pointerId === this.active?.pointerId || e.pointerId === this.erasing?.pointerId) { this.pointerStats.canceled++; this.finish('pointercancel'); }
    });
    this.registerDomEvent(this.scroll, 'lostpointercapture', e => {
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
        this.finish('resize-width'); void this.resizePages().catch(e => this.fail(e));
      }, 150);
    });
    observer.observe(this.scroll);
    this.register(() => { observer.disconnect(); window.clearTimeout(resizeTimer); });
    this.register(() => { cancelAnimationFrame(this.frame); window.clearTimeout(this.current.saveTimer); });
    this.report = { probeVersion: this.plugin.manifest.version, obsidianApiVersion: apiVersion,
      userAgent: navigator.userAgent, devicePixelRatio, secureContext: isSecureContext,
      pointerEvents: typeof PointerEvent !== 'undefined', coalescedEvents: typeof PointerEvent !== 'undefined' && 'getCoalescedEvents' in PointerEvent.prototype,
      cryptoSubtle: !!globalThis.crypto?.subtle, crossOriginIsolated: globalThis.crossOriginIsolated,
      limits: LIMITS, scope: this.pdfPath ? 'Vault PDF per-page ink; read-only source; no OCR' : 'One synthetic PDF; no OCR',
      pencilDoubleTap: 'UNAVAILABLE_NO_PUBLIC_HOST_API',
      manualResults: { pencil: 'NOT RUN', pressureVariation: 'NOT RUN', palmRejection: 'NOT RUN', appRestart: 'NOT RUN', backgroundKill: 'NOT RUN' } };
    void this.probeWorker();
    try { await this.initialize(); }
    catch (e) { this.current.ready = false; if (!this.closed) this.fail(e); }
  }

  private async initialize(): Promise<void> {
    let bytes: Uint8Array;
    if (this.pdfPath) {
      const file = this.app.vault.getAbstractFileByPath(this.pdfPath);
      if (!(file instanceof TFile) || file.extension.toLowerCase() !== 'pdf') throw new Error('PDF 不存在或已改名，请重新选择；旧批注保留');
      // shortcut: whole-file hashing/rendering is capped at 20 MiB until large-file testing.
      if (file.stat.size > 20 * 1024 * 1024) throw new Error('当前试验仅支持不超过 20 MiB 的 PDF');
      bytes = new Uint8Array(await this.app.vault.readBinary(file));
      if (!bytes.length || bytes.length > 20 * 1024 * 1024) throw new Error('PDF 为空或超过 20 MiB');
    } else bytes = Uint8Array.from(atob(PDF_BASE64), c => c.charCodeAt(0));
    const sourceHash = await sha256(bytes);
    if (!this.plugin.lastRun) {
      this.plugin.lastRun = uniqueId();
      await this.plugin.remember();
    }
    const started = performance.now();
    const lib = await loadPdfJs();
    if (this.closed) return;
    if (typeof lib?.getDocument !== 'function') throw new Error('loadPdfJs 未提供 getDocument');
    this.report.pdfjsVersion = lib.version ?? 'unknown';
    const task = lib.getDocument({ data: bytes.slice(), isEvalSupported: false, enableXfa: false, disableAutoFetch: true, disableStream: true });
    this.pdfTask = task;
    // shortcut: password-protected PDFs fail with PDF.js's error; password UI is out of scope.
    this.pdf = await task.promise as PdfDocument;
    if (this.closed) return;
    if (!this.pdfPath && this.pdf.numPages !== 1) throw new Error('测试夹具应当只有一页');
    this.pageNumber = Math.min(this.pageNumber, this.pdf.numPages);
    this.sourceHash = sourceHash;
    await this.folder(ROOT);
    // Resolve dimensions before scrolling so mixed page sizes cannot shift ink targets.
    for (let n = 1; n <= this.pdf.numPages; n++) {
      if (this.closed) return;
      const p = new PageState(n);
      p.page = await this.pdf.getPage(n);
      p.sheet = this.scroll.createDiv({ cls: 'inkpdf-probe-sheet', attr: { 'data-page': String(n), 'aria-label': `第 ${n} 页` } });
      p.pdfCanvas = p.sheet.createEl('canvas');
      p.committedInk = p.sheet.createEl('canvas', { cls: 'inkpdf-probe-committed' });
      p.ink = p.sheet.createEl('canvas', { cls: 'inkpdf-probe-ink', attr: { 'aria-label': `第 ${n} 页手写画布` } });
      p.ink.style.touchAction = 'none';
      p.runId = this.pdfPath ? `pdf-${sourceHash}-p${n}` : this.plugin.lastRun!;
      this.pages.set(n, p); this.layout(p);
    }
    if (!this.pdfPath) {
      const dir = `${ROOT}/${this.pages.get(1)!.runId}`;
      await this.folder(dir);
      const path = `${dir}/probe.pdf`;
      if (!await this.app.vault.adapter.exists(path)) await this.app.vault.createBinary(path, bytes.slice().buffer);
      if (await sha256(new Uint8Array(await this.app.vault.adapter.readBinary(path))) !== sourceHash) throw new Error('测试 PDF 已改变，拒绝覆盖或叠加');
    }
    this.current = this.pages.get(this.pageNumber)!;
    await this.loadPage(this.current);
    this.report.pdf = { status: 'PASS', elapsedMs: Math.round(performance.now() - started), pages: this.pdf.numPages, selectedPage: this.pageNumber, sourceReadOnly: true };
    this.scroll.scrollTop += this.current.sheet.getBoundingClientRect().top - this.scroll.getBoundingClientRect().top - 12;
    this.activate(this.current);
    await this.refreshPages();
  }
  private layout(p: PageState): void {
    const base = p.page!.getViewport({ scale: 1 });
    const scale = Math.max(.2, Math.min(1.2, (this.scroll.clientWidth - 24) / base.width)) * this.zoom;
    p.viewport = p.page!.getViewport({ scale });
    p.sheet.style.width = `${p.viewport.width}px`;
    p.sheet.style.height = `${p.viewport.height}px`;
    this.renderedWidth = this.scroll.clientWidth;
  }
  private loadPage(p: PageState): Promise<void> {
    if (p.loading) return p.loading;
    p.loading = (async () => {
      if (!p.store) {
        const dir = `${ROOT}/${p.runId}`;
        for (const path of [dir, `${dir}/snapshots`]) await this.folder(path);
        p.store = new ProbeStore({
          list: async () => (await this.app.vault.adapter.list(`${dir}/snapshots`)).files.filter(f => f.endsWith('.json')).map(f => f.slice(f.lastIndexOf('/') + 1)),
          read: path => this.app.vault.adapter.read(`${dir}/snapshots/${path}`),
          create: async (path, text) => { await this.app.vault.create(`${dir}/snapshots/${path}`, text); }
        }, p.runId, this.sourceHash);
        try { p.strokes = await p.store.load(); }
        catch (e) { p.store = undefined; throw e; }
        p.savedCount = p.strokes.length;
        p.totalPoints = p.strokes.reduce((n, s) => n + s.points.length, 0);
      }
      if (!p.rendered) await this.render(p);
      p.ready = true; p.sheet.dataset.loaded = 'true';
    })().finally(() => { p.loading = undefined; });
    return p.loading;
  }
  private activate(p: PageState): void {
    if (!p.ready || this.active || this.erasing || this.closed) return;
    this.current.ink?.removeAttribute('data-active');
    this.current.committedInk?.removeAttribute('data-active');
    this.current = p; this.pageNumber = p.number;
    p.ink.setAttribute('data-active', 'true'); p.committedInk.setAttribute('data-active', 'true');
    this.pageLabel.textContent = `第 ${p.number} / ${this.pdf!.numPages} 页`;
    this.prevButton.disabled = p.number === 1; this.nextButton.disabled = p.number === this.pdf!.numPages;
    this.report.pdf = { ...this.report.pdf as object, selectedPage: p.number };
    this.report.sourceHash = this.sourceHash;
    this.report.loadedFromDisk = { strokeCount: p.savedCount, revision: p.store?.revision };
    if (this.plugin.lastPage !== p.number) {
      this.plugin.lastPage = p.number;
      void this.plugin.remember().catch(e => this.fail(e));
    }
    this.updateHistory(); this.state();
  }
  private visiblePage(): PageState {
    const mid = this.scroll.getBoundingClientRect().top + Math.min(this.scroll.clientHeight / 2, 250);
    return [...this.pages.values()].reduce((best, p) => {
      const distance = (q: PageState) => { const r = q.sheet.getBoundingClientRect(); return Math.max(r.top - mid, mid - r.bottom, 0); };
      return distance(p) < distance(best) ? p : best;
    }, this.current);
  }
  private refreshPages(): Promise<void> {
    if (this.refreshTask) return this.refreshTask;
    this.refreshTask = (async () => {
      if (!this.pages.size || !this.report.pdf || this.closed) return;
      let target: PageState;
      do {
        target = this.visiblePage();
        await this.loadPage(target);
        this.activate(target);
        for (const p of this.pages.values()) {
          if (Math.abs(p.number - target.number) > 1 && p !== this.current && p.rendered) {
            p.rendered = false; p.sheet.dataset.loaded = 'false';
            for (const c of [p.pdfCanvas, p.ink, p.committedInk]) { c.width = 0; c.height = 0; }
            p.page?.cleanup();
            if (!this.navigating && !p.saveTask && !p.saveError && p.editVersion === p.savedEditVersion) {
              p.store = undefined; p.strokes = []; p.history = new EditHistory(); p.ready = false;
            }
          }
        }
        for (const n of [target.number - 1, target.number + 1]) {
          const p = this.pages.get(n);
          if (p && !this.closed) await this.loadPage(p);
        }
      } while (!this.closed && target !== this.visiblePage());
    })().finally(() => { this.refreshTask = undefined; });
    return this.refreshTask;
  }
  private async jump(n: number): Promise<void> {
    const p = this.pages.get(n);
    if (!p) return;
    await this.flush();
    await this.loadPage(p);
    this.activate(p);
    this.scroll.scrollTop += p.sheet.getBoundingClientRect().top - this.scroll.getBoundingClientRect().top - 12;
    await this.refreshPages();
  }
  private async resizePages(): Promise<void> {
    await this.refreshTask;
    if (!this.pages.size || !this.report.pdf || this.closed) return;
    const offset = this.current.sheet.getBoundingClientRect().top - this.scroll.getBoundingClientRect().top;
    for (const p of this.pages.values()) {
      this.layout(p); p.rendered = false; p.sheet.dataset.loaded = 'false';
      for (const c of [p.pdfCanvas, p.ink, p.committedInk]) { c.width = 0; c.height = 0; }
    }
    this.scroll.scrollTop += this.current.sheet.getBoundingClientRect().top - this.scroll.getBoundingClientRect().top - offset;
    await this.refreshPages();
  }
  private async probeWorker(): Promise<void> {
    const result = await workerProbe();
    this.report.worker = result;
    if (!this.closed) this.capability.textContent = `Blob module Worker + 基础 WASM：${result.status}（不代表 ORT/SIMD 或 OCR 已通过）`;
  }
  private async render(p = this.current): Promise<void> {
    if (!p.page || this.closed) return;
    const generation = ++p.renderGeneration;
    const previous = p.renderTask;
    previous?.cancel();
    await previous?.promise.catch(() => undefined);
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
    const context = p.pdfCanvas.getContext('2d');
    if (!context) throw new Error('Canvas 2D unavailable');
    const task = p.page.render({ canvas: p.pdfCanvas, canvasContext: context, viewport,
      transform: [p.dpr, 0, 0, p.dpr, 0, 0] });
    p.renderTask = task;
    try { await task.promise; }
    catch (e) { if (generation === p.renderGeneration && !this.closed) throw e; }
    if (generation === p.renderGeneration && !this.closed) { p.rendered = true; this.redraw(p); }
  }
  private context(canvas: HTMLCanvasElement, clear = false, p = this.current): CanvasRenderingContext2D | null {
    if (!p.viewport) return null;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    if (clear) ctx.clearRect(0, 0, canvas.width, canvas.height);
    const [a, b, c, d, e, f] = p.viewport.transform.map(n => n * p.dpr);
    ctx.setTransform(a, b, c, d, e, f);
    ctx.strokeStyle = '#155ac4'; ctx.fillStyle = '#155ac4'; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    return ctx;
  }
  private drawStroke(ctx: CanvasRenderingContext2D, stroke: Stroke, start = 0): void {
      const width = (p: Point) => strokeWidth(stroke, p);
      const first = stroke.points[0];
      if (!first) return;
      ctx.save();
      ctx.strokeStyle = ctx.fillStyle = stroke.color ?? '#155ac4';
      if (stroke.kind === 'highlighter') {
        ctx.globalAlpha = 0.3;
        ctx.lineWidth = width(first);
        ctx.beginPath();
        if (stroke.points.length === 1) {
          ctx.arc(first[0], first[1], width(first) / 2, 0, Math.PI * 2); ctx.fill();
        } else {
          ctx.moveTo(first[0], first[1]);
          for (const p of stroke.points.slice(1)) ctx.lineTo(p[0], p[1]);
          ctx.stroke();
        }
        ctx.restore(); return;
      }
      if (start === 0) {
        ctx.beginPath(); ctx.arc(first[0], first[1], width(first) / 2, 0, Math.PI * 2); ctx.fill();
      }
      for (let i = Math.max(1, start); i < stroke.points.length; i++) {
        const p = stroke.points[i], prev = stroke.points[i - 1];
        ctx.lineWidth = (width(p) + width(prev)) / 2;
        ctx.beginPath(); ctx.moveTo(prev[0], prev[1]); ctx.lineTo(p[0], p[1]); ctx.stroke();
      }
      ctx.restore();
  }
  private redraw(p = this.current): void {
    const ctx = this.context(p.committedInk, true, p);
    if (ctx) for (const s of p.strokes) this.drawStroke(ctx, s);
    this.context(p.ink, true, p);
    if (p !== this.current) return;
    this.paintedPoints = 0;
    this.paintActive();
  }
  private paintActive(): void {
    const started = performance.now();
    // A translucent stroke is painted once as a whole path to avoid dark segment joins.
    const ctx = this.context(this.current.ink, !!this.fitted || this.active?.stroke.kind === 'highlighter');
    if (ctx && this.active) {
      this.drawStroke(ctx, this.fitted ? { ...this.active.stroke, points: this.fitted.points } : this.active.stroke, this.fitted ? 0 : this.paintedPoints);
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
      this.touchDiagnostics.maxContact = Math.max(this.touchDiagnostics.maxContact, e.width, e.height);
      if (this.touches.size !== 1 || this.active || this.erasing) {
        if (this.active || this.erasing) this.touchDiagnostics.blockedPen++;
        else this.touchDiagnostics.blockedMulti++;
        this.pan = undefined; this.pointerStats.ignoredTouches++; return;
      }
      this.pan = { id: e.pointerId, x: e.clientX, y: e.clientY, moving: false };
      try { this.current.ink.setPointerCapture(e.pointerId); } catch { this.pointerStats.captureFailed++; }
      return;
    }
    if (!this.current.ready || this.navigating || !this.current.viewport || this.mode !== 'write' || !['pen', 'mouse'].includes(e.pointerType) || e.button !== 0) return;
    if (this.active || this.erasing) this.finish('superseded-down');
    if (this.tool !== 'eraser' && (this.current.strokes.length >= LIMITS.strokes || this.current.totalPoints >= LIMITS.totalPoints)) {
      new Notice('已达探针上限，请导出诊断后新建独立测试'); return;
    }
    e.preventDefault();
    this.pan = undefined;
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
    this.lastPenAt = performance.now();
    if (e.pointerType === 'pen') this.pointerStats.penDown++; else this.pointerStats.mouseDown++;
    try { this.current.ink.setPointerCapture(e.pointerId); } catch { this.pointerStats.captureFailed++; }
    if (this.tool === 'eraser') {
      this.erasing = { pointerId: e.pointerId, before: this.current.strokes.slice(), last: this.eventPoint(e), changed: false };
      this.eraseAt(e); this.state(); return;
    }
    this.paintedPoints = 0;
    this.lastSampleTime = e.timeStamp;
    this.active = { pointerId: e.pointerId, started: e.timeStamp, stroke: { id: uniqueId(), pointerType: e.pointerType, interrupted: false, points: [], pressureGain: this.pressureGain, kind: this.tool, color: this.color, size: this.size } };
    if (e.pointerType === 'pen') {
      if (this.tool === 'pen') this.shapeDiagnostics.eligibleStrokes++;
      else this.shapeDiagnostics.skippedHighlighter++;
    }
    this.sample(e); this.holdShape(e); this.schedulePaint(); this.state();
  }
  private eventPoint(e: PointerEvent): [number, number] {
    const rect = this.current.ink.getBoundingClientRect();
    return pdfPoint(this.current.viewport!.transform,
      (e.clientX - rect.left) * this.current.viewport!.width / rect.width,
      (e.clientY - rect.top) * this.current.viewport!.height / rect.height);
  }
  private endTouch(e: PointerEvent): void {
    if (e.pointerType !== 'touch') return;
    this.touches.delete(e.pointerId);
    if (this.pan?.id === e.pointerId) this.pan = undefined;
    try { this.current.ink.releasePointerCapture(e.pointerId); } catch { /* Capture may already be released. */ }
  }
  private eraseAt(e: PointerEvent): void {
    const erase = this.erasing;
    if (!erase || !this.current.viewport) return;
    const to = this.eventPoint(e);
    const radius = 10 / Math.hypot(this.current.viewport.transform[0], this.current.viewport.transform[1]);
    const retained = this.current.strokes.filter(s => !hitsStroke(s, erase.last, to, radius));
    erase.last = to;
    if (retained.length === this.current.strokes.length) return;
    this.current.strokes = retained; erase.changed = true;
    this.redraw(); this.state();
  }
  private sample(e: PointerEvent, ending = false): void {
    const active = this.active;
    if (!active || !this.current.viewport) return;
    if (active.stroke.points.length >= LIMITS.pointsPerStroke ||
        this.current.totalPoints + active.stroke.points.length >= LIMITS.totalPoints) {
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
      this.touchDiagnostics.moves++;
      if (this.mode === 'browse' || e.pointerId !== this.pan?.id || this.active || this.erasing) return;
      e.preventDefault();
      const p = this.pan;
      if (performance.now() - this.lastPenAt < 180) {
        p.x = e.clientX; p.y = e.clientY;
        this.touchDiagnostics.cooldownMoves++; return;
      }
      if (!p.moving && Math.hypot(e.clientX - p.x, e.clientY - p.y) < 8) return;
      p.moving = true;
      const oldX = this.scroll.scrollLeft, oldY = this.scroll.scrollTop;
      this.scroll.scrollLeft += p.x - e.clientX;
      this.scroll.scrollTop += p.y - e.clientY;
      if (this.scroll.scrollLeft !== oldX || this.scroll.scrollTop !== oldY) this.touchDiagnostics.scrollChanges++;
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
    this.holdShape(e);
    this.schedulePaint();
  }
  private holdShape(e: PointerEvent): void {
    if (!this.active || this.active.stroke.pointerType !== 'pen' || this.active.stroke.kind !== 'pen') return;
    if (this.shapeAnchor && Math.hypot(e.clientX - this.shapeAnchor.x, e.clientY - this.shapeAnchor.y) < SHAPE_SLOP_PX) return;
    window.clearTimeout(this.shapeTimer);
    if (this.shapeAnchor) this.shapeDiagnostics.movementResets++;
    this.shapeAnchor = { x: e.clientX, y: e.clientY, since: performance.now(), pointCount: this.active.stroke.points.length, attempted: false };
    this.shapeDiagnostics.armed++;
    this.shapeDiagnostics.lastOutcome = 'waiting';
    const previousStatus = this.shapeStatus;
    this.shapeStatus = '停笔保持接触 1 秒可拟合';
    if (this.fitted) {
      this.shapeDiagnostics.canceledPreviews++;
      this.fitted = undefined; this.context(this.current.ink, true); this.paintedPoints = 0;
    }
    const active = this.active;
    this.shapeTimer = window.setTimeout(() => {
      if (this.active !== active || this.closed) return;
      this.shapeDiagnostics.timerFired++;
      this.tryShape('timer');
    }, SHAPE_HOLD_MS);
    if (previousStatus !== this.shapeStatus) this.state();
  }
  private tryShape(trigger: 'timer' | 'pointerup'): void {
    const active = this.active, anchor = this.shapeAnchor;
    if (!active || !anchor || this.closed) return;
    const held = performance.now() - anchor.since;
    this.shapeDiagnostics.maxHoldMs = Math.max(this.shapeDiagnostics.maxHoldMs, Math.round(held));
    if (anchor.attempted) return;
    if (held < SHAPE_HOLD_MS) {
      if (trigger === 'timer') this.shapeTimer = window.setTimeout(() => this.tryShape('timer'), Math.max(1, Math.ceil(SHAPE_HOLD_MS - held)));
      return;
    }
    anchor.attempted = true;
    this.shapeDiagnostics.attempts++;
    if (trigger === 'pointerup') this.shapeDiagnostics.pointerUpFallbacks++;
    // Keep raw ink for undo; stationary sensor jitter must not inflate fitted path length.
    const geometry = active.stroke.points.slice(0, anchor.pointCount);
    this.shapeDiagnostics.ignoredDwellSamples += active.stroke.points.length - geometry.length;
    const metrics: ShapeFitMetrics = { page: this.pageNumber, trigger, pipeline: 'simplify-1pdf-resample64-v1' };
    this.fitted = fitShape(geometry, metrics);
    this.shapeFitAttempts.push(metrics);
    this.shapeFitAttempts = this.shapeFitAttempts.slice(-10);
    if (this.fitted && this.current.totalPoints + this.fitted.points.length > LIMITS.totalPoints) {
      this.fitted = undefined; this.shapeDiagnostics.pointLimit++;
      this.shapeDiagnostics.lastOutcome = 'point-limit';
      this.shapeStatus = '拟合超出点数上限，保留手绘';
    } else if (!this.fitted) {
      this.shapeDiagnostics.rejected++;
      this.shapeDiagnostics.lastOutcome = 'geometry-rejected';
      const reasons: Record<string, string> = {
        'too-few-samples': '采样点不足', 'too-short': '图形太短', 'too-complex': '轨迹过于复杂',
        'not-line-and-too-narrow': '不是直线，闭合图形太窄',
        'not-line-and-not-closed': '不是直线，图形未闭合',
        'rectangle-and-circle-proportions': '方框或圆的比例不符',
        'rectangle-and-circle-deviation': '边缘偏离方框或圆', 'incomplete-circle': '圆周不完整'
      };
      this.shapeStatus = `已检测停笔，未识别：${reasons[metrics.reason] ?? '几何不匹配'}`;
    } else {
      this.shapeDiagnostics.previews++;
      this.shapeDiagnostics.lastOutcome = `preview-${this.fitted.kind}`;
      const name = { line: '直线', rectangle: '方框', circle: '圆' }[this.fitted.kind] ?? '图形';
      this.shapeStatus = `已拟合${name}，抬笔确认；继续移动恢复手绘`;
      this.context(this.current.ink, true); this.schedulePaint();
    }
    this.state();
  }
  private finish(reason: string): void {
    if (this.shapeAnchor) this.shapeDiagnostics.maxHoldMs = Math.max(this.shapeDiagnostics.maxHoldMs, Math.round(performance.now() - this.shapeAnchor.since));
    if (reason !== 'pointerup' && this.fitted) this.shapeDiagnostics.canceledPreviews++;
    window.clearTimeout(this.shapeTimer); this.shapeAnchor = undefined; this.shapeStatus = '';
    const fitted = reason === 'pointerup' ? this.fitted : undefined; this.fitted = undefined;
    if (this.erasing) {
      const erase = this.erasing; this.erasing = undefined;
      this.lastPenAt = performance.now();
      try { this.current.ink.releasePointerCapture(erase.pointerId); } catch { /* The system can revoke capture. */ }
      if (erase.changed) {
        this.current.history.record(erase.before, this.current.strokes); this.updateHistory();
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
    try { this.current.ink.releasePointerCapture(active.pointerId); } catch { /* Capture can be revoked by WebView. */ }
    this.context(this.current.ink, true); this.paintedPoints = 0; this.state();
  }
  private changed(): void {
    this.current.editVersion++;
    this.current.totalPoints = this.current.strokes.reduce((n, s) => n + s.points.length, 0);
    this.state();
    if (!this.current.saveDue) this.current.saveDue = performance.now() + 1500;
    window.clearTimeout(this.current.saveTimer);
    const p = this.current;
    this.current.saveTimer = window.setTimeout(() => {
      p.saveDue = 0;
      if (p === this.current && (this.active || this.erasing)) return; // The next completed edit schedules another save.
      void this.save(p).catch(e => this.fail(e));
    }, Math.max(0, Math.min(250, this.current.saveDue - performance.now())));
  }
  private undoRedo(redo: boolean): void {
    if (!this.current.ready || this.navigating) return;
    this.finish('history');
    if (redo ? !this.current.history.redoDepth : !this.current.history.undoDepth) return;
    this.current.strokes = redo ? this.current.history.redo(this.current.strokes) : this.current.history.undo(this.current.strokes);
    this.updateHistory(); this.changed(); this.redraw();
  }
  private updateHistory(): void {
    this.undoButton.disabled = !this.current.history.undoDepth;
    this.redoButton.disabled = !this.current.history.redoDepth;
    this.undoButton.textContent = '↶'; this.undoButton.setAttribute('aria-label', `撤销（${this.current.history.undoDepth}）`);
    this.redoButton.textContent = '↷'; this.redoButton.setAttribute('aria-label', `重做（${this.current.history.redoDepth}）`);
  }
  private async save(p = this.current): Promise<void> {
    if (p.saveTask) return p.saveTask;
    if (!p.store) return;
    p.saveTask = (async () => {
      while (p.savedEditVersion < p.editVersion) {
        if (p === this.current && (this.active || this.erasing)) break;
        const version = p.editVersion;
        const started = performance.now();
        const snapshot = JSON.parse(JSON.stringify(p.strokes)) as Stroke[];
        const result = await p.store!.save(snapshot, version);
        p.savedCount = result.count;
        p.savedEditVersion = result.editVersion;
        this.timings.saves++;
        this.timings.maxSaveMs = Math.max(this.timings.maxSaveMs, performance.now() - started);
        p.saveError = '';
        this.state();
      }
    })().catch(e => { p.saveError = String(e); this.state(); throw e; }).finally(() => { p.saveTask = undefined; });
    return p.saveTask;
  }
  async flush(): Promise<void> {
    this.finish('flush');
    const results = await Promise.allSettled([...this.pages.values()].map(p => {
      window.clearTimeout(p.saveTimer); p.saveDue = 0;
      return this.save(p);
    }));
    this.state();
    const failure = results.find(r => r.status === 'rejected');
    if (failure?.status === 'rejected') throw failure.reason;
  }
  private async exportReport(): Promise<void> {
    await this.folder(ROOT);
    const report = { ...this.report, exportedAt: new Date().toISOString(), runId: this.current.runId,
      pages: [...this.pages.values()].filter(p => p.store).map(p => ({ page: p.number, strokes: p.strokes.length, saved: p.savedCount, revision: p.store?.revision, editVersion: p.editVersion, savedEditVersion: p.savedEditVersion, saveError: p.saveError })),
      shapeCounts: this.shapeCounts,
      shapeFitAttempts: this.shapeFitAttempts,
      shapeDiagnostics: { ...this.shapeDiagnostics, holdMs: SHAPE_HOLD_MS, movementToleranceCssPx: SHAPE_SLOP_PX, tool: this.tool },
      strokesInMemory: this.current.strokes.length, strokesSaved: this.current.savedCount, revision: this.current.store?.revision ?? 0,
      saveError: this.current.saveError, pointer: this.pointerStats, errors: this.errors,
      editVersion: this.current.editVersion, savedEditVersion: this.current.savedEditVersion,
      inputEndings: this.endings, timings: this.timings, pressureGain: this.pressureGain,
      touchDiagnostics: { ...this.touchDiagnostics, activeTouches: this.touches.size, mode: this.mode,
        scrollTop: this.scroll.scrollTop, maxScrollTop: this.scroll.scrollHeight - this.scroll.clientHeight },
      undoDepth: this.current.history.undoDepth, redoDepth: this.current.history.redoDepth,
      drawing: 'Incremental active ink + committed canvas; finger pan while pen is up; whole-stroke eraser',
      privacy: 'No handwriting coordinates, recognized text or PDF bytes included. Local file only.' };
    const path = `${ROOT}/diagnostic-${Date.now()}-${uniqueId()}.json`;
    await this.app.vault.create(path, JSON.stringify(report, null, 2));
    new Notice(`诊断已保存在 ${path}；没有上传`, 10000);
  }
  async onClose(): Promise<void> {
    this.finish('view-close');
    this.closed = true;
    for (const p of this.pages.values()) { p.renderGeneration++; p.renderTask?.cancel(); window.clearTimeout(p.saveTimer); }
    await this.flush().catch(e => this.fail(e));
    await this.refreshTask?.catch(() => undefined);
    for (const p of this.pages.values()) { await p.renderTask?.promise.catch(() => undefined); p.page?.cleanup(); }
    await this.pdfTask?.destroy().catch(e => this.fail(e));
  }
}
