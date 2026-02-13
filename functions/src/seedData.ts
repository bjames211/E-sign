import * as admin from 'firebase-admin';

// Seed initial admin options
export async function seedAdminOptions(): Promise<void> {
  const db = admin.firestore();
  const defaultOptions: Record<string, string[]> = {
    manufacturers: [
      'Eagle Carports',
      'American Carports',
      'American West Coast',
      'Viking Steel Structures',
      'Coast to Coast Carports',
    ],
    building_types: [
      'Carport',
      'Garage',
      'Barn',
      'Workshop',
      'RV Cover',
      'Commercial',
      'Agricultural',
    ],
    overall_widths: [
      "12'",
      "18'",
      "20'",
      "22'",
      "24'",
      "26'",
      "28'",
      "30'",
      "40'",
      "50'",
      "60'",
    ],
    building_lengths: [
      "21'",
      "26'",
      "31'",
      "36'",
      "41'",
      "51'",
      "61'",
      "81'",
      "101'",
    ],
    base_rail_lengths: [
      "21'",
      "26'",
      "31'",
      "36'",
      "41'",
      "51'",
      "61'",
    ],
    building_heights: [
      "6'",
      "7'",
      "8'",
      "9'",
      "10'",
      "11'",
      "12'",
      "14'",
      "16'",
    ],
    foundation_types: [
      'Concrete',
      'Asphalt',
      'Gravel',
      'Dirt',
      'Mobile Home Anchors',
    ],
    permitting_structures: [
      'Standard',
      'Engineer Certified',
      'Permit Required',
      'No Permit Needed',
    ],
    drawing_types: [
      'Standard Drawing',
      'Custom Drawing',
      'Engineer Stamped',
      'As-Built',
    ],
    sales_persons: [
      'John Smith',
      'Jane Doe',
      'Bob Johnson',
    ],
    states: [
      'AL', 'AK', 'AZ', 'AR', 'CA', 'CO', 'CT', 'DE', 'FL', 'GA',
      'HI', 'ID', 'IL', 'IN', 'IA', 'KS', 'KY', 'LA', 'ME', 'MD',
      'MA', 'MI', 'MN', 'MS', 'MO', 'MT', 'NE', 'NV', 'NH', 'NJ',
      'NM', 'NY', 'NC', 'ND', 'OH', 'OK', 'OR', 'PA', 'RI', 'SC',
      'SD', 'TN', 'TX', 'UT', 'VT', 'VA', 'WA', 'WV', 'WI', 'WY',
    ],
  };

  const batch = db.batch();

  for (const [type, values] of Object.entries(defaultOptions)) {
    const docRef = db.collection('admin_options').doc(type);
    batch.set(docRef, { type, values });
  }

  await batch.commit();
  console.log('Admin options seeded successfully');
}

