# 实时查看 enose-control 服务日志
# 用法: .\scripts\view_enose_logs.ps1 [-Lines 100] [-Follow]

param(
    [string]$TargetHost = "rpi5.local",
    [string]$User = "user",
    [int]$Lines = 50,
    [switch]$Follow = $true,
    [switch]$NoFollow
)

$ErrorActionPreference = "Stop"

Write-Host "========================================" -ForegroundColor Cyan
Write-Host " enose-control 日志查看器" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "主机: $User@$TargetHost" -ForegroundColor Gray
Write-Host "按 Ctrl+C 退出" -ForegroundColor Gray
Write-Host ""
Write-Host "----------------------------------------" -ForegroundColor DarkGray

# 构建 journalctl 命令
$journalCmd = "journalctl -u enose-control -n $Lines --no-pager"

if ($Follow -and -not $NoFollow) {
    $journalCmd += " -f"
}

# 执行 SSH 命令
try {
    ssh "${User}@${TargetHost}" $journalCmd
} catch {
    Write-Host "ERROR: 连接失败 - $_" -ForegroundColor Red
    exit 1
}
