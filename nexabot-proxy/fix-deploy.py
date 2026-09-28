import os
import sys
import time

from vps_config import run_check, ssh_connect, vps_config

sys.stdout.reconfigure(encoding='utf-8', errors='replace')

CONF = vps_config()
REMOTE_DIR = CONF['remote_dir']

if '--check' in sys.argv[1:]:
    run_check(CONF)

print('[..] Connecting to VPS...')
c = ssh_connect(CONF)
print('  Connected OK')

# 1. Upload server.js
sftp = c.open_sftp()
local_server = os.path.join(CONF['local_dir'], 'server.js')
sftp.put(local_server, REMOTE_DIR + '/server.js')
sftp.close()
print('1. server.js uploaded')

# 2. Upload fix script
fix_script = f"""
const Database = require('{REMOTE_DIR}/node_modules/better-sqlite3');
const db = new Database('{REMOTE_DIR}/members.db');
const r = db.prepare("UPDATE members SET saldo = 10000 WHERE name = 'koko'").run();
console.log('Fixed koko saldo to 10000, changes:', r.changes);
db.close();
"""

sftp = c.open_sftp()
with sftp.open('/tmp/fix-saldo.js', 'w') as f:
    f.write(fix_script)
sftp.close()

stdin, stdout, stderr = c.exec_command('node /tmp/fix-saldo.js', timeout=10)
print('2. ' + stdout.read().decode('utf-8', errors='replace').strip())

# 3. Restart pm2
stdin, stdout, stderr = c.exec_command('pm2 restart nexabot-proxy && pm2 save', timeout=15)
print('3. PM2 restarted')

time.sleep(2)
stdin, stdout, stderr = c.exec_command('curl -s http://localhost:3000/health', timeout=10)
print('4. Health: ' + stdout.read().decode('utf-8', errors='replace').strip())

c.close()
print('DONE')