// Seed mock quotes for demo
export async function seedMockQuotes(): Promise<void> {
  const db = admin.firestore();
  const mockQuotes = [
    {
      quoteNumber: 'QT-00001',
      customerName: 'John Anderson',
      customer: {
        firstName: 'John',
        lastName: 'Anderson',
        deliveryAddress: '123 Oak Street',
        state: 'TX',
        zip: '75001',
        phone: '(214) 555-0101',
        email: 'john.anderson@example.com',
      },
      building: {
        manufacturer: 'Eagle Carports',
        buildingType: 'Garage',
        overallWidth: "24'",
        buildingLength: "31'",
        baseRailLength: "31'",
        buildingHeight: "10'",
        lullLiftRequired: false,
        foundationType: 'Concrete',
        permittingStructure: 'Standard',
        drawingType: 'Standard Drawing',
        customerLandIsReady: true,
      },
      pricing: {
        subtotalBeforeTax: 12500,
        extraMoneyFluff: 500,
        deposit: 2500,
      },
    },
    {
      quoteNumber: 'QT-00002',
      customerName: 'Sarah Johnson',
      customer: {
        firstName: 'Sarah',
        lastName: 'Johnson',
        deliveryAddress: '456 Maple Ave',
        state: 'CA',
        zip: '90210',
        phone: '(310) 555-0202',
        email: 'sarah.johnson@example.com',
      },
      building: {
        manufacturer: 'American Carports',
        buildingType: 'Barn',
        overallWidth: "30'",
        buildingLength: "41'",
        baseRailLength: "41'",
        buildingHeight: "12'",
        lullLiftRequired: true,
        foundationType: 'Gravel',
        permittingStructure: 'Engineer Certified',
        drawingType: 'Custom Drawing',
        customerLandIsReady: false,
      },
      pricing: {
        subtotalBeforeTax: 18750,
        extraMoneyFluff: 750,
        deposit: 3750,
      },
    },
    {
      quoteNumber: 'QT-00003',
      customerName: 'Mike Williams',
      customer: {
        firstName: 'Mike',
        lastName: 'Williams',
        deliveryAddress: '789 Pine Road',
        state: 'FL',
        zip: '33101',
        phone: '(305) 555-0303',
        email: 'mike.williams@example.com',
      },
      building: {
        manufacturer: 'Viking Steel Structures',
        buildingType: 'Workshop',
        overallWidth: "40'",
        buildingLength: "51'",
        baseRailLength: "51'",
        buildingHeight: "14'",
        lullLiftRequired: true,
        foundationType: 'Concrete',
        permittingStructure: 'Permit Required',
        drawingType: 'Engineer Stamped',
        customerLandIsReady: true,
      },
      pricing: {
        subtotalBeforeTax: 32000,
        extraMoneyFluff: 1000,
        deposit: 6400,
      },
    },
    {
      quoteNumber: 'QT-00004',
      customerName: 'Emily Davis',
      customer: {
        firstName: 'Emily',
        lastName: 'Davis',
        deliveryAddress: '321 Cedar Lane',
        state: 'NC',
        zip: '27601',
        phone: '(919) 555-0404',
        email: 'emily.davis@example.com',
      },
      building: {
        manufacturer: 'Coast to Coast Carports',
        buildingType: 'Carport',
        overallWidth: "18'",
        buildingLength: "21'",
        baseRailLength: "21'",
        buildingHeight: "8'",
        lullLiftRequired: false,
        foundationType: 'Dirt',
        permittingStructure: 'No Permit Needed',
        drawingType: 'Standard Drawing',
        customerLandIsReady: true,
      },
      pricing: {
        subtotalBeforeTax: 4500,
        extraMoneyFluff: 200,
        deposit: 900,
      },
    },
    {
      quoteNumber: 'QT-00005',
      customerName: 'Robert Martinez',
      customer: {
        firstName: 'Robert',
        lastName: 'Martinez',
        deliveryAddress: '555 Birch Boulevard',
        state: 'AZ',
        zip: '85001',
        phone: '(602) 555-0505',
        email: 'robert.martinez@example.com',
      },
      building: {
        manufacturer: 'American West Coast',
        buildingType: 'RV Cover',
        overallWidth: "22'",
        buildingLength: "36'",
        baseRailLength: "36'",
        buildingHeight: "11'",
        lullLiftRequired: false,
        foundationType: 'Asphalt',
        permittingStructure: 'Standard',
        drawingType: 'Standard Drawing',
        customerLandIsReady: true,
      },
      pricing: {
        subtotalBeforeTax: 8200,
        extraMoneyFluff: 300,
        deposit: 1640,
      },
    },
  ];

  const batch = db.batch();

  for (const quote of mockQuotes) {
    const docRef = db.collection('quotes').doc();
    batch.set(docRef, {
      ...quote,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });
  }

  await batch.commit();
  console.log('Mock quotes seeded successfully');
}

