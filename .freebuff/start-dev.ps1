$ErrorActionPreference = 'Stop'
$workingDir = 'D:\KOKO MITION\clone\arkxmotion-studio'
$logFile = 'D:\KOKO MITION\clone\.freebuff\preview-80ccdea5-b8d3-4f99-9db1-6bc8a4f477f6.log'
$errFile = 'D:\KOKO MITION\clone\.freebuff\preview-80ccdea5-b8d3-4f99-9db1-6bc8a4f477f6.log.err'
$p = Start-Process -FilePath 'npm.cmd' -ArgumentList 'run','dev' -WorkingDirectory $workingDir -RedirectStandardOutput $logFile -RedirectStandardError $errFile -WindowStyle Hidden -PassThru
Write-Output "PID=$($p.Id)"
