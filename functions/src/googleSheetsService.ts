import { google } from 'googleapis';

const SCOPES = ['https://www.googleapis.com/auth/spreadsheets'];

interface SignedDocumentData {
  orderNumber: string;
  fileName: string;
  signerName: string;
  signerEmail: string;
  installer: string;
  signNowDocumentId: string;
  createdAt: Date;
  signedAt: Date;
  customerName?: string;
  subtotal?: number;
  downPayment?: number;
  balanceDue?: number;
}

/**
 * Get authenticated Google Sheets client using service account
 */
async function getAuthClient() {
  const credentials = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_KEY || '{}');

  const auth = new google.auth.GoogleAuth({
    credentials,
    scopes: SCOPES,
  });

  return auth;
}

/**
 * Append a signed document record to Google Sheets
 */
export async function appendToSheet(data: SignedDocumentData): Promise<void> {
  const spreadsheetId = process.env.GOOGLE_SHEET_ID;

  if (!spreadsheetId) {
    console.log('GOOGLE_SHEET_ID not configured, skipping sheets backup');
    return;
  }

  try {
    const auth = await getAuthClient();
    const sheets = google.sheets({ version: 'v4', auth });

    const row = [
      data.orderNumber || '',
      data.fileName || '',
      data.signerName || '',
      data.signerEmail || '',
      data.installer || '',
      data.signNowDocumentId || '',
      data.createdAt ? data.createdAt.toISOString() : '',
      data.signedAt ? data.signedAt.toISOString() : '',
      data.customerName || '',
      data.subtotal?.toString() || '',
      data.downPayment?.toString() || '',
      data.balanceDue?.toString() || '',
    ];

    await sheets.spreadsheets.values.append({
      spreadsheetId,
      range: 'Sheet1!A:L',
      valueInputOption: 'USER_ENTERED',
      requestBody: {
        values: [row],
      },
    });

    console.log('Document logged to Google Sheets');
  } catch (error) {
    console.error('Failed to log to Google Sheets:', error);
    // Don't throw - sheets backup failure shouldn't break main flow
  }
}
