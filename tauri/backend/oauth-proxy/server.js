const express = require('express');
const cors = require('cors');
const { google } = require('googleapis');
const path = require('path');
const dotenv = require('dotenv');

dotenv.config();

const app = express();
const PORT = process.env.PORT;
const TAURI_DEEP_LINK_SCHEME = 'archestra-ai://';

// Middleware
// app.use(cors({
//   origin: [TAURI_SERVER_URL],
//   credentials: true
// }));
app.use(express.json());
app.use(express.static('public'));
app.use((req, res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.url}`);
  next();
});

// Load OAuth credentials
const oauth2Client = new google.auth.OAuth2(
  process.env.GOOGLE_CLIENT_ID,
  process.env.GOOGLE_CLIENT_SECRET,
  `http://localhost:${PORT}/auth/callback`
);

// Store temporary auth states (in production, use Redis or database)
const authStates = new Map();

// Routes
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Start OAuth flow
app.get('/auth/gmail', (req, res) => {
  console.log('Received /auth/gmail request');

  try {
    const state = Math.random().toString(36).substring(7);
    const userId = req.query.userId || 'default';

    console.log('Generated state:', state);
    console.log('Google Client ID:', process.env.GOOGLE_CLIENT_ID ? 'Set' : 'Not set');
    console.log('Google Client Secret:', process.env.GOOGLE_CLIENT_SECRET ? 'Set' : 'Not set');

    // Store state for verification
    authStates.set(state, { userId, timestamp: Date.now() });

    // Clean up old states (older than 10 minutes)
    const tenMinutesAgo = Date.now() - 10 * 60 * 1000;
    for (const [key, value] of authStates.entries()) {
      if (value.timestamp < tenMinutesAgo) {
        authStates.delete(key);
      }
    }

    const scopes = [
      'https://www.googleapis.com/auth/gmail.readonly',
      'https://www.googleapis.com/auth/gmail.send',
      'https://www.googleapis.com/auth/gmail.modify'
    ];

    const authUrl = oauth2Client.generateAuthUrl({
      access_type: 'offline',
      scope: scopes,
      state: state,
      prompt: 'consent' // Force consent to get refresh token
    });

    console.log('Generated auth URL:', authUrl);
    console.log('Sending response:', { auth_url: authUrl, state });

    res.json({ auth_url: authUrl, state });
  } catch (error) {
    console.error('Error in /auth/gmail:', error);
    res.status(500).json({ error: error.message });
  }
});

// OAuth callback
app.get('/auth/callback', async (req, res) => {
  const { code, state } = req.query;

  if (!code || !state) {
    return res.status(400).send('Missing authorization code or state');
  }

  // Verify state
  const storedState = authStates.get(state);
  if (!storedState) {
    return res.status(400).send('Invalid or expired state');
  }

  try {
    // Exchange code for tokens
    const { tokens } = await oauth2Client.getToken(code);

    // Clean up state
    authStates.delete(state);

    // Return tokens to desktop app via Tauri protocol
    const redirectUrl = `${TAURI_DEEP_LINK_SCHEME}/oauth-callback?access_token=${tokens.access_token}&refresh_token=${tokens.refresh_token}&expiry_date=${tokens.expiry_date}`;

    res.redirect(redirectUrl);
  } catch (error) {
    console.error('Token exchange error:', error);
    const errorUrl = `${TAURI_DEEP_LINK_SCHEME}/oauth-callback?error=${encodeURIComponent(error.message)}`;
    res.redirect(errorUrl);
  }
});

// Health check
app.get('/health', (req, res) => {
  console.log('Health check requested');
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Start server
app.listen(PORT, () => {
  console.log(`OAuth proxy server running on port ${PORT}`);
  console.log(`Auth URL: http://localhost:${PORT}/auth/gmail`);
  console.log(`Health check URL: http://localhost:${PORT}/health`);
  console.log('Environment variables:');
  console.log('- PORT:', process.env.PORT);
  console.log('- GOOGLE_CLIENT_ID:', process.env.GOOGLE_CLIENT_ID ? 'Set' : 'Not set');
  console.log('- GOOGLE_CLIENT_SECRET:', process.env.GOOGLE_CLIENT_SECRET ? 'Set' : 'Not set');
});
