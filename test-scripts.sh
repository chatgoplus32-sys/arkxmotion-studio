#!/usr/bin/env bash
#
# test-scripts.sh — tes untuk `tidy-logs.sh` dan `dev.sh`.
#
# Cara kerjanya: kedua skrip menentukan akar workspace dari lokasi file-nya
# sendiri (`BASH_SOURCE`), jadi menyalinnya ke sandbox membuat seluruh kerjanya
# — `.freebuff/`, `scratch/logs/`, sampai `arkxmotion-studio/` — terjadi di dalam
# sandbox. Tidak ada berkas workspace nyata yang tersentuh.
#
# `npm` dan `netstat` diganti tiruan di `bin/`, supaya tes tidak menyalakan
# server sungguhan dan keputusan "port terisi" bisa ditentukan.
#
# Jalankan: ./test-scripts.sh   (exit 0 kalau semua lolos)
#
# Yang dijaga ketat di sini adalah perlindungan sesi hidup: satu sesi menulis
# beberapa berkas sekaligus, dan berkas yang statis tidak boleh terlepas hanya
# karena pasangannya yang tumbuh. Itu perilaku yang paling mudah rusak diam-diam.

set -u

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SANDBOX=""
WRITER_PID=""
PASS=0
FAIL=0

PROXY_PORT=49871
APP_PORT=49872
SESSION_A='11111111-2222-3333-4444-555555555555'

# ── Kerangka tes ────────────────────────────────────────────────────────────
cleanup() {
  stop_writer
  [ -n "$SANDBOX" ] && [ -d "$SANDBOX" ] && rm -rf "$SANDBOX"
  return 0
}
trap cleanup EXIT

case_start() { printf '\n%s\n' "$1"; }

ok()  { PASS=$((PASS + 1)); printf '  OK     %s\n' "$1"; }

bad() {
  FAIL=$((FAIL + 1))
  printf '  GAGAL  %s\n' "$1"
  [ $# -ge 2 ] && printf '           %s\n' "$2"
  return 0
}

check_eq() { # $1 label, $2 harapan, $3 kenyataan
  if [ "$2" = "$3" ]; then ok "$1"; else bad "$1" "harap [$2], dapat [$3]"; fi
}

check_contains() { # $1 label, $2 teks, $3 potongan yang dicari
  case "$2" in
    *"$3"*) ok "$1" ;;
    *) bad "$1" "tidak memuat [$3]" ;;
  esac
}

check_absent() { # $1 label, $2 teks, $3 potongan yang tidak boleh ada
  case "$2" in
    *"$3"*) bad "$1" "justru memuat [$3]" ;;
    *) ok "$1" ;;
  esac
}

check_file() { # $1 label, $2 path (harus ada)
  if [ -e "$2" ]; then ok "$1"; else bad "$1" "tidak ada: $2"; fi
}

check_no_file() { # $1 label, $2 path (harus tidak ada)
  if [ -e "$2" ]; then bad "$1" "seharusnya tidak ada: $2"; else ok "$1"; fi
}

# ── Sandbox ─────────────────────────────────────────────────────────────────
make_writer() { # $1 = berkas yang terus ditulis
  ( while :; do printf 'tick\n' >> "$1"; sleep 0.2; done ) >/dev/null 2>&1 &
  WRITER_PID=$!
}

stop_writer() {
  if [ -n "$WRITER_PID" ]; then
    kill "$WRITER_PID" 2>/dev/null
    wait "$WRITER_PID" 2>/dev/null
    WRITER_PID=""
  fi
  return 0
}

age() { touch -d '2 hours ago' "$@"; }

