!macro customUnInstall
  ; Remove the silent elevated autostart task (if the user enabled it)
  ExecWait 'schtasks.exe /delete /tn "DNS Switcher" /f'
  ; Remove the registry Run entry (best effort; managed by Electron)
  DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "DNS Switcher"
!macroend
