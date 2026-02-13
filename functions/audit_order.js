const admin = require('firebase-admin');

// Initialize with service account
const serviceAccount = require('./service-account.json');
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});

const db = admin.firestore();

async function audit(orderNumber) {
  // Find order
  const ordersSnap = await db.collection('orders')
    .where('orderNumber', '==', orderNumber)
    .limit(1)
    .get();

  if (ordersSnap.empty) {
    console.log('Order not found');
    return;
  }

  const orderDoc = ordersSnap.docs[0];
  const order = orderDoc.data();
  
  console.log('\n=== ORDER ===');
  console.log('Order ID:', orderDoc.id);
  console.log('Order Number:', order.orderNumber);
  console.log('Status:', order.status);
  console.log('\nPricing:');
  console.log('  deposit:', order.pricing?.deposit);
  console.log('  subtotalBeforeTax:', order.pricing?.subtotalBeforeTax);
  console.log('  extraMoneyFluff:', order.pricing?.extraMoneyFluff);
  console.log('\nLedger Summary:');
  console.log('  originalDeposit:', order.ledgerSummary?.originalDeposit);
  console.log('  depositRequired:', order.ledgerSummary?.depositRequired);
  console.log('  netReceived:', order.ledgerSummary?.netReceived);
  console.log('  balance:', order.ledgerSummary?.balance);
  console.log('\nChange Order Info:');
  console.log('  hasChangeOrders:', order.hasChangeOrders);
  console.log('  changeOrderCount:', order.changeOrderCount);
  console.log('  activeChangeOrderId:', order.activeChangeOrderId);
  console.log('  activeChangeOrderStatus:', order.activeChangeOrderStatus);

  // Get change orders
  const cosSnap = await db.collection('change_orders')
    .where('orderId', '==', orderDoc.id)
    .get();

  console.log('\n=== CHANGE ORDERS ===');
  cosSnap.docs.forEach(doc => {
    const co = doc.data();
    console.log('\n' + co.changeOrderNumber + ' (' + co.status + ')');
    console.log('  Previous deposit:', co.previousValues?.deposit);
    console.log('  New deposit:', co.newValues?.deposit);
    console.log('  Previous subtotal:', co.previousValues?.subtotalBeforeTax);
    console.log('  New subtotal:', co.newValues?.subtotalBeforeTax);
    console.log('  Deposit diff:', co.differences?.depositDiff);
  });
}

audit('ORD-00031').then(() => process.exit(0)).catch(e => {
  console.error(e);
  process.exit(1);
});
