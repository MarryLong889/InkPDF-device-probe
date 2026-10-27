// Browser-only host double. Passing this harness does not certify Obsidian or iPad.
type Options = { cls?: string; text?: string; attr?: Record<string, string> };
const proto = HTMLElement.prototype as any;
proto.createEl = function(tag: string, options: Options = {}) {
  const e = document.createElement(tag);
  if (options.cls) e.className = options.cls;
  if (options.text) e.textContent = options.text;
  for (const [k, v] of Object.entries(options.attr ?? {})) e.setAttribute(k, v);
  this.append(e); return e;
};
proto.createDiv = function(options: Options = {}) { return this.createEl('div', options); };
proto.empty = function() { this.replaceChildren(); };
proto.addClass = function(name: string) { this.classList.add(name); };
export const apiVersion = 'HARNESS-NOT-OBSIDIAN';
export const notices: string[] = [];
export class Notice { constructor(message: string) { notices.push(message); } }
const storageKey = 'inkpdf-test-files';
function readFiles(): Record<string, string> { return JSON.parse(localStorage.getItem(storageKey) ?? '{}'); }
function create(path: string, text: string) {
  if ((window as any).failWrites) throw new Error('injected disk full');
  const f = readFiles();
  if (path in f) throw new Error('already exists');
  f[path] = text; localStorage.setItem(storageKey, JSON.stringify(f));
}
const leaves: WorkspaceLeaf[] = [];
export class TFile {
  extension = 'pdf';
  stat: { size: number };
  constructor(public path: string) { this.stat = { size: atob(readFiles()[path]).length }; }
}
export class FuzzySuggestModal<T> {
  constructor(_app: unknown) {}
  open() {}
}
let factory: (leaf: WorkspaceLeaf) => ItemView;
export const app = {
  vault: {
    getFiles: () => Object.keys(readFiles()).filter(p => p.endsWith('.pdf')).map(p => new TFile(p)),
    getAbstractFileByPath: (p: string) => p in readFiles() && p.endsWith('.pdf') ? new TFile(p) : null,
    readBinary: async (f: TFile) => Uint8Array.from(atob(readFiles()[f.path]), c => c.charCodeAt(0)).buffer,
    adapter: {
      exists: async (p: string) => p in readFiles() || p.endsWith('/snapshots') || p === 'InkPDF-Probe' || /^InkPDF-Probe\/[\w-]+$/.test(p),
      read: async (p: string) => { const f = readFiles(); if (!(p in f)) throw new Error('missing'); return f[p]; },
      readBinary: async (p: string) => Uint8Array.from(atob(readFiles()[p]), c => c.charCodeAt(0)).buffer,
      list: async (p: string) => ({ files: Object.keys(readFiles()).filter(k => k.startsWith(p + '/') && !k.slice(p.length + 1).includes('/')), folders: [] })
    },
    createFolder: async () => {},
    create: async (p: string, s: string) => { create(p, s); },
    createBinary: async (p: string, b: ArrayBuffer) => { create(p, btoa(String.fromCharCode(...new Uint8Array(b)))); }
  },
  workspace: {
    getLeavesOfType: () => leaves,
    getLeaf: () => { const leaf = new WorkspaceLeaf(); leaves.push(leaf); return leaf; },
    revealLeaf: async () => {}
  }
};
export class WorkspaceLeaf {
  view!: ItemView;
  async setViewState() { this.view = factory(this); await this.view.onOpen(); }
  detach() {
    leaves.splice(leaves.indexOf(this), 1);
    void this.view.onClose().finally(() => this.view.dispose());
  }
}
export class ItemView {
  app = app;
  contentEl = document.body.appendChild(document.createElement('main')) as any;
  cleanup: (() => void)[] = [];
  constructor(public leaf: WorkspaceLeaf) {}
  register(fn: () => void) { this.cleanup.push(fn); }
  registerDomEvent(el: EventTarget, name: string, fn: EventListener) { el.addEventListener(name, fn); this.register(() => el.removeEventListener(name, fn)); }
  async onOpen() {}
  async onClose() {}
  dispose() { for (const fn of this.cleanup) fn(); this.contentEl.remove(); }
}
export class Plugin {
  app = app;
  manifest = { version: '0.0.8' };
  commands: Record<string, () => void> = {};
  async loadData() { return JSON.parse(localStorage.getItem('inkpdf-test-settings') ?? 'null'); }
  async saveData(v: unknown) { localStorage.setItem('inkpdf-test-settings', JSON.stringify(v)); }
  registerView(_name: string, fn: typeof factory) { factory = fn; }
  addCommand(c: { id: string; callback: () => void }) { this.commands[c.id] = c.callback; }
  addRibbonIcon() {}
}
export async function loadPdfJs() {
  const url = '/node_modules/pdfjs-dist/build/pdf.mjs';
  const lib = await import(url);
  lib.GlobalWorkerOptions.workerSrc = '/node_modules/pdfjs-dist/build/pdf.worker.mjs';
  return lib;
}
export { readFiles };
