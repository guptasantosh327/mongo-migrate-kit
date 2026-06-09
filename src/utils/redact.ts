/**
 * Replace the credentials in any MongoDB connection string found inside `text`
 * with `***:***`, so a connection URI (often embedded verbatim in the native
 * driver's error messages) never leaks a username/password into logs, JSON
 * output, or a thrown error's context.
 *
 * Matches both `mongodb://` and `mongodb+srv://` and only rewrites the
 * `user:pass@` userinfo segment, leaving the rest of the URI intact.
 *
 * @example
 * redactMongoUri('failed: mongodb+srv://alice:s3cret@cluster0.mongodb.net')
 * // → 'failed: mongodb+srv://***:***@cluster0.mongodb.net'
 */
export function redactMongoUri(text: string): string {
  return text.replace(
    /(mongodb(?:\+srv)?:\/\/)([^:@/\s]+)(?::([^@/\s]+))?@/gi,
    (_match, scheme: string, _user: string, pass?: string) =>
      pass === undefined ? `${scheme}***@` : `${scheme}***:***@`,
  );
}
