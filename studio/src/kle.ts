// SPDX-License-Identifier: GPL-2.0-or-later
// Copyright (C) 2026 Ponkan230 and Cornix Studio contributors
// Derived in part from vial-kb/vial-gui's KLE parser state machine.

import type { PhysicalKey } from "./types";

type KleItem = string | number | Record<string, unknown> | KleItem[];

const LABEL_MAP = [
  [0, 6, 2, 8, 9, 11, 3, 5, 1, 4, 7, 10],
  [1, 7, -1, -1, 9, 11, 4, -1, -1, -1, -1, 10],
  [3, -1, 5, -1, 9, 11, -1, -1, 4, -1, -1, 10],
  [4, -1, -1, -1, 9, 11, -1, -1, -1, -1, -1, 10],
  [0, 6, 2, 8, 10, -1, 3, 5, 1, 4, 7, -1],
  [1, 7, -1, -1, 10, -1, 4, -1, -1, -1, -1, -1],
  [3, -1, 5, -1, 10, -1, -1, -1, 4, -1, -1, -1],
  [4, -1, -1, -1, 10, -1, -1, -1, -1, -1, -1, -1],
] as const;

function numeric(value: unknown, fallback: number): number {
  return typeof value === "number" ? value : fallback;
}

function reorderedLabels(serialized: string, alignment: number): Array<string | undefined> {
  const labels: Array<string | undefined> = Array(12).fill(undefined);
  const mapping = LABEL_MAP[alignment] ?? LABEL_MAP[4];
  serialized.split("\n").forEach((label, index) => {
    const destination = mapping[index];
    if (label && destination !== undefined && destination >= 0) {
      labels[destination] = label;
    }
  });
  return labels;
}

/**
 * Parses the Keyboard Layout Editor serialization embedded in vial.json.
 * This intentionally mirrors vial-gui's kle_serial.py state machine.
 */
export function parseKle(definition: Record<string, unknown>): PhysicalKey[] {
  const layouts = definition.layouts as { keymap?: KleItem[] } | undefined;
  const serializedRows = layouts?.keymap;
  if (!Array.isArray(serializedRows)) return [];

  const keys: PhysicalKey[] = [];
  let x = 0;
  let y = 0;
  let width = 1;
  let height = 1;
  let rotation = 0;
  let rotationX = 0;
  let rotationY = 0;
  let clusterX = 0;
  let clusterY = 0;
  let alignment = 4;
  let decal = false;

  serializedRows.forEach((rowValue) => {
    if (!Array.isArray(rowValue)) return;

    rowValue.forEach((item) => {
      if (typeof item === "object" && item !== null && !Array.isArray(item)) {
        if ("r" in item) rotation = numeric(item.r, rotation);
        if ("rx" in item) {
          rotationX = clusterX = numeric(item.rx, clusterX);
          x = clusterX;
          y = clusterY;
        }
        if ("ry" in item) {
          rotationY = clusterY = numeric(item.ry, clusterY);
          x = clusterX;
          y = clusterY;
        }
        if ("a" in item) alignment = numeric(item.a, alignment);
        if ("x" in item) x += numeric(item.x, 0);
        if ("y" in item) y += numeric(item.y, 0);
        if ("w" in item) width = numeric(item.w, width);
        if ("h" in item) height = numeric(item.h, height);
        if ("d" in item) decal = Boolean(item.d);
        return;
      }
      if (typeof item !== "string") return;

      const labels = reorderedLabels(item, alignment);
      const position = labels[0]?.match(/^(\d+),(\d+)$/);
      const isEncoder = labels[4] === "e";
      if (position && (isEncoder || decal || labels[0]?.includes(","))) {
        keys.push({
          id: isEncoder
            ? `encoder-${position[1]}-${position[2]}-${keys.length}`
            : `key-${position[1]}-${position[2]}`,
          x,
          y,
          width,
          height,
          rotation,
          rotationX,
          rotationY,
          row: isEncoder ? undefined : Number(position[1]),
          col: isEncoder ? undefined : Number(position[2]),
          encoderIndex: isEncoder ? Number(position[1]) : undefined,
          encoderDirection: isEncoder ? Number(position[2]) : undefined,
        });
      }

      x += width;
      width = 1;
      height = 1;
      decal = false;
    });

    y += 1;
    x = rotationX;
  });

  return keys;
}
