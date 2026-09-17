#!/bin/bash
set -e

# ============================================================
# Quick Deploy — run this after git pull on VPS
# ============================================================

echo "🚀 Deploying ARKXMotion Studio..."

cd "$(dirname "$0")/.."

# Install deps
echo "📦 Installing dependencies..."
npm install --production=false

# Build frontend
echo "🔨 Building frontend..."
npm run build

# Create logs dir
mkdir -p logs

# Copy .env from parent if missing
if [ ! -f .env ] && [ -f ../.env ]; then
  cp ../.env .env
  echo "📋 Copied .env from parent directory"
fi

# Restart PM2
echo "🔄 Restarting server..."
if pm2 describe arkxmotion > /dev/null 2>&1; then
  pm2 restart arkxmotion --update-env
else
  pm2 start ecosystem.config.cjs
  pm2 save
fi

# Reload nginx
echo "🌐 Reloading Nginx..."
nginx -t && systemctl reload nginx 2>/dev/null || true

echo ""
echo "✅ Deploy complete!"
echo "🌐 https://arkxmotion-studio.win"
echo "📊 pm2 monit"
echo "📋 pm2 logs arkxmotion"
