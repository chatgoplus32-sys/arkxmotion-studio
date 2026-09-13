#!/bin/bash
# ──────────────────────────────────────────────────────
# ArkX Motion Studio — VPS Deploy Script (Hetzner)
# Untuk Ubuntu 22.04, jalankan sebagai root
# ──────────────────────────────────────────────────────
set -e

DOMAIN="arkxmotion-studio.win"
APP_DIR="/opt/arkxmotion-studio"
REPO="https://github.com/chatgoplus32-sys/arkxmotion-studio.git"

echo "=== ArkX Motion Studio VPS Deploy ==="
echo ""

# 1. Update system
echo "[1/8] Updating system..."
apt update && apt upgrade -y

# 2. Install Node.js 22
echo "[2/8] Installing Node.js 22..."
curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
apt install -y nodejs

# 3. Install git, nginx, certbot
echo "[3/8] Installing git, nginx, certbot..."
apt install -y git nginx certbot python3-certbot-nginx

# 4. Clone repo
echo "[4/8] Cloning repository..."
rm -rf $APP_DIR
git clone $REPO $APP_DIR
cd $APP_DIR

# 5. Install dependencies
echo "[5/8] Installing npm dependencies..."
npm install

# 6. Setup PM2 (process manager)
echo "[6/8] Setting up PM2..."
npm install -g pm2

# Stop old process if exists
pm2 delete arkxmotion 2>/dev/null || true

# Start app
pm2 start "npx tsx server/index.ts" --name arkxmotion
pm2 save
pm2 startup

# 7. Setup Nginx
echo "[7/8] Setting up Nginx..."
cat > /etc/nginx/sites-available/arkxmotion << 'NGINX'
server {
    listen 80;
    server_name arkxmotion-studio.win www.arkxmotion-studio.win;

    # Max upload size
    client_max_body_size 50M;

    # Proxy ke Express backend
    location / {
        proxy_pass http://localhost:6000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
        proxy_read_timeout 300s;
        proxy_connect_timeout 75s;
    }

    # Vite static files (dist)
    location /assets/ {
        alias /opt/arkxmotion-studio/dist/assets/;
        expires 1y;
        add_header Cache-Control "public, immutable";
    }

    # Cache static files
    location ~* \.(js|css|png|jpg|jpeg|gif|ico|svg|woff|woff2)$ {
        proxy_pass http://localhost:6000;
        expires 7d;
        add_header Cache-Control "public, immutable";
    }
}
NGINX

ln -sf /etc/nginx/sites-available/arkxmotion /etc/nginx/sites-enabled/
rm -f /etc/nginx/sites-enabled/default
nginx -t
systemctl reload nginx

# 8. SSL (Let's Encrypt)
echo "[8/8] Installing SSL certificate..."
certbot --nginx -d $DOMAIN -d www.$DOMAIN --non-interactive --agree-tos --email admin@$DOMAIN

# Done
echo ""
echo "=== Deploy Selesai! ==="
echo "Site: https://$DOMAIN"
echo "Backend: http://localhost:6000"
echo "Logs: pm2 logs arkxmotion"
echo "Restart: pm2 restart arkxmotion"
