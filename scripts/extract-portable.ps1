param([Parameter(Mandatory=$true)][string]$Source, [Parameter(Mandatory=$true)][string]$Destination)
$ErrorActionPreference='Stop'
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding $false
$sourcePath = (Resolve-Path -LiteralPath $Source).Path
if (Test-Path -LiteralPath $Destination) { throw "Extraction destination must be new: $Destination" }
Add-Type -AssemblyName System.IO.Compression.FileSystem
$archive=[System.IO.Compression.ZipFile]::OpenRead($sourcePath)
try {
  foreach ($entry in $archive.Entries) {
    $parts=$entry.FullName -split '[/\\]'
    if ($entry.FullName.StartsWith('/') -or $entry.FullName.StartsWith('\') -or $entry.FullName.Contains(':') -or ($parts -contains '..')) {
      throw "Unsafe ZIP entry: $($entry.FullName)"
    }
  }
} finally { $archive.Dispose() }
[System.IO.Compression.ZipFile]::ExtractToDirectory($sourcePath, $Destination)
Get-Item -LiteralPath $Destination | Select-Object FullName | ConvertTo-Json -Compress
