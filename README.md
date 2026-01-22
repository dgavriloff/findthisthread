# FindThisThread Bot

A Twitter/X bot that finds the original Reddit post from screenshots. When someone tweets a Reddit screenshot and tags the bot, it extracts information from the image and searches Reddit to find the source link.

## How It Works

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              PIPELINE OVERVIEW                               │
└─────────────────────────────────────────────────────────────────────────────┘

  Twitter                    Gemini Vision                Reddit API
     │                            │                           │
     ▼                            ▼                           ▼
┌─────────┐    ┌─────────┐    ┌─────────┐    ┌─────────┐    ┌─────────┐
│ Mention │───▶│  Fetch  │───▶│ Extract │───▶│ Search  │───▶│  Reply  │
│ Detected│    │  Image  │    │  Info   │    │ Reddit  │    │  Link   │
└─────────┘    └─────────┘    └─────────┘    └─────────┘    └─────────┘
```

### Step 1: Mention Detection

The bot polls Twitter for mentions of `@findthisthread`. When a user replies to a tweet containing a Reddit screenshot and tags the bot, it triggers the pipeline.

```
User A: [Posts tweet with Reddit screenshot]
User B: @findthisthread find this post
Bot:    Found it! https://reddit.com/r/...
```

### Step 2: Image Fetching

The bot fetches the **parent tweet** (the one User B replied to) and downloads the first image attachment. This is the Reddit screenshot we need to analyze.

### Step 3: Vision Extraction (Gemini)

The screenshot is sent to Google's Gemini Vision API (`gemini-2.0-flash`) which extracts:

| Field | Description | Example |
|-------|-------------|---------|
| `subreddit` | The subreddit name (without r/) | `AmIOverreacting` |
| `username` | The poster's username (without u/) | `throwaway12345` |
| `title` | The post's headline/title | `AIO for telling my dad...` |
| `bodySnippet` | First ~100 chars of post body | `I've always had this...` |
| `timestamp` | When posted (if visible) | `5h ago` |
| `confidence` | How confident the extraction is | `high`, `medium`, `low` |

### Step 4: Reddit Search

The bot uses **multiple search strategies** in order, stopping when it finds a high-confidence match (>0.8) or returning the best result after trying all strategies:

```
Search Strategies (in order):
─────────────────────────────
1. exactTitle        → Search Reddit for exact title in quotes
2. titleInSubreddit  → Search title keywords within the subreddit
3. authorInSubreddit → Search by author within the subreddit
4. globalWithAuthor  → Global search with title + author
5. titleGlobal       → Global search with title keywords
6. bodySnippet       → Search using body text keywords
7. userComments      → Search user's comment history (for comments, not posts)
```

#### Matching Algorithm

Each search result is scored using fuzzy string matching:

- **Title similarity** (60% weight) - Most important factor
- **Exact title bonus** (+15%) - If title matches >90%
- **Author match** (20% weight) - Fuzzy match, ignores "redacted"/"deleted"
- **Subreddit match** (20% weight) - Fuzzy match (handles OCR typos)
- **Body content bonus** (+10%) - If body text matches

Results with confidence ≥0.4 are returned; the bot aims for ≥0.8 confidence.

### Step 5: Reply

The bot replies to the mention with either:

- **Success**: `Found it! https://reddit.com/r/...`
- **Not Found**: `Couldn't locate this post. It may be deleted or from a private subreddit.`
- **No Image**: `I need an image to work with! Tag me on a tweet that contains a Reddit screenshot.`
- **Not Reddit**: `That doesn't look like a Reddit screenshot.`

## Architecture

```
src/
├── index.ts              # Entry point, polling loop + web server
├── web/
│   └── server.ts         # Hono web server + API routes
├── twitter/
│   ├── client.ts         # Twitter API wrapper (twitterapi.io)
│   ├── mock.ts           # Mock data for testing
│   └── types.ts          # Twitter type definitions
├── vision/
│   ├── extractor.ts      # Gemini Vision integration
│   └── types.ts          # Extracted data types
├── reddit/
│   ├── search.ts         # Multi-strategy Reddit search
│   └── types.ts          # Reddit API types
├── bot/
│   └── handler.ts        # Main orchestration logic
└── db/
    └── mentions.ts       # SQLite for tracking processed mentions

public/
└── index.html            # Dashboard frontend
```

## Web Dashboard

The bot includes a web dashboard that displays:

- **Timer bar** showing countdown to the next Twitter check
- **Stats** (total mentions, successful finds, failures)
- **Recent finds** with direct Reddit links
- **All mentions** with extracted info (subreddit, username, title)

The dashboard auto-refreshes and is served at `http://localhost:3000` (or the `PORT` env var).

### API Endpoints

| Endpoint | Description |
|----------|-------------|
| `GET /api/status` | Bot status, timer info, stats |
| `GET /api/mentions` | All processed mentions |
| `GET /api/successes` | Recent successful finds |
| `GET /api/mentions/:id` | Single mention details |

## Running the Bot

### Production Mode

```bash
bun start
```

Starts the bot and web dashboard. Polls Twitter every 30 seconds for new mentions.

### Development Mode

```bash
bun run dev
```

Runs with file watching for hot reload.

### Test Mode

```bash
# With a specific image URL
TEST_IMAGE_URL="https://example.com/reddit-screenshot.jpg" bun run test

# Or set in .env
TEST_MODE=true bun start
```

Test mode:
- Uses mock Twitter data (no API calls)
- Runs one check cycle then keeps server running for dashboard
- Still uses real Gemini + Reddit APIs

## Environment Variables

```env
# Required
TWITTER_API_KEY=xxx        # From twitterapi.io
GEMINI_API_KEY=xxx         # From Google AI Studio

# Optional
TWITTER_BOT_USERNAME=findthisthread
DATABASE_PATH=./data/mentions.db
POLL_INTERVAL_MS=30000
PORT=3000                  # Web dashboard port
TEST_IMAGE_URL=xxx         # For testing
TEST_MODE=true             # Enable test mode
```

## Deployment (Railway)

### 1. Create Railway Project

```bash
# Install Railway CLI
npm i -g @railway/cli

# Login and init
railway login
railway init
```

### 2. Add Volume for Persistent Storage

1. Go to your service in Railway dashboard
2. Settings → Volumes
3. Add volume with mount path: `/data`

The app auto-detects Railway and uses `/data/mentions.db` for the database.

### 3. Set Environment Variables

In Railway dashboard → Variables:

```
TWITTER_API_KEY=xxx
GEMINI_API_KEY=xxx
```

Railway automatically sets `PORT` and `RAILWAY_ENVIRONMENT`.

### 4. Deploy

```bash
railway up
```

Or connect your GitHub repo for automatic deploys.

## Limitations

1. **Deleted posts** - Can't find posts that have been removed
2. **Private subreddits** - No access to private/quarantined communities
3. **OCR errors** - Vision model may misread text (typos in subreddit names, etc.)
4. **Comments** - Finding comments is harder than posts; requires username to be visible
5. **Rate limits** - Reddit API has rate limits; bot respects them with delays
6. **Image quality** - Low-res or cropped screenshots may not extract well

## Tech Stack

- **Runtime**: Bun
- **Language**: TypeScript
- **Web Framework**: Hono
- **Vision API**: Google Gemini (gemini-2.0-flash)
- **Twitter API**: twitterapi.io
- **Database**: SQLite (via bun:sqlite)
- **String Matching**: string-similarity (Dice coefficient)
