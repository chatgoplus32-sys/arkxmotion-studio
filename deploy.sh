#!/bin/bash
set -e

echo "🚀 Deploying ARKXMotion Studio..."

# Navigate to project directory
cd "$(dirname "$0")"

# Install dependencies
echo "📦 Installing dependencies..."
npm install --production=false

# Cek identifier tak terdefinisi + API CommonJS di file ESM
# (pernah menyebabkan outage produksi: server gagal boot / R2 tak pernah upload)
echo "🔎 Memeriksa identifier tak terdefinisi..."
node scripts/check-undefined.mjs

# Build frontend
echo "🔨 Building frontend..."
npm run build

# Create logs directory if not exists
mkdir -p logs

# Copy .env from parent or existing
if [ ! -f .env ] && [ -f ../.env ]; then
  echo "📋 Copying .env from parent directory..."
  cp ../.env .env
fi

# Smoke test — pastikan server benar-benar bisa boot SEBELUM menimpa proses
# produksi yang sedang jalan. Kalau gagal, deploy dibatalkan dan versi lama
# tetap melayani user (bukan malah ikut mati jadi 502).
echo "🧪 Menjalankan smoke test..."
if ! bash scripts/smoke-test.sh; then
  echo "❌ Deploy DIBATALKAN — server baru gagal boot. Versi lama tetap jalan."
  exit 1
fi

# Restart with PM2
echo "🔄 Restarting server with PM2..."
if pm2 describe arkxmotion-studio > /dev/null 2>&1; then
  pm2 restart arkxmotion-studio --update-env
else
  pm2 start ecosystem.config.cjs
  pm2 save
fi

echo "✅ Deploy complete!"
echo "🌐 Server running on http://localhost:${PORT:-6000}"
echo "📊 Monitor: pm2 monit"
echo "📋 Logs: pm2 logs arkxmotion-studio"