build_sandbox() {
  SANDBOX="$(mktemp -d)"
  mkdir -p "$SANDBOX/.freebuff" "$SANDBOX/scratch/logs" "$SANDBOX/bin"
  cp "$HERE/tidy-logs.sh" "$HERE/dev.sh" "$HERE/check.sh" "$SANDBOX/"

  # `npm` tiruan: mencatat invokasi + lingkungan yang diterimanya, lalu keluar
  # dengan kode yang bisa diatur tes.
  # Dicetak ke stdout juga (bukan hanya dicatat) supaya isi log yang di-`tee`
  # oleh dev.sh bisa diperiksa seperti keluaran npm sungguhan.
  cat > "$SANDBOX/bin/npm" <<'STUB'
#!/usr/bin/env bash
line="npm $* | PORT=${PORT:-<unset>} AUTO_BACKUP=${AUTO_BACKUP:-<unset>} NODE_ENV=${NODE_ENV:-<unset>}"
printf '%s\n' "$line"
printf '%s\n' "$line" >> "${STUB_NPM_LOG:-/dev/null}"
exit "${STUB_NPM_EXIT:-0}"
STUB

  # `netstat` tiruan: mengeluarkan isi berkas yang disiapkan tes, atau tidak
  # menemukan port terpakai sama sekali.
  cat > "$SANDBOX/bin/netstat" <<'STUB'
#!/usr/bin/env bash
[ -n "${STUB_NETSTAT_FILE:-}" ] && cat "$STUB_NETSTAT_FILE" 2>/dev/null
exit 0
STUB

  chmod +x "$SANDBOX/bin/npm" "$SANDBOX/bin/netstat"
  reset_product
  reset_state

  # Sandbox meniru keadaan nyata: root workspace dan folder produk sama-sama repo
  # git, supaya pemasangan hook bisa diuji apa adanya. Dilakukan setelah
  # `reset_product` karena folder produknya dibuat di sana.
  git -C "$SANDBOX" init -q 2>/dev/null || true
  git -C "$SANDBOX/arkxmotion-studio" init -q 2>/dev/null || true
}

# Tiap kasus berdiri sendiri: .freebuff dan scratch/logs dikosongkan dulu,
# supaya sisa kasus sebelumnya tidak membuat hasilnya menyesatkan.
reset_state() {
  mkdir -p "$SANDBOX/.freebuff" "$SANDBOX/scratch"
  rm -f "$SANDBOX/.freebuff"/preview-* 2>/dev/null
  printf 'catatan\n' > "$SANDBOX/.freebuff/run.md"
  printf 'abc\n' > "$SANDBOX/.freebuff/project-id"
  rm -rf "$SANDBOX/scratch/logs"
  mkdir -p "$SANDBOX/scratch/logs"
  : > "$SANDBOX/npm.log"
  : > "$SANDBOX/netstat.txt"
  unset AUTO_BACKUP NODE_ENV STUB_NPM_EXIT 2>/dev/null || true
}

reset_product() {
  mkdir -p "$SANDBOX/arkxmotion-studio/node_modules"
  cat > "$SANDBOX/arkxmotion-studio/vite.config.ts" <<EOF
export default {
  server: {
    port: $APP_PORT,
    proxy: {
      '/api': {
        target: 'http://localhost:$PROXY_PORT',
        changeOrigin: true,
      },
    },
  },
}
EOF
  printf 'PORT=%s\n' "$PROXY_PORT" > "$SANDBOX/arkxmotion-studio/.env"
  # Sumber pembanding untuk fase konfigurasi check.sh.
  printf '# contoh\nPORT=%s\nAPP_URL=http://localhost:5173\n' "$PROXY_PORT" \
    > "$SANDBOX/arkxmotion-studio/.env.example"
}

run_check() { # semua argumen diteruskan apa adanya
  ( cd "$SANDBOX" && bash ./check.sh "$@" ) 2>&1
}

freebuff_files() { ls "$SANDBOX/.freebuff" 2>/dev/null | tr '\n' ' '; }
log_names()      { ls "$SANDBOX/scratch/logs" 2>/dev/null | tr '\n' ' '; }
npm_log()        { cat "$SANDBOX/npm.log" 2>/dev/null; }

run_tidy() { # semua argumen diteruskan apa adanya
  ( cd "$SANDBOX" && bash ./tidy-logs.sh "$@" ) 2>&1
}

