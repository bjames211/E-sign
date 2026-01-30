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
  customerName?: string | null;
  subtotal?: number | null;
  downPayment?: number | null;
  balanceDue?: number | null;
  preSignedPdfLink?: string;
  signedPdfLink?: string;
  // Deposit validation
  expectedDepositPercent?: number | null;
  expectedDepositAmount?: number | null;
  actualDepositPercent?: number | null;
  depositDiscrepancy?: boolean | null;
  depositDiscrepancyAmount?: number | null;
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
 * Add a new document to Google Sheets (when sent for signature)
 */
export async function addDocumentToSheet(data: SignedDocumentData): Promise<void> {
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
      '', // signedAt - empty until signed
      data.customerName || '',
      data.subtotal?.toString() || '',
      data.downPayment?.toString() || '',
      data.balanceDue?.toString() || '',
      data.preSignedPdfLink || '',
      '', // signedPdfLink - empty until signed
      data.expectedDepositPercent ? `${data.expectedDepositPercent}%` : '',
      data.expectedDepositAmount?.toString() || '',
      data.actualDepositPercent ? `${data.actualDepositPercent}%` : '',
      data.depositDiscrepancy ? '⚠️ YES' : (data.expectedDepositAmount ? 'OK' : ''),
      data.depositDiscrepancyAmount?.toString() || '',
    ];

    await sheets.spreadsheets.values.append({
      spreadsheetId,
      range: 'Sheet1!A:S',
      valueInputOption: 'USER_ENTERED',
      requestBody: {
        values: [row],
      },
    });

    console.log('Document added to Google Sheets (sent)');
  } catch (error) {
    console.error('Failed to add document to Google Sheets:', error);
  }
}

/**
 * Update existing row when document is signed
 */
export async function updateSheetOnSigned(
  orderNumber: string,
  signedAt: Date,
  signedPdfLink: string
): Promise<void> {
  const spreadsheetId = process.env.GOOGLE_SHEET_ID;

  if (!spreadsheetId) {
    console.log('GOOGLE_SHEET_ID not configured, skipping sheets update');
    return;
  }

  try {
    const auth = await getAuthClient();
    const sheets = google.sheets({ version: 'v4', auth });

    // Find the row with this order number
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: 'Sheet1!A:A',
    });

    const rows = response.data.values || [];
    let rowIndex = -1;

    for (let i = 0; i < rows.length; i++) {
      if (rows[i][0] === orderNumber) {
        rowIndex = i + 1; // Sheets is 1-indexed
        break;
      }
    }

    if (rowIndex === -1) {
      console.log('Order not found in sheet, cannot update:', orderNumber);
      return;
    }

    // Update signed date (column H) and signed PDF link (column N)
    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range: `Sheet1!H${rowIndex}`,
      valueInputOption: 'USER_ENTERED',
      requestBody: {
        values: [[signedAt.toISOString()]],
      },
    });

    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range: `Sheet1!N${rowIndex}`,
      valueInputOption: 'USER_ENTERED',
      requestBody: {
        values: [[signedPdfLink]],
      },
    });

    console.log('Document updated in Google Sheets (signed)');
  } catch (error) {
    console.error('Failed to update Google Sheets:', error);
  }
}

/**
 * Append a signed document record to Google Sheets (legacy - for new signs without prior entry)
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
      data.preSignedPdfLink || '',
      data.signedPdfLink || '',
      data.expectedDepositPercent ? `${data.expectedDepositPercent}%` : '',
      data.expectedDepositAmount?.toString() || '',
      data.actualDepositPercent ? `${data.actualDepositPercent}%` : '',
      data.depositDiscrepancy ? '⚠️ YES' : 'OK',
      data.depositDiscrepancyAmount?.toString() || '',
    ];

    await sheets.spreadsheets.values.append({
      spreadsheetId,
      range: 'Sheet1!A:S',
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
