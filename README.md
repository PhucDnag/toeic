This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

## API keys

Create `.env.local` and keep the existing single-key configuration, or add a Groq key pool:

```env
# Existing primary key (optional when GROQ_API_KEYS is set)
GROQ_API_KEY=gsk_primary_key

# Easiest way to add several fallback keys
GROQ_API_KEYS=gsk_second_key,gsk_third_key,gsk_fourth_key

# Numbered variables are also supported
GROQ_API_KEY_1=gsk_another_key
GROQ_API_KEY_2=gsk_another_key
```

The server removes duplicate keys. It uses the current key until Groq reports a rate limit, exhausted quota, or invalid credentials, then automatically tries the next available key. A rate-limited key cools down before it can be selected again. If every Groq key is unavailable, transcription can fall back to `OPENAI_API_KEY`, while question solving can fall back to `GEMINI_API_KEY` and then `OPENAI_API_KEY` when those variables are configured.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.