run_dev_as() { # $1 = assignment env (boleh kosong), sisanya argumen dev.sh
  assigns="$1"; shift
  ( cd "$SANDBOX" && env $assigns \
      PATH="$SANDBOX/bin:$PATH" \
      STUB_NPM_LOG="$SANDBOX/npm.log" \
      STUB_NETSTAT_FILE="$SANDBOX/netstat.txt" \
      bash ./dev.sh "$@" ) 2>&1
}

run_dev() { run_dev_as '' "$@"; }

# Tiap kasus dev dimulai dari keadaan bersih: .freebuff, scratch/logs, catatan
# npm/netstat, dan variabel lingkungan yang mungkin bocor dari kasus sebelumnya.
prepare_dev_case() {
  reset_state
  reset_product
}

busy_netstat() { # tandai satu port sebagai LISTENING
  printf '  TCP    0.0.0.0:%s          0.0.0.0:0              LISTENING       4242\n' "$1" > "$SANDBOX/netstat.txt"
}

# ── tidy-logs.sh ────────────────────────────────────────────────────────────
build_sandbox
printf 'Tes tidy-logs.sh dan dev.sh — sandbox: %s\n' "$SANDBOX"

case_start '1. sesi mati dipindah, penanda non-log tidak disentuh'
reset_state
printf 'log mati\n' > "$SANDBOX/.freebuff/preview-${SESSION_A}.log"
printf 'log mati err\n' > "$SANDBOX/.freebuff/preview-${SESSION_A}.log.err"
age "$SANDBOX/.freebuff/preview-${SESSION_A}.log" "$SANDBOX/.freebuff/preview-${SESSION_A}.log.err"
out="$(run_tidy --min-age 5)"
check_eq 'sesi mati hilang dari .freebuff' 'project-id run.md ' "$(freebuff_files)"
check_contains 'kedua berkas ada di scratch/logs' "$(log_names)" "preview-${SESSION_A}.log.err"
check_contains 'baris PINDAH ditampilkan' "$out" 'PINDAH'
check_no_file 'run.md tidak ikut dipindah' "$SANDBOX/scratch/logs/run.md"
check_no_file 'project-id tidak ikut dipindah' "$SANDBOX/scratch/logs/project-id"

case_start '2. berkas statis satu sesi ikut dilindungi saat pasangannya tumbuh'
reset_state
printf 'statis\n' > "$SANDBOX/.freebuff/preview-${SESSION_A}.log"
printf 'tumbuh\n' > "$SANDBOX/.freebuff/preview-${SESSION_A}.log.err"
age "$SANDBOX/.freebuff/preview-${SESSION_A}.log" "$SANDBOX/.freebuff/preview-${SESSION_A}.log.err"
make_writer "$SANDBOX/.freebuff/preview-${SESSION_A}.log.err"
out="$(run_tidy --min-age 5 --observe 1)"
stop_writer
check_contains 'kedua berkas tetap di .freebuff' "$(freebuff_files)" "preview-${SESSION_A}.log "
check_no_file 'tidak ada yang bocor ke scratch/logs' "$SANDBOX/scratch/logs/preview-${SESSION_A}.log"
check_contains 'dilaporkan sebagai sesi hidup' "$out" 'HIDUP'

case_start '3. berkas segar tanpa pertumbuhan juga menahan seluruh sesi'
reset_state
printf 'statis\n' > "$SANDBOX/.freebuff/preview-${SESSION_A}.log"
printf 'baru saja ditulis\n' > "$SANDBOX/.freebuff/preview-${SESSION_A}.log.err"
age "$SANDBOX/.freebuff/preview-${SESSION_A}.log"
out="$(run_tidy --min-age 10 --observe 1)"
check_contains 'berkas statis tetap di tempat' "$(freebuff_files)" "preview-${SESSION_A}.log "
check_contains 'alasan dilaporkan lewat kesegaran' "$out" 'tersentuh'

