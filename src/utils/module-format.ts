import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { quote } from './explain.js';

/** How Node loads a `.js`/`.ts` file: as an ES module or as CommonJS */
export type ModuleFormat = 'esm' | 'cjs';

/** The package scope that decides how Node loads the files in a folder */
export interface ModuleScope {
  /** `esm` only when the nearest package.json says `"type": "module"` */
  format: ModuleFormat;
  /** Absolute path of the nearest package.json, or null when there is none */
  packageJson: string | null;
  /** That file's `"type"` field as written, when it is a string */
  type?: string;
}

/**
 * Find the package scope for files in `dir` the way Node does: the nearest
 * package.json at or above it decides. Only `"type": "module"` makes `.js` and
 * `.ts` files ES modules; `"commonjs"`, no `type` field, or no package.json at
 * all mean CommonJS. (Recent Node versions also *detect* `export` in a file
 * with no `type`, but older ones don't and the detection prints a warning — so
 * generated files never rely on it.)
 *
 * `dir` need not exist yet. Never throws.
 */
export function detectModuleScope(dir: string): ModuleScope {
  let current = path.resolve(dir);
  for (;;) {
    const candidate = path.join(current, 'package.json');
    if (existsSync(candidate)) {
      const type = readPackageType(candidate);
      return {
        format: type === 'module' ? 'esm' : 'cjs',
        packageJson: candidate,
        ...(type !== undefined ? { type } : {}),
      };
    }
    const parent = path.dirname(current);
    if (parent === current) {
      return { format: 'cjs', packageJson: null };
    }
    current = parent;
  }
}

/** The `type` field of a package.json, or undefined when absent or unreadable */
function readPackageType(file: string): string | undefined {
  try {
    const parsed: unknown = JSON.parse(readFileSync(file, 'utf8'));
    if (typeof parsed !== 'object' || parsed === null) return undefined;
    const { type } = parsed as { type?: unknown };
    return typeof type === 'string' ? type : undefined;
  } catch {
    // Choosing a template must never fail on a malformed package.json; Node
    // itself will report it properly when the file is loaded.
    return undefined;
  }
}

/** Which kind of file failed to load — it changes only the advice */
export type ModuleFileKind = 'migration' | 'config';

/** A load failure explained: a one-line summary plus detail lines for `explain()` */
export interface FormatMismatch {
  summary: string;
  details: string[];
}

/** `export`/`import` reached Node's CommonJS loader */
const ESM_SYNTAX_IN_CJS = /Unexpected token 'export'|Cannot use import statement outside a module/;

/** `module.exports`/`exports`/`require` reached Node's ES module loader */
const CJS_SYNTAX_IN_ESM = /\b(?:module|exports|require) is not defined in ES module scope/;

/** Extensions whose format follows the package scope (`.mjs`/`.cjs` etc. fix their own) */
const SCOPED_EXTENSIONS = new Set(['.js', '.ts']);

/** Why Node picked this format, naming the package.json that decided it */
function scopeReason(scope: ModuleScope, dir: string): string {
  if (scope.packageJson === null) {
    return `There is no package.json in ${dir} or above it, so Node loads .js and .ts files as CommonJS`;
  }
  if (scope.type === undefined) {
    return `${scope.packageJson} has no "type" field, so Node loads .js and .ts files as CommonJS`;
  }
  return `${scope.packageJson} has "type": ${quote(scope.type)}`;
}

/**
 * Explain an import failure caused by module syntax that doesn't match the
 * file's package scope — `export` in a CommonJS scope, or `module.exports` /
 * `require` in an ES module scope — or return null for any other failure.
 * Node's own message ("Unexpected token 'export'") names neither the cause nor
 * the fix.
 */
export function describeFormatMismatch(
  filepath: string,
  error: unknown,
  kind: ModuleFileKind,
): FormatMismatch | null {
  if (!SCOPED_EXTENSIONS.has(path.extname(filepath).toLowerCase())) {
    return null;
  }
  const message = error instanceof Error ? error.message : String(error);
  const dir = path.dirname(filepath);
  const scope = detectModuleScope(dir);
  const label = `${kind === 'migration' ? 'Migration' : 'Config file'} ${quote(path.basename(filepath))}`;

  if (scope.format === 'cjs' && ESM_SYNTAX_IN_CJS.test(message)) {
    return {
      summary: `${label} uses ES module syntax (export/import), but Node loads it as CommonJS`,
      details:
        kind === 'migration'
          ? [
              `Why: ${scopeReason(scope, dir)}`,
              'Fix: write it as module.exports = { async up(ctx) {…}, async down(ctx) {…} }, the form `mmk create` uses here',
              keepFileAsIs(dir, 'module'),
            ]
          : [
              `Why: ${scopeReason(scope, dir)}`,
              'Fix: replace `export default` with `module.exports =`, the form `mmk init` uses here',
            ],
    };
  }
  if (scope.format === 'esm' && CJS_SYNTAX_IN_ESM.test(message)) {
    return {
      summary: `${label} uses CommonJS (module.exports/require), but Node loads it as an ES module`,
      details:
        kind === 'migration'
          ? [
              `Why: ${scopeReason(scope, dir)}`,
              'Fix: write it as export async function up(ctx) {…} and export async function down(ctx) {…}, the form `mmk create` uses here',
              keepFileAsIs(dir, 'commonjs'),
            ]
          : [
              `Why: ${scopeReason(scope, dir)}`,
              'Fix: replace `module.exports =` with `export default`, the form `mmk init` uses here',
            ],
    };
  }
  return null;
}

/**
 * The alternative to rewriting a migration: a package.json in its folder sets
 * the folder's format without touching the files — which matters for applied
 * migrations, whose checksum would change if rewritten.
 */
function keepFileAsIs(dir: string, type: 'module' | 'commonjs'): string {
  return `Or, to keep the file unchanged (rewriting an applied migration changes its checksum): add a package.json containing { "type": "${type}" } to ${dir}`;
}
