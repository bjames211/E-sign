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
