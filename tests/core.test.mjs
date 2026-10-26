import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ProbeStore, parseSnapshot, pdfPoint, penWidth, hitsStroke } from '../.test/core.mjs';
const hash = 'a'.repeat(64);
const stroke = n => ({ id: `stroke-${n}`, pointerType: 'pen', interrupted: false, points: [[10, 20, .4, 0], [11, 21, .8, 12]] });
function memory() {
  const map = new Map();
  let failCreate = false, failRead = false;
  const files = {
    list: async () => [...map.keys()],
    read: async path => { if (failRead) throw new Error('read failed'); if (!map.has(path)) throw new Error('missing'); return map.get(path); },
    create: async (path, raw) => { if (failCreate) throw new Error('disk full'); assert.equal(map.has(path), false); map.set(path, raw); }
  };
  return { map, files, failCreate: v => { failCreate = v; }, failRead: v => { failRead = v; } };
}

test('20 strokes reopen exactly, immutable prior versions remain', async () => {
  const m = memory(), store = new ProbeStore(m.files, 'run', hash), all = [];
  assert.deepEqual(await store.load(), []);
  for (let i = 0; i < 20; i++) { all.push(stroke(i)); assert.equal((await store.save(all)).count, i + 1); }
  assert.equal(m.map.size, 20);
  assert.deepEqual(await new ProbeStore(m.files, 'run', hash).load(), all);
  assert.equal(JSON.parse([...m.map.values()][0]).strokes.length, 1);
});

test('write failure retry saves pending snapshot before new strokes', async () => {
  const m = memory(), store = new ProbeStore(m.files, 'run', hash);
  await store.load();
  m.failCreate(true);
  await assert.rejects(store.save([stroke(1)]), /disk full/);
  assert.equal(store.revision, 0);
  m.failCreate(false);
  assert.equal((await store.save([stroke(1), stroke(2)])).count, 1);
  assert.equal((await store.save([stroke(1), stroke(2)])).count, 2);
  assert.equal((await new ProbeStore(m.files, 'run', hash).load()).length, 2);
});

test('readback failure does not mark saved; retry does not duplicate writes', async () => {
  const m = memory();
  const create = m.files.create;
  m.files.create = async (...args) => { await create(...args); m.failRead(true); };
  const store = new ProbeStore(m.files, 'run', hash);
  await assert.rejects(store.save([stroke(1)]), /read failed/);
  assert.equal(store.revision, 0);
  m.failRead(false);
  assert.equal((await store.save([stroke(1)])).count, 1);
  assert.equal(m.map.size, 1);
});

test('corrupt/future/wrong PDF snapshots fail closed and preserve bytes', async () => {
  for (const change of [() => '{bad', v => JSON.stringify({ ...v, probeFormat: 2 }), v => JSON.stringify({ ...v, sourceHash: 'b'.repeat(64) })]) {
    const m = memory(), store = new ProbeStore(m.files, 'run', hash);
    await store.save([stroke(1)]);
    const key = [...m.map.keys()][0];
    m.map.set(key, change(JSON.parse(m.map.get(key))));
    const before = [...m.map.entries()];
    await assert.rejects(new ProbeStore(m.files, 'run', hash).load());
    assert.deepEqual([...m.map.entries()], before);
  }
});

test('external revision conflict and same-revision fork are detected', async () => {
  const m = memory(), a = new ProbeStore(m.files, 'run', hash), b = new ProbeStore(m.files, 'run', hash);
  await a.load(); await b.load();
  await a.save([stroke(1)]);
  await assert.rejects(b.save([stroke(2)]), /其他会话/);
  const raw = JSON.parse([...m.map.values()][0]);
  m.map.set('000001-other.json', JSON.stringify({ ...raw, strokes: [stroke(3)] }));
  await assert.rejects(new ProbeStore(m.files, 'run', hash).load(), /快照链/);
  assert.equal(m.map.size, 2);
});

test('missing predecessor is not mistaken for an empty session', async () => {
  const m = memory(), store = new ProbeStore(m.files, 'run', hash);
  await store.save([stroke(1)]); await store.save([stroke(1), stroke(2)]);
  m.map.delete([...m.map.keys()][0]);
  await assert.rejects(new ProbeStore(m.files, 'run', hash).load(), /快照链/);
});

test('input boundary rejects duplicate IDs, invalid pressure and reverse time', () => {
  const base = { probeFormat: 1, runId: 'run', sourceHash: hash, revision: 1, parentHash: null, strokes: [stroke(1)] };
  for (const mutation of [
    v => { v.strokes.push(stroke(1)); },
    v => { v.strokes[0].points[0][2] = 3; },
    v => { v.strokes[0].points[1][3] = -1; },
    v => { v.strokes[0].points[0][0] = null; },
    v => { v.strokes[0].points = []; }
  ]) {
    const v = structuredClone(base); mutation(v);
    assert.throws(() => parseSnapshot(JSON.stringify(v), 'run', hash));
  }
  assert.throws(() => new ProbeStore(memory().files, '../unsafe', hash));
});

test('rotated, offset viewport maps known PDF landmarks; singular rejected', () => {
  assert.deepEqual(pdfPoint([1, 0, 0, -1, -10, 220], 0, 0), [10, 220]);
  assert.deepEqual(pdfPoint([0, 2, 2, 0, -40, -20], 0, 0), [10, 20]);
  assert.deepEqual(pdfPoint([-1, 0, 0, 1, 110, -20], 0, 0), [110, 20]);
  assert.throws(() => pdfPoint([0, 0, 0, 0, 0, 0], 1, 1));
});

test('eraser handles swept crossings, dots and distant strokes', () => {
  const s = { ...stroke(1), points: [[0, 0, .3, 0], [100, 0, .3, 10]] };
  assert.equal(hitsStroke(s, [50, -20], [50, 20], 2), true);
  assert.equal(hitsStroke(s, [20, 0], [30, 0], 2), true);
  assert.equal(hitsStroke(s, [50, 20], [60, 20], 2), false);
  assert.equal(hitsStroke({ ...s, points: [[0, 0, null, 0]] }, [0, 2], [0, 2], 2), true);
});

test('pressure gain amplifies device range without changing old strokes', () => {
  const light = [0, 0, .05, 0], heavy = [0, 0, .341, 1];
  assert.equal(penWidth(heavy), .8 + .341 * 3);
  assert.ok(penWidth(heavy, 2.5) - penWidth(light, 2.5) > 2);
  assert.equal(penWidth([0, 0, 1, 0], 4), 3.8);
  assert.equal(penWidth([0, 0, null, 0], 4), 1.8);
});

test('erasing to zero and restoring persist even when count decreases', async () => {
  const m = memory(), store = new ProbeStore(m.files, 'run', hash);
  await store.save([stroke(1)], 1);
  assert.deepEqual(await store.save([], 2), { count: 0, editVersion: 2 });
  assert.deepEqual(await new ProbeStore(m.files, 'run', hash).load(), []);
  assert.deepEqual(await store.save([stroke(1)], 3), { count: 1, editVersion: 3 });
  assert.equal((await new ProbeStore(m.files, 'run', hash).load()).length, 1);
});

test('failed save followed by erase does not claim the erase was persisted', async () => {
  const m = memory(), store = new ProbeStore(m.files, 'run', hash);
  m.failCreate(true);
  await assert.rejects(store.save([stroke(1)], 1));
  m.failCreate(false);
  assert.deepEqual(await store.save([], 2), { count: 1, editVersion: 1 });
  assert.deepEqual(await store.save([], 2), { count: 0, editVersion: 2 });
});
