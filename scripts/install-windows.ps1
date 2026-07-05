param(
  [string]$Version = "latest",
  [string]$InstallDir = "$env:LOCALAPPDATA\Programs\APRSNET Desktop",
  [switch]$NoShortcut
)

$ErrorActionPreference = "Stop"
$repo = "2E0LXY/APRS-Client"
$apiBase = "https://api.github.com/repos/$repo/releases"
$releaseUri = if ($Version -eq "latest") { "$apiBase/latest" } else { "$apiBase/tags/$Version" }

Write-Host "Fetching APRSNET Desktop release metadata..."
$release = Invoke-RestMethod -Uri $releaseUri -Headers @{ "User-Agent" = "APRSNET-Desktop-Installer" }
$asset = $release.assets |
  Where-Object { $_.name -match "\.zip$" -and $_.name -match "APRSNET|Desktop|win|Windows" } |
  Select-Object -First 1

if (-not $asset) {
  throw "No Windows zip asset was found on release $($release.tag_name)."
}

$tempRoot = Join-Path $env:TEMP ("aprsnet-desktop-install-" + [guid]::NewGuid().ToString("N"))
$zipPath = Join-Path $tempRoot $asset.name
$extractDir = Join-Path $tempRoot "extract"

New-Item -ItemType Directory -Path $tempRoot, $extractDir -Force | Out-Null

try {
  Write-Host "Downloading $($asset.name)..."
  Invoke-WebRequest -Uri $asset.browser_download_url -OutFile $zipPath -Headers @{ "User-Agent" = "APRSNET-Desktop-Installer" }

  Write-Host "Extracting package..."
  Expand-Archive -Path $zipPath -DestinationPath $extractDir -Force
  $appExe = Get-ChildItem -Path $extractDir -Filter "APRSNET Desktop.exe" -Recurse | Select-Object -First 1
  if (-not $appExe) {
    throw "Downloaded package did not contain APRSNET Desktop.exe."
  }

  $sourceDir = $appExe.Directory.FullName
  $resolvedParent = [System.IO.Path]::GetFullPath((Split-Path -Parent $InstallDir))
  $resolvedInstall = [System.IO.Path]::GetFullPath($InstallDir)
  $installLeaf = Split-Path -Leaf $resolvedInstall
  if ($resolvedInstall.Length -lt 10 -or
      -not $resolvedInstall.StartsWith($resolvedParent, [System.StringComparison]::OrdinalIgnoreCase) -or
      $installLeaf -notin @("APRSNET Desktop", "aprsnet-desktop")) {
    throw "Refusing to install to unsafe path: $InstallDir"
  }

  Get-Process -Name "APRSNET Desktop" -ErrorAction SilentlyContinue | Stop-Process -Force
  Remove-Item -LiteralPath $InstallDir -Recurse -Force -ErrorAction SilentlyContinue
  New-Item -ItemType Directory -Path $InstallDir -Force | Out-Null
  Copy-Item -Path (Join-Path $sourceDir "*") -Destination $InstallDir -Recurse -Force

  $installedExe = Join-Path $InstallDir "APRSNET Desktop.exe"
  if (-not (Test-Path $installedExe)) {
    throw "Install completed but APRSNET Desktop.exe was not found in $InstallDir."
  }

  if (-not $NoShortcut) {
    $shell = New-Object -ComObject WScript.Shell
    $desktopShortcut = Join-Path ([Environment]::GetFolderPath("Desktop")) "APRSNET Desktop.lnk"
    $startMenuDir = Join-Path $env:APPDATA "Microsoft\Windows\Start Menu\Programs\APRSNET Desktop"
    New-Item -ItemType Directory -Path $startMenuDir -Force | Out-Null
    foreach ($shortcutPath in @($desktopShortcut, (Join-Path $startMenuDir "APRSNET Desktop.lnk"))) {
      $shortcut = $shell.CreateShortcut($shortcutPath)
      $shortcut.TargetPath = $installedExe
      $shortcut.WorkingDirectory = $InstallDir
      $shortcut.IconLocation = "$installedExe,0"
      $shortcut.Save()
    }
  }

  Write-Host "APRSNET Desktop $($release.tag_name) installed to $InstallDir"
  Write-Host "Run: $installedExe"
} finally {
  Remove-Item -LiteralPath $tempRoot -Recurse -Force -ErrorAction SilentlyContinue
}
