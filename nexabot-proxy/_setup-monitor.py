import paramiko
import sys
import os

sys.stdout.reconfigure(encoding='utf-8', errors='replace')

c = paramiko.SSHClient()
c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
c.connect('103.172.204.6', port=22, username='arkxmotion', password='Masuk1234_', timeout=15, allow_agent=False, look_for_keys=False)
print('[OK] Connected')

sftp = c.open_sftp()

# Upload health-monitor.sh
local = os.path.join(os.path.dirname(os.path.abspath(__file__)), '_health-monitor.sh')
sftp.put(local, '/home/arkxmotion/health-monitor.sh')
sftp.close()
print('[OK] health-monitor.sh uploaded')

# Make executable
stdin, stdout, stderr = c.exec_command('chmod +x /home/arkxmotion/health-monitor.sh', timeout=5)
stdout.read()

# Test run
print('\n[...] Test run:')
stdin, stdout, stderr = c.exec_command('bash /home/arkxmotion/health-monitor.sh 2>&1', timeout=15)
out = stdout.read().decode('utf-8', errors='replace')
if out.strip():
    print(out)

# Check log
import time
time.sleep(1)
stdin, stdout, stderr = c.exec_command('cat /home/arkxmotion/health-monitor.log 2>&1', timeout=5)
out = stdout.read().decode('utf-8', errors='replace')
print(f'Log:\n{out}')

# Set up cron (every 2 minutes)
print('[...] Setting up cron job...')
cron_line = '*/2 * * * * /bin/bash /home/arkxmotion/health-monitor.sh'
# Remove old entry, add new one
stdin, stdout, stderr = c.exec_command(f'(crontab -l 2>/dev/null | grep -v health-monitor; echo "{cron_line}") | crontab -', timeout=10)
stdout.read()
err = stderr.read().decode('utf-8', errors='replace')
if err.strip():
    print(f'  Cron err: {err}')

# Verify
stdin, stdout, stderr = c.exec_command('crontab -l 2>&1', timeout=5)
out = stdout.read().decode('utf-8', errors='replace')
print(f'\n[...] Crontab:\n{out}')

c.close()
print('[DONE] Health monitor installed!')
