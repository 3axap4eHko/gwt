$ErrorActionPreference = 'Stop'

$repo = '3axap4eHko/gwt'
$arch = switch ($env:PROCESSOR_ARCHITECTURE) {
  'AMD64' { 'x64' }
  default { throw "Unsupported Windows architecture: $env:PROCESSOR_ARCHITECTURE" }
}

$release = Invoke-RestMethod -Headers @{ 'User-Agent' = 'gwt-install' } -Uri "https://api.github.com/repos/$repo/releases/latest"
$version = $release.tag_name
$url = "https://github.com/$repo/releases/download/$version/gwt-windows-$arch.exe"
$temp = Join-Path $env:TEMP 'gwt-install.exe'

Write-Host "Downloading gwt $version (windows-$arch)..."
Invoke-WebRequest -Headers @{ 'User-Agent' = 'gwt-install' } -Uri $url -OutFile $temp
& $temp install
Remove-Item -LiteralPath $temp -Force -ErrorAction SilentlyContinue