case_start '4. --dry-run tidak memindahkan apa pun'
reset_state
printf 'log mati\n' > "$SANDBOX/.freebuff/preview-${SESSION_A}.log"
age "$SANDBOX/.freebuff/preview-${SESSION_A}.log"
out="$(run_tidy --min-age 5 --dry-run)"
check_contains 'rencana ditampilkan' "$out" 'akan dipindah'
check_contains 'berkas masih di .freebuff' "$(freebuff_files)" "preview-${SESSION_A}.log"
check_no_file 'scratch/logs tetap kosong' "$SANDBOX/scratch/logs/preview-${SESSION_A}.log"

case_start '5. nama bentrok diberi stempel waktu, isi lama tidak tertimpa'
reset_state
printf 'lama di scratch\n' > "$SANDBOX/scratch/logs/preview-dead.log"
printf 'baru dari freebuff\n' > "$SANDBOX/.freebuff/preview-dead.log"
age "$SANDBOX/.freebuff/preview-dead.log"
run_tidy --min-age 5 >/dev/null
check_eq 'berkas lama utuh' 'lama di scratch' "$(cat "$SANDBOX/scratch/logs/preview-dead.log")"
check_eq 'ada satu salinan berstempel waktu' '1' "$(ls "$SANDBOX/scratch/logs" | grep -c '^preview-dead\..*\.log$')"
check_eq 'salinan berstempel berisi isi baru' 'baru dari freebuff' "$(cat "$SANDBOX/scratch/logs"/preview-dead.*.log)"

case_start '6. --all tidak menyentuh berkas non-log'
reset_state
printf 'log mati\n' > "$SANDBOX/.freebuff/preview-dead.log"
age "$SANDBOX/.freebuff/preview-dead.log"
run_tidy --all --min-age 5 >/dev/null
check_file 'run.md masih di .freebuff' "$SANDBOX/.freebuff/run.md"
check_file 'project-id masih di .freebuff' "$SANDBOX/.freebuff/project-id"
check_no_file 'log mati tetap dipindah' "$SANDBOX/.freebuff/preview-dead.log"

case_start '7. tanpa .freebuff: keluar tenang'
rm -rf "$SANDBOX/.freebuff"
out="$(run_tidy)"
rc=$?
mkdir -p "$SANDBOX/.freebuff"
check_eq 'exit 0' '0' "$rc"
check_contains 'menjelaskan tidak ada yang perlu dirapikan' "$out" 'Tidak ada'

case_start '8. berkas lama beruuid sama menunggu sesi hari ini selesai'
reset_state
printf 'tumbuh\n' > "$SANDBOX/.freebuff/preview-${SESSION_A}.log"
printf 'sisa lama\n' > "$SANDBOX/.freebuff/preview-${SESSION_A}-api.log"
make_writer "$SANDBOX/.freebuff/preview-${SESSION_A}.log"
run_tidy --min-age 5 --observe 1 >/dev/null
check_contains 'file sisa lama masih ditahan' "$(freebuff_files)" "preview-${SESSION_A}-api.log"
stop_writer
age "$SANDBOX/.freebuff/preview-${SESSION_A}.log" "$SANDBOX/.freebuff/preview-${SESSION_A}-api.log"
run_tidy --min-age 1 --observe 0 >/dev/null
check_no_file 'setelah sesi selesai, file sisa ikut pindah' "$SANDBOX/.freebuff/preview-${SESSION_A}-api.log"
check_file 'berkas sesi utama juga pindah' "$SANDBOX/scratch/logs/preview-${SESSION_A}.log"

# ── dev.sh ──────────────────────────────────────────────────────────────────
case_start '9. --dry-run: npm tidak dijalankan, tidak ada log dibuat'
prepare_dev_case
out="$(run_dev --dry-run --no-tidy)"
check_contains 'rencana ditampilkan' "$out" 'npm run dev:all'
check_contains 'ditegaskan tidak ada port yang diubah' "$out" 'tidak ada port yang diubah'
check_eq 'npm tidak dipanggil' '' "$(npm_log)"
check_eq 'tidak ada log dev dibuat' '' "$(log_names)"

