import Anthropic from '@anthropic-ai/sdk';
import { getDepositPercent } from './manufacturerConfigService';

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

export interface ExtractedPdfData {
  customerName: string | null;
  address: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
  email: string | null;
  phone: string | null;
  subtotal: number | null;
  downPayment: number | null;
  balanceDue: number | null;
  // SKU matching fields
  manufacturerSku: string | null;
  expectedSku: string | null;
  skuMismatch: boolean;
  // Deposit validation fields
  expectedDepositPercent: number | null;
  expectedDepositAmount: number | null;
  actualDepositPercent: number | null;
  depositDiscrepancy: boolean;
  depositDiscrepancyAmount: number | null;
  rawResponse: string;
  extractedAt: Date;
}

/**
 * Convert PDF buffer to base64 images using pdf-to-img or similar
 * For now, we'll send the PDF directly as Claude can handle PDFs
 */
export async function extractDataFromPdf(
  pdfBuffer: Buffer,
  installer: string,
  expectedSku?: string | null
): Promise<ExtractedPdfData> {
  console.log('Extracting data from PDF using Claude Vision...');
  console.log('Installer:', installer);

  // Convert PDF to base64
  const pdfBase64 = pdfBuffer.toString('base64');

  try {
    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 1024,
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'document',
              source: {
                type: 'base64',
                media_type: 'application/pdf',
                data: pdfBase64,
              },
            },
            {
              type: 'text',
              text: `Extract the following information from this ${installer} order form PDF. Return ONLY a valid JSON object with these exact keys (use null for any field you cannot find):

{
  "customerName": "full name of customer",
  "address": "street address",
  "city": "city name",
  "state": "state abbreviation",
  "zip": "zip code",
  "email": "email address",
  "phone": "phone number",
  "subtotal": numeric value (no $ sign),
  "downPayment": numeric value (no $ sign) - NOTE: For American Carports, this may be labeled "Origination Fee" instead of "Down Payment" or "Deposit",
  "balanceDue": numeric value (no $ sign),
  "formId": "any form identifier, SKU, form number, version number, or document code printed on the form (look in headers, footers, corners, watermarks). Examples: 'EC-2024', 'Form 100', 'v2.3', 'REV-A'. Return null if none found."
}

Return ONLY the JSON, no other text.`,
            },
          ],
        },
      ],
    });

    // Extract the text response
    const textContent = response.content.find((c) => c.type === 'text');
    const rawResponse = textContent?.type === 'text' ? textContent.text : '';

    console.log('Claude raw response:', rawResponse);

    // Parse the JSON response
    let parsed;
    try {
      // Try to extract JSON from the response (in case there's extra text)
      const jsonMatch = rawResponse.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        parsed = JSON.parse(jsonMatch[0]);
      } else {
        throw new Error('No JSON found in response');
      }
    } catch (parseError) {
      console.error('Failed to parse Claude response:', parseError);
      parsed = {};
    }

    const subtotal = parsed.subtotal ? Number(parsed.subtotal) : null;
    const downPayment = parsed.downPayment ? Number(parsed.downPayment) : null;

    // SKU matching
    const extractedSku: string | null = parsed.formId || null;
    const skuMismatch = !!(expectedSku && extractedSku &&
      extractedSku.toLowerCase() !== expectedSku.toLowerCase());

    if (skuMismatch) {
      console.log(`WARNING: SKU MISMATCH for ${installer}:`);
      console.log(`   Expected SKU: ${expectedSku}`);
      console.log(`   Found on PDF: ${extractedSku}`);
    }

    // Calculate deposit validation (skip if no percent configured for this manufacturer)
    const expectedPercent = await getDepositPercent(installer, subtotal || 0);
    let expectedAmount: number | null = null;
    let actualPercent: number | null = null;
    let depositDiscrepancy = false;
    let discrepancyAmount: number | null = null;

    if (subtotal && expectedPercent != null) {
      expectedAmount = Math.round((subtotal * expectedPercent / 100) * 100) / 100;

      if (downPayment !== null) {
        actualPercent = Math.round((downPayment / subtotal * 100) * 100) / 100;

        // Flag if actual deposit differs from expected by more than $1
        const difference = Math.abs(downPayment - expectedAmount);
        if (difference > 1) {
          depositDiscrepancy = true;
          discrepancyAmount = Math.round((downPayment - expectedAmount) * 100) / 100;
          console.log(`WARNING: DEPOSIT DISCREPANCY for ${installer}:`);
          console.log(`   Expected: $${expectedAmount} (${expectedPercent}%)`);
          console.log(`   Actual: $${downPayment} (${actualPercent}%)`);
          console.log(`   Difference: $${discrepancyAmount}`);
        }
      }
    }

    const extractedData: ExtractedPdfData = {
      customerName: parsed.customerName || null,
      address: parsed.address || null,
      city: parsed.city || null,
      state: parsed.state || null,
      zip: parsed.zip || null,
      email: parsed.email || null,
      phone: parsed.phone || null,
      subtotal,
      downPayment,
      balanceDue: parsed.balanceDue ? Number(parsed.balanceDue) : null,
      manufacturerSku: extractedSku,
      expectedSku: expectedSku || null,
      skuMismatch,
      expectedDepositPercent: expectedPercent,
      expectedDepositAmount: expectedAmount,
      actualDepositPercent: actualPercent,
      depositDiscrepancy,
      depositDiscrepancyAmount: discrepancyAmount,
      rawResponse,
      extractedAt: new Date(),
    };

    console.log('Extracted data:', JSON.stringify(extractedData, null, 2));

    return extractedData;
  } catch (error) {
    console.error('Error extracting data from PDF:', error);
    throw error;
  }
}
