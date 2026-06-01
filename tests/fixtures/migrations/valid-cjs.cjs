module.exports = {
  useTransaction: false,
  description: 'A valid CommonJS migration',
  async up({ db }) {
    await db.collection('cjs_things').insertOne({ created: true });
  },
  async down({ db }) {
    await db.collection('cjs_things').deleteMany({});
  },
};
