import chalk from 'chalk';
import Table from 'cli-table3';
import type { AdoptRow, ImportRow, NamespaceStatusRow, StatusRow } from '../types/index.js';
import { formatDateTime } from '../utils/date.js';
import { namespaceLabel } from '../utils/namespace.js';

/** Render a checksum indicator cell */
function checksumCell(value: boolean | null): string {
  if (value === null) return chalk.dim('—');
  return value ? chalk.green('ok') : chalk.red('MISMATCH');
}

/** Render a status cell — an unadopted row is applied, just not yet in this namespace */
function statusCell(row: StatusRow): string {
  if (row.unadopted) return chalk.yellow('unadopted');
  return row.status === 'applied' ? chalk.green('applied') : chalk.yellow('pending');
}

/** Render a migration-name cell, flagging a record whose file is not on disk */
function fileCell(row: StatusRow): string {
  return row.fileMissing ? `${row.file} ${chalk.dim('(no file)')}` : row.file;
}

/**
 * Render status rows as a human-readable table string. `duration` is left out
 * of the table on purpose — it stays on the row for `--json` and API callers.
 */
export function renderStatusTable(rows: StatusRow[]): string {
  const table = new Table({
    head: ['Migration', 'Status', 'Batch', 'Applied At', 'Checksum', 'Author'],
    style: { head: ['cyan'] },
  });

  for (const row of rows) {
    table.push([
      fileCell(row),
      statusCell(row),
      row.batch === null ? '' : String(row.batch),
      row.appliedAt ? formatDateTime(row.appliedAt) : '',
      checksumCell(row.checksumOk),
      row.author ?? '',
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

/** Render a raw changelog status cell (applied / reverted) */
function recordStatusCell(status: 'applied' | 'reverted'): string {
  return status === 'applied' ? chalk.green('applied') : chalk.yellow('reverted');
}

/** Render `status --all-namespaces` rows: every namespace in the collection */
export function renderNamespaceTable(rows: NamespaceStatusRow[]): string {
  const table = new Table({
    head: ['Namespace', 'Migration', 'Status', 'Batch', 'Applied At', 'Author'],
    style: { head: ['cyan'] },
  });

  for (const row of rows) {
    table.push([
      namespaceLabel(row.namespace),
      row.file,
      recordStatusCell(row.status),
      String(row.batch),
      formatDateTime(row.appliedAt),
      row.author ?? '',
    ]);
  }

  return table.toString();
}

/** Render `namespace adopt` rows, with who ran each one as a review hint */
export function renderAdoptTable(rows: AdoptRow[]): string {
  const table = new Table({
    head: ['Migration', 'Status', 'Batch', 'Applied At', 'Executed By', 'Service'],
    style: { head: ['cyan'] },
  });

  for (const row of rows) {
    table.push([
      row.file,
      recordStatusCell(row.status),
      String(row.batch),
      formatDateTime(row.appliedAt),
      row.executedBy,
      row.service ?? '',
    ]);
  }

  return table.toString();
}
