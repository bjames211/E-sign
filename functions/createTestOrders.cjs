const admin = require('firebase-admin');
const path = require('path');

// Initialize Firebase Admin
const serviceAccountPath = path.join(__dirname, '../functions/service-account.json');

try {
  const serviceAccount = require(serviceAccountPath);
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount)
  });
} catch (e) {
  // Try default credentials
  admin.initializeApp();
}

const db = admin.firestore();

// Test orders with different payment methods and partial payments
const testOrders = [
  {
    customer: { name: 'Sarah Johnson', email: 'sarah.johnson@email.com', phone: '555-0101', address: '123 Oak Street, Austin, TX 78701' },
    building: { manufacturer: 'Viking Steel Structures', style: 'Garage', size: '24\' x 30\'' },
    pricing: { subtotalBeforeTax: 8500, extraMoneyFluff: 500, deposit: 1800 },
    payment: { type: 'check', status: 'pending' },
    actualPayment: 1500, // Partial - $300 short
    paymentMethod: 'check'
  },
  {
    customer: { name: 'Robert Martinez', email: 'robert.martinez@email.com', phone: '555-0102', address: '456 Pine Ave, Dallas, TX 75201' },
    building: { manufacturer: 'Carport Central', style: 'Workshop', size: '30\' x 40\'' },
    pricing: { subtotalBeforeTax: 12000, extraMoneyFluff: 800, deposit: 2560 },
    payment: { type: 'wire', status: 'pending' },
    actualPayment: 2000, // Partial - $560 short
    paymentMethod: 'wire'
  },
  {
    customer: { name: 'Emily Chen', email: 'emily.chen@email.com', phone: '555-0103', address: '789 Maple Dr, Houston, TX 77001' },
    building: { manufacturer: 'Viking Steel Structures', style: 'Barn', size: '36\' x 48\'' },
    pricing: { subtotalBeforeTax: 18000, extraMoneyFluff: 1200, deposit: 3840 },
    payment: { type: 'stripe_already_paid', status: 'paid', stripePaymentId: 'test_' + Date.now() + '_1' },
    actualPayment: 3000, // Partial - $840 short
    paymentMethod: 'stripe',
    isTestMode: true
  },
  {
    customer: { name: 'Michael Thompson', email: 'michael.t@email.com', phone: '555-0104', address: '321 Cedar Ln, San Antonio, TX 78201' },
    building: { manufacturer: 'American Steel Carports', style: 'RV Cover', size: '18\' x 36\'' },
    pricing: { subtotalBeforeTax: 6500, extraMoneyFluff: 300, deposit: 1360 },
    payment: { type: 'other', status: 'pending', notes: 'Payment via Zelle transfer' },
    actualPayment: 1000, // Partial - $360 short
    paymentMethod: 'other'
  },
  {
    customer: { name: 'Jessica Williams', email: 'jessica.w@email.com', phone: '555-0105', address: '654 Birch Blvd, Fort Worth, TX 76101' },
    building: { manufacturer: 'Carport Central', style: 'Commercial', size: '40\' x 60\'' },
    pricing: { subtotalBeforeTax: 25000, extraMoneyFluff: 2000, deposit: 5400 },
    payment: { type: 'cash', status: 'pending' },
    actualPayment: 4500, // Partial - $900 short
    paymentMethod: 'cash'
  }
];

async function getNextOrderNumber() {
  const snapshot = await db.collection('orders')
    .orderBy('orderNumber', 'desc')
    .limit(1)
    .get();

  if (snapshot.empty) {
    return 'ORD-00001';
  }

  const lastOrder = snapshot.docs[0].data();
  const lastNumber = parseInt(lastOrder.orderNumber.replace('ORD-', ''));
  return `ORD-${String(lastNumber + 1).padStart(5, '0')}`;
}

async function getNextPaymentNumber() {
  const snapshot = await db.collection('payment_ledger')
    .orderBy('paymentNumber', 'desc')
    .limit(1)
    .get();

  if (snapshot.empty) {
    return 'PAY-00001';
  }

  const lastEntry = snapshot.docs[0].data();
  const lastNumber = parseInt(lastEntry.paymentNumber.replace('PAY-', ''));
  return `PAY-${String(lastNumber + 1).padStart(5, '0')}`;
}

