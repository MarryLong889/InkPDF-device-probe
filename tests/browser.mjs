import { build } from 'esbuild';
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { resolve, extname, sep } from 'node:path';
import assert from 'node:assert/strict';
await mkdir('.test', { recursive: true });
await build({ entryPoints: ['tests/browser-entry.ts'], outfile: '.test/browser.js', bundle: true, format: 'esm', platform: 'browser',
  alias: { obsidian: resolve('tests/obsidian-mock.ts') }, target: 'es2022' });
const root = process.cwd();
const server = createServer(async (req, res) => {
  try {
    if (req.url === '/') {
      res.setHeader('Content-Type', 'text/html');
      res.end('<!doctype html><meta charset="utf-8"><link rel="stylesheet" href="/styles.css"><style>html,body{margin:0;height:100%;font-family:system-ui}*{box-sizing:border-box}button{border:1px solid #bbc5cf;border-radius:6px;background:white;color:#123}main{--text-muted:#567}</style><script type="module" src="/.test/browser.js"></script>'); return;
    }
    const path = resolve(root, '.' + new URL(req.url, 'http://localhost').pathname);
    if (!path.startsWith(root + sep)) { res.writeHead(403); res.end(); return; }
    const mime = { '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.pdf': 'application/pdf' };
    res.setHeader('Content-Type', mime[extname(path)] ?? 'application/octet-stream');
    res.end(await readFile(path));
  } catch { res.writeHead(404); res.end(); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const port = server.address().port;
const cached = 'C:/Users/songzj/AppData/Local/ms-playwright/chromium-1208/chrome-win64/chrome.exe';
const executablePath = process.env.INKPDF_CHROMIUM ?? (existsSync(cached) ? cached : undefined);
let browser;
const checks = [], failures = [];
try {
  browser = await chromium.launch({ executablePath, headless: true });
  const page = await browser.newPage({ viewport: { width: 820, height: 1080 }, deviceScaleFactor: 2 });
  page.on('pageerror', e => failures.push(String(e)));
  await page.goto(`http://127.0.0.1:${port}`);
  await page.waitForFunction(() => document.querySelector('.inkpdf-probe-status')?.textContent.includes('已保存'));
  await page.waitForFunction(() => document.querySelector('.inkpdf-probe-capability')?.textContent.includes('PASS'));
  checks.push('Real PDF.js 6.4.299 page render in Chromium with mocked Obsidian host; module Worker + basic WASM PASS');
  await page.locator('.inkpdf-probe-more').evaluate(e => e.open = true);
  const sourceBefore = await page.evaluate(() => Object.entries(window.readFiles()).find(([p]) => p.endsWith('/probe.pdf'))[1]);
  await page.evaluate(() => {
    const canvas = document.querySelector('.inkpdf-probe-ink[data-active]');
    const r = canvas.getBoundingClientRect();
    for (let i = 0; i < 20; i++) {
      const p = { pointerId: i + 10, pointerType: 'pen', button: 0, buttons: 1, bubbles: true, clientX: r.left + 70, clientY: r.top + 140 + i * 15, pressure: .2 };
      canvas.dispatchEvent(new PointerEvent('pointerdown', p));
      for (let j = 1; j <= 4; j++) canvas.dispatchEvent(new PointerEvent('pointermove', { ...p, clientX: p.clientX + j * 15, pressure: .2 + j * .15 }));
      canvas.dispatchEvent(new PointerEvent('pointerup', { ...p, clientX: p.clientX + 60, buttons: 0, pressure: 0 }));
    }
    canvas.dispatchEvent(new PointerEvent('pointerdown', { pointerId: 99, pointerType: 'touch', clientX: r.left + 20, clientY: r.top + 20, bubbles: true }));
    canvas.dispatchEvent(new PointerEvent('pointerup', { pointerId: 99, pointerType: 'touch', bubbles: true }));
  });
  await page.waitForFunction(() => document.querySelector('.inkpdf-probe-status')?.textContent.includes('20 笔') && document.querySelector('.inkpdf-probe-status')?.textContent.includes('已保存'));
  const latest = () => page.evaluate(() => {
    const snapshots = Object.entries(window.readFiles()).filter(([p]) => p.includes('/snapshots/')).sort(([a], [b]) => a.localeCompare(b));
    return JSON.parse(snapshots.at(-1)[1]);
  });
  const original = await latest();
  assert.equal(original.strokes.length, 20);
  checks.push('20 synthetic pen strokes saved; touch ignored (synthetic events, NOT Apple Pencil validation)');
  await page.getByRole('button', { name: '200%', exact: true }).click();
  await page.getByRole('button', { name: '保存并重新读取', exact: true }).click();
  assert.deepEqual((await latest()).strokes, original.strokes);
  await page.screenshot({ path: '.test/probe-200-percent.png' });
  await page.getByRole('button', { name: '100%', exact: true }).click();
  await page.screenshot({ path: '.test/probe-tablet.png' });
  await page.reload();
  await page.locator('.inkpdf-probe-more').evaluate(e => e.open = true);
  await page.waitForFunction(() => document.querySelector('.inkpdf-probe-status')?.textContent.includes('20 笔'));
  assert.deepEqual((await latest()).strokes, original.strokes);
  checks.push('Zoom and full browser reload preserve all PDF-space samples exactly');
  await page.locator('.inkpdf-probe-more').evaluate(e => e.open = true);
  await page.getByRole('button', { name: '导出诊断', exact: true }).click();
  await page.waitForFunction(() => Object.keys(window.readFiles()).some(p => p.includes('diagnostic-')));
  const report = await page.evaluate(() => JSON.parse(Object.entries(window.readFiles()).filter(([p]) => p.includes('diagnostic-')).at(-1)[1]));
  assert.equal(report.loadedFromDisk.strokeCount, 20);
  assert.equal(JSON.stringify(report).includes('"points"'), false);
  checks.push('Diagnostic export contains counts/capabilities, no stroke coordinates');
  const sourceAfter = await page.evaluate(() => Object.entries(window.readFiles()).find(([p]) => p.endsWith('/probe.pdf'))[1]);
  assert.equal(sourceAfter, sourceBefore);
  checks.push('Synthetic source PDF bytes unchanged');
  await page.evaluate(() => { window.failWrites = true; });
  const ink = page.locator('.inkpdf-probe-ink[data-active]');
  const r = await ink.boundingBox();
  await page.mouse.move(r.x + 70, r.y + 150); await page.mouse.down(); await page.mouse.move(r.x + 130, r.y + 170); await page.mouse.up();
  await page.waitForFunction(() => document.querySelector('.inkpdf-probe-status')?.textContent.includes('失败'));
  assert.equal((await latest()).strokes.length, 20);
  await page.evaluate(() => { window.failWrites = false; });
  await page.getByRole('button', { name: '保存 / 重试', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('.inkpdf-probe-status')?.textContent.includes('21 笔') && document.querySelector('.inkpdf-probe-status')?.textContent.includes('已保存'));
  checks.push('Write failure remains visibly unsaved; retry restores 21st stroke');
  await page.evaluate(() => {
    const canvas = document.querySelector('.inkpdf-probe-ink[data-active]'), r = canvas.getBoundingClientRect();
    const p = { pointerId: 77, pointerType: 'pen', button: 0, buttons: 1, bubbles: true, clientX: r.left + 180, clientY: r.top + 180, pressure: .1 };
    canvas.dispatchEvent(new PointerEvent('pointerdown', p));
    canvas.dispatchEvent(new PointerEvent('lostpointercapture', p));
    window.testPointer = p;
    const before = document.querySelector('.inkpdf-probe-scroll').scrollTop;
    canvas.dispatchEvent(new PointerEvent('pointerdown', { ...p, pointerId: 101, pointerType: 'touch', clientY: p.clientY + 50 }));
    document.dispatchEvent(new PointerEvent('pointermove', { ...p, pointerId: 101, pointerType: 'touch', clientY: p.clientY - 50 }));
    document.dispatchEvent(new PointerEvent('pointerup', { ...p, pointerId: 101, pointerType: 'touch' }));
    if (document.querySelector('.inkpdf-probe-scroll').scrollTop !== before) throw new Error('palm moved page during pen contact');
  });
  await page.setViewportSize({ width: 820, height: 980 });
  await page.waitForTimeout(250);
  await page.evaluate(() => {
    const p = window.testPointer;
    document.dispatchEvent(new PointerEvent('pointermove', { ...p, clientX: p.clientX + 40, pressure: .34 }));
    document.dispatchEvent(new PointerEvent('pointerup', { ...p, clientX: p.clientX + 80, buttons: 0, pressure: 0 }));
  });
  await page.waitForFunction(() => document.querySelector('.inkpdf-probe-status')?.textContent.includes('22 笔') && document.querySelector('.inkpdf-probe-status')?.textContent.includes('已保存'));
  const continued = (await latest()).strokes.at(-1);
  assert.equal(continued.interrupted, false);
  assert.ok(continued.points.length >= 3);
  assert.ok(continued.points.at(-1)[0] > continued.points.at(-2)[0]);
  checks.push('Capture loss and height-only resize do not split pen stroke; final pointerup endpoint saved; palm cannot pan during pen contact');
  await page.waitForTimeout(200);
  const panResult = await page.evaluate(() => {
    const canvas = document.querySelector('.inkpdf-probe-ink[data-active]'), r = canvas.getBoundingClientRect();
    const scroll = document.querySelector('.inkpdf-probe-scroll');
    const before = scroll.scrollTop;
    const p = { pointerId: 102, pointerType: 'touch', width: 64, height: 64, button: 0, buttons: 1, bubbles: true, clientX: r.left + 180, clientY: r.top + 300 };
    canvas.dispatchEvent(new PointerEvent('pointerdown', p));
    document.dispatchEvent(new PointerEvent('pointermove', { ...p, clientY: p.clientY - 100 }));
    document.dispatchEvent(new PointerEvent('pointerup', { ...p, clientY: p.clientY - 100 }));
    return { before, after: scroll.scrollTop };
  });
  assert.ok(panResult.after > panResult.before);
  assert.equal((await latest()).strokes.length, 22);
  checks.push('One-finger pan works in writing mode after pen-up without creating strokes');
  await page.evaluate(() => {
    const view = window.mockApp.workspace.getLeavesOfType()[0].view;
    view.lastPenAt = performance.now(); // Reproduce a finger landing inside the pen-up guard window.
    const canvas = document.querySelector('.inkpdf-probe-ink[data-active]'), r = canvas.getBoundingClientRect();
    const scroll = document.querySelector('.inkpdf-probe-scroll'); scroll.scrollTop = 0;
    const p = { pointerId: 103, pointerType: 'touch', width: 64, height: 64, bubbles: true, clientX: r.left + 200, clientY: 600 };
    window.testTouch = p;
    canvas.dispatchEvent(new PointerEvent('pointerdown', p));
    document.dispatchEvent(new PointerEvent('pointermove', { ...p, clientY: 580 }));
    if (scroll.scrollTop !== 0) throw new Error('cooldown must suppress early movement');
  });
  await page.waitForTimeout(200);
  await page.evaluate(() => {
    const p = window.testTouch;
    document.dispatchEvent(new PointerEvent('pointermove', { ...p, clientY: 480 }));
    document.dispatchEvent(new PointerEvent('pointerup', { ...p, clientY: 480 }));
    if (document.querySelector('.inkpdf-probe-scroll').scrollTop <= 0) throw new Error('same finger must resume after cooldown');
  });
  checks.push('Finger landing during cooldown can pan later without lifting; 64px contact is accepted');
  await page.evaluate(() => { document.querySelector('.inkpdf-probe-scroll').scrollTop = 0; });
  await page.getByRole('button', { name: '工具：钢笔', exact: true }).click();
  const eraserTarget = await page.evaluate(() => {
    const view = window.mockApp.workspace.getLeavesOfType()[0].view;
    const [x, y] = view.current.strokes[10].points[0];
    const [a, b, c, d, e, f] = view.current.viewport.transform;
    const r = document.querySelector('.inkpdf-probe-ink[data-active]').getBoundingClientRect();
    return { x: r.left + a * x + c * y + e, y: r.top + b * x + d * y + f };
  });
  await page.mouse.click(eraserTarget.x, eraserTarget.y);
  await page.waitForFunction(() => document.querySelector('.inkpdf-probe-status')?.textContent.includes('21 笔') && document.querySelector('.inkpdf-probe-status')?.textContent.includes('已保存'));
  assert.equal((await latest()).strokes.length, 21);
  await page.getByRole('button', { name: /^撤销/ }).click();
  await page.waitForFunction(() => document.querySelector('.inkpdf-probe-status')?.textContent.includes('22 笔') && document.querySelector('.inkpdf-probe-status')?.textContent.includes('已保存'));
  assert.equal((await latest()).strokes.length, 22);
  // Two distinct erases must be recoverable in reverse order.
  await page.mouse.click(eraserTarget.x, eraserTarget.y);
  await page.mouse.click(eraserTarget.x, eraserTarget.y + 45);
  await page.getByRole('button', { name: '保存 / 重试', exact: true }).click();
  assert.equal((await latest()).strokes.length, 20);
  await page.getByRole('button', { name: /^撤销/ }).click();
  await page.getByRole('button', { name: /^撤销/ }).click();
  await page.getByRole('button', { name: '保存 / 重试', exact: true }).click();
  assert.equal((await latest()).strokes.length, 22);
  checks.push('Two erase transactions restore in order and persist');
  await page.mouse.click(eraserTarget.x, eraserTarget.y);
  await page.getByRole('button', { name: '保存并重新读取', exact: true }).click();
  await page.reload();
  await page.locator('.inkpdf-probe-more').evaluate(e => e.open = true);
  await page.waitForFunction(() => document.querySelector('.inkpdf-probe-status')?.textContent.includes('21 笔'));
  assert.equal((await latest()).strokes.length, 21);
  checks.push('Whole-stroke eraser decreases count, one-step restore works, erased state survives reload');
  await page.locator('.inkpdf-probe-more').evaluate(e => e.open = true);
  await page.getByRole('button', { name: '导出诊断', exact: true }).click();
  await page.waitForFunction(() => Object.keys(window.readFiles()).filter(p => p.includes('diagnostic-')).length >= 2);
  const finalReport = await page.evaluate(() => JSON.parse(Object.entries(window.readFiles()).filter(([p]) => p.includes('diagnostic-')).at(-1)[1]));
  assert.equal(finalReport.probeVersion, '0.0.7');
  assert.equal(finalReport.strokesSaved, 21);
  await page.screenshot({ path: '.test/probe-0.0.7.png' });
  // Independent two-page PDF, loaded through the vault API rather than the embedded fixture.
  const objects = ['<< /Type /Catalog /Pages 2 0 R >>', '<< /Type /Pages /Kids [3 0 R 4 0 R] /Count 2 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << >> /Contents 5 0 R >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << >> /Contents 5 0 R >>',
    '<< /Length 0 >>\nstream\n\nendstream'];
  let realPdf = '%PDF-1.4\n', offsets = [0];
  for (let i = 0; i < objects.length; i++) { offsets.push(realPdf.length); realPdf += `${i + 1} 0 obj\n${objects[i]}\nendobj\n`; }
  const xref = realPdf.length;
  realPdf += `xref\n0 6\n0000000000 65535 f \n${offsets.slice(1).map(n => String(n).padStart(10, '0') + ' 00000 n \n').join('')}trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  const pdfA = Buffer.from(realPdf).toString('base64'), pdfB = Buffer.from(realPdf + '% different revision\n').toString('base64');
  await page.evaluate(async data => {
    const files = window.readFiles(); files['Documents/A.pdf'] = data;
    localStorage.setItem('inkpdf-test-files', JSON.stringify(files));
    await window.plugin.open(true, 'Documents/A.pdf');
  }, pdfA);
  await page.locator('.inkpdf-probe-more').evaluate(e => e.open = true);
  const viewState = () => page.evaluate(() => {
    const v = window.mockApp.workspace.getLeavesOfType()[0].view;
    return { ready: v.current.ready, run: v.current.runId, strokes: v.current.strokes, pdf: v.report.pdf };
  });
  assert.equal((await viewState()).ready, true);
  assert.equal((await viewState()).pdf.pages, 2);
  assert.equal((await viewState()).pdf.selectedPage, 1);
  const aRect = await page.locator('.inkpdf-probe-ink[data-active]').boundingBox();
  await page.mouse.move(aRect.x + 100, aRect.y + 100); await page.mouse.down();
  await page.mouse.move(aRect.x + 180, aRect.y + 140); await page.mouse.up();
  await page.getByRole('button', { name: '保存并重新读取', exact: true }).click();
  const savedA = await viewState();
  assert.equal(savedA.strokes.length, 1);
  await page.getByRole('button', { name: '下一页', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('.inkpdf-probe-controls')?.textContent.includes('第 2 / 2 页'));
  assert.equal((await viewState()).strokes.length, 0);
  assert.ok((await viewState()).run.endsWith('-p2'));
  const p2 = await page.locator('.inkpdf-probe-ink[data-active]').boundingBox();
  await page.mouse.move(p2.x + 160, p2.y + 100); await page.mouse.down();
  await page.mouse.move(p2.x + 210, p2.y + 150); await page.mouse.up();
  // Navigate immediately: page switch must flush, not discard the debounce window.
  await page.getByRole('button', { name: '上一页', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('.inkpdf-probe-controls')?.textContent.includes('第 1 / 2 页'));
  assert.deepEqual((await viewState()).strokes, savedA.strokes);
  await page.getByRole('button', { name: '下一页', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('.inkpdf-probe-controls')?.textContent.includes('第 2 / 2 页'));
  const savedSecond = await viewState();
  assert.equal(savedSecond.strokes.length, 1);
  assert.notDeepEqual(savedSecond.strokes, savedA.strokes);
  await page.reload();
  await page.locator('.inkpdf-probe-more').evaluate(e => e.open = true);
  await page.waitForFunction(() => document.querySelector('.inkpdf-probe-controls')?.textContent.includes('第 2 / 2 页'));
  assert.deepEqual((await viewState()).strokes, savedSecond.strokes);
  await page.evaluate(() => { window.failWrites = true; });
  const p2b = await page.locator('.inkpdf-probe-ink[data-active]').boundingBox();
  await page.mouse.move(p2b.x + 230, p2b.y + 140); await page.mouse.down();
  await page.mouse.move(p2b.x + 260, p2b.y + 180); await page.mouse.up();
  await page.getByRole('button', { name: '上一页', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('.inkpdf-probe-status')?.textContent.includes('失败'));
  assert.equal((await viewState()).pdf.selectedPage, 2);
  assert.equal((await viewState()).strokes.length, 2);
  await page.evaluate(() => { window.failWrites = false; });
  await page.getByRole('button', { name: '上一页', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('.inkpdf-probe-controls')?.textContent.includes('第 1 / 2 页'));
  assert.deepEqual((await viewState()).strokes, savedA.strokes);
  await page.getByRole('button', { name: '下一页', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('.inkpdf-probe-controls')?.textContent.includes('第 2 / 2 页'));
  assert.equal((await viewState()).strokes.length, 2);
  await page.evaluate(() => window.plugin.commands['toggle-pen-eraser']());
  await page.getByRole('button', { name: '工具：整笔橡皮', exact: true }).waitFor();
  await page.evaluate(() => window.plugin.commands['toggle-pen-eraser']());
  await page.getByRole('button', { name: '工具：钢笔', exact: true }).waitFor();
  await page.getByRole('button', { name: '上一页', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('.inkpdf-probe-controls')?.textContent.includes('第 1 / 2 页'));
  checks.push('Per-page ink isolated, immediate navigation flushes, restart resumes page 2, failed save blocks navigation without losing ink, retry works');
  checks.push('Explicit pen/eraser command toggles tool; no simulated Pencil barrel double tap');
  await page.reload();
  await page.locator('.inkpdf-probe-more').evaluate(e => e.open = true);
  await page.waitForFunction(() => document.querySelector('.inkpdf-probe-status')?.textContent.includes('1 笔'));
  assert.deepEqual((await viewState()).strokes, savedA.strokes);
  await page.evaluate(async () => {
    const files = window.readFiles(); files['Documents/Renamed.pdf'] = files['Documents/A.pdf']; delete files['Documents/A.pdf'];
    localStorage.setItem('inkpdf-test-files', JSON.stringify(files));
    await window.plugin.open(true, 'Documents/Renamed.pdf');
  });
  assert.equal((await viewState()).run, savedA.run);
  assert.deepEqual((await viewState()).strokes, savedA.strokes);
  await page.evaluate(async data => {
    const files = window.readFiles(); files['Documents/Renamed.pdf'] = data;
    localStorage.setItem('inkpdf-test-files', JSON.stringify(files));
    await window.plugin.open(true, 'Documents/Renamed.pdf');
  }, pdfB);
  assert.notEqual((await viewState()).run, savedA.run);
  assert.equal((await viewState()).strokes.length, 0);
  await page.evaluate(async data => {
    const files = window.readFiles(); files['Documents/Renamed.pdf'] = data;
    localStorage.setItem('inkpdf-test-files', JSON.stringify(files));
    await window.plugin.open(true, 'Documents/Renamed.pdf');
  }, pdfA);
  assert.deepEqual((await viewState()).strokes, savedA.strokes);
  assert.equal(await page.evaluate(() => window.readFiles()['Documents/Renamed.pdf']), pdfA);
  assert.equal(await page.evaluate(() => Object.keys(window.readFiles()).some(p => p.startsWith('InkPDF-Probe/pdf-') && p.endsWith('.pdf'))), false);
  checks.push('Vault two-page PDF opens page 1, saves/reloads exact ink; rename preserves association, replacement isolates ink, source unchanged and not copied');
  await page.evaluate(async () => { await window.plugin.open(true, 'missing.pdf'); });
  assert.equal((await viewState()).ready, false);
  await page.evaluate(async () => { await window.plugin.open(true, 'Documents/Renamed.pdf'); });
  assert.deepEqual((await viewState()).strokes, savedA.strokes);
  checks.push('Missing PDF fails visibly; another PDF can still open without losing existing annotations');
  await page.evaluate(async () => {
    const files = window.readFiles(); files['Documents/Broken.pdf'] = btoa('This is not a PDF');
    localStorage.setItem('inkpdf-test-files', JSON.stringify(files));
    await window.plugin.open(true, 'Documents/Broken.pdf');
  });
  assert.equal((await viewState()).ready, false);
  await page.evaluate(async () => { await window.plugin.open(true, 'Documents/Renamed.pdf'); });
  assert.deepEqual((await viewState()).strokes, savedA.strokes);
  assert.equal(await page.evaluate(() => window.readFiles()['Documents/Broken.pdf']), Buffer.from('This is not a PDF').toString('base64'));
  await page.locator('.inkpdf-probe-more').evaluate(e => e.open = true);
  await page.getByRole('button', { name: '导出诊断', exact: true }).click();
  const pdfReport = await page.evaluate(() => JSON.parse(Object.entries(window.readFiles()).filter(([p]) => p.includes('diagnostic-')).at(-1)[1]));
  assert.equal(pdfReport.pdf.selectedPage, 1);
  assert.equal(pdfReport.pdf.sourceReadOnly, true);
  assert.equal(JSON.stringify(pdfReport).includes('Renamed.pdf'), false);
  await page.getByRole('button', { name: '荧光笔', exact: true }).click();
  await page.getByLabel('粗细（只影响新笔迹）').selectOption('2');
  const markerRect = await page.locator('.inkpdf-probe-ink[data-active]').boundingBox();
  await page.mouse.move(markerRect.x + 100, markerRect.y + 210); await page.mouse.down();
  await page.mouse.move(markerRect.x + 260, markerRect.y + 210, { steps: 16 }); await page.mouse.up();
  await page.getByRole('button', { name: '保存 / 重试', exact: true }).click();
  const markerState = await viewState();
  assert.equal(markerState.strokes.at(-1).kind, 'highlighter');
  assert.equal(markerState.strokes.at(-1).color, '#f4d03f');
  assert.equal(markerState.strokes.at(-1).size, 2);
  const pixels = await page.evaluate(() => {
    const c = document.querySelector('.inkpdf-probe-committed[data-active]'), r = c.getBoundingClientRect();
    return [120, 180, 240].map(x => c.getContext('2d').getImageData(Math.round(x*c.width/r.width), Math.round(210*c.height/r.height), 1, 1).data[3]);
  });
  assert.ok(pixels.every(a => a >= 75 && a <= 78), JSON.stringify(pixels));
  await page.getByRole('button', { name: /^撤销/ }).click();
  assert.equal((await viewState()).strokes.length, markerState.strokes.length - 1);
  await page.getByRole('button', { name: /^重做/ }).click();
  assert.deepEqual((await viewState()).strokes, markerState.strokes);
  await page.getByRole('button', { name: '保存并重新读取', exact: true }).click();
  await page.waitForTimeout(250);
  await page.screenshot({path:'.test/style-before.png'});
  const inkBefore = await page.locator('.inkpdf-probe-committed[data-active]').evaluate(c => c.toDataURL());
  await page.reload();
  await page.locator('.inkpdf-probe-more').evaluate(e => e.open = true);
  await page.waitForFunction(() => document.querySelector('.inkpdf-probe-status')?.textContent.includes('已保存'));
  assert.deepEqual((await viewState()).strokes, markerState.strokes);
  await page.waitForTimeout(250);
  await page.screenshot({path:'.test/style-after.png'});
  const pixelDiff = await page.evaluate(async previous => {
    const image = await createImageBitmap(await (await fetch(previous)).blob());
    const c = document.querySelector('.inkpdf-probe-committed[data-active]');
    const prior = document.createElement('canvas'); prior.width = c.width; prior.height = c.height;
    prior.getContext('2d').drawImage(image, 0, 0); image.close();
    const a = prior.getContext('2d').getImageData(0,0,c.width,c.height).data;
    const b = c.getContext('2d').getImageData(0,0,c.width,c.height).data;
    const bounds = data => {
      let x0=c.width, y0=c.height, x1=0, y1=0;
      for(let i=3;i<data.length;i+=4) if(data[i]>10) {
        const n=(i-3)/4, x=n%c.width, y=Math.floor(n/c.width);
        x0=Math.min(x0,x); x1=Math.max(x1,x); y0=Math.min(y0,y); y1=Math.max(y1,y);
      }
      return {x0,y0,x1,y1};
    };
    const r=c.getBoundingClientRect();
    const alpha=[120,180,240].map(x=>b[(Math.round(210*c.height/r.height)*c.width+Math.round(x*c.width/r.width))*4+3]);
    return {before:bounds(a),after:bounds(b),alpha};
  }, inkBefore);
  // Canvas rasterization can vary at edges; assert geometry and interior opacity, not PNG byte identity.
  assert.deepEqual(pixelDiff.after, pixelDiff.before);
  assert.ok(pixelDiff.alpha.every(a=>a>=75 && a<=78));
  await page.getByLabel('颜色（只影响新笔迹）').selectOption('#d93025');
  await page.getByLabel('粗细（只影响新笔迹）').selectOption('0.5');
  const penRect = await page.locator('.inkpdf-probe-ink[data-active]').boundingBox();
  await page.mouse.move(penRect.x + 100, penRect.y + 260); await page.mouse.down();
  await page.mouse.move(penRect.x + 220, penRect.y + 260); await page.mouse.up();
  assert.equal((await viewState()).strokes.at(-1).color, '#d93025');
  await page.getByRole('button', { name: /^撤销/ }).click();
  await page.getByRole('button', { name: /^重做/ }).click();
  await page.getByRole('button', { name: '保存 / 重试', exact: true }).click();
  checks.push('Highlighter has uniform 30% alpha, undo/redo preserves styles, reload preserves geometry and interior opacity, new red thin pen does not restyle old ink');
  await page.screenshot({ path: '.test/vault-pdf-0.0.7.png' });
  checks.push('Invalid PDF fails without modifying source; recovery opens valid PDF; diagnostic omits source path and reports page 1');

  // True continuous scroll, including mixed page sizes and eviction/reload.
  const multiObjects = ['<< /Type /Catalog /Pages 2 0 R >>', '<< /Type /Pages /Kids [3 0 R 4 0 R 5 0 R 6 0 R 7 0 R 8 0 R] /Count 6 >>'];
  for(let i=0;i<6;i++) multiObjects.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${i%2?500:595} ${i%2?650:842}] /Resources << >> /Contents 9 0 R >>`);
  multiObjects.push('<< /Length 0 >>\nstream\n\nendstream');
  let multi='%PDF-1.4\n', multiOffsets=[0];
  for(let i=0;i<multiObjects.length;i++){multiOffsets.push(multi.length);multi+=`${i+1} 0 obj\n${multiObjects[i]}\nendobj\n`;}
  const multiXref=multi.length;
  multi+=`xref\n0 10\n0000000000 65535 f \n${multiOffsets.slice(1).map(n=>String(n).padStart(10,'0')+' 00000 n \n').join('')}trailer\n<< /Size 10 /Root 1 0 R >>\nstartxref\n${multiXref}\n%%EOF\n`;
  await page.evaluate(async data=>{
    const files=window.readFiles();files['Documents/Continuous.pdf']=data;localStorage.setItem('inkpdf-test-files',JSON.stringify(files));
    await window.plugin.open(true,'Documents/Continuous.pdf');
  },Buffer.from(multi).toString('base64'));
  const compact=await page.evaluate(()=>{
    const toolbar=document.querySelector('.inkpdf-probe-controls'),scroll=document.querySelector('.inkpdf-probe-scroll');
    return {height:toolbar.getBoundingClientRect().height,available:scroll.clientHeight,details:document.querySelector('details').open};
  });
  assert.equal(compact.details,false);assert.ok(compact.height<=60);assert.ok(compact.available>750);
  await page.screenshot({path:'.test/compact-0.0.7.png'});
  const scrollToPage=async n=>{
    await page.evaluate(n=>{
      const v=window.mockApp.workspace.getLeavesOfType()[0].view,p=v.pages.get(n);
      v.scroll.scrollTop+=p.sheet.getBoundingClientRect().top-v.scroll.getBoundingClientRect().top-12;
    },n);
    await page.waitForFunction(n=>{const v=window.mockApp.workspace.getLeavesOfType()[0].view;return v.pageNumber===n&&v.current.rendered&&!v.refreshTask;},n);
  };
  const simpleStroke=async ()=>page.evaluate(()=>{
    const v=window.mockApp.workspace.getLeavesOfType()[0].view,c=v.current.ink,r=c.getBoundingClientRect();
    const p={pointerId:900,pointerType:'pen',button:0,buttons:1,bubbles:true,pressure:.3,clientX:r.left+80,clientY:r.top+100};
    c.dispatchEvent(new PointerEvent('pointerdown',p));
    document.dispatchEvent(new PointerEvent('pointermove',{...p,clientX:p.clientX+80}));
    document.dispatchEvent(new PointerEvent('pointerup',{...p,clientX:p.clientX+80,buttons:0}));
  });
  await simpleStroke();
  // Scroll before the debounce save; the first page's async save must retain its own identity.
  await scrollToPage(2);await simpleStroke();await scrollToPage(6);await simpleStroke();
  await page.evaluate(()=>window.mockApp.workspace.getLeavesOfType()[0].view.flush());
  const counts=await page.evaluate(()=>Object.entries(window.readFiles()).filter(([k])=>k.includes('/snapshots/')).map(([,v])=>JSON.parse(v)).filter(v=>v.sourceHash===window.mockApp.workspace.getLeavesOfType()[0].view.sourceHash).map(v=>({page:v.runId.split('-p').at(-1),count:v.strokes.length})));
  for(const n of ['1','2','6'])assert.ok(counts.some(p=>p.page===n&&p.count===1));
  assert.ok(await page.evaluate(()=>[...window.mockApp.workspace.getLeavesOfType()[0].view.pages.values()].filter(p=>p.rendered).length<=3));
  await scrollToPage(1);assert.equal((await viewState()).strokes.length,1);
  // One touch gesture crosses a page boundary without lifting.
  await page.waitForTimeout(200);
  await page.evaluate(()=>{
    const v=window.mockApp.workspace.getLeavesOfType()[0].view;
    const p={pointerId:901,pointerType:'touch',bubbles:true,clientX:200,clientY:600};
    v.current.ink.dispatchEvent(new PointerEvent('pointerdown',p));
    document.dispatchEvent(new PointerEvent('pointermove',{...p,clientY:-500}));
    document.dispatchEvent(new PointerEvent('pointermove',{...p,clientY:-800}));
    document.dispatchEvent(new PointerEvent('pointerup',{...p,clientY:-800}));
  });
  await page.waitForFunction(()=>window.mockApp.workspace.getLeavesOfType()[0].view.pageNumber>=2);
  await scrollToPage(6);
  await page.reload();await page.waitForFunction(()=>window.mockApp?.workspace.getLeavesOfType()[0]?.view.current.ready);
  assert.equal((await viewState()).pdf.selectedPage,6);assert.equal((await viewState()).strokes.length,1);
  // An offscreen failed save stays pinned and is retried without contaminating another page.
  await page.evaluate(()=>{window.failWrites=true;});await simpleStroke();await scrollToPage(2);
  await page.waitForFunction(()=>document.querySelector('.inkpdf-probe-status').textContent.includes('失败'));
  await simpleStroke();await page.waitForTimeout(300);
  await page.evaluate(async()=>{window.failWrites=false;await window.mockApp.workspace.getLeavesOfType()[0].view.flush();});
  await scrollToPage(6);assert.equal((await viewState()).strokes.length,2);
  await scrollToPage(2);assert.equal((await viewState()).strokes.length,2);
  checks.push('Continuous mixed-size page stack: single touch crosses boundaries, immediate scroll saves to original page, three canvas pages retained, eviction/reload and restart preserve ink; offscreen save failures retry independently');
  checks.push('Closed More panel leaves a single toolbar row under 60px and over 750px PDF height at 820x980');
  // Dwell previews fit; early lift and movement cancel; undo restores raw samples.
  const beginShape=async kind=>page.evaluate(kind=>{
    const v=window.mockApp.workspace.getLeavesOfType()[0].view,c=v.current.ink,r=c.getBoundingClientRect();
    let xy;
    if(kind==='circle')xy=Array.from({length:80},(_,i)=>[180+50*Math.cos(i*2*Math.PI/79),220+50*Math.sin(i*2*Math.PI/79)]);
    else if(kind==='rectangle'){
      xy=[];for(let i=0;i<=20;i++)xy.push([100+i*5,180]);for(let i=1;i<=20;i++)xy.push([200,180+i*3]);for(let i=1;i<=20;i++)xy.push([200-i*5,240]);for(let i=1;i<=20;i++)xy.push([100,240-i*3]);
    }else xy=Array.from({length:25},(_,i)=>[80+i*5,160+Math.sin(i)]);
    const base={pointerId:902,pointerType:'pen',button:0,buttons:1,bubbles:true,pressure:.3};
    xy.forEach(([x,y],i)=>{const p={...base,clientX:r.left+x,clientY:r.top+y};(i?document:c).dispatchEvent(new PointerEvent(i?'pointermove':'pointerdown',p));window.shapeEnd=p;});
  },kind);
  const endShape=async()=>page.evaluate(()=>document.dispatchEvent(new PointerEvent('pointerup',{...window.shapeEnd,buttons:0})));
  await beginShape('line');await page.waitForTimeout(300);await endShape();
  assert.ok((await viewState()).strokes.at(-1).points.length>2);
  for(const kind of ['line','rectangle','circle']){
    await beginShape(kind);await page.waitForTimeout(1150);
    assert.equal(await page.evaluate(()=>window.mockApp.workspace.getLeavesOfType()[0].view.fitted?.kind),kind);
    const raw=await page.evaluate(()=>structuredClone(window.mockApp.workspace.getLeavesOfType()[0].view.active.stroke.points));
    await endShape();const fitted=(await viewState()).strokes.at(-1);
    assert.equal(fitted.points.length,{line:2,rectangle:5,circle:65}[kind]);
    await page.getByRole('button',{name:/^撤销/}).click();
    assert.deepEqual((await viewState()).strokes.at(-1).points.slice(0,raw.length),raw);
    await page.getByRole('button',{name:/^重做/}).click();
    assert.deepEqual((await viewState()).strokes.at(-1),fitted);
  }
  await beginShape('line');await page.waitForTimeout(1150);
  await page.evaluate(()=>document.dispatchEvent(new PointerEvent('pointermove',{...window.shapeEnd,clientY:window.shapeEnd.clientY+30})));
  assert.equal(await page.evaluate(()=>!!window.mockApp.workspace.getLeavesOfType()[0].view.fitted),false);
  await endShape();
  const shapeSaved=(await viewState()).strokes;
  await page.evaluate(()=>window.mockApp.workspace.getLeavesOfType()[0].view.flush());await page.reload();
  await page.waitForFunction(()=>window.mockApp?.workspace.getLeavesOfType()[0]?.view.current.ready);
  assert.deepEqual((await viewState()).strokes,shapeSaved);
  checks.push('Pencil dwell: early lift stays freehand, one-second line/rectangle/circle fit, movement cancels preview, undo restores original, redo and restart preserve fitted geometry');
  assert.equal(failures.length, 0, failures.join('\n'));
  await writeFile('.test/browser-results.json', JSON.stringify({ probeVersion: '0.0.7', status: 'PASS', browser: await browser.version(), checks,
    notRun: ['real Obsidian', 'iPad WKWebView', 'Apple Pencil', 'OCR', 'GitHub sync'] }, null, 2));
  console.log(checks.join('\n'));
} finally {
  await browser?.close();
  server.close();
}
