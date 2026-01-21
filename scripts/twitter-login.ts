/**
 * Twitter Login Script for twitterapi.io
 *
 * This script helps you log in and get a session cookie for posting tweets.
 *
 * Run with: bun run scripts/twitter-login.ts
 *
 * Required env vars:
 *   TWITTER_API_KEY     - Your twitterapi.io API key
 *   TWITTER_PROXY       - Residential proxy (http://user:pass@ip:port)
 *
 * Optional env vars (or enter interactively):
 *   TWITTER_USERNAME    - Your Twitter username
 *   TWITTER_EMAIL       - Your Twitter email
 *   TWITTER_PASSWORD    - Your Twitter password
 *   TWITTER_2FA_SECRET  - Your 2FA TOTP secret (optional)
 */

import * as readline from 'readline';
import { writeFileSync, existsSync, readFileSync } from 'fs';

const BASE_URL = 'https://api.twitterapi.io';
const COOKIE_FILE = '.twitter-cookie';

// Get env vars
const API_KEY = process.env.TWITTER_API_KEY;
const PROXY = process.env.TWITTER_PROXY;

if (!API_KEY) {
  console.error('Error: TWITTER_API_KEY environment variable is required');
  process.exit(1);
}

if (!PROXY) {
  console.error('Error: TWITTER_PROXY environment variable is required');
  console.error('Format: http://username:password@ip:port');
  console.error('Note: Must be a residential proxy, not datacenter');
  process.exit(1);
}

// Readline interface for prompts
const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

function prompt(question: string): Promise<string> {
  return new Promise((resolve) => {
    rl.question(question, (answer) => resolve(answer.trim()));
  });
}

function promptHidden(question: string): Promise<string> {
  return new Promise((resolve) => {
    process.stdout.write(question);
    const stdin = process.stdin;
    const wasRaw = stdin.isRaw;
    stdin.setRawMode?.(true);
    stdin.resume();

    let password = '';
    const onData = (ch: Buffer) => {
      const char = ch.toString();
      if (char === '\n' || char === '\r') {
        stdin.setRawMode?.(wasRaw);
        stdin.removeListener('data', onData);
        console.log();
        resolve(password);
      } else if (char === '\u0003') {
        // Ctrl+C
        process.exit();
      } else if (char === '\u007F' || char === '\b') {
        // Backspace
        password = password.slice(0, -1);
      } else {
        password += char;
      }
    };
    stdin.on('data', onData);
  });
}

async function request<T>(endpoint: string, body: object): Promise<T> {
  const url = `${BASE_URL}${endpoint}`;
  console.log(`\n→ POST ${endpoint}`);

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'X-API-Key': API_KEY!,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  const data = await response.json();

  console.log(`← Status: ${response.status}`);

  if (!response.ok) {
    console.error('✗ API Error:', JSON.stringify(data, null, 2));
    throw new Error(data.msg || data.message || 'API request failed');
  }

  return data as T;
}

function saveCookie(cookie: string) {
  writeFileSync(COOKIE_FILE, cookie);
  console.log(`\n✓ Cookie saved to ${COOKIE_FILE}`);
  console.log('\nAdd this to your .env file:');
  console.log(`TWITTER_LOGIN_COOKIE=${cookie}`);
}

function loadCookie(): string | null {
  if (existsSync(COOKIE_FILE)) {
    return readFileSync(COOKIE_FILE, 'utf-8').trim();
  }
  return process.env.TWITTER_LOGIN_COOKIE || null;
}

async function login() {
  console.log('\n=== Twitter Login (V2) ===\n');

  // Get credentials from env or prompt
  const username = process.env.TWITTER_BOT_USERNAME || process.env.TWITTER_USERNAME || await prompt('Twitter username: ');
  const email = process.env.TWITTER_BOT_EMAIL || process.env.TWITTER_EMAIL || await prompt('Twitter email: ');
  const password = process.env.TWITTER_BOT_PASSWORD || process.env.TWITTER_PASSWORD || await promptHidden('Twitter password: ');
  const totpSecret = process.env.TWITTER_2FA_SECRET || await prompt('2FA secret (leave blank if none): ');

  console.log(`Username: ${username}`);
  console.log(`Email: ${email}`);
  console.log(`Password: ${'*'.repeat(password.length)}`);

  console.log('\nLogging in...');

  try {
    const result = await request<{
      login_cookie?: string;
      login_cookies?: string;
      status: string;
      msg?: string;
      message?: string;
    }>('/twitter/user_login_v2', {
      user_name: username,
      email: email,
      password: password,
      proxy: PROXY,
      ...(totpSecret && { totp_secret: totpSecret }),
    });

    const cookie = result.login_cookies || result.login_cookie;

    if (cookie) {
      console.log('\n✓ Login successful!');
      saveCookie(cookie);
      return cookie;
    } else {
      console.error('✗ No cookie returned');
      console.error('Response:', JSON.stringify(result, null, 2));
      return null;
    }
  } catch (error) {
    console.error('\n✗ Login failed');
    return null;
  }
}

