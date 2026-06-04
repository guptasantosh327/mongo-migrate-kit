import { execSync, spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { type TestMongo, startTestMongo } from '../helpers/mongo.js';
import { insertMigration, makeProject } from '../helpers/project.js';

/**
 * These tests exercise the SHIPPED artifact the way an installed user runs it:
 * the bundled `dist/mmk.cjs` under plain `node` (no `tsx`). Every other CLI test
 * spawns the source via `npx tsx`, which transparently loads `.ts` — so on its
 * own the suite over-states real-world `.ts` support. Here we close that gap.
 */

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.join(here, '..', '..');
const builtBin = path.join(repoRoot, 'dist', 'mmk.cjs');

// Node enabled TypeScript type-stripping by default in v22.18 (unflagged in
// v23.6). Below that, plain `node` cannot import `.ts` and mmk surfaces a clear
// error instead of a cryptic ERR_UNKNOWN_FILE_EXTENSION.
const [major, minor] = process.versions.node.split('.').map(Number);
const nodeStripsTypes = (major ?? 0) > 22 || ((major ?? 0) === 22 && (minor ?? 0) >= 18);

interface CliResult {
  code: number;
  stdout: string;
  stderr: string;
}

/** Run the built binary under the current (plain) Node — never tsx */
function runBuilt(args: string[], cwd: string): Promise<CliResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [builtBin, ...args], { cwd, env: { ...process.env } });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => {
      stdout += String(chunk);
    });
    child.stderr.on('data', (chunk) => {
      stderr += String(chunk);
    });
    child.on('error', reject);
    child.on('close', (code) => resolve({ code: code ?? 0, stdout, stderr }));
  });
}

const tsMigration = `import type { MigrationContext } from 'mongo-migrate-kit';
export async function up({ db }: MigrationContext): Promise<void> {
  await db.collection('rt_ts').insertOne({ marker: 'ts' });
}
export async function down({ db }: MigrationContext): Promise<void> {
  await db.collection('rt_ts').deleteMany({ marker: 'ts' });
}
`;

let mongo: TestMongo;
const DB = 'mmk_runtime_test';

beforeAll(async () => {
  // Always build so we test the CURRENT source as the shipped artifact, not a
  // stale dist/ from an earlier build.
  execSync('npm run build', { cwd: repoRoot, stdio: 'ignore' });
  mongo = await startTestMongo(DB);
}, 120_000);

afterAll(async () => {
  await mongo.stop();
});

let project: ReturnType<typeof makeProject>;

beforeEach(async () => {
  await mongo.db.dropDatabase();
  project = makeProject();
});

afterEach(() => {
  project?.cleanup();
});

function args(extra: string[]): string[] {
  return ['--uri', mongo.uri, '--db', DB, '--dir', project.dir, ...extra];
}

describe('shipped binary under plain node (no tsx)', () => {
  it('should apply a .js migration', async () => {
    project.write('0001-js.js', insertMigration('rt_js', 'js'));
    const result = await runBuilt(args(['up', '0001-js.js']), project.dir);
    expect(result.code).toBe(0);
    expect(await mongo.db.collection('rt_js').countDocuments()).toBe(1);
  });

  it(`should ${nodeStripsTypes ? 'apply' : 'cleanly reject'} a .ts migration on this Node`, async () => {
    project.write('0002-ts.ts', tsMigration);
    const result = await runBuilt(args(['up', '0002-ts.ts']), project.dir);

    if (nodeStripsTypes) {
      expect(result.code).toBe(0);
      expect(await mongo.db.collection('rt_ts').countDocuments()).toBe(1);
    } else {
      // No type-stripping: must fail loudly with our actionable message, not a
      // raw Node ERR_UNKNOWN_FILE_EXTENSION, and must not have touched the DB.
      expect(result.code).toBe(1);
      expect(`${result.stdout}${result.stderr}`).toContain('TypeScript');
      expect(await mongo.db.collection('rt_ts').countDocuments()).toBe(0);
    }
  });
});
