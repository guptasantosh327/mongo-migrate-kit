import { execFileSync } from 'node:child_process';
import os from 'node:os';

/** Runs `git config <key>` and returns the trimmed value, or undefined */
export type GitConfigReader = (key: string, cwd: string) => string | undefined;

/**
 * Read a single git config value. Best-effort: no git binary, no repository,
 * an unset key, or a slow git all mean "unknown" — never an error, because a
 * missing author must not stop `mmk create` from writing the file.
 */
export function readGitConfig(key: string, cwd: string): string | undefined {
  try {
    const value = execFileSync('git', ['config', '--get', key], {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: 2000,
    }).trim();
    return value === '' ? undefined : value;
  } catch {
    return undefined;
  }
}

/** Inputs for {@link detectAuthor}; the readers are injectable for tests */
export interface DetectAuthorOptions {
  /** The `--author` flag on `mmk create` */
  explicit?: string;
  /** The `author` config key / `MMK_AUTHOR` env var */
  configured?: string;
  /** Directory git is queried from (the migrations directory) */
  cwd: string;
  /** Reads git config. Default: {@link readGitConfig} */
  git?: GitConfigReader;
  /** Returns the OS username. Default: `os.userInfo().username` */
  osUser?: () => string | undefined;
}

/**
 * Resolve the author written into a new migration file by `mmk create`.
 *
 * Resolution order — the first non-empty value wins:
 * 1. `explicit` — the `--author` flag
 * 2. `configured` — the `author` config key / `MMK_AUTHOR`
 * 3. git `user.name` + `user.email`, formatted `Name <email>` (either alone if
 *    only one is set)
 * 4. the OS username
 *
 * Runs only at create time, on the developer's machine. The value is then
 * committed inside the file, so `mmk up` never needs git (containers and CI
 * images usually have no `.git`). Returns undefined when nothing is found.
 */
export function detectAuthor(options: DetectAuthorOptions): string | undefined {
  const explicit = options.explicit?.trim();
  if (explicit) return explicit;

  const configured = options.configured?.trim();
  if (configured) return configured;

  const git = options.git ?? readGitConfig;
  const name = git('user.name', options.cwd)?.trim();
  const email = git('user.email', options.cwd)?.trim();
  if (name && email) return `${name} <${email}>`;
  if (name || email) return name || email;

  const osUser = options.osUser ?? defaultOsUser;
  return osUser()?.trim() || undefined;
}

/** `os.userInfo().username`, or undefined where the platform cannot report it */
function defaultOsUser(): string | undefined {
  try {
    return os.userInfo().username;
  } catch {
    return undefined;
  }
}
