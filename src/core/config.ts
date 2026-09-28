import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import * as dotenv from 'dotenv';
import { z } from 'zod';
import { ConfigInvalidError } from '../errors/index.js';
import type { MmkConfig, MmkConfigInput } from '../types/index.js';
import { explain, suggest } from '../utils/explain.js';
import { resolveLogger } from '../utils/logger.js';

/** Default values applied when no flag, env var, or config-file value is present */
export const DEFAULT_CONFIG: Pick<
  MmkConfig,
  | 'migrationsDir'
  | 'migrationsCollection'
  | 'lockCollection'
  | 'lockTTLSeconds'
  | 'strict'
  | 'useTransaction'
  | 'fileExtensions'
  | 'createExtension'
  | 'sequential'
> = {
  migrationsDir: './migrations',
  migrationsCollection: '_mmk_migrations',
  lockCollection: '_mmk_locks',
  lockTTLSeconds: 60,
  strict: false,
  useTransaction: false,
  fileExtensions: ['.ts', '.js'],
  createExtension: 'js',
  sequential: false,
};

/** Candidate config file names, checked in priority order within the cwd */
const CONFIG_FILE_NAMES = ['mmk.config.ts', 'mmk.config.js', 'mmk.config.json'];

/** Extensions a config file may use — anything else cannot be loaded */
const CONFIG_FILE_EXTENSIONS = ['.ts', '.mts', '.cts', '.js', '.mjs', '.cjs', '.json'];

/** Options accepted by {@link loadConfig} */
export interface LoadConfigOptions {
  /** CLI flag overrides — highest priority */
  flags?: Partial<MmkConfig>;
  /** Explicit config file path — overrides auto-discovery */
  configPath?: string;
  /** Working directory used for discovery and dotenv. Default: process.cwd() */
  cwd?: string;
  /**
   * Require database connection fields (`uri`, `dbName`). Default: true.
   * Set false for commands that never touch the database (e.g. `create`).
   */
  requireDb?: boolean;
}

// ─── Diagnostics ──────────────────────────────────────────────────────────────

/**
 * A single, self-contained configuration problem.
 *
 * Every field exists so an integrator can fix the problem without reading the
 * source: `key` says *which* option, `problem` says *what* is wrong, `received`
 * shows the offending value, `source` says *where mmk read it from*, and
 * `howToSet` lists every accepted way to supply it.
 */
export interface ConfigIssue {
  /** Config key the problem concerns, e.g. `dbName` or `hooks.beforeEach` */
  key: string;
  /** What is wrong, phrased to read after the key: "dbName <problem>" */
  problem: string;
  /** The offending value, stringified for display. Absent when nothing was set */
  received?: string;
  /** Where the offending value came from, e.g. `the MMK_DB environment variable` */
  source?: string;
  /** Every accepted way to supply this key */
  howToSet?: string;
}

/** How a config key may be supplied */
interface ConfigKeySpec {
  /** CLI flag form, when the key has one */
  flag?: string;
  /** `MMK_*` environment variable, when the key has one */
  env?: string;
  /** Keys that only a JS/TS config file (or the API) can supply — functions/instances */
  codeOnly?: boolean;
}

/**
 * Every recognized config key and how it can be set. Doubles as the allow-list
 * used to reject typo'd keys in a config file.
 */
const KEY_SPECS: Record<keyof MmkConfig, ConfigKeySpec> = {
  uri: { flag: '--uri <uri>', env: 'MMK_URI' },
  dbName: { flag: '--db <name>', env: 'MMK_DB' },
  migrationsDir: { flag: '--dir <path>', env: 'MMK_MIGRATIONS_DIR' },
  migrationsCollection: { env: 'MMK_COLLECTION' },
  lockCollection: { env: 'MMK_LOCK_COLLECTION' },
  lockTTLSeconds: { env: 'MMK_LOCK_TTL' },
  strict: { flag: '--strict', env: 'MMK_STRICT' },
  useTransaction: { env: 'MMK_USE_TRANSACTION' },
  fileExtensions: {},
  createExtension: { flag: '--ts / --js (on `mmk create`)', env: 'MMK_CREATE_EXTENSION' },
  sequential: { env: 'MMK_SEQUENTIAL' },
  templatePath: { flag: '--template <path> (on `mmk create`)' },
  mongoose: { codeOnly: true },
  mongoClientOptions: { codeOnly: true },
  hooks: { codeOnly: true },
  logger: { codeOnly: true },
};

