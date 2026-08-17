# After flattening, re-seed each recruiter work's vault key cache with the FULL closure it needs:
# the block top key content.json points to + every vault: media key inside the (now flat) content.
# Grants are minted from these caches, so this lets owner/recruiter grants authorize the images/video
# too. Unions with the existing cache (never shrinks).
$ErrorActionPreference = "Continue"
Set-Location C:\Users\riku\ritesh-portfolio
$env:WRANGLER_SEND_METRICS = "false"
$ns = "ec6ed36fa1fd4dbfb9483a147d003aef"
$cj = Get-Content content.json -Raw | ConvertFrom-Json
$tmp = "$env:TEMP\rk_seed_hop.json"
foreach ($w in $cj.work) {
  if (-not $w.study -or -not $w.study.blocks) { continue }
  $keys = @{}
  foreach ($b in $w.study.blocks) {
    if (-not $b.vaultBlock) { continue }
    $keys[[string]$b.vaultBlock] = 1
    $key = [string]$b.vaultBlock
    for ($i = 0; $i -lt 12; $i++) {
      Remove-Item $tmp -ErrorAction SilentlyContinue
      npx --yes wrangler r2 object get "rk-vault/$key" --file $tmp --remote 2>&1 | Out-Null
      if (-not (Test-Path $tmp)) { break }
      $c = Get-Content $tmp -Raw
      $m = [regex]::Match($c, '"vaultBlock":"([0-9a-f]{64}\.json)"')
      if ($m.Success) { $keys[$m.Groups[1].Value] = 1; $key = $m.Groups[1].Value }
      else { foreach ($mm in [regex]::Matches($c, 'vault:([0-9a-f]{64}(?:\.[a-z0-9]+)?)')) { $keys[$mm.Groups[1].Value] = 1 }; break }
    }
  }
  if ($keys.Count -eq 0) { continue }
  $existing = npx --yes wrangler kv key get "vaultkeys:$($w.id)" --namespace-id $ns --remote 2>&1 | Out-String
  foreach ($em in [regex]::Matches($existing, '[0-9a-f]{64}(?:\.[a-z0-9]+)?')) { $keys[$em.Value] = 1 }
  $arr = @($keys.Keys)
  $json = "[" + (($arr | ForEach-Object { '"' + $_ + '"' }) -join ",") + "]"
  Set-Content -Path "$env:TEMP\rk_keys.json" -Value $json -NoNewline -Encoding UTF8
  npx --yes wrangler kv key put "vaultkeys:$($w.id)" --path "$env:TEMP\rk_keys.json" --namespace-id $ns --remote 2>&1 | Out-Null
  Write-Host ("SEEDED {0} -> {1} keys" -f $w.id, $arr.Count)
}
Write-Host "done"
