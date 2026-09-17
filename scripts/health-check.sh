#!/bin/bash
# ============================================================
# Health Check Cron Script
# Run every 5 minutes via cron:
#   */5 * * * * /var/www/arkxmotion-studio/arkxmotion-studio/scripts/health-check.sh
# ============================================================

URL="${HEALTH_URL:-http://localhost:6000/api/health}"
LOG="/var/www/arkxmotion-studio/arkxmotion-studio/logs/health.log"
ALERT_WEBHOOK="${ALERT_WEBHOOK_URL:-}"
MAX_RETRIES=2
TIMEOUT=10

mkdir -p "$(dirname "$LOG")"

# Check health
STATUS=$(curl -s -o /dev/null -w "%{http_code}" --max-time "$TIMEOUT" "$URL" 2>/dev/null)
BODY=$(curl -s --max-time "$TIMEOUT" "$URL" 2>/dev/null)

TIMESTAMP=$(date '+%Y-%m-%d %H:%M:%S')

if [ "$STATUS" = "200" ]; then
  # Check if upstream services are healthy
  HEALTH_STATUS=$(echo "$BODY" | grep -o '"status":"[^"]*"' | head -1 | cut -d'"' -f4)

  if [ "$HEALTH_STATUS" = "ok" ]; then
    echo "[$TIMESTAMP] ✅ OK" >> "$LOG"
    exit 0
  fi
fi

# Something is wrong — log and alert
echo "[$TIMESTAMP] ❌ HEALTH CHECK FAILED (HTTP $STATUS)" >> "$LOG"
echo "[$TIMESTAMP] Response: $BODY" >> "$LOG"

# Send alert if webhook is configured
if [ -n "$ALERT_WEBHOOK" ]; then
  IS_DISCORD=$(echo "$ALERT_WEBHOOK" | grep -c "discord.com")

  if [ "$IS_DISCORD" -gt 0 ]; then
    curl -s -X POST "$ALERT_WEBHOOK" \
      -H "Content-Type: application/json" \
      -d "{\"embeds\":[{\"title\":\"🔴 Health Check Failed\",\"description\":\"HTTP $STATUS\\nServer: $(hostname)\\nTime: $TIMESTAMP\",\"color\":16711680}]}" \
      > /dev/null 2>&1
  else
    # Telegram
    curl -s -X POST "$ALERT_WEBHOOK" \
      -H "Content-Type: application/json" \
      -d "{\"text\":\"🔴 *Health Check Failed*\\n\\nHTTP $STATUS\\nServer: $(hostname)\\nTime: $TIMESTAMP\"}" \
      > /dev/null 2>&1
  fi
fi

# Auto-restart PM2 if server is down
if [ "$STATUS" = "000" ]; then
  echo "[$TIMESTAMP] 🔄 Server unreachable, restarting PM2..." >> "$LOG"
  pm2 restart arkxmotion-studio 2>/dev/null
fi

# Keep log file small (last 1000 lines)
tail -1000 "$LOG" > "$LOG.tmp" && mv "$LOG.tmp" "$LOG"
