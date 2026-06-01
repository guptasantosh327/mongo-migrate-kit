import { spawn } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { startTestMongo, type TestMongo } from '../helpers/mongo.js';
import { failingMigration, insertMigration, makeProject } from '../helpers/project.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.join(here, '..', '..');
const binPath = path.join(repoRoot, 'bin', 'mmk.ts');

interface CliResult {
  code: number;
  stdout: string;
  stderr: string;
}

/** Run the CLI under tsx as a child process and capture its result */
function runCli(args: string[], env: Record<string, string> = {}): Promise<CliResult> {
  return new Promise((resolve, reject) => {
    const child = spawn('npx', ['tsx', binPath, ...args], {
      cwd: repoRoot,
      env: { ...process.env, ...env },
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

let mongo: TestMongo;
const DB = 'mmk_cli_test';

beforeAll(async () => {
  mongo = await startTestMongo(DB);
}, 60_000);

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

function baseArgs(extra: string[]): string[] {
  return ['--uri', mongo.uri, '--db', DB, '--dir', project.dir, ...extra];
}

describe('mmk CLI (integration)', () => {
  it('should exit 0 when up succeeds', async () => {
    project.write('0001-a.ts', insertMigration('things', 'a'));
    const result = await runCli(baseArgs(['up']));
    expect(result.code).toBe(0);
    expect(result.stdout).toContain('Applied');
  });

  it('should exit 1 when a migration fails', async () => {
    project.write('0001-bad.ts', failingMigration());
    const result = await runCli(baseArgs(['up']));
    expect(result.code).toBe(1);
  });

  it('should render a status table', async () => {
    project.write('0001-a.ts', insertMigration('things', 'a'));
    await runCli(baseArgs(['up']));
    const result = await runCli(baseArgs(['status']));
    expect(result.code).toBe(0);
    expect(result.stdout).toContain('Migration');
    expect(result.stdout).toContain('0001-a.ts');
  });

  it('should print a dry-run plan and exit 0', async () => {
    project.write('0001-a.ts', insertMigration('things', 'a'));
    const result = await runCli(baseArgs(['dry-run', 'up']));
    expect(result.code).toBe(0);
    expect(result.stdout).toContain('0001-a.ts');
    // DB untouched
    expect(await mongo.db.collection('_mmk_migrations').countDocuments()).toBe(0);
  });

  it('should generate a correctly named file with create', async () => {
    const result = await runCli(baseArgs(['create', 'add users index']));
    expect(result.code).toBe(0);
    const created = readdirSync(project.dir).filter((f) => f.endsWith('add-users-index.ts'));
    expect(created).toHaveLength(1);
    expect(existsSync(path.join(project.dir, created[0] as string))).toBe(true);
  });
});
