import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const output = mkdtempSync(join(tmpdir(), 'hl-radar-tests-'));
try {
  const compiler = fileURLToPath(import.meta.resolve('typescript/bin/tsc'));
  const build = spawnSync(process.execPath, [compiler, 'src/lib/market.ts', 'src/lib/api.ts', '--target', 'ES2022', '--module', 'commonjs', '--moduleResolution', 'node', '--lib', 'ES2022,DOM', '--strict', '--skipLibCheck', '--outDir', output], { cwd: root, stdio: 'inherit' });
  if (build.status !== 0) process.exitCode = build.status || 1;
  else {
    const tests = spawnSync(process.execPath, ['--test', 'tests/data.test.cjs'], { cwd: root, stdio: 'inherit', env: { ...process.env, HL_RADAR_TEST_BUILD: output } });
    process.exitCode = tests.status ?? 1;
  }
} finally { rmSync(output, { recursive: true, force: true }); }
