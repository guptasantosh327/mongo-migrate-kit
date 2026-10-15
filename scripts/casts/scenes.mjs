/**
 * The scenes behind every terminal cast. Each one sets up a small "shop-api" project, then types
 * real commands. See record.mjs for how they run.
 */

const CONFIG = `export default {
  uri: process.env.MONGO_URL ?? 'mongodb://localhost:27017',
  dbName: 'shop',
  migrationsDir: './migrations',
};
`;

const FILES = {
  usersIndex: [
    '20261012090000-add-users-email-index.js',
    `export const description = 'Unique index on users.email';
export const author = 'Asha Rao';

export async function up({ db }) {
  await db.collection('users').createIndex({ email: 1 }, { unique: true });
}

export async function down({ db }) {
  await db.collection('users').dropIndex('email_1');
}
`,
  ],
  orderStatus: [
    '20261012091500-backfill-order-status.js',
    `export const description = 'Give old orders a status';
export const author = 'Asha Rao';

export async function up({ db }) {
  await db.collection('orders').updateMany(
    { status: { $exists: false } },
    { $set: { status: 'placed' } },
  );
}

export async function down({ db }) {
  await db.collection('orders').updateMany({ status: 'placed' }, { $unset: { status: '' } });
}
`,
  ],
  ordersIndex: [
    '20261014103000-add-orders-customer-index.js',
    `export const description = 'Index orders by customer';
export const author = 'Ravi Kumar';

export async function up({ db }) {
  await db.collection('orders').createIndex({ customerId: 1, createdAt: -1 });
}

export async function down({ db }) {
  await db.collection('orders').dropIndex('customerId_1_createdAt_-1');
}
`,
  ],
  renameName: [
    '20261015110000-rename-user-name.js',
    `export const description = 'Rename users.name to fullName';
export const author = 'Ravi Kumar';

export async function up({ db }) {
  await db.collection('users').updateMany({}, { $rename: { name: 'fullName' } });
}

export async function down({ db }) {
  await db.collection('users').updateMany({}, { $rename: { fullName: 'name' } });
}
`,
  ],
  seedPlans: [
    '20261015120000-seed-plans.js',
    `export const description = 'Add the paid plans';
export const author = 'Ravi Kumar';
export const useTransaction = true;

export async function up({ db, session }) {
  const plans = db.collection('plans');
  await plans.updateMany({}, { $set: { legacy: true } }, { session });
  await plans.insertMany(
    [
      { _id: 'pro', price: 29 },
      { _id: 'free', price: 0 },
    ],
    { session },
  );
}

export async function down({ db, session }) {
  await db.collection('plans').deleteMany({ _id: { $in: ['pro', 'free'] } }, { session });
}
`,
  ],
};

const TUTORIAL = {
  users: `export const description = 'Create the users collection';
export const author = 'Asha Rao';

export async function up({ db }) {
  await db.createCollection('users');
  await db.collection('users').createIndex({ email: 1 }, { unique: true });
}

export async function down({ db }) {
  await db.collection('users').drop();
}
`,
  status: `export const description = 'Give every user a status';
export const author = 'Asha Rao';

export async function up({ db }) {
  await db.collection('users').updateMany(
    { status: { $exists: false } },
    { $set: { status: 'active', statusSetByMigration: true } },
  );
}

export async function down({ db }) {
  await db.collection('users').updateMany(
    { statusSetByMigration: true },
    { $unset: { status: '', statusSetByMigration: '' } },
  );
}
`,
};

const DEV = {
  v1: `export const description = 'Index orders by customer';
export const author = 'Asha Rao';

export async function up({ db }) {
  await db.collection('orders').createIndex({ customerId: 1 }, { name: 'orders_by_customer' });
}

export async function down({ db }) {
  await db.collection('orders').dropIndex('orders_by_customer');
}
`,
  v2: `export const description = 'Index open orders by customer';
export const author = 'Asha Rao';

export async function up({ db }) {
  await db.collection('orders').createIndex(
    { customerId: 1 },
    { name: 'orders_by_customer', partialFilterExpression: { status: 'open' } },
  );
}

export async function down({ db }) {
  await db.collection('orders').dropIndex('orders_by_customer');
}
`,
};

