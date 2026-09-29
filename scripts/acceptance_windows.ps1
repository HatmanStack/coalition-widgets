# Does this Looker API key do only what it was issued to do?
#
# The same test as scripts/acceptance.py, for a machine with no Python. curl.exe and PowerShell
# only, both of which Windows 10 (1803 and later) and Windows 11 have out of the box.
#
#   curl.exe -sO <this file>
#   powershell -ExecutionPolicy Bypass -File acceptance_windows.ps1 --host https://example.cloud.looker.com --look 123
#
# It asks for the client ID and secret without echoing them (or reads LOOKER_CLIENT_ID and
# LOOKER_CLIENT_SECRET). Three things must hold:
#
#   run_look     the Look in the public folder runs.                          200 with rows
#   own query    a query the key builds itself, from that Look's own fields,
#                is refused. Needs explore, which the key must not have.      403
#   SQL Runner   the key cannot create a SQL Runner query. Never run.         403
#
# Nothing printed is data: status codes, row counts and counts of things. Never a field value,
# never a response body, never the key. Bodies go to a temp directory that is deleted on exit.
#
# Exit: 0 PASS, 1 FAIL, 2 INCONCLUSIVE, 3 could not run. The same codes as acceptance.py, and
# scripts/check-acceptance.mjs runs both against the same mock keys so they cannot disagree.
#
# The arguments are parsed by hand rather than with param(), so that --host and --look are typed
# the same way here as in the other two. PowerShell reserves $Host, so a -Host parameter is not
# available to bind anyway.

# Written as ASCII with a byte order mark. Windows PowerShell 5.1 reads a .ps1 as ANSI unless it
# has one, so a UTF-8 em dash arrives as three CP1252 characters, the last of which is a curly
# quote that PowerShell treats as a string delimiter. The file then fails to parse - which is how
# this was found, on the Windows CI job, after it passed review twice.

$ErrorActionPreference = "Stop"

$LookerHost = ""; $LookId = ""; $ClientField = ""
for ($i = 0; $i -lt $args.Count; $i++) {
  switch ($args[$i]) {
    "--host"         { $LookerHost = $args[++$i] }
    "--look"         { $LookId = $args[++$i] }
    "--client-field" { $ClientField = $args[++$i] }
    default { Write-Output "unknown option $($args[$i]). Expected --host and --look."; exit 3 }
  }
}
if (-not $LookerHost -or -not $LookId) {
  Write-Output "usage: powershell -ExecutionPolicy Bypass -File acceptance_windows.ps1 --host https://x.cloud.looker.com --look 123"
  exit 3
}

# https only, except a loopback address, which is where the mock runs for rehearsal. Parsed
# rather than matched with a wildcard: http://localhost* also matches
# http://localhost.attacker.example, and the key would have gone there in clear.
$parsed = $null
try { $parsed = [uri]$LookerHost } catch { $parsed = $null }
$loopback = @("localhost", "127.0.0.1", "::1")
if (-not $parsed -or -not ($parsed.Scheme -eq "https" -or ($parsed.Scheme -eq "http" -and $loopback -contains $parsed.Host))) {
  Write-Output "refusing $LookerHost : the key would cross the network in clear"
  exit 3
}
$LookerHost = $LookerHost.TrimEnd("/")
if ($LookerHost.EndsWith("/api/4.0")) { $LookerHost = $LookerHost.Substring(0, $LookerHost.Length - 8).TrimEnd("/") }

$cid = $env:LOOKER_CLIENT_ID
$sec = $env:LOOKER_CLIENT_SECRET
if (-not $cid) { $cid = Read-Host "Client ID" }
if (-not $sec) {
  $secure = Read-Host "Client secret" -AsSecureString
  $sec = [System.Net.NetworkCredential]::new("", $secure).Password
}

$tmp = Join-Path $env:TEMP ([guid]::NewGuid().ToString())
New-Item -ItemType Directory -Path $tmp | Out-Null

# Written without a byte order mark. Set-Content in Windows PowerShell writes UTF8 with one, and
# a BOM at the start of a request body is not valid JSON to the server.
function Write-Json($object, $path) {
  [System.IO.File]::WriteAllText($path, ($object | ConvertTo-Json -Compress))
}

function Read-Json($path) {
  $raw = ""
  if (Test-Path $path) { $raw = Get-Content $path -Raw }
  if (-not $raw) { return $null }
  try { return $raw | ConvertFrom-Json } catch { return $null }
}

