const axios = require('axios');
require('dotenv').config();

const DOCUMENT_ID = '8efc0b01b81e4ce9ad6d19d713c5697184046a86';

async function debugInvite() {
  const credentials = Buffer.from(
    process.env.SIGNNOW_API_KEY + ':' + process.env.SIGNNOW_API_SECRET
  ).toString('base64');

  const tokenResponse = await axios.post(
    'https://api.signnow.com/oauth2/token',
    new URLSearchParams({
      grant_type: 'password',
      username: process.env.SIGNNOW_USERNAME,
      password: process.env.SIGNNOW_PASSWORD,
      scope: '*',
    }),
    {
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Authorization: 'Basic ' + credentials,
      },
    }
  );

  const accessToken = tokenResponse.data.access_token;
  console.log('Got access token\n');

  // Get document details
  const docResponse = await axios.get(
    `https://api.signnow.com/document/${DOCUMENT_ID}`,
    {
      headers: { Authorization: 'Bearer ' + accessToken },
    }
  );

  const doc = docResponse.data;
  console.log('Document:', doc.document_name);
  console.log('Roles:', JSON.stringify(doc.roles, null, 2));
  console.log('Fields count:', doc.fields?.length);
  console.log('Field invites:', JSON.stringify(doc.field_invites, null, 2));

  // Try to send invite
  const signerRole = doc.roles?.[0];
  console.log('\n=== ATTEMPTING INVITE ===');

  if (signerRole) {
    console.log('Using role:', signerRole.name, 'ID:', signerRole.unique_id);

    const payload = {
      to: [{
        email: 'brandynwukowski@gmail.com',
        role_id: signerRole.unique_id,
        role: signerRole.name,
        order: 1,
      }],
      from: process.env.SIGNNOW_USERNAME,
    };

    console.log('Payload:', JSON.stringify(payload, null, 2));

    try {
      const response = await axios.post(
        `https://api.signnow.com/document/${DOCUMENT_ID}/invite`,
        payload,
        {
          headers: {
            Authorization: 'Bearer ' + accessToken,
            'Content-Type': 'application/json',
          },
        }
      );
      console.log('SUCCESS:', response.data);
    } catch (error) {
      console.log('FAILED:', error.response?.status);
      console.log('Error data:', JSON.stringify(error.response?.data, null, 2));
    }
  } else {
    console.log('No roles found, trying freeform invite');

    try {
      const response = await axios.post(
        `https://api.signnow.com/document/${DOCUMENT_ID}/invite`,
        {
          to: 'brandynwukowski@gmail.com',
          from: process.env.SIGNNOW_USERNAME,
        },
        {
          headers: {
            Authorization: 'Bearer ' + accessToken,
            'Content-Type': 'application/json',
          },
        }
      );
      console.log('SUCCESS:', response.data);
    } catch (error) {
      console.log('FAILED:', error.response?.status);
      console.log('Error data:', JSON.stringify(error.response?.data, null, 2));
    }
  }
}

debugInvite().catch(err => {
  console.error('Error:', err.response?.data || err.message);
});
