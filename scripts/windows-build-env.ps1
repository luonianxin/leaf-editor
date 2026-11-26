param([ValidateSet('x64','arm64')][string]$Architecture='x64')
$ErrorActionPreference='Stop'
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding $false
$vswhere = Join-Path ${env:ProgramFiles(x86)} 'Microsoft Visual Studio\Installer\vswhere.exe'
if (-not (Test-Path -LiteralPath $vswhere)) { throw 'Visual Studio C++ Build Tools are not installed.' }
$path = & $vswhere -latest -products '*' -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath
if (-not $path) { throw 'No completed Visual Studio C++ Build Tools installation found. Install C++ Tools and Windows SDK.' }
$script = Join-Path $path 'Common7\Tools\VsDevCmd.bat'
# VsDevCmd also invokes vswhere internally; make the installer tools discoverable.
$env:Path = (Split-Path -Parent $vswhere) + ';' + $env:Path
$command = '""' + $script + '" -no_logo -arch=' + $Architecture + ' -host_arch=x64 >nul && set"'
$lines = & $env:ComSpec /d /s /c $command
if ($LASTEXITCODE -ne 0) { throw "Failed to initialize the C++ build environment: $LASTEXITCODE" }
$values = @{}
foreach ($line in $lines) {
  $index = $line.IndexOf('=')
  if ($index -gt 0) { $values[$line.Substring(0,$index)] = $line.Substring($index+1) }
}
if (-not $values['LIB'] -or -not $values['WindowsSdkDir']) { throw 'Windows SDK LIB or WindowsSdkDir is not set.' }
$values | ConvertTo-Json -Compress
