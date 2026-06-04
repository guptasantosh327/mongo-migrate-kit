/** Zero-pad a number to two digits */
function pad(n: number): string {
  return String(n).padStart(2, '0');
}

/**
 * Local-time compact timestamp, e.g. `20240526143021`.
 * Used as the leading prefix for timestamped migration filenames.
 */
export function formatStamp(date: Date): string {
  return (
    `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}` +
    `${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`
  );
}

/**
 * Human-readable local-time timestamp, e.g. `2024-05-26 14:30:21`.
 * Used in the status/list/import tables.
 */
export function formatDateTime(date: Date): string {
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ` +
    `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
  );
}