# Whether the body is a JSON array, read from the text rather than from what ConvertFrom-Json
# hands back. Windows PowerShell 5.1 returns an array whole; PowerShell 7 enumerates it, so a
# one-row response arrives as a single object and "did it return rows" would answer no on any
# machine with pwsh. The text says what the server sent, in every version.
function Test-JsonArray($path) {
  $raw = ""
  if (Test-Path $path) { $raw = Get-Content $path -Raw }
  return ($raw -and $raw.TrimStart().StartsWith("["))
}

# No -L anywhere: curl does not follow redirects unless asked, and the token must not be carried
# to a host nobody configured.
function Invoke-Api($method, $path, $outName, $extra) {
  $out = Join-Path $tmp $outName
  # -q first: a user's own curl config could add --location, and a redirect would carry the
  # Authorization header to whatever host it named.
  $params = @("-q", "-s", "-S", "-m", "30", "-o", $out, "-w", "%{http_code}", "-X", $method,
              "-K", (Join-Path $tmp "curlrc"), "$LookerHost/api/4.0$path")
  if ($extra) { $params += $extra }
  return (& curl.exe @params)
}

# Everything that touches the temp directory runs inside this, so the token and any rows it holds
# are deleted on every path out: a verdict, a terminating error, or the login giving up.
# scripts/check-acceptance.mjs gives each run a TEMP of its own and fails if anything is left in
# it, which is what proves the claim rather than assuming PowerShell honours it. Bash has
# trap EXIT for the same reason.
try {
  Write-Output ""
  Write-Output "Looker acceptance test   $LookerHost   Look $LookId"
  Write-Output ""

  # Nothing sensitive on a command line: another process can read one, and endpoint software
  # commonly logs what it sees there. curl reads the credentials out of files and the token out
  # of a config file, all under the user's own TEMP and deleted on the way out.
  $loginOut = Join-Path $tmp "login.json"
  [System.IO.File]::WriteAllText((Join-Path $tmp "cid"), $cid)
  [System.IO.File]::WriteAllText((Join-Path $tmp "sec"), $sec)
  $code = & curl.exe -q -s -S -m 30 -o $loginOut -w "%{http_code}" -X POST "$LookerHost/api/4.0/login" `
    --data-urlencode "client_id@$(Join-Path $tmp 'cid')" --data-urlencode "client_secret@$(Join-Path $tmp 'sec')"
  Remove-Item (Join-Path $tmp "cid"), (Join-Path $tmp "sec") -Force -ErrorAction SilentlyContinue
  $token = (Read-Json $loginOut).access_token
  if ($code -ne "200" -or -not $token) {
    Write-Output "  login     $code. Check the client ID and secret, and the host."
    exit 3
  }
  [System.IO.File]::WriteAllText((Join-Path $tmp "curlrc"), "header = `"Authorization: token $token`"`n")

  $failed = $false; $unknown = $false; $ran = @()

  function Write-Line($label, $outcome, $detail) {
    $mark = switch ($outcome) { "ok" { "ok  " } "FAIL" { "FAIL" } default { "??  " } }
    Write-Output ("  {0}  {1,-12}  {2}" -f $mark, $label, $detail)
    if ($outcome -eq "FAIL") { $script:failed = $true; $script:ran += $label }
    if ($outcome -eq "??") { $script:unknown = $true }
  }

  function Get-Rows($path) {
    $n = @(Read-Json $path).Count
    if ($n -eq 1) { "1 row" } else { "$n rows" }
  }

  # What a refusal came back as, for something the key must not be able to do.
  function Get-Classification($code, $path) {
    $body = Read-Json $path
    if ($code -eq "403") { return @("ok", "403 refused") }
    if ($code -eq "200" -and (Test-JsonArray $path)) { return @("FAIL", "200, ran and returned $(Get-Rows $path)") }
    if ($code -eq "200" -and $body.slug) { return @("FAIL", "200, created (not run)") }
    if ($code -eq "200") { return @("??", "200 with an error object, not a refusal") }
    if ([int]$code -ge 300 -and [int]$code -lt 400) { return @("??", "$code redirect, not followed") }
    return @("??", "$code, not the 403 a missing permission gives")
  }

  # The Look's own model, explore and fields: what the probe is built from, and its folder.
  $code = Invoke-Api GET "/looks/$LookId`?fields=id,folder_id,query" "look.json"
  $look = if ($code -eq "200") { Read-Json (Join-Path $tmp "look.json") } else { $null }
  $query = $look.query
  $folder = $look.folder_id

  $code = Invoke-Api GET "/looks/$LookId/run/json`?apply_formatting=false&limit=500" "rows.json"
  $rowsPath = Join-Path $tmp "rows.json"
  if ($code -eq "200" -and (Test-JsonArray $rowsPath)) { Write-Line "run_look" "ok" "200, $(Get-Rows $rowsPath)" }
  elseif ($code -eq "200") { Write-Line "run_look" "??" "200 with an error object: the Look did not run" }
  else { Write-Line "run_look" "??" "$code`: the key cannot run Look $LookId" }

  if (-not $query -or -not $query.model -or -not $query.view) {
    Write-Line "own query" "??" "could not read the Look's query to build the probe"
    Write-Line "SQL Runner" "??" "no model to probe with"
  } else {
    $fields = if ($ClientField) { @($ClientField) } else { @($query.fields) }
    Write-Json @{ model = $query.model; view = $query.view; fields = $fields; limit = "1" } (Join-Path $tmp "probe-body.json")
    $code = Invoke-Api POST "/queries/run/json" "probe.json" @("-H", "Content-Type: application/json", "-d", "@$(Join-Path $tmp 'probe-body.json')")
    $verdict = Get-Classification $code (Join-Path $tmp "probe.json")
    Write-Line "own query" $verdict[0] $verdict[1]

    Write-Json @{ model_name = $query.model; sql = "SELECT 1" } (Join-Path $tmp "sql-body.json")
    $code = Invoke-Api POST "/sql_queries" "sql.json" @("-H", "Content-Type: application/json", "-d", "@$(Join-Path $tmp 'sql-body.json')")
    $verdict = Get-Classification $code (Join-Path $tmp "sql.json")
    Write-Line "SQL Runner" $verdict[0] $verdict[1]
  }

  # Where the account differs from the spec. Reported, not judged: the checks above are what decide.
  $code = Invoke-Api GET "/user`?fields=id,group_ids,credentials_api3" "user.json"
  if ($code -eq "200") {
    $user = Read-Json (Join-Path $tmp "user.json")
    $groups = @($user.group_ids)
    $keys = @($user.credentials_api3 | Where-Object { -not $_.is_disabled })
    if ($groups.Count -gt 0) { Write-Output "  note  the API user is in $($groups.Count) group(s); the spec said none" }
    if ($keys.Count -gt 1) { Write-Output "  note  the API user holds $($keys.Count) active API keys; the spec said one" }
  } else {
    Write-Output "  note  could not read the API user ($code)"
  }

  $code = Invoke-Api GET "/looks`?fields=id,folder_id" "looks.json"
  if ($code -eq "200") {
    $looks = @(Read-Json (Join-Path $tmp "looks.json"))
    $elsewhere = $looks | Where-Object { "$($_.folder_id)" -ne "$folder" } | Group-Object folder_id
    if ($elsewhere) {
      $where = ($elsewhere | ForEach-Object { "folder $($_.Name): $($_.Count)" }) -join ", "
      Write-Output "  note  Looks visible outside folder $folder ($where)"
    }
  } else {
    Write-Output "  note  could not list visible Looks ($code)"
  }

  $code = & curl.exe -q -s -S -m 30 -o NUL -w "%{http_code}" -X DELETE -K (Join-Path $tmp "curlrc") "$LookerHost/api/4.0/logout"
  if ($LASTEXITCODE -ne 0 -or $code -notin @("200", "204")) {
    Write-Output "  note  logout returned $code: this session's token stays valid until it expires"
  }

  Write-Output ""
  if ($failed) {
    Write-Output "FAIL  Do not store this key. It can do more than it was issued for."
    Write-Output "      Ran when it should have been refused: $($ran -join ', ')."
    Write-Output "      For Bitfocus: the role should carry access_data and see_looks only -"
    Write-Output "      no explore, no use_sql_runner, no group inheritance."
    exit 1
  }
  if ($unknown) {
    Write-Output "INCONCLUSIVE  Nothing ran that should not have, but the test did not prove the"
    Write-Output "      key is scoped. Do not store it yet. The ?? lines say what came back."
    exit 2
  }
  Write-Output "PASS  The key runs its Look and is refused everything else."
  exit 0

} finally {
  Remove-Item $tmp -Recurse -Force -ErrorAction SilentlyContinue
  # Not suppressed: a verdict of PASS while the token is still on disk would be a false one.
  if (Test-Path $tmp) {
    Write-Output ""
    Write-Output "COULD NOT CLEAN UP  $tmp still holds the login token. Delete it yourself."
    exit 3
  }
}
