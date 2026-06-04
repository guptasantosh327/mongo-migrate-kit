import chalk from 'chalk';
import Table from 'cli-table3';
import type { ImportRow, StatusRow } from '../types/index.js';
import { formatDateTime } from '../utils/date.js';

/** Render a checksum indicator cell */
function checksumCell(value: boolean | null): string {
  if (value === null) return chalk.dim('—');
  return value ? chalk.green('ok') : chalk.red('MISMATCH');
}

/** Render a status cell */
function statusCell(status: 'applied' | 'pending'): string {
  return status === 'applied' ? chalk.green('applied') : chalk.yellow('pending');
}

/** Render status rows as a human-readable table string */
export function renderStatusTable(rows: StatusRow[]): string {
  const table = new Table({
    head: ['Migration', 'Status', 'Batch', 'Applied At', 'Duration', 'Checksum'],
    style: { head: ['cyan'] },
  });

  for (const row of rows) {
    table.push([
      row.file,
      statusCell(row.status),
      row.batch === null ? '' : String(row.batch),
      row.appliedAt ? formatDateTime(row.appliedAt) : '',
      row.duration === null ? '' : `${row.duration}ms`,
      checksumCell(row.checksumOk),
    ]);
  }

  return table.toString();
}

/** Render the checksum-source cell for an import row */
function checksumSourceCell(source: ImportRow['checksumSource']): string {
  if (source === 'recomputed') return chalk.green('recomputed');
  if (source === 'reused') return chalk.cyan('reused');
  return chalk.red('missing');
}

/** Render mapped import rows as a human-readable table string */
export function renderImportTable(rows: ImportRow[]): string {
  const table = new Table({
    head: ['Migration', 'Batch', 'Applied At', 'Checksum'],
    style: { head: ['cyan'] },
  });

  for (const row of rows) {
    table.push([
      row.file,
      String(row.batch),
      formatDateTime(row.appliedAt),
      checksumSourceCell(row.checksumSource),
    ]);
  }

  return table.toString();
}
