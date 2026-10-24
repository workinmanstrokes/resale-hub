const admin = require('firebase-admin');

if (!admin.apps.length) admin.initializeApp();

const db = admin.firestore();
db.settings({ ignoreUndefinedProperties: true });

module.exports = {
  admin,
  db,
  auth: admin.auth(),
  bucket: () => admin.storage().bucket(),
  FieldValue: admin.firestore.FieldValue,
  Timestamp: admin.firestore.Timestamp,
};
