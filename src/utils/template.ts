import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import {
  ConfigFileExistsError,
  ConfigInvalidError,
  InvalidArgumentError,
  MigrationFileNotFoundError,
} from '../errors/index.js';
import type { MigrationExtension } from '../types/index.js';
import { formatStamp } from './date.js';
import { explain, quote } from './explain.js';

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
  return formatStamp(new Date());
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

/** Escape a value for embedding in a single-quoted JS/TS string literal */
export function toSingleQuoted(value: string): string {
  return `'${value.replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\r?\n/g, ' ')}'`;
}

/** The `export const author = …` line shared by both built-in templates */
function authorLine(author: string | undefined): string {
  return `export const author = ${toSingleQuoted(author ?? '')};`;
}

/**
 * The built-in TypeScript migration template. `author` is written into the
 * file (and so covered by its checksum) — see `detectAuthor()`.
 */
export function defaultTemplateTs(author?: string): string {
  return `import type { MigrationContext } from 'mongo-migrate-kit';

export const description = '';
${authorLine(author)}

export async function up({ db }: MigrationContext): Promise<void> {
  // TODO: implement migration
}

export async function down({ db }: MigrationContext): Promise<void> {
  // TODO: implement rollback
}
`;
}

/** The built-in JavaScript (ESM) migration template */
export function defaultTemplateJs(author?: string): string {
  return `export const description = '';
${authorLine(author)}

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

/**
 * Resolve template file contents — a custom template if provided (copied
 * verbatim, so it must declare its own `author` export), else the built-in.
 */
export function resolveTemplateContent(
  templatePath: string | undefined,
  js: boolean,
  author?: string,
): string {
  if (templatePath) {
    if (!existsSync(templatePath)) {
      throw new MigrationFileNotFoundError(
        explain(`Template file not found: ${quote(templatePath)}`, [
          `Resolved to: ${path.resolve(templatePath)}`,
          'A relative --template path is resolved from the current working directory',
          'Omit --template to use the built-in template',
        ]),
        { templatePath, resolved: path.resolve(templatePath) },
      );
    }
    return readFileSync(templatePath, 'utf8');
  }
  return js ? defaultTemplateJs(author) : defaultTemplateTs(author);
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
  /** Value written to the built-in template's `author` export */
  author?: string;
}

/**
 * Create a new migration file on disk and return its absolute path.
 * The directory must already exist.
 */
export function createMigrationFile(options: CreateMigrationFileOptions): string {
  const ext = options.js ? '.js' : '.ts';
  const index = nextSequenceIndex(options.dir, ['.ts', '.js']);
  const prefix = buildPrefix({ sequential: options.sequential, index });
  const slug = slugify(options.name);
  if (slug === '') {
    throw new InvalidArgumentError(
      explain('Migration name must contain at least one letter or number', [
        `Received: ${quote(options.name)}`,
        'The name is slugified into the filename, and this one slugifies to nothing',
        'Try: mmk create add-users-index',
      ]),
      { name: options.name },
    );
  }
  const filename = `${prefix}-${slug}${ext}`;
  const filepath = path.join(options.dir, filename);
  const content = resolveTemplateContent(options.templatePath, options.js, options.author);
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
  /** Written as a real `namespace` line; omitted → a commented-out example */
  namespace?: string;
}

/** One option in a generated config: its documentation and its code line */
interface DocumentedOption {
  /** Lines of the `/** … *\/` block above the option */
  doc: string[];
  /** The option itself, e.g. `strict: false,` — or `// key: value,` when off by default */
  code: string;
}

/** A titled group of options, rendered under a `// ── Title ──` divider */
interface OptionSection {
  title: string;
  options: DocumentedOption[];
}

/** Width a section divider is padded to, before indentation */
const DIVIDER_WIDTH = 62;

/** A `// ── Title ─────` divider line, padded to a fixed width */
function divider(title: string, indent: string): string {
  const head = `// ── ${title} `;
  return `${indent}${head}${'─'.repeat(Math.max(2, DIVIDER_WIDTH - head.length))}`;
}

