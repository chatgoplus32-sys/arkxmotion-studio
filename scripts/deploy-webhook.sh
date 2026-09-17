#!/bin/bash
# ============================================================
# Lightweight Webhook Deploy Server
# Listens for GitHub push events and triggers deploy
# Run with: ./deploy-webhook.sh
# ============================================================

PORT="${DEPLOY_WEBHOOK_PORT:-9000}"
SECRET="${DEPLOY_WEBHOOK_SECRET:-}"
APP_DIR="/opt/arkxmotion-studio"
DEPLOY_LOCK="/tmp/arkxmotion-deploy.lock"

echo "🎣 Deploy webhook listening on port ${PORT}..."

# Simple HTTP server using netcat/socat
while true; do
  # Accept connection
  REQUEST=$(cat)

  # Extract path and body
  PATH=$(echo "$REQUEST" | head -1 | awk '{print $2}')
  BODY=$(echo "$REQUEST" | tail -n +2)

  if [ "$PATH" = "/deploy" ]; then
    # Verify secret if set
    if [ -n "$SECRET" ]; then
      if ! echo "$BODY" | grep -q "\"secret\":\"${SECRET}\""; then
        echo "HTTP/1.1 403 Forbidden"
        echo ""
        echo '{"error":"invalid secret"}'
        continue
      fi
    fi

    # Prevent concurrent deploys
    if [ -f "$DEPLOY_LOCK" ]; then
      echo "HTTP/1.1 409 Conflict"
      echo ""
      echo '{"error":"deploy in progress"}'
      continue
    fi

    touch "$DEPLOY_LOCK"

    echo "🚀 Deploy triggered at $(date)"

    # Run deploy in background
    (
      cd "$APP_DIR"
      git pull origin main
      npm install --production=false
      npm run build
      if pm2 describe arkxmotion > /dev/null 2>&1; then
        pm2 restart arkxmotion --update-env
      else
        pm2 start ecosystem.config.cjs
        pm2 save
      fi
      nginx -t 2>/dev/null && systemctl reload nginx 2>/dev/null || true
      rm -f "$DEPLOY_LOCK"
      echo "✅ Deploy complete at $(date)"
    ) >> "${APP_DIR}/logs/deploy.log" 2>&1 &

    echo "HTTP/1.1 200 OK"
    echo ""
    echo '{"status":"deploying"}'
  elif [ "$PATH" = "/health" ]; then
    echo "HTTP/1.1 200 OK"
    echo ""
    echo '{"status":"ok"}'
  else
    echo "HTTP/1.1 404 Not Found"
    echo ""
    echo '{"error":"not found"}'
  fi
done
