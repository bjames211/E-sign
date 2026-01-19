import PDFParser from 'pdf2json';

interface TextPosition {
  text: string;
  x: number;
  y: number;
  width: number;
  pageNumber: number;
}

interface FieldPlacement {
  type: 'signature' | 'text';
  x: number;
  y: number;
  width: number;
  height: number;
  pageNumber: number;
  role: string;
  required: boolean;
  label?: string;
}

/**
 * Parse PDF and find text positions using pdf2json
 */
function parsePdfBuffer(pdfBuffer: Buffer): Promise<any> {
  return new Promise((resolve, reject) => {
    const pdfParser = new PDFParser();

    pdfParser.on('pdfParser_dataReady', (pdfData: any) => {
      resolve(pdfData);
    });

    pdfParser.on('pdfParser_dataError', (errData: any) => {
      reject(errData);
    });

    pdfParser.parseBuffer(pdfBuffer);
  });
}

/**
 * Find text matching search patterns and return positions
 */
async function findTextPositions(
  pdfBuffer: Buffer,
  searchPatterns: string[]
): Promise<TextPosition[]> {
  const positions: TextPosition[] = [];

  try {
    const pdfData = await parsePdfBuffer(pdfBuffer);

    // pdf2json uses its own coordinate system
    // Need to get page dimensions to understand the scale
    const pageWidth = pdfData.Pages[0]?.Width || 612;
    const pageHeight = pdfData.Pages[0]?.Height || 792;

    console.log(`PDF page size: ${pageWidth} x ${pageHeight}`);

    // Process each page
    for (let pageIndex = 0; pageIndex < pdfData.Pages.length; pageIndex++) {
      const page = pdfData.Pages[pageIndex];

      // pdf2json coordinates are already in the right scale for SignNow
      // Just need to use them directly

      // Get all text items on this page
      for (const textItem of page.Texts || []) {
        // Decode the text (pdf2json encodes text)
        const text = decodeURIComponent(textItem.R?.[0]?.T || '');

        // Check if text matches any search pattern
        for (const pattern of searchPatterns) {
          if (text.toLowerCase().includes(pattern.toLowerCase())) {
            // pdf2json x,y are direct coordinates
            // Multiply by the page scale factor
            const x = textItem.x;
            const y = textItem.y;
            const w = textItem.w || 50;

            positions.push({
              text: text,
              x: x,
              y: y,
              width: w,
              pageNumber: pageIndex,
            });

            console.log(`Found "${pattern}" on page ${pageIndex + 1}: "${text}" at raw x=${x.toFixed(2)}, y=${y.toFixed(2)}, w=${w.toFixed(2)}`);
          }
        }
      }
    }
  } catch (error) {
    console.error('Error parsing PDF:', error);
  }

  return positions;
}

/**
 * Find injected signature tags and return field placements
 * Searches for {{s_signer1}}, {{s2_signer1}}, {{d_signer1}}, {{d2_signer1}}, etc.
 */
export async function findInjectedTagPositions(
  pdfBuffer: Buffer
): Promise<FieldPlacement[]> {
  console.log('Parsing PDF to find injected tag positions...');

  const fields: FieldPlacement[] = [];

  // Search for our injected signature tags
  const sigPatterns = ['{{s_signer1}}', '{{s2_signer1}}', '{{s3_signer1}}', '{{s4_signer1}}'];
  const datePatterns = ['{{d_signer1}}', '{{d2_signer1}}', '{{d3_signer1}}', '{{d4_signer1}}'];

  const sigPositions = await findTextPositions(pdfBuffer, sigPatterns);
  const datePositions = await findTextPositions(pdfBuffer, datePatterns);

  console.log(`Found ${sigPositions.length} signature tag positions`);
  console.log(`Found ${datePositions.length} date tag positions`);

  // pdf2json returns coordinates in its own unit system
  // The scale factor converts pdf2json units to PDF points
  // pdf2json uses 96 DPI internally, PDF uses 72 DPI
  // Scale: pdf2json * (72/96) * some factor
  // Through testing: pdf2json coords * 4.5 ≈ PDF points
  const SCALE = 4.5;

  // Create signature fields at tag positions
  for (const pos of sigPositions) {
    const x = pos.x * SCALE;
    const y = pos.y * SCALE;

    console.log(`Signature tag "${pos.text}" on page ${pos.pageNumber + 1}: raw(${pos.x.toFixed(1)}, ${pos.y.toFixed(1)}) -> SignNow(${x.toFixed(0)}, ${y.toFixed(0)})`);

    fields.push({
      type: 'signature',
      x: x,
      y: y,
      width: 150,
      height: 20,
      pageNumber: pos.pageNumber,
      role: 'Signer 1',
      required: true,
    });
  }

  // Create date fields at tag positions
  for (const pos of datePositions) {
    const x = pos.x * SCALE;
    const y = pos.y * SCALE;

    console.log(`Date tag "${pos.text}" on page ${pos.pageNumber + 1}: raw(${pos.x.toFixed(1)}, ${pos.y.toFixed(1)}) -> SignNow(${x.toFixed(0)}, ${y.toFixed(0)})`);

    fields.push({
      type: 'text',
      x: x,
      y: y,
      width: 100,
      height: 20,
      pageNumber: pos.pageNumber,
      role: 'Signer 1',
      required: true,
      label: 'Date',
    });
  }

  console.log(`Generated ${fields.length} total field placements from tags`);

  return fields;
}

/**
 * Legacy function: Parse PDF and generate field placements for signature lines
 */
export async function findSignatureFieldPositions(
  pdfBuffer: Buffer
): Promise<FieldPlacement[]> {
  console.log('Parsing PDF to find signature field positions...');

  const fields: FieldPlacement[] = [];

  // Search for signature text patterns
  const signaturePatterns = ['customer signature', 'CUSTOMER SIGNATURE'];
  const signaturePositions = await findTextPositions(pdfBuffer, signaturePatterns);

  // Search for date text patterns
  const datePatterns = ['Date _', 'Date_', 'DATE:', 'DATE _'];
  const datePositions = await findTextPositions(pdfBuffer, datePatterns);

  console.log(`Found ${signaturePositions.length} signature positions`);
  console.log(`Found ${datePositions.length} date positions`);

  const SCALE = 4.5;

  for (const pos of signaturePositions) {
    const x = (pos.x * SCALE) + (pos.width * SCALE) + 10;
    const y = pos.y * SCALE;

    console.log(`Signature field: raw(${pos.x}, ${pos.y}) -> scaled(${x.toFixed(0)}, ${y.toFixed(0)})`);

    fields.push({
      type: 'signature',
      x: x,
      y: y,
      width: 150,
      height: 20,
      pageNumber: pos.pageNumber,
      role: 'Signer 1',
      required: true,
    });
  }

  for (const pos of datePositions) {
    const x = (pos.x * SCALE) + (pos.width * SCALE) + 10;
    const y = pos.y * SCALE;

    console.log(`Date field: raw(${pos.x}, ${pos.y}) -> scaled(${x.toFixed(0)}, ${y.toFixed(0)})`);

    fields.push({
      type: 'text',
      x: x,
      y: y,
      width: 100,
      height: 20,
      pageNumber: pos.pageNumber,
      role: 'Signer 1',
      required: true,
      label: 'Date',
    });
  }

  console.log(`Generated ${fields.length} total field placements`);

  return fields;
}
