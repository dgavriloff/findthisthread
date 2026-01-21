/**
 * Test script for twitterapi.io
 * Run with: bun run scripts/test-twitter.ts
 */

const TWITTER_API_KEY = process.env.TWITTER_API_KEY;
const BASE_URL = 'https://api.twitterapi.io';

if (!TWITTER_API_KEY) {
  console.error('Error: TWITTER_API_KEY environment variable is required');
  process.exit(1);
}

async function request<T>(endpoint: string, options: RequestInit = {}): Promise<T> {
  const url = `${BASE_URL}${endpoint}`;
  console.log(`\n→ ${options.method || 'GET'} ${url}`);

  const response = await fetch(url, {
    ...options,
    headers: {
      'X-API-Key': TWITTER_API_KEY!,
      'Content-Type': 'application/json',
      ...options.headers,
    },
  });

  const data = await response.json();

  if (!response.ok) {
    console.error(`✗ Error (${response.status}):`, data);
    throw new Error(`API error: ${response.status}`);
  }

  return data as T;
}

// Test 1: Get user info
async function testGetUser() {
  console.log('\n=== Test 1: Get User Info ===');
  try {
    const result = await request<any>('/twitter/user/info?userName=findthisthread');
    console.log('✓ Success!');
    console.log('User:', {
      id: result.data?.id,
      name: result.data?.name,
      userName: result.data?.userName,
      followers: result.data?.followers,
    });
    return result.data?.id;
  } catch (e) {
    console.error('✗ Failed to get user info');
    return null;
  }
}

// Test 2: Search for mentions
async function testSearchMentions() {
  console.log('\n=== Test 2: Search Mentions ===');
  try {
    const result = await request<any>(
      '/twitter/tweet/advanced_search?query=@findthisthread&queryType=Latest'
    );
    console.log('✓ Success!');
    console.log(`Found ${result.tweets?.length || 0} tweets`);
    if (result.tweets?.[0]) {
      console.log('Latest mention:', {
        id: result.tweets[0].id,
        text: result.tweets[0].text?.substring(0, 100),
        author: result.tweets[0].author?.userName,
      });
    }
  } catch (e) {
    console.error('✗ Failed to search mentions');
  }
}

// Test 3: Get a specific tweet (use a known tweet ID)
async function testGetTweet(tweetId: string) {
  console.log('\n=== Test 3: Get Tweet by ID ===');
  try {
    const result = await request<any>(`/twitter/tweets?tweet_ids=${tweetId}`);
    console.log('✓ Success!');
    if (result.tweets?.[0]) {
      console.log('Tweet:', {
        id: result.tweets[0].id,
        text: result.tweets[0].text?.substring(0, 100),
        author: result.tweets[0].author?.userName,
        likes: result.tweets[0].likeCount,
      });
    }
  } catch (e) {
    console.error('✗ Failed to get tweet');
  }
}

// Test 4: Post a tweet (requires auth_session)
async function testPostTweet() {
  console.log('\n=== Test 4: Post Tweet ===');

  const AUTH_SESSION = process.env.TWITTER_AUTH_SESSION;
  const PROXY = process.env.TWITTER_PROXY;

  if (!AUTH_SESSION) {
    console.log('⚠ Skipping: TWITTER_AUTH_SESSION not set');
    console.log('  To post tweets, you need to:');
    console.log('  1. Login via /twitter/login_by_2fa endpoint');
    console.log('  2. Set TWITTER_AUTH_SESSION env var with the session token');
    console.log('  3. Set TWITTER_PROXY env var (format: http://user:pass@ip:port)');
    return;
  }

  if (!PROXY) {
    console.log('⚠ Skipping: TWITTER_PROXY not set');
    console.log('  Residential proxy required for posting');
    return;
  }

  try {
    const result = await request<any>('/twitter/create_tweet', {
      method: 'POST',
      body: JSON.stringify({
        auth_session: AUTH_SESSION,
        tweet_text: `Test post from findthisthread bot - ${new Date().toISOString()}`,
        proxy: PROXY,
      }),
    });
    console.log('✓ Success!');
    console.log('Created tweet ID:', result.data?.create_tweet?.tweet_result?.result?.rest_id);
  } catch (e) {
    console.error('✗ Failed to post tweet');
  }
}

// Main
async function main() {
  console.log('TwitterAPI.io Test Script');
  console.log('=========================');
  console.log('API Key:', TWITTER_API_KEY?.substring(0, 10) + '...');

  await testGetUser();
  await testSearchMentions();

  // Use a sample tweet ID for testing - replace with a real one if needed
  await testGetTweet('1877853909026275650'); // Replace with any valid tweet ID

  await testPostTweet();

  console.log('\n=========================');
  console.log('Tests complete!');
}

main().catch(console.error);
