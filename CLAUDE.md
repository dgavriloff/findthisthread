# Project Guidelines

## Runtime & Package Manager
- Use **Bun** as the runtime and package manager (not Node.js/npm)
- Use TypeScript directly without compilation step
- Run with `bun run src/index.ts`

## Tech Stack
- **Runtime**: Bun + TypeScript
- **Vision API**: Google Gemini (gemini-2.0-flash)
- **Twitter API**: twitterapi.io
- **Database**: SQLite via bun:sqlite
- **Reddit**: Reddit JSON API

## Commands
- `bun install` - Install dependencies
- `bun run src/index.ts` - Run the bot
- `bun run dev` - Run with watch mode
