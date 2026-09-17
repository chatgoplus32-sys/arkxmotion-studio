#!/bin/bash
set -e

# ============================================================
# ARKXMotion Studio — VPS Setup Script
# Run this ONCE on a fresh Ubuntu/Debian VPS
# ============================================================

DOMAIN="arkxmotion-studio.win"
EMAIL="admin@${DOMAIN}"  # Change this to your email for SSL cert
APP_DIR="/opt/arkxmotion-studio"

echo "🚀 ARKXMotion Studio — VPS Setup"
echo "================================"

# --- 1. System dependencies ---
echo ""
echo "📦 Installing system dependencies..."
apt update -y
apt install -y curl git build-essential nginx certbot python3-certbot-nginx

# --- 2. Install Node.js 20 LTS ---
echo ""
echo "📦 Installing Node.js 20 LTS..."
if ! command -v node &> /dev/null; then
  curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
  apt install -y nodejs
fi
echo "Node: $(node -v) | npm: $(npm -v)"

# --- 3. Install PM2 globally ---
echo ""
echo "📦 Installing PM2..."
npm install -g pm2
pm2 startup systemd -u root --hp /root

# --- 4. Clone app ---
echo ""
echo "📁 Cloning app to ${APP_DIR}..."
if [ -d "${APP_DIR}" ]; then
  cd "${APP_DIR}"
  git pull origin main
else
  git clone https://github.com/chatgoplus32-sys/arkxmotion-studio.git "${APP_DIR}"
  cd "${APP_DIR}"
fi

# --- 5. Install dependencies & build ---
echo ""
echo "🔨 Building app..."
npm install
npm run build

# --- 6. Setup .env ---
if [ ! -f .env ]; then
  echo ""
  echo "⚠️  No .env file found. Copying from .env.example..."
  cp .env.example .env
  echo "📝 Please edit .env with your secrets:"
  echo "    nano ${APP_DIR}/.env"
fi

# --- 7. Create logs directory ---
mkdir -p "${APP_DIR}/logs"

# --- 8. Setup Nginx ---
echo ""
echo "🌐 Configuring Nginx..."

# Copy nginx config
cp "${APP_DIR}/nginx/arkxmotion-studio.conf" /etc/nginx/sites-available/arkxmotion-studio

# Enable site
ln -sf /etc/nginx/sites-available/arkxmotion-studio /etc/nginx/sites-enabled/
rm -f /etc/nginx/sites-enabled/default

# Test config
nginx -t

# --- 9. Start Nginx ---
systemctl restart nginx
systemctl enable nginx

# --- 10. Setup SSL with Certbot ---
echo ""
echo "🔒 Setting up SSL..."
certbot certonly --webroot \
  -w /var/www/certbot \
  -d "${DOMAIN}" \
  -d "www.${DOMAIN}" \
  --email "${EMAIL}" \
  --agree-tos \
  --non-interactive

# Reload nginx to use SSL
systemctl reload nginx

# Auto-renewal cron
echo "0 0,12 * * * root certbot renew --quiet --post-hook 'systemctl reload nginx'" > /etc/cron.d/certbot-renew

# --- 11. Start app with PM2 ---
echo ""
echo "🚀 Starting app with PM2..."
cd "${APP_DIR}"
pm2 start ecosystem.config.cjs
pm2 save

# --- 12. Firewall ---
echo ""
echo "🔥 Configuring firewall..."
if command -v ufw &> /dev/null; then
  ufw allow 'Nginx Full'
  ufw allow ssh
  ufw --force enable
fi

echo ""
echo "✅ Setup complete!"
echo ""
echo "🌐 Site: https://${DOMAIN}"
echo "📊 PM2: pm2 monit"
echo "📋 Logs: pm2 logs arkxmotion"
echo "🔄 Restart: pm2 restart arkxmotion"
echo ""
echo "📝 Don't forget to:"
echo "   1. Edit ${APP_DIR}/.env with your secrets"
echo "   2. Restart: pm2 restart arkxmotion --update-env"
