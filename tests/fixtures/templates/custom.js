// CUSTOM TEMPLATE fixture used to test --template / config.templatePath.
export async function up({ db }) {
  await db.collection('custom').insertOne({ from: 'template' });
}
export async function down({ db }) {
  await db.collection('custom').deleteMany({ from: 'template' });
}
