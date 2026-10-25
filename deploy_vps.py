"""Deploy build frontend + sumber server ke VPS.

Kredensial TIDAK lagi tertanam di skrip ini: nilainya dibaca dari environment
atau dari `.env` (daftar kuncinya ada di `.env.example`). Kalau kurang lengkap,
skrip berhenti dengan pesan yang jelas — bukan menebak atau memakai nilai
bawaan yang bisa mengarah ke server yang salah.

Jalankan:
    python deploy_vps.py           # deploy penuh (unggah dist/ + sumber, restart pm2)
    python deploy_vps.py --check   # hanya uji kredensial & koneksi, tanpa mengubah apa pun
"""
import os
import stat
import sys

import paramiko

from deploy_config import vps_config

sys.stdout.reconfigure(encoding='utf-8', errors='replace')

_cfg = vps_config()
VPS_HOST = _cfg['host']
VPS_PORT = _cfg['port']
VPS_USER = _cfg['user']
VPS_PASS = _cfg['password']
REMOTE_DIR = _cfg['remote_dir']
LOCAL_DIR = _cfg['local_dir']

print('🔗 Connecting to VPS...')
c = paramiko.SSHClient()
c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
c.connect(VPS_HOST, port=VPS_PORT, username=VPS_USER, password=VPS_PASS, timeout=15, allow_agent=False, look_for_keys=False)
print('  Connected ✓')

if '--check' in sys.argv:
    _in, _out, _err = c.exec_command(f'cd {REMOTE_DIR} && hostname && git log --oneline -1', timeout=15)
    _text = _out.read().decode('utf-8', errors='replace').strip()
    print('  ' + _text.replace(chr(10), chr(10) + '  '))
    c.close()
    print('\n✅ Kredensial valid — mode --check: tidak ada berkas diunggah, tidak ada restart.')
    sys.exit(0)

sftp = c.open_sftp()

# Files to upload
local_dist = os.path.join(LOCAL_DIR, 'dist')
remote_dist = REMOTE_DIR + '/dist'

# Upload dist/ folder recursively
print('\n📦 Uploading dist/...')
for root, dirs, files in os.walk(local_dist):
    rel = os.path.relpath(root, local_dist)
    remote_path = remote_dist + '/' + rel.replace('\\', '/')
    try:
        sftp.listdir(remote_path)
    except FileNotFoundError:
        sftp.mkdir(remote_path)
    for f in files:
        local_file = os.path.join(root, f)
        remote_file = remote_path + '/' + f
        sftp.put(local_file, remote_file)
        print(f'  ✓ {rel}/{f}')

# ── Bersihkan artefak build lama ──────────────────────────────────────
# Deploy hanya MENGUNGGAH, jadi setiap deploy menumpukkan berkas hash lama
# di dist/ (18 Okt 2026: menumpuk puluhan chunk ImageToVideo-* basi bekas
# build sebelumnya). Pembersihan dijalankan SETELAH unggahan selesai — indeks
# aktif dan seluruh chunk-nya sudah ada lebih dulu, jadi tidak ada jendela
# waktu di mana index.html atau chunk-nya hilang dari server. Gagal bersih
# tidak membatalkan deploy (hanya peringatan) — unggahan sudah sukses.
print('\n🧹 Membersihkan artefak build lama di dist/...')

local_rel = set()
for root, _dirs, files in os.walk(local_dist):
    rel = os.path.relpath(root, local_dist).replace('\\', '/')
    for f_name in files:
        local_rel.add(f_name if rel == '.' else rel + '/' + f_name)


def _remote_tree(base, rel=''):
    "Daftar (file, direktori) relatif di bawah base via SFTP, rekursif."
    files, dirs = [], []
    path = base + ('/' + rel if rel else '')
    for entry in sftp.listdir_attr(path):
        child = entry.filename if not rel else rel + '/' + entry.filename
        if stat.S_ISDIR(entry.st_mode):
            dirs.append(child)
            sub_files, sub_dirs = _remote_tree(base, child)
            files += sub_files
            dirs += sub_dirs
        else:
            files.append(child)
    return files, dirs