// Seed 50 bulk test quotes
export async function seedBulkQuotes(count: number = 50): Promise<number> {
  const db = admin.firestore();

  const firstNames = [
    'James', 'Mary', 'Robert', 'Patricia', 'John', 'Jennifer', 'Michael', 'Linda',
    'David', 'Elizabeth', 'William', 'Barbara', 'Richard', 'Susan', 'Joseph', 'Jessica',
    'Thomas', 'Sarah', 'Christopher', 'Karen', 'Charles', 'Lisa', 'Daniel', 'Nancy',
    'Matthew', 'Betty', 'Anthony', 'Margaret', 'Mark', 'Sandra', 'Donald', 'Ashley',
    'Steven', 'Kimberly', 'Paul', 'Emily', 'Andrew', 'Donna', 'Joshua', 'Michelle',
    'Kenneth', 'Dorothy', 'Kevin', 'Carol', 'Brian', 'Amanda', 'George', 'Melissa',
    'Timothy', 'Deborah'
  ];

  const lastNames = [
    'Smith', 'Johnson', 'Williams', 'Brown', 'Jones', 'Garcia', 'Miller', 'Davis',
    'Rodriguez', 'Martinez', 'Hernandez', 'Lopez', 'Gonzalez', 'Wilson', 'Anderson',
    'Thomas', 'Taylor', 'Moore', 'Jackson', 'Martin', 'Lee', 'Perez', 'Thompson',
    'White', 'Harris', 'Sanchez', 'Clark', 'Ramirez', 'Lewis', 'Robinson', 'Walker',
    'Young', 'Allen', 'King', 'Wright', 'Scott', 'Torres', 'Nguyen', 'Hill', 'Flores',
    'Green', 'Adams', 'Nelson', 'Baker', 'Hall', 'Rivera', 'Campbell', 'Mitchell', 'Carter'
  ];

  const streets = [
    'Oak', 'Maple', 'Pine', 'Cedar', 'Elm', 'Birch', 'Willow', 'Cherry', 'Spruce',
    'Walnut', 'Hickory', 'Ash', 'Magnolia', 'Peach', 'Dogwood', 'Holly', 'Cypress'
  ];

  const streetTypes = ['Street', 'Avenue', 'Road', 'Lane', 'Drive', 'Boulevard', 'Way', 'Court'];

  const states = ['TX', 'CA', 'FL', 'NC', 'AZ', 'GA', 'TN', 'OH', 'PA', 'IL', 'NY', 'VA', 'WA', 'CO', 'SC'];

  const manufacturers = [
    'Eagle Carports', 'American Carports', 'American West Coast',
    'Viking Steel Structures', 'Coast to Coast Carports'
  ];

  const buildingTypes = ['Carport', 'Garage', 'Barn', 'Workshop', 'RV Cover', 'Commercial', 'Agricultural'];

  const widths = ["12'", "18'", "20'", "22'", "24'", "26'", "28'", "30'", "40'", "50'"];
  const lengths = ["21'", "26'", "31'", "36'", "41'", "51'", "61'"];
  const heights = ["6'", "7'", "8'", "9'", "10'", "11'", "12'", "14'"];
  const foundations = ['Concrete', 'Asphalt', 'Gravel', 'Dirt'];
  const permits = ['Standard', 'Engineer Certified', 'Permit Required', 'No Permit Needed'];
  const drawings = ['Standard Drawing', 'Custom Drawing', 'Engineer Stamped'];

  const pick = <T>(arr: T[]): T => arr[Math.floor(Math.random() * arr.length)];
  const randInt = (min: number, max: number): number => Math.floor(Math.random() * (max - min + 1)) + min;

  // Get highest existing quote number
  const quotesSnapshot = await db.collection('quotes')
    .orderBy('quoteNumber', 'desc')
    .limit(1)
    .get();

  let startNum = 100;
  if (!quotesSnapshot.empty) {
    const lastQuote = quotesSnapshot.docs[0].data();
    const match = lastQuote.quoteNumber?.match(/QT-(\d+)/);
    if (match) {
      startNum = parseInt(match[1], 10) + 1;
    }
  }

  // Firestore batches can only have 500 operations, so we'll batch in groups
  const batchSize = 50;
  let created = 0;

  for (let i = 0; i < count; i += batchSize) {
    const batch = db.batch();
    const batchCount = Math.min(batchSize, count - i);

    for (let j = 0; j < batchCount; j++) {
      const quoteNum = startNum + i + j;
      const firstName = pick(firstNames);
      const lastName = pick(lastNames);
      const width = pick(widths);
      const length = pick(lengths);

      // Calculate pricing based on size
      const widthNum = parseInt(width);
      const lengthNum = parseInt(length);
      const sqft = widthNum * lengthNum;
      const pricePerSqft = randInt(8, 15);
      const subtotal = sqft * pricePerSqft;
      const fluff = Math.round(subtotal * (randInt(2, 8) / 100));
      const deposit = Math.round((subtotal + fluff) * 0.2);

      const quote = {
        quoteNumber: `QT-${String(quoteNum).padStart(5, '0')}`,
        customerName: `${firstName} ${lastName}`,
        customer: {
          firstName,
          lastName,
          deliveryAddress: `${randInt(100, 9999)} ${pick(streets)} ${pick(streetTypes)}`,
          state: pick(states),
          zip: String(randInt(10000, 99999)),
          phone: `(${randInt(200, 999)}) ${randInt(200, 999)}-${String(randInt(0, 9999)).padStart(4, '0')}`,
          email: `${firstName.toLowerCase()}.${lastName.toLowerCase()}@example.com`,
        },
        building: {
          manufacturer: pick(manufacturers),
          buildingType: pick(buildingTypes),
          overallWidth: width,
          buildingLength: length,
          baseRailLength: length,
          buildingHeight: pick(heights),
          lullLiftRequired: Math.random() > 0.7,
          foundationType: pick(foundations),
          permittingStructure: pick(permits),
          drawingType: pick(drawings),
          customerLandIsReady: Math.random() > 0.3,
        },
        pricing: {
          subtotalBeforeTax: subtotal,
          extraMoneyFluff: fluff,
          deposit: deposit,
        },
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
      };

      const docRef = db.collection('quotes').doc();
      batch.set(docRef, quote);
    }

    await batch.commit();
    created += batchCount;
  }

  console.log(`${created} bulk quotes seeded successfully`);
  return created;
}

