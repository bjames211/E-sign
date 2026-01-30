import { google } from 'googleapis';

const SCOPES = [
  'https://www.googleapis.com/auth/drive.file',
  'https://www.googleapis.com/auth/spreadsheets'
];

let mainFolderId: string | null = null;

async function getAuthClient() {
  const credentials = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_KEY || '{}');
  const auth = new google.auth.GoogleAuth({
    credentials,
    scopes: SCOPES,
  });
  return auth;
}

async function getOrCreateFolder(drive: any, folderName: string, parentId?: string): Promise<string> {
  console.log('getOrCreateFolder:', folderName, 'parent:', parentId);
  // Clean folder name (remove invalid characters)
  const cleanName = folderName.replace(/[<>:"/\\|?*]/g, '_').trim() || 'Unknown';
  console.log('Clean folder name:', cleanName);

  // Search for existing folder
  const query = parentId
    ? `name='${cleanName}' and mimeType='application/vnd.google-apps.folder' and '${parentId}' in parents and trashed=false`
    : `name='${cleanName}' and mimeType='application/vnd.google-apps.folder' and trashed=false`;

  console.log('Searching for folder with query...');
  const response = await drive.files.list({
    q: query,
    fields: 'files(id, name)',
  });
  console.log('Search result:', response.data.files?.length, 'files found');

  if (response.data.files && response.data.files.length > 0) {
    return response.data.files[0].id;
  }

  // Create folder
  const fileMetadata: any = {
    name: cleanName,
    mimeType: 'application/vnd.google-apps.folder',
  };
  if (parentId) {
    fileMetadata.parents = [parentId];
  }

  const folder = await drive.files.create({
    requestBody: fileMetadata,
    fields: 'id',
  });

  // Share folder with user (only for main folder)
  if (!parentId) {
    try {
      await drive.permissions.create({
        fileId: folder.data.id,
        requestBody: {
          role: 'writer',
          type: 'user',
          emailAddress: 'brandyn@bigbuildingsdirect.com',
        },
      });
    } catch (e) {
      console.log('Could not share folder:', e);
    }
  }

  return folder.data.id;
}

async function getMainFolder(drive: any): Promise<string> {
  if (mainFolderId) return mainFolderId;
  mainFolderId = await getOrCreateFolder(drive, 'E-Sign Documents');
  return mainFolderId;
}

async function getCustomerFolder(drive: any, customerName: string): Promise<string> {
  const mainFolder = await getMainFolder(drive);
  const folderName = customerName || 'Unknown Customer';
  return await getOrCreateFolder(drive, folderName, mainFolder);
}

/**
 * Upload pre-signed PDF to Google Drive (in customer folder)
 */
export async function uploadPreSignedPdf(
  pdfBuffer: Buffer,
  fileName: string,
  orderNumber: string,
  customerName?: string
): Promise<string> {
  console.log('>>> uploadPreSignedPdf called <<<');
  console.log('File:', fileName, 'Order:', orderNumber, 'Customer:', customerName);
  try {
    const auth = await getAuthClient();
    console.log('Drive auth obtained');
    const drive = google.drive({ version: 'v3', auth });

    console.log('Getting customer folder...');
    const customerFolderId = await getCustomerFolder(drive, customerName || 'Unknown Customer');
    console.log('Customer folder ID:', customerFolderId);

    const fileMetadata = {
      name: `${orderNumber}_${fileName}`,
      parents: [customerFolderId],
    };

    const media = {
      mimeType: 'application/pdf',
      body: require('stream').Readable.from(pdfBuffer),
    };

    const response = await drive.files.create({
      requestBody: fileMetadata,
      media: media,
      fields: 'id, webViewLink',
    });

    console.log('Pre-signed PDF uploaded to Drive:', response.data.id);
    return response.data.webViewLink || `https://drive.google.com/file/d/${response.data.id}/view`;
  } catch (error: any) {
    console.error('!!! DRIVE UPLOAD FAILED !!!');
    console.error('Error message:', error?.message);
    console.error('Error code:', error?.code);
    console.error('Full error:', JSON.stringify(error, null, 2));
    return '';
  }
}

/**
 * Upload signed PDF to Google Drive (in customer folder)
 */
export async function uploadSignedPdf(
  pdfBuffer: Buffer,
  fileName: string,
  orderNumber: string,
  customerName?: string
): Promise<string> {
  try {
    const auth = await getAuthClient();
    const drive = google.drive({ version: 'v3', auth });

    const customerFolderId = await getCustomerFolder(drive, customerName || 'Unknown Customer');

    const fileMetadata = {
      name: `${orderNumber}_${fileName}_SIGNED`,
      parents: [customerFolderId],
    };

    const media = {
      mimeType: 'application/pdf',
      body: require('stream').Readable.from(pdfBuffer),
    };

    const response = await drive.files.create({
      requestBody: fileMetadata,
      media: media,
      fields: 'id, webViewLink',
    });

    console.log('Signed PDF uploaded to Drive:', response.data.id);
    return response.data.webViewLink || `https://drive.google.com/file/d/${response.data.id}/view`;
  } catch (error) {
    console.error('Failed to upload signed PDF to Drive:', error);
    return '';
  }
}
