import { Router } from 'express';
import { google } from 'googleapis';
import jwt from 'jsonwebtoken';
import db from './db.js';

const router = Router();
const JWT_SECRET = process.env.JWT_SECRET || 'suivipro-secret-key-change-in-production';

const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || '';
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET || '';
const GOOGLE_REDIRECT_URI = process.env.GOOGLE_REDIRECT_URI || '';

function getOAuth2Client() {
  return new google.auth.OAuth2(GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REDIRECT_URI);
}

// Auth middleware (same as in routes.js)
function authMiddleware(req, res, next) {
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (!token) return res.status(401).json({ error: 'Token manquant' });
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = decoded;
    next();
  } catch {
    return res.status(401).json({ error: 'Token invalide' });
  }
}

// ============================================
// Check if Google Calendar is configured
// ============================================

router.get('/google-calendar/config-status', authMiddleware, (req, res) => {
  res.json({
    configured: !!(GOOGLE_CLIENT_ID && GOOGLE_CLIENT_SECRET && GOOGLE_REDIRECT_URI),
  });
});

// ============================================
// Get Google Calendar connection status for all commerciaux
// ============================================

router.get('/google-calendar/status', authMiddleware, async (req, res) => {
  const result = await db.query('SELECT commercial_id, calendar_email, connected_at FROM google_calendar_tokens');
  const statusMap = {};
  for (const t of result.rows) {
    statusMap[t.commercial_id] = {
      connected: true,
      calendar_email: t.calendar_email,
      connected_at: t.connected_at,
    };
  }
  res.json(statusMap);
});

// ============================================
// Step 1: Generate Google OAuth URL
// ============================================

router.get('/google-calendar/authorize', authMiddleware, (req, res) => {
  if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET) {
    return res.status(400).json({ error: 'Google Calendar non configure. Ajoutez GOOGLE_CLIENT_ID et GOOGLE_CLIENT_SECRET.' });
  }

  const oauth2Client = getOAuth2Client();

  // Encode the user ID in state so we can associate the token on callback
  const statePayload = jwt.sign({ userId: req.user.id }, JWT_SECRET, { expiresIn: '10m' });

  const authUrl = oauth2Client.generateAuthUrl({
    access_type: 'offline',
    prompt: 'consent',
    scope: ['https://www.googleapis.com/auth/calendar.readonly'],
    state: statePayload,
  });

  res.json({ url: authUrl });
});

// ============================================
// Step 2: Handle OAuth callback from Google
// ============================================

router.get('/google-calendar/callback', async (req, res) => {
  const { code, state } = req.query;

  if (!code || !state) {
    return res.status(400).send('Parametres manquants. Fermez cette fenetre et reessayez.');
  }

  // Decode the state to get userId
  let userId;
  try {
    const decoded = jwt.verify(state, JWT_SECRET);
    userId = decoded.userId;
  } catch {
    return res.status(400).send('Lien expire. Fermez cette fenetre et reessayez.');
  }

  // Verify user exists
  const userResult = await db.query('SELECT id FROM commerciaux WHERE id = $1', [userId]);
  if (userResult.rows.length === 0) {
    return res.status(404).send('Utilisateur introuvable.');
  }

  try {
    const oauth2Client = getOAuth2Client();
    const { tokens } = await oauth2Client.getToken(code);

    // Get the calendar email
    oauth2Client.setCredentials(tokens);
    let calendarEmail = '';
    try {
      const calendar = google.calendar({ version: 'v3', auth: oauth2Client });
      const calendarList = await calendar.calendarList.get({ calendarId: 'primary' });
      calendarEmail = calendarList.data.summary || calendarList.data.id || '';
    } catch {
      // Not critical
    }

    // Store tokens in database (upsert)
    await db.query(
      `INSERT INTO google_calendar_tokens (commercial_id, access_token, refresh_token, expiry_date, calendar_email, connected_at)
      VALUES ($1, $2, $3, $4, $5, $6)
      ON CONFLICT (commercial_id) DO UPDATE SET access_token=$2, refresh_token=$3, expiry_date=$4, calendar_email=$5, connected_at=$6`,
      [userId, tokens.access_token || '', tokens.refresh_token || '', tokens.expiry_date || 0, calendarEmail, new Date().toISOString()]
    );

    // Return a page that closes itself and notifies the opener
    res.send(`
      <!DOCTYPE html>
      <html>
      <head><title>Google Agenda connecte</title></head>
      <body style="font-family:sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;background:#f9fafb;">
        <div style="text-align:center;padding:2rem;">
          <div style="font-size:3rem;margin-bottom:1rem;">&#9989;</div>
          <h2 style="color:#16a34a;">Google Agenda connecte avec succes !</h2>
          <p style="color:#6b7280;">Vous pouvez fermer cette fenetre.</p>
          <script>
            if (window.opener) {
              window.opener.postMessage({ type: 'GOOGLE_CALENDAR_CONNECTED' }, '*');
              setTimeout(() => window.close(), 2000);
            }
          </script>
        </div>
      </body>
      </html>
    `);
  } catch (err) {
    console.error('Google OAuth callback error:', err);
    res.status(500).send(`
      <!DOCTYPE html>
      <html>
      <head><title>Erreur</title></head>
      <body style="font-family:sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;background:#fef2f2;">
        <div style="text-align:center;padding:2rem;">
          <div style="font-size:3rem;margin-bottom:1rem;">&#10060;</div>
          <h2 style="color:#dc2626;">Erreur de connexion</h2>
          <p style="color:#6b7280;">Fermez cette fenetre et reessayez.</p>
        </div>
      </body>
      </html>
    `);
  }
});

