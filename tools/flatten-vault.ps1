# One-time repair: the key-churn (before the stable-keys fix) wrapped each vault block's
# pointer inside a new pointer on every publish, so content.json now points to a chain of
# pointers instead of the real content. This follows each chain in R2 to the real content
# and copies it UP to the top key that content.json already points to (and grants cover),
# collapsing the chain to a single hop. Non-destructive: the deep objects stay in R2.
$ErrorActionPreference = "Continue"
Set-Location C:\Users\riku\ritesh-portfolio
$env:WRANGLER_SEND_METRICS = "false"
$cj = Get-Content content.json -Raw | ConvertFrom-Json
$repaired = 0; $skipped = 0; $failed = 0; $media = @{}
$tmp = "$env:TEMP\rk_hop.json"
foreach ($w in $cj.work) {
  if (-not $w.study -or -not $w.study.blocks) { continue }
  foreach ($b in $w.study.blocks) {
    if (-not $b.vaultBlock) { continue }
    $topKey = [string]$b.vaultBlock
    $key = $topKey; $levels = 0; $content = $null; $ok = $true
    for ($i = 0; $i -lt 20; $i++) {
      Remove-Item $tmp -ErrorAction SilentlyContinue
      npx --yes wrangler r2 object get "rk-vault/$key" --file $tmp --remote 2>&1 | Out-Null
      if (-not (Test-Path $tmp)) { $ok = $false; break }
      $content = Get-Content $tmp -Raw
      $m = [regex]::Match($content, '"vaultBlock":"([0-9a-f]{64}\.json)"')
      if ($m.Success) { $key = $m.Groups[1].Value; $levels++ } else { break }
    }
    if (-not $ok) { $failed++; Write-Host ("FAIL  {0} {1} (missing object at level {2})" -f $w.id, $topKey.Substring(0,10), $levels); continue }
    foreach ($mm in [regex]::Matches($content, 'vault:([0-9a-f]{64}(?:\.[a-z0-9]+)?)')) { $media[$mm.Groups[1].Value] = 1 }
    if ($levels -eq 0) { $skipped++; continue }
    # $tmp currently holds the real content (last fetched, no nested vaultBlock) -> put it at the top key
    npx --yes wrangler r2 object put "rk-vault/$topKey" --file $tmp --content-type "application/json" --remote 2>&1 | Out-Null
    $repaired++; Write-Host ("REPAIR {0} {1} (was {2} levels deep)" -f $w.id, $topKey.Substring(0,10), $levels)
  }
}
Write-Host ("=== repaired={0} already-flat={1} failed={2} mediaKeysFound={3} ===" -f $repaired, $skipped, $failed, $media.Count)
if ($media.Count -gt 0) { Write-Host ("media keys: " + ($media.Keys -join ",")) }
