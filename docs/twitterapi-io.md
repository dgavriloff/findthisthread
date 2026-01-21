# TwitterAPI.io Documentation

Reference documentation for [twitterapi.io](https://twitterapi.io) endpoints used in this project.

**Full Docs:** https://docs.twitterapi.io

## Overview

- **Base URL:** `https://api.twitterapi.io`
- **Authentication:** API Key via header
- **Pricing:** $0.15/1k tweets, $0.18/1k profiles, min $0.00015/request
- **Performance:** ~700ms avg response, 200 QPS per client

## Authentication

All requests require the `X-API-Key` header:

```bash
curl --request GET \
  --url 'https://api.twitterapi.io/twitter/...' \
  --header 'X-API-Key: YOUR_API_KEY'
```

Get your API key from the [Dashboard](https://twitterapi.io/dashboard).

---

## Endpoints Used in This Project

### 1. Advanced Search (Get Mentions)

Search for tweets mentioning the bot.

**Endpoint:** `GET /twitter/tweet/advanced_search`

**Parameters:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| query | string | Yes | Search query (e.g., `@username`, `from:user`, `since:date`) |
| queryType | enum | Yes | `"Latest"` or `"Top"` |
| cursor | string | No | Pagination cursor (empty string for first page) |

**Request:**

```bash
curl --request GET \
  --url 'https://api.twitterapi.io/twitter/tweet/advanced_search?query=@botusername&queryType=Latest' \
  --header 'X-API-Key: YOUR_API_KEY'
```

**Response:**

```json
{
  "status": "success",
  "tweets": [
    {
      "id": "1234567890",
      "text": "@botusername find this thread",
      "author": {
        "id": "9876543210",
        "userName": "someuser"
      },
      "inReplyToId": "1111111111",
      "createdAt": "2024-01-15T10:30:00.000Z",
      "likeCount": 5,
      "replyCount": 2,
      "retweetCount": 1,
      "viewCount": 100
    }
  ],
  "has_next_page": true,
  "next_cursor": "cursor_string_here"
}
```

---

### 2. Get Tweets by IDs

Fetch one or more tweets by their IDs.

**Endpoint:** `GET /twitter/tweets`

**Parameters:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| tweet_ids | string | Yes | Comma-separated tweet IDs (e.g., `123,456,789`) |

**Request:**

```bash
curl --request GET \
  --url 'https://api.twitterapi.io/twitter/tweets?tweet_ids=1234567890' \
  --header 'X-API-Key: YOUR_API_KEY'
```

**Response:**

```json
{
  "status": "success",
  "tweets": [
    {
      "id": "1234567890",
      "text": "Tweet content here",
      "url": "https://twitter.com/user/status/1234567890",
      "author": {
        "id": "9876543210",
        "userName": "username",
        "name": "Display Name"
      },
      "inReplyToId": "1111111111",
      "createdAt": "2024-01-15T10:30:00.000Z",
      "likeCount": 100,
      "replyCount": 25,
      "retweetCount": 10,
      "viewCount": 5000,
      "extendedEntities": {
        "media": [
          {
            "type": "photo",
            "media_url_https": "https://pbs.twimg.com/media/xxx.jpg",
            "url": "https://t.co/xxx"
          }
        ]
      }
    }
  ],
  "message": "Success"
}
```

---

### 3. Get User Info

Fetch user profile information.

**Endpoint:** `GET /twitter/user/info`

**Parameters:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| userName | string | Yes | Twitter screen name (without @) |

**Request:**

```bash
curl --request GET \
  --url 'https://api.twitterapi.io/twitter/user/info?userName=elonmusk' \
  --header 'X-API-Key: YOUR_API_KEY'
```

**Response:**

```json
{
  "status": "success",
  "data": {
    "id": "44196397",
    "userName": "elonmusk",
    "name": "Elon Musk",
    "description": "Bio text here",
    "location": "Austin, Texas",
    "url": "https://twitter.com/elonmusk",
    "profilePicture": "https://pbs.twimg.com/profile_images/xxx.jpg",
    "coverPicture": "https://pbs.twimg.com/profile_banners/xxx.jpg",
    "followers": 150000000,
    "following": 500,
    "isBlueVerified": true,
    "createdAt": "2009-06-02T00:00:00.000Z",
    "statusesCount": 30000,
    "favouritesCount": 25000,
    "mediaCount": 1000,
    "pinnedTweetIds": ["1234567890"]
  },
  "msg": "Success"
}
```

---

### 4. Get User Last Tweets

Fetch recent tweets from a user's timeline.

**Endpoint:** `GET /twitter/user/last_tweets`

**Parameters:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| userId | string | No* | User ID (recommended - faster and more stable) |
| userName | string | No* | Screen name (alternative to userId) |
| cursor | string | No | Pagination cursor (empty for first page) |
| includeReplies | boolean | No | Include replies (default: false) |

*One of `userId` or `userName` is required.

**Request:**

```bash
curl --request GET \
  --url 'https://api.twitterapi.io/twitter/user/last_tweets?userName=username&includeReplies=false' \
  --header 'X-API-Key: YOUR_API_KEY'
```

**Response:**

```json
{
  "status": "success",
  "tweets": [...],
  "has_next_page": true,
  "next_cursor": "cursor_string",
  "message": "Success"
}
```

---

### 5. Get Tweet Thread Context

Fetch the full conversation thread for a tweet.

**Endpoint:** `GET /twitter/tweet/thread_context`

**Parameters:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| tweetId | string | Yes | Tweet ID (can be reply or original) |
| cursor | string | No | Pagination cursor |

**Request:**

```bash
curl --request GET \
  --url 'https://api.twitterapi.io/twitter/tweet/thread_context?tweetId=1234567890' \
  --header 'X-API-Key: YOUR_API_KEY'
```

**Response:**

```json
{
  "status": "success",
  "replies": [...],
  "has_next_page": false,
  "next_cursor": "",
  "message": "Success"
}
```

---

### 6. Login V2

Login to Twitter and get a cookie for posting. Single-step login.

**Endpoint:** `POST /twitter/user_login_v2`

**Request Body:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| user_name | string | Yes | Twitter username |
| email | string | Yes | Twitter email |
| password | string | Yes | Twitter password |
| proxy | string | Yes | Residential proxy (format: `http://user:pass@ip:port`) |
| totp_secret | string | No | 2FA TOTP secret (recommended for reliability) |

**Request:**

```bash
curl --request POST \
  --url 'https://api.twitterapi.io/twitter/user_login_v2' \
  --header 'X-API-Key: YOUR_API_KEY' \
  --header 'Content-Type: application/json' \
  --data '{
    "user_name": "findthisthread",
    "email": "your@email.com",
    "password": "yourpassword",
    "proxy": "http://user:pass@ip:port",
    "totp_secret": "YOUR2FASECRET"
  }'
```

**Response:**

```json
{
  "status": "success",
  "login_cookie": "auth_token=xxx; ct0=yyy; ...",
  "msg": ""
}
```

**Cost:** $0.003 per call

---

### 7. Create Tweet V2 (Post Reply)

Post a new tweet or reply. Requires login cookie from V2 login.

**Endpoint:** `POST /twitter/create_tweet_v2`

**Request Body:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| login_cookies | string | Yes | Cookie from `/twitter/user_login_v2` |
| tweet_text | string | Yes | Tweet content |
| proxy | string | Yes | Residential proxy |
| reply_to_tweet_id | string | No | Tweet ID to reply to |
| attachment_url | string | No | URL for quote tweet |
| media_ids | array | No | Media IDs to attach |
| is_note_tweet | boolean | No | Allow >280 chars (Premium only) |

**Request:**

```bash
curl --request POST \
  --url 'https://api.twitterapi.io/twitter/create_tweet_v2' \
  --header 'X-API-Key: YOUR_API_KEY' \
  --header 'Content-Type: application/json' \
  --data '{
    "login_cookies": "auth_token=xxx; ct0=yyy",
    "tweet_text": "Hello from the bot!",
    "proxy": "http://user:pass@ip:port",
    "reply_to_tweet_id": "1234567890"
  }'
```

**Response:**

```json
{
  "status": "success",
  "tweet_id": "9999999999",
  "msg": ""
}
```

**Cost:** $0.003 per call

---

## Common Response Fields

### Tweet Object

| Field | Type | Description |
|-------|------|-------------|
| id | string | Tweet ID |
| text | string | Tweet content |
| url | string | Full tweet URL |
| author | object | Author info (`id`, `userName`, `name`) |
| inReplyToId | string | Parent tweet ID (if reply) |
| createdAt | string | ISO timestamp |
| likeCount | number | Number of likes |
| replyCount | number | Number of replies |
| retweetCount | number | Number of retweets |
| viewCount | number | View count |
| extendedEntities | object | Media attachments |

### Pagination

Most list endpoints return:

| Field | Type | Description |
|-------|------|-------------|
| has_next_page | boolean | More results available |
| next_cursor | string | Use as `cursor` param for next page |

---

## Error Handling

**Error Response (400):**

```json
{
  "status": "error",
  "error": 400,
  "message": "Error description here"
}
```

---

## Rate Limits

- Default: 200 QPS per client
- Enterprise limits available on request

---

## Resources

- [Full Documentation](https://docs.twitterapi.io)
- [Dashboard](https://twitterapi.io/dashboard)
- [Authentication Guide](https://docs.twitterapi.io/authentication)