// ============================================
// Disconnect Google Calendar
// ============================================

router.post('/google-calendar/disconnect', authMiddleware, async (req, res) => {
  const commercialId = req.body.commercial_id || req.user.id;

  // Only allow disconnecting own account or admin can disconnect anyone
  if (commercialId !== req.user.id && req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Non autorise' });
  }

  // Revoke token if possible
  const tokenResult = await db.query('SELECT access_token FROM google_calendar_tokens WHERE commercial_id = $1', [commercialId]);
  if (tokenResult.rows.length > 0) {
    try {
      const oauth2Client = getOAuth2Client();
      oauth2Client.revokeToken(tokenResult.rows[0].access_token).catch(() => {});
    } catch {
      // Non-critical
    }
  }

  await db.query('DELETE FROM google_calendar_tokens WHERE commercial_id = $1', [commercialId]);
  res.json({ ok: true });
});

// ============================================
// Get calendar events for a commercial
// ============================================

router.get('/google-calendar/events/:commercialId', authMiddleware, async (req, res) => {
  const { commercialId } = req.params;
  const { timeMin, timeMax } = req.query;

  const tokenResult = await db.query('SELECT * FROM google_calendar_tokens WHERE commercial_id = $1', [commercialId]);
  const tokenRow = tokenResult.rows[0];
  if (!tokenRow) {
    return res.json({ connected: false, events: [] });
  }

  try {
    const oauth2Client = getOAuth2Client();
    oauth2Client.setCredentials({
      access_token: tokenRow.access_token,
      refresh_token: tokenRow.refresh_token,
      expiry_date: Number(tokenRow.expiry_date),
    });

    // Refresh token if expired
    oauth2Client.on('tokens', (tokens) => {
      db.query('UPDATE google_calendar_tokens SET access_token = $1, expiry_date = $2 WHERE commercial_id = $3',
        [tokens.access_token, tokens.expiry_date, commercialId]).catch(() => {});
    });

    const calendar = google.calendar({ version: 'v3', auth: oauth2Client });

    const response = await calendar.events.list({
      calendarId: 'primary',
      timeMin: timeMin || new Date().toISOString(),
      timeMax: timeMax || undefined,
      maxResults: 100,
      singleEvents: true,
      orderBy: 'startTime',
    });

    const events = (response.data.items || []).map(event => ({
      id: event.id,
      summary: event.summary || '(Sans titre)',
      start: event.start?.dateTime || event.start?.date || '',
      end: event.end?.dateTime || event.end?.date || '',
      location: event.location || '',
      description: event.description || '',
      allDay: !!event.start?.date && !event.start?.dateTime,
    }));

    res.json({ connected: true, events, calendar_email: tokenRow.calendar_email });
  } catch (err) {
    console.error('Google Calendar events error:', err.message);

    // If token is revoked/expired and can't be refreshed
    if (err.code === 401 || err.message?.includes('invalid_grant')) {
      await db.query('DELETE FROM google_calendar_tokens WHERE commercial_id = $1', [commercialId]);
      return res.json({ connected: false, events: [], error: 'Token expire, reconnectez Google Agenda.' });
    }

    res.status(500).json({ error: 'Erreur lors de la recuperation des evenements' });
  }
});

// ============================================
// Get events for ALL connected commerciaux (batch)
// ============================================

router.get('/google-calendar/events-all', authMiddleware, async (req, res) => {
  const { timeMin, timeMax } = req.query;

  const allTokensResult = await db.query('SELECT * FROM google_calendar_tokens');
  const allTokens = allTokensResult.rows;
  if (allTokens.length === 0) {
    return res.json({});
  }

  const result = {};

  // Fetch events in parallel for all connected users
  await Promise.allSettled(
    allTokens.map(async (tokenRow) => {
      try {
        const oauth2Client = getOAuth2Client();
        oauth2Client.setCredentials({
          access_token: tokenRow.access_token,
          refresh_token: tokenRow.refresh_token,
          expiry_date: Number(tokenRow.expiry_date),
        });

        oauth2Client.on('tokens', (tokens) => {
          db.query('UPDATE google_calendar_tokens SET access_token = $1, expiry_date = $2 WHERE commercial_id = $3',
            [tokens.access_token, tokens.expiry_date, tokenRow.commercial_id]).catch(() => {});
        });

        const calendar = google.calendar({ version: 'v3', auth: oauth2Client });

        const response = await calendar.events.list({
          calendarId: 'primary',
          timeMin: timeMin || new Date().toISOString(),
          timeMax: timeMax || undefined,
          maxResults: 50,
          singleEvents: true,
          orderBy: 'startTime',
        });

        result[tokenRow.commercial_id] = {
          connected: true,
          calendar_email: tokenRow.calendar_email,
          events: (response.data.items || []).map(event => ({
            id: event.id,
            summary: event.summary || '(Sans titre)',
            start: event.start?.dateTime || event.start?.date || '',
            end: event.end?.dateTime || event.end?.date || '',
            location: event.location || '',
            allDay: !!event.start?.date && !event.start?.dateTime,
          })),
        };
      } catch (err) {
        if (err.code === 401 || err.message?.includes('invalid_grant')) {
          await db.query('DELETE FROM google_calendar_tokens WHERE commercial_id = $1', [tokenRow.commercial_id]);
        }
        result[tokenRow.commercial_id] = { connected: false, events: [] };
      }
    })
  );

  res.json(result);
});

export default router;
