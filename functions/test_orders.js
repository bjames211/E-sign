const admin = require('firebase-admin');

// Initialize Firebase Admin
const serviceAccount = require('./service-account.json');
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});

const db = admin.firestore();

// Helper to generate order number
async function getNextOrderNumber() {
  const counterRef = db.collection('counters').doc('orders');
  const result = await db.runTransaction(async (t) => {
    const doc = await t.get(counterRef);
    const current = doc.exists ? doc.data().current : 0;
    const next = current + 1;
    t.set(counterRef, { current: next }, { merge: true });
    return next;
  });
  return `ORD-${String(result).padStart(5, '0')}`;
}

// Helper to generate change order number
async function getNextChangeOrderNumber() {
  const counterRef = db.collection('counters').doc('changeOrders');
  const result = await db.runTransaction(async (t) => {
    const doc = await t.get(counterRef);
    const current = doc.exists ? doc.data().current : 0;
    const next = current + 1;
    t.set(counterRef, { current: next }, { merge: true });
    return next;
  });
  return `CO-${String(result).padStart(5, '0')}`;
}

// Create test orders
async function createTestOrders() {
  const testScenarios = [
    { name: 'Alice Smith', deposit: 5000, paid: 5000, hasCO: false, desc: 'Fully paid, no CO' },
    { name: 'Bob Jones', deposit: 6000, paid: 0, hasCO: false, desc: 'Unpaid, no CO' },
    { name: 'Carol White', deposit: 4000, paid: 4000, hasCO: true, coDeposit: 4500, desc: 'Paid original, CO increases deposit' },
    { name: 'David Brown', deposit: 8000, paid: 8000, hasCO: true, coDeposit: 7000, desc: 'Overpaid due to CO decrease' },
    { name: 'Eve Davis', deposit: 3000, paid: 1500, hasCO: false, desc: 'Partially paid' },
    { name: 'Frank Miller', deposit: 10000, paid: 10000, hasCO: true, coDeposit: 10000, desc: 'Paid, CO no deposit change' },
    { name: 'Grace Wilson', deposit: 7000, paid: 0, hasCO: true, coDeposit: 9000, desc: 'Unpaid with CO increase' },
    { name: 'Henry Taylor', deposit: 5500, paid: 5500, hasCO: false, desc: 'Fully paid, no CO' },
    { name: 'Ivy Anderson', deposit: 4500, paid: 6000, hasCO: false, desc: 'Overpaid by $1500' },
    { name: 'Jack Thomas', deposit: 6500, paid: 3000, hasCO: true, coDeposit: 8000, desc: 'Partial paid, CO increases deposit' },
  ];

  console.log('Creating 10 test orders...\n');

  for (const scenario of testScenarios) {
    try {
      const orderNumber = await getNextOrderNumber();
      const subtotal = scenario.deposit * 5; // 20% deposit

      // Create order
      const orderData = {
        orderNumber,
        status: scenario.paid > 0 ? 'signed' : 'pending_signature',
        customer: {
          firstName: scenario.name.split(' ')[0],
          lastName: scenario.name.split(' ')[1],
          email: `${scenario.name.toLowerCase().replace(' ', '.')}@test.com`,
        },
        pricing: {
          deposit: scenario.deposit,
          subtotalBeforeTax: subtotal,
          extraMoneyFluff: 0,
          depositPercent: 20,
        },
        hasChangeOrders: scenario.hasCO,
        changeOrderCount: scenario.hasCO ? 1 : 0,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      };

      const orderRef = await db.collection('orders').add(orderData);
      console.log(`✓ Created ${orderNumber} - ${scenario.desc}`);
      console.log(`  Customer: ${scenario.name}`);
      console.log(`  Deposit: $${scenario.deposit}, Paid: $${scenario.paid}`);

      // Create payment if paid
      if (scenario.paid > 0) {
        const ledgerEntry = {
          orderId: orderRef.id,
          orderNumber,
          transactionType: 'payment',
          amount: scenario.paid,
          method: 'stripe',
          category: 'initial_deposit',
          status: 'verified',
          stripePaymentId: `test_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
          stripeVerified: true,
          description: 'Test payment',
          createdBy: 'test_script',
          createdAt: admin.firestore.FieldValue.serverTimestamp(),
        };
        await db.collection('payment_ledger').add(ledgerEntry);
        console.log(`  ✓ Added payment: $${scenario.paid}`);
      }

      // Create change order if needed
      if (scenario.hasCO) {
        const coNumber = await getNextChangeOrderNumber();
        const coSubtotal = scenario.coDeposit * 5;

        const changeOrder = {
          changeOrderNumber: coNumber,
          orderId: orderRef.id,
          orderNumber,
          status: 'pending_signature',
          previousValues: {
            deposit: scenario.deposit,
            subtotalBeforeTax: subtotal,
            extraMoneyFluff: 0,
          },
          newValues: {
            deposit: scenario.coDeposit,
            subtotalBeforeTax: coSubtotal,
            extraMoneyFluff: 0,
          },
          differences: {
            depositDiff: scenario.coDeposit - scenario.deposit,
            subtotalDiff: coSubtotal - subtotal,
          },
          reason: 'Test change order',
          createdBy: 'test_script',
          createdAt: admin.firestore.FieldValue.serverTimestamp(),
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        };

        const coRef = await db.collection('change_orders').add(changeOrder);

        // Update order with CO info
        await orderRef.update({
          activeChangeOrderId: coRef.id,
          activeChangeOrderStatus: 'pending_signature',
          changeOrderCount: 1,
          hasChangeOrders: true,
        });

        console.log(`  ✓ Added CO: ${coNumber} (deposit: $${scenario.deposit} → $${scenario.coDeposit})`);
      }

      // Calculate and update ledger summary
      const entriesSnap = await db.collection('payment_ledger')
        .where('orderId', '==', orderRef.id)
        .get();

      let totalReceived = 0;
      entriesSnap.docs.forEach(doc => {
        const entry = doc.data();
        if (entry.transactionType === 'payment' && entry.status === 'verified') {
          totalReceived += entry.amount;
        }
      });

      const depositRequired = scenario.deposit;
      const balance = depositRequired - totalReceived;
      const balanceStatus = balance === 0 ? 'paid' : balance > 0 ? 'underpaid' : 'overpaid';

      const ledgerSummary = {
        depositRequired,
        originalDeposit: scenario.deposit,
        depositAdjustments: 0,
        totalReceived,
        totalRefunded: 0,
        netReceived: totalReceived,
        balance,
        balanceStatus,
        pendingReceived: 0,
        pendingRefunds: 0,
        entryCount: entriesSnap.size,
        calculatedAt: admin.firestore.FieldValue.serverTimestamp(),
      };

      await orderRef.update({ ledgerSummary });
      console.log(`  ✓ Ledger summary: balance=$${balance} (${balanceStatus})`);
      console.log('');

    } catch (err) {
      console.error(`✗ Error creating order: ${err.message}`);
    }
  }

  console.log('\n=== Summary ===');
  console.log('Created 10 test orders with various scenarios:');
  console.log('- 3 fully paid (no issues)');
  console.log('- 2 unpaid (balance due)');
  console.log('- 1 partially paid');
  console.log('- 1 overpaid');
  console.log('- 5 with change orders (pending_signature)');
  console.log('\nRefresh the Manager Payment Dashboard to verify.');
}

createTestOrders()
  .then(() => {
    console.log('\nDone!');
    process.exit(0);
  })
  .catch(err => {
    console.error('Fatal error:', err);
    process.exit(1);
  });
