import { describe, expect, it } from 'vitest';
import { redactMongoUri } from '../../src/utils/redact.js';

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
});
