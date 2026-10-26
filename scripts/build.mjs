import { build } from 'esbuild';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
const fixture = await readFile('fixtures/InkPDF-probe.pdf');
await mkdir('src/generated', { recursive: true });
await writeFile('src/generated/fixture.ts', `// Generated from the synthetic test fixture.\nexport const PDF_BASE64 = ${JSON.stringify(fixture.toString('base64'))};\n`);
const result = await build({ entryPoints: ['src/main.ts'], outfile: 'main.js', bundle: true,
  platform: 'browser', format: 'cjs', target: 'safari16.4', external: ['obsidian'], sourcemap: false, minify: false, metafile: true });
const imports = Object.values(result.metafile.outputs).flatMap(o => o.imports);
if (imports.some(i => i.path !== 'obsidian')) throw new Error('Unexpected runtime import');
