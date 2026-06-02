import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { format } from 'date-fns';
import {
  ConfigFileExistsError,
  ConfigInvalidError,
  MigrationFileNotFoundError,
} from '../errors/index.js';
import type { MigrationExtension } from '../types/index.js';

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

/** Options controlling how a migration file is created */
export interface CreateMigrationFileOptions {
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
 * Create a new migration file on disk and return its absolute path.
 * The directory must already exist.
 */
export function createMigrationFile(options: CreateMigrationFileOptions): string {
  const ext = options.js ? '.js' : '.ts';
  const index = nextSequenceIndex(options.dir, ['.ts', '.js']);
  const prefix = buildPrefix({ sequential: options.sequential, index });
  const filename = `${prefix}-${slugify(options.name)}${ext}`;
  const filepath = path.join(options.dir, filename);
  const content = resolveTemplateContent(options.templatePath, options.js);
  writeFileSync(filepath, content, 'utf8');
  return filepath;
}

// ─── Config File Creation ───────────────────────────────────────────────────────

/** File format for a generated config file */
export type ConfigFormat = 'ts' | 'js' | 'json';

/** Pre-fill values for a generated config file — anything omitted uses a default */
export interface ConfigValues {
  uri?: string;
  dbName?: string;
  migrationsDir?: string;
}

/** Merge caller-supplied config values over the built-in defaults */
function configFields(values: ConfigValues): {
  uri: string;
  dbName: string;
  migrationsDir: string;
} {
  return {
    uri: values.uri ?? 'mongodb://localhost:27017',
    dbName: values.dbName ?? 'myapp',
    migrationsDir: values.migrationsDir ?? './migrations',
  };
}

/**
 * The commented body shared by the TS and JS templates. Documents every option
 * so the file is the single place to set behavior and nothing has to be
 * remembered as a CLI flag. `createExtension` is seeded to match the config
 * file's own language (a `.ts` config defaults to TS migrations, `.js` to JS).
 */
function configBody(values: ConfigValues, createExtension: MigrationExtension): string {
  const { uri, dbName, migrationsDir } = configFields(values);
  return `  // ── Connection ──────────────────────────────────────────────
  // To load these from a secret manager instead, run: mmk init --secret-provider
  uri: '${uri}',
  dbName: '${dbName}',

  // ── Migration files ─────────────────────────────────────────
  migrationsDir: '${migrationsDir}',
  // Extensions scanned when discovering migrations.
  fileExtensions: ['.ts', '.js'],
  // File type \`mmk create\` generates by default ('ts' | 'js').
  // Override for a single run with --js / --ts.
  createExtension: '${createExtension}',
  // Use 0001-style sequential numbering instead of timestamps.
  sequential: false,
  // Path to a custom template used by \`mmk create\`.
  // templatePath: './migration.template.ts',

  // ── Bookkeeping collections ─────────────────────────────────
  migrationsCollection: '_mmk_migrations',
  lockCollection: '_mmk_locks',
  // Seconds before a held lock is considered stale and reclaimable.
  lockTTLSeconds: 60,

  // ── Behavior ────────────────────────────────────────────────
  // Abort (instead of warn) when a file's checksum no longer matches.
  strict: false,
  // Wrap every migration in a transaction. Override per file with
  // \`export const useTransaction = true\`.
  useTransaction: false,

  // ── Lifecycle hooks (code only — not available in JSON config) ──
  // hooks: {
  //   beforeAll: async (ctx) => {},
  //   afterAll: async (ctx) => {},
  //   beforeEach: async (name, ctx) => {},
  //   afterEach: async (name, duration, ctx) => {},
  //   onError: async (name, error, ctx) => {},
  // },`;
}

/** The built-in TypeScript config template */
export function defaultConfigTs(values: ConfigValues = {}): string {
  return `import type { MmkConfig } from 'mongo-migrate-kit';

/**
 * mongo-migrate-kit configuration.
 * Precedence (highest first): CLI flags > MMK_* env vars > this file > defaults.
 * Every field is optional; the values below are the built-in defaults.
 */
const config: Partial<MmkConfig> = {
${configBody(values, 'ts')}
};

export default config;
`;
}

/** The built-in JavaScript (ESM) config template */
export function defaultConfigJs(values: ConfigValues = {}): string {
  return `/**
 * mongo-migrate-kit configuration.
 * Precedence (highest first): CLI flags > MMK_* env vars > this file > defaults.
 * Every field is optional; the values below are the built-in defaults.
 *
 * @type {Partial<import('mongo-migrate-kit').MmkConfig>}
 */
const config = {
${configBody(values, 'js')}
};

export default config;
`;
}

/**
 * The built-in JSON config template. JSON cannot hold comments or functions, so
 * the `hooks`, `mongoose`, and `logger` options are unavailable here — use a
 * `.ts`/`.js` config if you need them.
 */
export function defaultConfigJson(values: ConfigValues = {}): string {
  const { uri, dbName, migrationsDir } = configFields(values);
  const config = {
    uri,
    dbName,
    migrationsDir,
    fileExtensions: ['.ts', '.js'],
    createExtension: 'js',
    sequential: false,
    migrationsCollection: '_mmk_migrations',
    lockCollection: '_mmk_locks',
    lockTTLSeconds: 60,
    strict: false,
    useTransaction: false,
  };
  return `${JSON.stringify(config, null, 2)}\n`;
}

/**
 * Shared documentation block for the secret-provider templates. Explains the
 * factory-function form and — crucially — that the example uses AWS but ANY
 * provider works by editing `loadMongoSecret()`.
 */
const SECRET_PROVIDER_GUIDE = `/**
 * mongo-migrate-kit configuration — loads the connection from a secret manager.
 *
 * This config exports an async FUNCTION (not a plain object), so the MongoDB
 * connection is fetched at runtime on every \`mmk\` command. The value stays in
 * memory and is never written to disk, so this file is safe to commit.
 *
 * Precedence (highest first): CLI flags > MMK_* env vars > this file > defaults.
 *
 * ── Provider-agnostic ────────────────────────────────────────────────────────
 * The example below uses AWS Secrets Manager, but ANY source works — change
 * only the body of loadMongoSecret() to use Google Secret Manager, HashiCorp
 * Vault, Azure Key Vault, your own HTTP API, etc. It just has to return an
 * object containing at least { uri, dbName }. For example, Google:
 *
 *   import { SecretManagerServiceClient } from '@google-cloud/secret-manager';
 *   const client = new SecretManagerServiceClient();
 *   const [version] = await client.accessSecretVersion({
 *     name: 'projects/PROJECT/secrets/mongo/versions/latest',
 *   });
 *   return JSON.parse(version.payload.data.toString());
 */`;

/**
 * The migration-tool options shared by both secret-provider templates, indented
 * to sit inside the returned object of the async factory (4 spaces).
 */
function secretConfigOptions(createExtension: MigrationExtension, migrationsDir: string): string {
  return `    // ── Migration files ─────────────────────────────────────
    migrationsDir: '${migrationsDir}',
    fileExtensions: ['.ts', '.js'],
    createExtension: '${createExtension}',
    sequential: false,

    // ── Bookkeeping collections ─────────────────────────────
    migrationsCollection: '_mmk_migrations',
    lockCollection: '_mmk_locks',
    lockTTLSeconds: 60,

    // ── Behavior ────────────────────────────────────────────
    strict: false,
    useTransaction: false,`;
}

/** Secret-provider JavaScript (ESM) config template */
export function secretConfigJs(values: ConfigValues = {}): string {
  const { migrationsDir } = configFields(values);
  return `${SECRET_PROVIDER_GUIDE}

// Install the SDK for your provider, e.g.:
//   npm install @aws-sdk/client-secrets-manager
import {
  SecretsManagerClient,
  GetSecretValueCommand,
} from '@aws-sdk/client-secrets-manager';

/**
 * Fetch the connection details from your secret manager. Swap the body for
 * GCP / Vault / Azure / anything — it just has to return { uri, dbName }.
 */
async function loadMongoSecret() {
  // Secret name/ARN. Read from an env var so it can differ per environment.
  const secretId = process.env.MONGO_SECRET_ID ?? 'prod/myapp/mongo';

  // Region & credentials come from the environment (AWS_REGION,
  // AWS_ACCESS_KEY_ID/SECRET, or an attached IAM role).
  const client = new SecretsManagerClient({});
  const res = await client.send(new GetSecretValueCommand({ SecretId: secretId }));

  if (!res.SecretString) {
    throw new Error(\`Secret "\${secretId}" has no SecretString\`);
  }
  // Stored value is JSON, e.g. { "uri": "mongodb+srv://...", "dbName": "myapp" }
  return JSON.parse(res.SecretString);
}

/** @type {() => Promise<Partial<import('mongo-migrate-kit').MmkConfig>>} */
export default async () => {
  const secret = await loadMongoSecret();

  return {
    // ── Connection (from your secret) ───────────────────────
    uri: secret.uri,
    dbName: secret.dbName,

${secretConfigOptions('js', migrationsDir)}
  };
};
`;
}

/** Secret-provider TypeScript config template */
export function secretConfigTs(values: ConfigValues = {}): string {
  const { migrationsDir } = configFields(values);
  return `${SECRET_PROVIDER_GUIDE}
import type { MmkConfig } from 'mongo-migrate-kit';
// Install the SDK for your provider, e.g.:
//   npm install @aws-sdk/client-secrets-manager
import {
  SecretsManagerClient,
  GetSecretValueCommand,
} from '@aws-sdk/client-secrets-manager';

/**
 * Fetch the connection details from your secret manager. Swap the body for
 * GCP / Vault / Azure / anything — it just has to return { uri, dbName }.
 */
async function loadMongoSecret(): Promise<{ uri: string; dbName: string }> {
  // Secret name/ARN. Read from an env var so it can differ per environment.
  const secretId = process.env.MONGO_SECRET_ID ?? 'prod/myapp/mongo';

  // Region & credentials come from the environment (AWS_REGION,
  // AWS_ACCESS_KEY_ID/SECRET, or an attached IAM role).
  const client = new SecretsManagerClient({});
  const res = await client.send(new GetSecretValueCommand({ SecretId: secretId }));

  if (!res.SecretString) {
    throw new Error(\`Secret "\${secretId}" has no SecretString\`);
  }
  // Stored value is JSON, e.g. { "uri": "mongodb+srv://...", "dbName": "myapp" }
  return JSON.parse(res.SecretString);
}

export default async (): Promise<Partial<MmkConfig>> => {
  const secret = await loadMongoSecret();

  return {
    // ── Connection (from your secret) ───────────────────────
    uri: secret.uri,
    dbName: secret.dbName,

${secretConfigOptions('ts', migrationsDir)}
  };
};
`;
}

/**
 * Return the config file contents for the requested format. When
 * `secretProvider` is true a runtime secret-loading template is emitted instead
 * of the static object form — only valid for `js`/`ts` (JSON cannot hold code).
 */
export function configTemplateContent(
  format: ConfigFormat,
  values: ConfigValues = {},
  secretProvider = false,
): string {
  if (secretProvider) {
    if (format === 'json') {
      throw new ConfigInvalidError('Secret-provider configs are only available for js/ts', {
        format,
      });
    }
    return format === 'ts' ? secretConfigTs(values) : secretConfigJs(values);
  }
  if (format === 'js') {
    return defaultConfigJs(values);
  }
  if (format === 'json') {
    return defaultConfigJson(values);
  }
  return defaultConfigTs(values);
}

/** Options controlling how a config file is created */
export interface CreateConfigFileOptions {
  /** Directory the config file is written into */
  dir: string;
  /** Output format. Determines both extension and contents */
  format: ConfigFormat;
  /** Overwrite an existing config file instead of throwing */
  force: boolean;
  /** Pre-fill values merged over the defaults */
  values?: ConfigValues;
  /** Emit a runtime secret-loading template instead of a static object (js/ts only) */
  secretProvider?: boolean;
}

/**
 * Create an `mmk.config.<format>` file on disk and return its absolute path.
 * Throws {@link ConfigFileExistsError} if the file exists and `force` is false.
 */
export function createConfigFile(options: CreateConfigFileOptions): string {
  const filepath = path.join(options.dir, `mmk.config.${options.format}`);
  if (existsSync(filepath) && !options.force) {
    throw new ConfigFileExistsError('Config file already exists', { path: filepath });
  }
  const content = configTemplateContent(
    options.format,
    options.values ?? {},
    options.secretProvider ?? false,
  );
  writeFileSync(filepath, content, 'utf8');
  return filepath;
}