// Helper to get next order number (uses actual highest order number)
async function getNextOrderNumber(): Promise<string> {
  const db = admin.firestore();

  // Get highest existing order number from orders collection
  const ordersSnapshot = await db.collection('orders')
    .orderBy('orderNumber', 'desc')
    .limit(1)
    .get();

  let highestNum = 0;
  if (!ordersSnapshot.empty) {
    const lastOrder = ordersSnapshot.docs[0].data();
    const match = lastOrder.orderNumber?.match(/ORD-(\d+)/);
    if (match) {
      highestNum = parseInt(match[1], 10);
    }
  }

  // Also check counter and use whichever is higher
  const counterRef = db.collection('counters').doc('orders');
  const result = await db.runTransaction(async (t) => {
    const doc = await t.get(counterRef);
    const counterNum = doc.exists ? (doc.data()?.current || 0) : 0;
    const next = Math.max(highestNum, counterNum) + 1;
    t.set(counterRef, { current: next }, { merge: true });
    return next;
  });

  return `ORD-${String(result).padStart(5, '0')}`;
}

// Helper to get next change order number
async function getNextChangeOrderNumber(): Promise<string> {
  const db = admin.firestore();
  const counterRef = db.collection('counters').doc('changeOrders');
  const result = await db.runTransaction(async (t) => {
    const doc = await t.get(counterRef);
    const current = doc.exists ? (doc.data()?.current || 0) : 0;
    const next = current + 1;
    t.set(counterRef, { current: next }, { merge: true });
    return next;
  });
  return `CO-${String(result).padStart(5, '0')}`;
}

interface TestOrderScenario {
  name: string;
  deposit: number;
  paid: number;
  hasCO: boolean;
  coDeposit?: number;
  desc: string;
}

// Seed test orders with various payment scenarios
export async function seedTestOrders(count: number = 10): Promise<{ created: number; orders: string[] }> {
  const db = admin.firestore();

  const testScenarios: TestOrderScenario[] = [
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

  const createdOrders: string[] = [];
  const scenarios = testScenarios.slice(0, count);

  for (const scenario of scenarios) {
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
          phone: '(555) 123-4567',
          deliveryAddress: '123 Test Street',
          state: 'CA',
          zip: '90210',
        },
        pricing: {
          deposit: scenario.deposit,
          subtotalBeforeTax: subtotal,
          extraMoneyFluff: 0,
          depositPercent: 20,
        },
        building: {
          manufacturer: 'Test Manufacturer',
          buildingType: 'Garage',
          overallWidth: "24'",
          buildingLength: "30'",
        },
        hasChangeOrders: scenario.hasCO,
        changeOrderCount: scenario.hasCO ? 1 : 0,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      };

      const orderRef = await db.collection('orders').add(orderData);
      console.log(`✓ Created ${orderNumber} - ${scenario.desc}`);

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
      if (scenario.hasCO && scenario.coDeposit !== undefined) {
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

      // Calculate ledger summary
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
      createdOrders.push(orderNumber);

    } catch (err) {
      console.error(`✗ Error creating order: ${err}`);
    }
  }

  console.log(`\nCreated ${createdOrders.length} test orders`);
  return { created: createdOrders.length, orders: createdOrders };
}

