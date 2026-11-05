; Tauri includes this after utils.nsh. Replace its shared install/uninstall
; process check so silent or interactive maintenance never terminates recording.
!macroundef CheckIfAppIsRunning
!macro CheckIfAppIsRunning executableName productName
  !if "${INSTALLMODE}" == "currentUser"
    nsis_tauri_utils::FindProcessCurrentUser "${executableName}"
  !else
    nsis_tauri_utils::FindProcess "${executableName}"
  !endif
  Pop $R0
  ${If} $R0 = 0
    SetErrorLevel 2
    DetailPrint "Stop recording and close ${productName} before installing or uninstalling."
    ${If} $PassiveMode != 1
      ${IfNot} ${Silent}
        MessageBox MB_OK|MB_ICONEXCLAMATION "Stop recording and close ${productName} before installing or uninstalling."
      ${EndIf}
    ${EndIf}
    Abort
  ${EndIf}
!macroend