case_start '10. start: log dibuat dan exit code diteruskan'
prepare_dev_case
out="$(run_dev_as 'STUB_NPM_EXIT=7' --no-tidy)"
rc=$?
logf="$(ls -t "$SANDBOX/scratch/logs"/dev-*.log 2>/dev/null | head -1)"
check_eq 'tepat satu log dev dibuat' '1' "$(ls "$SANDBOX/scratch/logs"/dev-*.log 2>/dev/null | wc -l)"
check_eq 'exit code npm diteruskan' '7' "$rc"
check_file 'log dev dibuat' "${logf:-$SANDBOX/scratch/logs/tidak-ada}"
check_contains 'log memuat keluaran proses' "$(cat "${logf:-/dev/null}" 2>/dev/null)" 'npm run dev:all'
check_contains 'laporan akhir menyebut log' "$out" 'Dev server berhenti'

case_start '11. PORT mengikuti proxy Vite, AUTO_BACKUP=0 default'
prepare_dev_case
run_dev >/dev/null
check_contains "PORT=$PROXY_PORT sampai ke proses anak" "$(npm_log)" "PORT=$PROXY_PORT"
check_contains 'backup dimatikan' "$(npm_log)" 'AUTO_BACKUP=0'

case_start '12. AUTO_BACKUP=1 dari pengguna dihormati'
prepare_dev_case
run_dev_as 'AUTO_BACKUP=1' >/dev/null
check_contains 'pengguna bisa memaksa backup' "$(npm_log)" 'AUTO_BACKUP=1'

case_start '13. NODE_ENV=production nyasar tidak menghidupkan backup'
prepare_dev_case
run_dev_as 'NODE_ENV=production' >/dev/null
check_contains 'AUTO_BACKUP tetap 0' "$(npm_log)" 'AUTO_BACKUP=0'
check_contains 'NODE_ENV diteruskan apa adanya' "$(npm_log)" 'NODE_ENV=production'

case_start '14. port terisi: berhenti sebelum npm dijalankan'
prepare_dev_case
busy_netstat "$PROXY_PORT"
out="$(run_dev --no-tidy)"
rc=$?
check_eq 'exit 1' '1' "$rc"
check_contains 'port dan PID dilaporkan' "$out" 'sudah dipakai: PID 4242'
check_eq 'npm tidak dipanggil' '' "$(npm_log)"
check_contains 'dijelaskan cara melanjutkan' "$out" '--force'

case_start '15. --force tetap menjalankan walau port terisi'
prepare_dev_case
busy_netstat "$PROXY_PORT"
run_dev --force --no-tidy >/dev/null
check_contains 'npm tetap dipanggil' "$(npm_log)" 'npm run dev:all'

case_start '16. argumen setelah -- diteruskan ke npm'
prepare_dev_case
run_dev --no-tidy -- --host >/dev/null
check_contains 'argumen diteruskan' "$(npm_log)" 'run dev:all --host'

case_start '17. .env tidak cocok proxy: PERINGATAN, bukan sekadar catatan'
prepare_dev_case
printf 'PORT=49999\n' > "$SANDBOX/arkxmotion-studio/.env"
out="$(run_dev --dry-run --no-tidy)"
check_contains 'selisih jadi PERINGATAN' "$out" 'PERINGATAN: Port backend tidak cocok'
check_contains 'menunjuk perbaikan di .env' "$out" "PORT=$PROXY_PORT di arkxmotion-studio/.env"
check_absent 'tidak ada klaim cocok' "$out" 'ok: port backend cocok'

case_start '18. .env cocok: baris ok muncul, tanpa PERINGATAN port'
prepare_dev_case
out="$(run_dev --dry-run --no-tidy)"
check_contains 'baris ok muncul' "$out" 'ok: port backend cocok'
check_absent 'tidak ada PERINGATAN soal port' "$out" 'tidak cocok'

case_start '19. dev.sh merapikan log sesi mati lebih dulu (integrasi)'
prepare_dev_case
printf 'log mati\n' > "$SANDBOX/.freebuff/preview-${SESSION_A}.log"
age "$SANDBOX/.freebuff/preview-${SESSION_A}.log"
run_dev --dry-run >/dev/null
check_no_file 'log mati dipindah oleh langkah perapian' "$SANDBOX/.freebuff/preview-${SESSION_A}.log"
check_file 'berkasnya ada di scratch/logs' "$SANDBOX/scratch/logs/preview-${SESSION_A}.log"

