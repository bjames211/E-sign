import axios from 'axios';
import { getTemplateId } from './manufacturerConfigService';

const SIGNNOW_API_BASE = 'https://api.signnow.com';

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
export async function getAccessToken(): Promise<string> {
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
  console.log(`Template has ${templateFields.length} total fields`);

  if (templateFields.length === 0) {
    console.log('No fields in template');
    return;
  }

  // Only copy signature-related fields — skip text and checkbox fields
  // that correspond to the form data already filled in on the PDF
  const ALLOWED_FIELD_TYPES = ['signature', 'initials', 'date_signed'];
  const ALLOWED_LABELS = ['email', 'e-mail', 'email address', 'e-mail address'];

  const filteredFields = templateFields.filter((field: any) => {
    const type = (field.type || '').toLowerCase();
    const label = ((field.json_attributes?.label) || '').toLowerCase();

    // Always include signature, initials, and date fields
    if (ALLOWED_FIELD_TYPES.includes(type)) return true;

    // Include text fields only if they're for email address
    if (type === 'text' && ALLOWED_LABELS.some(l => label.includes(l))) return true;

    return false;
  });

  console.log(`Filtered to ${filteredFields.length} signature-related fields (excluded ${templateFields.length - filteredFields.length} text/checkbox fields)`);

  // Copy fields from template to new document
  // SignNow stores field coordinates inside json_attributes
  const fieldsToAdd = filteredFields.map((field: any) => {
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

  // Look up template ID for this installer from Firestore config
  const templateId = await getTemplateId(request.installer);
  if (!templateId) {
    throw new Error(`No SignNow template configured for installer: ${request.installer}. Please configure it in Admin > Manufacturer Templates.`);
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

/**
 * Cancel a signing invite in SignNow
 * This prevents the signer from completing the signature
 * Handles both freeform invites and field invites
 */
export async function cancelSigningInvite(
  signNowDocumentId: string
): Promise<{ success: boolean; message: string }> {
  try {
    const accessToken = await getAccessToken();

    // First, get the document to find all invites
    const docResponse = await axios.get(
      `${SIGNNOW_API_BASE}/document/${signNowDocumentId}`,
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      }
    );

    const fieldInvites = docResponse.data.field_invites || [];
    const freeformInvites = docResponse.data.requests || []; // Freeform invites are in 'requests'

    let cancelledCount = 0;

    // Cancel field invites
    for (const invite of fieldInvites) {
      if (invite.status === 'pending') {
        try {
          await axios.delete(
            `${SIGNNOW_API_BASE}/document/${signNowDocumentId}/fieldinvite/${invite.id}`,
            {
              headers: {
                Authorization: `Bearer ${accessToken}`,
              },
            }
          );
          console.log(`Cancelled field invite ${invite.id} for document ${signNowDocumentId}`);
          cancelledCount++;
        } catch (err: any) {
          console.warn(`Failed to cancel field invite ${invite.id}:`, err.response?.data || err.message);
        }
      }
    }

    // Cancel freeform invites (signing requests)
    for (const invite of freeformInvites) {
      if (invite.status === 'pending' || !invite.status) {
        try {
          await axios.delete(
            `${SIGNNOW_API_BASE}/document/${signNowDocumentId}/invite/${invite.id}`,
            {
              headers: {
                Authorization: `Bearer ${accessToken}`,
              },
            }
          );
          console.log(`Cancelled freeform invite ${invite.id} for document ${signNowDocumentId}`);
          cancelledCount++;
        } catch (err: any) {
          console.warn(`Failed to cancel freeform invite ${invite.id}:`, err.response?.data || err.message);
        }
      }
    }

    // Also try to cancel via the cancel-invite endpoint (covers all invite types)
    try {
      await axios.put(
        `${SIGNNOW_API_BASE}/document/${signNowDocumentId}/fieldinvitecancel`,
        {},
        {
          headers: {
            Authorization: `Bearer ${accessToken}`,
          },
        }
      );
      console.log(`Cancelled all field invites via bulk cancel for document ${signNowDocumentId}`);
    } catch (bulkCancelErr: any) {
      // This endpoint might not exist or might fail - that's ok
      console.log('Bulk cancel attempt:', bulkCancelErr.response?.status || 'failed');
    }

    if (cancelledCount === 0 && fieldInvites.length === 0 && freeformInvites.length === 0) {
      return { success: false, message: 'No signing invites found for this document' };
    }

    return { success: true, message: `Cancelled ${cancelledCount} signing invite(s) successfully` };
  } catch (error: any) {
    console.error('Failed to cancel signing invite:', error.response?.data || error.message);
    return {
      success: false,
      message: error.response?.data?.message || error.message || 'Failed to cancel signing invite'
    };
  }
}

/**
 * Download a signed document from SignNow
 */
export async function downloadSignedDocument(
  signNowDocumentId: string
): Promise<Buffer | null> {
  try {
    const accessToken = await getAccessToken();

    const response = await axios.get(
      `${SIGNNOW_API_BASE}/document/${signNowDocumentId}/download?type=collapsed`,
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
        responseType: 'arraybuffer',
      }
    );

    console.log('Downloaded signed document from SignNow');
    return Buffer.from(response.data);
  } catch (error: any) {
    console.error('Failed to download signed document:', error.response?.status);
    return null;
  }
}

/**
 * Resend a signing invite reminder via SignNow
 * This sends another email to the signer for an existing document
 */
export async function resendSigningInvite(
  signNowDocumentId: string
): Promise<{ success: boolean; message: string }> {
  try {
    const accessToken = await getAccessToken();

    // Get the document to find the invite ID
    const docResponse = await axios.get(
      `${SIGNNOW_API_BASE}/document/${signNowDocumentId}`,
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      }
    );

    const fieldInvites = docResponse.data.field_invites || [];

    if (fieldInvites.length === 0) {
      return {
        success: false,
        message: 'No invites found for this document',
      };
    }

    // Resend each pending invite
    let resendCount = 0;
    for (const invite of fieldInvites) {
      if (invite.status === 'pending') {
        try {
          // SignNow API to resend invite reminder
          await axios.post(
            `${SIGNNOW_API_BASE}/document/${signNowDocumentId}/invite/${invite.id}/reminder`,
            {},
            {
              headers: {
                Authorization: `Bearer ${accessToken}`,
                'Content-Type': 'application/json',
              },
            }
          );
          resendCount++;
          console.log(`Resent invite reminder: ${invite.id}`);
        } catch (inviteError: any) {
          console.warn(`Failed to resend invite ${invite.id}:`, inviteError.response?.data || inviteError.message);
        }
      }
    }

    if (resendCount === 0) {
      return {
        success: false,
        message: 'No pending invites to resend',
      };
    }

    return {
      success: true,
      message: `Resent ${resendCount} signature invite reminder(s)`,
    };
  } catch (error: any) {
    console.error('Failed to resend signing invite:', error.response?.data || error.message);
    return {
      success: false,
      message: error.response?.data?.message || error.message || 'Failed to resend signing invite',
    };
  }
}

/**
 * Send a custom reminder email (using SignNow's notification system)
 */
export async function sendSignatureReminder(
  signNowDocumentId: string,
  customMessage?: string
): Promise<{ success: boolean; message: string }> {
  try {
    const accessToken = await getAccessToken();

    // Get the document details
    const docResponse = await axios.get(
      `${SIGNNOW_API_BASE}/document/${signNowDocumentId}`,
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      }
    );

    const fieldInvites = docResponse.data.field_invites || [];

    if (fieldInvites.length === 0) {
      return {
        success: false,
        message: 'No invites found for this document',
      };
    }

    // Find pending invites and send reminders
    let reminderCount = 0;
    for (const invite of fieldInvites) {
      if (invite.status === 'pending' && invite.email) {
        try {
          // Use SignNow's notification/reminder API
          await axios.post(
            `${SIGNNOW_API_BASE}/document/${signNowDocumentId}/remind`,
            {
              email: invite.email,
              subject: 'Reminder: Document awaiting your signature',
              message: customMessage || 'This is a friendly reminder that you have a document waiting for your signature. Please sign at your earliest convenience.',
            },
            {
              headers: {
                Authorization: `Bearer ${accessToken}`,
                'Content-Type': 'application/json',
              },
            }
          );
          reminderCount++;
          console.log(`Sent reminder to: ${invite.email}`);
        } catch (reminderError: any) {
          console.warn(`Failed to send reminder to ${invite.email}:`, reminderError.response?.data || reminderError.message);
        }
      }
    }

    if (reminderCount === 0) {
      return {
        success: false,
        message: 'No pending invites to send reminders to',
      };
    }

    return {
      success: true,
      message: `Sent reminder to ${reminderCount} recipient(s)`,
    };
  } catch (error: any) {
    console.error('Failed to send reminder:', error.response?.data || error.message);
    return {
      success: false,
      message: error.response?.data?.message || error.message || 'Failed to send reminder',
    };
  }
}
