#!/bin/bash
# ──────────────────────────────────────────────────────
# ArkX Motion Studio — VPS Deploy Script
# IDCloudHost / Ubuntu 24-26, non-root user (sudo)
# ──────────────────────────────────────────────────────
set -e

DOMAIN="arkxmotion-studio.win"
APP_DIR="/opt/arkxmotion-studio"
REPO="https://github.com/chatgoplus32-sys/arkxmotion-studio.git"
JWT_SECRET=$(openssl rand -hex 32)

echo "========================================="
echo "  ArkX Motion Studio — VPS Deploy"
echo "========================================="
echo ""

# 1. Update system
echo "[1/9] Updating system..."
sudo apt update && sudo apt upgrade -y

# 2. Install Node.js 22
echo "[2/9] Installing Node.js 22..."
if ! command -v node &>/dev/null || [[ $(node -v | cut -d. -f1 | tr -d 'v') -lt 20 ]]; then
  curl -fsSL https://deb.nodesource.com/setup_22.x | sudo bash -
  sudo apt install -y nodejs
fi
echo "  Node: $(node -v) | npm: $(npm -v)"

# 3. Install git, nginx, certbot
echo "[3/9] Installing git, nginx, certbot..."
sudo apt install -y git nginx certbot python3-certbot-nginx

# 4. Clone repo
echo "[4/9] Cloning repository..."
sudo rm -rf $APP_DIR
sudo git clone $REPO $APP_DIR
sudo chown -R $(whoami) $(dirname $APP_DIR)
cd $APP_DIR

# 5. Create .env
echo "[5/9] Creating .env..."
if [ ! -f .env ]; then
  cat > .env << ENVEOF
PORT=6000
APP_URL=http://localhost:6000
JWT_SECRET=${JWT_SECRET}
JWT_REFRESH_SECRET=$(openssl rand -hex 32)
CRON_SECRET=$(openssl rand -hex 16)
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=
SMTP_PASS=
MAIL_FROM=ARKXMotion Studio
ENVEOF
  echo "  .env created with random secrets"
fi

# 6. Install dependencies & build
echo "[6/9] Installing dependencies & building..."
npm install
npm run build

# 7. Setup PM2
echo "[7/9] Setting up PM2..."
sudo npm install -g pm2 2>/dev/null || true
pm2 delete arkxmotion 2>/dev/null || true
pm2 start "npx tsx server/index.ts" --name arkxmotion
pm2 save
sudo pm2 startup systemd -u $(whoami) --hp $(pwd) 2>/dev/null || true

# 8. Setup Nginx
echo "[8/9] Setting up Nginx..."
sudo tee /etc/nginx/sites-available/arkxmotion > /dev/null << 'NGINX'
server {
    listen 80;
    server_name arkxmotion-studio.win www.arkxmotion-studio.win;

    client_max_body_size 50M;

    # Static files dari dist/
    root /opt/arkxmotion-studio/dist;
    index index.html;

    # API → Express backend
    location /api/ {
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

    # Static assets — long cache
    location /assets/ {
        expires 1y;
        add_header Cache-Control "public, immutable";
    }

    # Cache static files
    location ~* \.(js|css|png|jpg|jpeg|gif|ico|svg|woff|woff2)$ {
        expires 7d;
        add_header Cache-Control "public, immutable";
    }

    # SPA fallback — semua route non-file → index.html
    location / {
        try_files $uri $uri/ /index.html;
    }
}
NGINX

sudo ln -sf /etc/nginx/sites-available/arkxmotion /etc/nginx/sites-enabled/
sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t
sudo systemctl reload nginx

# 9. SSL (Let's Encrypt)
echo "[9/9] Installing SSL certificate..."
sudo certbot --nginx -d $DOMAIN -d www.$DOMAIN --non-interactive --agree-tos --email admin@$DOMAIN || echo "  SSL gagal — bisa di-setup nanti setelah domain pointing"

# Done
echo ""
echo "========================================="
echo "  Deploy Selesai!"
echo "========================================="
echo "  Site    : https://$DOMAIN"
echo "  Backend : http://localhost:6000"
echo "  Logs    : pm2 logs arkxmotion"
echo "  Restart : pm2 restart arkxmotion"
echo "  PM2 web : pm2 monit"
echo "========================================="
