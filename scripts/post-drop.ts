import dotenv from 'dotenv';
import fs from 'fs';
import { generateColor, formatTweetText } from '../server/colorEngine.js';
import { postColorTweet, TwitterCredentials } from '../server/twitterClient.js';
import { storage } from '../server/storage.js';

dotenv.config();

interface CliOptions {
  slot: 'morning' | 'evening' | 'auto';
  dryRun?: boolean;
  targetTweetId?: string;
}

function parseArgs(): CliOptions {
  const args = process.argv.slice(2);
  const options: CliOptions = {
    slot: 'auto',
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--slot' && args[i + 1]) {
      const val = args[i + 1].toLowerCase();
      if (val === 'morning' || val === 'evening' || val === 'auto') {
        options.slot = val as any;
      }
      i++;
    } else if (arg === '--dry-run') {
      options.dryRun = true;
    } else if (arg === '--target' && args[i + 1]) {
      options.targetTweetId = args[i + 1];
      i++;
    }
  }

  return options;
}

function determineSlot(): 'morning' | 'evening' {
  // Use Mountain Standard Time (MST, UTC-7)
  const now = new Date();
  const mstHour = (now.getUTCHours() - 7 + 24) % 24;
  return mstHour < 12 ? 'morning' : 'evening';
}

async function run() {
  const options = parseArgs();
  const slotType = options.slot === 'auto' ? determineSlot() : options.slot;
  const isMorning = slotType === 'morning';

  console.log('====================================================');
  console.log(`🎨 ChromaBot Scheduled Workflow Triggered`);
  console.log(`⏰ Slot: ${slotType.toUpperCase()} (${isMorning ? '6:00 AM Sunrise' : '6:00 PM Sunset'})`);
  console.log(`🕒 Execution Time (UTC): ${new Date().toISOString()}`);

  const settings = storage.getSettings();
  const targetTweetId = options.targetTweetId || process.env.TARGET_TWEET_ID || settings.targetTweetId;
  const isDryRun = options.dryRun ?? (process.env.DRY_RUN === 'true' ? true : settings.dryRun);

  // Retrieve Twitter credentials (process.env from GitHub Secrets or store)
  const creds = storage.getEffectiveCredentials();

  const hasOAuth1 = !!(creds.apiKey && creds.apiSecret && creds.accessToken && creds.accessTokenSecret);
  const hasOAuth2User = !!creds.oauth2AccessToken;

  console.log(`🎯 Target Tweet ID: ${targetTweetId}`);
  console.log(`🛡️ Mode: ${isDryRun ? 'DRY RUN (Simulated)' : 'LIVE X API (Real Post)'}`);
  console.log(`🔑 Credentials Status:`);
  console.log(`   - TWITTER_API_KEY: ${creds.apiKey ? '✓ Set' : '✗ Missing'}`);
  console.log(`   - TWITTER_API_SECRET: ${creds.apiSecret ? '✓ Set' : '✗ Missing'}`);
  console.log(`   - TWITTER_ACCESS_TOKEN: ${creds.accessToken ? '✓ Set' : '✗ Missing'}`);
  console.log(`   - TWITTER_ACCESS_TOKEN_SECRET: ${creds.accessTokenSecret ? '✓ Set' : '✗ Missing'}`);
  console.log(`   - TWITTER_OAUTH2_ACCESS_TOKEN: ${creds.oauth2AccessToken ? '✓ Set' : '✗ Missing'}`);
  console.log(`   - Authentication Ready: ${hasOAuth1 || hasOAuth2User ? '✓ YES' : '✗ NO (Missing user credentials in GitHub Secrets)'}`);

  if (!isDryRun && !hasOAuth1 && !hasOAuth2User) {
    console.error('');
    console.error('🚨 CANNOT POST LIVE TWEET: Missing Twitter Credentials in GitHub Secrets!');
    console.error('Please configure your GitHub Repository Secrets:');
    console.error('  1. TWITTER_API_KEY');
    console.error('  2. TWITTER_API_SECRET');
    console.error('  3. TWITTER_ACCESS_TOKEN');
    console.error('  4. TWITTER_ACCESS_TOKEN_SECRET');
    console.error('');
  }

  // Generate unique Sunrise / Sunset color and 3-5 word weather description
  const color = generateColor(slotType);
  const tweetText = formatTweetText(settings.template, color, isMorning ? '6:00 AM' : '6:00 PM');

  console.log('----------------------------------------------------');
  console.log(`🎨 Color Pick: ${color.colorPick}`);
  console.log(`🌤️ Weather Description: "${color.weatherDesc}"`);
  console.log(`📝 Tweet Text (${tweetText.length} chars):`);
  console.log(`   "${tweetText}"`);
  console.log('----------------------------------------------------');

  const result = await postColorTweet(
    creds,
    {
      text: tweetText,
      replyToTweetId: targetTweetId,
    },
    isDryRun
  );

  const status = result.success ? (result.simulated ? 'simulated' : 'success') : 'error';
  console.log(`📊 Result Status: ${status.toUpperCase()}`);

  if (result.success && !result.simulated) {
    console.log(`🎉 LIVE TWEET DISPATCHED SUCCESSFULLY!`);
    if (result.tweetId) console.log(`🔗 Tweet ID: ${result.tweetId}`);
    if (result.url) console.log(`🌐 Live URL: ${result.url}`);
  } else if (result.simulated) {
    console.log(`⚠️ Note: Result was SIMULATED. Reasons can be:`);
    console.log(`   - DRY_RUN is enabled, or`);
    console.log(`   - GitHub Secrets for OAuth 1.0a / OAuth 2.0 are not yet populated.`);
  } else {
    console.error(`❌ Posting error: ${result.error}`);
    if (result.rawResponse) {
      console.error(`Raw Twitter Response:`, JSON.stringify(result.rawResponse, null, 2));
    }
  }

  // Record log in local bot store
  storage.addLog({
    id: `log_${Date.now()}`,
    timestamp: new Date().toISOString(),
    slotType,
    targetTweetId,
    color,
    tweetText,
    status,
    tweetId: result.tweetId,
    tweetUrl: result.url,
    errorMessage: result.error,
  });

  // If running in GitHub Actions, write to Step Summary
  if (process.env.GITHUB_STEP_SUMMARY) {
    const summaryMd = `
### 🎨 ChromaBot Workflow Drop Summary

| Attribute | Details |
| :--- | :--- |
| **Color Pick** | **${color.colorPick}** (\`${color.hex}\`) |
| **Slot** | ${isMorning ? '🌅 Morning Sunrise (6:00 AM MST)' : '🌇 Evening Sunset (6:00 PM MST)'} |
| **Weather (3-5 words)** | *"${color.weatherDesc}"* |
| **Status** | ${result.success ? (result.simulated ? '🟡 Simulated (Check Secrets / Dry Run)' : '🟢 Live Tweet Published to X') : '🔴 Failed'} |
| **Target Reply** | [#${targetTweetId}](https://x.com/i/status/${targetTweetId}) |
| **Generated Tweet** | \`${tweetText}\` |
${result.url ? `| **Live Tweet URL** | [View Tweet on X](${result.url}) |` : ''}
${result.error ? `| **Error Detail** | \`${result.error}\` |` : ''}
${!hasOAuth1 && !hasOAuth2User && !isDryRun ? `| **Missing Secrets** | \`TWITTER_API_KEY\`, \`TWITTER_API_SECRET\`, \`TWITTER_ACCESS_TOKEN\`, \`TWITTER_ACCESS_TOKEN_SECRET\` |` : ''}

\`\`\`
${color.swatchBar}
Hex: ${color.hex} | RGB: ${color.rgb.r}, ${color.rgb.g}, ${color.rgb.b}
\`\`\`
`;
    try {
      fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, summaryMd);
    } catch (e) {
      console.warn('Could not write to GITHUB_STEP_SUMMARY:', e);
    }
  }

  if (!result.success || (!isDryRun && result.simulated)) {
    process.exitCode = 1;
  }
}

run().catch((err) => {
  console.error('Fatal execution error:', err);
  process.exit(1);
});
