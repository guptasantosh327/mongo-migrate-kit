// A migration that throws while being imported — used to test that
// loadMigrationFile rethrows a non-TypeScript import failure unchanged.
throw new Error('boom at import time');
