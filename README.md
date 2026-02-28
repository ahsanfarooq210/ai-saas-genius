# AI SaaS Genius - MERN Stack

This project has been migrated from a Next.js application to a MERN stack (MongoDB, Express, React, Node.js). It is organized as a monorepo with `front-end` and `backend` directories.

## Prerequisites

- Node.js (v18+)
- MongoDB (running locally or a cloud URI)
- Stripe Account (for payments)
- OpenAI API Key
- Replicate API Token
- GitHub OAuth App (for Better Auth)

## Environment Variables

Create a `.env` file in the `backend` directory with the following:

```env
PORT=5000
DATABASE_URL=mongodb://localhost:27017/ai-saas
OPENAI_API_KEY=your_openai_key
REPLICATE_API_TOKEN=your_replicate_token
STRIPE_API_KEY=your_stripe_secret_key
STRIPE_WEBHOOK_SECRET=your_stripe_webhook_secret
GITHUB_CLIENT_ID=your_github_client_id
GITHUB_CLIENT_SECRET=your_github_client_secret
BETTER_AUTH_SECRET=your_better_auth_secret
BETTER_AUTH_URL=http://localhost:5000
SETTINGS_URL=http://localhost:5173/settings
```

## Getting Started

### 1. Backend

```bash
cd backend
npm install
npm run dev
```

The backend server will start on `http://localhost:5000`.

### 2. Front-end

```bash
cd front-end
npm install
npm run dev
```

The front-end client will start on `http://localhost:5173`.

## Architecture

- **Front-end:** React (Vite), Tailwind CSS, Shadcn UI, Better Auth Client
- **Backend:** Node.js, Express, Mongoose (MongoDB), Better Auth Server
- **Features:**
  - Authentication (GitHub, Email/Password via Better Auth)
  - AI Generation (Code, Conversation, Image, Music, Video)
  - Subscription Management (Stripe)
  - API Usage Limits (MongoDB)

## License

ISC
