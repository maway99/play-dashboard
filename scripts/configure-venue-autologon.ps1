$ErrorActionPreference = 'Stop'
$user = Get-LocalUser -Name $env:USERNAME -ErrorAction Stop

if ($user.PasswordRequired -or $user.PasswordLastSet) {
  Write-Warning 'Automatic logon was not changed because the current Windows account has a password. Configure secure auto-logon manually if unattended boot is required.'
  exit 0
}

$winlogon = 'HKLM:\SOFTWARE\Microsoft\Windows NT\CurrentVersion\Winlogon'
Set-ItemProperty $winlogon -Name AutoAdminLogon -Type String -Value '1'
Set-ItemProperty $winlogon -Name ForceAutoLogon -Type String -Value '1'
Set-ItemProperty $winlogon -Name DefaultUserName -Type String -Value $env:USERNAME
Set-ItemProperty $winlogon -Name DefaultDomainName -Type String -Value $env:COMPUTERNAME
Set-ItemProperty $winlogon -Name DefaultPassword -Type String -Value ''

Write-Host "Automatic Windows logon enabled for $env:COMPUTERNAME\$env:USERNAME (passwordless venue account)."
exit 0
