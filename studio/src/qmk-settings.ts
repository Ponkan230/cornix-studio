// SPDX-License-Identifier: GPL-2.0-or-later
// Copyright (C) 2026 Ponkan230 and Cornix Studio contributors

export interface QmkFieldDefinition {
  id: number;
  group: "timing" | "hold" | "combo" | "oneshot";
  type: "boolean" | "integer";
  title: string;
  description: string;
  width: 1 | 2 | 4;
  bit?: number;
  min?: number;
  max?: number;
  unit?: string;
}

export const QMK_SETTING_GROUPS = [
  ["timing", "タップ・ホールド"],
  ["hold", "ホールド判定"],
  ["combo", "コンボ"],
  ["oneshot", "ワンショットキー"],
] as const;

export const QMK_SETTING_FIELDS: QmkFieldDefinition[] = [
  {
    id: 7,
    group: "timing",
    type: "integer",
    title: "Tapping Term",
    description: "タップと長押しを判定する基本時間です。",
    width: 2,
    min: 0,
    max: 10000,
    unit: "ms",
  },
  {
    id: 27,
    group: "timing",
    type: "integer",
    title: "Flow Tap",
    description: "素早い連続入力でMod-Tapをタップとして扱う時間です。",
    width: 2,
    min: 0,
    max: 10000,
    unit: "ms",
  },
  {
    id: 18,
    group: "timing",
    type: "integer",
    title: "Tap Code Delay",
    description: "タップ送信の押下と解放の間に入れる待ち時間です。",
    width: 2,
    min: 0,
    max: 1000,
    unit: "ms",
  },
  {
    id: 19,
    group: "timing",
    type: "integer",
    title: "Tap Hold Caps Delay",
    description: "Caps Lockを含むTap-Hold動作に追加する待ち時間です。",
    width: 2,
    min: 0,
    max: 1000,
    unit: "ms",
  },
  {
    id: 22,
    group: "hold",
    type: "boolean",
    title: "Permissive Hold",
    description: "他のキーを押して離した場合、Tap-Holdキーを長押しとして確定します。",
    width: 1,
  },
  {
    id: 23,
    group: "hold",
    type: "boolean",
    title: "Hold On Other Key Press",
    description: "別のキーが押された時点でTap-Holdキーを長押しとして確定します。",
    width: 1,
  },
  {
    id: 26,
    group: "hold",
    type: "boolean",
    title: "Chordal Hold",
    description: "左右の手の組み合わせを考慮してTap-Holdの誤判定を減らします。",
    width: 1,
  },
  {
    id: 2,
    group: "combo",
    type: "integer",
    title: "Combo Term",
    description: "コンボを同時押しとして認識する最大時間です。",
    width: 2,
    min: 0,
    max: 10000,
    unit: "ms",
  },
  {
    id: 6,
    group: "oneshot",
    type: "integer",
    title: "One Shot Timeout",
    description: "ワンショットキーが自動解除されるまでの時間です。",
    width: 2,
    min: 0,
    max: 60000,
    unit: "ms",
  },
];

export function qmkField(id: number): QmkFieldDefinition | undefined {
  return QMK_SETTING_FIELDS.find((field) => field.id === id);
}
