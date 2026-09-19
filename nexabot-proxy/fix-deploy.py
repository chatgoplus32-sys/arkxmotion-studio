import paramiko, os, sys, io, time
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')

c = paramiko.SSHClient()
c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
c.connect('103.172.204.6', port=22, username='arkxmotion', password='Masuk1234_', timeout=15, allow_agent=False, look_for_keys=False)

# 1. Upload server.js
sftp = c.open_sftp()
sftp.put(r'D:\KOKO MITION\clone\nexabot-proxy\server.js', '/home/arkxmotion/nexabot-proxy/server.js')
sftp.close()
print('1. server.js uploaded')

# 2. Upload fix script
fix_script = r"""
const Database = require('/home/arkxmotion/nexabot-proxy/node_modules/better-sqlite3');
const db = new Database('/home/arkxmotion/nexabot-proxy/members.db');
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
