import { PDFDocument, rgb, StandardFonts } from 'pdf-lib';

interface TagPosition {
  page: number;  // 0-indexed
  x: number;
  y: number;     // from bottom of page
  tag: string;
}

/**
 * Inject SignNow text tags into a PDF at specified positions
 * Tags like {{sig1}}, {{date1}} will be automatically detected by SignNow
 */
export async function injectTextTags(
  pdfBuffer: Buffer,
  tagPositions: TagPosition[]
): Promise<Buffer> {
  // Load the PDF
  const pdfDoc = await PDFDocument.load(pdfBuffer);
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);

  // Add tags at each position
  for (const pos of tagPositions) {
    const page = pdfDoc.getPage(pos.page);

    // Draw the tag text - must be readable for pdf2json to extract
    page.drawText(pos.tag, {
      x: pos.x,
      y: pos.y,
      size: 6,  // Small but extractable by pdf2json
      font: font,
      color: rgb(0.85, 0.85, 0.85),  // Light gray - visible but subtle
    });

    console.log(`Injected tag "${pos.tag}" on page ${pos.page + 1} at (${pos.x}, ${pos.y})`);
  }

  // Save and return the modified PDF
  const modifiedPdf = await pdfDoc.save();
  return Buffer.from(modifiedPdf);
}

/**
 * Add signature and date tags to Eagle Carports forms
 * Returns PDF with {{sig1}}, {{sig2}}, etc. tags injected
 */
export async function addSignatureTagsToEagleCarportsPdf(
  pdfBuffer: Buffer
): Promise<Buffer> {
  // Fixed positions for Eagle Carports Order Form
  // Coordinates are from BOTTOM-LEFT in pdf-lib (opposite of SignNow)
  // Letter size: 612 x 792 points

  // SignNow text tag format: {{tag_name/role/options}}
  // - signature: {{s_signer1}} or {{signature_signer1}}
  // - date: {{d_signer1}} or {{date_signer1}}
  // pdf-lib uses bottom-left origin
  const tagPositions: TagPosition[] = [
    // Page 1 - First signature line
    { page: 0, x: 265, y: 207, tag: '{{s_signer1}}' },
    { page: 0, x: 570, y: 207, tag: '{{d_signer1}}' },

    // Page 1 - Second signature line
    { page: 0, x: 265, y: 152, tag: '{{s2_signer1}}' },
    { page: 0, x: 570, y: 152, tag: '{{d2_signer1}}' },

    // Page 2 - Signature at bottom right
    { page: 1, x: 400, y: 72, tag: '{{s3_signer1}}' },
    { page: 1, x: 400, y: 37, tag: '{{d3_signer1}}' },

    // Page 3 - Signature at bottom
    { page: 2, x: 345, y: 72, tag: '{{s4_signer1}}' },
    { page: 2, x: 520, y: 72, tag: '{{d4_signer1}}' },
  ];

  console.log(`Injecting ${tagPositions.length} text tags into PDF...`);

  return await injectTextTags(pdfBuffer, tagPositions);
}
