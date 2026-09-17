#!/bin/bash
set -e

# ============================================================
# Setup Git Auto-Deploy Hook on VPS
# Run this ONCE on your VPS after initial clone
# ============================================================

APP_DIR="/var/www/arkxmotion-studio/arkxmotion-studio"

echo "🪝 Setting up git auto-deploy hook..."

# Create the post-receive hook
cat > "${APP_DIR}/.git/hooks/post-receive" << 'HOOK'
#!/bin/bash
set -e

APP_DIR="/var/www/arkxmotion-studio/arkxmotion-studio"
DEPLOY_LOG="${APP_DIR}/logs/deploy.log"

echo "$(date '+%Y-%m-%d %H:%M:%S') 🚀 Auto-deploy triggered" >> "$DEPLOY_LOG"

cd "$APP_DIR"

# Pull latest
echo "🔄 Pulling latest changes..."
git --work-tree="$APP_DIR" --git-dir="/var/www/arkxmotion-studio/.git" checkout main --force

# Install deps
echo "📦 Installing dependencies..."
npm install --production=false 2>&1 | tail -3

# Build
echo "🔨 Building frontend..."
npm run build 2>&1 | tail -3

# Restart PM2
echo "🔄 Restarting server..."
if pm2 describe arkxmotion-studio > /dev/null 2>&1; then
  pm2 restart arkxmotion-studio --update-env
else
  pm2 start "${APP_DIR}/ecosystem.config.cjs"
  pm2 save
fi

# Reload Nginx
echo "🌐 Reloading Nginx..."
nginx -t 2>/dev/null && systemctl reload nginx 2>/dev/null || true

echo "$(date '+%Y-%m-%d %H:%M:%S') ✅ Deploy complete" >> "$DEPLOY_LOG"
HOOK

chmod +x "${APP_DIR}/.git/hooks/post-receive"

echo "✅ Hook installed!"
echo ""
echo "Sekarang setiap git push ke VPS akan otomatis deploy."
echo "Cara pakai:"
echo "  1. Tambah remote: git remote add vps ssh://root@your-vps-ip/var/www/arkxmotion-studio/.git"
echo "  2. Push: git push vps main"
