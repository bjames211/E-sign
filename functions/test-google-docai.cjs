const { DocumentProcessorServiceClient } = require('@google-cloud/documentai').v1;
const fs = require('fs');
const path = require('path');

// Configuration - UPDATE THESE
const PROJECT_ID = 'e-sign-27f9a';
const LOCATION = 'us'; // or 'eu'
const PROCESSOR_ID = process.argv[2]; // Pass as command line argument

async function testDocumentAI(pdfPath) {
  if (!PROCESSOR_ID) {
    console.log('Usage: node test-google-docai.cjs <PROCESSOR_ID> [pdf_path]');
    console.log('Example: node test-google-docai.cjs abc123def456 "/Users/design/Desktop/test 2.pdf"');
    return;
  }

  const client = new DocumentProcessorServiceClient();

  // Read the PDF file
  const filePath = pdfPath || '/Users/design/Desktop/test 2.pdf';
  console.log('Reading PDF:', filePath);
  const pdfBuffer = fs.readFileSync(filePath);
  const encodedPdf = pdfBuffer.toString('base64');

  // Build the request
  const processorName = `projects/${PROJECT_ID}/locations/${LOCATION}/processors/${PROCESSOR_ID}`;

  console.log('Processing with Google Document AI...');
  console.log('Processor:', processorName);

  const request = {
    name: processorName,
    rawDocument: {
      content: encodedPdf,
      mimeType: 'application/pdf',
    },
  };

  try {
    const [result] = await client.processDocument(request);
    const { document } = result;

    console.log('\n=== EXTRACTED TEXT (first 500 chars) ===');
    console.log(document.text?.substring(0, 500) + '...\n');

    console.log('=== FORM FIELDS EXTRACTED ===\n');

    // Extract form fields (key-value pairs)
    const fields = {};

    if (document.pages) {
      for (const page of document.pages) {
        if (page.formFields) {
          for (const field of page.formFields) {
            const fieldName = getText(field.fieldName, document.text);
            const fieldValue = getText(field.fieldValue, document.text);

            if (fieldName && fieldValue) {
              fields[fieldName.trim()] = fieldValue.trim();
              console.log(`${fieldName.trim()}: ${fieldValue.trim()}`);
            }
          }
        }
      }
    }

    console.log('\n=== STRUCTURED DATA FOR DATABASE ===\n');

    // Try to map to our expected fields
    const extractedData = {
      customerName: findField(fields, ['name', 'customer name', 'ship to']),
      address: findField(fields, ['address', 'install address', 'street']),
      city: findField(fields, ['city']),
      state: findField(fields, ['state']),
      zip: findField(fields, ['zip', 'zip code']),
      email: findField(fields, ['email']),
      phone: findField(fields, ['phone', 'phone #', 'cell', 'cell #']),
      subtotal: findField(fields, ['subtotal']),
      downPayment: findField(fields, ['down payment', 'total down payment']),
      balanceDue: findField(fields, ['balance due']),
    };

    console.log(JSON.stringify(extractedData, null, 2));

    console.log('\n=== RAW FIELDS COUNT ===');
    console.log(`Total form fields found: ${Object.keys(fields).length}`);

  } catch (error) {
    console.error('Error:', error.message);
    if (error.message.includes('Permission')) {
      console.log('\n⚠️  You may need to enable the Document AI API or check permissions.');
      console.log('Visit: https://console.cloud.google.com/apis/library/documentai.googleapis.com?project=e-sign-27f9a');
    }
    if (error.message.includes('404')) {
      console.log('\n⚠️  Processor not found. Make sure you created the processor and the ID is correct.');
    }
  }
}

// Helper function to extract text from a text anchor
function getText(textAnchor, fullText) {
  if (!textAnchor || !textAnchor.textSegments || textAnchor.textSegments.length === 0) {
    return '';
  }

  let text = '';
  for (const segment of textAnchor.textSegments) {
    const startIndex = parseInt(segment.startIndex) || 0;
    const endIndex = parseInt(segment.endIndex) || 0;
    text += fullText.substring(startIndex, endIndex);
  }
  return text;
}

// Helper function to find a field by possible names
function findField(fields, possibleNames) {
  for (const [key, value] of Object.entries(fields)) {
    const keyLower = key.toLowerCase();
    for (const name of possibleNames) {
      if (keyLower.includes(name.toLowerCase())) {
        return value;
      }
    }
  }
  return null;
}

// Run the test
const pdfPath = process.argv[3] || '/Users/design/Desktop/test 2.pdf';
testDocumentAI(pdfPath);
