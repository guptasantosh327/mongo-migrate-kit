import type { Db, MongoClient } from 'mongodb';
import type { Mongoose } from 'mongoose';
import { describe, expect, it } from 'vitest';
import { buildContext } from '../../src/core/context.js';

const client = {} as MongoClient;
const db = {} as Db;

describe('buildContext', () => {
  it('should include client and db', () => {
    const ctx = buildContext(client, db);
    expect(ctx.client).toBe(client);
    expect(ctx.db).toBe(db);
  });

  it('should omit mongoose when not provided', () => {
    const ctx = buildContext(client, db);
    expect('mongoose' in ctx).toBe(false);
  });

  it('should attach mongoose when provided', () => {
    const mongoose = {} as Mongoose;
    const ctx = buildContext(client, db, mongoose);
    expect(ctx.mongoose).toBe(mongoose);
  });
});
