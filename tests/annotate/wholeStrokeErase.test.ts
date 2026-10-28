// @vitest-environment jsdom
import { expect, it } from 'vitest';
import { PDFDocument } from 'pdf-lib';
import { readInklingAnnotations, writeInklingAnnotations } from '../../src/pdf/annotationSync';
import { eraseAt } from '../../src/annotate/eraser';
import type { StrokeAnnotation } from '../../src/annotate/types';
import { mountTestSurface } from '../harness/surface';

it('hits sparse segments and thick edges, keeps distant strokes unchanged', () => {
 const a: StrokeAnnotation = { id: 'a', kind: 'stroke', tool: 'pen', width: 10, color: '#000', points: [{ x: 0, y: 0 }, { x: 100, y: 0 }] };
 const b = { ...a, id: 'b', points: [{ x: 0, y: 100 }, { x: 100, y: 100 }] };
 expect(eraseAt([a, b], { x: 50, y: 6 }, 2, 'stroke')).toEqual([b]);
 expect(eraseAt([a], { x: 50, y: 20 }, 2, 'stroke')[0]).toBe(a);
 expect(a.points).toHaveLength(2);
});

it('erases multiple strokes in one gesture, undo/redo restores exact ink, mode changes apply immediately', () => {
 document.body.innerHTML = '';
 let mode: 'stroke' | 'pixel' = 'stroke';
 const surface = mountTestSurface(800, 450, { getEraserMode: () => mode });
 surface.drawStroke(Array.from({ length: 21 }, (_, i): [number, number] => [100 + i * 10, 100 + (i % 2) * 8]));
 surface.drawStroke([[100, 200], [150, 200], [200, 200], [250, 200], [300, 200]]);
 const original = structuredClone(surface.annotations());
 surface.controller.setTool('eraser');
 surface.pointer('pointerdown', 200, 100);
 surface.pointer('pointermove', 200, 200);
 surface.pointer('pointerup', 200, 200);
 expect(surface.annotations()).toHaveLength(0);
 surface.controller.undo();
 expect(surface.annotations()).toEqual(original);
 surface.controller.redo();
 expect(surface.annotations()).toHaveLength(0);
 surface.controller.undo();
 mode = 'pixel';
 surface.pointer('pointerdown', 200, 100);
 surface.pointer('pointerup', 200, 100);
 expect(surface.annotations().length).toBeGreaterThan(1);
 expect(surface.annotations()).not.toEqual(original);
 surface.controller.destroy();
});

it('persists whole-stroke removal in PDF while leaving another page intact', async () => {
 const doc = await PDFDocument.create(); doc.addPage(); doc.addPage();
 const stroke: StrokeAnnotation = { id: 'ink-one', kind: 'stroke', tool: 'pen', width: 3, color: '#000000', points: [{ x: 10, y: 10 }, { x: 110, y: 10 }] };
 writeInklingAnnotations(doc, 0, [stroke]);
 writeInklingAnnotations(doc, 1, [{ ...stroke, id: 'ink-two' }]);
 const read = await PDFDocument.load(await doc.save());
 writeInklingAnnotations(read, 0, eraseAt(readInklingAnnotations(read, 0), { x: 60, y: 10 }, 5, 'stroke'));
 const reopened = await PDFDocument.load(await read.save());
 expect(readInklingAnnotations(reopened, 0)).toHaveLength(0);
 expect(readInklingAnnotations(reopened, 1)).toHaveLength(1);
});
