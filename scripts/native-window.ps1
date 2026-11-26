param(
  [ValidateSet('existing','inspect','close')][string]$Action='inspect',
  [int]$ProcessId=0
)
$ErrorActionPreference='Stop'
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding $false
if ($Action -eq 'existing') {
  $existing=@(Get-Process -Name 'Leaf','leaf-editor' -ErrorAction SilentlyContinue | Select-Object Id,ProcessName)
  ConvertTo-Json -InputObject $existing -Compress
  exit 0
}
$process=Get-Process -Id $ProcessId -ErrorAction SilentlyContinue
if (-not $process) {
  @{running=$false;processId=$ProcessId;processes=@();listeners=@()} | ConvertTo-Json -Depth 5 -Compress
  exit 0
}
$process.Refresh()
if ($Action -eq 'close') {
  if ($process.MainWindowHandle -eq [IntPtr]::Zero) { throw 'The owned test process has no main window.' }
  Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class LeafTestWindow {
  [DllImport("user32.dll", SetLastError = true)]
  public static extern bool PostMessage(IntPtr window, uint message, IntPtr wParam, IntPtr lParam);
}
'@
  if (-not [LeafTestWindow]::PostMessage($process.MainWindowHandle,0x0010,[IntPtr]::Zero,[IntPtr]::Zero)) {
    throw 'WM_CLOSE failed for the owned test window.'
  }
  @{requestedClose=$true;processId=$ProcessId} | ConvertTo-Json -Compress
  exit 0
}
$all=@(Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId,Name,CommandLine)
$ids=New-Object 'System.Collections.Generic.HashSet[int]'
[void]$ids.Add($ProcessId)
do {
  $added=$false
  foreach ($item in $all) {
    if ($ids.Contains([int]$item.ParentProcessId) -and $ids.Add([int]$item.ProcessId)) { $added=$true }
  }
} while ($added)
$descendants=@($all | Where-Object { $ids.Contains([int]$_.ProcessId) } | ForEach-Object {
  $dataDirectory=$null
  if ($_.Name -match 'msedgewebview2' -and $_.CommandLine -match '--user-data-dir=(?:"([^"]+)"|(\S+))') {
    if ($Matches[1]) { $dataDirectory=$Matches[1] } else { $dataDirectory=$Matches[2] }
  }
  @{id=[int]$_.ProcessId;parentId=[int]$_.ParentProcessId;name=$_.Name;webviewDataDirectory=$dataDirectory}
})
$listeners=@(Get-NetTCPConnection -State Listen -ErrorAction Stop | Where-Object { $ids.Contains([int]$_.OwningProcess) } | ForEach-Object {
  @{processId=[int]$_.OwningProcess;address=$_.LocalAddress;port=[int]$_.LocalPort}
})
@{running=$true;processId=$ProcessId;windowTitle=$process.MainWindowTitle;hasWindow=($process.MainWindowHandle -ne [IntPtr]::Zero);processes=$descendants;listeners=$listeners} | ConvertTo-Json -Depth 5 -Compress
