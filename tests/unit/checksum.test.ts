import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { computeChecksum, verifyChecksum } from '../../src/utils/checksum.js';

let tmp: string;
let file: string;

beforeEach(() => {
  tmp = mkdtempSync(path.join(tmpdir(), 'mmk-checksum-'));
  file = path.join(tmp, 'migration.ts');
  writeFileSync(file, 'export const a = 1;\n');
});

afterEach(() => {
  rmSync(tmp, { recursive: true, force: true });
});

describe('computeChecksum', () => {
  it('should produce a deterministic SHA-256 hex digest', () => {
    const first = computeChecksum(file);
    const second = computeChecksum(file);
    expect(first).toBe(second);
    expect(first).toMatch(/^[a-f0-9]{64}$/);
  });

  it('should produce a different digest when file contents change', () => {
    const before = computeChecksum(file);
    writeFileSync(file, 'export const a = 2;\n');
    const after = computeChecksum(file);
    expect(after).not.toBe(before);
  });
});

describe('verifyChecksum', () => {
  it('should return true when the stored checksum matches', () => {
    const stored = computeChecksum(file);
    expect(verifyChecksum(file, stored)).toBe(true);
  });

  it('should return false when the file has been tampered with', () => {
    const stored = computeChecksum(file);
    writeFileSync(file, 'export const a = 999;\n');
    expect(verifyChecksum(file, stored)).toBe(false);
  });
});
