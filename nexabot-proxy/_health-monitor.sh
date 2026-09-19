#!/bin/bash
# Health Monitor — auto-restart services if they crash
# Runs every 2 minutes via cron

LOG="/home/arkxmotion/health-monitor.log"
DATE=$(date '+%Y-%m-%d %H:%M:%S')

check_and_restart() {
    local name="$1"
    local port="$2"
    local script="$3"

    # Check PM2 status
    STATUS=$(pm2 jlist 2>/dev/null | python3 -c "
import sys, json
apps = json.load(sys.stdin)
found = [a for a in apps if a['name'] == '$name']
print(found[0]['pm2_env']['status'] if found else 'not_found')
" 2>/dev/null)

    if [ "$STATUS" != "online" ]; then
        echo "[$DATE] [WARN] $name is $STATUS — restarting..." >> "$LOG"

        if [ "$STATUS" = "not_found" ] && [ -n "$script" ]; then
            pm2 start "$script" --name "$name" 2>&1 >> "$LOG"
        else
            pm2 restart "$name" 2>&1 >> "$LOG"
        fi

        NEW_STATUS=$(pm2 jlist 2>/dev/null | python3 -c "
import sys, json
apps = json.load(sys.stdin)
found = [a for a in apps if a['name'] == '$name']
print(found[0]['pm2_env']['status'] if found else 'unknown')
" 2>/dev/null)
        echo "[$DATE] [OK] $name restarted (status: $NEW_STATUS)" >> "$LOG"
    fi

    # HTTP health check
    if [ -n "$port" ]; then
        HTTP=$(curl -s -o /dev/null -w '%{http_code}' --connect-timeout 5 "http://localhost:$port/health" 2>/dev/null)
        if [ "$HTTP" != "200" ]; then
            echo "[$DATE] [WARN] $name HTTP check failed ($HTTP) — forcing restart..." >> "$LOG"
            pm2 restart "$name" 2>&1 >> "$LOG"
        fi
    fi
}

echo "[$DATE] --- Health check ---" >> "$LOG"
check_and_restart "nexabot-proxy" "3000" "/home/arkxmotion/nexabot-proxy/server.js"
check_and_restart "arkxmotion" "6000" ""
echo "[$DATE] --- Done ---" >> "$LOG"

# Trim log to last 200 lines
tail -200 "$LOG" > "$LOG.tmp" && mv "$LOG.tmp" "$LOG"
