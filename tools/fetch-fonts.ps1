# One-shot: self-host the Google Fonts (latin + latin-ext) used by the site, so the render-blocking
# cross-origin request to fonts.googleapis.com/gstatic.com is removed. Generates css/fonts.css.
$ErrorActionPreference = 'Stop'
Set-Location C:\Users\riku\ritesh-portfolio
$ua  = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
$url = 'https://fonts.googleapis.com/css2?family=Fraunces:ital,opsz,wght@0,9..144,300..600;1,9..144,300..600&family=Inter:wght@400;500;600&family=JetBrains+Mono:wght@400;500&display=swap'
$css = (Invoke-WebRequest -UseBasicParsing -Headers @{ 'User-Agent' = $ua } -Uri $url).Content
New-Item -ItemType Directory -Force -Path fonts | Out-Null
$keep = @('latin', 'latin-ext')
$rx   = [regex]"(?s)/\*\s*(?<sub>[\w-]+)\s*\*/\s*@font-face\s*\{(?<body>[^}]*)\}"
$out  = New-Object System.Collections.Generic.List[string]
foreach ($m in $rx.Matches($css)) {
  $sub = $m.Groups['sub'].Value
  if ($keep -notcontains $sub) { continue }
  $body   = $m.Groups['body'].Value
  $fam    = ([regex]"font-family:\s*'([^']+)'").Match($body).Groups[1].Value
  $style  = ([regex]"font-style:\s*(\w+)").Match($body).Groups[1].Value
  $weight = ([regex]"font-weight:\s*([^;]+)").Match($body).Groups[1].Value.Trim()
  $u      = ([regex]"url\((https://fonts\.gstatic\.com/[^)]+\.woff2)\)").Match($body).Groups[1].Value
  $ur     = ([regex]"unicode-range:\s*([^;]+)").Match($body).Groups[1].Value.Trim()
  $slug   = ($fam.ToLower() -replace '[^a-z0-9]', '')
  $wslug  = ($weight -replace '\s+', '')
  $name   = "$slug-$style-$wslug-$sub.woff2"
  Invoke-WebRequest -UseBasicParsing -Uri $u -OutFile "fonts/$name"
  $out.Add("@font-face { font-family: '$fam'; font-style: $style; font-weight: $weight; font-display: swap; src: url('../fonts/$name') format('woff2'); unicode-range: $ur; }")
}
$header = "/* Self-hosted fonts (latin + latin-ext) - replaces the render-blocking Google Fonts request. Regenerate with tools/fetch-fonts.ps1. */"
Set-Content -Path css/fonts.css -Value ($header + "`n" + ($out -join "`n")) -Encoding UTF8 -NoNewline
"WROTE css/fonts.css with $($out.Count) faces"
Get-ChildItem fonts -File | Sort-Object Name | ForEach-Object { "  {0,-40} {1,7:N1} KB" -f $_.Name, ($_.Length / 1KB) }
"TOTAL fonts: {0:N0} KB" -f ((Get-ChildItem fonts -File | Measure-Object Length -Sum).Sum / 1KB)
