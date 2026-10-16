import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { describeFormatMismatch, detectModuleScope } from '../../src/utils/module-format.js';

let tmp: string;

beforeEach(() => {
  tmp = mkdtempSync(path.join(tmpdir(), 'mmk-format-'));
});

afterEach(() => {
  rmSync(tmp, { recursive: true, force: true });
});

function writePackage(dir: string, body: string): string {
  const file = path.join(dir, 'package.json');
  writeFileSync(file, body);
  return file;
}

/** The SyntaxError Node throws for `export` loaded as CommonJS */
const esmInCjs = new SyntaxError("Unexpected token 'export'");
/** The ReferenceError Node throws for `module.exports` loaded as an ES module */
const cjsInEsm = new ReferenceError('module is not defined in ES module scope');

describe('detectModuleScope', () => {
  it('should report ESM for "type": "module"', () => {
    const pkg = writePackage(tmp, '{ "type": "module" }');
    expect(detectModuleScope(tmp)).toEqual({ format: 'esm', packageJson: pkg, type: 'module' });
  });

  it('should report CommonJS for "type": "commonjs"', () => {
    const pkg = writePackage(tmp, '{ "type": "commonjs" }');
    expect(detectModuleScope(tmp)).toEqual({ format: 'cjs', packageJson: pkg, type: 'commonjs' });
  });

  it('should report CommonJS when package.json has no "type" field', () => {
    const pkg = writePackage(tmp, '{ "name": "app" }');
    expect(detectModuleScope(tmp)).toEqual({ format: 'cjs', packageJson: pkg });
  });

  it('should use the nearest package.json, like Node', () => {
    writePackage(tmp, '{ "type": "commonjs" }');
    const nested = path.join(tmp, 'migrations');
    mkdirSync(nested);
    const pkg = writePackage(nested, '{ "type": "module" }');
    expect(detectModuleScope(nested)).toEqual({ format: 'esm', packageJson: pkg, type: 'module' });
  });

  it('should walk up from a folder that does not exist yet', () => {
    const pkg = writePackage(tmp, '{ "type": "module" }');
    expect(detectModuleScope(path.join(tmp, 'not', 'created'))).toMatchObject({
      format: 'esm',
      packageJson: pkg,
    });
  });

  it('should report CommonJS with no package.json at all', () => {
    expect(detectModuleScope(tmp)).toEqual({ format: 'cjs', packageJson: null });
  });

  it('should treat a malformed package.json or a non-string type as no type', () => {
    const pkg = writePackage(tmp, '{ not json');
    expect(detectModuleScope(tmp)).toEqual({ format: 'cjs', packageJson: pkg });
    writePackage(tmp, '{ "type": 42 }');
    expect(detectModuleScope(tmp)).toEqual({ format: 'cjs', packageJson: pkg });
    writePackage(tmp, '"just a string"');
    expect(detectModuleScope(tmp)).toEqual({ format: 'cjs', packageJson: pkg });
  });
});