async function testPost(cookie: string) {
  console.log('\n=== Test Post ===\n');

  const text = await prompt('Enter test tweet text (or "skip" to skip): ');
  if (text.toLowerCase() === 'skip') {
    console.log('Skipped test post');
    return;
  }

  console.log('\nPosting tweet...');
  console.log('Using proxy:', PROXY);
  console.log('Cookie (first 50 chars):', cookie.substring(0, 50) + '...');

  const requestBody = {
    login_cookies: cookie,
    tweet_text: text,
    proxy: PROXY,
  };
  console.log('\nRequest body:', JSON.stringify(requestBody, null, 2));

  try {
    const result = await request<{
      tweet_id?: string;
      status: string;
      msg?: string;
      message?: string;
    }>('/twitter/create_tweet_v2', requestBody);

    console.log('\nFull response:', JSON.stringify(result, null, 2));

    if (result.tweet_id) {
      console.log('\n✓ Tweet posted successfully!');
      console.log(`Tweet ID: ${result.tweet_id}`);
      console.log(`URL: https://twitter.com/findthisthread/status/${result.tweet_id}`);
    } else {
      console.log('\n⚠ No tweet_id in response');
      console.log('This usually means the proxy was blocked by Twitter');
    }
  } catch (error) {
    console.error('\n✗ Failed to post tweet:', error);
  }
}

async function testReply(cookie: string) {
  console.log('\n=== Test Reply ===\n');

  const tweetId = await prompt('Enter tweet ID to reply to (or "skip" to skip): ');
  if (tweetId.toLowerCase() === 'skip') {
    console.log('Skipped test reply');
    return;
  }

  const text = await prompt('Enter reply text: ');

  console.log('\nPosting reply...');

  try {
    const result = await request<{
      tweet_id?: string;
      status: string;
      msg?: string;
      message?: string;
    }>('/twitter/create_tweet_v2', {
      login_cookies: cookie,
      tweet_text: text,
      proxy: PROXY,
      reply_to_tweet_id: tweetId,
    });

    console.log('\nFull response:', JSON.stringify(result, null, 2));

    if (result.tweet_id) {
      console.log('\n✓ Reply posted successfully!');
      console.log(`Tweet ID: ${result.tweet_id}`);
      console.log(`URL: https://twitter.com/findthisthread/status/${result.tweet_id}`);
    } else {
      console.log('\n⚠ No tweet_id in response');
    }
  } catch (error) {
    console.error('\n✗ Failed to post reply:', error);
  }
}

async function main() {
  console.log('TwitterAPI.io Login Script');
  console.log('==========================');
  console.log(`API Key: ${API_KEY?.substring(0, 10)}...`);
  console.log(`Proxy: ${PROXY?.replace(/:[^:@]+@/, ':****@')}`);

  // Check for existing cookie
  const existingCookie = loadCookie();
  let cookie: string | null = null;

  if (existingCookie) {
    console.log(`\nFound existing cookie in ${COOKIE_FILE}`);
    const useExisting = await prompt('Use existing cookie? (y/n): ');
    if (useExisting.toLowerCase() === 'y') {
      cookie = existingCookie;
    }
  }

  // Login if no cookie
  if (!cookie) {
    cookie = await login();
  }

  if (!cookie) {
    console.log('\nNo valid cookie. Exiting.');
    rl.close();
    process.exit(1);
  }

  // Menu
  while (true) {
    console.log('\n=== Menu ===');
    console.log('1. Post a test tweet');
    console.log('2. Post a test reply');
    console.log('3. Re-login (get new cookie)');
    console.log('4. Exit');

    const choice = await prompt('\nChoice (1-4): ');

    switch (choice) {
      case '1':
        await testPost(cookie);
        break;
      case '2':
        await testReply(cookie);
        break;
      case '3':
        cookie = await login();
        if (!cookie) {
          console.log('Login failed, keeping old cookie');
          cookie = existingCookie || '';
        }
        break;
      case '4':
        console.log('\nGoodbye!');
        rl.close();
        process.exit(0);
      default:
        console.log('Invalid choice');
    }
  }
}

main().catch((error) => {
  console.error('Fatal error:', error);
  rl.close();
  process.exit(1);
});