try:
    remote_files, remote_dirs = _remote_tree(remote_dist)
    stale = sorted(name for name in remote_files if name not in local_rel)
    for rel_path in stale:
        sftp.remove(remote_dist + '/' + rel_path)
    # Rapikan direktori yang kini kosong: terdalam lebih dulu.
    removed_dirs = 0
    for d_name in sorted(remote_dirs, key=lambda s: s.count('/'), reverse=True):
        try:
            if not sftp.listdir(remote_dist + '/' + d_name):
                sftp.rmdir(remote_dist + '/' + d_name)
                removed_dirs += 1
        except OSError:
            pass
    if stale:
        shown = ', '.join(stale[:5]) + (' ...' if len(stale) > 5 else '')
        print('  ✓ %d berkas basi dihapus: %s' % (len(stale), shown))
        print('  ✓ %d direktori kosong dihapus' % removed_dirs)
    else:
        print('  ✓ tidak ada berkas basi')
except Exception as exc:  # pembersihan kosmetik, jangan membatalkan deploy
    print('  ⚠ Pembersihan dilewati: %s' % exc)

# Upload source files needed for server
server_files = [
    'server/index.ts',
    'server/db.ts',
    'server/env.ts',
    'server/mailer.ts',
    'server/backup.ts',
    'package.json',
    'package-lock.json',
    'tsconfig.json',
    'vite.config.ts',
]
# Upload server directory
server_local = os.path.join(LOCAL_DIR, 'server')
server_remote = REMOTE_DIR + '/server'
for root, dirs, files in os.walk(server_local):
    rel = os.path.relpath(root, LOCAL_DIR)
    remote_path = REMOTE_DIR + '/' + rel.replace('\\', '/')
    try:
        sftp.listdir(remote_path)
    except FileNotFoundError:
        sftp.mkdir(remote_path)
    for f in files:
        if f.endswith('.db') or f.endswith('.db-journal'):
            continue  # skip database
        local_file = os.path.join(root, f)
        remote_file = remote_path + '/' + f
        sftp.put(local_file, remote_file)
        print(f'  ✓ {rel}/{f}')

# Upload specific root files
for f in ['tsconfig.json', 'vite.config.ts']:
    local_file = os.path.join(LOCAL_DIR, f)
    remote_file = REMOTE_DIR + '/' + f
    try:
        sftp.put(local_file, remote_file)
        print(f'  ✓ {f}')
    except Exception as e:
        print(f'  ⚠ {f}: {e}')

sftp.close()
print('\n✅ Files uploaded!')

# Restart server
print('\n🔄 Restarting server...')
stdin, stdout, stderr = c.exec_command(f'cd {REMOTE_DIR} && npm install --production=false 2>&1 | tail -5', timeout=120)
out = stdout.read().decode('utf-8', errors='replace')
print(out)

stdin, stdout, stderr = c.exec_command(f'cd {REMOTE_DIR} && pm2 restart arkxmotion --update-env 2>&1', timeout=30)
out = stdout.read().decode('utf-8', errors='replace')
err = stderr.read().decode('utf-8', errors='replace')
print(out or err)

# Wait and check health
print('\n⏳ Waiting for server...')
stdin, stdout, stderr = c.exec_command('sleep 3 && curl -s http://localhost:6000/api/health 2>/dev/null || curl -s http://localhost:6000/ 2>/dev/null | head -1', timeout=15)
out = stdout.read().decode('utf-8', errors='replace')
print(f'Health: {out}')

stdin, stdout, stderr = c.exec_command('pm2 list 2>/dev/null | grep arkxmotion', timeout=10)
out = stdout.read().decode('utf-8', errors='replace')
print(f'PM2: {out}')

c.close()
print('\n✅ Deploy complete!')