case_start '20. node_modules hilang: npm install dulu, baru dev:all'
prepare_dev_case
rm -rf "$SANDBOX/arkxmotion-studio/node_modules"
run_dev --no-tidy >/dev/null
check_contains 'install dijalankan lebih dulu' "$(npm_log | head -1)" 'npm install'
check_contains 'dev:all dijalankan setelahnya' "$(npm_log | tail -1)" 'npm run dev:all'

case_start '21. --help dan opsi salah'
prepare_dev_case
out="$(run_dev --help)"
check_contains 'help menampilkan pemakaian' "$out" 'Pemakaian:'
run_dev --opsi-ngawur >/dev/null
rc=$?
check_eq 'opsi tak dikenal: exit 2' '2' "$rc"

case_start '22. check.sh --config-only: konsisten berarti lolos'
prepare_dev_case
out="$(run_check --config-only)"
rc=$?
check_eq 'exit 0' '0' "$rc"
check_contains 'PORT .env dinilai cocok' "$out" 'PORT di .env (49871) cocok dengan proxy Vite'
check_contains 'PORT .env.example ikut diperiksa' "$out" 'PORT di .env.example (49871) cocok dengan proxy Vite'

case_start '23. check.sh: PORT .env beda dari proxy berarti gagal'
prepare_dev_case
printf 'PORT=49999\n' > "$SANDBOX/arkxmotion-studio/.env"
out="$(run_check --config-only)"
rc=$?
check_eq 'exit 1' '1' "$rc"
check_contains 'selisih .env vs proxy dilaporkan' "$out" 'PORT di .env (49999) tidak cocok dengan proxy Vite (49871)'

case_start '24. check.sh: PORT .env.example beda dari proxy berarti gagal'
prepare_dev_case
printf 'PORT=49777\n' > "$SANDBOX/arkxmotion-studio/.env.example"
out="$(run_check --config-only)"
rc=$?
check_eq 'exit 1' '1' "$rc"
check_contains 'selisih .env.example vs proxy dilaporkan' "$out" 'PORT di .env.example (49777) tidak cocok'

case_start '25. check.sh: kunci .env yang belum terdokumentasi berarti gagal'
prepare_dev_case
printf 'SHH_SECRET=rahasia\n' >> "$SANDBOX/arkxmotion-studio/.env"
out="$(run_check --config-only)"
rc=$?
check_eq 'exit 1' '1' "$rc"
check_contains 'kuncinya disebut namanya' "$out" 'belum ada di .env.example: SHH_SECRET'

case_start '26. check.sh: kunci tambahan di .env.example tidak dianggap masalah'
prepare_dev_case
printf 'CRON_SECRET=ubah-saya\n' >> "$SANDBOX/arkxmotion-studio/.env.example"
out="$(run_check --config-only)"
rc=$?
check_eq 'tetap exit 0 (tidak ada false positive)' '0' "$rc"
check_contains 'dokumentasi kunci dinyatakan beres' "$out" 'semua kunci di .env terdokumentasi'

case_start '27. check.sh --staged di luar repo git: jatuh ke fase konfigurasi saja'
out="$(run_check --staged)"
rc=$?
check_eq 'exit 0' '0' "$rc"
check_contains 'menandai mode staged' "$out" 'Mode staged'

case_start '28. --install-hook menaruh hook yang menunjuk check.sh milik workspace'
prepare_dev_case
out="$(run_check --install-hook --product)"
rc=$?
hook="$SANDBOX/arkxmotion-studio/.git/hooks/pre-commit"
check_eq 'exit 0' '0' "$rc"
check_file 'hook produk terpasang' "$hook"
check_contains 'menunjuk check.sh workspace, bukan salinan di repo produk' "$(cat "$hook" 2>/dev/null)" "exec \"$SANDBOX/check.sh\" --staged"
check_contains 'laporan menyebut repo produk' "$out" 'repo produk: pre-commit hook dipasang'

