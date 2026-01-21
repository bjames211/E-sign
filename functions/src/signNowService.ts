import axios from 'axios';

const SIGNNOW_API_BASE = 'https://api.signnow.com';

// Template IDs for each installer's order form
const INSTALLER_TEMPLATES: Record<string, string> = {
  'Eagle Carports': 'c16f3961f66f4348bf7c6bd9ece33735040b0b95',
  'American Carports': '2e11d4ae2dd94a17a75cbe75c565763765844c85',
};

interface SignatureRequest {
  pdfBuffer: Buffer;
  fileName: string;
  signerEmail: string;
  signerName: string;
  installer: string;
}

interface SignatureResult {
  documentId: string;
  inviteId: string;
}

/**
 * Get OAuth access token from SignNow
 */
async function getAccessToken(): Promise<string> {
  const response = await axios.post(
    `${SIGNNOW_API_BASE}/oauth2/token`,
    new URLSearchParams({
      grant_type: 'password',
      username: process.env.SIGNNOW_USERNAME!,
      password: process.env.SIGNNOW_PASSWORD!,
      scope: '*',
    }),
    {
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Authorization: `Basic ${Buffer.from(
          `${process.env.SIGNNOW_API_KEY}:${process.env.SIGNNOW_API_SECRET}`
        ).toString('base64')}`,
      },
    }
  );

  return response.data.access_token;
}

/**
 * Upload document to SignNow
 */
async function uploadDocument(
  accessToken: string,
  pdfBuffer: Buffer,
  fileName: string
): Promise<string> {
  console.log('Uploading PDF to SignNow...');

  const FormData = (await import('form-data')).default;
  const formData = new FormData();
  formData.append('file', pdfBuffer, {
    filename: fileName,
    contentType: 'application/pdf',
  });

  const response = await axios.post(
    `${SIGNNOW_API_BASE}/document`,
    formData,
    {
      headers: {
        ...formData.getHeaders(),
        Authorization: `Bearer ${accessToken}`,
      },
    }
  );

  console.log('Document uploaded:', response.data.id);
  return response.data.id;
}

/**
 * Get fields from template and apply them to the new document
 */
async function copyFieldsFromTemplate(
  accessToken: string,
  documentId: string,
  templateId: string
): Promise<void> {
  console.log('Getting fields from template:', templateId);

  // Get the template to see its fields
  const templateResponse = await axios.get(
    `${SIGNNOW_API_BASE}/document/${templateId}`,
    {
      headers: { Authorization: `Bearer ${accessToken}` },
    }
  );

  const templateFields = templateResponse.data.fields || [];
  console.log(`Template has ${templateFields.length} fields`);

  if (templateFields.length === 0) {
    console.log('No fields in template');
    return;
  }

  // Copy fields from template to new document
  // SignNow stores field coordinates inside json_attributes
  const fieldsToAdd = templateFields.map((field: any) => {
    const attrs = field.json_attributes || {};
    return {
      type: field.type,
      x: attrs.x,
      y: attrs.y,
      width: attrs.width,
      height: attrs.height,
      page_number: attrs.page_number,
      role: field.role || 'Signer 1',
      required: attrs.required !== false,
      label: attrs.label,
    };
  });

  console.log('Copying fields to new document:', JSON.stringify(fieldsToAdd, null, 2));

  try {
    await axios.put(
      `${SIGNNOW_API_BASE}/document/${documentId}`,
      { fields: fieldsToAdd },
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
      }
    );
    console.log('Fields copied successfully');
  } catch (error: any) {
    console.error('Error copying fields:', error.response?.status);
    console.error('Error details:', JSON.stringify(error.response?.data, null, 2));
    throw error;
  }
}

const WEBHOOK_URL = 'https://us-central1-e-sign-27f9a.cloudfunctions.net/signNowWebhook';

/**
 * Register webhook for document completion
 */
async function registerDocumentWebhook(
  accessToken: string,
  documentId: string
): Promise<void> {
  console.log('Registering webhook for document:', documentId);

  try {
    await axios.post(
      `${SIGNNOW_API_BASE}/api/v2/events`,
      {
        event: 'document.complete',
        entity_id: documentId,
        action: 'callback',
        attributes: {
          callback: WEBHOOK_URL,
        },
      },
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
      }
    );
    console.log('Webhook registered successfully');
  } catch (error: any) {
    console.error('Webhook registration failed:', error.response?.status);
    console.error('Details:', JSON.stringify(error.response?.data, null, 2));
    // Don't throw - webhook failure shouldn't stop the signing process
  }
}

/**
 * Send signing invitation
 */
async function sendInvite(
  accessToken: string,
  documentId: string,
  signerEmail: string,
  signerName: string
): Promise<string> {
  // Get document to find the role
  const docResponse = await axios.get(
    `${SIGNNOW_API_BASE}/document/${documentId}`,
    {
      headers: { Authorization: `Bearer ${accessToken}` },
    }
  );

  const doc = docResponse.data;
  console.log('Document has', doc.roles?.length || 0, 'roles');
  console.log('Document has', doc.fields?.length || 0, 'fields');

  // Find signer role
  const signerRole = doc.roles?.[0];

  if (signerRole) {
    console.log('Sending role-based invite, role:', signerRole.name);

    const payload = {
      to: [{
        email: signerEmail,
        role_id: signerRole.unique_id,
        role: signerRole.name,
        order: 1,
      }],
      from: process.env.SIGNNOW_USERNAME,
    };

    try {
      const response = await axios.post(
        `${SIGNNOW_API_BASE}/document/${documentId}/invite`,
        payload,
        {
          headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
          },
        }
      );
      console.log('Invite sent successfully');
      return response.data.id || 'sent';
    } catch (error: any) {
      console.error('Role invite failed:', error.response?.status);
      console.error('Error:', JSON.stringify(error.response?.data, null, 2));
    }
  }

  // Freeform invite fallback
  console.log('Sending freeform invite');
  const response = await axios.post(
    `${SIGNNOW_API_BASE}/document/${documentId}/invite`,
    {
      to: signerEmail,
      from: process.env.SIGNNOW_USERNAME,
    },
    {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
    }
  );

  return response.data.id || 'sent';
}

/**
 * Main function to send a document for signature
 * Uploads the user's PDF, copies field positions from template, sends invite
 */
export async function sendForSignature(
  request: SignatureRequest
): Promise<SignatureResult> {
  console.log('\n========================================');
  console.log('E-SIGNATURE AUTOMATION');
  console.log('File:', request.fileName);
  console.log('Installer:', request.installer);
  console.log('To:', request.signerEmail);
  console.log('========================================\n');

  // Look up template ID for this installer
  const templateId = INSTALLER_TEMPLATES[request.installer];
  if (!templateId) {
    throw new Error(`No template configured for installer: ${request.installer}`);
  }
  console.log('Using template:', templateId);

  // Get access token
  const accessToken = await getAccessToken();
  console.log('Got access token');

  // Upload the user's PDF
  const documentId = await uploadDocument(
    accessToken,
    request.pdfBuffer,
    request.fileName
  );

  // Copy field positions from template to this document
  await copyFieldsFromTemplate(accessToken, documentId, templateId);

  // Send invite
  const inviteId = await sendInvite(
    accessToken,
    documentId,
    request.signerEmail,
    request.signerName
  );

  // Register webhook for document completion
  await registerDocumentWebhook(accessToken, documentId);

  console.log('\n========================================');
  console.log('SUCCESS!');
  console.log('Document:', documentId);
  console.log('Invite:', inviteId);
  console.log('========================================\n');

  return { documentId, inviteId };
}
