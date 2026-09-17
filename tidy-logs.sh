#!/usr/bin/env bash
#
# tidy-logs.sh — pindahkan log sesi dev/preview yang sudah mati dari `.freebuff/`
# ke `scratch/logs/`, supaya akar `.freebuff/` tidak menumpuk tiap sesi.
#
# Kenapa skrip dan bukan sekadar pindah folder: path log ditentukan oleh tooling
# yang menjalankannya (`<workspace>/.freebuff/preview-<id>.log`), jadi workspace
# ini tidak bisa mengarahkannya langsung ke `scratch/logs/`. Yang bisa dilakukan
# adalah merapikannya setelah sesi selesai — itu tugas skrip ini.
#
# Satu sesi menulis beberapa file sekaligus (mis. `preview-<id>.log` statis
# sementara `preview-<id>.log.err` tumbuh), jadi penilaian "hidup/mati" dilakukan
# per sesi, bukan per file. Sebuah sesi dianggap mati hanya kalau TIDAK ada satu
# pun filenya yang tumbuh selama pengamatan DAN tidak ada yang tersentuh dalam
# `--min-age` menit terakhir.
#
# Aman: file hanya dipindahkan (`mv`), tidak pernah dihapus.
#
# Pemakaian:
#   ./tidy-logs.sh                 # rapikan log sesi yang sudah berhenti
#   ./tidy-logs.sh --dry-run       # lihat rencananya saja, tidak mengubah apa pun
#   ./tidy-logs.sh --all           # semua *.log/*.err di .freebuff, bukan cuma preview-*
#   ./tidy-logs.sh --min-age 1     # anggap sesi "segar" sampai 1 menit (default 10)
#   ./tidy-logs.sh --force         # jangan cek pertumbuhan, pakai kesegaran saja
#   ./tidy-logs.sh --help

set -u

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SRC="$ROOT/.freebuff"
DEST="$ROOT/scratch/logs"
MIN_AGE_MIN=10
OBSERVE_SEC=2
LIVE_CHECK=1
DRY_RUN=0
ALL=0

usage() { sed -n '3,27p' "$0" | sed 's/^# \{0,1\}//'; }

while [ $# -gt 0 ]; do
  case "$1" in
    -n|--dry-run)   DRY_RUN=1 ;;
    -a|--all)       ALL=1 ;;
    -f|--force)     LIVE_CHECK=0 ;;
    --min-age)      shift; MIN_AGE_MIN="${1:-10}" ;;
    --observe)      shift; OBSERVE_SEC="${1:-2}" ;;
    -h|--help)      usage; exit 0 ;;
    *) echo "Opsi tidak dikenal: $1" >&2; usage >&2; exit 2 ;;
  esac
  shift
done

[ -d "$SRC" ] || { echo "Tidak ada $SRC — tidak ada yang perlu dirapikan."; exit 0; }

PATTERNS=("preview-*.log" "preview-*.log.err" "preview-*.err")
[ "$ALL" -eq 1 ] && PATTERNS=("*.log" "*.log.err" "*.err")

# Kunci sesi: nama file dengan suffix per-proses dibuang, jadi
# `preview-<uuid>.log`, `preview-<uuid>.log.err`, `preview-<uuid>-vite.log`
# semuanya jatuh ke sesi yang sama.
session_key() {
  local n="$1" rest
  case "$n" in
    preview-*) rest="${n#preview-}" ;;
    *)         printf '%s' "$n"; return ;;
  esac
  if [[ "$rest" =~ ^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}) ]]; then
    printf 'preview-%s' "${BASH_REMATCH[1]}"
  else
    printf '%s' "$n"
  fi
}

# Semua file log di SRC ikut diamati, bukan hanya yang sudah lama — supaya sesi
# hidup tetap terdeteksi walau file yang sedang tumbuh itu masih baru. Dedup
# karena satu file bisa cocok dengan lebih dari satu pola.
declare -A seen=()
files=()
add_file() {
  [ -e "$1" ] || return 0
  [ -n "${seen[$1]:-}" ] && return 0
  seen["$1"]=1
  files+=("$1")
}
for pat in "${PATTERNS[@]}"; do
  for f in "$SRC"/$pat; do add_file "$f"; done
done

if [ "${#files[@]}" -eq 0 ]; then
  echo "Tidak ada file log di $SRC — tidak ada yang perlu dirapikan."
  exit 0
fi

# Ukur semua, tunggu sekali, ukur lagi: biayanya tetap ~OBSERVE_SEC berapa pun
# jumlah filenya.
declare -A size_before=()
for f in "${files[@]}"; do
  size_before["$f"]="$(stat -c%s "$f" 2>/dev/null || echo 0)"
done
if [ "$LIVE_CHECK" -eq 1 ] && [ "$OBSERVE_SEC" -gt 0 ]; then
  sleep "$OBSERVE_SEC"
fi

