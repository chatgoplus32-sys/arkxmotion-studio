$ErrorActionPreference = 'Stop'
$log = 'D:\KOKO MITION\clone\.freebuff\preview-80ccdea5-b8d3-4f99-9db1-6bc8a4f477f6.log'
$logErr = 'D:\KOKO MITION\clone\.freebuff\preview-80ccdea5-b8d3-4f99-9db1-6bc8a4f477f6.log.err'
$wd = 'D:\KOKO MITION\clone\arkxmotion-studio'
$p = Start-Process -FilePath 'npm.cmd' -ArgumentList 'run','dev' -WorkingDirectory $wd -RedirectStandardOutput $log -RedirectStandardError $logErr -WindowStyle Hidden -PassThru
Write-Output "PID=$($p.Id)"
