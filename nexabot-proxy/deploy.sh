#!/usr/bin/env bash
#
# deploy.sh — Deploy Nexabot Proxy ke VPS Ubuntu/Debian
#
# Jalankan di VPS:
#   bash deploy.sh
#
# Atau dari local:
#   ssh user@vps 'bash -s' < deploy.sh
#

set -euo pipefail

APP_DIR="/opt/nexabot-proxy"
NODE_VERSION="22"

echo "🚀 Deploy Nexabot Proxy ke VPS..."
echo ""

# ── 1. Install Node.js (kalau belum ada) ──
if ! command -v node &>/dev/null; then
  echo "📦 Installing Node.js ${NODE_VERSION}..."
  curl -fsSL https://deb.nodesource.com/setup_${NODE_VERSION}.x | bash -
  apt-get install -y nodejs
  echo "   ✅ Node.js $(node -v) terinstall"
else
  echo "   ℹ️ Node.js sudah ada: $(node -v)"
fi

# ── 2. Install PM2 (process manager) ──
if ! command -v pm2 &>/dev/null; then
  echo "📦 Installing PM2..."
  npm install -g pm2
  echo "   ✅ PM2 terinstall"
else
  echo "   ℹ️ PM2 sudah ada: $(pm2 -v)"
fi

# ── 3. Clone / Update repo ──
echo ""
echo "📂 Setup aplikasi..."
if [ -d "$APP_DIR" ]; then
  echo "   🔄 Update repo..."
  cd "$APP_DIR"
  git pull origin master
else
  echo "   📥 Clone repo..."
  git clone https://github.com/chatgoplus32-sys/arkxmotion-studio.git "$APP_DIR"
  cd "$APP_DIR"
fi

cd nexabot-proxy

# ── 4. Install dependencies ──
echo "📦 Install dependencies..."
npm install --production

# ── 5. Setup .env (kalau belum ada) ──
if [ ! -f .env ]; then
  echo ""
  echo "⚠️  File .env belum ada!"
  echo "   Copy .env.example ke .env lalu isi NEXABOT_MASTER_KEY:"
  echo ""
  echo "   cp .env.example .env"
  echo "   nano .env"
  echo ""
  cp .env.example .env
  echo "   📝 .env sudah dicopy dari .env.example"
  echo "   ⚠️  EDIT .env SEBELUM LANJUT! Isi NEXABOT_MASTER_KEY"
  echo ""
  read -p "Tekan Enter setelah edit .env..."
fi

# ── 6. Init database ──
echo ""
echo "🗄️  Init database..."
node init-db.js --seed

# ── 7. Setup PM2 ──
echo ""
echo "🔧 Setup PM2..."

# Stop jika sudah jalan
pm2 stop nexabot-proxy 2>/dev/null || true
pm2 delete nexabot-proxy 2>/dev/null || true

# Start
pm2 start server.js --name nexabot-proxy
pm2 save
pm2 startup 2>/dev/null || true

echo ""
echo "════════════════════════════════════════════"
echo "✅ DEPLOY SELESAI!"
echo "════════════════════════════════════════════"
echo ""
echo "📍 Lokasi: $APP_DIR/nexabot-proxy"
echo "🌐 Dashboard: http://$(hostname -I | awk '{print $1}'):3000/admin"
echo ""
echo "📋 Perintah berguna:"
echo "   pm2 status          — cek status server"
echo "   pm2 logs            — lihat log"
echo "   pm2 restart all     — restart server"
echo "   pm2 monit           — monitoring real-time"
echo ""
echo "⚠️  Jangan lupa:"
echo "   1. Edit .env isi NEXABOT_MASTER_KEY"
echo "   2. Buka port 3000 di firewall/VPS panel"
echo "   3. (Opsional) Setup Nginx reverse proxy + SSL"
echo ""