// Seed partial payment test orders with different payment methods
export async function seedPartialPaymentOrders(): Promise<{ created: number; orders: string[] }> {
  const db = admin.firestore();

  // Random name generators for unique orders each time
  const firstNames = ['Amanda', 'Brandon', 'Christina', 'Derek', 'Elena', 'Frank', 'Gloria', 'Henry', 'Irene', 'Jason',
    'Karen', 'Luis', 'Monica', 'Nathan', 'Olivia', 'Patrick', 'Quinn', 'Rachel', 'Samuel', 'Tiffany',
    'Victor', 'Wendy', 'Xavier', 'Yvonne', 'Zachary'];
  const lastNames = ['Adams', 'Baker', 'Clark', 'Dixon', 'Edwards', 'Foster', 'Gibson', 'Hayes', 'Ingram', 'Jenkins',
    'King', 'Lambert', 'Morgan', 'Nelson', 'Owen', 'Parker', 'Quinn', 'Reynolds', 'Stevens', 'Tucker'];
  const streets = ['Oak', 'Pine', 'Maple', 'Cedar', 'Elm', 'Birch', 'Walnut', 'Cherry', 'Willow', 'Spruce'];
  const streetTypes = ['Street', 'Avenue', 'Road', 'Lane', 'Drive', 'Boulevard', 'Way', 'Court'];
  const cities = ['Austin', 'Dallas', 'Houston', 'San Antonio', 'Fort Worth', 'Phoenix', 'Denver', 'Atlanta', 'Miami', 'Orlando'];
  const states = ['TX', 'AZ', 'CO', 'GA', 'FL'];

  const pick = <T>(arr: T[]): T => arr[Math.floor(Math.random() * arr.length)];
  const randInt = (min: number, max: number): number => Math.floor(Math.random() * (max - min + 1)) + min;
  const genPhone = () => `555-${randInt(1000, 9999)}`;
  const genZip = () => String(randInt(10000, 99999));
  const genAddress = () => `${randInt(100, 9999)} ${pick(streets)} ${pick(streetTypes)}, ${pick(cities)}, ${pick(states)} ${genZip()}`;
  const genCustomer = () => {
    const first = pick(firstNames);
    const last = pick(lastNames);
    return {
      name: `${first} ${last}`,
      email: `${first.toLowerCase()}.${last.toLowerCase()}${randInt(1, 99)}@email.com`,
      phone: genPhone(),
      address: genAddress()
    };
  };

  const testOrders = [
    {
      customer: genCustomer(),
      building: { manufacturer: 'Viking Steel Structures', style: 'Garage', size: "24' x 30'" },
      pricing: { subtotalBeforeTax: 8500, extraMoneyFluff: 500, deposit: 1800 },
      payment: { type: 'check', status: 'pending' },
      actualPayment: 1500,
      paymentMethod: 'check'
    },
    {
      customer: genCustomer(),
      building: { manufacturer: 'Carport Central', style: 'Workshop', size: "30' x 40'" },
      pricing: { subtotalBeforeTax: 12000, extraMoneyFluff: 800, deposit: 2560 },
      payment: { type: 'wire', status: 'pending' },
      actualPayment: 2000,
      paymentMethod: 'wire'
    },
    {
      customer: genCustomer(),
      building: { manufacturer: 'Viking Steel Structures', style: 'Barn', size: "36' x 48'" },
      pricing: { subtotalBeforeTax: 18000, extraMoneyFluff: 1200, deposit: 3840 },
      payment: { type: 'stripe_already_paid', status: 'paid', stripePaymentId: 'test_' + Date.now() + '_1' },
      actualPayment: 3000,
      paymentMethod: 'stripe',
      isTestMode: true
    },
    {
      customer: genCustomer(),
      building: { manufacturer: 'American Steel Carports', style: 'RV Cover', size: "18' x 36'" },
      pricing: { subtotalBeforeTax: 6500, extraMoneyFluff: 300, deposit: 1360 },
      payment: { type: 'other', status: 'pending', notes: 'Payment via Zelle transfer' },
      actualPayment: 1000,
      paymentMethod: 'other'
    },
    {
      customer: genCustomer(),
      building: { manufacturer: 'Carport Central', style: 'Commercial', size: "40' x 60'" },
      pricing: { subtotalBeforeTax: 25000, extraMoneyFluff: 2000, deposit: 5400 },
      payment: { type: 'cash', status: 'pending' },
      actualPayment: 4500,
      paymentMethod: 'cash'
    }
  ];

  const createdOrders: string[] = [];

  // Get next payment number
  const paymentSnapshot = await db.collection('payment_ledger')
    .orderBy('paymentNumber', 'desc')
    .limit(1)
    .get();

  let payNum = 1;
  if (!paymentSnapshot.empty) {
    const lastEntry = paymentSnapshot.docs[0].data();
    const match = lastEntry.paymentNumber?.match(/PAY-(\d+)/);
    if (match) {
      payNum = parseInt(match[1], 10) + 1;
    }
  }

  for (const testOrder of testOrders) {
    try {
      const orderNumber = await getNextOrderNumber();
      const now = admin.firestore.FieldValue.serverTimestamp();

      // Create order document
      const orderData = {
        orderNumber,
        status: 'draft',
        customer: {
          firstName: testOrder.customer.name.split(' ')[0],
          lastName: testOrder.customer.name.split(' ')[1],
          email: testOrder.customer.email,
          phone: testOrder.customer.phone,
          deliveryAddress: testOrder.customer.address.split(',')[0],
          state: testOrder.customer.address.includes('TX') ? 'TX' : 'FL',
          zip: testOrder.customer.address.match(/\d{5}/)?.[0] || '75001',
        },
        building: {
          manufacturer: testOrder.building.manufacturer,
          buildingType: testOrder.building.style,
          overallWidth: testOrder.building.size.split(' x ')[0],
          buildingLength: testOrder.building.size.split(' x ')[1],
        },
        pricing: testOrder.pricing,
        payment: testOrder.payment,
        files: [],
        salesPerson: 'Test Sales Rep',
        orderFormName: '',
        paymentNotes: `Partial payment test - $${testOrder.actualPayment} of $${testOrder.pricing.deposit} deposit`,
        referredBy: '',
        specialNotes: '',
        needsPaymentApproval: testOrder.payment.status === 'pending',
        isTestMode: testOrder.isTestMode || true,
        testPaymentAmount: testOrder.actualPayment,
        changeOrderCount: 0,
        hasChangeOrders: false,
        createdBy: 'test-script',
        createdAt: now,
        updatedAt: now,
      };

      const orderRef = await db.collection('orders').add(orderData);
      const balance = testOrder.pricing.deposit - testOrder.actualPayment;

      console.log(`✓ Created ${orderNumber} - ${testOrder.customer.name}`);
      console.log(`  Method: ${testOrder.paymentMethod}, Deposit: $${testOrder.pricing.deposit}, Paid: $${testOrder.actualPayment}, Balance: $${balance}`);

      // Create ledger entry for the partial payment
      const paymentNumber = `PAY-${String(payNum).padStart(5, '0')}`;
      payNum++;

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

      // Create ledger summary
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
      createdOrders.push(orderNumber);

    } catch (err) {
      console.error(`✗ Error creating order: ${err}`);
    }
  }

  console.log(`\nCreated ${createdOrders.length} partial payment test orders`);
  return { created: createdOrders.length, orders: createdOrders };
}