const KNOWN_KEYS = Object.keys(KEY_SPECS);

/** Hook names accepted under `hooks` */
const HOOK_NAMES = ['beforeAll', 'afterAll', 'beforeEach', 'afterEach', 'onError'];

/** Method names a custom logger must implement */
const LOGGER_METHODS = ['info', 'success', 'warn', 'error', 'dim'];

/** Env vars mmk reads that are not config keys, so they never look like typos */
const RESERVED_ENV_KEYS = ['MMK_VERSION'];

/** Source label used for values supplied programmatically or via a CLI flag */
const FLAG_SOURCE = 'a CLI flag or the config object passed to MigratorKit';

/** Join a list into `a, b, or c` */
function joinOr(parts: string[]): string {
  if (parts.length <= 1) return parts[0] ?? '';
  return `${parts.slice(0, -1).join(', ')}, or ${parts[parts.length - 1]}`;
}

/** Every accepted way to supply `key`, rendered for a human */
function howToSet(key: string, configFileLabel: string): string | undefined {
  const spec = KEY_SPECS[key as keyof MmkConfig];
  if (!spec) return undefined;
  if (spec.codeOnly) {
    return `"${key}" in a JS/TS ${configFileLabel}, or the config object passed to MigratorKit (not supported in a JSON config)`;
  }
  const ways: string[] = [];
  if (spec.flag) ways.push(`the ${spec.flag} CLI flag`);
  if (spec.env) ways.push(`the ${spec.env} environment variable`);
  ways.push(`"${key}" in ${configFileLabel}`);
  ways.push('the config object passed to MigratorKit');
  return joinOr(ways);
}

/** The message of a thrown value, whatever it turned out to be */
function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Render a value for display in an error message, keeping it short */
function display(value: unknown): string {
  if (typeof value === 'string') return JSON.stringify(value);
  if (value === undefined) return 'undefined';
  if (typeof value === 'function') return 'a function';
  try {
    const json = JSON.stringify(value);
    return json !== undefined && json.length <= 80 ? json : `a ${describeType(value)}`;
  } catch {
    return `a ${describeType(value)}`;
  }
}

/** Human name for a value's runtime type, used in "must be X, received Y" text */
function describeType(value: unknown): string {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  return typeof value;
}

/**
 * Build the multi-line error message shown to the developer.
 *
 * Each issue gets its own numbered block naming the key, the problem, the value
 * mmk actually saw, the layer it came from, and every way to set it correctly.
 */
function formatIssues(issues: ConfigIssue[]): string {
  const heading =
    issues.length === 1
      ? 'Invalid mongo-migrate-kit configuration — 1 problem found:'
      : `Invalid mongo-migrate-kit configuration — ${issues.length} problems found:`;
  const blocks = issues.map((issue, index) => {
    const lines = [`  ${index + 1}. ${issue.key} ${issue.problem}`];
    if (issue.received !== undefined) lines.push(`     Received: ${issue.received}`);
    if (issue.source !== undefined) lines.push(`     Read from: ${issue.source}`);
    if (issue.howToSet !== undefined) lines.push(`     Set it with: ${issue.howToSet}`);
    return lines.join('\n');
  });
  return `${heading}\n\n${blocks.join('\n\n')}`;
}

/** Throw a {@link ConfigInvalidError} carrying every issue, formatted and structured */
function throwIssues(issues: ConfigIssue[]): never {
  throw new ConfigInvalidError(formatIssues(issues), { issues });
}

// ─── Layer merging ────────────────────────────────────────────────────────────

/**
 * Copy the defined keys of `source` onto `target`, recording in `origins` which
 * layer supplied each key. Later layers overwrite earlier ones, so `origins`
 * always names the layer that actually won.
 */
