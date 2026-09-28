import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { type TestMongo, startTestMongo } from '../helpers/mongo.js';
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
function runCli(
  args: string[],
  env: Record<string, string> = {},
  cwd = repoRoot,
  input?: string,
): Promise<CliResult> {
  return new Promise((resolve, reject) => {
    const child = spawn('npx', ['tsx', binPath, ...args], {
      cwd,
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
    if (input !== undefined) {
      child.stdin.write(input);
    }
    child.stdin.end();
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

describe('mmk CLI config diagnostics (integration)', () => {
  // Empty values are treated as unset, which is how these tests hide the
  // MMK_* variables the parent process may carry.
  const unset = { MMK_URI: '', MMK_DB: '' };

  it('should name the missing parameter and every way to set it', async () => {
    // cwd is the throwaway project dir, so no config file is discovered.
    const result = await runCli(['status'], unset, project.dir);
    expect(result.code).toBe(1);
    expect(result.stderr).toContain('uri is required but was not set');
    expect(result.stderr).toContain('dbName is required but was not set');
    expect(result.stderr).toContain('--uri <uri>');
    expect(result.stderr).toContain('MMK_DB');
  });

  it('should name the offending env var and value for a malformed setting', async () => {
    const result = await runCli(
      ['status'],
      { ...unset, MMK_URI: mongo.uri, MMK_DB: DB, MMK_LOCK_TTL: 'soon' },
      project.dir,
    );
    expect(result.code).toBe(1);
    expect(result.stderr).toContain('lockTTLSeconds');
    expect(result.stderr).toContain('the MMK_LOCK_TTL environment variable');
    expect(result.stderr).toContain('"soon"');
  });

  it('should emit the structured issues on stdout in --json mode', async () => {
    const result = await runCli(['status', '--json'], unset, project.dir);
    expect(result.code).toBe(1);
    const payload = JSON.parse(result.stdout) as {
      error: { code: string; details: { issues: Array<{ key: string; problem: string }> } };
    };
    expect(payload.error.code).toBe('CONFIG_INVALID');
    expect(payload.error.details.issues.map((issue) => issue.key)).toContain('uri');
    expect(payload.error.details.issues[0]?.problem).toBe('is required but was not set');
  });

  it('should reject an unrecognized key in a config file with a suggestion', async () => {
    writeFileSync(
      path.join(project.dir, 'mmk.config.json'),
      JSON.stringify({ uri: mongo.uri, dbName: DB, migrationDir: './migrations' }),
    );
    const result = await runCli(['status'], unset, project.dir);
    expect(result.code).toBe(1);
    expect(result.stderr).toContain('migrationDir is not a recognized option');
    expect(result.stderr).toContain('rename it to "migrationsDir"');
  });

  it('should warn when the migrations directory does not exist', async () => {
    const missing = path.join(project.dir, 'no-such-dir');
    const result = await runCli(
      ['--uri', mongo.uri, '--db', DB, '--dir', missing, 'status'],
      unset,
      project.dir,
    );
    expect(result.code).toBe(0);
    expect(result.stderr).toContain('Migrations directory not found');
    expect(result.stderr).toContain('MMK_MIGRATIONS_DIR');
  });
});

describe('mmk CLI argument diagnostics (integration)', () => {
  it('should reject a non-numeric --batch before it ever connects', async () => {
    const result = await runCli(baseArgs(['down', '--batch', 'abc']));
    expect(result.code).toBe(1);
    expect(result.stderr).toContain('INVALID_ARGUMENT');
    expect(result.stderr).toContain('--batch must be a positive whole number');
    expect(result.stderr).toContain('Received: "abc"');
    // Pre-flight means no connection was attempted.
    expect(result.stdout).not.toContain('Connecting');
  });

  it('should reject a non-numeric --steps with an example to copy', async () => {
    const result = await runCli(baseArgs(['down', '--steps', 'two']));
    expect(result.code).toBe(1);
    expect(result.stderr).toContain('Try: mmk down --steps 3');
  });

  it('should reject a dry-run direction that is not up or down', async () => {
    const result = await runCli(baseArgs(['dry-run', 'sideways']));
    expect(result.code).toBe(1);
    expect(result.stderr).toContain("dry-run direction must be 'up' or 'down'");
    expect(result.stderr).toContain('Received: "sideways"');
  });

  it('should reject contradictory --js and --ts on create', async () => {
    const result = await runCli(baseArgs(['create', 'thing', '--js', '--ts']));
    expect(result.code).toBe(1);
    expect(result.stderr).toContain('--js and --ts cannot be used together');
  });

  it('should reject a migration name that slugifies to nothing', async () => {
    const result = await runCli(baseArgs(['create', '   ']));
    expect(result.code).toBe(1);
    expect(result.stderr).toContain('must contain at least one letter or number');
    expect(readdirSync(project.dir)).toHaveLength(0);
  });

  it('should explain --force with no file instead of just refusing', async () => {
    const result = await runCli(baseArgs(['up', '--force']));
    expect(result.code).toBe(1);
    expect(result.stderr).toContain('--force requires a specific migration file');
    expect(result.stderr).toContain('Try: mmk up');
  });

  it('should emit a coded, structured argument error in --json mode', async () => {
    const result = await runCli(baseArgs(['down', '--batch', 'abc', '--json']));
    expect(result.code).toBe(1);
    const payload = JSON.parse(result.stdout) as {
      error: { code: string; details: { flag: string; received: string } };
    };
    expect(payload.error.code).toBe('INVALID_ARGUMENT');
    expect(payload.error.details).toMatchObject({ flag: '--batch', received: 'abc' });
  });

  it('should suggest the real command when one is misspelled', async () => {
    const result = await runCli(['stauts']);
    expect(result.code).toBe(1);
    expect(result.stderr).toContain('Did you mean status?');
  });

  it('should name the file, the directory, and a suggestion for a bad up target', async () => {
    project.write('0001-add-users.ts', insertMigration('things', 'a'));
    const result = await runCli(baseArgs(['up', '0001-add-user.ts']));
    expect(result.code).toBe(1);
    expect(result.stderr).toContain('Did you mean "0001-add-users.ts"?');
    expect(result.stderr).toContain(project.dir);
  });
});

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

  it('should re-run an applied migration with up <file> --force after a yes confirmation', async () => {
    project.write('0001-a.ts', insertMigration('things', 'a'));
    await runCli(baseArgs(['up']));
    expect(await mongo.db.collection('things').countDocuments()).toBe(1);

    const result = await runCli(baseArgs(['up', '0001-a.ts', '--force']), {}, repoRoot, 'y\n');
    expect(result.code).toBe(0);
    expect(result.stdout).toContain('Applied');
    expect(await mongo.db.collection('things').countDocuments()).toBe(2);
  });

  it('should abort up <file> --force when the confirmation is declined', async () => {
    project.write('0001-a.ts', insertMigration('things', 'a'));
    await runCli(baseArgs(['up']));

    const result = await runCli(baseArgs(['up', '0001-a.ts', '--force']), {}, repoRoot, 'n\n');
    expect(result.code).toBe(0);
    expect(result.stdout).toContain('Aborted');
    expect(await mongo.db.collection('things').countDocuments()).toBe(1);
  });

  it('should reject a standalone up --force with no file and exit 1', async () => {
    project.write('0001-a.ts', insertMigration('things', 'a'));
    const result = await runCli(baseArgs(['up', '--force']), {}, repoRoot, '');
    expect(result.code).toBe(1);
    expect(result.stderr).toContain('--force requires a specific migration file');
    // nothing applied
    expect(await mongo.db.collection('_mmk_migrations').countDocuments()).toBe(0);
  });

  it('should refuse up <file> --force --json without --yes (no silent re-run)', async () => {
    project.write('0001-a.ts', insertMigration('things', 'a'));
    await runCli(baseArgs(['up']));
    expect(await mongo.db.collection('things').countDocuments()).toBe(1);

    const result = await runCli(baseArgs(['up', '0001-a.ts', '--force', '--json']));
    expect(result.code).toBe(1);
    const parsed = JSON.parse(result.stdout) as { error: { message: string } };
    expect(parsed.error.message).toContain('--yes');
    // Migration was NOT re-run.
    expect(await mongo.db.collection('things').countDocuments()).toBe(1);
  });

  it('should re-run with up <file> --force --yes --json (explicit non-interactive confirm)', async () => {
    project.write('0001-a.ts', insertMigration('things', 'a'));
    await runCli(baseArgs(['up']));

    const result = await runCli(baseArgs(['up', '0001-a.ts', '--force', '--yes', '--json']));
    expect(result.code).toBe(0);
    const parsed = JSON.parse(result.stdout) as Array<{ file: string; status: string }>;
    expect(parsed[0]).toMatchObject({ file: '0001-a.ts', status: 'applied' });
    expect(await mongo.db.collection('things').countDocuments()).toBe(2);
  });

  it('should apply per-file batches with up --step then peel them with down --steps', async () => {
    project.write('0001-a.ts', insertMigration('things', 'a'));
    project.write('0002-b.ts', insertMigration('things', 'b'));
    project.write('0003-c.ts', insertMigration('things', 'c'));

    const up = await runCli(baseArgs(['up', '--step']));
    expect(up.code).toBe(0);
    const batches = (
      await mongo.db.collection('_mmk_migrations').find().sort({ name: 1 }).toArray()
    ).map((d) => d.batch);
    expect(batches).toEqual([1, 2, 3]);

    const down = await runCli(baseArgs(['down', '--steps', '2']));
    expect(down.code).toBe(0);
    // Only 0001-a's marker survives.
    expect(await mongo.db.collection('things').countDocuments()).toBe(1);
  });

  it('should exit 1 when down combines --steps with --batch', async () => {
    project.write('0001-a.ts', insertMigration('things', 'a'));
    await runCli(baseArgs(['up']));
    const result = await runCli(baseArgs(['down', '--steps', '1', '--batch', '1']));
    expect(result.code).toBe(1);
    expect(result.stderr).toContain('INVALID_ARGUMENT');
  });

  it('should resolve an async function config file (simulating a fetched secret)', async () => {
    project.write('0001-a.ts', insertMigration('things', 'a'));
    // Config lives in its own cwd (as in a real project); the migrations dir is
    // a separate folder. The factory "fetches" the connection details at run
    // time, the way an AWS/GCP Secrets Manager recipe would. No --uri/--db
    // flags here, so the values can only come from the resolved function.
    const cwdDir = path.join(project.dir, 'app');
    mkdirSync(cwdDir);
    const factory = [
      'export default async () => ({',
      `  uri: ${JSON.stringify(mongo.uri)},`,
      `  dbName: ${JSON.stringify(DB)},`,
      `  migrationsDir: ${JSON.stringify(project.dir)},`,
      '});',
      '',
    ].join('\n');
    writeFileSync(path.join(cwdDir, 'mmk.config.js'), factory);
    const result = await runCli(['up'], {}, cwdDir);
    expect(result.code).toBe(0);
    expect(result.stdout).toContain('Applied');
    expect(await mongo.db.collection('things').countDocuments()).toBe(1);
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

  it('should preview a step rollback with dry-run down --steps and write nothing', async () => {
    project.write('0001-a.ts', insertMigration('things', 'a'));
    project.write('0002-b.ts', insertMigration('things', 'b'));
    await runCli(baseArgs(['up']));
    const result = await runCli(baseArgs(['dry-run', 'down', '--steps', '1']));
    expect(result.code).toBe(0);
    expect(result.stdout).toContain('0002-b.ts');
    expect(result.stdout).not.toContain('0001-a.ts');
    // nothing reverted
    expect(await mongo.db.collection('things').countDocuments()).toBe(2);
  });

  it('should create a mmk.config.js by default with init', async () => {
    const result = await runCli(['init', '--db', 'shop'], {}, project.dir);
    expect(result.code).toBe(0);
    const configPath = path.join(project.dir, 'mmk.config.js');
    expect(existsSync(configPath)).toBe(true);
    expect(existsSync(path.join(project.dir, 'mmk.config.ts'))).toBe(false);
    const contents = readFileSync(configPath, 'utf8');
    expect(contents).toContain("dbName: 'shop'");
    expect(contents).toContain("createExtension: 'js'");
  });

  it('should create a mmk.config.ts with createExtension ts when init --ts is passed', async () => {
    const result = await runCli(['init', '--ts'], {}, project.dir);
    expect(result.code).toBe(0);
    const tsPath = path.join(project.dir, 'mmk.config.ts');
    expect(existsSync(tsPath)).toBe(true);
    expect(existsSync(path.join(project.dir, 'mmk.config.js'))).toBe(false);
    expect(readFileSync(tsPath, 'utf8')).toContain("createExtension: 'ts'");
  });

  it('should generate a secret-provider mmk.config.js with init --secret-provider', async () => {
    const result = await runCli(['init', '--secret-provider'], {}, project.dir);
    expect(result.code).toBe(0);
    const contents = readFileSync(path.join(project.dir, 'mmk.config.js'), 'utf8');
    expect(contents).toContain('async function loadMongoSecret');
    expect(contents).toContain('export default async () =>');
    expect(contents).toContain('@aws-sdk/client-secrets-manager');
    // provider-agnostic guidance is present
    expect(contents).toContain('Provider-agnostic');
  });

  it('should generate a secret-provider mmk.config.ts with init --ts --secret-provider', async () => {
    const result = await runCli(['init', '--ts', '--secret-provider'], {}, project.dir);
    expect(result.code).toBe(0);
    const contents = readFileSync(path.join(project.dir, 'mmk.config.ts'), 'utf8');
    expect(contents).toContain('async function loadMongoSecret');
    expect(contents).toContain("import type { MmkConfig } from 'mongo-migrate-kit'");
  });

  it('should reject init --json --secret-provider and exit 1', async () => {
    const result = await runCli(['init', '--json', '--secret-provider'], {}, project.dir);
    expect(result.code).toBe(1);
    expect(result.stderr).toContain('secret-provider');
    expect(existsSync(path.join(project.dir, 'mmk.config.json'))).toBe(false);
  });

  it('should exit 1 when init finds an existing config without --force', async () => {
    await runCli(['init'], {}, project.dir);
    const result = await runCli(['init'], {}, project.dir);
    expect(result.code).toBe(1);
    expect(result.stderr).toContain('CONFIG_FILE_EXISTS');
  });

  it('should generate a correctly named file and default to .js with no config or flag', async () => {
    // Run from a clean dir (no config file) so the built-in default applies.
    const result = await runCli(
      ['create', 'add users index', '--dir', project.dir],
      {},
      project.dir,
    );
    expect(result.code).toBe(0);
    const created = readdirSync(project.dir).filter((f) => f.endsWith('add-users-index.js'));
    expect(created).toHaveLength(1);
    expect(existsSync(path.join(project.dir, created[0] as string))).toBe(true);
  });

  it('should let --ts override the default when no config is present', async () => {
    const result = await runCli(
      ['create', 'forced ts', '--ts', '--dir', project.dir],
      {},
      project.dir,
    );
    expect(result.code).toBe(0);
    expect(readdirSync(project.dir).filter((f) => f.endsWith('forced-ts.ts'))).toHaveLength(1);
  });

  it('should default create to the file type set in the config (createExtension)', async () => {
    // createExtension 'ts' differs from the built-in 'js' default, so a .ts file
    // proves the value came from the config. --dir keeps the output location
    // deterministic instead of relying on the config's migrationsDir.
    writeFileSync(
      path.join(project.dir, 'mmk.config.json'),
      JSON.stringify({ createExtension: 'ts' }),
    );
    const result = await runCli(['create', 'from config', '--dir', project.dir], {}, project.dir);
    expect(result.code).toBe(0);
    expect(readdirSync(project.dir).filter((f) => f.endsWith('from-config.ts'))).toHaveLength(1);
  });

  // ── --json output (feature 1) ────────────────────────────────────────────
  it('should emit a clean JSON array for up --json (stdout is pure JSON)', async () => {
    project.write('0001-a.ts', insertMigration('things', 'a'));
    project.write('0002-b.ts', insertMigration('things', 'b'));
    const result = await runCli(baseArgs(['up', '--json']));
    expect(result.code).toBe(0);
    const parsed = JSON.parse(result.stdout) as Array<{ file: string; status: string }>;
    expect(parsed.map((r) => r.status)).toEqual(['applied', 'applied']);
    expect(parsed.map((r) => r.file)).toEqual(['0001-a.ts', '0002-b.ts']);
  });

  it('should emit a JSON status array with --json', async () => {
    project.write('0001-a.ts', insertMigration('things', 'a'));
    await runCli(baseArgs(['up']));
    const result = await runCli(baseArgs(['status', '--json']));
    expect(result.code).toBe(0);
    const parsed = JSON.parse(result.stdout) as Array<{ file: string; status: string }>;
    expect(parsed).toHaveLength(1);
    expect(parsed[0]).toMatchObject({ file: '0001-a.ts', status: 'applied' });
  });

  it('should emit a JSON error object and exit 1 on failure with --json', async () => {
    project.write('0001-x.ts', failingMigration());
    const result = await runCli(baseArgs(['up', '--json']));
    expect(result.code).toBe(1);
    const parsed = JSON.parse(result.stdout) as { error: { code?: string; message: string } };
    expect(parsed.error.code).toBe('MIGRATION_EXECUTION_FAILED');
  });

  // ── status --check (feature 2) ───────────────────────────────────────────
  it('should exit 1 from status --check when migrations are pending', async () => {
    project.write('0001-a.ts', insertMigration('things', 'a'));
    const pending = await runCli(baseArgs(['status', '--check']));
    expect(pending.code).toBe(1);

    await runCli(baseArgs(['up']));
    const clean = await runCli(baseArgs(['status', '--check']));
    expect(clean.code).toBe(0);
  });

  // ── mmk unlock (feature 3) ───────────────────────────────────────────────
  it('should report no lock held and exit 0', async () => {
    const result = await runCli(baseArgs(['unlock', '--json']));
    expect(result.code).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual({ released: false, holder: null });
  });

  it('should force-release a held lock with unlock --yes', async () => {
    await mongo.db.collection('_mmk_locks').insertOne({
      _id: 'mmk_lock',
      lockedAt: new Date(),
      pid: 4242,
      host: 'crashed-host',
      executedBy: 'ghost',
      owner: 'stale-token',
    });
    const result = await runCli(baseArgs(['unlock', '--yes']));
    expect(result.code).toBe(0);
    expect(await mongo.db.collection('_mmk_locks').countDocuments()).toBe(0);
  });

  it('should return the released holder as JSON with unlock --json', async () => {
    await mongo.db.collection('_mmk_locks').insertOne({
      _id: 'mmk_lock',
      lockedAt: new Date(),
      pid: 4242,
      host: 'crashed-host',
      executedBy: 'ghost',
      owner: 'stale-token',
    });
    const result = await runCli(baseArgs(['unlock', '--json']));
    expect(result.code).toBe(0);
    const parsed = JSON.parse(result.stdout) as { released: boolean; holder: { pid: number } };
    expect(parsed.released).toBe(true);
    expect(parsed.holder.pid).toBe(4242);
    expect(await mongo.db.collection('_mmk_locks').countDocuments()).toBe(0);
  });

  it('should let --ts override a js createExtension from config', async () => {
    writeFileSync(
      path.join(project.dir, 'mmk.config.json'),
      JSON.stringify({ createExtension: 'js' }),
    );
    const result = await runCli(
      ['create', 'forced ts', '--ts', '--dir', project.dir],
      {},
      project.dir,
    );
    expect(result.code).toBe(0);
    expect(readdirSync(project.dir).filter((f) => f.endsWith('forced-ts.ts'))).toHaveLength(1);
  });
});
