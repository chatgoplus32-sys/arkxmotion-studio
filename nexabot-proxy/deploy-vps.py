import paramiko
import os

c = paramiko.SSHClient()
c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
c.connect('103.172.204.6', port=22, username='arkxmotion', password='Masuk1234_', timeout=15, allow_agent=False, look_for_keys=False)

sftp = c.open_sftp()
base = r'D:\KOKO MITION\clone\nexabot-proxy'
remote = '/home/arkxmotion/nexabot-proxy'

files = ['server.js', 'dashboard.html', 'register.html', '.env.example']
for f in files:
    local_path = os.path.join(base, f)
    remote_path = remote + '/' + f
    print('Uploading ' + f + '...')
    sftp.put(local_path, remote_path)
    print('  OK')

sftp.close()
print('All files uploaded!')

# Now restart pm2
print('Restarting pm2...')
stdin, stdout, stderr = c.exec_command('pm2 restart nexabot-proxy 2>/dev/null || pm2 start /home/arkxmotion/nexabot-proxy/server.js --name nexabot-proxy', timeout=30)
out = stdout.read().decode('utf-8', errors='replace')
err = stderr.read().decode('utf-8', errors='replace')
print(out)

stdin, stdout, stderr = c.exec_command('pm2 save', timeout=10)
out = stdout.read().decode('utf-8', errors='replace')
print(out)

stdin, stdout, stderr = c.exec_command('sleep 2 && curl -s http://localhost:3000/health', timeout=10)
out = stdout.read().decode('utf-8', errors='replace')
print('Health: ' + out)

c.close()
print('DONE')
