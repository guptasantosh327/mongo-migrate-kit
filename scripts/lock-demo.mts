/**
 * Lock demo you can watch in Compass — run with:
 *
 *   npx tsx scripts/lock-demo.mts
 *
 * Boots ONE in-memory MongoDB on a fixed port and keeps it alive. Two
 * "processes" (A and B) race for the same migration lock. The script PAUSES
 * before each step — paste the printed URI into Compass, open demo/_mmk_locks,
 * and hit refresh at each pause to watch the lock doc appear → flip owner →
 * delete → reclaim. Press Ctrl-C any time to stop & wipe (all in-memory).
 *
 * Throwaway demo — not shipped, not tested.
 */
import { createInterface } from 'node:readline/promises';
import { type Db, MongoClient } from 'mongodb';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { MigrationLock } from '../src/core/lock.js';
import { LockAlreadyHeldError } from '../src/errors/index.js';

const PORT = 38017;
const LOCK_COLLECTION = '_mmk_locks';
const TTL_SECONDS = 3; // short TTL so the "stale reclaim" step is quick to watch

const rl = createInterface({ input: process.stdin, output: process.stdout });

function line(label: string): void {
  console.log(`\n${'─'.repeat(64)}\n${label}\n${'─'.repeat(64)}`);
}

/** Pause so you can flip to Compass and refresh before the next change. */
async function pause(msg: string): Promise<void> {
  // No interactive terminal (piped/CI) → don't block on Enter, just beat briefly.
  if (!process.stdin.isTTY) {
    console.log(`\n  ⏸  ${msg}  (non-interactive — auto-continuing in 2s)`);
    await new Promise((r) => setTimeout(r, 2000));
    return;
  }
  await rl.question(`\n  ⏸  ${msg}  → press Enter to continue…`);
}

async function showLockDoc(db: Db, who: string): Promise<void> {
  const doc = await db.collection(LOCK_COLLECTION).findOne({ _id: 'mmk_lock' });
  if (!doc) {
    console.log(`  [${who}] _mmk_locks is EMPTY (no lock held)`);
    return;
  }
  console.log(`  [${who}] lock doc:`, {
    owner: `${(doc.owner as string).slice(0, 8)}…`,
    pid: doc.pid,
    lockedAt: (doc.lockedAt as Date).toISOString().slice(11, 23),
  });
}

async function main(): Promise<void> {
  const mongod = await MongoMemoryServer.create({ instance: { port: PORT } });
  const uri = mongod.getUri();
  const client = new MongoClient(uri);
  await client.connect();
  const db = client.db('demo');

  // Clean shutdown on Ctrl-C — wipe the in-memory server.
  process.on('SIGINT', async () => {
    console.log('\nStopping…');
    rl.close();
    await client.close().catch(() => undefined);
    await mongod.stop().catch(() => undefined);
    process.exit(0);
  });

  console.log('\n════════════════════════════════════════════════════════════════');
  console.log('  Open this in Compass to watch the lock live:\n');
  console.log(`    ${uri}`);
  console.log('\n  Database: demo   Collection: _mmk_locks');
  console.log('════════════════════════════════════════════════════════════════');

  const lockA = new MigrationLock(db, LOCK_COLLECTION, TTL_SECONDS);
  const lockB = new MigrationLock(db, LOCK_COLLECTION, TTL_SECONDS);

  // ── 1. Both try to acquire at once ───────────────────────────────────────
  await pause('Step 1: _mmk_locks is empty right now. Confirm in Compass');
  line('1) Process A and Process B both call acquire() at the same time');
  const results = await Promise.allSettled([lockA.acquire(), lockB.acquire()]);
  results.forEach((r, i) => {
    const who = i === 0 ? 'A' : 'B';
    if (r.status === 'fulfilled') {
      console.log(`  ✔ [${who}] WON the lock`);
    } else if (r.reason instanceof LockAlreadyHeldError) {
      console.log(`  ✖ [${who}] REJECTED → LockAlreadyHeldError (held by someone else)`);
    } else {
      console.log(`  ✖ [${who}] failed:`, r.reason);
    }
  });
  await showLockDoc(db, 'DB');

  const winnerIsA = results[0].status === 'fulfilled';
  const winner = winnerIsA ? lockA : lockB;
  const winnerName = winnerIsA ? 'A' : 'B';
  const loser = winnerIsA ? lockB : lockA;
  const loserName = winnerIsA ? 'B' : 'A';

  // ── 2. Loser retries while winner still holds → still rejected ───────────
  await pause(`Step 2: refresh Compass — ONE lock doc exists, owner = ${winnerName}`);
  line(`2) ${loserName} retries while ${winnerName} still holds it → blocked`);
  try {
    await loser.acquire();
    console.log(`  ✔ [${loserName}] got it (unexpected)`);
  } catch (e) {
    console.log(`  ✖ [${loserName}] still blocked: ${(e as Error).message}`);
  }

  // ── 3. Winner releases → loser can now acquire ───────────────────────────
  await pause(`Step 3: ${winnerName} will release(), then ${loserName} acquires — watch owner flip`);
  line(`3) ${winnerName} finishes → release() deletes the doc; ${loserName} acquires`);
  await winner.release();
  console.log(`  ↩ [${winnerName}] released — doc deleted`);
  await showLockDoc(db, 'DB');
  await loser.acquire();
  console.log(`  ✔ [${loserName}] acquired the freed lock`);
  await showLockDoc(db, 'DB');

  // ── 4. Stale reclaim: loser "crashes" (never releases). After TTL a new
  //     attempt reclaims the stale lock instead of being blocked forever. ──
  await pause(`Step 4: refresh — owner is now ${loserName}. Next we simulate a CRASH (no release)`);
  line(`4) ${loserName} "crashes" (never releases). Wait > TTL (${TTL_SECONDS}s) → STALE`);
  console.log(`  …waiting ${TTL_SECONDS + 1}s so lockedAt falls past the stale threshold…`);
  await new Promise((r) => setTimeout(r, (TTL_SECONDS + 1) * 1000));
  const lockC = new MigrationLock(db, LOCK_COLLECTION, TTL_SECONDS);
  await lockC.acquire();
  console.log('  ✔ [C] reclaimed the STALE lock (no manual unlock needed)');
  await showLockDoc(db, 'DB');

  await pause('Step 4 done: owner is now C, same _id, fresh lockedAt. Refresh Compass');
  await lockC.release();

  line('Done. The lock is just one document; existence + freshness = the mutex.');
  console.log('\n  Server still running so you can poke around in Compass.');
  console.log('  Press Ctrl-C to stop & wipe.\n');
  await new Promise(() => {}); // stay alive for Compass
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