describe('describeFormatMismatch', () => {
  it('should explain ESM syntax in a "type": "commonjs" package, with both fixes', () => {
    const pkg = writePackage(tmp, '{ "type": "commonjs" }');
    const result = describeFormatMismatch(path.join(tmp, '0001-a.js'), esmInCjs, 'migration');
    expect(result?.summary).toBe(
      'Migration "0001-a.js" uses ES module syntax (export/import), but Node loads it as CommonJS',
    );
    expect(result?.details).toEqual([
      `Why: ${pkg} has "type": "commonjs"`,
      'Fix: write it as module.exports = { async up(ctx) {…}, async down(ctx) {…} }, the form `mmk create` uses here',
      `Or, to keep the file unchanged (rewriting an applied migration changes its checksum): add a package.json containing { "type": "module" } to ${tmp}`,
    ]);
  });

  it('should say Node defaults to CommonJS when package.json has no "type"', () => {
    const pkg = writePackage(tmp, '{ "name": "app" }');
    const result = describeFormatMismatch(path.join(tmp, 'a.ts'), esmInCjs, 'migration');
    expect(result?.details[0]).toBe(
      `Why: ${pkg} has no "type" field, so Node loads .js and .ts files as CommonJS`,
    );
  });

  it('should say when there is no package.json at all', () => {
    const result = describeFormatMismatch(path.join(tmp, 'a.js'), esmInCjs, 'migration');
    expect(result?.details[0]).toBe(
      `Why: There is no package.json in ${tmp} or above it, so Node loads .js and .ts files as CommonJS`,
    );
  });

  it('should also recognise an import statement loaded as CommonJS', () => {
    writePackage(tmp, '{ "type": "commonjs" }');
    const error = new SyntaxError('Cannot use import statement outside a module');
    expect(describeFormatMismatch(path.join(tmp, 'a.js'), error, 'migration')).not.toBeNull();
  });

  it('should explain CommonJS syntax in a "type": "module" package', () => {
    const pkg = writePackage(tmp, '{ "type": "module" }');
    const result = describeFormatMismatch(path.join(tmp, 'a.js'), cjsInEsm, 'migration');
    expect(result?.summary).toBe(
      'Migration "a.js" uses CommonJS (module.exports/require), but Node loads it as an ES module',
    );
    expect(result?.details).toEqual([
      `Why: ${pkg} has "type": "module"`,
      'Fix: write it as export async function up(ctx) {…} and export async function down(ctx) {…}, the form `mmk create` uses here',
      expect.stringContaining(`add a package.json containing { "type": "commonjs" } to ${tmp}`),
    ]);
    const requireError = new ReferenceError('require is not defined in ES module scope');
    expect(
      describeFormatMismatch(path.join(tmp, 'a.js'), requireError, 'migration'),
    ).not.toBeNull();
  });

  it('should word the fix for a config file', () => {
    writePackage(tmp, '{ "type": "commonjs" }');
    const esm = describeFormatMismatch(path.join(tmp, 'mmk.config.js'), esmInCjs, 'config');
    expect(esm?.summary).toMatch(/^Config file "mmk.config.js" uses ES module syntax/);
    expect(esm?.details.slice(1)).toEqual([
      'Fix: replace `export default` with `module.exports =`, the form `mmk init` uses here',
    ]);
    writePackage(tmp, '{ "type": "module" }');
    const cjs = describeFormatMismatch(path.join(tmp, 'mmk.config.js'), cjsInEsm, 'config');
    expect(cjs?.details.slice(1)).toEqual([
      'Fix: replace `module.exports =` with `export default`, the form `mmk init` uses here',
    ]);
  });

  it('should return null when the error does not match the package scope', () => {
    writePackage(tmp, '{ "type": "module" }');
    expect(describeFormatMismatch(path.join(tmp, 'a.js'), esmInCjs, 'migration')).toBeNull();
    writePackage(tmp, '{ "type": "commonjs" }');
    expect(describeFormatMismatch(path.join(tmp, 'a.js'), cjsInEsm, 'migration')).toBeNull();
  });

  it('should return null for unrelated errors, non-Error values and .mjs/.cjs files', () => {
    writePackage(tmp, '{ "type": "commonjs" }');
    const file = path.join(tmp, 'a.js');
    expect(describeFormatMismatch(file, new Error('boom'), 'migration')).toBeNull();
    expect(describeFormatMismatch(file, "Unexpected token 'export'", 'migration')).not.toBeNull();
    expect(describeFormatMismatch(file, 42, 'migration')).toBeNull();
    expect(describeFormatMismatch(path.join(tmp, 'a.mjs'), esmInCjs, 'migration')).toBeNull();
    expect(describeFormatMismatch(path.join(tmp, 'a.cjs'), cjsInEsm, 'migration')).toBeNull();
  });
});
