const axios = require('axios');
require('dotenv').config();

const TEMPLATE_ID = 'c16f3961f66f4348bf7c6bd9ece33735040b0b95';

async function debugTemplate() {
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

  const templateResponse = await axios.get(
    `https://api.signnow.com/document/${TEMPLATE_ID}`,
    {
      headers: { Authorization: 'Bearer ' + accessToken },
    }
  );

  const template = templateResponse.data;

  console.log('=== RAW FIELDS STRUCTURE ===');
  console.log(JSON.stringify(template.fields, null, 2));
}

debugTemplate().catch(err => {
  console.error('Error:', err.response?.data || err.message);
});
