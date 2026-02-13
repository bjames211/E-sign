const admin = require('firebase-admin');

if (!admin.apps.length) {
  admin.initializeApp({
    projectId: 'e-sign-27f9a'
  });
}

const db = admin.firestore();

async function approvePending() {
  const snapshot = await db.collection('payment_ledger')
    .where('status', '==', 'pending')
    .where('createdBy', '==', 'manager')
    .get();
  
  console.log('Found ' + snapshot.size + ' pending manager entries');
  
  for (const doc of snapshot.docs) {
    const data = doc.data();
    console.log('Approving: ' + doc.id + ' - ' + data.orderNumber + ' - $' + data.amount);
    
    await doc.ref.update({
      status: 'approved',
      approvedBy: 'manager',
      approvedAt: admin.firestore.FieldValue.serverTimestamp()
    });
  }
  
  console.log('Done!');
  process.exit(0);
}

approvePending().catch(err => {
  console.error(err);
  process.exit(1);
});
