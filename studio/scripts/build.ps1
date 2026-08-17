# SPDX-License-Identifier: GPL-2.0-or-later
# Copyright (C) 2026 Ponkan230 and Cornix Studio contributors

$ErrorActionPreference = "Stop"
$projectRoot = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$env:RUSTUP_HOME = Join-Path $projectRoot ".rustup-toolchain"
$env:CARGO_HOME = Join-Path $projectRoot ".cargo-home"
$env:PATH = "$env:USERPROFILE\.cargo\bin;$env:PATH"
Set-Location (Join-Path $projectRoot "studio")
npm.cmd run build
cargo test --manifest-path src-tauri/Cargo.toml
cargo build --release --manifest-path src-tauri/Cargo.toml
