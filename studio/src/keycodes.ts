// SPDX-License-Identifier: GPL-2.0-or-later
// Copyright (C) 2026 Ponkan230 and Cornix Studio contributors

export interface KeycodeOption {
  code: number;
  id: string;
  label: string;
  shortLabel?: string;
  category: "basic" | "modifier" | "navigation" | "keypad" | "system" | "media" | "mouse" | "layer" | "macro" | "custom";
}

export type HostKeyLayout = "us" | "jis";

const letters: KeycodeOption[] = "ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("").map((letter, index) => ({
  code: 0x04 + index,
  id: `KC_${letter}`,
  label: letter,
  category: "basic",
}));

const digits = [
  ["1", 0x1e], ["2", 0x1f], ["3", 0x20], ["4", 0x21], ["5", 0x22],
  ["6", 0x23], ["7", 0x24], ["8", 0x25], ["9", 0x26], ["0", 0x27],
] as const;

export const KEYCODES: KeycodeOption[] = [
  { code: 0x0000, id: "KC_NO", label: "無効", category: "basic" },
  { code: 0x0001, id: "KC_TRNS", label: "▽", category: "layer" },
  ...letters,
  ...digits.map(([label, code]) => ({ code, id: `KC_${label}`, label, category: "basic" as const })),
  { code: 0x28, id: "KC_ENT", label: "Enter", category: "basic" },
  { code: 0x29, id: "KC_ESC", label: "Esc", category: "basic" },
  { code: 0x2a, id: "KC_BSPC", label: "⌫", category: "basic" },
  { code: 0x2b, id: "KC_TAB", label: "Tab", category: "basic" },
  { code: 0x2c, id: "KC_SPC", label: "Space", category: "basic" },
  { code: 0x2d, id: "KC_MINS", label: "- _", category: "basic" },
  { code: 0x2e, id: "KC_EQL", label: "= +", category: "basic" },
  { code: 0x2f, id: "KC_LBRC", label: "[ {", category: "basic" },
  { code: 0x30, id: "KC_RBRC", label: "] }", category: "basic" },
  { code: 0x31, id: "KC_BSLS", label: "\\ |", category: "basic" },
  { code: 0x32, id: "KC_NUHS", label: "Non-US # ~", category: "basic" },
  { code: 0x33, id: "KC_SCLN", label: "; :", category: "basic" },
  { code: 0x34, id: "KC_QUOT", label: "' \"", category: "basic" },
  { code: 0x35, id: "KC_GRV", label: "` ~", category: "basic" },
  { code: 0x36, id: "KC_COMM", label: ", <", category: "basic" },
  { code: 0x37, id: "KC_DOT", label: ". >", category: "basic" },
  { code: 0x38, id: "KC_SLSH", label: "/ ?", category: "basic" },
  { code: 0x39, id: "KC_CAPS", label: "Caps", category: "basic" },
  ...Array.from({ length: 12 }, (_, index) => ({
    code: 0x3a + index,
    id: `KC_F${index + 1}`,
    label: `F${index + 1}`,
    category: "basic" as const,
  })),
  { code: 0x46, id: "KC_PSCR", label: "Print Screen", shortLabel: "Prt Sc", category: "system" },
  { code: 0x47, id: "KC_SCRL", label: "Scroll Lock", shortLabel: "Scr Lk", category: "system" },
  { code: 0x48, id: "KC_PAUS", label: "Pause", category: "system" },
  { code: 0x49, id: "KC_INS", label: "Insert", category: "navigation" },
  { code: 0x4a, id: "KC_HOME", label: "Home", category: "navigation" },
  { code: 0x4b, id: "KC_PGUP", label: "Page ↑", category: "navigation" },
  { code: 0x4c, id: "KC_DEL", label: "Delete", category: "navigation" },
  { code: 0x4d, id: "KC_END", label: "End", category: "navigation" },
  { code: 0x4e, id: "KC_PGDN", label: "Page ↓", category: "navigation" },
  { code: 0x4f, id: "KC_RGHT", label: "→", category: "navigation" },
  { code: 0x50, id: "KC_LEFT", label: "←", category: "navigation" },
  { code: 0x51, id: "KC_DOWN", label: "↓", category: "navigation" },
  { code: 0x52, id: "KC_UP", label: "↑", category: "navigation" },
  { code: 0x53, id: "KC_NUM", label: "Num Lock", category: "keypad" },
  { code: 0x54, id: "KC_PSLS", label: "KP /", category: "keypad" },
  { code: 0x55, id: "KC_PAST", label: "KP *", category: "keypad" },
  { code: 0x56, id: "KC_PMNS", label: "KP −", category: "keypad" },
  { code: 0x57, id: "KC_PPLS", label: "KP +", category: "keypad" },
  { code: 0x58, id: "KC_PENT", label: "KP Enter", category: "keypad" },
  ...Array.from({ length: 9 }, (_, index) => ({
    code: 0x59 + index,
    id: `KC_P${index + 1}`,
    label: `KP ${index + 1}`,
    category: "keypad" as const,
  })),
  { code: 0x62, id: "KC_P0", label: "KP 0", category: "keypad" },
  { code: 0x63, id: "KC_PDOT", label: "KP .", category: "keypad" },
  { code: 0x64, id: "KC_NUBS", label: "Non-US \\ |", category: "basic" },
  { code: 0x65, id: "KC_APP", label: "Application", shortLabel: "Menu", category: "system" },
  { code: 0x66, id: "KC_KB_POWER", label: "Keyboard Power", shortLabel: "Power", category: "system" },
  { code: 0x67, id: "KC_PEQL", label: "KP =", category: "keypad" },
  ...Array.from({ length: 12 }, (_, index) => ({
    code: 0x68 + index,
    id: `KC_F${index + 13}`,
    label: `F${index + 13}`,
    category: "basic" as const,
  })),
  { code: 0x74, id: "KC_EXEC", label: "Execute", category: "system" },
  { code: 0x75, id: "KC_HELP", label: "Help", category: "system" },
  { code: 0x76, id: "KC_MENU", label: "Menu", category: "system" },
  { code: 0x77, id: "KC_SLCT", label: "Select", category: "navigation" },
  { code: 0x78, id: "KC_STOP", label: "Stop", category: "navigation" },
  { code: 0x79, id: "KC_AGIN", label: "Again", category: "navigation" },
  { code: 0x7a, id: "KC_UNDO", label: "Undo", category: "navigation" },
  { code: 0x7b, id: "KC_CUT", label: "Cut", category: "navigation" },
  { code: 0x7c, id: "KC_COPY", label: "Copy", category: "navigation" },
  { code: 0x7d, id: "KC_PSTE", label: "Paste", category: "navigation" },
  { code: 0x7e, id: "KC_FIND", label: "Find", category: "navigation" },
  { code: 0x7f, id: "KC_KB_MUTE", label: "KB Mute", category: "media" },
  { code: 0x80, id: "KC_KB_VOLUME_UP", label: "KB Vol +", category: "media" },
  { code: 0x81, id: "KC_KB_VOLUME_DOWN", label: "KB Vol −", category: "media" },
  { code: 0x82, id: "KC_LCAP", label: "Locking Caps", category: "system" },
  { code: 0x83, id: "KC_LNUM", label: "Locking Num", category: "system" },
  { code: 0x84, id: "KC_LSCR", label: "Locking Scroll", category: "system" },
  { code: 0x85, id: "KC_PCMM", label: "KP ,", category: "keypad" },
  { code: 0x86, id: "KC_PEQL_AS400", label: "KP = AS/400", category: "keypad" },
  ...Array.from({ length: 9 }, (_, index) => ({
    code: 0x87 + index,
    id: `KC_INT${index + 1}`,
    label: `International ${index + 1}`,
    shortLabel: `Intl ${index + 1}`,
    category: "basic" as const,
  })),
  ...Array.from({ length: 9 }, (_, index) => ({
    code: 0x90 + index,
    id: `KC_LANG${index + 1}`,
    label: `Lang${index + 1}`,
    category: "basic" as const,
  })),
  { code: 0x99, id: "KC_ERAS", label: "Alternate Erase", shortLabel: "Alt Erase", category: "system" },
  { code: 0x9a, id: "KC_SYRQ", label: "SysReq", category: "system" },
  { code: 0x9b, id: "KC_CNCL", label: "Cancel", category: "system" },
  { code: 0x9c, id: "KC_CLR", label: "Clear", category: "system" },
  { code: 0x9d, id: "KC_PRIR", label: "Prior", category: "navigation" },
  { code: 0x9e, id: "KC_RETN", label: "Return", category: "navigation" },
  { code: 0x9f, id: "KC_SEPR", label: "Separator", category: "system" },
  { code: 0xa0, id: "KC_OUT", label: "Out", category: "system" },
  { code: 0xa1, id: "KC_OPER", label: "Oper", category: "system" },
  { code: 0xa2, id: "KC_CLAG", label: "Clear / Again", category: "system" },
  { code: 0xa3, id: "KC_CRSL", label: "CrSel / Props", category: "system" },
  { code: 0xa4, id: "KC_EXSL", label: "ExSel", category: "system" },
  { code: 0xe0, id: "KC_LCTL", label: "L Ctrl", category: "modifier" },
  { code: 0xe1, id: "KC_LSFT", label: "L Shift", category: "modifier" },
  { code: 0xe2, id: "KC_LALT", label: "L Alt", category: "modifier" },
  { code: 0xe3, id: "KC_LGUI", label: "L GUI", category: "modifier" },
  { code: 0xe4, id: "KC_RCTL", label: "R Ctrl", category: "modifier" },
  { code: 0xe5, id: "KC_RSFT", label: "R Shift", category: "modifier" },
  { code: 0xe6, id: "KC_RALT", label: "R Alt", category: "modifier" },
  { code: 0xe7, id: "KC_RGUI", label: "R GUI", category: "modifier" },
  { code: 0xa5, id: "KC_PWR", label: "Power", category: "system" },
  { code: 0xa6, id: "KC_SLEP", label: "Sleep", category: "system" },
  { code: 0xa7, id: "KC_WAKE", label: "Wake", category: "system" },
  { code: 0xa8, id: "KC_MUTE", label: "Mute", category: "media" },
  { code: 0xa9, id: "KC_VOLU", label: "Vol +", category: "media" },
  { code: 0xaa, id: "KC_VOLD", label: "Vol −", category: "media" },
  { code: 0xab, id: "KC_MNXT", label: "Next", category: "media" },
  { code: 0xac, id: "KC_MPRV", label: "Prev", category: "media" },
  { code: 0xad, id: "KC_MSTP", label: "Stop", category: "media" },
  { code: 0xae, id: "KC_MPLY", label: "Play", category: "media" },
  { code: 0xaf, id: "KC_MSEL", label: "Media Select", category: "media" },
  { code: 0xb0, id: "KC_EJCT", label: "Eject", category: "media" },
  { code: 0xb1, id: "KC_MAIL", label: "Mail", category: "media" },
  { code: 0xb2, id: "KC_CALC", label: "Calculator", shortLabel: "Calc", category: "media" },
  { code: 0xb3, id: "KC_MYCM", label: "My Computer", shortLabel: "Computer", category: "media" },
  { code: 0xb4, id: "KC_WSCH", label: "Web Search", category: "media" },
  { code: 0xb5, id: "KC_WHOM", label: "Web Home", category: "media" },
  { code: 0xb6, id: "KC_WBAK", label: "Web Back", category: "media" },
  { code: 0xb7, id: "KC_WFWD", label: "Web Forward", category: "media" },
  { code: 0xb8, id: "KC_WSTP", label: "Web Stop", category: "media" },
  { code: 0xb9, id: "KC_WREF", label: "Web Refresh", category: "media" },
  { code: 0xba, id: "KC_WFAV", label: "Web Favorites", category: "media" },
  { code: 0xbb, id: "KC_MFFD", label: "Fast Forward", shortLabel: "FF", category: "media" },
  { code: 0xbc, id: "KC_MRWD", label: "Rewind", category: "media" },
  { code: 0xbd, id: "KC_BRIU", label: "Brightness +", shortLabel: "Bright +", category: "media" },
  { code: 0xbe, id: "KC_BRID", label: "Brightness −", shortLabel: "Bright −", category: "media" },
  { code: 0xbf, id: "KC_CPNL", label: "Control Panel", shortLabel: "Control", category: "system" },
  { code: 0xc0, id: "KC_ASST", label: "Assistant", category: "system" },
  { code: 0xc1, id: "KC_MCTL", label: "Mission Control", shortLabel: "Mission", category: "system" },
  { code: 0xc2, id: "KC_LPAD", label: "Launchpad", category: "system" },
  { code: 0xcd, id: "MS_UP", label: "Mouse ↑", category: "mouse" },
  { code: 0xce, id: "MS_DOWN", label: "Mouse ↓", category: "mouse" },
  { code: 0xcf, id: "MS_LEFT", label: "Mouse ←", category: "mouse" },
  { code: 0xd0, id: "MS_RGHT", label: "Mouse →", category: "mouse" },
  ...Array.from({ length: 8 }, (_, index) => ({
    code: 0xd1 + index,
    id: `MS_BTN${index + 1}`,
    label: `Mouse ${index + 1}`,
    category: "mouse" as const,
  })),
  { code: 0xd9, id: "MS_WHLU", label: "Wheel ↑", category: "mouse" },
  { code: 0xda, id: "MS_WHLD", label: "Wheel ↓", category: "mouse" },
  { code: 0xdb, id: "MS_WHLL", label: "Wheel ←", category: "mouse" },
  { code: 0xdc, id: "MS_WHLR", label: "Wheel →", category: "mouse" },
  { code: 0xdd, id: "MS_ACL0", label: "Mouse Accel 0", shortLabel: "Accel 0", category: "mouse" },
  { code: 0xde, id: "MS_ACL1", label: "Mouse Accel 1", shortLabel: "Accel 1", category: "mouse" },
  { code: 0xdf, id: "MS_ACL2", label: "Mouse Accel 2", shortLabel: "Accel 2", category: "mouse" },
  ...Array.from({ length: 10 }, (_, layer) => ({
    code: 0x5220 + layer,
    id: `MO(${layer})`,
    label: `MO ${layer}`,
    category: "layer" as const,
  })),
  ...Array.from({ length: 10 }, (_, layer) => ({
    code: 0x5200 + layer,
    id: `TO(${layer})`,
    label: `TO ${layer}`,
    category: "layer" as const,
  })),
];

