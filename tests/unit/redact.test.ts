import { describe, expect, it } from 'vitest';
import {
  hasPassword,
  hasUnescapedCredentials,
  redactConnectionString,
  redactMongoUri,
  withoutCredentials,
} from '../../src/utils/redact.js';

describe('redactMongoUri', () => {
  it('redacts user and password in a standard URI', () => {
    expect(redactMongoUri('mongodb://alice:s3cret@localhost:27017/db')).toBe(
      'mongodb://***:***@localhost:27017/db',
    );
  });

  it('redacts credentials in a mongodb+srv URI', () => {
    expect(redactMongoUri('connect failed: mongodb+srv://u:p@cluster0.mongodb.net/app')).toBe(
      'connect failed: mongodb+srv://***:***@cluster0.mongodb.net/app',
    );
  });

  it('redacts a username-only userinfo segment', () => {
    expect(redactMongoUri('mongodb://alice@localhost:27017')).toBe('mongodb://***@localhost:27017');
  });

  it('leaves a URI without credentials untouched', () => {
    expect(redactMongoUri('mongodb://localhost:27017/db')).toBe('mongodb://localhost:27017/db');
  });

  it('redacts every occurrence in a longer message', () => {
    const input = 'primary mongodb://a:b@h1 secondary mongodb://c:d@h2';
    expect(redactMongoUri(input)).toBe(
      'primary mongodb://***:***@h1 secondary mongodb://***:***@h2',
    );
  });

  it('does not alter unrelated text', () => {
    expect(redactMongoUri('no uri here')).toBe('no uri here');
  });

  it('should hide a password containing an unescaped "/"', () => {
    const out = redactMongoUri('at mongodb://alice:Top/Secret@127.0.0.1:27017/app');
    expect(out).toBe('at mongodb://***:***@127.0.0.1:27017/app');
    expect(out).not.toContain('Secret');
  });

  it('should hide every part of a password containing an unescaped "@"', () => {
    const out = redactMongoUri('mongodb://alice:Top@Secret@127.0.0.1:27017');
    expect(out).toBe('mongodb://***:***@127.0.0.1:27017');
    expect(out).not.toContain('Secret');
  });

  it('should hide a password containing "?" and "#"', () => {
    expect(redactMongoUri('mongodb+srv://bob:a?b#c@cluster0.example.net')).toBe(
      'mongodb+srv://***:***@cluster0.example.net',
    );
  });

  it('should stop at whitespace so the next URI in the text is redacted on its own', () => {
    expect(redactMongoUri('a mongodb://u:p/1@h1, b mongodb://h2/db')).toBe(
      'a mongodb://***:***@h1, b mongodb://h2/db',
    );
  });
});

describe('redactConnectionString', () => {
  it('should hide the credentials of a valid URI and keep the host', () => {
    expect(redactConnectionString('mongodb://alice:s3cret@db.example.com:27017/app')).toBe(
      'mongodb://***:***@db.example.com:27017/app',
    );
  });

  it('should keep a leading space visible, since it is usually what is wrong', () => {
    expect(redactConnectionString(' mongodb://alice:s3cret@db.example.com')).toBe(
      ' mongodb://***:***@db.example.com',
    );
  });

  it('should hide the credentials behind a mistyped scheme', () => {
    expect(redactConnectionString('mongodb:/alice:s3cret@db.example.com')).toBe(
      'mongodb:/***:***@db.example.com',
    );
    expect(redactConnectionString('postgres://alice:s3cret@db.example.com')).toBe(
      'postgres://***:***@db.example.com',
    );
  });

  it('should hide the credentials of a value with no scheme at all', () => {
    expect(redactConnectionString('alice:s3cret@db.example.com')).toBe('***:***@db.example.com');
  });

  it('should hide a password containing spaces, "/" and "@"', () => {
    const out = redactConnectionString('mongodb://alice:my pa/ss@word@db.example.com');
    expect(out).toBe('mongodb://***:***@db.example.com');
  });

  it('should hide a username without a password', () => {
    expect(redactConnectionString('mongodb://alice@db.example.com')).toBe(
      'mongodb://***@db.example.com',
    );
  });

  it('should leave a value without credentials untouched', () => {
    expect(redactConnectionString('mongodb://localhost:27017/app')).toBe(
      'mongodb://localhost:27017/app',
    );
    expect(redactConnectionString('')).toBe('');
  });
});

describe('hasUnescapedCredentials', () => {
  it('should be false for percent-encoded credentials', () => {
    expect(hasUnescapedCredentials('mongodb://alice:p%40ss%2Fword@db.example.com')).toBe(false);
  });

  it('should be false when there are no credentials', () => {
    expect(hasUnescapedCredentials('mongodb://db.example.com/?appName=app')).toBe(false);
  });

  it.each([
    ['"@" in the password', 'mongodb://alice:p@ss@db.example.com'],
    ['"/" in the password', 'mongodb://alice:pa/ss@db.example.com'],
    ['":" in the password', 'mongodb://alice:pa:ss@db.example.com'],
    ['"?" in the password', 'mongodb://alice:pa?ss@db.example.com'],
    ['"#" in the password', 'mongodb://alice:pa#ss@db.example.com'],
    ['"[" in the password', 'mongodb://alice:pa[ss@db.example.com'],
    ['"@" in the username', 'mongodb://alice@corp@db.example.com'],
    ['"/" in the username', 'mongodb://ali/ce:pass@db.example.com'],
  ])('should be true for %s', (_label, uri) => {
    expect(hasUnescapedCredentials(uri)).toBe(true);
  });
});

describe('hasPassword', () => {
  it('should be true for user:password credentials', () => {
    expect(hasPassword('mongodb+srv://alice:s3cret@cluster0.example.net')).toBe(true);
    expect(hasPassword('mongodb://alice:p@ss@db.example.com')).toBe(true);
  });

  it('should be false for a username alone, an empty password, or no credentials', () => {
    expect(hasPassword('mongodb://alice@db.example.com/?authMechanism=MONGODB-X509')).toBe(false);
    expect(hasPassword('mongodb://alice:@db.example.com')).toBe(false);
    expect(hasPassword('mongodb://localhost:27017/app')).toBe(false);
  });
});

describe('withoutCredentials', () => {
  it('should drop the credentials and keep everything else', () => {
    expect(withoutCredentials('mongodb://alice:s3cret@db.example.com:27017/app?tls=true')).toBe(
      'mongodb://db.example.com:27017/app?tls=true',
    );
  });

  it('should leave a URI without credentials unchanged', () => {
    expect(withoutCredentials('mongodb://localhost:27017')).toBe('mongodb://localhost:27017');
  });
});
