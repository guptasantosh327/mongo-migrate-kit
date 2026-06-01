import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import * as dotenv from 'dotenv';
import { z } from 'zod';
import { ConfigInvalidError } from '../errors/index.js';
import type { MmkConfig } from '../types/index.js';

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
  | 'sequential'
> = {
  migrationsDir: './migrations',
  migrationsCollection: '_mmk_migrations',
  lockCollection: '_mmk_locks',
  lockTTLSeconds: 60,
  strict: false,
  useTransaction: false,
  fileExtensions: ['.ts', '.js'],
  sequential: false,
};

/** Candidate config file names, checked in priority order within the cwd */
const CONFIG_FILE_NAMES = ['mmk.config.ts', 'mmk.config.js', 'mmk.config.json'];

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

const configSchema = z.object({
  uri: z.string().min(1, 'uri is required'),
  dbName: z.string().min(1, 'dbName is required'),
  migrationsDir: z.string().min(1),
  migrationsCollection: z.string().min(1),
  lockCollection: z.string().min(1),
  lockTTLSeconds: z.number().int().positive(),
  strict: z.boolean(),
  useTransaction: z.boolean(),
  fileExtensions: z.array(z.string().min(1)).min(1),
  sequential: z.boolean(),
  templatePath: z.string().min(1).optional(),
  mongoose: z.unknown().optional(),
  hooks: z.unknown().optional(),
  logger: z.unknown().optional(),
});

/** Parse a string into a boolean. 'true'/'1'/'yes' (case-insensitive) → true */
function parseBoolean(value: string): boolean {
  const normalized = value.trim().toLowerCase();
  return normalized === 'true' || normalized === '1' || normalized === 'yes';
}

/** Copy only the defined keys from `source` onto `target`, mutating and returning target */
function mergeDefined<T extends object>(target: Partial<T>, source: Partial<T>): Partial<T> {
  for (const key of Object.keys(source) as Array<keyof T>) {
    const value = source[key];
    if (value !== undefined) {
      target[key] = value;
    }
  }
  return target;
}

/** Build a partial config from the MMK_* environment variables */
function readEnvConfig(): Partial<MmkConfig> {
  const env = process.env;
  const result: Partial<MmkConfig> = {};
  if (env.MMK_URI !== undefined) result.uri = env.MMK_URI;
  if (env.MMK_DB !== undefined) result.dbName = env.MMK_DB;
  if (env.MMK_MIGRATIONS_DIR !== undefined) result.migrationsDir = env.MMK_MIGRATIONS_DIR;
  if (env.MMK_COLLECTION !== undefined) result.migrationsCollection = env.MMK_COLLECTION;
  if (env.MMK_LOCK_COLLECTION !== undefined) result.lockCollection = env.MMK_LOCK_COLLECTION;
  if (env.MMK_LOCK_TTL !== undefined) result.lockTTLSeconds = Number(env.MMK_LOCK_TTL);
  if (env.MMK_STRICT !== undefined) result.strict = parseBoolean(env.MMK_STRICT);
  if (env.MMK_USE_TRANSACTION !== undefined) {
    result.useTransaction = parseBoolean(env.MMK_USE_TRANSACTION);
  }
  if (env.MMK_SEQUENTIAL !== undefined) result.sequential = parseBoolean(env.MMK_SEQUENTIAL);
  return result;
}

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

/** Load and return the config object exported by a config file */
async function loadConfigFile(filepath: string): Promise<Partial<MmkConfig>> {
  if (filepath.endsWith('.json')) {
    const raw = readFileSync(filepath, 'utf8');
    return JSON.parse(raw) as Partial<MmkConfig>;
  }
  const mod = (await import(pathToFileURL(filepath).href)) as {
    default?: Partial<MmkConfig>;
  } & Partial<MmkConfig>;
  return mod.default ?? mod;
}

/**
 * Resolve the final {@link MmkConfig} by merging, in priority order:
 * CLI flags > environment variables > config file > defaults.
 *
 * Throws {@link ConfigInvalidError} when the merged result fails validation.
 */
export async function loadConfig(options: LoadConfigOptions = {}): Promise<MmkConfig> {
  const cwd = options.cwd ?? process.cwd();

  dotenv.config({ path: path.join(cwd, '.env'), override: false });

  const merged: Partial<MmkConfig> = { ...DEFAULT_CONFIG };

  const configFilePath = options.configPath
    ? path.resolve(cwd, options.configPath)
    : discoverConfigFile(cwd);

  if (configFilePath) {
    if (!existsSync(configFilePath)) {
      throw new ConfigInvalidError('Config file not found', { path: configFilePath });
    }
    const fileConfig = await loadConfigFile(configFilePath);
    mergeDefined(merged, fileConfig);
  }

  mergeDefined(merged, readEnvConfig());

  if (options.flags) {
    mergeDefined(merged, options.flags);
  }

  const requireDb = options.requireDb ?? true;
  if (!requireDb) {
    if (merged.uri === undefined) merged.uri = '';
    if (merged.dbName === undefined) merged.dbName = '';
  }

  const schema = requireDb
    ? configSchema
    : configSchema.extend({ uri: z.string(), dbName: z.string() });
  const parsed = schema.safeParse(merged);
  if (!parsed.success) {
    throw new ConfigInvalidError('Invalid configuration', {
      issues: parsed.error.issues.map((issue) => ({
        path: issue.path.join('.'),
        message: issue.message,
      })),
    });
  }

  const config = merged as MmkConfig;

  if (config.logger) {
    if (configFilePath) {
      config.logger.dim(`Loaded config from ${path.basename(configFilePath)}`);
    }
  }

  return config;
}