function applyLayer(
  target: Partial<MmkConfig>,
  source: Partial<MmkConfig>,
  origins: Map<string, string>,
  labelFor: (key: string) => string,
): void {
  for (const key of Object.keys(source) as Array<keyof MmkConfig>) {
    const value = source[key];
    if (value !== undefined) {
      (target as Record<string, unknown>)[key] = value;
      origins.set(key, labelFor(key));
    }
  }
}

// ─── Environment variables ────────────────────────────────────────────────────

/** Result of parsing one raw environment variable */
type EnvParseResult = { ok: true; value: unknown } | { ok: false; expected: string };

const TRUE_WORDS = ['true', '1', 'yes', 'y', 'on'];
const FALSE_WORDS = ['false', '0', 'no', 'n', 'off'];

/** Parse a boolean env var, rejecting anything outside the accepted vocabulary */
function parseBooleanEnv(raw: string): EnvParseResult {
  const normalized = raw.trim().toLowerCase();
  if (TRUE_WORDS.includes(normalized)) return { ok: true, value: true };
  if (FALSE_WORDS.includes(normalized)) return { ok: true, value: false };
  return {
    ok: false,
    expected: `a boolean — one of ${[...TRUE_WORDS, ...FALSE_WORDS].join(', ')}`,
  };
}

/** Parse an integer env var, rejecting anything that is not a whole number */
function parseIntegerEnv(raw: string): EnvParseResult {
  const normalized = raw.trim();
  if (!/^-?\d+$/.test(normalized)) {
    return { ok: false, expected: 'a whole number, e.g. 60' };
  }
  return { ok: true, value: Number(normalized) };
}

/** The `MMK_*` variables mmk reads, and how each maps onto a config key */
const ENV_ENTRIES: ReadonlyArray<{
  env: string;
  key: keyof MmkConfig;
  parse: (raw: string) => EnvParseResult;
}> = [
  { env: 'MMK_URI', key: 'uri', parse: (raw) => ({ ok: true, value: raw }) },
  { env: 'MMK_DB', key: 'dbName', parse: (raw) => ({ ok: true, value: raw }) },
  { env: 'MMK_MIGRATIONS_DIR', key: 'migrationsDir', parse: (raw) => ({ ok: true, value: raw }) },
  {
    env: 'MMK_COLLECTION',
    key: 'migrationsCollection',
    parse: (raw) => ({ ok: true, value: raw }),
  },
  { env: 'MMK_LOCK_COLLECTION', key: 'lockCollection', parse: (raw) => ({ ok: true, value: raw }) },
  { env: 'MMK_LOCK_TTL', key: 'lockTTLSeconds', parse: parseIntegerEnv },
  { env: 'MMK_STRICT', key: 'strict', parse: parseBooleanEnv },
  { env: 'MMK_USE_TRANSACTION', key: 'useTransaction', parse: parseBooleanEnv },
  { env: 'MMK_SEQUENTIAL', key: 'sequential', parse: parseBooleanEnv },
  {
    env: 'MMK_CREATE_EXTENSION',
    key: 'createExtension',
    parse: (raw) => {
      const normalized = raw.trim().toLowerCase();
      return normalized === 'ts' || normalized === 'js'
        ? { ok: true, value: normalized }
        : { ok: false, expected: "either 'ts' or 'js'" };
    },
  },
];

const KNOWN_ENV_KEYS = [...ENV_ENTRIES.map((entry) => entry.env), ...RESERVED_ENV_KEYS];

/**
 * Build a partial config from the `MMK_*` environment variables.
 *
 * An empty (or whitespace-only) value is treated as "not set" — the common
 * `.env` idiom for commenting a value out. A non-empty value that cannot be
 * parsed is reported as an issue naming the variable, the value, and the
 * accepted format, rather than being silently coerced or ignored.
 */
