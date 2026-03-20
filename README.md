---
title: Jarvis Job Search Agent
emoji: 🤖
colorFrom: blue
colorTo: purple
sdk: docker
app_port: 7860
pinned: false
---

# Jarvis — Autonomous AI Job Search Agent

Jarvis is an AI-powered job search agent that runs 24/7 to help you land your next role. It automates recruiter outreach on LinkedIn, tracks conversations, sends follow-ups, and gives you daily progress reports — all through Telegram.

## Features

- **LinkedIn Automation** — Searches for recruiters matching your criteria and sends personalized messages via browser automation (Playwright)
- **Smart Follow-ups** — Automatically reminds you about recruiters who haven't replied in 3+ days
- **Daily Summaries** — Get stats on recruiters found, contacted, replied, and pending follow-ups every evening
- **Resume Updates** — Edit your Overleaf resume directly through chat (Premium)
- **Gmail Integration** — Track job application emails (Pro+)
- **Multi-LLM Fallback** — Uses Groq → Claude → Gemini for reliable AI responses
- **Multi-User SaaS** — Subscription tiers (Free, Pro, Premium) with Stripe billing

## How to Use

1. Find the Jarvis bot on Telegram
2. Send `/start` to begin
3. Use `/login_linkedin` to connect your LinkedIn account
4. Chat naturally — e.g. *"Find ML recruiters in San Francisco"* or *"Follow up with anyone who hasn't replied"*
5. Upgrade with `/upgrade` for more daily searches and messages

## Commands

| Command | Description |
|---------|-------------|
| `/start` | Register and get started |
| `/help` | See available commands |
| `/login_linkedin` | Connect your LinkedIn account |
| `/stats` | View your outreach statistics |
| `/plan` | See your current subscription plan |
| `/upgrade` | Upgrade to Pro or Premium |

## Tech Stack

- **Runtime**: Node.js + TypeScript
- **Bot Framework**: grammY (Telegram)
- **Browser Automation**: Playwright (Chromium)
- **Database**: SQLite (better-sqlite3)
- **LLMs**: Groq, Anthropic Claude, Google Gemini
- **Payments**: Stripe
- **Deployment**: Docker on HuggingFace Spaces

## Self-Hosting

```bash
# Clone and configure
cp .env.production.example .env.production

# Run with Docker
docker compose up -d
```

## API Endpoints

| Endpoint | Description |
|----------|-------------|
| `GET /` | Status landing page |
| `GET /health` | Health check (`{ status: 'ok', uptime }`) |
| `POST /webhooks/stripe` | Stripe payment webhook |
| `GET /payment/success` | Post-payment success page |
| `GET /payment/cancel` | Post-payment cancel page |

## License

Private — All rights reserved.
