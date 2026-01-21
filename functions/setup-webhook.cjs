const axios = require('axios');
require('dotenv').config();

const WEBHOOK_URL = 'https://us-central1-e-sign-27f9a.cloudfunctions.net/signNowWebhook';

async function setupWebhook() {
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

  // First, list existing webhooks
  console.log('=== EXISTING WEBHOOKS ===');
  try {
    const existingWebhooks = await axios.get(
      'https://api.signnow.com/api/v2/events',
      {
        headers: { Authorization: 'Bearer ' + accessToken },
      }
    );
    console.log('Existing webhooks:', JSON.stringify(existingWebhooks.data, null, 2));
  } catch (e) {
    console.log('No existing webhooks or error:', e.response?.data || e.message);
  }

  // Register webhook for document completion at user level
  console.log('\n=== REGISTERING WEBHOOK ===');
  console.log('URL:', WEBHOOK_URL);
  console.log('Event: document.complete');

  try {
    const response = await axios.post(
      'https://api.signnow.com/api/v2/events',
      {
        event: 'document.complete',
        entity_id: tokenResponse.data.user_id || 'me',
        action: 'callback',
        attributes: {
          callback: WEBHOOK_URL,
        },
      },
      {
        headers: {
          Authorization: 'Bearer ' + accessToken,
          'Content-Type': 'application/json',
        },
      }
    );

    console.log('\nWebhook registered successfully!');
    console.log('Response:', JSON.stringify(response.data, null, 2));
  } catch (error) {
    console.log('\nError registering webhook:', error.response?.status);
    console.log('Error details:', JSON.stringify(error.response?.data, null, 2));

    // Try alternative endpoint format
    console.log('\n=== TRYING ALTERNATIVE FORMAT ===');
    try {
      const altResponse = await axios.post(
        'https://api.signnow.com/event_subscription',
        {
          event: 'document_complete',
          callback_url: WEBHOOK_URL,
        },
        {
          headers: {
            Authorization: 'Bearer ' + accessToken,
            'Content-Type': 'application/json',
          },
        }
      );
      console.log('Alternative webhook registered!');
      console.log('Response:', JSON.stringify(altResponse.data, null, 2));
    } catch (altError) {
      console.log('Alternative also failed:', altError.response?.status);
      console.log('Details:', JSON.stringify(altError.response?.data, null, 2));
    }
  }
}

setupWebhook().catch(err => {
  console.error('Error:', err.response?.data || err.message);
});
