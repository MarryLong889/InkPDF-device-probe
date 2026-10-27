import { build } from 'esbuild';
import { mkdir } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
await mkdir('.test', { recursive: true });
await build({ entryPoints: ['src/core.ts'], outfile: '.test/core.mjs', platform: 'node', format: 'esm', bundle: true });
await build({ entryPoints: ['src/shapes.ts'], outfile: '.test/shapes.mjs', platform: 'node', format: 'esm', bundle: true });
const result = spawnSync(process.execPath, ['--test', 'tests/core.test.mjs', 'tests/shapes.test.mjs'], { stdio: 'inherit' });
process.exitCode = result.status ?? 1;