function write(ctx, ...keys) {
  for (const key of keys) {
    const [name, body] = FILES[key];
    ctx.write(`migrations/${name}`, body);
  }
}

async function seed(ctx) {
  const orders = Array.from({ length: 40_000 }, (_, i) => ({
    customerId: `c${i % 900}`,
    total: (i % 97) + 3,
    createdAt: new Date(Date.UTC(2026, 0, 1) + i * 60_000),
  }));
  await ctx.db.collection('orders').insertMany(orders);
  await ctx.db
    .collection('users')
    .insertMany(Array.from({ length: 3000 }, (_, i) => ({ name: `User ${i}`, email: `u${i}@shop.dev` })));
}

const STEP_FILE = FILES.ordersIndex[0];
const STATUS_FILE = FILES.orderStatus[0];

export const scenes = [
  {
    // Homepage + README hero: the whole idea in 30 seconds.
    name: 'hero',
    alt: 'mmk previewing, applying and rolling back MongoDB migrations',
    rows: 17,
    setup: async (ctx) => {
      ctx.write('mmk.config.js', CONFIG);
      write(ctx, 'usersIndex', 'orderStatus', 'ordersIndex');
      await seed(ctx);
    },
    steps: [
      { cmd: 'npx mmk dry-run up', hold: 2600 },
      { cmd: 'npx mmk up', hold: 2000 },
      { cmd: `npx mmk down ${STEP_FILE}`, hold: 1800 },
      { cmd: 'npx mmk status', hold: 3000 },
    ],
  },
  {
    name: 'quickstart',
    alt: 'Installing mongo-migrate-kit and running a first migration',
    rows: 20,
    setup: async (ctx) => {
      ctx.write('package.json', '{ "name": "shop-api", "type": "module" }\n');
      await seed(ctx);
    },
    steps: [
      { cmd: 'npx mmk init' },
      { cmd: 'npx mmk create add-users-email-index' },
      { comment: '# fill in up() and down() in that file, then:', hold: 900 },
      {
        hidden: (ctx) => {
          const fs = ctx.sh('ls migrations').trim();
          ctx.write(`migrations/${fs}`, FILES.usersIndex[1]);
        },
      },
      { cmd: 'npx mmk up' },
      { cmd: 'npx mmk status', hold: 2600 },
      { cmd: 'npx mmk down', hold: 3000 },
    ],
  },
  {
    // The tutorial page walks through these exact commands.
    name: 'tutorial',
    alt: 'The tutorial: two migrations, one run on its own, a dry run, a full run and a rollback',
    rows: 22,
    folder: 'mmk-tutorial',
    displayDb: 'mmk_tutorial',
    setup: async (ctx) => {
      ctx.write('package.json', '{ "name": "mmk-tutorial", "type": "module" }\n');
      ctx.write('mmk.config.js', CONFIG.replace("'shop'", "'mmk_tutorial'"));
    },
    steps: [
      { cmd: 'npx mmk create create-users' },
      { hidden: 'sleep 1.1' },
      { cmd: 'npx mmk create add-user-status' },
      {
        hidden: (ctx) => {
          const files = ctx.sh('ls migrations').trim().split('\n');
          const users = files.find((f) => f.endsWith('create-users.js'));
          const status = files.find((f) => f.endsWith('add-user-status.js'));
          ctx.tutorialFirst = users;
          ctx.write(`migrations/${users}`, TUTORIAL.users);
          ctx.write(`migrations/${status}`, TUTORIAL.status);
        },
      },
      { cmd: (ctx) => `npx mmk up ${ctx.tutorialFirst}` },
      {
        hidden: async (ctx) => {
          await ctx.db.collection('users').insertMany([
            { name: 'Ada', email: 'ada@example.com' },
            { name: 'Linus', email: 'linus@example.com' },
            { name: 'Grace', email: 'grace@example.com', status: 'banned' },
          ]);
        },
      },
      { cmd: 'npx mmk dry-run up' },
      { cmd: 'npx mmk up' },
      { cmd: 'npx mmk status' },
      { cmd: 'npx mmk down' },
      { cmd: 'npx mmk status', hold: 3200 },
    ],
  },
  {
    // The edit-run-redo loop from the "A normal day" page.
    name: 'devloop',
    alt: 'Writing a migration: mmk up, edit the file, mmk redo, then mmk down to check the rollback works',
    rows: 16,
    setup: async (ctx) => {
      ctx.write('mmk.config.js', CONFIG);
      await seed(ctx);
    },
    steps: [
      { cmd: 'npx mmk create index-orders-by-customer' },
      {
        hidden: (ctx) => {
          const file = ctx.sh('ls migrations').trim();
          ctx.devFile = file;
          ctx.write(`migrations/${file}`, DEV.v1);
        },
      },
      { cmd: 'npx mmk up' },
      { comment: '# hmm, it should only cover open orders. Edit the file and try again:', hold: 900 },
      { hidden: (ctx) => ctx.write(`migrations/${ctx.devFile}`, DEV.v2) },
      { cmd: 'npx mmk redo' },
      { comment: '# before committing, make sure down() really works:', hold: 700 },
      { cmd: 'npx mmk down', hold: 3200 },
    ],
  },
  {
    name: 'rollback',
    alt: 'Rolling back the last batch, then one more migration with --steps',
    rows: 22,
    setup: async (ctx) => {
      ctx.write('mmk.config.js', CONFIG);
      await seed(ctx);
      write(ctx, 'usersIndex', 'orderStatus');
      ctx.sh('npx mmk up');
      write(ctx, 'ordersIndex', 'renameName');
      ctx.sh('npx mmk up');
    },
    steps: [
      { cmd: 'npx mmk status', hold: 2600 },
      { cmd: 'npx mmk down' },
      { cmd: 'npx mmk down --steps 1' },
      { cmd: 'npx mmk status', hold: 3200 },
    ],
  },
  {
    name: 'checksum',
    alt: 'mmk noticing that an applied migration was edited',
    rows: 18,
    setup: async (ctx) => {
      ctx.write('mmk.config.js', CONFIG);
      await seed(ctx);
      write(ctx, 'usersIndex', 'orderStatus');
      ctx.sh('npx mmk up');
    },
    steps: [
      { cmd: `echo "// small fix" >> migrations/${STATUS_FILE}`, hold: 300 },
      { cmd: 'npx mmk status', hold: 2400 },
      { cmd: 'npx mmk down', hold: 4200 },
    ],
  },
  {
    name: 'failure',
    alt: 'A failing migration inside a transaction is rolled back',
    rows: 19,
    cols: 100,
    setup: async (ctx) => {
      ctx.write('mmk.config.js', CONFIG);
      write(ctx, 'usersIndex');
      ctx.sh('npx mmk up');
      await ctx.db.collection('plans').insertOne({ _id: 'free', price: 0 });
      write(ctx, 'seedPlans');
    },
    steps: [
      { cmd: 'npx mmk up', hold: 5200 },
      { cmd: 'npx mmk list --pending', hold: 2600 },
    ],
  },
  {
    name: 'lock',
    alt: 'Two deploys start at once; the second one is stopped by the lock',
    rows: 9,
    cols: 96,
    layout: 'stack',
    host: 'deploy-a',
    setup: async (ctx) => {
      ctx.write('mmk.config.js', CONFIG);
      write(ctx, 'usersIndex');
      ctx.sh('npx mmk up');
      ctx.write(
        'migrations/20261015130000-backfill-order-totals.js',
        `export const description = 'Recompute order totals';
export const author = 'Ravi Kumar';

export async function up() {
  await new Promise((done) => setTimeout(done, 6000));
}

export async function down() {}
`,
      );
    },
    record: async (ctx) => {
      const a = ctx.runAsync('npx mmk up');
      await new Promise((r) => setTimeout(r, 2200));
      const b1 = ctx.sh('npx mmk up');
      const aOut = await a;
      const b2 = ctx.sh('npx mmk up');
      const aItems = ctx.output(aOut);
      // Give A's "Applying …" spinner the real length of the slow migration.
      for (const item of aItems) if (item.spinner?.startsWith('Applying')) item.ms = 6200;
      return [
        { label: 'Deploy A', rows: 4, entries: [{ text: 'npx mmk up', output: aItems, hold: 5000 }] },
        {
          label: 'Deploy B, two seconds later',
          rows: 11,
          startAt: 1700,
          entries: [
            { text: 'npx mmk up', output: ctx.output(b1), hold: 2000 },
            { text: 'npx mmk up', at: 9900, output: ctx.output(b2), hold: 3000 },
          ],
        },
      ];
    },
  },
  {
    name: 'import',
    alt: 'Adopting a migrate-mongo changelog with mmk import',
    rows: 22,
    setup: async (ctx) => {
      ctx.write(
        'mmk.config.js',
        CONFIG.replace("migrationsDir: './migrations',", "migrationsDir: './migrations',\n  // migrate-mongo kept its history in \"changelog\"; mmk reads it once"),
      );
      const old = [
        ['20250301100000-create-users.js', '2025-03-01T10:05:00Z', 1],
        ['20250412083000-add-sku-index.js', '2025-04-12T08:40:00Z', 2],
        ['20250720140000-split-address.js', '2025-07-20T14:10:00Z', 3],
      ];
      for (const [file] of old) {
        ctx.write(
          `migrations/${file}`,
          'module.exports = {\n  async up(db) {},\n  async down(db) {},\n};\n',
        );
      }
      write(ctx, 'usersIndex');
      await ctx.db.collection('changelog').insertMany(
        old.map(([fileName, at, block]) => ({ fileName, appliedAt: new Date(at), migrationBlock: block })),
      );
    },
    steps: [
      { cmd: 'npx mmk import --dry-run', hold: 2600 },
      { cmd: 'npx mmk import' },
      { cmd: 'npx mmk up', hold: 3200 },
    ],
  },
  {
    name: 'ci-check',
    alt: 'mmk status --check failing a CI job because a migration is pending',
    rows: 14,
    folder: 'shop-api',
    title: 'CI · deploy job',
    setup: async (ctx) => {
      ctx.write('mmk.config.js', CONFIG);
      write(ctx, 'usersIndex', 'orderStatus');
      await seed(ctx);
      ctx.sh(`npx mmk up ${FILES.usersIndex[0]}`);
    },
    steps: [{ cmd: 'npx mmk status --check || echo "Deploy blocked: run mmk up first"', hold: 4200 }],
  },
  {
    name: 'config-error',
    alt: 'A configuration error that names every problem and how to fix it',
    static: true,
    minCols: 86,
    setup: async (ctx) => {
      ctx.write('mmk.config.js', `export default {\n  dbName: 'shop',\n  migrationsDir: './migrations',\n};\n`);
      ctx.env = { MMK_URI: '', MMK_DB: '', MMK_LOCK_TTL: 'abc' };
    },
    cols: 100,
    steps: [{ cmd: 'MMK_LOCK_TTL=abc npx mmk up', run: 'npx mmk up' }],
  },
  {
    name: 'namespaces',
    alt: 'Two repos sharing one database, each with its own namespace',
    rows: 22,
    folder: 'orders-api',
    setup: async (ctx) => {
      ctx.write('mmk.config.js', CONFIG.replace("dbName: 'shop',", "dbName: 'shop',\n  namespace: 'orders-api',"));
      write(ctx, 'ordersIndex');
      await seed(ctx);
      ctx.sh('npx mmk up');
      // A second repo, "billing", writes to the same database with its own namespace.
      ctx.write(
        '../billing/mmk.config.js',
        CONFIG.replace("dbName: 'shop',", "dbName: 'shop',\n  namespace: 'billing',"),
      );
      ctx.write(
        '../billing/migrations/20261013080000-add-invoices-index.js',
        `export const author = 'Mei Lin';
export async function up({ db }) {
  await db.collection('invoices').createIndex({ customerId: 1 });
}
export async function down({ db }) {
  await db.collection('invoices').dropIndex('customerId_1');
}
`,
      );
      ctx.sh('cd ../billing && npx mmk up');
    },
    steps: [
      { cmd: 'npx mmk status', hold: 2400 },
      { cmd: 'npx mmk status --all-namespaces', hold: 3600 },
    ],
  },
];
