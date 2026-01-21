import { GoogleGenerativeAI } from '@google/generative-ai';
import { RedditPostInfo } from './types';

const EXTRACTION_PROMPT = `Analyze this image of a Reddit post screenshot. Extract the following information if visible:

1. Subreddit name - appears as "r/subredditname" near the top (without the r/ prefix)
2. Username of the poster - appears as "u/username" or "Posted by u/username" (without u/ prefix)
3. Post title - the MAIN HEADLINE in large/bold text at the top of the post, NOT the body text
4. Body snippet - the smaller text content below the title (first ~100 chars)
5. Timestamp shown (e.g., "17h ago", "2 days ago")

IMPORTANT: The title is the large clickable headline, not the body paragraph text. Look for text that appears larger/bolder than the rest.

Return ONLY valid JSON with no markdown formatting:
{
  "subreddit": "...",
  "username": "...",
  "title": "...",
  "bodySnippet": "...",
  "timestamp": "...",
  "confidence": "high|medium|low"
}

If this is not a Reddit screenshot, return:
{
  "error": "reason why extraction failed",
  "confidence": "low"
}`;

export class VisionExtractor {
  private genAI: GoogleGenerativeAI;
  private model: any;

  constructor(apiKey: string) {
    this.genAI = new GoogleGenerativeAI(apiKey);
    this.model = this.genAI.getGenerativeModel({ model: 'gemini-2.0-flash' });
  }

  async extractRedditInfo(imageBuffer: Buffer): Promise<RedditPostInfo> {
    try {
      const base64Image = imageBuffer.toString('base64');
      const mimeType = this.detectMimeType(imageBuffer);

      const result = await this.model.generateContent([
        EXTRACTION_PROMPT,
        {
          inlineData: {
            data: base64Image,
            mimeType,
          },
        },
      ]);

      const response = await result.response;
      const text = response.text();

      // Clean up response - remove markdown code blocks if present
      let jsonText = text.trim();
      if (jsonText.startsWith('```json')) {
        jsonText = jsonText.slice(7);
      } else if (jsonText.startsWith('```')) {
        jsonText = jsonText.slice(3);
      }
      if (jsonText.endsWith('```')) {
        jsonText = jsonText.slice(0, -3);
      }
      jsonText = jsonText.trim();

      const parsed = JSON.parse(jsonText) as RedditPostInfo;
      return parsed;
    } catch (error) {
      console.error('Vision extraction error:', error);
      return {
        subreddit: null,
        username: null,
        title: null,
        bodySnippet: null,
        timestamp: null,
        confidence: 'low',
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  private detectMimeType(buffer: Buffer): string {
    // Check magic bytes for common image formats
    if (buffer[0] === 0xff && buffer[1] === 0xd8) {
      return 'image/jpeg';
    }
    if (buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47) {
      return 'image/png';
    }
    if (buffer[0] === 0x47 && buffer[1] === 0x49 && buffer[2] === 0x46) {
      return 'image/gif';
    }
    if (buffer[0] === 0x52 && buffer[1] === 0x49 && buffer[2] === 0x46 && buffer[3] === 0x46) {
      return 'image/webp';
    }
    // Default to jpeg
    return 'image/jpeg';
  }
}
