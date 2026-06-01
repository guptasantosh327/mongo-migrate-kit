export async function up({ db }) {
  await db.collection('esm_things').insertOne({ created: true });
}

export async function down({ db }) {
  await db.collection('esm_things').deleteMany({});
}
