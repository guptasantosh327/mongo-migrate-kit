import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { detectService } from '../../src/utils/service.js';

let tmp: string;

beforeEach(() => {
  tmp = mkdtempSync(path.join(tmpdir(), 'mmk-service-'));
});

afterEach(() => {
  rmSync(tmp, { recursive: true, force: true });
});

/** Create `rel` under tmp (optionally with a package.json body) and return its path */
function dir(rel: string, pkg?: string): string {
  const full = path.join(tmp, rel);
  mkdirSync(full, { recursive: true });
  if (pkg !== undefined) writeFileSync(path.join(full, 'package.json'), pkg, 'utf8');
  return full;
}

describe('detectService', () => {
  it('should prefer the explicit service over every detected source', () => {
    const migrations = dir('svc/migrations');
    dir('svc', '{"name":"from-package"}');
    expect(detectService(migrations, '  orders  ', { npm_package_name: 'from-npm' })).toBe(
      'orders',
    );
  });

  it('should use npm_package_name when no explicit service is set', () => {
    const migrations = dir('svc/migrations');
    dir('svc', '{"name":"from-package"}');
    expect(detectService(migrations, undefined, { npm_package_name: 'from-npm' })).toBe('from-npm');
  });

  it('should ignore a blank explicit service and blank npm_package_name', () => {
    const migrations = dir('svc/migrations');
    dir('svc', '{"name":"from-package"}');
    expect(detectService(migrations, '  ', { npm_package_name: ' ' })).toBe('from-package');
  });

  it('should find the nearest package.json walking up from migrationsDir', () => {
    dir('repo', '{"name":"monorepo-root"}');
    dir('repo/services/orders', '{"name":"@acme/orders"}');
    const migrations = dir('repo/services/orders/db/migrations');
    expect(detectService(migrations, undefined, {})).toBe('@acme/orders');
  });

  it('should not fall back to an ancestor when the nearest package.json has no name', () => {
    dir('repo', '{"name":"monorepo-root"}');
    dir('repo/app', '{"private":true}');
    const migrations = dir('repo/app/migrations');
    expect(detectService(migrations, undefined, {})).toBeUndefined();
  });

  it('should return undefined for a malformed or non-object package.json', () => {
    expect(detectService(dir('broken', '{not json'), undefined, {})).toBeUndefined();
    expect(detectService(dir('array', '["x"]'), undefined, {})).toBeUndefined();
    expect(detectService(dir('nullish', 'null'), undefined, {})).toBeUndefined();
  });

  it('should return undefined when no package.json exists up to the filesystem root', () => {
    // tmpdir() has no package.json above it on any supported platform
    expect(detectService(dir('bare/migrations'), undefined, {})).toBeUndefined();
  });

  it('should resolve a migrationsDir that does not exist yet', () => {
    dir('svc', '{"name":"svc"}');
    expect(detectService(path.join(tmp, 'svc', 'not-created'), undefined, {})).toBe('svc');
  });
});
