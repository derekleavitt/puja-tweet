/**
 * Express Backend Server for X ChromaBot
 * Handles Twitter/X API communication, 6am/6pm scheduler, and Vite dev middleware.
 */

import 'dotenv/config';
import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { createServer as createViteServer } from 'vite';
import { formatTweetText, generateColor } from './server/colorEngine.js';
import { scheduler } from './server/scheduler.js';
import { storage } from './server/storage.js';
import { postColorTweet, verifyTwitterCredentials } from './server/twitterClient.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = parseInt(process.env.PORT || '3000', 10);

app.use(express.json());

// API Routes
app.get('/api/status', (req, res) => {
  const settings = storage.getSettings();
  const nextPost = scheduler.getNextScheduledPost();
  const credentialsStatus = storage.getMaskedCredentialsStatus();
  const logs = storage.getLogs();

  const stats = {
    totalPosts: logs.length,
    successfulPosts: logs.filter(l => l.status === 'success').length,
    simulatedPosts: logs.filter(l => l.status === 'simulated').length,
    failedPosts: logs.filter(l => l.status === 'error').length,
  };

  res.json({
    settings,
    nextPost,
    credentialsStatus,
    stats,
    latestLog: logs[0] || null,
  });
});

app.post('/api/settings', (req, res) => {
  try {
    const updated = storage.updateSettings(req.body);
    res.json({ success: true, settings: updated });
  } catch (err: any) {
    res.status(400).json({ success: false, error: err.message });
  }
});

app.post('/api/credentials', (req, res) => {
  try {
    const {
      apiKey,
      apiSecret,
      accessToken,
      accessTokenSecret,
      oauth2ClientId,
      oauth2ClientSecret,
      oauth2AccessToken,
      oauth2RefreshToken,
      bearerToken,
    } = req.body;
    storage.updateCredentials({
      apiKey: apiKey?.trim(),
      apiSecret: apiSecret?.trim(),
      accessToken: accessToken?.trim(),
      accessTokenSecret: accessTokenSecret?.trim(),
      oauth2ClientId: oauth2ClientId?.trim(),
      oauth2ClientSecret: oauth2ClientSecret?.trim(),
      oauth2AccessToken: oauth2AccessToken?.trim(),
      oauth2RefreshToken: oauth2RefreshToken?.trim(),
      bearerToken: bearerToken?.trim(),
    });
    const status = storage.getMaskedCredentialsStatus();
    res.json({ success: true, credentialsStatus: status });
  } catch (err: any) {
    res.status(400).json({ success: false, error: err.message });
  }
});

app.post('/api/twitter/verify', async (req, res) => {
  try {
    const creds = storage.getEffectiveCredentials();
    const result = await verifyTwitterCredentials(creds);
    res.json(result);
  } catch (err: any) {
    res.status(500).json({ valid: false, message: err.message });
  }
});

app.post('/api/generate-color', (req, res) => {
  const slotType = req.body.slotType || 'random';
  const color = generateColor(slotType);
  const settings = storage.getSettings();
  const timeTag = slotType === 'morning' ? '6:00 AM' : slotType === 'evening' ? '6:00 PM' : 'Drop';
  const previewText = formatTweetText(settings.template, color, timeTag);

  res.json({
    color,
    previewText,
    charCount: previewText.length,
    targetTweetId: settings.targetTweetId,
  });
});

