/**
 * Helpers for building error messages that tell the user exactly what to fix.
 *
 * Every message follows the same shape: a one-line summary of what is wrong,
 * then indented detail lines — the value that was received, what was expected,
 * what is available instead, and a concrete command to try.
 */

/** Render a value the way it should appear in an error message */
export function quote(value: unknown): string {
  return typeof value === 'string' ? JSON.stringify(value) : String(value);
}

/**
 * Join a summary with its detail lines. Falsy details are dropped, so callers
 * can inline conditionals without building the array by hand.
 */
export function explain(
  summary: string,
  details: Array<string | false | null | undefined>,
): string {
  const lines = details.filter((line): line is string => typeof line === 'string' && line !== '');
  return lines.length === 0
    ? summary
    : `${summary}\n${lines.map((line) => `  ${line}`).join('\n')}`;
}

/** Render up to `max` items as a comma-separated list, noting anything elided */
export function listOf(items: readonly string[], max = 10): string {
  if (items.length === 0) return '';
  const shown = items.slice(0, max).join(', ');
  return items.length > max ? `${shown} … (+${items.length - max} more)` : shown;
}

/** Levenshtein distance, used to guess what a misspelled input meant */
export function editDistance(a: string, b: string): number {
  const cols = b.length + 1;
  let prev = Array.from({ length: cols }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const curr = [i, ...Array<number>(cols - 1).fill(0)];
    for (let j = 1; j < cols; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min((curr[j - 1] ?? 0) + 1, (prev[j] ?? 0) + 1, (prev[j - 1] ?? 0) + cost);
    }
    prev = curr;
  }
  return prev[cols - 1] ?? 0;
}

/**
 * The candidate closest to `value`, or null when nothing is close enough that
 * guessing would help more than it would mislead.
 */
export function suggest(value: string, candidates: readonly string[]): string | null {
  let best: string | null = null;
  let bestScore = Number.POSITIVE_INFINITY;
  const lowered = value.toLowerCase();
  for (const candidate of candidates) {
    const score = editDistance(lowered, candidate.toLowerCase());
    if (score < bestScore) {
      bestScore = score;
      best = candidate;
    }
  }
  // Allow roughly a third of the input to differ before we stop guessing.
  return best !== null && bestScore <= Math.max(2, Math.floor(value.length / 3)) ? best : null;
}

/** A `Did you mean …?` detail line, or '' when there is no close candidate */
export function didYouMean(value: string, candidates: readonly string[]): string {
  const hint = suggest(value, candidates);
  return hint === null ? '' : `Did you mean ${quote(hint)}?`;
}
