/**
 * Rules for a `namespace` value, shared by config validation and `mmk init` so
 * both reject exactly the same inputs with the same wording.
 */

/** Longest namespace accepted */
export const NAMESPACE_MAX_LENGTH = 64;

/**
 * Lowercase letters, digits, `.`, `_`, `-`, starting with a letter or digit.
 * Lowercase-only so `Orders-API` and `orders-api` can never become two
 * histories by accident; the leading alphanumeric keeps it from reading as a
 * CLI flag.
 */
const NAMESPACE_PATTERN = /^[a-z0-9][a-z0-9._-]*$/;

/** How the default namespace (no `namespace` set) is shown to people */
export const DEFAULT_NAMESPACE_LABEL = '(default)';

/**
 * What is wrong with a namespace value, phrased to follow "namespace …", or
 * undefined when it is valid.
 */
export function namespaceProblem(value: string): string | undefined {
  if (value.length === 0) {
    return 'must not be empty — remove it to use the default namespace';
  }
  if (value.length > NAMESPACE_MAX_LENGTH) {
    return `must be ${NAMESPACE_MAX_LENGTH} characters or fewer`;
  }
  if (!NAMESPACE_PATTERN.test(value)) {
    return 'must use only lowercase letters, digits, ".", "_" and "-", and start with a letter or digit, e.g. "orders-api"';
  }
  return undefined;
}

/** A namespace as shown to people: its name, or `(default)` when unset */
export function namespaceLabel(namespace: string | undefined): string {
  return namespace ?? DEFAULT_NAMESPACE_LABEL;
}