/** Render one option as a `/** … *\/` documentation block followed by its code line */
function renderOption(option: DocumentedOption, indent: string): string {
  return [
    `${indent}/**`,
    ...option.doc.map((line) => `${indent} * ${line}`),
    `${indent} */`,
    ...option.code.split('\n').map((line) => `${indent}${line}`),
  ].join('\n');
}

/** Render sections of documented options, separated by blank lines */
function renderSections(sections: OptionSection[], indent: string): string {
  return sections
    .map((section) =>
      [divider(section.title, indent), ...section.options.map((o) => renderOption(o, indent))].join(
        '\n\n',
      ),
    )
    .join('\n\n');
}

/**
 * The documented `namespace` option. A real value when one was given
 * (`mmk init --namespace`), otherwise a commented-out example — never guessed
 * from the package or folder name, since a namespace decides which migrations
 * count as applied and must be chosen deliberately.
 */
function namespaceOption(namespace: string | undefined): DocumentedOption {
  return {
    doc: [
      "Scopes this repo's migration history when several repos share this database.",
      'One value per repo, e.g. the repo name (lowercase letters, digits, . _ -).',
      'Set it once and never change it — it decides which migrations count as applied.',
      'Not needed when this repo has the database to itself.',
      'Env: MMK_NAMESPACE',
    ],
    code:
      namespace === undefined
        ? "// namespace: 'my-repo',"
        : `namespace: ${toSingleQuoted(namespace)},`,
  };
}

/**
 * Every documented option except the connection, which the static and the
 * secret-provider templates supply differently. A single list, so both
 * templates explain each option in exactly the same words.
 */
function sharedSections(
  createExtension: MigrationExtension,
  migrationsDir: string,
  namespace: string | undefined,
): OptionSection[] {
  return [
    {
      title: 'Migration files',
      options: [
        {
          doc: [
            'Folder holding your migration files, relative to where you run mmk.',
            "Default: './migrations' · Env: MMK_MIGRATIONS_DIR · Flag: --dir",
          ],
          code: `migrationsDir: ${toSingleQuoted(migrationsDir)},`,
        },
        {
          doc: [
            'File extensions mmk treats as migrations when it scans migrationsDir.',
            '.ts files need Node 22.18+ (or a TypeScript loader) when mmk runs them.',
            "Default: ['.ts', '.js']",
          ],
          code: "fileExtensions: ['.ts', '.js'],",
        },
        {
          doc: [
            "File type `mmk create` writes: 'js' or 'ts'.",
            "Default: 'js' · Env: MMK_CREATE_EXTENSION · Per run: mmk create <name> --js / --ts",
          ],
          code: `createExtension: '${createExtension}',`,
        },
        {
          doc: [
            'Name new migrations 0001-, 0002-, … instead of with a timestamp.',
            'Keep timestamps if several repos share a database: sequential names clash.',
            'Default: false · Env: MMK_SEQUENTIAL',
          ],
          code: 'sequential: false,',
        },
        {
          doc: [
            'Your own template for `mmk create`, copied as-is into each new file.',
            'Per run: mmk create <name> --template <path>',
          ],
          code: "// templatePath: './migration.template.ts',",
        },
        {
          doc: [
            '`mmk create` writes this into new migrations (`export const author`), and',
            '`mmk up` records it — who wrote a migration, not who ran it.',
            'Default: your git `user.name <user.email>`, then your OS username',
            'Env: MMK_AUTHOR · Per run: mmk create <name> --author <name>',
          ],
          code: "// author: 'Jane Doe <jane@example.com>',",
        },
      ],
    },
    {
      title: 'Bookkeeping collections',
      options: [
        {
          doc: [
            'Collection that records which migrations have run (the history).',
            'Change it only to give a group of repos its own history on a shared database.',
            "Default: '_mmk_migrations' · Env: MMK_COLLECTION",
          ],
          code: "migrationsCollection: '_mmk_migrations',",
        },
        {
          doc: [
            'Collection holding the lock that stops two runs migrating at the same time.',
            'Every repo on a database must use the same value, or they stop taking turns.',
            "Default: '_mmk_locks' · Env: MMK_LOCK_COLLECTION",
          ],
          code: "lockCollection: '_mmk_locks',",
        },
        namespaceOption(namespace),
        {
          doc: [
            'Seconds after which a lock left behind by a crashed run counts as stale and',
            'can be taken over. A running migration keeps renewing its lock, so this does',
            'not limit how long a migration may take.',
            'Default: 60 · Env: MMK_LOCK_TTL',
          ],
          code: 'lockTTLSeconds: 60,',
        },
      ],
    },
    {
      title: 'Behavior',
      options: [
        {
          doc: [
            'What `mmk up <file>` does when that file is already applied and has changed',
            'since it ran: false = warn and skip it, true = stop with an error.',
            '(`mmk down` always refuses a changed file; `mmk status` shows it as MISMATCH.)',
            'Default: false · Env: MMK_STRICT · Per run: mmk up --strict',
          ],
          code: 'strict: false,',
        },
        {
          doc: [
            'Run every migration inside a transaction, so a failure rolls back its writes.',
            'Needs a replica set or sharded cluster. Override per file with',
            '`export const useTransaction = true` (or false).',
            'Default: false · Env: MMK_USE_TRANSACTION',
          ],
          code: 'useTransaction: false,',
        },
        {
          doc: [
            'Refuse `mmk up` while any migration about to run has no `author` export.',
            'Checked before anything runs.',
            'Default: false · Env: MMK_REQUIRE_AUTHOR',
          ],
          code: 'requireAuthor: false,',
        },
      ],
    },
    {
      title: 'Lifecycle hooks (code only — not available in JSON config)',
      options: [
        {
          doc: [
            'Functions mmk calls around migrations: once before and after the whole run,',
            'and before, after, or on error for each migration. Each receives the same',
            'context as your migrations ({ db, client, … }).',
          ],
          code: [
            '// hooks: {',
            '//   beforeAll: async (ctx) => {},',
            '//   afterAll: async (ctx) => {},',
            '//   beforeEach: async (name, ctx) => {},',
            '//   afterEach: async (name, duration, ctx) => {},',
            '//   onError: async (name, error, ctx) => {},',
            '// },',
          ].join('\n'),
        },
      ],
    },
  ];
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
 * The documented body shared by the TS and JS templates. Every option gets a
 * `/** … *\/` block saying what it does, its default, and its env var or flag,
 * so the file is the single place to set behavior and nothing has to be
 * remembered as a CLI flag. Options that are off stay as `// key: value` lines
 * — one keystroke toggles them in most editors. `createExtension` is seeded to
 * match the config file's own language (a `.ts` config defaults to TS
 * migrations, `.js` to JS).
 */
