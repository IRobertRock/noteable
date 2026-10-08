' Starts the Noteable worker with no console window (used by the Startup shortcut).
Set fso = CreateObject("Scripting.FileSystemObject")
repo = fso.GetParentFolderName(fso.GetParentFolderName(fso.GetParentFolderName(WScript.ScriptFullName)))
Set sh = CreateObject("WScript.Shell")
sh.CurrentDirectory = repo
sh.Run """" & repo & "\node_modules\.bin\tsx.cmd"" worker\main.ts", 0, False
