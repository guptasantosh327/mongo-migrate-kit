import chalk from 'chalk';
import Table from 'cli-table3';
import { format } from 'date-fns';
import type { StatusRow } from '../types/index.js';

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
      row.appliedAt ? format(row.appliedAt, 'yyyy-MM-dd HH:mm:ss') : '',
      row.duration === null ? '' : `${row.duration}ms`,
      checksumCell(row.checksumOk),
    ]);
  }

  return table.toString();
}
