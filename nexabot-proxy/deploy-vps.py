import paramiko
import os
import sys
import time

sys.stdout.reconfigure(encoding='utf-8', errors='replace')

VPS_HOST = '103.172.204.6'
VPS_USER = 'arkxmotion'
VPS_PASS = 'Masuk1234_'
REMOTE_DIR = '/home/arkxmotion/nexabot-proxy'
LOCAL_DIR = os.path.dirname(os.path.abspath(__file__))

print('[..] Connecting to VPS...')
c = paramiko.SSHClient()
c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
c.connect(VPS_HOST, port=22, username=VPS_USER, password=VPS_PASS, timeout=15, allow_agent=False, look_for_keys=False)
print('  Connected OK')

sftp = c.open_sftp()

files = ['server.js', 'dashboard.html', 'register.html', '.env.example', 'package.json']
for f in files:
    local_path = os.path.join(LOCAL_DIR, f)
    remote_path = REMOTE_DIR + '/' + f
    print(f'[UP] {f}...')
    sftp.put(local_path, remote_path)
    print(f'  OK {f}')

sftp.close()
print('\n[OK] All files uploaded!')

# Install dependencies in case package.json changed
print('\n[...] npm install...')
stdin, stdout, stderr = c.exec_command(f'cd {REMOTE_DIR} && npm install 2>&1 | tail -5', timeout=60)
out = stdout.read().decode('utf-8', errors='replace')
print(out)

# Restart pm2
print('[...] Restarting pm2...')
stdin, stdout, stderr = c.exec_command(f'pm2 restart nexabot-proxy 2>/dev/null || pm2 start {REMOTE_DIR}/server.js --name nexabot-proxy', timeout=30)
out = stdout.read().decode('utf-8', errors='replace')
print(out)

time.sleep(3)

# Health check
stdin, stdout, stderr = c.exec_command('curl -s http://localhost:3000/health', timeout=10)
out = stdout.read().decode('utf-8', errors='replace')
print(f'Health: {out}')

c.close()
print('\n[DONE] Deploy complete!')
