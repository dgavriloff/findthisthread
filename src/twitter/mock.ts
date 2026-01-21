import { Tweet, Mention } from './types';

// ============================================================
// SET YOUR TEST IMAGE URL HERE
// ============================================================
// Options:
// 1. Set TEST_IMAGE_URL env var
// 2. Use a publicly accessible URL to a Reddit screenshot
// 3. Upload a screenshot to imgur.com and paste the direct URL
// ============================================================

export const TEST_IMAGE_URL = process.env.TEST_IMAGE_URL ||
  // Default: replace with a real Reddit screenshot URL for testing
  'https://pbs.twimg.com/media/G_KKmaGXgAEcUol?format=jpg&name=900x900';

// Mock mention - simulates someone tagging the bot
export const MOCK_MENTIONS: Mention[] = [
  {
    id: '2014080447933018247',
    text: '@findthisthread find this post please',
    author_id: '123456789',
    author_username: 'oooousay',
    in_reply_to_status_id: '2014070000000000000', // Parent tweet with the screenshot
    created_at: new Date().toISOString(),
  },
];

// Mock parent tweet - the tweet containing the Reddit screenshot
export const MOCK_TWEETS: Record<string, Tweet> = {
  // The mention tweet itself
  '2014080447933018247': {
    id: '2014080447933018247',
    text: '@findthisthread find this post please',
    author_id: '123456789',
    author_username: 'oooousay',
    in_reply_to_status_id: '2014070000000000000',
    created_at: new Date().toISOString(),
  },
  // The parent tweet with the Reddit screenshot
  '2014070000000000000': {
    id: '2014070000000000000',
    text: 'Check out this Reddit post lol',
    author_id: '987654321',
    author_username: 'someuser',
    media: [
      {
        type: 'photo',
        url: TEST_IMAGE_URL,
        media_url_https: TEST_IMAGE_URL,
      },
    ],
    created_at: new Date().toISOString(),
  },
};
