import { describe, expect, it } from 'vitest';
import {
  didYouMean,
  editDistance,
  explain,
  listOf,
  quote,
  suggest,
} from '../../src/utils/explain.js';

describe('quote', () => {
  it('should wrap a string in quotes so an empty or padded value is visible', () => {
    expect(quote('  ')).toBe('"  "');
    expect(quote('')).toBe('""');
  });

  it('should render non-strings without quotes', () => {
    expect(quote(0)).toBe('0');
    expect(quote(undefined)).toBe('undefined');
  });
});

describe('explain', () => {
  it('should indent each detail line under the summary', () => {
    expect(explain('Bad input', ['Received: "x"', 'Try: mmk up'])).toBe(
      'Bad input\n  Received: "x"\n  Try: mmk up',
    );
  });

  it('should drop empty and falsy details so callers can inline conditionals', () => {
    expect(explain('Bad input', ['', null, undefined, false, 'Kept'])).toBe('Bad input\n  Kept');
  });

  it('should return the bare summary when there is no detail to add', () => {
    expect(explain('Bad input', [])).toBe('Bad input');
  });
});

describe('listOf', () => {
  it('should render an empty list as an empty string', () => {
    expect(listOf([])).toBe('');
  });

  it('should elide anything past the cap and say how much was hidden', () => {
    expect(listOf(['a', 'b', 'c'], 2)).toBe('a, b … (+1 more)');
  });
});

describe('editDistance', () => {
  it('should return 0 for identical strings', () => {
    expect(editDistance('status', 'status')).toBe(0);
  });

  it('should count single-character edits', () => {
    expect(editDistance('stauts', 'status')).toBe(2);
    expect(editDistance('', 'up')).toBe(2);
  });
});

describe('suggest', () => {
  it('should find the closest candidate for a typo', () => {
    expect(suggest('migrationDir', ['migrationsDir', 'lockCollection'])).toBe('migrationsDir');
  });

  it('should be case-insensitive', () => {
    expect(suggest('BeforeAll', ['beforeAll', 'afterAll'])).toBe('beforeAll');
  });

  it('should return null rather than guess wildly', () => {
    expect(suggest('totallyMadeUp', ['uri', 'dbName'])).toBeNull();
  });

  it('should return null when there are no candidates', () => {
    expect(suggest('anything', [])).toBeNull();
  });
});

describe('didYouMean', () => {
  it('should render a hint when a close candidate exists', () => {
    expect(didYouMean('down', ['up', 'down'])).toBe('Did you mean "down"?');
  });

  it('should render nothing when nothing is close', () => {
    expect(didYouMean('sideways', ['up'])).toBe('');
  });
});