function configBody(values: ConfigValues, createExtension: MigrationExtension): string {
  const { uri, dbName, migrationsDir } = configFields(values);
  const connection: OptionSection = {
    title: 'Connection',
    options: [
      {
        doc: [
          'MongoDB connection string. Required.',
          'Env: MMK_URI · Flag: --uri',
          'To load it from a secret manager instead, run: mmk init --secret-provider',
        ],
        code: `uri: ${toSingleQuoted(uri)},`,
      },
      {
        doc: ['Database the migrations run against. Required.', 'Env: MMK_DB · Flag: --db'],
        code: `dbName: ${toSingleQuoted(dbName)},`,
      },
    ],
  };
  return renderSections(
    [connection, ...sharedSections(createExtension, migrationsDir, values.namespace)],
    '  ',
  );
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
    // JSON cannot hold the commented example, so the key appears only when set.
    ...(values.namespace !== undefined ? { namespace: values.namespace } : {}),
    lockTTLSeconds: 60,
    strict: false,
    useTransaction: false,
    requireAuthor: false,
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
 * The documented migration-tool options of both secret-provider templates,
 * indented to sit inside the object the async factory returns (4 spaces). Same
 * wording as the static templates; only the connection differs.
 */
function secretConfigOptions(
  createExtension: MigrationExtension,
  migrationsDir: string,
  namespace: string | undefined,
): string {
  return renderSections(sharedSections(createExtension, migrationsDir, namespace), '    ');
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

${secretConfigOptions('js', migrationsDir, values.namespace)}
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

${secretConfigOptions('ts', migrationsDir, values.namespace)}
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