function readEnvConfig(configFileLabel: string): {
  values: Partial<MmkConfig>;
  issues: ConfigIssue[];
  warnings: string[];
} {
  const env = process.env;
  const values: Partial<MmkConfig> = {};
  const issues: ConfigIssue[] = [];

  for (const entry of ENV_ENTRIES) {
    const raw = env[entry.env];
    if (raw === undefined || raw.trim() === '') continue;
    const parsed = entry.parse(raw);
    if (parsed.ok) {
      (values as Record<string, unknown>)[entry.key] = parsed.value;
      continue;
    }
    const set = howToSet(entry.key, configFileLabel);
    issues.push({
      key: entry.key,
      problem: `must be ${parsed.expected}`,
      received: display(raw),
      source: `the ${entry.env} environment variable`,
      ...(set === undefined ? {} : { howToSet: set }),
    });
  }

  // A typo'd MMK_* variable does nothing at all, which is invisible without
  // this. Reported as a warning, not an error, because the environment may
  // legitimately carry unrelated MMK_-prefixed variables.
  const warnings: string[] = [];
  for (const name of Object.keys(env)) {
    if (!name.startsWith('MMK_') || KNOWN_ENV_KEYS.includes(name)) continue;
    const hint = suggest(name, KNOWN_ENV_KEYS);
    warnings.push(
      `⚠ Unknown environment variable ${name} — mongo-migrate-kit ignores it${
        hint ? `. Did you mean ${hint}?` : ''
      }`,
    );
  }

  return { values, issues, warnings };
}

// ─── Config file ──────────────────────────────────────────────────────────────

/** Locate a config file in `cwd`, returning its absolute path or null */
function discoverConfigFile(cwd: string): string | null {
  for (const name of CONFIG_FILE_NAMES) {
    const candidate = path.join(cwd, name);
    if (existsSync(candidate)) {
      return candidate;
    }
  }
  return null;
}

/**
 * Load and return the config object exported by a config file.
 *
 * A `.ts`/`.js` config may export either a plain object or a (sync or async)
 * factory function — the factory is invoked and awaited here, which is what
 * lets users fetch values from a secret manager. A factory that throws, an
 * unparseable JSON file, and an export that is neither an object nor a factory
 * are each surfaced as a {@link ConfigInvalidError} naming the file.
 */
async function loadConfigFile(filepath: string): Promise<Partial<MmkConfig>> {
  if (filepath.endsWith('.json')) {
    let raw: string;
    try {
      raw = readFileSync(filepath, 'utf8');
    } catch (error) {
      throw new ConfigInvalidError(`Could not read config file ${filepath}`, {
        path: filepath,
        cause: messageOf(error),
      });
    }
    try {
      return assertConfigObject(JSON.parse(raw), filepath);
    } catch (error) {
      if (error instanceof ConfigInvalidError) throw error;
      throw new ConfigInvalidError(
        `Config file ${filepath} is not valid JSON: ${messageOf(error)}`,
        { path: filepath, cause: messageOf(error) },
      );
    }
  }

  let mod: { default?: MmkConfigInput } & Record<string, unknown>;
  try {
    mod = (await import(pathToFileURL(filepath).href)) as {
      default?: MmkConfigInput;
    } & Record<string, unknown>;
  } catch (error) {
    throw new ConfigInvalidError(
      `Config file ${filepath} could not be imported: ${messageOf(error)}`,
      {
        path: filepath,
        cause: messageOf(error),
      },
    );
  }
  const exported = (mod.default ?? mod) as MmkConfigInput;

  if (typeof exported === 'function') {
    let resolved: Partial<MmkConfig>;
    try {
      resolved = await exported();
    } catch (error) {
      // The factory usually fetches a secret; its own error (access denied,
      // missing secret, network) is the only actionable detail, so surface it.
      throw new ConfigInvalidError(
        explain(
          `The function exported by ${path.basename(filepath)} threw instead of returning config`,
          [
            `Reason: ${messageOf(error)}`,
            `File: ${filepath}`,
            'A factory config resolves at run time — check the credentials and permissions it needs are available in this environment',
          ],
        ),
        { path: filepath, cause: messageOf(error) },
      );
    }
    return assertConfigObject(resolved, filepath, true);
  }
  return assertConfigObject(exported, filepath);
}

