import Anthropic from '@anthropic-ai/sdk';

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
  rawResponse: string;
  extractedAt: Date;
}

/**
 * Convert PDF buffer to base64 images using pdf-to-img or similar
 * For now, we'll send the PDF directly as Claude can handle PDFs
 */
export async function extractDataFromPdf(
  pdfBuffer: Buffer,
  installer: string
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
  "downPayment": numeric value (no $ sign),
  "balanceDue": numeric value (no $ sign)
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

    const extractedData: ExtractedPdfData = {
      customerName: parsed.customerName || null,
      address: parsed.address || null,
      city: parsed.city || null,
      state: parsed.state || null,
      zip: parsed.zip || null,
      email: parsed.email || null,
      phone: parsed.phone || null,
      subtotal: parsed.subtotal ? Number(parsed.subtotal) : null,
      downPayment: parsed.downPayment ? Number(parsed.downPayment) : null,
      balanceDue: parsed.balanceDue ? Number(parsed.balanceDue) : null,
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
