// SPDX-License-Identifier: GPL-2.0-or-later
// Copyright (C) 2026 Ponkan230 and Cornix Studio contributors

export type Transport = "Bluetooth" | "USB" | "Unknown" | "Demo";

export interface DeviceSummary {
  id: string;
  name: string;
  manufacturer?: string;
  serial?: string;
  vendorId: number;
  productId: number;
  transport: Transport;
}

export interface KeyboardSnapshot {
  device: DeviceSummary;
  definition: Record<string, unknown>;
  viaProtocol: number;
  vialProtocol: number;
  uid: string;
  layers: number;
  rows: number;
  cols: number;
  keymap: number[][][];
  encoders: Array<Array<[number, number]>>;
  comboCount: number;
  combosLoaded: boolean;
  combos: Array<[number, number, number, number, number]>;
  macroCount: number;
  macroMemory: number;
  macrosLoaded: boolean;
  macroBuffer: number[];
  qmkSettingsSupported: boolean;
  qmkSettingsLoaded: boolean;
  qmkSettings: QmkSettingRaw[];
}

export interface QmkSettingRaw {
  id: number;
  data: number[];
}

export interface MatrixPosition {
  row: number;
  col: number;
}

export interface MonitorStatus {
  supported: boolean;
  unlocked: boolean;
  unlockInProgress: boolean;
  unlockKeys: MatrixPosition[];
}

export interface MonitorUnlockProgress {
  unlocked: boolean;
  inProgress: boolean;
  remaining: number;
}

export interface MatrixStateSnapshot {
  pressed: MatrixPosition[];
}

export type MacroAction =
  | { type: "text"; text: string }
  | { type: "tap" | "down" | "up"; keycode: number }
  | { type: "delay"; duration: number };

export interface PhysicalKey {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
  rotationX: number;
  rotationY: number;
  row?: number;
  col?: number;
  encoderIndex?: number;
  encoderDirection?: number;
}

export interface BackupMetadata {
  uid: string;
  name: string;
  vendorId: number;
  productId: number;
  viaProtocol: number;
  vialProtocol: number;
  layers: number;
  rows: number;
  cols: number;
  encoderCount: number;
  comboCount: number;
  macroCount: number;
  macroMemory: number;
}

export interface CornixBackup {
  format: "cornix-studio-backup";
  version: 1;
  createdAt: string;
  metadata: BackupMetadata;
  keymap: number[][][];
  encoders: Array<Array<[number, number]>>;
  combos: Array<[number, number, number, number, number]>;
  macroBuffer: number[];
  qmkSettings: QmkSettingRaw[];
}

export interface RestoreRequest {
  uid: string;
  layers: number;
  rows: number;
  cols: number;
  encoderCount: number;
  comboCount: number;
  keys: Array<{ layer: number; row: number; col: number; keycode: number }>;
  encoders: Array<{ layer: number; index: number; direction: number; keycode: number }>;
  combos: Array<{ index: number; entry: [number, number, number, number, number] }>;
  macroBuffer?: number[];
  qmkSettings: QmkSettingRaw[];
}

export type FirmwareSide = "left" | "right";

export interface FirmwareImageInfo {
  name: string;
  side: FirmwareSide;
  size: number;
  blocks: number;
  payloadBytes: number;
  addressStart: number;
  addressEnd: number;
  familyId?: string;
}

export interface FirmwarePackageInfo {
  packageName: string;
  version?: string;
  left: FirmwareImageInfo;
  right: FirmwareImageInfo;
  warnings: string[];
}

export interface BootloaderVolume {
  root: string;
  boardId?: string;
  description: string;
}

export interface FirmwareFlashResult {
  side: FirmwareSide;
  bytesWritten: number;
  drive: string;
  driveDisconnected: boolean;
}