/** Reject a config export that is not a plain object of options */
function assertConfigObject(
  value: unknown,
  filepath: string,
  fromFactory = false,
): Partial<MmkConfig> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    const what = fromFactory
      ? 'The function exported by the config file must return'
      : 'The config file must export';
    throw new ConfigInvalidError(
      `${what} an object of options, but it returned ${describeType(value)}`,
      { path: filepath, received: describeType(value) },
    );
  }
  return value as Partial<MmkConfig>;
}

/**
 * Reject keys a config file sets that mmk does not recognize.
 *
 * A misspelled key is silently inert otherwise — the single most confusing
 * failure mode when integrating — so it is an error, with a suggestion of the
 * key it most likely meant.
 */
function assertKnownFileKeys(fileConfig: Partial<MmkConfig>, configFileLabel: string): void {
  const issues: ConfigIssue[] = [];
  for (const key of Object.keys(fileConfig)) {
    if (KNOWN_KEYS.includes(key)) continue;
    const hint = suggest(key, KNOWN_KEYS);
    issues.push({
      key,
      problem: 'is not a recognized option and is being ignored',
      source: `the config file ${configFileLabel}`,
      howToSet: hint
        ? `rename it to "${hint}", or remove it`
        : `remove it, or use one of: ${KNOWN_KEYS.join(', ')}`,
    });
  }
  if (issues.length > 0) throwIssues(issues);
}

// ─── Schema ───────────────────────────────────────────────────────────────────

/** A MongoDB connection string always carries one of these two schemes */
const MONGO_URI_PATTERN = /^mongodb(\+srv)?:\/\/.+/;

/**
 * Characters MongoDB forbids in a database name. Rejecting them here turns an
 * opaque driver error at connect time into a named config problem.
 */
