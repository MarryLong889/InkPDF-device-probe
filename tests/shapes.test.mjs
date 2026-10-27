import test from 'node:test';
import assert from 'node:assert/strict';
import { fitShape } from '../.test/shapes.mjs';
const points = xy => xy.map(([x,y], i) => [x,y,.3,i]);
test('fits a noisy line but rejects bent handwriting and short marks', () => {
  assert.equal(fitShape(points(Array.from({length:30},(_,i)=>[i*4,Math.sin(i)*1.5]))).kind,'line');
  assert.equal(fitShape(points([[0,0],[10,20],[20,0],[30,20],[40,0],[50,20]])),null);
  assert.equal(fitShape(points([[0,0],[1,0],[2,0],[3,0],[4,0]])),null);
});
test('closed rectangle and noisy circle fit; open arcs and scribbles do not', () => {
  const rectangle=[];
  for(let i=0;i<=20;i++)rectangle.push([i*5,0]);
  for(let i=1;i<=20;i++)rectangle.push([100,i*3]);
  for(let i=1;i<=20;i++)rectangle.push([100-i*5,60]);
  for(let i=1;i<=20;i++)rectangle.push([0,60-i*3]);
  assert.equal(fitShape(points(rectangle)).kind,'rectangle');
  const circle=Array.from({length:100},(_,i)=>{const a=i*2*Math.PI/99,r=50+Math.sin(i)*1;return [r*Math.cos(a),r*Math.sin(a)];});
  const fit=fitShape(points(circle));
  assert.equal(fit.kind,'circle');
  assert.equal(fit.points.length,65);
  assert.equal(fitShape(points(circle.slice(0,65))),null);
  assert.equal(fitShape(points([...circle,...circle])),null);
});
test('fit does not mutate samples and emits monotonic times and constant pressure', () => {
  const raw=points(Array.from({length:20},(_,i)=>[i*5,Math.sin(i)])),before=structuredClone(raw);
  const fit=fitShape(raw);
  assert.deepEqual(raw,before);
  assert.ok(fit.points.every((p,i,a)=>!i||p[3]>=a[i-1][3]));
  assert.equal(fit.points[0][2],fit.points.at(-1)[2]);
});
