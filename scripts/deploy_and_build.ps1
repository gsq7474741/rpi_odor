$ErrorActionPreference = "Stop"

# Configuration
$RemoteUser = "user"
$RemoteHost = "rpi5.local"
$RemoteDir = "~/rpi_odor"
$LocalRoot = "d:\WindSurfProjects\rpi_odor"

# SSH Command wrapper to handle authentication if keys aren't set up
# Note: Ideally user should set up SSH keys. For now we assume keys or ssh-agent.
function Run-SSH {
    param($Command)
    ssh $RemoteUser@$RemoteHost $Command
}

Write-Host ">>> syncing files to $RemoteHost..." -ForegroundColor Cyan

# Create remote directory structure
Run-SSH "mkdir -p $RemoteDir/enose-control $RemoteDir/proto $RemoteDir/scripts"

# Sync Files
# Using scp for simplicity. Windows 10+ has built-in OpenSSH client.
# Excluding build artifacts and venv
scp -r "$LocalRoot\proto\*" "$RemoteUser@$RemoteHost`:$RemoteDir/proto/"
scp -r "$LocalRoot\scripts\*" "$RemoteUser@$RemoteHost`:$RemoteDir/scripts/"
scp -r "$LocalRoot\enose-control\src" "$RemoteUser@$RemoteHost`:$RemoteDir/enose-control/"
scp "$LocalRoot\enose-control\CMakeLists.txt" "$RemoteUser@$RemoteHost`:$RemoteDir/enose-control/"
scp "$LocalRoot\enose-control\conanfile.txt" "$RemoteUser@$RemoteHost`:$RemoteDir/enose-control/"

Write-Host ">>> Files synced." -ForegroundColor Green

# Make scripts executable
Run-SSH "chmod +x $RemoteDir/scripts/*.sh"

# Run Build
Write-Host ">>> Triggering Remote Build..." -ForegroundColor Cyan
Run-SSH "bash $RemoteDir/scripts/remote_build.sh"

if ($LASTEXITCODE -eq 0) {
    Write-Host ">>> Remote Build Success!" -ForegroundColor Green
} else {
    Write-Host ">>> Remote Build Failed!" -ForegroundColor Red
}
