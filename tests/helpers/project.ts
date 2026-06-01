import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { MigratorKit } from '../../src/core/migrator.js';
import type { MmkConfig } from '../../src/types/index.js';

const TMP_ROOT = path.join(process.cwd(), 'tests', '.tmp');

/** A throwaway migrations directory plus helpers to populate and clean it */
export interface TestProject {
  dir: string;
  /** Write a migration file with the given filename and body */
  write: (name: string, body: string) => void;
  /** Overwrite an existing migration file (changes its checksum) */
  tamper: (name: string) => void;
  cleanup: () => void;
}

/** Create an isolated migrations directory under tests/.tmp */
export function makeProject(): TestProject {
  mkdirSync(TMP_ROOT, { recursive: true });
  const dir = mkdtempSync(path.join(TMP_ROOT, 'proj-'));
  return {
    dir,
    write: (name, body): void => {
      writeFileSync(path.join(dir, name), body, 'utf8');
    },
    tamper: (name): void => {
      writeFileSync(path.join(dir, name), `// tampered ${Date.now()}\nexport {};\n`, 'utf8');
    },
    cleanup: (): void => {
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

/**
 * A migration body that inserts a marker doc into `collection` on up and
 * removes it on down — lets tests assert effects via a separate client.
 */
export function insertMigration(collection: string, value: string): string {
  return `export async function up({ db }) {
  await db.collection('${collection}').insertOne({ marker: '${value}' });
}
export async function down({ db }) {
  await db.collection('${collection}').deleteMany({ marker: '${value}' });
}
`;
}

/** A migration body whose up() always throws */
export function failingMigration(): string {
  return `export async function up() {
  throw new Error('intentional failure');
}
export async function down() {}
`;
}

/** Build a MigratorKit pointed at the test mongo + project dir, with output silenced */
export function makeMigrator(
  uri: string,
  dbName: string,
  dir: string,
  overrides: Partial<MmkConfig> = {},
): MigratorKit {
  return new MigratorKit({
    uri,
    dbName,
    migrationsDir: dir,
    logger: null,
    ...overrides,
  });
}
