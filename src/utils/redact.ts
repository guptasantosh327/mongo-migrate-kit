/**
 * Replace the credentials in any MongoDB connection string found inside `text`
 * with `***:***`, so a connection URI (often embedded verbatim in the native
 * driver's error messages) never leaks a username/password into logs, JSON
 * output, or a thrown error's context.
 *
 * Matches both `mongodb://` and `mongodb+srv://` and rewrites everything up to
 * the **last** `@` of the URI, leaving the host and the rest intact. Stopping at
 * the first `/` or `@` instead would leak a password that contains those
 * characters unescaped (`mongodb://alice:pa/ss@host`), which is exactly the URI
 * that fails to parse and so ends up in an error message. Hiding too much
 * (an `@` in the query string) is the safe way to be wrong.
 *
 * @example
 * redactMongoUri('failed: mongodb+srv://alice:s3cret@cluster0.mongodb.net')
 * // → 'failed: mongodb+srv://***:***@cluster0.mongodb.net'
 */
export function redactMongoUri(text: string): string {
  return text.replace(
    /(mongodb(?:\+srv)?:\/\/)([^\s"'<>]*)@/gi,
    (_match, scheme: string, userinfo: string) => `${scheme}${maskUserinfo(userinfo)}@`,
  );
}

/**
 * Hide the credentials of one value that is meant to be a connection string —
 * including a malformed one, which is when it gets shown in an error. Unlike
 * {@link redactMongoUri}, it does not need a valid `mongodb://` scheme (a typo
 * like `mongodb:/` or a leading space must not expose the password), and the
 * whole value is the URI, so a password containing spaces is hidden too.
 *
 * Everything before the last `@` is credentials; a leading scheme
 * (`anything://`) and surrounding whitespace stay visible, since they are
 * usually what is wrong.
 *
 * @example
 * redactConnectionString(' mongodb://alice:s3cret@db.example.com')
 * // → ' mongodb://***:***@db.example.com'
 */
export function redactConnectionString(value: string): string {
  const parts = splitCredentials(value);
  if (!parts) {
    return value;
  }
  return `${parts.prefix}${maskUserinfo(parts.userinfo)}@${parts.rest}`;
}

/** Characters a username or password must percent-encode — the driver rejects or mis-splits them */
const RESERVED_IN_CREDENTIALS = /[:/?#[\]@]/;

/**
 * True when a connection string's username or password contains a character
 * that must be percent-encoded (`: / ? # [ ] @`).
 *
 * Such a URI is mis-parsed by the driver, and its error can then quote a piece
 * of the password as if it were something else: with `alice:pa@ss@host` the
 * driver splits at the first `@`, takes `ss` for the host, and reports
 * `getaddrinfo ENOTFOUND ss`.
 * No pattern can recognize that fragment as a secret, so callers withhold the
 * driver's message for these URIs and explain the encoding problem instead.
 */
export function hasUnescapedCredentials(uri: string): boolean {
  const parts = splitCredentials(uri);
  if (!parts) {
    return false;
  }
  const colon = parts.userinfo.indexOf(':');
  const username = colon === -1 ? parts.userinfo : parts.userinfo.slice(0, colon);
  const password = colon === -1 ? '' : parts.userinfo.slice(colon + 1);
  return RESERVED_IN_CREDENTIALS.test(username) || RESERVED_IN_CREDENTIALS.test(password);
}

/**
 * True when a connection string carries a password (`user:password@`). A
 * username alone is not a secret — x.509, AWS IAM and Kerberos URIs have one.
 */
export function hasPassword(uri: string): boolean {
  const parts = splitCredentials(uri);
  if (!parts) {
    return false;
  }
  const colon = parts.userinfo.indexOf(':');
  return colon !== -1 && colon < parts.userinfo.length - 1;
}

/**
 * The connection string with its credentials removed entirely, e.g. to show the
 * command to run instead: `mongodb://alice:s3cret@host/app` → `mongodb://host/app`.
 */
export function withoutCredentials(uri: string): string {
  const parts = splitCredentials(uri);
  return parts ? `${parts.prefix}${parts.rest}` : uri;
}

/** A leading `scheme://` (any scheme, any number of slashes), with optional whitespace or quote */
const SCHEME_PREFIX = /^\s*["']?[a-z][a-z0-9+.-]*:\/+/i;

/**
 * Split a connection string into the part before its credentials (the scheme),
 * the credentials (everything up to the last `@`), and the rest (hosts, path,
 * options). Null when there is no `@`, i.e. no credentials.
 */
function splitCredentials(
  value: string,
): { prefix: string; userinfo: string; rest: string } | null {
  const at = value.lastIndexOf('@');
  if (at === -1) {
    return null;
  }
  const scheme = SCHEME_PREFIX.exec(value)?.[0] ?? '';
  const prefix = scheme.length <= at ? scheme : '';
  return { prefix, userinfo: value.slice(prefix.length, at), rest: value.slice(at + 1) };
}

/** `***:***` for `user:password`, `***` for a username alone */
function maskUserinfo(userinfo: string): string {
  return userinfo.includes(':') ? '***:***' : '***';
}