const INVALID_DB_NAME_CHARS = /[/\\. "$*<>:|?\0\s]/;

const requiredString = z
  .string({
    required_error: 'is required but was not set',
    invalid_type_error: 'must be a string',
  })
  .min(1, 'must not be empty');

/** Build the validation schema; `uri`/`dbName` are relaxed for DB-free commands */
function buildSchema(requireDb: boolean) {
  const uriRule = (value: string): boolean =>
    (!requireDb && value === '') || MONGO_URI_PATTERN.test(value);
  const dbNameRule = (value: string): boolean =>
    (!requireDb && value === '') || !INVALID_DB_NAME_CHARS.test(value);

  const uri = requireDb ? requiredString : z.string({ invalid_type_error: 'must be a string' });
  const dbName = requireDb ? requiredString : z.string({ invalid_type_error: 'must be a string' });

  return z.object({
    uri: uri.refine(
      uriRule,
      'must be a MongoDB connection string starting with "mongodb://" or "mongodb+srv://"',
    ),
    dbName: dbName
      .refine(dbNameRule, 'must not contain spaces or any of / \\ . " $ * < > : | ?')
      .refine(
        (value) => Buffer.byteLength(value, 'utf8') <= 63,
        'must be 63 bytes or fewer (MongoDB database name limit)',
      ),
    migrationsDir: requiredString,
    migrationsCollection: requiredString,
    lockCollection: requiredString,
    lockTTLSeconds: z
      .number({
        required_error: 'is required but was not set',
        invalid_type_error: 'must be a number of seconds',
      })
      .int('must be a whole number of seconds')
      .positive('must be greater than 0'),
    strict: z.boolean({ invalid_type_error: 'must be a boolean (true or false, not a string)' }),
    useTransaction: z.boolean({
      invalid_type_error: 'must be a boolean (true or false, not a string)',
    }),
    fileExtensions: z
      .array(
        z
          .string({ invalid_type_error: 'must be a string' })
          .min(1, 'must not be empty')
          .refine((value) => value.startsWith('.'), 'must start with a dot, e.g. ".ts"'),
        { invalid_type_error: 'must be an array of file extensions, e.g. [".ts", ".js"]' },
      )
      .min(1, 'must list at least one file extension'),
    // errorMap covers both a wrong type and an out-of-range value ('py'), so
    // the developer always sees the accepted values rather than a zod dump.
    createExtension: z.enum(['ts', 'js'], {
      errorMap: () => ({ message: "must be either 'ts' or 'js'" }),
    }),
    sequential: z.boolean({
      invalid_type_error: 'must be a boolean (true or false, not a string)',
    }),
    templatePath: z.string({ invalid_type_error: 'must be a path string' }).min(1).optional(),
    // Validated by hand in validateObjectOptions so the messages can name the
    // exact missing method or misspelled hook.
    mongoose: z.unknown().optional(),
    mongoClientOptions: z.unknown().optional(),
    hooks: z.unknown().optional(),
    logger: z.unknown().optional(),
  });
}

/** True for a non-null, non-array object */
function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Validate the option values that carry functions or SDK instances.
 *
 * These are checked by hand rather than by zod so each failure can name the
 * exact method or hook at fault — a misspelled hook never fires, and a partial
 * custom logger crashes mid-run, neither of which is obvious from a generic
 * "invalid type" message.
 */
function validateObjectOptions(
  merged: Partial<MmkConfig>,
  origins: Map<string, string>,
  configFileLabel: string,
): ConfigIssue[] {
  const issues: ConfigIssue[] = [];
  const issue = (key: string, problem: string, received?: unknown): void => {
    // `key` may be nested (hooks.beforeEach); provenance is tracked per top-level option.
    const rootKey = key.split('.')[0] ?? key;
    const source = origins.get(rootKey);
    const set = howToSet(rootKey, configFileLabel);
    issues.push({
      key,
      problem,
      ...(received === undefined ? {} : { received: display(received) }),
      ...(source === undefined ? {} : { source }),
      ...(set === undefined ? {} : { howToSet: set }),
    });
  };

  const { hooks, logger, mongoClientOptions, mongoose } = merged;

  if (hooks !== undefined) {
    if (!isPlainObject(hooks)) {
      issue('hooks', 'must be an object of hook functions', hooks);
    } else {
      for (const [name, value] of Object.entries(hooks)) {
        if (!HOOK_NAMES.includes(name)) {
          const hint = suggest(name, HOOK_NAMES);
          issue(
            `hooks.${name}`,
            `is not a recognized hook${hint ? `. Did you mean "${hint}"?` : ''} Valid hooks: ${HOOK_NAMES.join(', ')}`,
          );
          continue;
        }
        if (value !== undefined && typeof value !== 'function') {
          issue(`hooks.${name}`, 'must be a function', value);
        }
      }
    }
  }

  if (logger !== undefined && logger !== null) {
    if (!isPlainObject(logger)) {
      issue(
        'logger',
        'must be an object with info/success/warn/error/dim methods, or null',
        logger,
      );
    } else {
      const missing = LOGGER_METHODS.filter(
        (method) => typeof (logger as Record<string, unknown>)[method] !== 'function',
      );
      if (missing.length > 0) {
        issue(
          'logger',
          `is missing the method${missing.length === 1 ? '' : 's'} ${missing.join(', ')} — a ` +
            `custom logger must implement all of: ${LOGGER_METHODS.join(', ')} (or be null to silence output)`,
        );
      }
    }
  }

  if (mongoClientOptions !== undefined && !isPlainObject(mongoClientOptions)) {
    issue('mongoClientOptions', 'must be an object of MongoClient options', mongoClientOptions);
  }

  if (mongoose !== undefined && !isPlainObject(mongoose)) {
    issue('mongoose', 'must be a Mongoose instance', mongoose);
  }

  return issues;
}

/**
 * Turn a zod issue into a {@link ConfigIssue}, attaching the value mmk actually
 * saw and the layer that supplied it.
 */
function toConfigIssue(
  issue: z.ZodIssue,
  merged: Partial<MmkConfig>,
  origins: Map<string, string>,
  configFileLabel: string,
): ConfigIssue {
  const key = issue.path.join('.') || '(config)';
  const rootKey = String(issue.path[0] ?? key);
  const source = origins.get(rootKey);
  const set = howToSet(rootKey, configFileLabel);

  // zod reports a missing value as an invalid_type with received 'undefined';
  // say "is required" rather than "expected string, received undefined".
  const missing =
    issue.code === z.ZodIssueCode.invalid_type && issue.received === z.ZodParsedType.undefined;
  const problem = missing ? 'is required but was not set' : issue.message;

  const raw = issue.path.reduce<unknown>(
    (acc, segment) =>
      isPlainObject(acc) || Array.isArray(acc)
        ? (acc as Record<string | number, unknown>)[segment as string | number]
        : undefined,
    merged,
  );

  return {
    key,
    problem,
    ...(missing || raw === undefined ? {} : { received: display(raw) }),
    ...(missing || source === undefined ? {} : { source }),
    ...(set === undefined ? {} : { howToSet: set }),
  };
}

// ─── Loader ───────────────────────────────────────────────────────────────────

/**
 * Resolve the final {@link MmkConfig} by merging, in priority order:
 * CLI flags > environment variables > config file > defaults.
 *
 * Every problem found is reported together in a single
 * {@link ConfigInvalidError} whose message names each offending key, the value
 * that was read, the layer it came from, and every way to set it correctly. The
 * same information is available structurally on `error.context.issues` (typed
 * as {@link ConfigIssue}) for machine-readable output.
 */
export async function loadConfig(options: LoadConfigOptions = {}): Promise<MmkConfig> {
  const cwd = options.cwd ?? process.cwd();

  dotenv.config({ path: path.join(cwd, '.env'), override: false });

  const merged: Partial<MmkConfig> = { ...DEFAULT_CONFIG };
  const origins = new Map<string, string>();
  for (const key of Object.keys(DEFAULT_CONFIG)) {
    origins.set(key, 'the built-in default');
  }

  const configFilePath = options.configPath
    ? path.resolve(cwd, options.configPath)
    : discoverConfigFile(cwd);
  const configFileLabel = configFilePath
    ? path.basename(configFilePath)
    : 'mmk.config.js (see `mmk init`)';

  if (configFilePath) {
    if (!existsSync(configFilePath)) {
      throw new ConfigInvalidError(
        `Config file not found: ${configFilePath}${
          options.configPath ? ' (from --config)' : ''
        }. Create one with \`mmk init\`, or drop the --config flag to use ${CONFIG_FILE_NAMES.join(' / ')} in the current directory`,
        { path: configFilePath },
      );
    }
    const extension = path.extname(configFilePath);
    if (!CONFIG_FILE_EXTENSIONS.includes(extension)) {
      throw new ConfigInvalidError(
        `Unsupported config file type "${extension}" (${configFilePath}) — must be one of ${CONFIG_FILE_EXTENSIONS.join(', ')}`,
        { path: configFilePath, extension },
      );
    }
    const fileConfig = await loadConfigFile(configFilePath);
    assertKnownFileKeys(fileConfig, configFileLabel);
    applyLayer(merged, fileConfig, origins, () => `the config file ${configFileLabel}`);
  }

  const env = readEnvConfig(configFileLabel);
  applyLayer(
    merged,
    env.values,
    origins,
    (key) =>
      `the ${ENV_ENTRIES.find((entry) => entry.key === key)?.env ?? 'MMK_*'} environment variable`,
  );

  if (options.flags) {
    applyLayer(merged, options.flags, origins, () => FLAG_SOURCE);
  }

  const requireDb = options.requireDb ?? true;
  if (!requireDb) {
    if (merged.uri === undefined) merged.uri = '';
    if (merged.dbName === undefined) merged.dbName = '';
  }

  const parsed = buildSchema(requireDb).safeParse(merged);
  const issues: ConfigIssue[] = [...env.issues];
  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      issues.push(toConfigIssue(issue, merged, origins, configFileLabel));
    }
  }
  issues.push(...validateObjectOptions(merged, origins, configFileLabel));

  if (issues.length > 0) {
    throwIssues(issues);
  }

  const config = merged as MmkConfig;

  const logger = resolveLogger(config.logger);
  for (const warning of env.warnings) {
    logger.warn(warning);
  }
  if (configFilePath) {
    logger.dim(`Loaded config from ${path.basename(configFilePath)}`);
  }

  return config;
}
