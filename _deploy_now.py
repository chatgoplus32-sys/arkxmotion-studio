import os
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

print('[..] Connecting to VPS...')
c = paramiko.SSHClient()
c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
c.connect(VPS_HOST, port=22, username=VPS_USER, password=VPS_PASS, timeout=15, allow_agent=False, look_for_keys=False)
print('  Connected OK')

sftp = c.open_sftp()

# Upload dist/ folder recursively
local_dist = os.path.join(LOCAL_DIR, 'dist')
remote_dist = REMOTE_DIR + '/dist'

print('\n[UP] Uploading dist/...')
count = 0
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
        count += 1
        if count % 50 == 0:
            print(f'  ... {count} files uploaded')

print(f'  OK {count} files uploaded')

# Upload server directory
server_local = os.path.join(LOCAL_DIR, 'server')
scount = 0
for root, dirs, files in os.walk(server_local):
    rel = os.path.relpath(root, LOCAL_DIR)
    remote_path = REMOTE_DIR + '/' + rel.replace('\\', '/')
    try:
        sftp.listdir(remote_path)
    except FileNotFoundError:
        sftp.mkdir(remote_path)
    for f in files:
        if f.endswith('.db') or f.endswith('.db-journal'):
            continue
        local_file = os.path.join(root, f)
        remote_file = remote_path + '/' + f
        sftp.put(local_file, remote_file)
        scount += 1

print(f'  OK {scount} server files uploaded')

# Upload shared directory (server/ mengimpor shared/pricing.js saat runtime
# via tsx — tanpa ini route wallet baru gagal boot dengan SyntaxError).
shared_local = os.path.join(LOCAL_DIR, 'shared')
shcount = 0
for root, dirs, files in os.walk(shared_local):
    rel = os.path.relpath(root, LOCAL_DIR)
    remote_path = REMOTE_DIR + '/' + rel.replace('\\', '/')
    try:
        sftp.listdir(remote_path)
    except FileNotFoundError:
        sftp.mkdir(remote_path)
    for f in files:
        local_file = os.path.join(root, f)
        remote_file = remote_path + '/' + f
        sftp.put(local_file, remote_file)
        shcount += 1

print(f'  OK {shcount} shared files uploaded')

# Upload root config files
for f in ['tsconfig.json', 'vite.config.ts', 'package.json', 'package-lock.json']:
    local_file = os.path.join(LOCAL_DIR, f)
    remote_file = REMOTE_DIR + '/' + f
    try:
        sftp.put(local_file, remote_file)
        print(f'  OK {f}')
    except Exception as e:
        print(f'  WARN {f}: {e}')

sftp.close()
print('\n[OK] Files uploaded!')

# Restart server
print('\n[...] Running npm install...')
stdin, stdout, stderr = c.exec_command(f'cd {REMOTE_DIR} && npm install --production=false 2>&1 | tail -5', timeout=180)
out = stdout.read().decode('utf-8', errors='replace')
print(out)

print('\n[...] Restarting PM2...')
stdin, stdout, stderr = c.exec_command(f'cd {REMOTE_DIR} && pm2 restart arkxmotion --update-env 2>&1', timeout=30)
out = stdout.read().decode('utf-8', errors='replace')
print(out)

print('\n[...] Waiting for server...')
stdin, stdout, stderr = c.exec_command('sleep 3 && curl -s http://localhost:6000/api/health 2>/dev/null || echo no-health', timeout=15)
out = stdout.read().decode('utf-8', errors='replace')
print(f'Health: {out}')

stdin, stdout, stderr = c.exec_command('pm2 list 2>/dev/null | grep -E "arkxmotion|name"', timeout=10)
out = stdout.read().decode('utf-8', errors='replace')
print(f'PM2:\n{out}')

c.close()
print('\n[DONE] Deploy complete!')
