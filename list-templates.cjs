const axios = require('axios');
require('dotenv').config({ path: './functions/.env' });

async function listTemplates() {
  // Get access token
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
  console.log('Got access token');

  // List all documents
  const response = await axios.get(
    'https://api.signnow.com/user/documentsv2',
    {
      headers: {
        Authorization: 'Bearer ' + accessToken,
      },
    }
  );

  console.log('\n=== YOUR DOCUMENTS/TEMPLATES ===\n');

  if (!response.data || response.data.length === 0) {
    console.log('No documents found.');
  } else {
    response.data.forEach((doc, i) => {
      console.log((i + 1) + '. ' + doc.document_name);
      console.log('   ID: ' + doc.id);
      console.log('   Is Template: ' + (doc.template ? 'Yes' : 'No'));
      console.log('');
    });
  }
}

listTemplates().catch(err => {
  console.error('Error:', err.response?.data || err.message);
});
