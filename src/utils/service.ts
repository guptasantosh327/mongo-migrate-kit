import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

/**
 * Resolve the name of the service that owns a migrations directory, recorded on
 * every changelog record so a shared cluster shows which codebase applied what.
 *
 * Resolution order — the first non-empty value wins:
 * 1. `explicit` — the `service` config key / `MMK_SERVICE` env var
 * 2. `npm_package_name` — set by npm when mmk runs from an npm script
 * 3. `name` of the nearest `package.json`, walking up from `migrationsDir`
 *
 * Returns `undefined` when none is found; the field is then omitted rather than
 * guessed. Never runs git, never throws.
 */
export function detectService(
  migrationsDir: string,
  explicit?: string,
  env: NodeJS.ProcessEnv = process.env,
): string | undefined {
  const fromConfig = explicit?.trim();
  if (fromConfig) return fromConfig;

  const fromNpm = env.npm_package_name?.trim();
  if (fromNpm) return fromNpm;

  return nearestPackageName(path.resolve(migrationsDir));
}

/** `name` of the first `package.json` found in `dir` or any ancestor */
function nearestPackageName(dir: string): string | undefined {
  let current = dir;
  while (true) {
    const candidate = path.join(current, 'package.json');
    if (existsSync(candidate)) {
      // The nearest package.json decides, even without a usable name — an
      // ancestor's name (e.g. a monorepo root) would misattribute the service.
      return readPackageName(candidate);
    }
    const parent = path.dirname(current);
    if (parent === current) return undefined;
    current = parent;
  }
}

/** The trimmed `name` field of a package.json, or undefined if absent/unreadable */
function readPackageName(file: string): string | undefined {
  try {
    const parsed: unknown = JSON.parse(readFileSync(file, 'utf8'));
    if (typeof parsed !== 'object' || parsed === null) return undefined;
    const name = (parsed as Record<string, unknown>).name;
    return typeof name === 'string' && name.trim() !== '' ? name.trim() : undefined;
  } catch {
    // Best-effort metadata: a malformed package.json must never fail a
    // migration run, so it simply means "no service recorded".
    return undefined;
  }
}
