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
Add-Type -TypeDefinition @'
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Text;
public static class LeafTestWindow {
  public delegate bool EnumProc(IntPtr window, IntPtr param);
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc callback, IntPtr param);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr window);
  [DllImport("user32.dll")] public static extern int GetWindowLongW(IntPtr window, int index);
  [StructLayout(LayoutKind.Sequential)] public struct Rect { public int Left, Top, Right, Bottom; }
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr window, out Rect rect);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr window, out uint pid);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int GetWindowText(IntPtr window, StringBuilder text, int count);
  [DllImport("user32.dll", SetLastError = true)]
  public static extern bool PostMessage(IntPtr window, uint message, IntPtr wParam, IntPtr lParam);
  public static IntPtr[] VisibleWindows(int pid) {
    var windows = new List<IntPtr>();
    EnumWindows((window, param) => {
      uint owner; GetWindowThreadProcessId(window, out owner);
      // Single-instance and WebView helper HWNDs can carry WS_VISIBLE too.
      Rect rect;
      if (owner == pid && IsWindowVisible(window)
          && (GetWindowLongW(window, -20) & 0x80) == 0
          && GetWindowRect(window, out rect) && rect.Right > rect.Left && rect.Bottom > rect.Top)
        windows.Add(window);
      return true;
    }, IntPtr.Zero);
    return windows.ToArray();
  }
  public static string Title(IntPtr window) {
    var text = new StringBuilder(1024); GetWindowText(window, text, text.Capacity); return text.ToString();
  }
}
'@
$windows=@([LeafTestWindow]::VisibleWindows($ProcessId))
$window=if ($windows.Count -eq 1) { $windows[0] } else { [IntPtr]::Zero }
if ($Action -eq 'close') {
  if ($window -eq [IntPtr]::Zero) { throw "Expected exactly one visible owned test window, found $($windows.Count)." }
  if (-not [LeafTestWindow]::PostMessage($window,0x0010,[IntPtr]::Zero,[IntPtr]::Zero)) {
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
@{running=$true;processId=$ProcessId;windowTitle=([LeafTestWindow]::Title($window));hasWindow=($window -ne [IntPtr]::Zero);visibleWindows=@($windows | ForEach-Object { @{handle=$_.ToInt64();title=([LeafTestWindow]::Title($_))} });processes=$descendants;listeners=$listeners} | ConvertTo-Json -Depth 5 -Compress
