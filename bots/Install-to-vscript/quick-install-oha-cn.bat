@echo off
setlocal EnableDelayedExpansion
chcp 65001 >nul
:: Check if the script is run as Administrator
net session >nul 2>&1
if %errorlevel% neq 0 (
    echo 请求管理员权限...
    powershell -Command "Start-Process '%~f0' -Verb RunAs"
    exit /b
)

:: ============================================================
:: Locate Steam. Works both from a Workshop install and from a
:: git clone of this repository placed anywhere on disk.
::   1) Registry (standard Steam install)
::   2) Fallback: the classic Workshop-relative layout
:: ============================================================
set "STEAM="
for /f "skip=2 tokens=2,*" %%a in ('reg query "HKLM\SOFTWARE\WOW6432Node\Valve\Steam" /v InstallPath 2^>nul') do set "STEAM=%%b"
if not defined STEAM for /f "skip=2 tokens=2,*" %%a in ('reg query "HKLM\SOFTWARE\Valve\Steam" /v InstallPath 2^>nul') do set "STEAM=%%b"
if not defined STEAM set "STEAM=%~dp0..\..\..\..\.."

:: Absolute path of the bots sources next to this script
:: (Workshop item root, or the repo's bots\ folder in a git clone)
for %%i in ("%~dp0..") do set "SRC_BOTS=%%~fi"

set "VSCRIPTS=%STEAM%\steamapps\common\dota 2 beta\game\dota\scripts\vscripts"

if not exist "%STEAM%\steamapps\common\dota 2 beta" (
    echo 未找到 Steam / Dota 2，已检查: "%STEAM%"
    echo 如果 Steam 安装在其他位置，请编辑脚本顶部的 STEAM 变量。
    pause
    exit /b 1
)
echo Steam 路径: %STEAM%

:: Get the current timestamp (format: YYYYMMDD_HHMMSS)
for /f "tokens=1-4 delims=/:. " %%a in ("%date% %time%") do (
    set year=%%a
    set month=%%b
    set day=%%c
    set hour=%%d
)
set timestamp=%year%%month%%day%_%time:~0,2%%time:~3,2%%time:~6,2%
set timestamp=%timestamp: =0%

:: Remove previous install (folder or link) so mklink succeeds
if exist "%VSCRIPTS%\bots" (
    echo bots 目录已存在，重命名为 bots_old_%timestamp%...
    ren "%VSCRIPTS%\bots" "bots_old_%timestamp%"
)

echo 正在为 bots 创建符号链接...
mklink /d "%VSCRIPTS%\bots" "!SRC_BOTS!" >nul 2>&1
if not exist "%VSCRIPTS%\bots\hero_selection.lua" (
    echo 符号链接需要开发者模式，回退为目录联接...
    mklink /J "%VSCRIPTS%\bots" "!SRC_BOTS!" >nul 2>&1
)
if not exist "%VSCRIPTS%\bots\hero_selection.lua" (
    echo 链接 bots 目录失败。
    goto :failed
)

if exist "%VSCRIPTS%\game\Customize" (
    echo Customize 目录已存在，重命名为 Customize_old_%timestamp%...
    ren "%VSCRIPTS%\game\Customize" "Customize_old_%timestamp%"
)
echo 正在创建 Customize 脚本...
xcopy "!SRC_BOTS!\Customize\" "%VSCRIPTS%\game\Customize\" /E >nul
if %errorlevel% neq 0 goto :failed

:: ============================================================
:: Optional: LLM advisor (RFC-001) - Groq API key setup
:: Writes the key ONLY into the permanent game-tier Customize
:: folder (never into the repository, never into git).
:: ============================================================
echo.
echo ------------------------------------------------------------
echo LLM advisor (experimental): bots consult an LLM during hero
echo selection for counter-picks and adaptive item/skill builds.
echo Needs a FREE API key from https://console.groq.com
echo ------------------------------------------------------------
set "LLM_YN="
set /p LLM_YN=现在启用 LLM 顾问吗? [Y/N]:
if /i not "!LLM_YN!"=="Y" goto :done

set "GROQ_KEY="
set /p GROQ_KEY=粘贴你的 Groq API 密钥 (gsk_ 开头，输入可见):
if not defined GROQ_KEY goto :llm_skip
if "!GROQ_KEY!"=="" goto :llm_skip

copy /Y "%VSCRIPTS%\game\Customize\llm.example.lua" "%VSCRIPTS%\game\Customize\llm.lua" >nul

powershell -NoProfile -Command "$p='%VSCRIPTS%\game\Customize\llm.lua'; $t=[IO.File]::ReadAllText($p); $t=$t.Replace('APIKey = \"\"','APIKey = \"!GROQ_KEY!\"'); [IO.File]::WriteAllText($p,$t)"
powershell -NoProfile -Command "$p='%VSCRIPTS%\game\Customize\general.lua'; $t=[IO.File]::ReadAllText($p); $t=$t.Replace('Allow_LLM_Advisor = false','Allow_LLM_Advisor = true'); [IO.File]::WriteAllText($p,$t)"

findstr /C:"gsk_" "%VSCRIPTS%\game\Customize\llm.lua" >nul
if errorlevel 1 goto :llm_bad
findstr /C:"Allow_LLM_Advisor = true" "%VSCRIPTS%\game\Customize\general.lua" >nul
if errorlevel 1 goto :llm_bad

echo LLM 顾问已启用。进入游戏后聊天输入 !llm status 查看。
echo Console (~ key) shows [OHA-LLM] lines during hero selection.
goto :done

:llm_bad
echo WARNING: key was not written correctly. Edit manually:
echo   %VSCRIPTS%\game\Customize\llm.lua      (APIKey = "gsk_...")
echo   %VSCRIPTS%\game\Customize\general.lua  (Allow_LLM_Advisor = true)
goto :done

:llm_skip
echo 已跳过。之后可复制 llm.example.lua 为 llm.lua 到
echo %VSCRIPTS%\game\Customize\ and fill in the key.
goto :done

:done
echo ============
echo ============
echo 安装成功!!!
echo ============
echo ============
pause
exit /b 0

:failed
echo ============
echo "1. Make sure this script sits in a folder that contains the bot scripts (hero_selection.lua one level up)."
echo "2. If you don't know where the Steam folder is, right click Dota2 in Steam Library, select Properties > Installed Files > Browse." It will open the folder: "Steam\steamapps\common\dota 2 beta", now replace the path text "common\dota 2 beta" in the address to be "workshop\content\570\3246316298\Install-to-vscript", hit Enter to open the correct folder.
echo "3. Run this file as Administrator"
echo ============
echo 安装失败!!!
echo ============
pause
exit /b 1
