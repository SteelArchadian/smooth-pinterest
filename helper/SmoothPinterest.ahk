; Smooth Pinterest helper. Targets AutoHotkey v2.0 (build.py compiles it).
; Double-click = install. Opera starts it (argv[1] = chrome-extension://...)
; only to apply an update, and it exits when the extension's port closes.
#Requires AutoHotkey v2.0
#NoTrayIcon
#SingleInstance Off
Persistent

HOST   := "com.smoothpinterest.helper"
EXT_ID := "dmeknhneiekhjhcibdfnikjoidklmbko"
REGKEY := "HKCU\Software\Google\Chrome\NativeMessagingHosts\" HOST
APP_NAME    := "Smooth Pinterest"
HELPER_EXE    := "SmoothPinterest.exe"

if (A_Args.Length && InStr(A_Args[1], "chrome-extension://") = 1)
    RunHost()
else if (A_Args.Length && A_Args[1] = "/unregister")
    Unregister()
else
    Register()

; ---------------------------------------------------------------- setup

; Copies itself and the extension to a fixed place, so Load unpacked and
; host.json never point into Downloads. A newer unzip updates in place.
Install(appDir) {
    exe := appDir "\" HELPER_EXE
    try {
        DirCreate(appDir)
        ; A running exe can't be overwritten but can be renamed.
        if FileExist(exe) {
            try FileDelete(appDir "\SmoothPinterest.old.exe")
            FileMove(exe, appDir "\SmoothPinterest.old.exe", 1)
        }
        FileCopy(A_ScriptFullPath, exe, 1)
        DirCopy(A_ScriptDir "\extension", appDir "\extension", 1)
    } catch as e {
        MsgBox("Install failed:`n" e.Message, APP_NAME, "Iconx")
        ExitApp(1)
    }
    Run('"' exe '"')
    ExitApp(0)
}

Register() {
    appDir := EnvGet("LOCALAPPDATA") "\" APP_NAME "\App"
    if (A_IsCompiled && A_ScriptDir != appDir)
        return Install(appDir)

    jsonPath := A_ScriptDir "\host.json"
    exe := StrReplace(A_ScriptFullPath, "\", "\\")
    json := '{"name":"' HOST '","description":"' APP_NAME ' helper","path":"' exe
        . '","type":"stdio","allowed_origins":["chrome-extension://' EXT_ID '/"]}'
    try {
        f := FileOpen(jsonPath, "w", "UTF-8-RAW")
        f.Write(json)
        f.Close()
        RegWrite(jsonPath, "REG_SZ", REGKEY)
    } catch as e {
        MsgBox("Registration failed:`n" e.Message, APP_NAME, "Iconx")
        ExitApp(1)
    }
    ; Opera won't open opera://extensions from the command line, so hand
    ; the user the path to paste instead.
    A_Clipboard := A_ScriptDir "\extension"
    MsgBox(APP_NAME " is installed in:`n" A_ScriptDir "`n`n"
        . "First time only, in Opera GX:`n"
        . "1. Type opera://extensions in the address bar`n"
        . "2. Turn on Developer mode`n"
        . "3. Click Load unpacked, press Ctrl+V, Enter`n"
        . "(The extension folder path is on your clipboard.)`n`n"
        . "Updating? The extension updates itself; or double-click this again.", APP_NAME)
    ExitApp(0)
}

Unregister() {
    try RegDelete(REGKEY)
    try FileDelete(A_ScriptDir "\host.json")
    MsgBox(APP_NAME " helper unregistered.", APP_NAME)
    ExitApp(0)
}

; ---------------------------------------------------------------- host

RunHost() {
    global hIn, hOut
    ; A runtime error dialog would hang the host over Opera; exit instead.
    OnError((*) => (ExitApp(0), true))
    DllCall("CreateMutex", "ptr", 0, "int", 1, "str", "SmoothPinterestHelperMutex")
    if (A_LastError = 183)
        ExitApp(0)
    try FileDelete(A_ScriptDir "\SmoothPinterest.old.exe")
    ; Raw handles: AHK's read buffer would hide bytes from PeekNamedPipe.
    hIn := DllCall("GetStdHandle", "int", -10, "ptr")
    hOut := DllCall("GetStdHandle", "int", -11, "ptr")
    SetTimer(PollStdin, 30)
    SetTimer(Watchdog, 5000)
}

PollStdin() {
    global hIn
    loop {
        avail := 0
        if !DllCall("PeekNamedPipe", "ptr", hIn, "ptr", 0, "uint", 0
                , "ptr", 0, "uint*", &avail, "ptr", 0)
            ExitApp(0)        ; pipe closed: Opera quit or extension disabled
        if (avail < 4)
            return
        hdr := Buffer(4)
        if !ReadExact(hdr, 4)
            ExitApp(0)
        len := NumGet(hdr, "uint")
        body := Buffer(Max(len, 1))
        if (len && !ReadExact(body, len))
            ExitApp(0)
        HandleMessage(StrGet(body, len, "UTF-8"))
    }
}

ReadExact(buf, n) {
    global hIn
    done := 0
    while (done < n) {
        got := 0
        if !DllCall("ReadFile", "ptr", hIn, "ptr", buf.Ptr + done, "uint", n - done
                , "uint*", &got, "ptr", 0) || !got
            return false
        done += got
    }
    return true
}

HandleMessage(msg) {
    if RegExMatch(msg, '"type"\s*:\s*"update"') {
        RegExMatch(msg, '"url"\s*:\s*"([^"]*)"', &u)
        RegExMatch(msg, '"sha256"\s*:\s*"([0-9A-Fa-f]{64})"', &h)
        DoUpdate(IsObject(u) ? u[1] : "", IsObject(h) ? h[1] : "")
    }
}

SendMsg(json) {
    global hOut
    n := StrPut(json, "UTF-8") - 1
    buf := Buffer(4 + n)
    NumPut("uint", n, buf)
    StrPut(json, buf.Ptr + 4, n, "UTF-8")
    written := 0
    DllCall("WriteFile", "ptr", hOut, "ptr", buf, "uint", 4 + n, "uint*", &written, "ptr", 0)
}

; ---------------------------------------------------------------- update

; Downloads a release zip, checks the helper exe against the hash the
; release lists, swaps this exe (a running exe can be renamed) and the
; extension folder, then tells the extension to reload and exits. Only
; this repo's release URLs are accepted, and any failure leaves the
; installed copy as it was.
DoUpdate(url, sha) {
    static PREFIX := "https://github.com/SteelArchadian/smooth-pinterest/releases/download/"
    if (!A_IsCompiled || InStr(url, PREFIX) != 1 || InStr(url, "..") || sha = "")
        return UpdateFail("refused")
    tmp := A_Temp "\SmoothPinterestUpdate"
    stage := tmp "\x"
    out := tmp "\hash.txt"
    try DirDelete(tmp, 1)
    try {
        DirCreate(tmp)
        DirCreate(stage)
        Download(url, tmp "\u.zip")
        RunWait(A_ComSpec ' /c tar -xf "' tmp '\u.zip" -C "' stage '"', , "Hide")
        if !FileExist(stage "\" HELPER_EXE) || !FileExist(stage "\extension\manifest.json")
            return UpdateFail("bad download")
        RunWait(A_ComSpec ' /c certutil -hashfile "' stage '\' HELPER_EXE '" SHA256 > "' out '"', , "Hide")
        got := ""
        loop parse FileRead(out), "`n", "`r"
            if RegExMatch(A_LoopField, "^\s*([0-9A-Fa-f ]{64,80})\s*$", &m) {
                got := StrReplace(m[1], " ")
                break
            }
        if (StrUpper(got) != StrUpper(sha))
            return UpdateFail("hash mismatch")
    } catch {
        return UpdateFail("download failed")
    }

    exe := A_ScriptFullPath
    old := A_ScriptDir "\SmoothPinterest.old.exe"
    try FileDelete(old)
    try {
        FileMove(exe, old, 1)
    } catch {
        return UpdateFail("couldn't replace helper")
    }
    try {
        FileCopy(stage "\" HELPER_EXE, exe, 1)
        DirCopy(stage "\extension", A_ScriptDir "\extension", 1)
    } catch {
        try FileMove(old, exe, 1)   ; put the working copy back
        return UpdateFail("couldn't write files")
    }
    try DirDelete(tmp, 1)
    SendMsg('{"type":"updated"}')
    Sleep(300)
    ExitApp(0)
}

UpdateFail(reason) {
    SendMsg('{"type":"updateFailed","error":"' StrReplace(StrReplace(reason, "\", "/"), '"', "'") '"}')
}

Watchdog() {
    if !ProcessExist("opera.exe")
        ExitApp(0)
}
