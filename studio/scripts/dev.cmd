@echo off
rem SPDX-License-Identifier: GPL-2.0-or-later
rem Copyright (C) 2026 Ponkan230 and Cornix Studio contributors
setlocal
set "PROJECT_ROOT=%~dp0..\.."
set "RUSTUP_HOME=%PROJECT_ROOT%\.rustup-toolchain"
set "CARGO_HOME=%PROJECT_ROOT%\.cargo-home"
set "PATH=%USERPROFILE%\.cargo\bin;%PATH%"
cd /d "%PROJECT_ROOT%\studio"
call npm.cmd run tauri dev
