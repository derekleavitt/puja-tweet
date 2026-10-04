/**
 * Standalone export script routes (GitHub Actions workflow + Node poster).
 */

import { Router } from 'express';
import type { AppDeps } from '../app.js';
import type { TweetContext } from '../storage.js';

const buildExportScripts = (activeContext: TweetContext) => {
  const githubActionsYaml = `name: Daily Color Replies to X (${activeContext.name})

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
          TARGET_TWEET_ID: "${activeContext.targetTweetId}"
        run: node scripts/standalone-poster.mjs
`;

  const nodeScript = `// Standalone Color Poster for X (Twitter)
// Target Post: https://x.com/i/status/${activeContext.targetTweetId}

import crypto from 'crypto';

const API_KEY = process.env.TWITTER_API_KEY;
const API_SECRET = process.env.TWITTER_API_SECRET;
const ACCESS_TOKEN = process.env.TWITTER_ACCESS_TOKEN;
const ACCESS_TOKEN_SECRET = process.env.TWITTER_ACCESS_TOKEN_SECRET;
const TARGET_TWEET_ID = process.env.TARGET_TWEET_ID || "${activeContext.targetTweetId}";

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

  return { githubActionsYaml, nodeScript };
};

export const createExportRouter = ({ storage }: AppDeps) => {
  const router = Router();

  router.get('/export-script', (req, res) => {
    const activeContext = storage.getActiveContext();
    const { githubActionsYaml, nodeScript } = buildExportScripts(activeContext);

    res.json({
      githubActionsYaml,
      nodeScript,
      targetTweetId: activeContext.targetTweetId,
      contextName: activeContext.name,
    });
  });

  return router;
};