case_start '29. hook yang sudah ada tidak ditimpa tanpa --force'
printf '#!/usr/bin/env bash\necho "hook lama milik orang lain"\n' \
  > "$SANDBOX/arkxmotion-studio/.git/hooks/pre-commit"
out="$(run_check --install-hook --product)"
rc=$?
check_eq 'exit 1' '1' "$rc"
check_contains 'menolak dengan alasan yang jelas' "$out" 'sudah ada pre-commit hook lain'
check_contains 'isi hook lama utuh' "$(cat "$SANDBOX/arkxmotion-studio/.git/hooks/pre-commit")" 'hook lama milik orang lain'
check_contains 'menyarankan --force' "$out" '--force'

case_start '30. --force mengganti hook lama berikut cadangannya'
out="$(run_check --install-hook --product --force)"
rc=$?
check_eq 'exit 0' '0' "$rc"
check_contains 'hook baru menunjuk check.sh workspace' \
  "$(cat "$SANDBOX/arkxmotion-studio/.git/hooks/pre-commit")" "exec \"$SANDBOX/check.sh\" --staged"
check_eq 'hook lama disimpan sebagai cadangan' '1' \
  "$(ls "$SANDBOX/arkxmotion-studio/.git/hooks" | grep -c '^pre-commit\.backup-')"
check_contains 'cadangan berisi isi hook lama' \
  "$(cat "$SANDBOX/arkxmotion-studio/.git/hooks"/pre-commit.backup-* 2>/dev/null)" 'hook lama milik orang lain'

case_start '31a. hook check.sh versi lama dikenali lalu di-upgrade tanpa --force'
printf '#!/usr/bin/env bash\n# Dipasang oleh check.sh — versi lama tanpa penanda\nexec "%s/check.sh" --staged\n' "$SANDBOX" \
  > "$SANDBOX/arkxmotion-studio/.git/hooks/pre-commit"
backups_before="$(ls "$SANDBOX/arkxmotion-studio/.git/hooks" | grep -c '^pre-commit\.backup-')"
out="$(run_check --install-hook --product)"
rc=$?
backups_after="$(ls "$SANDBOX/arkxmotion-studio/.git/hooks" | grep -c '^pre-commit\.backup-')"
check_eq 'exit 0 tanpa perlu --force' '0' "$rc"
check_contains 'hook versi lama di-upgrade ke format berpenanda' \
  "$(cat "$SANDBOX/arkxmotion-studio/.git/hooks/pre-commit")" 'penanda: check.sh-hook'
check_eq 'tidak ada cadangan baru untuk hook sendiri' "$backups_before" "$backups_after"

case_start '31. hook asing yang menyebut nama check.sh tidak diklaim sebagai milik sendiri'
# Sengaja menyebut "check.sh" supaya terbukti yang menentukan adalah penanda,
# bukan sekadar nama berkasnya.
printf '#!/usr/bin/env bash\necho "ini bukan hook check.sh milik kalian"\n' \
  > "$SANDBOX/arkxmotion-studio/.git/hooks/pre-commit"
out="$(run_check --uninstall-hook --product)"
check_eq 'menolak melepas hook asing' '1' "$?"
check_contains 'alasannya disebut' "$out" 'bukan buatan check.sh'
check_file 'hook asing tetap ada' "$SANDBOX/arkxmotion-studio/.git/hooks/pre-commit"
run_check --install-hook --product --force >/dev/null
run_check --uninstall-hook --product >/dev/null
check_no_file 'hook buatan check.sh terlepas' "$SANDBOX/arkxmotion-studio/.git/hooks/pre-commit"

# ── Ringkasan ───────────────────────────────────────────────────────────────
printf '\n────────────────────────────────────────\n'
printf 'Lolos: %s   Gagal: %s\n' "$PASS" "$FAIL"
if [ "$FAIL" -gt 0 ]; then
  printf 'ADA YANG GAGAL\n'
  exit 1
fi
printf 'Semua tes lolos.\n'
exit 0
