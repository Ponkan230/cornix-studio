# Cornix Studio icons

`app-icon.svg` is the editable source for the original Cornix Studio application icon.
It depicts two split-keyboard halves connected by a wireless signal and intentionally
does not reuse Vial or Cornix manufacturer artwork.

The PNG, ICO, and ICNS files in this directory are generated from that SVG with the
Tauri CLI. Mobile and Microsoft Store assets produced by the command are not retained
because the current application target is standalone Windows desktop:

```text
npm run tauri -- icon src-tauri/icons/app-icon.svg --output src-tauri/icons
```

Copyright (C) 2026 Ponkan230 and Cornix Studio contributors.
Licensed under `GPL-2.0-or-later`.