// Seed orders with OVERPAYMENTS (customer paid more than deposit, due refund)
export async function seedOverpaidOrders(): Promise<{ created: number; orders: string[] }> {
  const db = admin.firestore();

  // Random name generators for unique orders each time
  const firstNames = ['Alexandra', 'Benjamin', 'Cassandra', 'Dominic', 'Evelyn', 'Fernando', 'Gabriella', 'Harrison', 'Isabella', 'Jordan',
    'Katrina', 'Leonardo', 'Madison', 'Nicholas', 'Ophelia', 'Preston', 'Quincy', 'Rebecca', 'Sebastian', 'Tabitha',
    'Ulysses', 'Veronica', 'Wesley', 'Ximena', 'Yolanda'];
  const lastNames = ['Anderson', 'Blackwell', 'Crawford', 'Donovan', 'Erikson', 'Fitzgerald', 'Gonzalez', 'Harrison', 'Ibarra', 'Jackson',
    'Kennedy', 'Lawrence', 'Mitchell', 'Navarro', 'Ortega', 'Patterson', 'Quintero', 'Richardson', 'Sullivan', 'Torres'];
  const streets = ['Sunset', 'Highland', 'Valley', 'River', 'Mountain', 'Lake', 'Forest', 'Meadow', 'Ocean', 'Prairie'];
  const streetTypes = ['Street', 'Avenue', 'Road', 'Lane', 'Drive', 'Boulevard', 'Way', 'Circle'];
  const cities = ['Nashville', 'Charlotte', 'Raleigh', 'Scottsdale', 'Tucson', 'Tampa', 'Jacksonville', 'Memphis', 'Louisville', 'Albuquerque'];
  const states = ['TN', 'NC', 'AZ', 'FL', 'NM'];

  const pick = <T>(arr: T[]): T => arr[Math.floor(Math.random() * arr.length)];
  const randInt = (min: number, max: number): number => Math.floor(Math.random() * (max - min + 1)) + min;
  const genPhone = () => `555-${randInt(1000, 9999)}`;
  const genZip = () => String(randInt(10000, 99999));
  const genAddress = () => `${randInt(100, 9999)} ${pick(streets)} ${pick(streetTypes)}, ${pick(cities)}, ${pick(states)} ${genZip()}`;
  const genCustomer = () => {
    const first = pick(firstNames);
    const last = pick(lastNames);
    return {
      name: `${first} ${last}`,
      email: `${first.toLowerCase()}.${last.toLowerCase()}${randInt(1, 99)}@email.com`,
      phone: genPhone(),
      address: genAddress()
    };
  };

  // Orders where customer OVERPAID - they are due a partial refund
  const testOrders = [
    {
      customer: genCustomer(),
      building: { manufacturer: 'Eagle Carports', style: 'Carport', size: "20' x 26'" },
      pricing: { subtotalBeforeTax: 5500, extraMoneyFluff: 300, deposit: 1160 },
      payment: { type: 'check', status: 'paid' },
      actualPayment: 1500, // Overpaid by $340
      paymentMethod: 'check'
    },
    {
      customer: genCustomer(),
      building: { manufacturer: 'American Carports', style: 'Garage', size: "22' x 31'" },
      pricing: { subtotalBeforeTax: 9200, extraMoneyFluff: 600, deposit: 1960 },
      payment: { type: 'wire', status: 'paid' },
      actualPayment: 2500, // Overpaid by $540
      paymentMethod: 'wire'
    },
    {
      customer: genCustomer(),
      building: { manufacturer: 'Coast to Coast Carports', style: 'Workshop', size: "30' x 36'" },
      pricing: { subtotalBeforeTax: 14000, extraMoneyFluff: 900, deposit: 2980 },
      payment: { type: 'stripe_already_paid', status: 'paid', stripePaymentId: 'test_overpaid_' + Date.now() + '_1' },
      actualPayment: 3500, // Overpaid by $520
      paymentMethod: 'stripe',
      isTestMode: true
    },
    {
      customer: genCustomer(),
      building: { manufacturer: 'Viking Steel Structures', style: 'Barn', size: "40' x 51'" },
      pricing: { subtotalBeforeTax: 22000, extraMoneyFluff: 1500, deposit: 4700 },
      payment: { type: 'cash', status: 'paid' },
      actualPayment: 5500, // Overpaid by $800
      paymentMethod: 'cash'
    },
    {
      customer: genCustomer(),
      building: { manufacturer: 'Carport Central', style: 'RV Cover', size: "18' x 41'" },
      pricing: { subtotalBeforeTax: 7800, extraMoneyFluff: 400, deposit: 1640 },
      payment: { type: 'other', status: 'paid', notes: 'Venmo payment' },
      actualPayment: 2000, // Overpaid by $360
      paymentMethod: 'other'
    }
  ];

  const createdOrders: string[] = [];

  // Get next payment number
  const paymentSnapshot = await db.collection('payment_ledger')
    .orderBy('paymentNumber', 'desc')
    .limit(1)
    .get();

  let payNum = 1;
  if (!paymentSnapshot.empty) {
    const lastEntry = paymentSnapshot.docs[0].data();
    const match = lastEntry.paymentNumber?.match(/PAY-(\d+)/);
    if (match) {
      payNum = parseInt(match[1], 10) + 1;
    }
  }

  for (const testOrder of testOrders) {
    try {
      const orderNumber = await getNextOrderNumber();
      const now = admin.firestore.FieldValue.serverTimestamp();

      // Create order document
      const orderData = {
        orderNumber,
        status: 'draft',
        customer: {
          firstName: testOrder.customer.name.split(' ')[0],
          lastName: testOrder.customer.name.split(' ')[1],
          email: testOrder.customer.email,
          phone: testOrder.customer.phone,
          deliveryAddress: testOrder.customer.address.split(',')[0],
          state: testOrder.customer.address.includes('TN') ? 'TN' :
                 testOrder.customer.address.includes('NC') ? 'NC' :
                 testOrder.customer.address.includes('AZ') ? 'AZ' :
                 testOrder.customer.address.includes('FL') ? 'FL' : 'NM',
          zip: testOrder.customer.address.match(/\d{5}/)?.[0] || '37201',
        },
        building: {
          manufacturer: testOrder.building.manufacturer,
          buildingType: testOrder.building.style,
          overallWidth: testOrder.building.size.split(' x ')[0],
          buildingLength: testOrder.building.size.split(' x ')[1],
        },
        pricing: testOrder.pricing,
        payment: testOrder.payment,
        files: [],
        salesPerson: 'Test Sales Rep',
        orderFormName: '',
        paymentNotes: `OVERPAID - Customer paid $${testOrder.actualPayment} on $${testOrder.pricing.deposit} deposit. Refund of $${testOrder.actualPayment - testOrder.pricing.deposit} due.`,
        referredBy: '',
        specialNotes: 'Customer overpaid - partial refund needed',
        needsPaymentApproval: false,
        isTestMode: testOrder.isTestMode || true,
        testPaymentAmount: testOrder.actualPayment,
        changeOrderCount: 0,
        hasChangeOrders: false,
        createdBy: 'test-script',
        createdAt: now,
        updatedAt: now,
      };

      const orderRef = await db.collection('orders').add(orderData);
      const overpaidAmount = testOrder.actualPayment - testOrder.pricing.deposit;
      const balance = -overpaidAmount; // Negative balance = overpaid

      console.log(`✓ Created ${orderNumber} - ${testOrder.customer.name}`);
      console.log(`  Method: ${testOrder.paymentMethod}, Deposit: $${testOrder.pricing.deposit}, Paid: $${testOrder.actualPayment}, OVERPAID by: $${overpaidAmount}`);

      // Create ledger entry for the overpayment
      const paymentNumber = `PAY-${String(payNum).padStart(5, '0')}`;
      payNum++;

      const ledgerEntry = {
        orderId: orderRef.id,
        orderNumber,
        paymentNumber,
        transactionType: 'payment',
        amount: testOrder.actualPayment,
        method: testOrder.paymentMethod,
        category: 'initial_deposit',
        status: 'approved',
        description: `Initial deposit (${testOrder.paymentMethod}) - OVERPAID by $${overpaidAmount}`,
        createdBy: 'test-script',
        balanceAfter: balance,
        depositAtTime: testOrder.pricing.deposit,
        stripeVerified: testOrder.paymentMethod === 'stripe',
        createdAt: now,
        approvedAt: now,
        approvedBy: 'test-script',
        ...(testOrder.payment.stripePaymentId && { stripePaymentId: testOrder.payment.stripePaymentId }),
      };

      await db.collection('payment_ledger').add(ledgerEntry);

      // Create ledger summary showing overpaid status
      const summaryData = {
        orderId: orderRef.id,
        orderNumber,
        depositRequired: testOrder.pricing.deposit,
        originalDeposit: testOrder.pricing.deposit,
        depositAdjustments: 0,
        totalReceived: testOrder.actualPayment,
        totalRefunded: 0,
        netReceived: testOrder.actualPayment,
        balance: balance, // Negative = overpaid
        balanceStatus: 'overpaid',
        pendingReceived: 0,
        pendingRefunds: 0,
        entryCount: 1,
        calculatedAt: now,
        lastEntryAt: now,
      };

      await db.collection('ledger_summaries').doc(orderRef.id).set(summaryData);

      // Update order with ledger summary reference
      await orderRef.update({ ledgerSummary: summaryData });

      createdOrders.push(orderNumber);

    } catch (err) {
      console.error(`✗ Error creating order: ${err}`);
    }
  }

  console.log(`\nCreated ${createdOrders.length} OVERPAID orders (refund due)`);
  return { created: createdOrders.length, orders: createdOrders };
}
