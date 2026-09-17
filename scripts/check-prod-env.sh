#!/bin/bash
# ============================================================
# Gerbang 3a — proses yang melayani HARUS berjalan dengan NODE_ENV=production.
#
# Kenapa ada: environment proses tidak diambil dari ecosystem.config.cjs kalau
# restart-nya tidak lewat berkas itu. `pm2 restart arkxmotion --update-env`
# menyegarkan environment dari shell yang menjalankan perintah — yaitu sesi SSH
# deploy, yang tidak punya NODE_ENV. Akibatnya proses produksi berjalan dalam
# mode dev: isProd=false, backup otomatis (yang hanya aktif di production)
# dilewati, dan gerbang 3 gagal di tiga deploy berturut-turut (17 Sep 11:42,
# 7faf8f0 05:27, 55a4bfa 05:31) tanpa sebab yang bisa dibaca dari luar —
# /api/backup/status hanya menyebut "gerbang AUTO_BACKUP tertutup".
#
# Yang dibaca di sini adalah environment MENURUT OS, bukan laporan aplikasi:
# /proc/<pid>/environ berisi environment saat proses itu di-exec, jadi tidak ada
# cara proses ini tampak production tanpa benar-benar dijalankan sebagai
# production.
#
# Pemakaian (dari root project, di VPS):
#   bash scripts/check-prod-env.sh
#
# Override (dipakai tes): PM2_NAME, PM2_PID, ENVIRON_FILE, BASE_URL
#
# Exit 0 = NODE_ENV=production. Exit 1 = tidak, beserta diagnosisnya.
# ============================================================
set -u

PM2_NAME="${PM2_NAME:-arkxmotion}"
BASE_URL="${BASE_URL:-http://127.0.0.1:${PORT:-6000}}"
PID="${PM2_PID:-}"
ENVIRON_FILE="${ENVIRON_FILE:-}"

if [ -z "$ENVIRON_FILE" ]; then
  if [ -z "$PID" ] && command -v pm2 >/dev/null 2>&1; then
    PID="$(pm2 pid "$PM2_NAME" 2>/dev/null | head -1 | tr -d '[:space:]')"
  fi
  ENVIRON_FILE="/proc/${PID}/environ"
fi

# Environment proses, satu variabel per baris. /proc memakai pemisah NUL.
env_lines() {
  tr '\0' '\n' < "$ENVIRON_FILE" 2>/dev/null
}

diagnosis() {
  echo ""
  echo "--- environment proses menurut OS ($ENVIRON_FILE) ---"
  if [ -r "$ENVIRON_FILE" ]; then
    if env_lines | grep -qE '^(NODE_ENV|PORT|AUTO_BACKUP|pm_id)='; then
      env_lines | grep -E '^(NODE_ENV|PORT|AUTO_BACKUP|pm_id)=' | sed 's/^/   /'
    else
      echo "   (tidak ada NODE_ENV/PORT/AUTO_BACKUP/pm_id sama sekali)"
    fi
  else
    echo "   (tidak bisa dibaca: $ENVIRON_FILE)"
  fi
  echo ""
  echo "--- yang dideklarasikan ecosystem.config.cjs ---"
  if [ -f ecosystem.config.cjs ]; then
    grep -nE 'NODE_ENV|PORT' ecosystem.config.cjs | sed 's/^/   /'
  else
    echo "   (ecosystem.config.cjs tidak ditemukan di $(pwd))"
  fi
  echo ""
  echo "--- laporan aplikasi sendiri: $BASE_URL/api/backup/status ---"
  curl -s --max-time 10 "$BASE_URL/api/backup/status" 2>/dev/null \
    || echo "   (tidak bisa menghubungi $BASE_URL)"
  echo ""
  echo "Perbaikannya: jalankan restart lewat berkas yang mendeklarasikannya —"
  echo "   pm2 startOrReload ecosystem.config.cjs && pm2 save"
  echo "   bash scripts/check-prod-env.sh"
}

fail() {
  echo ""
  echo "❌ GERBANG 3a GAGAL: $1"
  diagnosis
  exit 1
}

echo "🧪 Gerbang 3a — proses produksi harus berjalan dengan NODE_ENV=production"
echo "   PM2 app : $PM2_NAME"
echo "   PID     : ${PID:-(tidak ditemukan)}"
echo "   Environ : $ENVIRON_FILE"

if [ ! -r "$ENVIRON_FILE" ]; then
  fail "environment proses tidak bisa dibaca ($ENVIRON_FILE). Jalankan skrip ini di VPS Linux, tempat /proc/<pid>/environ tersedia; PID juga bisa dipaksa lewat PM2_PID atau ENVIRON_FILE."
fi

node_env_line="$(env_lines | grep -x -m1 'NODE_ENV=.*' || true)"

if [ -z "$node_env_line" ]; then
  fail "proses yang melayani TIDAK PUNYA NODE_ENV, jadi aplikasi berjalan dalam mode dev — backup otomatis tidak pernah dijalankan."
fi

node_env="${node_env_line#NODE_ENV=}"
if [ "$node_env" != "production" ]; then
  fail "NODE_ENV='${node_env}', bukan 'production'. Proses produksi ini berjalan dalam mode dev, sehingga aplikasi tidak menganggap dirinya production."
fi

echo "   ✓ NODE_ENV=production"
echo ""
echo "✅ GERBANG 3a LOLOS — proses produksi berjalan dengan NODE_ENV=production"
exit 0
