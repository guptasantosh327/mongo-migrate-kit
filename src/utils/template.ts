import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { format } from 'date-fns';
import { MigrationFileNotFoundError } from '../errors/index.js';

/** Convert an arbitrary migration name into a kebab-case slug */
export function slugify(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/**
 * Build the leading prefix for a migration filename.
 * Timestamp form (default) or zero-padded sequential form (`0001`).
 */
export function buildPrefix(options: { sequential: boolean; index: number }): string {
  if (options.sequential) {
    return String(options.index).padStart(4, '0');
  }
  return format(new Date(), 'yyyyMMddHHmmss');
}

/** Count existing migration files in a directory to derive the next sequence index */
export function nextSequenceIndex(dir: string, extensions: string[]): number {
  if (!existsSync(dir)) {
    return 1;
  }
  const count = readdirSync(dir).filter((file) =>
    extensions.some((ext) => file.endsWith(ext)),
  ).length;
  return count + 1;
}

/** The built-in TypeScript migration template */
export function defaultTemplateTs(): string {
  return `import type { MigrationContext } from 'mongo-migrate-kit';

export const description = '';

export async function up({ db }: MigrationContext): Promise<void> {
  // TODO: implement migration
}

export async function down({ db }: MigrationContext): Promise<void> {
  // TODO: implement rollback
}
`;
}

/** The built-in JavaScript (ESM) migration template */
export function defaultTemplateJs(): string {
  return `export const description = '';

/** @param {import('mongo-migrate-kit').MigrationContext} ctx */
export async function up({ db }) {
  // TODO: implement migration
}

/** @param {import('mongo-migrate-kit').MigrationContext} ctx */
export async function down({ db }) {
  // TODO: implement rollback
}
`;
}

/** Resolve template file contents — a custom template if provided, else the built-in */
export function resolveTemplateContent(templatePath: string | undefined, js: boolean): string {
  if (templatePath) {
    if (!existsSync(templatePath)) {
      throw new MigrationFileNotFoundError('Template file not found', { templatePath });
    }
    return readFileSync(templatePath, 'utf8');
  }
  return js ? defaultTemplateJs() : defaultTemplateTs();
}

/** Options controlling how a migration file is scaffolded */
export interface ScaffoldOptions {
  /** Target migrations directory */
  dir: string;
  /** Human-readable migration name */
  name: string;
  /** Use sequential numbering instead of a timestamp */
  sequential: boolean;
  /** Generate a `.js` file instead of `.ts` */
  js: boolean;
  /** Path to a custom template file */
  templatePath?: string;
}

/**
 * Scaffold a new migration file on disk and return its absolute path.
 * The directory must already exist.
 */
export function scaffoldMigration(options: ScaffoldOptions): string {
  const ext = options.js ? '.js' : '.ts';
  const index = nextSequenceIndex(options.dir, ['.ts', '.js']);
  const prefix = buildPrefix({ sequential: options.sequential, index });
  const filename = `${prefix}-${slugify(options.name)}${ext}`;
  const filepath = path.join(options.dir, filename);
  const content = resolveTemplateContent(options.templatePath, options.js);
  writeFileSync(filepath, content, 'utf8');
  return filepath;
}
