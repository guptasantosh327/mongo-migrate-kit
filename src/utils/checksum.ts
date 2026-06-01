import crypto from 'node:crypto';
import fs from 'node:fs';

/** Returns SHA-256 hex digest of a file's contents */
export function computeChecksum(filepath: string): string {
  const contents = fs.readFileSync(filepath, 'utf8');
  return crypto.createHash('sha256').update(contents).digest('hex');
}

/** Returns true if file checksum matches the stored checksum */
export function verifyChecksum(filepath: string, stored: string): boolean {
  return computeChecksum(filepath) === stored;
}
