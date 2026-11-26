param([Parameter(Mandatory=$true)][string]$Source, [Parameter(Mandatory=$true)][string]$Destination)
$ErrorActionPreference='Stop'
$sourcePath = (Resolve-Path -LiteralPath $Source).Path
if (Test-Path -LiteralPath $Destination) { throw "Refusing to overwrite existing ZIP: $Destination" }
Add-Type -AssemblyName System.IO.Compression.FileSystem
[System.IO.Compression.ZipFile]::CreateFromDirectory($sourcePath, $Destination, [System.IO.Compression.CompressionLevel]::Optimal, $true)
Get-Item -LiteralPath $Destination | Select-Object FullName,Length | ConvertTo-Json
