import { describe, expect, it } from 'vitest';
import {
  DEFAULT_NAMESPACE_LABEL,
  NAMESPACE_MAX_LENGTH,
  namespaceLabel,
  namespaceProblem,
} from '../../src/utils/namespace.js';

describe('namespaceProblem', () => {
  it.each(['orders-api', 'billing.cron', 'a', '0', 'shop_v2', 'x'.repeat(NAMESPACE_MAX_LENGTH)])(
    'should accept %j',
    (value) => {
      expect(namespaceProblem(value)).toBeUndefined();
    },
  );

  it('should reject an empty value and say how to use the default', () => {
    expect(namespaceProblem('')).toMatch(/must not be empty.*default namespace/);
  });

  it('should reject a value longer than the maximum', () => {
    expect(namespaceProblem('x'.repeat(NAMESPACE_MAX_LENGTH + 1))).toMatch(
      /64 characters or fewer/,
    );
  });

  it.each(['Orders-API', 'orders api', 'orders/api', '$orders', '-orders', '.orders', 'orders!'])(
    'should reject %j with the allowed characters and an example',
    (value) => {
      const problem = namespaceProblem(value);
      expect(problem).toMatch(/lowercase letters, digits/);
      expect(problem).toContain('"orders-api"');
    },
  );
});

describe('namespaceLabel', () => {
  it('should show a named namespace as its name', () => {
    expect(namespaceLabel('orders-api')).toBe('orders-api');
  });

  it('should show the default namespace as (default)', () => {
    expect(namespaceLabel(undefined)).toBe(DEFAULT_NAMESPACE_LABEL);
    expect(DEFAULT_NAMESPACE_LABEL).toBe('(default)');
  });
});
