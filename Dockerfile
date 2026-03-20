FROM node:20-slim

# Install system deps for Playwright Chromium + curl for healthcheck
RUN apt-get update && apt-get install -y \
    libnss3 libatk-bridge2.0-0 libdrm2 libxcomposite1 libxdamage1 \
    libxrandr2 libgbm1 libasound2 libpangocairo-1.0-0 libgtk-3-0 \
    libxshmfence1 fonts-noto-color-emoji fonts-freefont-ttf \
    ca-certificates wget git curl \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install ALL dependencies (including dev for tsc build)
COPY package*.json tsconfig.json ./
RUN npm ci

# Copy source code
COPY src/ ./src/

# Build TypeScript
RUN npx tsc

# Remove devDependencies after build
RUN npm prune --production

# Install Playwright Chromium
RUN npx playwright install chromium

# Create persistent data directory
RUN mkdir -p /data/browsers && chmod -R 777 /data

# HuggingFace Spaces runs on port 7860
ENV PORT=7860
ENV DATA_DIR=/data
ENV WHATSAPP_ENABLED=false
ENV NODE_ENV=production

EXPOSE 7860

HEALTHCHECK --interval=30s --timeout=10s --start-period=30s --retries=3 \
  CMD curl -f http://localhost:7860/health || exit 1

CMD ["node", "dist/index.js"]
