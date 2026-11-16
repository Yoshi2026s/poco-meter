$ErrorActionPreference = 'Stop'
$token = Read-Host 'GoatCounter stats API key' -AsSecureString
$ptr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($token)
try {
    $env:POCO_METER_GOATCOUNTER_TOKEN = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($ptr)
    node (Join-Path $PSScriptRoot 'visitor-dashboard.mjs')
} finally {
    [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ptr)
    Remove-Item Env:POCO_METER_GOATCOUNTER_TOKEN -ErrorAction SilentlyContinue
}