async function createTestOrders() {
  console.log('Creating 5 test orders with partial payments...\n');

  let currentOrderNumber = await getNextOrderNumber();
  let currentPayNumber = await getNextPaymentNumber();

  for (const testOrder of testOrders) {
    const orderNumber = currentOrderNumber;
    const now = admin.firestore.Timestamp.now();

    // Calculate order total
    const orderTotal = testOrder.pricing.subtotalBeforeTax + testOrder.pricing.extraMoneyFluff;
    const balanceDueAtDelivery = orderTotal - testOrder.pricing.deposit;

    // Create order document
    const orderData = {
      orderNumber,
      status: 'draft',
      customer: testOrder.customer,
      building: testOrder.building,
      pricing: testOrder.pricing,
      payment: testOrder.payment,
      files: [],
      salesPerson: 'Test Sales Rep',
      orderFormName: '',
      paymentNotes: `Test order - partial payment of $${testOrder.actualPayment} on $${testOrder.pricing.deposit} deposit`,
      referredBy: '',
      specialNotes: '',
      needsPaymentApproval: testOrder.payment.status === 'pending',
      isTestMode: testOrder.isTestMode || false,
      testPaymentAmount: testOrder.actualPayment,
      changeOrderCount: 0,
      hasChangeOrders: false,
      createdBy: 'test-script',
      createdAt: now,
      updatedAt: now,
    };

    // Add order to Firestore
    const orderRef = await db.collection('orders').add(orderData);
    console.log(`Created ${orderNumber} - ${testOrder.customer.name}`);
    console.log(`  Building: ${testOrder.building.style} ${testOrder.building.size}`);
    console.log(`  Deposit Required: $${testOrder.pricing.deposit}`);
    console.log(`  Payment Method: ${testOrder.paymentMethod}`);
    console.log(`  Actual Payment: $${testOrder.actualPayment}`);
    console.log(`  Balance Due: $${testOrder.pricing.deposit - testOrder.actualPayment}`);

    // Create ledger entry for the partial payment
    const paymentNumber = currentPayNumber;
    const balance = testOrder.pricing.deposit - testOrder.actualPayment;

    const ledgerEntry = {
      orderId: orderRef.id,
      orderNumber,
      paymentNumber,
      transactionType: 'payment',
      amount: testOrder.actualPayment,
      method: testOrder.paymentMethod,
      category: 'initial_deposit',
      status: testOrder.payment.status === 'pending' ? 'pending' : 'approved',
      description: `Initial deposit (${testOrder.paymentMethod}) - partial payment`,
      createdBy: 'test-script',
      balanceAfter: balance,
      depositAtTime: testOrder.pricing.deposit,
      stripeVerified: false,
      createdAt: now,
      ...(testOrder.payment.status !== 'pending' && { approvedAt: now, approvedBy: 'test-script' }),
      ...(testOrder.payment.stripePaymentId && { stripePaymentId: testOrder.payment.stripePaymentId }),
    };

    await db.collection('payment_ledger').add(ledgerEntry);

    // Create/update ledger summary
    const summaryData = {
      orderId: orderRef.id,
      orderNumber,
      depositRequired: testOrder.pricing.deposit,
      originalDeposit: testOrder.pricing.deposit,
      depositAdjustments: 0,
      totalReceived: testOrder.payment.status === 'pending' ? 0 : testOrder.actualPayment,
      totalRefunded: 0,
      netReceived: testOrder.payment.status === 'pending' ? 0 : testOrder.actualPayment,
      balance: testOrder.payment.status === 'pending' ? testOrder.pricing.deposit : balance,
      balanceStatus: 'underpaid',
      pendingReceived: testOrder.payment.status === 'pending' ? testOrder.actualPayment : 0,
      pendingRefunds: 0,
      entryCount: 1,
      calculatedAt: now,
      lastEntryAt: now,
    };

    await db.collection('ledger_summaries').doc(orderRef.id).set(summaryData);

    console.log(`  Ledger Entry: ${paymentNumber}\n`);

    // Increment order and payment numbers
    const orderNum = parseInt(currentOrderNumber.replace('ORD-', ''));
    currentOrderNumber = `ORD-${String(orderNum + 1).padStart(5, '0')}`;

    const payNum = parseInt(currentPayNumber.replace('PAY-', ''));
    currentPayNumber = `PAY-${String(payNum + 1).padStart(5, '0')}`;
  }

  console.log('Done! Created 5 test orders with partial payments.');
}

createTestOrders()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('Error:', err);
    process.exit(1);
  });
