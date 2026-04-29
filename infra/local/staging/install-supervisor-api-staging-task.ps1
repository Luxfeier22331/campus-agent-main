param(
  [string]$TaskName = "CampusAgent-SupervisorApiStaging",
  [Parameter(Mandatory = $true)]
  [string]$WslDistroName,
  [Parameter(Mandatory = $true)]
  [string]$LinuxUser,
  [Parameter(Mandatory = $true)]
  [string]$RepoPath
)

$ErrorActionPreference = "Stop"

$principalUserId = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name
$logonUser = $principalUserId.Split("\")[-1]
$wslExecutable = Join-Path $env:SystemRoot "System32\wsl.exe"
$bashCommand = "cd '$RepoPath' && export SUPERVISOR_API_STAGING_PORT='27010' && export SUPERVISOR_API_STAGING_TUNNEL_NAME='supervisor-api-staging' && export SUPERVISOR_API_STAGING_PUBLIC_BASE_URL='https://exec-staging.ayafeed.com' && export SUPERVISOR_API_STAGING_APP_API_BASE_URL='https://campus-api-staging.ayafeed.com' && ./infra/local/staging/start-supervisor-api-staging.sh"
$actionArguments = "-d $WslDistroName -u $LinuxUser -- bash -lc `"$bashCommand`""

$action = New-ScheduledTaskAction -Execute $wslExecutable -Argument $actionArguments
$logonTrigger = New-ScheduledTaskTrigger -AtLogOn -User $logonUser
$repeatTrigger = New-ScheduledTaskTrigger `
  -Once `
  -At ((Get-Date).AddMinutes(1)) `
  -RepetitionInterval (New-TimeSpan -Minutes 5) `
  -RepetitionDuration (New-TimeSpan -Days 3650)
$settings = New-ScheduledTaskSettingsSet `
  -AllowStartIfOnBatteries `
  -DontStopIfGoingOnBatteries `
  -MultipleInstances IgnoreNew `
  -StartWhenAvailable `
  -ExecutionTimeLimit (New-TimeSpan -Minutes 10)
$principal = New-ScheduledTaskPrincipal -UserId $principalUserId -LogonType Interactive -RunLevel Limited

Register-ScheduledTask `
  -TaskName $TaskName `
  -Action $action `
  -Trigger @($logonTrigger, $repeatTrigger) `
  -Settings $settings `
  -Principal $principal `
  -Description "Keep the campus-agent supervisor-api staging execution runtime online from this development host." `
  -Force | Out-Null

Start-ScheduledTask -TaskName $TaskName

Get-ScheduledTask -TaskName $TaskName | Select-Object `
  TaskName,
  State,
  @{ Name = "User"; Expression = { $_.Principal.UserId } },
  @{ Name = "Execute"; Expression = { $_.Actions.Execute } },
  @{ Name = "Arguments"; Expression = { $_.Actions.Arguments } }