# Semua pengelompokan disimpan sebagai array asosiatif berisi nama file, bukan
# string gabungan — akar workspace ini mengandung spasi (`KOKO MITION`), jadi
# ekspansi tanpa kutip atas daftar path akan pecah jadi beberapa kata.
declare -A grew=() live_grew=() live_fresh=() live_fresh_file=()
for f in "${files[@]}"; do
  key="$(session_key "$(basename "$f")")"
  if [ "$LIVE_CHECK" -eq 1 ]; then
    now="$(stat -c%s "$f" 2>/dev/null || echo 0)"
    if [ "$now" -gt "${size_before[$f]}" ]; then
      grew["$f"]=1
      live_grew["$key"]="$(basename "$f")"
    fi
  fi
  if [ -n "$(find "$f" -maxdepth 0 -mmin -"$MIN_AGE_MIN" -print -quit 2>/dev/null)" ]; then
    live_fresh["$key"]=1
    live_fresh_file["$key"]="$(basename "$f")"
  fi
done

declare -A live_reason=()
for key in "${!live_grew[@]}"; do
  live_reason["$key"]="${live_grew[$key]} masih tumbuh"
done
for key in "${!live_fresh[@]}"; do
  [ -n "${live_reason[$key]:-}" ] && continue
  live_reason["$key"]="${live_fresh_file[$key]} tersentuh < ${MIN_AGE_MIN} menit lalu"
done

if [ "${#live_reason[@]}" -gt 0 ]; then
  echo 'Sesi yang masih jalan — file-nya dilewati:'
  for key in "${!live_reason[@]}"; do
    printf '  HIDUP    %-32s %s\n' "$key" "(${live_reason[$key]})"
  done
  echo
fi

# Sesi mati: tidak tumbuh dan tidak ada file yang tersentuh baru-baru ini.
dead=()
for f in "${files[@]}"; do
  [ -n "${live_reason[$(session_key "$(basename "$f")")]:-}" ] && continue
  dead+=("$f")
done

if [ "${#dead[@]}" -eq 0 ]; then
  echo "Bersih — tidak ada sesi log yang sudah mati."
  exit 0
fi

dest_path() { # $1 = nama file asal -> path tujuan yang belum terpakai
  local base="$1" target="$DEST/$1" stamp
  [ -e "$target" ] || { printf '%s' "$target"; return; }
  stamp="$(date -r "$SRC/$base" +%Y%m%d-%H%M 2>/dev/null || date +%Y%m%d-%H%M)"
  case "$base" in
    *.log.err) target="$DEST/${base%.log.err}.$stamp.log.err" ;;
    *.err)     target="$DEST/${base%.err}.$stamp.err" ;;
    *.log)     target="$DEST/${base%.log}.$stamp.log" ;;
    *)         target="$DEST/$base.$stamp" ;;
  esac
  local n=2
  while [ -e "$target" ]; do
    target="${target%.*}-$n.${target##*.}"; n=$((n + 1))
  done
  printf '%s' "$target"
}

if [ "$DRY_RUN" -eq 0 ]; then mkdir -p "$DEST"; fi

echo 'Log sesi mati:'
moved=0 failed=0 held=0
for f in "${dead[@]}"; do
  name="$(basename "$f")"
  target="$(dest_path "$name")"
  if [ "$DRY_RUN" -eq 1 ]; then
    printf '  PINDAH   %s -> scratch/logs/%s\n' "$name" "$(basename "$target")"
    moved=$((moved + 1))
    continue
  fi
  err="$(mv -n "$f" "$target" 2>&1)"
  if [ -z "$err" ]; then
    printf '  PINDAH   %s -> scratch/logs/%s\n' "$name" "$(basename "$target")"
    moved=$((moved + 1))
    continue
  fi
  # Jaring pengaman terakhir: kalau proses masih memegang file, `mv` gagal dan
  # file tetap di tempatnya. Itu sinyal "sesi masih hidup", bukan kerusakan.
  case "$err" in
    *busy*|*Busy*|*resource*|*Permission*|*denied*|*"Akses ditolak"*)
      printf '  HIDUP    %s — masih dipegang proses, dibiarkan di tempat\n' "$name"
      held=$((held + 1))
      ;;
    *)
      printf '  GAGAL    %s (%s)\n' "$name" "$err" >&2
      failed=$((failed + 1))
      ;;
  esac
done

skipped=$(( ${#live_reason[@]} + held ))
echo
if [ "$DRY_RUN" -eq 1 ]; then
  echo "Dry-run: $moved akan dipindah, ${#live_reason[@]} sesi hidup dilewati, $failed gagal."
else
  echo "Selesai: $moved dipindah ke scratch/logs, $skipped sesi hidup dilewati ($held di antaranya masih dipegang proses), $failed gagal."
  [ "$skipped" -gt 0 ] && echo "Jalankan lagi setelah sesi di atas dimatikan."
fi
