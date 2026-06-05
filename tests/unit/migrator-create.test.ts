import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { MigratorKit } from '../../src/core/migrator.js';
import type { MmkConfig } from '../../src/types/index.js';
import { type TestProject, makeProject } from '../helpers/project.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const customTemplate = path.join(here, '..', 'fixtures', 'templates', 'custom.js');

let project: TestProject;
afterEach(() => project?.cleanup());

/** Build a MigratorKit pointed at a fresh throwaway dir (no DB needed for create) */
function migrator(overrides: Partial<MmkConfig> = {}): MigratorKit {
  project = makeProject();
  return new MigratorKit({ migrationsDir: project.dir, logger: null, ...overrides });
}

describe('MigratorKit.create (in-process)', () => {
  it('should create a .js migration when createExtension is js', async () => {
    const filepath = await migrator({ createExtension: 'js' }).create('add users index');
    expect(filepath.endsWith('.js')).toBe(true);
    expect(existsSync(filepath)).toBe(true);
  });

  it('should create a .ts migration when createExtension is ts', async () => {
    const filepath = await migrator({ createExtension: 'ts' }).create('add ts index');
    expect(filepath.endsWith('.ts')).toBe(true);
  });

  it('should let the --js option override a ts createExtension', async () => {
    const filepath = await migrator({ createExtension: 'ts' }).create('force js', { js: true });
    expect(filepath.endsWith('.js')).toBe(true);
  });

  it('should use sequential numbering when configured', async () => {
    const filepath = await migrator({ sequential: true }).create('first');
    expect(path.basename(filepath)).toMatch(/^0001-/);
  });

  it('should create the migrations directory when it does not exist', async () => {
    project = makeProject();
    const nested = path.join(project.dir, 'nested-migrations');
    expect(existsSync(nested)).toBe(false);
    const kit = new MigratorKit({ migrationsDir: nested, logger: null });
    const filepath = await kit.create('makes dir');
    expect(existsSync(nested)).toBe(true);
    expect(existsSync(filepath)).toBe(true);
  });

  it('should use a custom template passed as an option', async () => {
    const filepath = await migrator().create('templated', { template: customTemplate });
    expect(readFileSync(filepath, 'utf8')).toContain('CUSTOM TEMPLATE');
  });

  it('should fall back to config.templatePath when no option is given', async () => {
    const filepath = await migrator({ templatePath: customTemplate }).create('config templated');
    expect(readFileSync(filepath, 'utf8')).toContain('CUSTOM TEMPLATE');
  });
});
