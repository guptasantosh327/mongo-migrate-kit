import { describe, expect, it } from 'vitest';
import { renderStatusTable } from '../../src/cli/table.js';
import type { StatusRow } from '../../src/types/index.js';

const row: StatusRow = {
  file: '20261015000001-add-index.js',
  status: 'applied',
  batch: 1,
  appliedAt: new Date('2026-10-15T09:00:00Z'),
  duration: 42,
  checksumOk: true,
  author: 'Jane <jane@acme.io>',
};

describe('renderStatusTable', () => {
  it('should show migration, status, batch, applied at, checksum and author', () => {
    const table = renderStatusTable([row]);
    for (const heading of ['Migration', 'Status', 'Batch', 'Applied At', 'Checksum', 'Author']) {
      expect(table).toContain(heading);
    }
    expect(table).toContain('20261015000001-add-index.js');
    expect(table).toContain('Jane <jane@acme.io>');
  });

  it('should leave duration out of the table (it stays on the row for --json)', () => {
    const table = renderStatusTable([row]);
    expect(table).not.toContain('Duration');
    expect(table).not.toContain('42ms');
  });

  it('should mark unadopted rows and records without a file', () => {
    const table = renderStatusTable([
      { ...row, status: 'pending', unadopted: true },
      { ...row, file: '0000-gone.js', fileMissing: true },
    ]);
    expect(table).toContain('unadopted');
    expect(table).toContain('(no file)');
  });
});
