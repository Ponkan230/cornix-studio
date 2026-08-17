// SPDX-License-Identifier: GPL-2.0-or-later
// Copyright (C) 2026 Ponkan230 and Cornix Studio contributors

import { defineConfig } from "vite";

export default defineConfig({
  clearScreen: false,
  server: {
    host: "127.0.0.1",
    port: 1420,
    strictPort: true,
  },
  optimizeDeps: {
    exclude: ["@tauri-apps/api"],
  },
});
