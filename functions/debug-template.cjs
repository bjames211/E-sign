const axios = require('axios');
require('dotenv').config();

const TEMPLATE_ID = 'c16f3961f66f4348bf7c6bd9ece33735040b0b95';

async function debugTemplate() {
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
  console.log('Got access token\n');

  // Get template details
  console.log('=== TEMPLATE DETAILS ===');
  console.log('Template ID:', TEMPLATE_ID);

  const templateResponse = await axios.get(
    `https://api.signnow.com/document/${TEMPLATE_ID}`,
    {
      headers: { Authorization: 'Bearer ' + accessToken },
    }
  );

  const template = templateResponse.data;

  console.log('\nDocument Name:', template.document_name);
  console.log('Is Template:', template.template);
  console.log('Page Count:', template.page_count);

  console.log('\n=== FIELDS ===');
  console.log('Fields array length:', template.fields?.length || 0);

  if (template.fields && template.fields.length > 0) {
    template.fields.forEach((field, i) => {
      console.log(`\nField ${i + 1}:`);
      console.log('  Type:', field.type);
      console.log('  X:', field.x);
      console.log('  Y:', field.y);
      console.log('  Width:', field.width);
      console.log('  Height:', field.height);
      console.log('  Page:', field.page_number);
      console.log('  Role:', field.role);
      console.log('  Required:', field.required);
    });
  } else {
    console.log('No fields found in template!');
  }

  console.log('\n=== ROLES ===');
  console.log('Roles array length:', template.roles?.length || 0);
  if (template.roles) {
    template.roles.forEach((role, i) => {
      console.log(`Role ${i + 1}:`, role.name, '- ID:', role.unique_id);
    });
  }

  console.log('\n=== SIGNATURES (existing) ===');
  console.log('Signatures array length:', template.signatures?.length || 0);

  console.log('\n=== TEXTS ===');
  console.log('Texts array length:', template.texts?.length || 0);

  // Check for field_invites which might contain field definitions
  console.log('\n=== FIELD INVITES ===');
  console.log('Field invites:', JSON.stringify(template.field_invites, null, 2));

  // Log full structure for analysis
  console.log('\n=== FULL TEMPLATE KEYS ===');
  console.log(Object.keys(template));
}

debugTemplate().catch(err => {
  console.error('Error:', err.response?.data || err.message);
});