const JIS_BASIC_OVERRIDES = new Map<number, Pick<KeycodeOption, "id" | "label" | "shortLabel">>([
  [0x1e, { id: "JP_1", label: "1 !" }],
  [0x1f, { id: "JP_2", label: '2 "' }],
  [0x20, { id: "JP_3", label: "3 #" }],
  [0x21, { id: "JP_4", label: "4 $" }],
  [0x22, { id: "JP_5", label: "5 %" }],
  [0x23, { id: "JP_6", label: "6 &" }],
  [0x24, { id: "JP_7", label: "7 '" }],
  [0x25, { id: "JP_8", label: "8 (" }],
  [0x26, { id: "JP_9", label: "9 )" }],
  [0x27, { id: "JP_0", label: "0" }],
  [0x2d, { id: "JP_MINS", label: "- =" }],
  [0x2e, { id: "JP_CIRC", label: "^ ~" }],
  [0x2f, { id: "JP_AT", label: "@ `" }],
  [0x30, { id: "JP_LBRC", label: "[ {" }],
  [0x32, { id: "JP_RBRC", label: "] }", shortLabel: "]" }],
  [0x33, { id: "JP_SCLN", label: "; +" }],
  [0x34, { id: "JP_COLN", label: ": *" }],
  [0x35, { id: "JP_ZKHK", label: "半角 / 全角", shortLabel: "半/全" }],
  [0x36, { id: "JP_COMM", label: ", <" }],
  [0x37, { id: "JP_DOT", label: ". >" }],
  [0x38, { id: "JP_SLSH", label: "/ ?" }],
  [0x39, { id: "JP_EISU", label: "英数 / Caps", shortLabel: "英数" }],
  [0x87, { id: "JP_BSLS", label: "ろ / \\ _", shortLabel: "ろ" }],
  [0x88, { id: "JP_KANA", label: "かな" }],
  [0x89, { id: "JP_YEN", label: "￥ |", shortLabel: "￥" }],
  [0x8a, { id: "JP_HENK", label: "変換" }],
  [0x8b, { id: "JP_MHEN", label: "無変換" }],
]);

export const JIS_KEYCODES: KeycodeOption[] = [
  ...KEYCODES
    .filter((key) => !(key.category === "basic" && key.code === 0x31))
    .map((key) => {
      const override = key.category === "basic" ? JIS_BASIC_OVERRIDES.get(key.code) : undefined;
      return override ? { ...key, ...override } : key;
    }),
];

export function keycodesForLayout(layout: HostKeyLayout): KeycodeOption[] {
  return layout === "jis" ? JIS_KEYCODES : KEYCODES;
}

const byCode = new Map(KEYCODES.map((key) => [key.code, key]));

export function keycodeLabel(code: number): string {
  return byCode.get(code)?.label ?? `0x${code.toString(16).toUpperCase().padStart(4, "0")}`;
}
