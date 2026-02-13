import * as admin from 'firebase-admin';

// Delete test orders created with wrong order numbers
export async function deleteTestOrders(orderNumbers: string[]): Promise<{ deleted: string[]; errors: string[] }> {
  const db = admin.firestore();
  const deleted: string[] = [];
  const errors: string[] = [];

  for (const orderNumber of orderNumbers) {
    try {
      // Find order by orderNumber where createdBy is 'test-script'
      const ordersSnap = await db.collection('orders')
        .where('orderNumber', '==', orderNumber)
        .where('createdBy', '==', 'test-script')
        .get();

      if (ordersSnap.empty) {
        console.log(`No test order found for ${orderNumber}`);
        continue;
      }

      for (const orderDoc of ordersSnap.docs) {
        const orderId = orderDoc.id;
        console.log(`Deleting ${orderNumber} (${orderId})...`);

        // Delete ledger entries
        const ledgerSnap = await db.collection('payment_ledger')
          .where('orderId', '==', orderId)
          .get();

        for (const ledgerDoc of ledgerSnap.docs) {
          await ledgerDoc.ref.delete();
          console.log(`  Deleted ledger entry ${ledgerDoc.id}`);
        }

        // Delete ledger summary
        const summaryRef = db.collection('ledger_summaries').doc(orderId);
        const summaryDoc = await summaryRef.get();
        if (summaryDoc.exists) {
          await summaryRef.delete();
          console.log(`  Deleted ledger summary`);
        }

        // Delete the order
        await orderDoc.ref.delete();
        console.log(`  Deleted order document`);

        deleted.push(orderNumber);
      }
    } catch (err) {
      console.error(`Error deleting ${orderNumber}:`, err);
      errors.push(`${orderNumber}: ${err}`);
    }
  }

  return { deleted, errors };
}