app.post('/api/post-now', async (req, res) => {
  try {
    const settings = storage.getSettings();
    const slotType = req.body.slotType || 'manual';
    
    // Use provided color or generate fresh one
    const color = req.body.color || generateColor(slotType === 'morning' ? 'morning' : 'evening');
    const timeTag = slotType === 'morning' ? '6:00 AM' : slotType === 'evening' ? '6:00 PM' : 'Live Drop';
    const text = req.body.text || formatTweetText(settings.template, color, timeTag);
    const targetTweetId = req.body.targetTweetId || settings.targetTweetId;
    const forceLive = req.body.forceLive === true;

    const isDryRun = forceLive ? false : settings.dryRun;
    const creds = storage.getEffectiveCredentials();

    const tweetRes = await postColorTweet(
      creds,
      {
        text,
        replyToTweetId: targetTweetId,
      },
      isDryRun
    );

    const logEntry = {
      id: `log_${Date.now()}`,
      timestamp: new Date().toISOString(),
      slotType,
      targetTweetId,
      color,
      tweetText: text,
      tweetId: tweetRes.tweetId,
      tweetUrl: tweetRes.url,
      status: tweetRes.success ? (tweetRes.simulated ? 'simulated' as const : 'success' as const) : 'error' as const,
      errorMessage: tweetRes.error,
    };

    storage.addLog(logEntry);

    res.json({
      success: tweetRes.success,
      result: tweetRes,
      log: logEntry,
    });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.get('/api/queue', (req, res) => {
  res.json({ queue: storage.getQueue() });
});

app.post('/api/queue/reroll', (req, res) => {
  const { slotId } = req.body;
  if (!slotId) {
    return res.status(400).json({ error: 'slotId required' });
  }
  const updated = storage.rerollQueueSlot(slotId);
  if (!updated) {
    return res.status(404).json({ error: 'Slot not found' });
  }
  res.json({ slot: updated });
});

app.get('/api/history', (req, res) => {
  res.json({ logs: storage.getLogs() });
});

app.delete('/api/history', (req, res) => {
  storage.clearLogs();
  res.json({ success: true });
});

app.get('/api/export-script', (req, res) => {
  const settings = storage.getSettings();
  
  const githubActionsYaml = `name: Daily 6am & 6pm Color Replies to X

on:
  schedule:
    # 6:00 AM UTC and 6:00 PM UTC
    - cron: '0 6,18 * * *'
  workflow_dispatch:

jobs:
  post-color:
    runs-on: ubuntu-latest
    steps:
      - name: Checkout Code
        uses: actions/checkout@v4

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: 20

      - name: Post Color Reply
        env:
          TWITTER_API_KEY: \${{ secrets.TWITTER_API_KEY }}
          TWITTER_API_SECRET: \${{ secrets.TWITTER_API_SECRET }}
          TWITTER_ACCESS_TOKEN: \${{ secrets.TWITTER_ACCESS_TOKEN }}
          TWITTER_ACCESS_TOKEN_SECRET: \${{ secrets.TWITTER_ACCESS_TOKEN_SECRET }}
          TARGET_TWEET_ID: "${settings.targetTweetId}"
        run: node scripts/standalone-poster.mjs
`;

  const nodeScript = `// Standalone Color Poster for X (Twitter)
// Target Post: https://x.com/pfinallyhere/status/${settings.targetTweetId}

import crypto from 'crypto';

const API_KEY = process.env.TWITTER_API_KEY;
const API_SECRET = process.env.TWITTER_API_SECRET;
const ACCESS_TOKEN = process.env.TWITTER_ACCESS_TOKEN;
const ACCESS_TOKEN_SECRET = process.env.TWITTER_ACCESS_TOKEN_SECRET;
const TARGET_TWEET_ID = process.env.TARGET_TWEET_ID || "${settings.targetTweetId}";

function percentEncode(str) {
  return encodeURIComponent(str).replace(/[!'()*]/g, c => '%' + c.charCodeAt(0).toString(16).toUpperCase());
}

function getOAuthHeader(method, url) {
  const oauthParams = {
    oauth_consumer_key: API_KEY,
    oauth_nonce: crypto.randomBytes(16).toString('hex'),
    oauth_signature_method: 'HMAC-SHA1',
    oauth_timestamp: Math.floor(Date.now() / 1000).toString(),
    oauth_token: ACCESS_TOKEN,
    oauth_version: '1.0',
  };

  const paramString = Object.keys(oauthParams)
    .sort()
    .map(k => \`\${percentEncode(k)}=\${percentEncode(oauthParams[k])}\`)
    .join('&');

  const baseString = [method.toUpperCase(), percentEncode(url), percentEncode(paramString)].join('&');
  const signingKey = \`\${percentEncode(API_SECRET)}&\${percentEncode(ACCESS_TOKEN_SECRET)}\`;
  const signature = crypto.createHmac('sha1', signingKey).update(baseString).digest('base64');
  oauthParams.oauth_signature = signature;

  const header = Object.keys(oauthParams)
    .sort()
    .map(k => \`\${percentEncode(k)}="\${percentEncode(oauthParams[k])}"\`)
    .join(', ');

  return \`OAuth \${header}\`;
}

// Generate color
const now = new Date();
const isMorning = now.getUTCHours() < 12;
const timeTag = isMorning ? '6:00 AM' : '6:00 PM';
const r = Math.floor(Math.random() * 256);
const g = Math.floor(Math.random() * 256);
const b = Math.floor(Math.random() * 256);
const hex = '#' + [r, g, b].map(x => x.toString(16).padStart(2, '0')).join('').toUpperCase();

const tweetText = \`🎨 \${timeTag} Color Drop\\n\\nHEX: \${hex}\\nRGB: \${r}, \${g}, \${b}\\n\\n#ColorPalette #DailyColor\`;

async function main() {
  const url = 'https://api.x.com/2/tweets';
  const authHeader = getOAuthHeader('POST', url);

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: authHeader,
      'Content-Type': 'application/json',
      'User-Agent': 'X-ChromaBot-Standalone/1.0',
    },
    body: JSON.stringify({
      text: tweetText,
      reply: { in_reply_to_tweet_id: TARGET_TWEET_ID },
    }),
  });

  const json = await res.json();
  console.log('Result:', json);
}

main().catch(console.error);
`;

  res.json({
    githubActionsYaml,
    nodeScript,
    targetTweetId: settings.targetTweetId,
  });
});

// Vite or Static files handling
async function startServer() {
  // Start background scheduler
  scheduler.start();

  if (process.env.NODE_ENV === 'production') {
    app.use(express.static(path.resolve(__dirname, 'dist')));
    app.get('*', (req, res) => {
      res.sendFile(path.resolve(__dirname, 'dist', 'index.html'));
    });
  } else {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`[X-ChromaBot] Server running at http://0.0.0.0:${PORT}`);
  });
}

startServer().catch(err => {
  console.error('Fatal server startup error:', err);
  process.exit(1);
});
