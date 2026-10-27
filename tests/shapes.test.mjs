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

const denseShapes = () => {
  const line=Array.from({length:601},(_,i)=>[i/5,(i%2?.4:-.4)]);
  const rectangle=[];
  for(let edge=0;edge<4;edge++)for(let i=0;i<=200;i++) {
    const t=i/200,j=i===0||i===200?0:(i%2?.4:-.4);
    rectangle.push(edge===0?[100*t,j]:edge===1?[100+j,60*t]:edge===2?[100*(1-t),60+j]:[j,60*(1-t)]);
  }
  const circle=Array.from({length:1001},(_,i)=>{const a=i*2*Math.PI/1000,r=50+(i%2?.4:-.4);return [r*Math.cos(a),r*Math.sin(a)];});
  return {line,rectangle,circle};
};
test('dense noisy drawing samples must not inflate path length and reject simple shapes',()=>{
  for(const [kind,xy] of Object.entries(denseShapes())) assert.equal(fitShape(points(xy))?.kind,kind);
});

test('metrics identify rejection gates without recording coordinates',()=>{
  const tiny={};assert.equal(fitShape(points([[0,0],[1,0],[2,0],[3,0],[4,0]]),tiny),null);
  assert.equal(tiny.reason,'too-short');
  const noisy={};const raw=points(denseShapes().line),before=structuredClone(raw);
  assert.equal(fitShape(raw,noisy).kind,'line');
  assert.ok(noisy.rawToCleanLengthRatio>2);
  assert.ok(noisy.simplifiedSamples<noisy.rawSamples);
  assert.equal(noisy.reason,'accepted-line');assert.deepEqual(raw,before);
  assert.ok(Object.values(noisy).every(v=>typeof v==='string'||Number.isFinite(v)));
  assert.equal('points' in noisy,false);
});
test('denoising preserves corners and rejects triangles, open boxes and large bends',()=>{
  const path=vertices=>{const xy=[];for(let j=1;j<vertices.length;j++)for(let i=0;i<=100;i++){const t=i/100;xy.push([vertices[j-1][0]*(1-t)+vertices[j][0]*t,vertices[j-1][1]*(1-t)+vertices[j][1]*t]);}return points(xy);};
  for(const vertices of [
    [[0,0],[60,100],[120,0],[0,0]],
    [[0,0],[100,0],[100,80],[0,80]],
    [[0,0],[60,25],[120,0]],
    [[0,0],[100,80],[0,80],[100,0],[0,0]]
  ])assert.equal(fitShape(path(vertices)),null);
  const small=Array.from({length:1000},(_,i)=>[Math.cos(i)*3,Math.sin(i)*3]);
  assert.equal(fitShape(points(small)),null);
});
