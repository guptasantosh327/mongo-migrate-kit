import { execSync, spawn } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
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
function runBuilt(args: string[], cwd: string, nodeFlags: string[] = []): Promise<CliResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [...nodeFlags, builtBin, ...args], {
      cwd,
      env: { ...process.env },
    });
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

  // On a type-stripping Node, switch it off to see what an older Node user sees.
  const noTypeStripping = nodeStripsTypes ? ['--no-experimental-strip-types'] : [];

  it('should explain a .ts config on a Node that cannot run TypeScript', async () => {
    project.write('mmk.config.ts', "export default { dbName: 'x' };\n");

    const result = await runBuilt(['--uri', mongo.uri, 'status'], project.dir, noTypeStripping);

    expect(result.code).toBe(1);
    expect(result.stdout + result.stderr).toContain(
      `Config file mmk.config.ts is TypeScript, and this Node (${process.version}) can't run TypeScript by itself`,
    );
    expect(result.stdout + result.stderr).toContain('Or use a JavaScript config: mmk init --js');
  });

  it('should explain a .ts migration on a Node that cannot run TypeScript', async () => {
    project.write('0003-ts.ts', tsMigration);

    const result = await runBuilt(args(['up', '0003-ts.ts']), project.dir, noTypeStripping);

    expect(result.code).toBe(1);
    expect(result.stdout + result.stderr).toContain(
      'Cannot load TypeScript migration "0003-ts.ts" — this Node runtime cannot import .ts files',
    );
    expect(await mongo.db.collection('rt_ts').countDocuments()).toBe(0);
  });
});

// The test project sits inside this repo, whose package.json is "type": "module";
// each case below gets its own package.json so the scope is the one under test.
describe('generated files in a CommonJS project (plain node)', () => {
  function commonjsApp(): string {
    const root = path.join(project.dir, 'app');
    mkdirSync(root);
    writeFileSync(path.join(root, 'package.json'), '{ "type": "commonjs" }');
    return root;
  }

  it('should init, create and apply without any manual edits', async () => {
    const root = commonjsApp();
    const db = ['--uri', mongo.uri, '--db', DB];
    expect((await runBuilt(['init', ...db], root)).code).toBe(0);
    expect(readFileSync(path.join(root, 'mmk.config.js'), 'utf8')).toContain(
      'module.exports = config;',
    );
    expect((await runBuilt(['create', 'add-js', '--js'], root)).code).toBe(0);
    if (nodeStripsTypes) {
      expect((await runBuilt(['create', 'add-ts', '--ts'], root)).code).toBe(0);
    }

    const result = await runBuilt(['up'], root);

    expect(result.code).toBe(0);
    expect(await mongo.db.collection('_mmk_migrations').countDocuments()).toBe(
      nodeStripsTypes ? 2 : 1,
    );
  });

  it('should explain an ES module migration that Node loads as CommonJS', async () => {
    const root = commonjsApp();
    mkdirSync(path.join(root, 'migrations'));
    writeFileSync(path.join(root, 'migrations', '0001-old.js'), insertMigration('rt_old', 'x'));

    const result = await runBuilt(['--uri', mongo.uri, '--db', DB, 'up'], root);

    expect(result.code).toBe(1);
    expect(result.stdout + result.stderr).toContain(
      'Migration "0001-old.js" uses ES module syntax (export/import), but Node loads it as CommonJS',
    );
    expect(await mongo.db.collection('rt_old').countDocuments()).toBe(0);
  });

  it('should explain an `export default` config that Node loads as CommonJS', async () => {
    const root = commonjsApp();
    writeFileSync(path.join(root, 'mmk.config.js'), "export default { dbName: 'x' };\n");

    const result = await runBuilt(['--uri', mongo.uri, 'status'], root);

    expect(result.code).toBe(1);
    expect(result.stdout + result.stderr).toContain(
      'CONFIG_INVALID: Config file "mmk.config.js" uses ES module syntax (export/import)',
    );
  });
});
