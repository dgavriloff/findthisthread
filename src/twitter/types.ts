export interface Media {
  type: string;
  url: string;
  media_url_https?: string;
}

export interface Tweet {
  id: string;
  text: string;
  author_id: string;
  author_username: string;
  in_reply_to_status_id?: string;
  media?: Media[];
  created_at: string;
}

export interface Mention {
  id: string;
  text: string;
  author_id: string;
  author_username: string;
  in_reply_to_status_id?: string;
  created_at: string;
}

export interface TwitterApiResponse<T> {
  status: string;
  data?: T;
  error?: string;
}

// twitterapi.io webhook payload
export interface WebhookTweet {
  id: string;
  text: string;
  author?: {
    id?: string;
    username?: string;
    userName?: string;  // fallback for API inconsistency
    name?: string;
  };
  inReplyToId?: string;
  in_reply_to_status_id?: string;
  createdAt?: string;
  created_at?: string;
}

export interface WebhookPayload {
  event_type: string;
  rule_id?: string;
  rule_tag?: string;
  tweets: WebhookTweet[];
  timestamp: string | number;
}
