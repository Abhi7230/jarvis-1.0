---
title: Jarvis Job Search Agent
emoji: 🤖
colorFrom: blue
colorTo: purple
sdk: docker
app_port: 7860
pinned: false
duplicated_from: abhir0609/jarvis
---

# Jarvis - AI Job Search Agent 🤖

Your personal AI assistant that automates job search outreach via Telegram.

[![Duplicate this Space](https://huggingface.co/datasets/huggingface/badges/resolve/main/duplicate-this-space-xl.svg)](https://huggingface.co/spaces/abhir0609/jarvis?duplicate=true)

## One-Click Setup

1. Click **"Duplicate this Space"** above
2. Add these secrets in your Space settings:

| Secret | How to get it (free) |
|--------|---------------------|
| `TELEGRAM_BOT_TOKEN` | Message [@BotFather](https://t.me/BotFather) on Telegram → `/newbot` |
| `GROQ_API_KEY` | [console.groq.com](https://console.groq.com) (free) |
| `GEMINI_API_KEY` | [aistudio.google.com](https://aistudio.google.com/apikey) (free) |
| `ENCRYPTION_KEY` | Run: `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"` |
| `ANTHROPIC_API_KEY` | *(optional, paid)* [console.anthropic.com](https://console.anthropic.com) |

3. Your bot is live! Message it on Telegram.

## What it does

- 🔍 Search LinkedIn for recruiters at any company
- 💬 Send personalized messages to connections
- 📊 Track outreach, responses, and follow-ups
- 🤖 AI-powered with Groq + Gemini + Claude fallback
- 📅 Auto follow-up reminders
- 💼 Save and manage job applications

## Commands

- `/start` — Get started
- `/login_linkedin` — Connect your LinkedIn
- `/plan` — View your plan & usage
- `/upgrade` — Upgrade to Pro/Premium
- `/stats` — View outreach stats
- `/help` — All commands

Or just type naturally: *"Search for recruiters at Google"*

## Tech Stack

- **Interface**: Telegram Bot (grammY)
- **LLMs**: Groq (free) → Gemini (free) → Claude (paid fallback)
- **Automation**: Playwright + Chromium
- **Database**: SQLite
- **Hosting**: HuggingFace Spaces (free Docker)
