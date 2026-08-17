// SPDX-License-Identifier: GPL-2.0-or-later
// Copyright (C) 2026 Ponkan230 and Cornix Studio contributors

import { invoke } from "@tauri-apps/api/core";
import { emit, emitTo, listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import "./style.css";
import {
  JIS_KEYCODES,
  KEYCODES,
  keycodeLabel,
  keycodesForLayout,
  type HostKeyLayout,
  type KeycodeOption,
} from "./keycodes";
import { parseKle } from "./kle";
import { QMK_SETTING_FIELDS, QMK_SETTING_GROUPS, qmkField } from "./qmk-settings";
import type {
  CornixBackup,
  BootloaderVolume,
  DeviceSummary,
  FirmwareFlashResult,
  FirmwarePackageInfo,
  KeyboardSnapshot,
  MacroAction,
  MatrixPosition,
  MatrixStateSnapshot,
  MonitorStatus,
  MonitorUnlockProgress,
  PhysicalKey,
  QmkSettingRaw,
  RestoreRequest,
} from "./types";
import cornixDefinition from "./fixtures/cornix-v1.12.json";

const app = document.querySelector<HTMLDivElement>("#app")!;

type AppPage = "keymap" | "monitor" | "combo" | "backup" | "macro" | "qmk" | "firmware";
type FirmwareStage = "select" | "prepare" | "left" | "right" | "done";
type MonitorMode = "idle" | "loading" | "locked" | "unlocking" | "active" | "detached" | "unsupported" | "error";

interface RestorePreview {
  backup: CornixBackup;
  request: RestoreRequest;
  fileName: string;
  source: "Cornix Studio" | "Vial .vil";
}

interface PressedBinding {
  code: number;
  downAt: number;
  layerTapActive: boolean;
  interrupted: boolean;
  source: "matrix" | "combo";
}

interface TapToggleState {
  count: number;
  lastTapAt: number;
}

interface LayerTracker {
  defaultLayer: number;
  movedLayer?: number;
  toggledLayers: Set<number>;
  momentaryLayers: Map<string, number>;
  oneShotLayer?: number;
  oneShotActivatedAt?: number;
  oneShotConsumer?: string;
  bindings: Map<string, PressedBinding>;
  tapToggle: Map<number, TapToggleState>;
  activeCombos: Set<number>;
}

interface MonitorUiState {
  mode: MonitorMode;
  pressed: Set<string>;
  unlockKeys: Set<string>;
  unlockRemaining: number;
  unlockTotal: number;
  error?: string;
  generation: number;
  tracker: LayerTracker;
  previousLayer?: number;
  layerFlashUntil: number;
  pollFailures: number;
  lastSuccessfulPollAt: number;
}

interface LayerTrackerSnapshot {
  defaultLayer: number;
  movedLayer?: number;
  toggledLayers: number[];
  oneShotLayer?: number;
  oneShotActivatedAt?: number;
}

interface LiveOverlayBootstrap {
  keyboard: KeyboardSnapshot;
  qmkValues: Record<number, number>;
  tracker: LayerTrackerSnapshot;
}

interface OverlayBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

function newLayerTracker(): LayerTracker {
  return {
    defaultLayer: 0,
    toggledLayers: new Set(),
    momentaryLayers: new Map(),
    bindings: new Map(),
    tapToggle: new Map(),
    activeCombos: new Set(),
  };
}

function newMonitorState(): MonitorUiState {
  return {
    mode: "idle",
    pressed: new Set(),
    unlockKeys: new Set(),
    unlockRemaining: 0,
    unlockTotal: 0,
    generation: 0,
    tracker: newLayerTracker(),
    layerFlashUntil: 0,
    pollFailures: 0,
    lastSuccessfulPollAt: 0,
  };
}

function layerTrackerSnapshot(tracker = state.monitor.tracker): LayerTrackerSnapshot {
  return {
    defaultLayer: tracker.defaultLayer,
    movedLayer: tracker.movedLayer,
    toggledLayers: [...tracker.toggledLayers],
    oneShotLayer: tracker.oneShotLayer,
    oneShotActivatedAt: tracker.oneShotActivatedAt,
  };
}

function restoreLayerTracker(snapshot?: LayerTrackerSnapshot): LayerTracker {
  const tracker = newLayerTracker();
  if (!snapshot) return tracker;
  tracker.defaultLayer = snapshot.defaultLayer;
  tracker.movedLayer = snapshot.movedLayer;
  tracker.toggledLayers = new Set(snapshot.toggledLayers);
  tracker.oneShotLayer = snapshot.oneShotLayer;
  tracker.oneShotActivatedAt = snapshot.oneShotLayer === undefined ? undefined : performance.now();
  return tracker;
}

interface AppState {
  devices: DeviceSummary[];
  keyboard?: KeyboardSnapshot;
  physicalKeys: PhysicalKey[];
  layer: number;
  selected?: PhysicalKey;
  monitor: MonitorUiState;
  category: string;
  hostKeyLayout: HostKeyLayout;
  query: string;
  page: AppPage;
  comboIndex: number;
  comboField: number;
  restorePreview?: RestorePreview;
  backupBusy: boolean;
  macros: MacroAction[][];
  macroIndex: number;
  selectedMacroAction?: number;
  macroSavedBuffer: number[];
  macroBusy: boolean;
  qmkValues: Record<number, number>;
  qmkSavedValues: Record<number, number>;
  qmkBusy: boolean;
  qmkResetConfirm: boolean;
  firmwarePackage?: FirmwarePackageInfo;
  firmwareStage: FirmwareStage;
  firmwareBusy: boolean;
  firmwareAcknowledgedPairing: boolean;
  firmwareAcknowledgedBothSides: boolean;
  firmwareBootloaders: BootloaderVolume[];
  firmwareSelectedRoot?: string;
  firmwareFlashConfirm: boolean;
  firmwareBackupPath?: string;
  firmwareCompleted: { left: boolean; right: boolean };
  loading?: "scan" | "connect";
  notice?: { kind: "success" | "error"; text: string };
}

const state: AppState = {
  devices: [],
  physicalKeys: [],
  layer: 0,
  monitor: newMonitorState(),
  category: "basic",
  hostKeyLayout: localStorage.getItem("cornix-host-key-layout") === "jis" ? "jis" : "us",
  query: "",
  page: "keymap",
  comboIndex: 0,
  comboField: 0,
  backupBusy: false,
  macros: [],
  macroIndex: 0,
  macroSavedBuffer: [],
  macroBusy: false,
  qmkValues: {},
  qmkSavedValues: {},
  qmkBusy: false,
  qmkResetConfirm: false,
  firmwareStage: "select",
  firmwareBusy: false,
  firmwareAcknowledgedPairing: false,
  firmwareAcknowledgedBothSides: false,
  firmwareBootloaders: [],
  firmwareFlashConfirm: false,
  firmwareCompleted: { left: false, right: false },
};

const isTauri = "__TAURI_INTERNALS__" in window;
const isOverlayWindow = new URLSearchParams(window.location.search).has("overlay");
const overlayBootstrapKey = "cornix-live-overlay-bootstrap";
const overlayBoundsKey = "cornix-live-overlay-bounds";
let liveOverlayBootstrap: LiveOverlayBootstrap | undefined;

function browserDemo(): KeyboardSnapshot {
  const keymap = Array.from({ length: 10 }, () =>
    Array.from({ length: 8 }, () => Array<number>(7).fill(0)));
  keymap[0][0] = [0x2b, 0x14, 0x1a, 0x08, 0x15, 0x17, 0];
  keymap[0][1] = [0x39, 0x04, 0x16, 0x07, 0x09, 0x0a, 0];
  keymap[0][2] = [0xe1, 0x1d, 0x1b, 0x06, 0x19, 0x05, 0x90];
  keymap[0][3] = [0xe0, 0xe3, 0xe2, 0x5221, 0x5223, 0x2c, 0];
  keymap[0][4] = [0x2a, 0x13, 0x12, 0x0c, 0x18, 0x1c, 0];
  keymap[0][5] = [0x28, 0x31, 0x0f, 0x0e, 0x0d, 0x0b, 0x91];
  keymap[0][6] = [0x38, 0x52, 0x37, 0x36, 0x10, 0x11, 0];
  keymap[0][7] = [0x4f, 0x51, 0x50, 0x5222, 0x5224, 0x2c, 0];
  const encoders = Array.from({ length: 10 }, () =>
    Array.from({ length: 2 }, () => [0, 0] as [number, number]));
  encoders[0][0] = [0x00aa, 0x00a9];
  encoders[0][1] = [0x00ac, 0x00ab];
  const combos = Array.from({ length: 32 }, () =>
    [0, 0, 0, 0, 0] as [number, number, number, number, number]);
  combos[0] = [0x0007, 0x0009, 0, 0, 0x0029];
  combos[1] = [0x000d, 0x000e, 0, 0, 0x0028];
  return {
    device: { id: "demo", name: "Cornix LP · Demo", vendorId: 0, productId: 0, transport: "Demo" },
    definition: cornixDefinition,
    viaProtocol: 9,
    vialProtocol: 6,
    uid: "demo000000000001",
    layers: 10,
    rows: 8,
    cols: 7,
    keymap,
    encoders,
    comboCount: combos.length,
    combosLoaded: true,
    combos,
    macroCount: 32,
    macroMemory: 1024,
    macrosLoaded: true,
    macroBuffer: [...new TextEncoder().encode("Hello from Cornix Studio"), ...Array(32).fill(0)],
    qmkSettingsSupported: true,
    qmkSettingsLoaded: true,
    qmkSettings: [
      { id: 2, data: [50, 0, 255, 255] },
      { id: 6, data: [232, 3, 255, 255] },
      { id: 7, data: [250, 0, 255, 255] },
      { id: 18, data: [20, 0, 255, 255] },
      { id: 19, data: [20, 0, 255, 255] },
      { id: 22, data: [1, 255, 255, 255] },
      { id: 23, data: [0, 255, 255, 255] },
      { id: 26, data: [1, 255, 255, 255] },
      { id: 27, data: [120, 0, 255, 255] },
    ],
  };
}

function customKeycodes(keyboard: KeyboardSnapshot): KeycodeOption[] {
  const definitions = keyboard.definition.customKeycodes as Array<{
    name?: string;
    shortName?: string;
    title?: string;
  }> | undefined;
  return (definitions ?? []).map((definition, index) => ({
    code: 0x7e00 + index,
    id: definition.name ?? `USER${index.toString().padStart(2, "0")}`,
    label: definition.shortName ?? definition.name ?? `User ${index}`,
    category: "custom",
  }));
}

function macroKeycodes(keyboard: KeyboardSnapshot): KeycodeOption[] {
  return Array.from({ length: keyboard.macroCount }, (_, index) => ({
    code: 0x7700 + index,
    id: `M${index}`,
    label: `Macro ${index}`,
    category: "macro",
  }));
}

function availableKeycodes(keyboard?: KeyboardSnapshot): KeycodeOption[] {
  const keycodes = keycodesForLayout(state.hostKeyLayout);
  return keyboard ? [...keycodes, ...macroKeycodes(keyboard), ...customKeycodes(keyboard)] : keycodes;
}

function displayKeycode(code: number): string {
  const option = availableKeycodes(state.keyboard).find((candidate) => candidate.code === code);
  return option?.shortLabel ?? option?.label ?? keycodeLabel(code);
}

function esc(value: unknown): string {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function icon(name: "keyboard" | "bluetooth" | "usb" | "refresh" | "check" | "search" | "layers" | "save"): string {
  const paths = {
    keyboard: '<rect x="3" y="6" width="18" height="12" rx="2"/><path d="M7 10h.01M11 10h.01M15 10h.01M19 10h.01M7 14h.01M11 14h6"/>',
    bluetooth: '<path d="m7 7 10 10-5 4V3l5 4L7 17"/>',
    usb: '<path d="M12 3v12m0-12-2 2m2-2 2 2m-2 10-4-4m4 4 4-4M8 13H6v4h2m8-4h2v4h-2"/>',
    refresh: '<path d="M20 11a8 8 0 1 0-2.34 5.66M20 4v7h-7"/>',
    check: '<path d="m5 12 4 4L19 6"/>',
    search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-4-4"/>',
    layers: '<path d="m12 2 9 5-9 5-9-5 9-5Z"/><path d="m3 12 9 5 9-5M3 17l9 5 9-5"/>',
    save: '<path d="M5 3h12l2 2v16H5V3Z"/><path d="M8 3v6h8V3M8 21v-7h8v7"/>',
  };
  return `<svg viewBox="0 0 24 24" aria-hidden="true">${paths[name]}</svg>`;
}

function shell(content: string): string {
  const hasKeyboard = Boolean(state.keyboard);
  const hasCombos = (state.keyboard?.comboCount ?? 0) > 0;
  const hasMacros = (state.keyboard?.macroCount ?? 0) > 0;
  const hasQmkSettings = state.keyboard?.qmkSettingsSupported ?? false;
  return `
    <div class="shell">
      <aside class="sidebar">
        <div class="brand"><span class="brand-mark">${icon("keyboard")}</span><span>Cornix <b>Studio</b></span></div>
        <nav>
          <button class="nav-item ${state.page === "keymap" ? "active" : ""}" data-page="keymap" ${hasKeyboard ? "" : "disabled"}>${icon("keyboard")}<span>キーマップ</span></button>
          <button class="nav-item ${state.page === "monitor" ? "active" : ""}" data-page="monitor" ${hasKeyboard ? "" : "disabled"}><span class="nav-glyph live-glyph">●</span><span>ライブ表示</span></button>
          <button class="nav-item ${state.page === "combo" ? "active" : ""}" data-page="combo" ${hasCombos ? "" : "disabled"}>${icon("layers")}<span>コンボ</span>${hasKeyboard && !hasCombos ? "<small>非対応</small>" : ""}</button>
          <button class="nav-item ${state.page === "macro" ? "active" : ""}" data-page="macro" ${hasMacros ? "" : "disabled"}><span class="nav-glyph">M</span><span>マクロ</span>${hasKeyboard && !hasMacros ? "<small>非対応</small>" : ""}</button>
          <button class="nav-item ${state.page === "qmk" ? "active" : ""}" data-page="qmk" ${hasQmkSettings ? "" : "disabled"}><span class="nav-glyph">Q</span><span>QMK詳細設定</span>${hasKeyboard && !hasQmkSettings ? "<small>非対応</small>" : ""}</button>
          <button class="nav-item ${state.page === "backup" ? "active" : ""}" data-page="backup" ${hasKeyboard ? "" : "disabled"}>${icon("save")}<span>保存・復元</span></button>
          <button class="nav-item ${state.page === "firmware" ? "active" : ""}" data-page="firmware" ${hasKeyboard ? "" : "disabled"}><span class="nav-glyph">↑</span><span>ファームウェア</span></button>
        </nav>
        <div class="sidebar-foot">
          <span class="version">PREVIEW 0.1</span>
          <a href="https://github.com/Ponkan230/cornix-studio" target="_blank" title="非公式プロジェクト・ソースコード・GPL-2.0-or-laterライセンス">UNOFFICIAL · GPL-2.0+</a>
        </div>
      </aside>
      <main>${content}</main>
      ${state.notice ? `<div class="toast ${state.notice.kind}">${state.notice.kind === "success" ? icon("check") : "!"}<span>${esc(state.notice.text)}</span></div>` : ""}
    </div>`;
}

function connectionScreen(): string {
  const deviceCards = state.devices.map((device) => `
    <button class="device-card" data-connect="${device.id}">
      <span class="device-icon">${icon(device.transport === "Bluetooth" ? "bluetooth" : "usb")}</span>
      <span class="device-copy">
        <strong>${esc(device.name)}</strong>
        <small>${device.transport} · ${device.vendorId.toString(16).padStart(4, "0")}:${device.productId.toString(16).padStart(4, "0")}</small>
      </span>
      <span class="connect-arrow">接続 →</span>
    </button>`).join("");

  return shell(`
    <section class="connect-page">
      <div class="topbar"><span></span><button class="ghost" id="scan">${icon("refresh")}再スキャン</button></div>
      <div class="connect-hero">
        <span class="eyebrow">CORNIX LP CONFIGURATOR</span>
        <h1>あなたの指に、<br><em>ぴったりの配列を。</em></h1>
        <p>USB と Bluetooth のどちらでも、レイヤーやキー割り当てをすばやく編集できます。</p>
      </div>
      <div class="connection-panel">
        <div class="panel-heading">
          <div><h2>キーボードを接続</h2><p>Bluetooth は先に Windows の設定でペアリングしてください。</p></div>
          <span class="secure-dot">● ローカル通信のみ</span>
        </div>
        <div class="device-list">
          ${state.loading ? `<div class="empty"><span class="spinner"></span>${state.loading === "connect" ? "Cornix LP の設定を読み込んでいます…" : "デバイスを探しています…"}</div>` :
            deviceCards || '<div class="empty">Cornix LP が見つかりません。電源とペアリングを確認してください。</div>'}
        </div>
        <div class="panel-actions">
          <button class="secondary" id="demo">実機なしでデモを開く</button>
          <span>設定はキーボード本体に直接保存されます</span>
        </div>
      </div>
    </section>`);
}

interface KeyboardGeometry {
  minX: number;
  minY: number;
  width: number;
  height: number;
}

function rotatedPoint(x: number, y: number, key: PhysicalKey): [number, number] {
  const radians = key.rotation * Math.PI / 180;
  const dx = x - key.rotationX;
  const dy = y - key.rotationY;
  return [
    key.rotationX + dx * Math.cos(radians) - dy * Math.sin(radians),
    key.rotationY + dx * Math.sin(radians) + dy * Math.cos(radians),
  ];
}

function keyboardGeometry(keys: PhysicalKey[]): KeyboardGeometry {
  if (keys.length === 0) return { minX: 0, minY: 0, width: 1, height: 1 };
  const points = keys.flatMap((key) => [
    rotatedPoint(key.x, key.y, key),
    rotatedPoint(key.x + key.width, key.y, key),
    rotatedPoint(key.x, key.y + key.height, key),
    rotatedPoint(key.x + key.width, key.y + key.height, key),
  ]);
  const xs = points.map(([x]) => x);
  const ys = points.map(([, y]) => y);
  const minX = Math.min(...xs);
  const minY = Math.min(...ys);
  return {
    minX,
    minY,
    width: Math.max(1, Math.max(...xs) - minX),
    height: Math.max(1, Math.max(...ys) - minY),
  };
}

function keyValue(key: PhysicalKey): number {
  if (!state.keyboard) return 0;
  if (key.encoderIndex !== undefined && key.encoderDirection !== undefined) {
    return state.keyboard.encoders[state.layer]?.[key.encoderIndex]?.[key.encoderDirection] ?? 0;
  }
  if (key.row === undefined || key.col === undefined) return 0;
  return state.keyboard.keymap[state.layer]?.[key.row]?.[key.col] ?? 0;
}

function connectionHeader(keyboard: KeyboardSnapshot): string {
  return `
    <header class="editor-header">
      <div>
        <span class="eyebrow">CONNECTED KEYBOARD</span>
        <h1>${esc(keyboard.device.name)}</h1>
      </div>
      <div class="header-actions">
        <span class="transport-badge">${icon(keyboard.device.transport === "Bluetooth" ? "bluetooth" : "usb")}${keyboard.device.transport}</span>
        <span class="saved">${icon("check")}本体に自動保存</span>
        <button class="ghost" id="disconnect">切断</button>
      </div>
    </header>`;
}

function paletteContent(keyboard: KeyboardSnapshot): { categories: string; options: string } {
  const categoryItems = [
    ["basic", "基本"], ["modifier", "修飾"], ["navigation", "移動"], ["keypad", "テンキー"],
    ["system", "システム"], ["media", "メディア"], ["mouse", "マウス"], ["layer", "レイヤー"],
  ];
  if (keyboard.macroCount > 0) categoryItems.push(["macro", "マクロ"]);
  if (customKeycodes(keyboard).length > 0) categoryItems.push(["custom", "Cornix"]);
  const categories = categoryItems
    .map(([id, label]) => `<button class="${state.category === id ? "active" : ""}" data-category="${id}">${label}</button>`)
    .join("");
  const options = availableKeycodes(keyboard)
    .filter((key) => key.category === state.category
      && (`${key.id} ${key.label}`.toLowerCase().includes(state.query.toLowerCase())))
    .map((key) => `<button class="palette-key" data-code="${key.code}" title="${esc(key.id)}"><strong>${esc(key.label)}</strong><small>${esc(key.id)}</small></button>`)
    .join("");
  return { categories, options };
}

function comboIsActive(entry: [number, number, number, number, number]): boolean {
  return entry.slice(0, 4).filter((keycode) => keycode !== 0).length >= 2 && entry[4] !== 0;
}

function comboKeyboard(keyboard: KeyboardSnapshot): string {
  const matrixKeys = state.physicalKeys.filter((key) =>
    key.encoderIndex === undefined && key.row !== undefined && key.col !== undefined);
  const geometry = keyboardGeometry(matrixKeys);
  const unit = Math.min(57, 760 / geometry.width, 300 / geometry.height);
  const entry = keyboard.combos[state.comboIndex] ?? [0, 0, 0, 0, 0];
  const inputCodes = entry.slice(0, 4);
  const keys = matrixKeys.map((key) => {
    const value = keyboard.keymap[state.layer]?.[key.row!]?.[key.col!] ?? 0;
    const used = value !== 0 && inputCodes.includes(value) ? " combo-used" : "";
    const originX = (key.rotationX - key.x) * unit;
    const originY = (key.rotationY - key.y) * unit;
    const style = [
      `left:${(key.x - geometry.minX) * unit}px`,
      `top:${(key.y - geometry.minY) * unit}px`,
      `width:${key.width * unit - 7}px`,
      `height:${key.height * unit - 7}px`,
      `transform-origin:${originX}px ${originY}px`,
      `--rotation:${key.rotation}deg`,
    ].join(";");
    return `<button class="key combo-source${used}" data-key="${key.id}" style="${style}" title="${esc(displayKeycode(value))}"><span>${esc(displayKeycode(value))}</span></button>`;
  }).join("");
  return `<div class="keyboard-canvas combo-canvas" style="width:${geometry.width * unit}px;height:${geometry.height * unit}px">${keys}</div>`;
}

function editorScreen(keyboard: KeyboardSnapshot): string {
  const geometry = keyboardGeometry(state.physicalKeys);
  const sidebarWidth = window.innerWidth <= 1100 ? 168 : 208;
  const availablePreviewWidth = Math.max(
    700,
    window.innerWidth - sidebarWidth - (34 * 2) - (24 * 2) - 20,
  );
  const unit = Math.min(74, availablePreviewWidth / geometry.width, 440 / geometry.height);
  const keys = state.physicalKeys.map((key) => {
    const value = keyValue(key);
    const selected = state.selected?.id === key.id ? " selected" : "";
    const encoder = key.encoderIndex !== undefined ? " encoder" : "";
    const originX = (key.rotationX - key.x) * unit;
    const originY = (key.rotationY - key.y) * unit;
    const keyGap = encoder ? -3 : 7;
    const style = [
      `left:${(key.x - geometry.minX) * unit}px`,
      `top:${(key.y - geometry.minY) * unit}px`,
      `width:${key.width * unit - keyGap}px`,
      `height:${key.height * unit - keyGap}px`,
      `transform-origin:${originX}px ${originY}px`,
      `--rotation:${key.rotation}deg`,
    ].join(";");
    const label = key.encoderIndex !== undefined
      ? (key.encoderDirection === 0 ? "↶" : "↷")
      : displayKeycode(value);
    const title = key.encoderIndex !== undefined ? `${label} · ${displayKeycode(value)}` : label;
    const detail = key.encoderIndex !== undefined
      ? `<small class="encoder-binding">${esc(displayKeycode(value))}</small>`
      : "";
    return `<button class="key${selected}${encoder}" data-key="${key.id}" style="${style}" title="${esc(title)}"><span>${esc(label)}</span>${detail}</button>`;
  }).join("");

  const palette = paletteContent(keyboard);

  return shell(`
    <section class="editor-page">
      ${connectionHeader(keyboard)}
      <div class="layer-row">
        <div class="layer-tabs">
          ${Array.from({ length: keyboard.layers }, (_, layer) => `<button class="${state.layer === layer ? "active" : ""}" data-layer="${layer}">Layer ${layer}</button>`).join("")}
        </div>
        <span class="protocol">Vial ${keyboard.vialProtocol} / VIA ${keyboard.viaProtocol}</span>
      </div>
      <section class="keyboard-stage">
        <div class="stage-heading">
          <div><h2>キーを選択</h2><p>変更したいキーをクリックして、下の一覧から割り当てます。</p></div>
          ${state.selected ? `<span class="selection-pill">選択中 · ${esc(displayKeycode(keyValue(state.selected)))}</span>` : ""}
        </div>
        <div class="keyboard-canvas" style="width:${geometry.width * unit}px;height:${geometry.height * unit}px">${keys}</div>
      </section>
      <section class="palette">
        <div class="palette-toolbar">
          <div class="category-tabs">${palette.categories}</div>
          <div class="palette-tools">
            <div class="layout-switch" aria-label="ホストキーボード配列" title="Windowsのキーボード配列に合わせて選択してください">
              <span>配列</span>
              <button class="${state.hostKeyLayout === "us" ? "active" : ""}" data-host-layout="us">US</button>
              <button class="${state.hostKeyLayout === "jis" ? "active" : ""}" data-host-layout="jis">JIS</button>
            </div>
            <label class="search">${icon("search")}<input id="key-search" value="${esc(state.query)}" placeholder="キーコードを検索"></label>
          </div>
        </div>
        <div class="palette-grid">${palette.options || '<div class="no-results">一致するキーがありません</div>'}</div>
      </section>
  </section>`);
}

function matrixPositionKey(position: MatrixPosition): string {
  return `${position.row},${position.col}`;
}

function monitorLayers(tracker = state.monitor.tracker): number[] {
  const keyboard = state.keyboard;
  if (!keyboard) return [0];
  const layers = new Set<number>([tracker.defaultLayer]);
  if (tracker.movedLayer !== undefined) layers.add(tracker.movedLayer);
  tracker.toggledLayers.forEach((layer) => layers.add(layer));
  tracker.momentaryLayers.forEach((layer) => layers.add(layer));
  if (tracker.oneShotLayer !== undefined) layers.add(tracker.oneShotLayer);
  return [...layers]
    .filter((layer) => layer >= 0 && layer < keyboard.layers)
    .sort((left, right) => right - left);
}

function monitorActiveLayer(): number {
  return monitorLayers()[0] ?? 0;
}

function resolveMonitorKeycode(row: number, col: number): number {
  const keyboard = state.keyboard;
  if (!keyboard) return 0;
  for (const layer of monitorLayers()) {
    const code = keyboard.keymap[layer]?.[row]?.[col] ?? 0;
    if (code !== 0x0001) return code;
  }
  return 0;
}

type LayerAction =
  | { kind: "to" | "mo" | "default" | "persistent-default" | "toggle" | "oneshot" | "tap-toggle" | "layer-tap"; layer: number }
  | undefined;

function layerAction(code: number): LayerAction {
  if (code >= 0x5200 && code <= 0x521f) return { kind: "to", layer: code & 0x1f };
  if (code >= 0x5220 && code <= 0x523f) return { kind: "mo", layer: code & 0x1f };
  if (code >= 0x5240 && code <= 0x525f) return { kind: "default", layer: code & 0x1f };
  if (code >= 0x5260 && code <= 0x527f) return { kind: "toggle", layer: code & 0x1f };
  if (code >= 0x5280 && code <= 0x529f) return { kind: "oneshot", layer: code & 0x1f };
  if (code >= 0x52c0 && code <= 0x52df) return { kind: "tap-toggle", layer: code & 0x1f };
  if (code >= 0x52e0 && code <= 0x52ff) return { kind: "persistent-default", layer: code & 0x1f };
  if (code >= 0x4000 && code <= 0x4fff) return { kind: "layer-tap", layer: (code >> 8) & 0x0f };
  return undefined;
}

function keyHand(positionId: string): "left" | "right" | undefined {
  const [row, col] = positionId.split(",").map(Number);
  if (!Number.isInteger(row) || !Number.isInteger(col)) return undefined;
  const key = state.physicalKeys.find((candidate) => candidate.row === row && candidate.col === col);
  if (!key) return undefined;
  const geometry = keyboardGeometry(state.physicalKeys);
  return key.x + key.width / 2 < geometry.minX + geometry.width / 2 ? "left" : "right";
}

function chordAllowsHold(tapHoldPosition: string, otherPosition?: string): boolean {
  if (!otherPosition || state.qmkValues[26] !== 1) return true;
  const tapHand = keyHand(tapHoldPosition);
  const otherHand = keyHand(otherPosition);
  return !tapHand || !otherHand || tapHand !== otherHand;
}

function activateHeldLayerTaps(now: number, force = false, otherPosition?: string): void {
  const tracker = state.monitor.tracker;
  const tappingTerm = state.qmkValues[7] ?? 200;
  tracker.bindings.forEach((binding, position) => {
    const action = layerAction(binding.code);
    if (action?.kind === "layer-tap"
      && !binding.layerTapActive
      && ((!force && now - binding.downAt >= tappingTerm)
        || (force && chordAllowsHold(position, otherPosition)))) {
      binding.layerTapActive = true;
      tracker.momentaryLayers.set(position, action.layer);
    }
  });
}

function toggleTrackedLayer(layer: number): void {
  const toggled = state.monitor.tracker.toggledLayers;
  if (toggled.has(layer)) toggled.delete(layer);
  else toggled.add(layer);
}

function rememberDefaultLayer(layer: number): void {
  const uid = state.keyboard?.uid;
  if (uid) localStorage.setItem(`cornix-default-layer-${uid}`, String(layer));
}

function applyLayerAction(positionId: string, action: Exclude<LayerAction, undefined>, now: number): void {
  const tracker = state.monitor.tracker;
  if (!state.keyboard || action.layer >= state.keyboard.layers) return;
  if (action.kind === "mo" || action.kind === "tap-toggle") {
    tracker.momentaryLayers.set(positionId, action.layer);
  } else if (action.kind === "toggle") {
    toggleTrackedLayer(action.layer);
  } else if (action.kind === "to") {
    tracker.movedLayer = action.layer;
    tracker.toggledLayers.clear();
    tracker.momentaryLayers.clear();
    tracker.oneShotLayer = undefined;
    tracker.oneShotConsumer = undefined;
  } else if (action.kind === "default" || action.kind === "persistent-default") {
    tracker.defaultLayer = action.layer;
    if (action.kind === "persistent-default") rememberDefaultLayer(action.layer);
  } else if (action.kind === "oneshot") {
    tracker.oneShotLayer = action.layer;
    tracker.oneShotActivatedAt = now;
    tracker.oneShotConsumer = undefined;
  }
}

function pressMonitorKey(position: MatrixPosition, now: number): void {
  const tracker = state.monitor.tracker;
  const positionId = matrixPositionKey(position);
  tracker.bindings.forEach((binding, id) => {
    if (id !== positionId && binding.source === "matrix") binding.interrupted = true;
  });
  if (state.qmkValues[23] === 1) activateHeldLayerTaps(now, true, positionId);
  const code = resolveMonitorKeycode(position.row, position.col);
  const action = layerAction(code);
  tracker.bindings.set(positionId, {
    code,
    downAt: now,
    layerTapActive: false,
    interrupted: false,
    source: "matrix",
  });
  if (!action) {
    if (tracker.oneShotLayer !== undefined && tracker.oneShotConsumer === undefined) {
      tracker.oneShotConsumer = positionId;
    }
    return;
  }
  applyLayerAction(positionId, action, now);
}

function applyPermissiveHold(now: number, releasedPosition: string, released: PressedBinding): void {
  if (released.source !== "matrix" || layerAction(released.code) || state.qmkValues[22] !== 1) return;
  const tracker = state.monitor.tracker;
  tracker.bindings.forEach((binding, position) => {
    const action = layerAction(binding.code);
    if (action?.kind === "layer-tap"
      && binding.interrupted
      && !binding.layerTapActive
      && chordAllowsHold(position, releasedPosition)) {
      binding.layerTapActive = true;
      tracker.momentaryLayers.set(position, action.layer);
    }
  });
  activateHeldLayerTaps(now);
}

function registerTapToggle(action: Exclude<LayerAction, undefined>, binding: PressedBinding, now: number): void {
  if (action.kind !== "tap-toggle") return;
  const tappingTerm = state.qmkValues[7] ?? 200;
  if (binding.interrupted || now - binding.downAt > tappingTerm) {
    state.monitor.tracker.tapToggle.delete(action.layer);
    return;
  }
  const previous = state.monitor.tracker.tapToggle.get(action.layer);
  const count = previous && now - previous.lastTapAt <= tappingTerm ? previous.count + 1 : 1;
  if (count >= 5) {
    toggleTrackedLayer(action.layer);
    state.monitor.tracker.tapToggle.delete(action.layer);
  } else {
    state.monitor.tracker.tapToggle.set(action.layer, { count, lastTapAt: now });
  }
}

function releaseMonitorKey(positionId: string, now: number): void {
  const tracker = state.monitor.tracker;
  const binding = tracker.bindings.get(positionId);
  if (!binding) return;
  const action = layerAction(binding.code);
  applyPermissiveHold(now, positionId, binding);
  if (action?.kind === "mo" || action?.kind === "tap-toggle" || binding.layerTapActive) {
    tracker.momentaryLayers.delete(positionId);
  }
  if (action) registerTapToggle(action, binding, now);
  if (tracker.oneShotConsumer === positionId) {
    tracker.oneShotLayer = undefined;
    tracker.oneShotActivatedAt = undefined;
    tracker.oneShotConsumer = undefined;
  }
  tracker.bindings.delete(positionId);
}

function expireOneShotLayer(now: number): void {
  const tracker = state.monitor.tracker;
  const timeout = state.qmkValues[6] ?? 0;
  if (tracker.oneShotLayer !== undefined
    && tracker.oneShotConsumer === undefined
    && timeout > 0
    && tracker.oneShotActivatedAt !== undefined
    && now - tracker.oneShotActivatedAt >= timeout) {
    tracker.oneShotLayer = undefined;
    tracker.oneShotActivatedAt = undefined;
  }
}

function comboBindings(entry: [number, number, number, number, number]): PressedBinding[] | undefined {
  const inputs = entry.slice(0, 4).filter((code) => code !== 0);
  if (inputs.length < 2) return undefined;
  const available = [...state.monitor.tracker.bindings.entries()]
    .filter(([, binding]) => binding.source === "matrix");
  const used = new Set<string>();
  const matched: PressedBinding[] = [];
  for (const code of inputs) {
    const candidate = available.find(([id, binding]) => !used.has(id) && binding.code === code);
    if (!candidate) return undefined;
    used.add(candidate[0]);
    matched.push(candidate[1]);
  }
  return matched;
}

function updateActiveCombos(now: number): void {
  const keyboard = state.keyboard;
  if (!keyboard?.combosLoaded) return;
  const tracker = state.monitor.tracker;
  const comboTerm = state.qmkValues[2] ?? 50;
  keyboard.combos.forEach((entry, index) => {
    if (!comboIsActive(entry)) return;
    const matched = comboBindings(entry);
    const withinTerm = matched
      ? Math.max(...matched.map((binding) => binding.downAt))
        - Math.min(...matched.map((binding) => binding.downAt)) <= comboTerm
      : false;
    const active = tracker.activeCombos.has(index);
    const positionId = `combo:${index}`;
    if (withinTerm && !active) {
      tracker.activeCombos.add(index);
      const code = entry[4];
      tracker.bindings.set(positionId, {
        code,
        downAt: now,
        layerTapActive: false,
        interrupted: false,
        source: "combo",
      });
      const action = layerAction(code);
      if (action) applyLayerAction(positionId, action, now);
    } else if (!withinTerm && active) {
      tracker.activeCombos.delete(index);
      releaseMonitorKey(positionId, now);
    }
  });
}

function flashLayerChange(previousLayer: number): void {
  const monitor = state.monitor;
  monitor.previousLayer = previousLayer;
  monitor.layerFlashUntil = Date.now() + 720;
  const generation = monitor.generation;
  window.setTimeout(() => {
    if (generation === state.monitor.generation && Date.now() >= state.monitor.layerFlashUntil) {
      if (isOverlayWindow) refreshLiveOverlayPresentation(false);
      else refreshMainMonitorPresentation(false);
    }
  }, 740);
}

function updateMonitorPressed(positions: MatrixPosition[]): void {
  const previousLayer = state.layer;
  const previousPressed = state.monitor.pressed;
  const nextPressed = new Set(positions.map(matrixPositionKey));
  const now = performance.now();
  const releasedPositions = [...previousPressed].filter((position) => !nextPressed.has(position));

  releasedPositions.forEach((position) => releaseMonitorKey(position, now));
  if (releasedPositions.length > 0) updateActiveCombos(now);

  const newlyPressed = positions.filter((position) => !previousPressed.has(matrixPositionKey(position)));
  newlyPressed
    .map((position) => ({
      position,
      action: layerAction(resolveMonitorKeycode(position.row, position.col)),
    }))
    .sort((left, right) => Number(Boolean(right.action)) - Number(Boolean(left.action)))
    .forEach(({ position }) => pressMonitorKey(position, now));
  activateHeldLayerTaps(now);
  if (newlyPressed.length > 0) updateActiveCombos(now);
  expireOneShotLayer(now);

  state.monitor.pressed = nextPressed;
  state.layer = monitorActiveLayer();
  if (previousLayer !== state.layer) flashLayerChange(previousLayer);
  const pressedChanged = releasedPositions.length > 0 || newlyPressed.length > 0;
  if (pressedChanged || previousLayer !== state.layer) {
    if (isOverlayWindow) refreshLiveOverlayPresentation(previousLayer !== state.layer);
    else refreshMainMonitorPresentation(previousLayer !== state.layer);
  }
}

function monitorKeyValue(key: PhysicalKey): number {
  if (!state.keyboard) return 0;
  if (key.encoderIndex !== undefined && key.encoderDirection !== undefined) {
    return state.keyboard.encoders[state.layer]?.[key.encoderIndex]?.[key.encoderDirection] ?? 0;
  }
  if (key.row === undefined || key.col === undefined) return 0;
  return resolveMonitorKeycode(key.row, key.col);
}

function monitorScreen(keyboard: KeyboardSnapshot): string {
  const monitorKeys = state.physicalKeys.filter((key) => key.encoderIndex === undefined);
  const geometry = keyboardGeometry(monitorKeys);
  const sidebarWidth = window.innerWidth <= 1100 ? 168 : 208;
  const availablePreviewWidth = Math.max(700, window.innerWidth - sidebarWidth - 136);
  const unit = Math.min(78, availablePreviewWidth / geometry.width, 470 / geometry.height);
  const keys = monitorKeys.map((key) => {
    const position = key.row === undefined || key.col === undefined
      ? undefined
      : `${key.row},${key.col}`;
    const pressed = position && state.monitor.pressed.has(position) ? " pressed" : "";
    const showUnlockTargets = state.monitor.mode === "locked" || state.monitor.mode === "unlocking";
    const unlockTarget = showUnlockTargets && position && state.monitor.unlockKeys.has(position) ? " unlock-target" : "";
    const encoder = key.encoderIndex !== undefined ? " encoder" : "";
    const originX = (key.rotationX - key.x) * unit;
    const originY = (key.rotationY - key.y) * unit;
    const keyGap = encoder ? -3 : 7;
    const style = [
      `left:${(key.x - geometry.minX) * unit}px`,
      `top:${(key.y - geometry.minY) * unit}px`,
      `width:${key.width * unit - keyGap}px`,
      `height:${key.height * unit - keyGap}px`,
      `transform-origin:${originX}px ${originY}px`,
      `--rotation:${key.rotation}deg`,
    ].join(";");
    const value = monitorKeyValue(key);
    const label = key.encoderIndex !== undefined
      ? (key.encoderDirection === 0 ? "↶" : "↷")
      : displayKeycode(value);
    const detail = key.encoderIndex !== undefined
      ? `<small class="encoder-binding">${esc(displayKeycode(value))}</small>`
      : "";
    const attributes = [
      `data-key-id="${esc(key.id)}"`,
      position ? `data-position="${position}"` : "",
    ].filter(Boolean).join(" ");
    return `<button class="key monitor-key${pressed}${unlockTarget}${encoder}" ${attributes} style="${style}" tabindex="-1"><span>${esc(label)}</span>${detail}</button>`;
  }).join("");

  const mode = state.monitor.mode;
  const progress = state.monitor.unlockTotal > 0
    ? Math.max(0, Math.min(100,
      ((state.monitor.unlockTotal - state.monitor.unlockRemaining) / state.monitor.unlockTotal) * 100))
    : 0;
  const status = mode === "active"
    ? `<span class="monitor-live"><i></i>高速監視中 · ${keyboard.device.transport}</span>`
    : mode === "detached"
      ? `<span class="monitor-live"><i></i>オーバーレイで監視中</span>`
    : mode === "unlocking"
      ? `<span class="monitor-live unlocking"><i></i>解錠待ち</span>`
      : "";
  const layerChanging = Date.now() < state.monitor.layerFlashUntil;
  const layerTransition = `<span class="layer-transition ${layerChanging ? "" : "hidden"}" data-layer-transition>${state.monitor.previousLayer ?? 0} → ${state.layer}</span>`;
  const controls = mode === "loading"
    ? `<span class="monitor-loading"><span class="spinner"></span>状態を確認しています</span>`
    : mode === "locked"
      ? `<button class="monitor-primary" id="start-monitor-unlock">解錠を開始</button>`
    : mode === "active"
      ? `<span class="monitor-actions"><button class="monitor-primary" id="open-live-overlay">オーバーレイを開く</button><button class="ghost" id="stop-monitor">監視を終了</button></span>`
    : mode === "detached"
      ? `<button class="monitor-primary" id="open-live-overlay">オーバーレイを表示</button>`
    : mode === "unlocking"
      ? `<button class="ghost" id="stop-monitor">監視を終了</button>`
    : mode === "unsupported"
      ? `<button class="ghost" id="retry-monitor">再確認</button>`
    : mode === "error"
      ? `<button class="ghost" id="retry-monitor">再試行</button>`
    : `<button class="monitor-primary" id="retry-monitor">モニターを開始</button>`;

  const guidance = mode === "locked"
    ? `<div class="monitor-callout"><strong>キーボードを解錠してください</strong><span>開始後、黄色で示されたキーをプログレスバーが満ちるまで長押しします。</span></div>`
    : mode === "unlocking"
      ? `<div class="unlock-progress"><div><strong>黄色のキーを長押ししてください</strong><span>キーから手を離さず、そのままお待ちください。</span></div><div class="progress-track"><i style="width:${progress}%"></i></div></div>`
    : mode === "unsupported"
      ? `<div class="monitor-callout error"><strong>リアルタイム監視に対応していません</strong><span>Vialプロトコルv3以上とMatrix Tester対応ファームウェアが必要です。</span></div>`
    : mode === "detached"
      ? `<div class="monitor-callout privacy"><strong>独立ウィンドウで表示しています</strong><span>設定画面で別のページを開いても監視を継続します。終了はオーバーレイ右上の×を押してください。</span></div>`
    : mode === "error"
      ? `<div class="monitor-callout error"><strong>監視を継続できませんでした</strong><span>${esc(state.monitor.error ?? "キーボードを再接続してください。")}</span></div>`
      : `<div class="monitor-callout privacy"><strong>入力内容は記録しません</strong><span>物理キーの押下状態だけをメモリ上で表示し、監視終了時にキーボードを再ロックします。</span></div>`;

  return shell(`
    <section class="editor-page monitor-page">
      ${connectionHeader(keyboard)}
      <div class="layer-row">
        <div class="layer-tabs monitor-layers">
          ${Array.from({ length: keyboard.layers }, (_, layer) => `<button class="${state.layer === layer ? "active" : ""}" data-monitor-layer="${layer}" disabled>Layer ${layer}</button>`).join("")}
        </div>
        <div class="monitor-status">${status}${layerTransition}<span class="protocol">Vial ${keyboard.vialProtocol} / VIA ${keyboard.viaProtocol}</span></div>
      </div>
      <section class="keyboard-stage monitor-stage">
        <div class="stage-heading monitor-heading">
          <div><h2>リアルタイムモニター</h2><p>押したキーを光らせ、レイヤーキーに合わせて表示を自動で切り替えます。</p></div>
          ${controls}
        </div>
        ${guidance}
        <div class="keyboard-canvas monitor-canvas" style="width:${geometry.width * unit}px;height:${geometry.height * unit}px">${keys}</div>
      </section>
    </section>`);
}

function liveOverlayScreen(keyboard: KeyboardSnapshot): string {
  const monitorKeys = state.physicalKeys.filter((key) => key.encoderIndex === undefined);
  const geometry = keyboardGeometry(monitorKeys);
  const availableWidth = Math.max(420, window.innerWidth - 28);
  const availableHeight = Math.max(190, window.innerHeight - 92);
  const unit = Math.max(28, Math.min(68, availableWidth / geometry.width, availableHeight / geometry.height));
  const keys = monitorKeys.map((key) => {
    const position = key.row === undefined || key.col === undefined
      ? undefined
      : `${key.row},${key.col}`;
    const pressed = position && state.monitor.pressed.has(position) ? " pressed" : "";
    const showUnlockTargets = state.monitor.mode === "locked" || state.monitor.mode === "unlocking";
    const unlockTarget = showUnlockTargets && position && state.monitor.unlockKeys.has(position) ? " unlock-target" : "";
    const encoder = key.encoderIndex !== undefined ? " encoder" : "";
    const originX = (key.rotationX - key.x) * unit;
    const originY = (key.rotationY - key.y) * unit;
    const keyGap = encoder ? -2 : Math.max(4, unit * 0.08);
    const style = [
      `left:${(key.x - geometry.minX) * unit}px`,
      `top:${(key.y - geometry.minY) * unit}px`,
      `width:${key.width * unit - keyGap}px`,
      `height:${key.height * unit - keyGap}px`,
      `transform-origin:${originX}px ${originY}px`,
      `--rotation:${key.rotation}deg`,
    ].join(";");
    const value = monitorKeyValue(key);
    const label = key.encoderIndex !== undefined
      ? (key.encoderDirection === 0 ? "↶" : "↷")
      : displayKeycode(value);
    const attributes = [
      `data-key-id="${esc(key.id)}"`,
      position ? `data-position="${position}"` : "",
    ].filter(Boolean).join(" ");
    return `<div class="key monitor-key overlay-key${pressed}${unlockTarget}${encoder}" ${attributes} style="${style}"><span>${esc(label)}</span></div>`;
  }).join("");
  const transport = `${keyboard.device.transport} · 高速監視`;
  const layerChanging = Date.now() < state.monitor.layerFlashUntil;
  const layerLabel = layerChanging
    ? `${state.monitor.previousLayer ?? 0} → Layer ${state.layer}`
    : `Layer ${state.layer}`;
  const progress = state.monitor.unlockTotal > 0
    ? Math.max(0, Math.min(100,
      ((state.monitor.unlockTotal - state.monitor.unlockRemaining) / state.monitor.unlockTotal) * 100))
    : 0;
  const unlockLabels = state.physicalKeys
    .filter((key) => key.row !== undefined
      && key.col !== undefined
      && state.monitor.unlockKeys.has(`${key.row},${key.col}`))
    .map((key) => displayKeycode(monitorKeyValue(key)))
    .filter((label, index, labels) => label && labels.indexOf(label) === index)
    .join(" + ");
  const gate = state.monitor.mode === "locked"
    ? `<div class="overlay-error overlay-unlock">
        <strong>監視ロックの解除が必要です</strong>
        <span>下のボタンを押し、黄色で表示されるキーを長押ししてください。</span>
        ${unlockLabels ? `<span class="overlay-unlock-keys">解除キー: ${esc(unlockLabels)}</span>` : ""}
        <button id="overlay-start-unlock">解除を開始</button>
      </div>`
    : state.monitor.mode === "unlocking"
      ? `<div class="overlay-error overlay-unlock">
          <strong>黄色のキーを長押ししてください</strong>
          <span>解除が完了するまで、そのまま押し続けます。</span>
          ${unlockLabels ? `<span class="overlay-unlock-keys">解除キー: ${esc(unlockLabels)}</span>` : ""}
          <div class="overlay-progress"><i style="width:${progress}%"></i></div>
        </div>`
      : state.monitor.mode === "error"
        ? `<div class="overlay-error">
            <strong>監視が停止しました</strong>
            <span>${esc(state.monitor.error ?? "Cornixを再接続してください。")}</span>
            <button id="overlay-retry-monitor">再試行</button>
          </div>`
        : "";

  return `
    <section class="live-overlay-frame">
      <header class="overlay-titlebar" data-tauri-drag-region>
        <div class="overlay-brand" data-tauri-drag-region><i></i><strong>Cornix Live</strong><span>${esc(keyboard.device.name)}</span></div>
        <div class="overlay-window-actions">
          <span class="overlay-transport">${transport}</span>
          <button id="close-live-overlay" title="オーバーレイを閉じる" aria-label="閉じる">×</button>
        </div>
      </header>
      <div class="overlay-meta">
        <span class="overlay-live ${state.monitor.mode === "active" ? "" : "stopped"}"><i></i>${state.monitor.mode === "active" ? "LIVE" : "STOPPED"}</span>
        <strong class="${layerChanging ? "changing" : ""}">${layerLabel}</strong>
        <span>押したキーとレイヤーをリアルタイム表示</span>
      </div>
      ${gate}
      <div class="overlay-keyboard">
        <div class="keyboard-canvas overlay-canvas" style="width:${geometry.width * unit}px;height:${geometry.height * unit}px">${keys}</div>
      </div>
      <span class="overlay-resize-hint" aria-hidden="true"></span>
    </section>`;
}

function renderLiveOverlay(): void {
  if (!state.keyboard) {
    app.innerHTML = `
      <section class="live-overlay-frame overlay-unavailable">
        <header class="overlay-titlebar" data-tauri-drag-region><strong data-tauri-drag-region>Cornix Live</strong><button id="close-live-overlay">×</button></header>
        <div><strong>表示情報を読み込めませんでした</strong><span>Cornix Studioからライブ表示を開き直してください。</span></div>
      </section>`;
  } else {
    app.innerHTML = liveOverlayScreen(state.keyboard);
  }
  document.querySelector("#close-live-overlay")?.addEventListener("click", () => {
    void closeLiveOverlayWindow();
  });
  document.querySelector("#overlay-start-unlock")?.addEventListener("click", () => {
    void startMonitorUnlock();
  });
  document.querySelector("#overlay-retry-monitor")?.addEventListener("click", () => {
    void initializeLiveOverlayMonitor();
  });
}

function refreshLiveOverlayPresentation(updateLabels: boolean): void {
  if (!isOverlayWindow || !state.keyboard) return;
  const keyById = new Map(state.physicalKeys.map((key) => [key.id, key]));
  document.querySelectorAll<HTMLElement>(".overlay-key").forEach((element) => {
    const position = element.dataset.position;
    element.classList.toggle("pressed", Boolean(position && state.monitor.pressed.has(position)));
    if (!updateLabels) return;
    const key = keyById.get(element.dataset.keyId ?? "");
    const label = key?.encoderIndex !== undefined
      ? (key.encoderDirection === 0 ? "↶" : "↷")
      : key ? displayKeycode(monitorKeyValue(key)) : "";
    const labelElement = element.querySelector("span");
    if (labelElement && labelElement.textContent !== label) labelElement.textContent = label;
  });
  const layerChanging = Date.now() < state.monitor.layerFlashUntil;
  const layerElement = document.querySelector<HTMLElement>(".overlay-meta > strong");
  if (layerElement) {
    layerElement.classList.toggle("changing", layerChanging);
    layerElement.textContent = layerChanging
      ? `${state.monitor.previousLayer ?? 0} → Layer ${state.layer}`
      : `Layer ${state.layer}`;
  }
}

function refreshMainMonitorPresentation(updateLabels: boolean): void {
  if (isOverlayWindow || state.page !== "monitor" || !state.keyboard) return;
  const keyById = new Map(state.physicalKeys.map((key) => [key.id, key]));
  document.querySelectorAll<HTMLElement>(".monitor-canvas .monitor-key").forEach((element) => {
    const position = element.dataset.position;
    element.classList.toggle("pressed", Boolean(position && state.monitor.pressed.has(position)));
    if (!updateLabels) return;
    const key = keyById.get(element.dataset.keyId ?? "");
    if (!key) return;
    const value = monitorKeyValue(key);
    const label = key.encoderIndex !== undefined
      ? (key.encoderDirection === 0 ? "↶" : "↷")
      : displayKeycode(value);
    const labelElement = element.querySelector("span");
    if (labelElement && labelElement.textContent !== label) labelElement.textContent = label;
    const detailElement = element.querySelector<HTMLElement>(".encoder-binding");
    if (detailElement) detailElement.textContent = displayKeycode(value);
  });
  document.querySelectorAll<HTMLElement>("[data-monitor-layer]").forEach((element) => {
    element.classList.toggle("active", Number(element.dataset.monitorLayer) === state.layer);
  });
  const transition = document.querySelector<HTMLElement>("[data-layer-transition]");
  if (transition) {
    const changing = Date.now() < state.monitor.layerFlashUntil;
    transition.classList.toggle("hidden", !changing);
    transition.textContent = `${state.monitor.previousLayer ?? 0} → ${state.layer}`;
  }
}

function storedOverlayBounds(): OverlayBounds | undefined {
  try {
    const value = JSON.parse(localStorage.getItem(overlayBoundsKey) ?? "null") as Partial<OverlayBounds> | null;
    if (!value || ![value.x, value.y, value.width, value.height].every(Number.isFinite)) return undefined;
    return value as OverlayBounds;
  } catch {
    return undefined;
  }
}

function saveOverlayBounds(): void {
  if (!isOverlayWindow) return;
  const bounds: OverlayBounds = {
    x: window.screenX,
    y: window.screenY,
    width: window.outerWidth,
    height: window.outerHeight,
  };
  if ([bounds.x, bounds.y, bounds.width, bounds.height].every(Number.isFinite)) {
    localStorage.setItem(overlayBoundsKey, JSON.stringify(bounds));
  }
}

async function closeLiveOverlayWindow(): Promise<void> {
  resetMonitorState();
  localStorage.removeItem(overlayBootstrapKey);
  saveOverlayBounds();
  try {
    await invoke("close_live_overlay");
  } catch {
    window.close();
  }
}

async function initializeLiveOverlayMonitor(): Promise<void> {
  if (!isTauri || !liveOverlayBootstrap?.keyboard) return;
  const bootstrap = liveOverlayBootstrap;
  state.keyboard = bootstrap.keyboard;
  state.physicalKeys = parseKle(bootstrap.keyboard.definition);
  state.qmkValues = bootstrap.qmkValues ?? {};
  state.page = "monitor";
  state.layer = 0;
  const generation = resetMonitorState("loading");
  state.monitor.tracker = restoreLayerTracker(bootstrap.tracker);
  state.layer = monitorActiveLayer();
  render();
  try {
    const status = await invoke<MonitorStatus>("get_monitor_status");
    if (!status.supported) throw new Error("このファームウェアはリアルタイム表示に対応していません。");
    if (generation !== state.monitor.generation) return;
    state.monitor.unlockKeys = new Set(status.unlockKeys.map(matrixPositionKey));
    if (status.unlocked) {
      beginMatrixMonitoring(generation, bootstrap.tracker);
    } else if (status.unlockInProgress) {
      state.monitor.mode = "unlocking";
      render();
      window.setTimeout(() => void pollUnlockLoop(generation), 0);
    } else {
      state.monitor.mode = "locked";
      render();
      await startMonitorUnlock();
    }
    await emit("live-overlay-ready");
  } catch (error) {
    if (generation !== state.monitor.generation) return;
    state.monitor.mode = "error";
    state.monitor.error = String(error);
    render();
  }
}

async function initializeLiveOverlayWindow(): Promise<void> {
  document.documentElement.classList.add("live-overlay-root");
  document.body.classList.add("live-overlay-root");
  if (!isTauri) {
    const demo = browserDemo();
    demo.keymap[1] = demo.keymap[0].map((row) => [...row]);
    state.keyboard = demo;
    state.physicalKeys = parseKle(state.keyboard.definition);
    state.page = "monitor";
    state.layer = 1;
    resetMonitorState("active");
    state.monitor.tracker.momentaryLayers.set("demo", 1);
    state.monitor.pressed = new Set(["1,1", "1,2", "3,5"]);
    state.monitor.previousLayer = 0;
    state.monitor.layerFlashUntil = Date.now() + 1200;
    render();
    return;
  }
  try {
    liveOverlayBootstrap = JSON.parse(localStorage.getItem(overlayBootstrapKey) ?? "null") as LiveOverlayBootstrap | undefined;
    if (!liveOverlayBootstrap?.keyboard) throw new Error("オーバーレイの表示情報がありません。");
    await initializeLiveOverlayMonitor();
  } catch (error) {
    state.monitor.mode = "error";
    state.monitor.error = String(error);
    render();
  }

  void listen("live-overlay-reopen", async () => {
    try {
      liveOverlayBootstrap = JSON.parse(localStorage.getItem(overlayBootstrapKey) ?? "null") as LiveOverlayBootstrap | undefined;
      await initializeLiveOverlayMonitor();
    } catch (error) {
      state.monitor.mode = "error";
      state.monitor.error = String(error);
      render();
    }
  });

  let boundsSaveTimer: number | undefined;
  const scheduleBoundsSave = () => {
    window.clearTimeout(boundsSaveTimer);
    boundsSaveTimer = window.setTimeout(saveOverlayBounds, 250);
  };
  const overlayWindow = getCurrentWindow();
  void overlayWindow.onMoved(scheduleBoundsSave);
  void overlayWindow.onResized(scheduleBoundsSave);
  window.addEventListener("beforeunload", saveOverlayBounds);
}

function deserializeMacros(buffer: number[], macroCount: number): MacroAction[][] {
  const macros: MacroAction[][] = [];
  let offset = 0;
  for (let macroIndex = 0; macroIndex < macroCount; macroIndex += 1) {
    const end = buffer.indexOf(0, offset);
    const bytes = buffer.slice(offset, end < 0 ? buffer.length : end);
    offset = end < 0 ? buffer.length : end + 1;
    const actions: MacroAction[] = [];
    let text: number[] = [];
    const flushText = () => {
      if (text.length > 0) {
        actions.push({ type: "text", text: new TextDecoder().decode(Uint8Array.from(text)) });
        text = [];
      }
    };
    for (let index = 0; index < bytes.length;) {
      if (bytes[index] !== 1 || index + 1 >= bytes.length) {
        text.push(bytes[index]);
        index += 1;
        continue;
      }
      flushText();
      const command = bytes[index + 1];
      if ([1, 2, 3].includes(command) && index + 2 < bytes.length) {
        actions.push({
          type: command === 1 ? "tap" : command === 2 ? "down" : "up",
          keycode: bytes[index + 2],
        });
        index += 3;
      } else if ([5, 6, 7].includes(command) && index + 3 < bytes.length) {
        let code = bytes[index + 2] | (bytes[index + 3] << 8);
        if (code > 0xff00) code = (code & 0xff) << 8;
        actions.push({
          type: command === 5 ? "tap" : command === 6 ? "down" : "up",
          keycode: code,
        });
        index += 4;
      } else if (command === 4 && index + 3 < bytes.length) {
        actions.push({
          type: "delay",
          duration: (bytes[index + 2] - 1) + (bytes[index + 3] - 1) * 255,
        });
        index += 4;
      } else {
        index += 2;
      }
    }
    flushText();
    macros.push(actions);
  }
  return macros;
}

function serializeMacros(macros: MacroAction[][], macroCount: number): number[] {
  const output: number[] = [];
  for (let macroIndex = 0; macroIndex < macroCount; macroIndex += 1) {
    for (const action of macros[macroIndex] ?? []) {
      if (action.type === "text") {
        const encoded = [...new TextEncoder().encode(action.text)];
        if (encoded.includes(0) || encoded.includes(1)) {
          throw new Error("テキストに制御文字は使用できません");
        }
        output.push(...encoded);
      } else if (action.type === "delay") {
        const duration = Math.max(0, Math.min(65024, Math.round(action.duration)));
        output.push(1, 4, (duration % 255) + 1, Math.floor(duration / 255) + 1);
      } else {
        const shortCommand = action.type === "tap" ? 1 : action.type === "down" ? 2 : 3;
        const extendedCommand = action.type === "tap" ? 5 : action.type === "down" ? 6 : 7;
        let code = action.keycode;
        if (code < 0x100) {
          output.push(1, shortCommand, code);
        } else {
          if (code % 0x100 === 0) code = 0xff00 | (code >> 8);
          output.push(1, extendedCommand, code & 0xff, code >> 8);
        }
      }
    }
    output.push(0);
  }
  return output;
}

function macroBuffer(): number[] {
  return serializeMacros(state.macros, state.keyboard?.macroCount ?? 0);
}

function macroIsDirty(): boolean {
  try {
    const current = macroBuffer();
    return current.length !== state.macroSavedBuffer.length
      || current.some((byte, index) => byte !== state.macroSavedBuffer[index]);
  } catch {
    return true;
  }
}

function macroSummary(actions: MacroAction[]): string {
  if (actions.length === 0) return "未設定";
  const text = actions.find((action) => action.type === "text");
  if (text?.type === "text" && text.text.trim()) {
    return text.text.trim().replace(/\s+/g, " ").slice(0, 14);
  }
  return `${actions.length}アクション`;
}

function macroScreen(keyboard: KeyboardSnapshot): string {
  let used = 0;
  let serializationError = "";
  try {
    used = macroBuffer().length;
  } catch (error) {
    serializationError = String(error);
    used = keyboard.macroMemory + 1;
  }
  const dirty = macroIsDirty();
  const overCapacity = used > keyboard.macroMemory;
  const actions = state.macros[state.macroIndex] ?? [];
  const selected = state.selectedMacroAction === undefined ? undefined : actions[state.selectedMacroAction];
  const keyPickerVisible = selected && ["tap", "down", "up"].includes(selected.type);
  const palette = paletteContent(keyboard);
  const slots = state.macros.map((macro, index) => `
    <button class="macro-slot ${state.macroIndex === index ? "selected" : ""} ${macro.length > 0 ? "configured" : ""}" data-macro-index="${index}">
      <strong>M${index}</strong><small>${esc(macroSummary(macro))}</small>
    </button>`).join("");
  const actionRows = actions.map((action, index) => {
    const control = action.type === "text"
      ? `<textarea data-macro-text="${index}" rows="2" placeholder="入力する文字">${esc(action.text)}</textarea>`
      : action.type === "delay"
        ? `<label class="delay-input"><input data-macro-delay="${index}" type="number" min="0" max="65024" value="${action.duration}"><span>ms</span></label>`
        : `<button class="macro-key-value ${state.selectedMacroAction === index ? "selected" : ""}" data-macro-select="${index}">${esc(displayKeycode(action.keycode))}<small>一覧から変更</small></button>`;
    return `
      <div class="macro-action-row">
        <div class="macro-order">
          <button data-macro-move="${index},-1" title="上へ" ${index === 0 ? "disabled" : ""}>↑</button>
          <button data-macro-move="${index},1" title="下へ" ${index === actions.length - 1 ? "disabled" : ""}>↓</button>
        </div>
        <select data-macro-type="${index}">
          <option value="text" ${action.type === "text" ? "selected" : ""}>テキスト</option>
          <option value="tap" ${action.type === "tap" ? "selected" : ""}>キーを押して離す</option>
          <option value="down" ${action.type === "down" ? "selected" : ""}>キーを押す</option>
          <option value="up" ${action.type === "up" ? "selected" : ""}>キーを離す</option>
          <option value="delay" ${action.type === "delay" ? "selected" : ""}>待ち時間</option>
        </select>
        <div class="macro-action-control">${control}</div>
        <button class="macro-remove" data-macro-remove="${index}" title="削除">×</button>
      </div>`;
  }).join("");

  return shell(`
    <section class="editor-page macro-page">
      ${connectionHeader(keyboard)}
      <div class="macro-heading">
        <div><span class="eyebrow">VIAL MACRO EDITOR</span><h2>マクロ設定</h2><p>文字入力やキー操作を、上から順番に実行します。</p></div>
        <div class="macro-memory ${overCapacity ? "over" : ""}">
          <span>使用容量</span><strong>${used} / ${keyboard.macroMemory} bytes</strong>
          <i><b style="width:${Math.min(100, used / Math.max(1, keyboard.macroMemory) * 100)}%"></b></i>
        </div>
      </div>
      <section class="macro-slots" aria-label="マクロ一覧">${slots}</section>
      <section class="macro-workspace">
        <div class="macro-workspace-heading">
          <div><h3>Macro ${state.macroIndex}</h3>${dirty ? '<span class="unsaved-dot">未保存</span>' : '<span class="saved-dot">保存済み</span>'}</div>
          <div class="macro-save-actions">
            <button class="ghost" id="revert-macros" ${!dirty || state.macroBusy ? "disabled" : ""}>元に戻す</button>
            <button class="primary" id="save-macros" ${!dirty || overCapacity || state.macroBusy ? "disabled" : ""}>${state.macroBusy ? "保存中…" : "本体へ保存"}</button>
          </div>
        </div>
        ${serializationError ? `<p class="macro-error">${esc(serializationError)}</p>` : ""}
        <div class="macro-actions-list">${actionRows || '<div class="macro-empty">まだアクションがありません。下のボタンから追加してください。</div>'}</div>
        <div class="macro-add-actions">
          <span>アクションを追加</span>
          <button data-add-macro="text">＋ テキスト</button>
          <button data-add-macro="tap">＋ キー操作</button>
          <button data-add-macro="delay">＋ 待ち時間</button>
        </div>
      </section>
      ${keyPickerVisible ? `
        <section class="palette macro-palette">
          <div class="palette-toolbar">
            <div><strong>キー操作を選択</strong><small>${selected?.type === "down" ? "押すキー" : selected?.type === "up" ? "離すキー" : "押して離すキー"}</small></div>
            <div class="category-tabs">${palette.categories}</div>
            <label class="search">${icon("search")}<input id="key-search" value="${esc(state.query)}" placeholder="キーコードを検索"></label>
          </div>
          <div class="palette-grid">${palette.options || '<div class="no-results">一致するキーがありません</div>'}</div>
        </section>` : ""}
    </section>`);
}

function qmkValue(setting: QmkSettingRaw, width: number): number {
  return setting.data.slice(0, width).reduce(
    (value, byte, index) => value + ((byte & 0xff) * (2 ** (index * 8))),
    0,
  );
}

function qmkBytes(value: number, width: number): number[] {
  return Array.from({ length: width }, (_, index) =>
    Math.floor(value / (2 ** (index * 8))) & 0xff);
}

function syncQmkState(keyboard: KeyboardSnapshot): void {
  const values = Object.fromEntries(keyboard.qmkSettings.flatMap((setting) => {
    const field = qmkField(setting.id);
    return field ? [[setting.id, qmkValue(setting, field.width)]] : [];
  }));
  state.qmkValues = { ...values };
  state.qmkSavedValues = { ...values };
}

function qmkIsDirty(): boolean {
  return Object.entries(state.qmkValues).some(
    ([id, value]) => state.qmkSavedValues[Number(id)] !== value,
  );
}

function qmkScreen(keyboard: KeyboardSnapshot): string {
  const supportedIds = new Set(keyboard.qmkSettings.map((setting) => setting.id));
  const fields = QMK_SETTING_FIELDS.filter((field) => supportedIds.has(field.id));
  const dirty = qmkIsDirty();
  const groups = QMK_SETTING_GROUPS.map(([groupId, groupTitle]) => {
    const groupFields = fields.filter((field) => field.group === groupId);
    if (groupFields.length === 0) return "";
    const cards = groupFields.map((field) => {
      const value = state.qmkValues[field.id] ?? 0;
      const saved = state.qmkSavedValues[field.id] ?? value;
      const changed = value !== saved;
      const control = field.type === "boolean"
        ? `<label class="qmk-switch">
            <input type="checkbox" data-qmk-setting="${field.id}" ${value ? "checked" : ""} ${state.qmkBusy ? "disabled" : ""}>
            <span aria-hidden="true"></span><strong>${value ? "有効" : "無効"}</strong>
          </label>`
        : `<label class="qmk-number">
            <input type="number" data-qmk-setting="${field.id}" min="${field.min ?? 0}" max="${field.max ?? 0xffffffff}"
              value="${value}" ${state.qmkBusy ? "disabled" : ""}>
            <span>${field.unit ?? ""}</span>
          </label>`;
      return `
        <article class="qmk-card ${changed ? "changed" : ""}">
          <div class="qmk-copy">
            <div><h4>${esc(field.title)}</h4><span class="qmk-id">ID ${field.id}</span>${changed ? '<span class="unsaved-dot">変更あり</span>' : ""}</div>
            <p>${esc(field.description)}</p>
          </div>
          ${control}
        </article>`;
    }).join("");
    return `<section class="qmk-group"><h3>${esc(groupTitle)}</h3><div class="qmk-grid">${cards}</div></section>`;
  }).join("");

  return shell(`
    <section class="editor-page qmk-page">
      ${connectionHeader(keyboard)}
      <div class="qmk-heading">
        <div>
          <span class="eyebrow">VIAL QMK SETTINGS</span>
          <h2>QMK詳細設定</h2>
          <p>Cornix本体が公開している項目だけを表示しています。単位はミリ秒です。</p>
        </div>
        <div class="qmk-save-actions">
          <span class="${dirty ? "unsaved-dot" : "saved-dot"}">${dirty ? "未保存の変更あり" : "本体と同期済み"}</span>
          <button class="ghost" id="revert-qmk" ${!dirty || state.qmkBusy ? "disabled" : ""}>元に戻す</button>
          <button class="primary" id="save-qmk" ${!dirty || state.qmkBusy ? "disabled" : ""}>${state.qmkBusy ? "保存中…" : "本体へ保存"}</button>
        </div>
      </div>
      <div class="qmk-notice">
        <strong>タップ・ホールド設定について</strong>
        <span>大きく変更すると入力感が変わります。少しずつ調整し、問題があれば下の初期化を利用してください。</span>
      </div>
      <div class="qmk-groups">${groups || '<div class="qmk-empty">このCornixが公開している対応設定はありません。</div>'}</div>
      <section class="qmk-reset">
        <div><h3>QMK設定を初期値へ戻す</h3><p>この画面のQMK詳細設定を、ファームウェアに保存されている初期値へ戻します。キーマップやマクロは変更しません。</p></div>
        ${state.qmkResetConfirm
          ? `<div class="qmk-reset-confirm"><span>本当に初期化しますか？</span><button class="ghost" id="cancel-qmk-reset">キャンセル</button><button class="primary danger-fill" id="confirm-qmk-reset" ${state.qmkBusy ? "disabled" : ""}>初期化する</button></div>`
          : `<button class="ghost danger" id="start-qmk-reset" ${state.qmkBusy ? "disabled" : ""}>初期値へ戻す</button>`}
      </section>
    </section>`);
}

function currentFirmwareVersion(keyboard: KeyboardSnapshot): string {
  const layouts = keyboard.definition.layouts as { labels?: unknown[] } | undefined;
  for (const label of layouts?.labels ?? []) {
    if (Array.isArray(label) && String(label[0]).toLowerCase().includes("firmware")) {
      return String(label[1] ?? "不明");
    }
  }
  return "不明";
}

function formatBytes(bytes: number): string {
  return bytes >= 1024 ? `${(bytes / 1024).toFixed(1)} KB` : `${bytes} bytes`;
}

function firmwareScreen(keyboard: KeyboardSnapshot): string {
  const packageInfo = state.firmwarePackage;
  const steps: Array<[FirmwareStage, string]> = [
    ["select", "ファイル確認"],
    ["prepare", "更新前準備"],
    ["left", "左手を書き込み"],
    ["right", "右手を書き込み"],
    ["done", "完了"],
  ];
  const currentStep = Math.max(0, steps.findIndex(([stage]) => stage === state.firmwareStage));
  const progress = steps.map(([, title], index) => `
    <div class="firmware-step ${index === currentStep ? "active" : ""} ${index < currentStep ? "done" : ""}">
      <span>${index < currentStep ? "✓" : index + 1}</span><strong>${title}</strong>
    </div>`).join("");

  let content = "";
  if (!packageInfo) {
    content = `
      <section class="firmware-select">
        <div class="firmware-drop">
          <span class="firmware-upload-icon">UF2</span>
          <h3>公式ファームウェアを選択</h3>
          <p>公式ZIPをそのまま選ぶか、展開済みのleft/right用UF2を2つ同時に選択してください。</p>
          <label class="primary file-picker ${state.firmwareBusy ? "disabled" : ""}">
            ${state.firmwareBusy ? "検証中…" : "ファイルを選択"}
            <input id="firmware-file" type="file" accept=".zip,.uf2,application/zip" multiple ${state.firmwareBusy ? "disabled" : ""}>
          </label>
          ${keyboard.device.transport === "Demo" ? '<button class="ghost" id="firmware-demo-package">デモ用パッケージを読み込む</button>' : ""}
        </div>
        <div class="firmware-source">
          <strong>必ず公式配布ファイルを使用してください</strong>
          <p>非公式ファームウェアや別機種のUF2は故障の原因になります。Cornix StudioはUF2署名、ブロック構造、書き込み範囲、nRF52840 family ID、left/rightの組み合わせを確認します。</p>
          <a href="https://docs.channel.io/jezailfunderjp/ja/articles/Cornix-%E3%83%95%E3%82%A1%E3%83%BC%E3%83%A0%E3%82%A6%E3%82%A7%E3%82%A2-bf1534b6" target="_blank">公式ダウンロードページを開く ↗</a>
        </div>
      </section>`;
  } else if (state.firmwareStage === "prepare") {
    content = `
      <section class="firmware-package-card">
        <div><span class="valid-badge">${icon("check")}検証済み</span><h3>${esc(packageInfo.packageName)}</h3><p>${packageInfo.version ? `更新版 ${esc(packageInfo.version)}` : "ファイル名からバージョンを取得できません"} · 現在 ${esc(currentFirmwareVersion(keyboard))}</p></div>
        <button class="ghost" id="change-firmware-package" ${state.firmwareBusy ? "disabled" : ""}>ファイルを変更</button>
      </section>
      <div class="firmware-images">
        ${[packageInfo.left, packageInfo.right].map((image) => `
          <article><span>${image.side === "left" ? "L" : "R"}</span><div><strong>${image.side === "left" ? "左手用" : "右手用"}</strong><small>${esc(image.name)}</small></div><dl><dt>サイズ</dt><dd>${formatBytes(image.size)}</dd><dt>family ID</dt><dd>${image.familyId ?? "未記録"}</dd></dl></article>`).join("")}
      </div>
      ${packageInfo.warnings.map((warning) => `<p class="firmware-warning">${esc(warning)}</p>`).join("")}
      <section class="firmware-checklist">
        <h3>更新前の確認</h3>
        <p>更新を開始すると現在の設定を自動バックアップします。その後、左右のキーボードを1台ずつUSB接続して更新します。</p>
        <label><input id="ack-firmware-pairing" type="checkbox" ${state.firmwareAcknowledgedPairing ? "checked" : ""}> WindowsのBluetooth設定からCornixの登録を削除しました</label>
        <label><input id="ack-firmware-sides" type="checkbox" ${state.firmwareAcknowledgedBothSides ? "checked" : ""}> left用を左手、right用を右手へ書き込み、左右両方を更新することを確認しました</label>
        <button class="primary" id="prepare-firmware" ${!state.firmwareAcknowledgedPairing || !state.firmwareAcknowledgedBothSides || state.firmwareBusy ? "disabled" : ""}>${state.firmwareBusy ? "バックアップ中…" : "バックアップして更新を開始"}</button>
      </section>`;
  } else if (state.firmwareStage === "left" || state.firmwareStage === "right") {
    const side = state.firmwareStage;
    const sideJa = side === "left" ? "左手" : "右手";
    const image = packageInfo[side];
    const volumes = state.firmwareBootloaders.map((volume) => `
      <button class="firmware-volume ${state.firmwareSelectedRoot === volume.root ? "selected" : ""}" data-firmware-volume="${esc(volume.root)}">
        <span class="drive-icon">USB</span><div><strong>${esc(volume.root)} UF2ブートドライブ</strong><small>${esc(volume.boardId ?? volume.description)}</small></div>${state.firmwareSelectedRoot === volume.root ? "✓" : ""}
      </button>`).join("");
    content = `
      <section class="firmware-side-heading">
        <div><span class="side-badge">${side === "left" ? "L" : "R"}</span><div><h3>${sideJa}ユニットを書き込み</h3><p>${esc(image.name)} · ${formatBytes(image.size)}</p></div></div>
        <span class="backup-path">更新前バックアップ<br><strong>${esc(state.firmwareBackupPath ?? "作成済み")}</strong></span>
      </section>
      <section class="firmware-instructions">
        <h3>${sideJa}だけをUSB接続してブートモードにします</h3>
        <ol><li>反対側のUSBケーブルを外します</li><li>${sideJa}の電源をオンにしてUSB接続します</li><li>細いピンでリセットボタンを素早く2回押します</li><li>「Cornix」または「NO NAME」ドライブが出たら再検出します</li></ol>
      </section>
      <section class="firmware-drives">
        <div><h3>検出したUF2ブートドライブ</h3><button class="ghost" id="scan-firmware-volumes" ${state.firmwareBusy ? "disabled" : ""}>${icon("refresh")}再検出</button></div>
        ${volumes || '<p class="firmware-no-drive">まだブートドライブが見つかりません。上の手順を確認して「再検出」を押してください。</p>'}
      </section>
      ${state.firmwareFlashConfirm
        ? `<section class="firmware-final-confirm"><div><strong>${esc(state.firmwareSelectedRoot)} に${sideJa}用UF2を書き込みます</strong><p>書き込み中はUSBケーブルを抜いたり、電源を切ったりしないでください。</p></div><button class="ghost" id="cancel-firmware-flash">戻る</button><button class="primary danger-fill" id="confirm-firmware-flash" ${state.firmwareBusy ? "disabled" : ""}>${state.firmwareBusy ? "書き込み中…" : "書き込みを開始"}</button></section>`
        : `<button class="primary firmware-flash-button" id="start-firmware-flash" ${!state.firmwareSelectedRoot || state.firmwareBusy ? "disabled" : ""}>${sideJa}へ書き込む</button>`}
    `;
  } else {
    content = `
      <section class="firmware-complete">
        <span class="complete-mark">${icon("check")}</span>
        <h3>左右のファームウェア更新が完了しました</h3>
        <p>${esc(packageInfo.version ?? packageInfo.packageName)} を左右ユニットへ書き込みました。</p>
        <div class="firmware-aftercare">
          <strong>最後に行うこと</strong>
          <ol><li>左右のUSBケーブルを外し、両方の電源を入れ直します</li><li>左右が自動で再接続されるまで待ちます</li><li>WindowsのBluetooth設定からCornixを再ペアリングします</li><li>Cornix Studioへ再接続し、保存・復元から更新前バックアップを復元します</li></ol>
          <span>バックアップ: ${esc(state.firmwareBackupPath ?? "デモ")}</span>
        </div>
        <button class="primary" id="finish-firmware-update">接続画面へ戻る</button>
      </section>`;
  }

  return shell(`
    <section class="editor-page firmware-page">
      ${connectionHeader(keyboard)}
      <div class="firmware-heading">
        <div><span class="eyebrow">SAFE UF2 UPDATER</span><h2>ファームウェア更新</h2><p>Cornix LPの左右ユニットを、安全確認しながら1台ずつ更新します。</p></div>
        <span class="firmware-current">現在のバージョン<strong>${esc(currentFirmwareVersion(keyboard))}</strong></span>
      </div>
      <div class="firmware-critical"><strong>重要</strong><span>ファームウェア更新はUSB接続のみ対応します。更新中はケーブルを抜かず、必ず左右両方を同じバージョンへ更新してください。</span></div>
      <div class="firmware-progress">${progress}</div>
      <div class="firmware-content">${content}</div>
    </section>`);
}

function comboScreen(keyboard: KeyboardSnapshot): string {
  const entry = keyboard.combos[state.comboIndex] ?? [0, 0, 0, 0, 0];
  const active = comboIsActive(entry);
  const palette = paletteContent(keyboard);
  const slots = keyboard.combos.map((combo, index) => `
    <button class="combo-slot ${state.comboIndex === index ? "selected" : ""} ${comboIsActive(combo) ? "configured" : ""}"
      data-combo-index="${index}" title="Combo ${index + 1}">
      <span>${index + 1}</span><small>${comboIsActive(combo) ? displayKeycode(combo[4]) : "未設定"}</small>
    </button>`).join("");
  const inputs = entry.slice(0, 4).map((keycode, index) => `
    <button class="combo-field ${state.comboField === index ? "selected" : ""}" data-combo-field="${index}">
      <small>入力 ${index + 1}</small><strong>${esc(displayKeycode(keycode))}</strong>
    </button>`).join("");

  return shell(`
    <section class="editor-page combo-page">
      ${connectionHeader(keyboard)}
      <div class="combo-heading">
        <div>
          <span class="eyebrow">DYNAMIC COMBOS</span>
          <h2>コンボ設定</h2>
          <p>同時押しするキーを最大4つ選び、発動するキーを割り当てます。</p>
        </div>
        <span class="combo-count">${keyboard.combos.length} 枠</span>
      </div>
      <section class="combo-slots" aria-label="コンボ一覧">${slots}</section>
      <section class="combo-workspace">
        <div class="combo-editor-heading">
          <div><h3>Combo ${state.comboIndex + 1}</h3><span class="combo-state ${active ? "active" : ""}">${active ? "有効" : "未設定"}</span></div>
          <button class="ghost danger" id="clear-combo">このコンボを無効化</button>
        </div>
        <div class="combo-fields">
          <div class="combo-inputs">${inputs}</div>
          <span class="combo-arrow">→</span>
          <button class="combo-field output ${state.comboField === 4 ? "selected" : ""}" data-combo-field="4">
            <small>出力</small><strong>${esc(displayKeycode(entry[4]))}</strong>
          </button>
        </div>
        <div class="combo-source-heading">
          <div><h3>レイアウトから選択</h3><p>上で変更先を選び、キーボード上のキーをクリックします。</p></div>
          <div class="layer-tabs compact">
            ${Array.from({ length: keyboard.layers }, (_, layer) => `<button class="${state.layer === layer ? "active" : ""}" data-layer="${layer}">L${layer}</button>`).join("")}
          </div>
        </div>
        ${comboKeyboard(keyboard)}
      </section>
      <section class="palette combo-palette">
        <div class="palette-toolbar">
          <div class="category-tabs">${palette.categories}</div>
          <label class="search">${icon("search")}<input id="key-search" value="${esc(state.query)}" placeholder="キーコードを検索"></label>
        </div>
        <div class="palette-grid">${palette.options || '<div class="no-results">一致するキーがありません</div>'}</div>
      </section>
    </section>`);
}

function backupScreen(keyboard: KeyboardSnapshot): string {
  const preview = state.restorePreview;
  const changes = preview
    ? preview.request.keys.length + preview.request.encoders.length + preview.request.combos.length
      + (preview.request.macroBuffer ? 1 : 0)
      + preview.request.qmkSettings.length
    : 0;
  return shell(`
    <section class="editor-page backup-page">
      ${connectionHeader(keyboard)}
      <div class="backup-heading">
        <span class="eyebrow">CONFIGURATION ARCHIVE</span>
        <h2>設定の保存・復元</h2>
        <p>キーマップ、エンコーダー、コンボ、マクロ、QMK詳細設定をひとつのファイルに保存します。</p>
      </div>
      <section class="backup-actions">
        <article class="backup-card">
          <span class="backup-icon">${icon("save")}</span>
          <div>
            <h3>現在の設定を保存</h3>
            <p>接続中のCornixから読み込んだ設定をJSONとして「ダウンロード」フォルダーへ保存します。</p>
            <ul><li>${keyboard.layers}レイヤーのキーマップ</li><li>左右エンコーダー</li><li>${keyboard.comboCount}枠のコンボと${keyboard.macroCount}個のマクロ</li><li>${keyboard.qmkSettings.length}項目のQMK詳細設定</li></ul>
          </div>
          <button class="primary" id="export-backup" ${state.backupBusy ? "disabled" : ""}>${state.backupBusy ? "処理中…" : "バックアップを保存"}</button>
        </article>
        <article class="backup-card">
          <span class="backup-icon import">${icon("refresh")}</span>
          <div>
            <h3>ファイルから復元</h3>
            <p>Cornix StudioのJSON、またはVialの<code>.vil</code>ファイルを読み込みます。確定前に差分を確認できます。</p>
            <ul><li>機種と行列サイズを検証</li><li>変更箇所だけを書き込み</li><li>復元前に自動バックアップ</li></ul>
          </div>
          <label class="secondary file-picker ${state.backupBusy ? "disabled" : ""}">
            ファイルを選択
            <input id="backup-file" type="file" accept=".json,.vil,application/json" ${state.backupBusy ? "disabled" : ""}>
          </label>
        </article>
      </section>
      <section class="backup-safety">
        ${icon("check")}
        <div><strong>復元前の自動保護</strong><p>復元を実行する直前の設定を <code>%LOCALAPPDATA%\\Cornix Studio\\backups</code> に自動保存します。</p></div>
      </section>
      ${preview ? `
        <section class="restore-preview">
          <div class="restore-preview-heading">
            <div><span class="eyebrow">RESTORE PREVIEW</span><h3>${esc(preview.fileName)}</h3><p>${preview.source} · ${esc(new Date(preview.backup.createdAt).toLocaleString("ja-JP"))}</p></div>
            <span class="compatibility-ok">${icon("check")}このCornixに適合</span>
          </div>
          <div class="difference-grid">
            <div><strong>${preview.request.keys.length}</strong><span>キー変更</span></div>
            <div><strong>${preview.request.encoders.length}</strong><span>エンコーダー変更</span></div>
            <div><strong>${preview.request.combos.length}</strong><span>コンボ変更</span></div>
            <div><strong>${preview.request.macroBuffer ? 1 : 0}</strong><span>マクロ変更</span></div>
            <div><strong>${preview.request.qmkSettings.length}</strong><span>QMK設定変更</span></div>
            <div class="total"><strong>${changes}</strong><span>変更合計</span></div>
          </div>
          ${preview.source === "Vial .vil" ? '<p class="restore-warning">Vial形式には完全な機種情報がないため、行列サイズと設定数で互換性を確認しました。</p>' : ""}
          <div class="restore-actions">
            <button class="ghost" id="cancel-restore" ${state.backupBusy ? "disabled" : ""}>キャンセル</button>
            <button class="primary danger-fill" id="confirm-restore" ${state.backupBusy || changes === 0 ? "disabled" : ""}>${state.backupBusy ? "復元しています…" : changes === 0 ? "変更はありません" : `${changes}件を復元`}</button>
          </div>
        </section>` : ""}
    </section>`);
}

function render(): void {
  if (isOverlayWindow) {
    renderLiveOverlay();
    return;
  }
  app.innerHTML = state.keyboard
    ? state.page === "monitor"
      ? monitorScreen(state.keyboard)
      : state.page === "combo"
      ? comboScreen(state.keyboard)
      : state.page === "macro"
        ? macroScreen(state.keyboard)
      : state.page === "qmk"
        ? qmkScreen(state.keyboard)
      : state.page === "firmware"
        ? firmwareScreen(state.keyboard)
      : state.page === "backup"
        ? backupScreen(state.keyboard)
        : editorScreen(state.keyboard)
    : connectionScreen();
  bindEvents();
}

function resetMonitorState(mode: MonitorMode = "idle"): number {
  const generation = state.monitor.generation + 1;
  state.monitor = newMonitorState();
  state.monitor.mode = mode;
  state.monitor.generation = generation;
  return generation;
}

function beginMatrixMonitoring(generation: number, trackerSnapshot?: LayerTrackerSnapshot): void {
  if (generation !== state.monitor.generation || state.page !== "monitor") return;
  state.monitor.mode = "active";
  state.monitor.pressed.clear();
  state.monitor.unlockKeys.clear();
  state.monitor.pollFailures = 0;
  state.monitor.lastSuccessfulPollAt = performance.now();
  state.monitor.tracker = restoreLayerTracker(trackerSnapshot);
  if (!trackerSnapshot && state.keyboard) {
    const saved = Number(localStorage.getItem(`cornix-default-layer-${state.keyboard.uid}`));
    if (Number.isInteger(saved) && saved >= 0 && saved < state.keyboard.layers) {
      state.monitor.tracker.defaultLayer = saved;
    }
  }
  state.layer = monitorActiveLayer();
  render();
  window.setTimeout(() => void pollMatrixLoop(generation), 0);
}

async function pollMatrixLoop(generation: number): Promise<void> {
  if (generation !== state.monitor.generation
    || state.page !== "monitor"
    || state.monitor.mode !== "active"
    || !state.keyboard) return;
  const pollStartedAt = performance.now();
  try {
    const snapshot = await invoke<MatrixStateSnapshot>("poll_matrix_state");
    if (generation !== state.monitor.generation || state.monitor.mode !== "active") return;
    state.monitor.pollFailures = 0;
    state.monitor.lastSuccessfulPollAt = performance.now();
    updateMonitorPressed(snapshot.pressed);
    const targetInterval = state.keyboard.device.transport === "Bluetooth" ? 12 : 8;
    const delay = Math.max(0, targetInterval - (performance.now() - pollStartedAt));
    window.setTimeout(() => void pollMatrixLoop(generation), delay);
  } catch (error) {
    if (generation !== state.monitor.generation) return;
    state.monitor.pollFailures += 1;
    if (performance.now() - state.monitor.lastSuccessfulPollAt < 4000) {
      const retryDelay = Math.min(160, state.monitor.pollFailures * 20);
      window.setTimeout(() => void pollMatrixLoop(generation), retryDelay);
      return;
    }
    state.monitor.mode = "error";
    state.monitor.error = String(error);
    state.monitor.pressed.clear();
    render();
  }
}

async function pollUnlockLoop(generation: number): Promise<void> {
  if (generation !== state.monitor.generation
    || state.page !== "monitor"
    || state.monitor.mode !== "unlocking") return;
  try {
    const progress = await invoke<MonitorUnlockProgress>("poll_monitor_unlock");
    if (generation !== state.monitor.generation) return;
    state.monitor.unlockRemaining = progress.remaining;
    state.monitor.unlockTotal = Math.max(state.monitor.unlockTotal, progress.remaining);
    if (progress.unlocked) {
      beginMatrixMonitoring(generation, isOverlayWindow ? liveOverlayBootstrap?.tracker : undefined);
      return;
    }
    render();
    window.setTimeout(() => void pollUnlockLoop(generation), 200);
  } catch (error) {
    if (generation !== state.monitor.generation) return;
    state.monitor.mode = "error";
    state.monitor.error = String(error);
    render();
  }
}

async function initializeMonitor(): Promise<void> {
  const keyboard = state.keyboard;
  const generation = resetMonitorState("loading");
  state.layer = 0;
  render();
  if (!keyboard || keyboard.device.transport === "Demo" || !isTauri) {
    state.monitor.mode = "unsupported";
    render();
    return;
  }
  try {
    await ensureCombosLoaded();
    await ensureQmkSettingsLoaded();
    if (generation !== state.monitor.generation || state.page !== "monitor") return;
    const status = await invoke<MonitorStatus>("get_monitor_status");
    if (generation !== state.monitor.generation || state.page !== "monitor") return;
    state.monitor.unlockKeys = new Set(status.unlockKeys.map(matrixPositionKey));
    if (!status.supported) {
      state.monitor.mode = "unsupported";
    } else if (status.unlocked) {
      beginMatrixMonitoring(generation);
      return;
    } else if (status.unlockInProgress) {
      state.monitor.mode = "unlocking";
      window.setTimeout(() => void pollUnlockLoop(generation), 0);
    } else {
      state.monitor.mode = "locked";
    }
    render();
  } catch (error) {
    if (generation !== state.monitor.generation) return;
    state.monitor.mode = "error";
    state.monitor.error = String(error);
    render();
  }
}

async function startMonitorUnlock(): Promise<void> {
  if (!state.keyboard || state.monitor.mode !== "locked") return;
  const generation = state.monitor.generation;
  state.monitor.mode = "unlocking";
  state.monitor.unlockRemaining = 0;
  state.monitor.unlockTotal = 0;
  render();
  try {
    await invoke("start_monitor_unlock");
    if (generation === state.monitor.generation) {
      window.setTimeout(() => void pollUnlockLoop(generation), 0);
    }
  } catch (error) {
    if (generation !== state.monitor.generation) return;
    state.monitor.mode = "error";
    state.monitor.error = String(error);
    render();
  }
}

async function openLiveOverlay(): Promise<void> {
  const keyboard = state.keyboard;
  if (!keyboard || !isTauri || (state.monitor.mode !== "active" && state.monitor.mode !== "detached")) return;
  const alreadyDetached = state.monitor.mode === "detached";
  const bootstrap: LiveOverlayBootstrap = {
    keyboard,
    qmkValues: state.qmkValues,
    tracker: layerTrackerSnapshot(),
  };
  localStorage.setItem(overlayBootstrapKey, JSON.stringify(bootstrap));
  try {
    await invoke("open_live_overlay", { bounds: storedOverlayBounds() });
    try {
      await emitTo("live-overlay", "live-overlay-reopen");
    } catch {
      // A newly-created overlay initializes itself from local storage.
    }
    if (!alreadyDetached) notify("常時最前面のライブ表示を開きました");
  } catch (error) {
    if (!alreadyDetached) localStorage.removeItem(overlayBootstrapKey);
    notify(`オーバーレイを開けませんでした: ${String(error)}`, "error");
  }
}

async function stopMonitor(lockKeyboard = true): Promise<void> {
  const keyboard = state.keyboard;
  const detached = state.monitor.mode === "detached";
  const wasRunning = ["active", "detached", "unlocking", "locked", "error"].includes(state.monitor.mode);
  resetMonitorState();
  state.layer = 0;
  render();
  if (detached && isTauri) {
    try {
      await invoke("close_live_overlay");
    } catch {
      // The overlay may already have been closed by the user.
    }
  }
  if (lockKeyboard && wasRunning && keyboard?.device.transport !== "Demo" && isTauri) {
    try {
      await invoke("lock_monitor");
    } catch {
      // Disconnect and sleep transitions can make the final lock packet fail.
    }
  }
}

function notify(text: string, kind: "success" | "error" = "success"): void {
  state.notice = { text, kind };
  render();
  window.setTimeout(() => {
    state.notice = undefined;
    render();
  }, 2800);
}

async function scan(): Promise<void> {
  state.loading = "scan";
  render();
  try {
    state.devices = isTauri ? await invoke<DeviceSummary[]>("list_devices") : [];
  } catch (error) {
    state.notice = { kind: "error", text: String(error) };
  } finally {
    state.loading = undefined;
    render();
  }
}

async function connect(id?: string): Promise<void> {
  state.loading = "connect";
  render();
  try {
    const keyboard = !isTauri
      ? browserDemo()
      : id
      ? await invoke<KeyboardSnapshot>("connect_device", { id })
      : await invoke<KeyboardSnapshot>("connect_demo");
    state.keyboard = keyboard;
    state.physicalKeys = parseKle(keyboard.definition);
    state.page = "keymap";
    state.layer = 0;
    resetMonitorState();
    state.selected = undefined;
    state.comboIndex = 0;
    state.comboField = 0;
    state.restorePreview = undefined;
    state.macroIndex = 0;
    state.selectedMacroAction = undefined;
    state.macroSavedBuffer = [...keyboard.macroBuffer];
    state.macros = keyboard.macrosLoaded
      ? deserializeMacros(keyboard.macroBuffer, keyboard.macroCount)
      : Array.from({ length: keyboard.macroCount }, () => []);
    state.qmkResetConfirm = false;
    syncQmkState(keyboard);
    state.firmwarePackage = undefined;
    state.firmwareStage = "select";
    state.firmwareBusy = false;
    state.firmwareAcknowledgedPairing = false;
    state.firmwareAcknowledgedBothSides = false;
    state.firmwareBootloaders = [];
    state.firmwareSelectedRoot = undefined;
    state.firmwareFlashConfirm = false;
    state.firmwareBackupPath = undefined;
    state.firmwareCompleted = { left: false, right: false };
    state.loading = undefined;
    notify(`${keyboard.device.name} に接続しました`);
  } catch (error) {
    state.loading = undefined;
    notify(String(error), "error");
  }
}

async function assignKey(option: KeycodeOption): Promise<void> {
  const key = state.selected;
  const keyboard = state.keyboard;
  if (!key || !keyboard) {
    notify("先に変更するキーを選択してください", "error");
    return;
  }
  const isEncoder = key.encoderIndex !== undefined && key.encoderDirection !== undefined;
  const isMatrixKey = key.row !== undefined && key.col !== undefined;
  if (!isEncoder && !isMatrixKey) {
    notify("この位置には割り当てできません", "error");
    return;
  }
  const oldValue = keyValue(key);
  if (isEncoder) {
    keyboard.encoders[state.layer][key.encoderIndex!][key.encoderDirection!] = option.code;
  } else {
    keyboard.keymap[state.layer][key.row!][key.col!] = option.code;
  }
  render();
  try {
    if (keyboard.device.transport !== "Demo") {
      if (isEncoder) {
        await invoke("set_encoder", {
          layer: state.layer,
          index: key.encoderIndex,
          direction: key.encoderDirection,
          keycode: option.code,
        });
      } else {
        await invoke("set_key", {
          layer: state.layer,
          row: key.row,
          col: key.col,
          keycode: option.code,
        });
      }
    }
    notify(`${option.label} を割り当てました`);
  } catch (error) {
    if (isEncoder) {
      keyboard.encoders[state.layer][key.encoderIndex!][key.encoderDirection!] = oldValue;
    } else {
      keyboard.keymap[state.layer][key.row!][key.col!] = oldValue;
    }
    notify(`書き込みに失敗しました: ${String(error)}`, "error");
  }
}

async function saveCombo(
  nextEntry: [number, number, number, number, number],
  successMessage: string,
): Promise<void> {
  const keyboard = state.keyboard;
  if (!keyboard || !keyboard.combos[state.comboIndex]) return;
  const index = state.comboIndex;
  const previous = [...keyboard.combos[index]] as [number, number, number, number, number];
  keyboard.combos[index] = nextEntry;
  render();
  try {
    if (keyboard.device.transport !== "Demo") {
      await invoke("set_combo", { index, entry: nextEntry });
    }
    notify(successMessage);
  } catch (error) {
    keyboard.combos[index] = previous;
    notify(`コンボの書き込みに失敗しました: ${String(error)}`, "error");
  }
}

async function assignComboKey(option: KeycodeOption): Promise<void> {
  const keyboard = state.keyboard;
  const current = keyboard?.combos[state.comboIndex];
  if (!keyboard || !current) {
    notify("変更するコンボを選択してください", "error");
    return;
  }
  const next = [...current] as [number, number, number, number, number];
  next[state.comboField] = option.code;
  await saveCombo(next, `${option.label} をCombo ${state.comboIndex + 1}に割り当てました`);
}

async function assignComboFromPhysicalKey(key: PhysicalKey): Promise<void> {
  const keyboard = state.keyboard;
  if (!keyboard || key.row === undefined || key.col === undefined) return;
  const keycode = keyboard.keymap[state.layer]?.[key.row]?.[key.col] ?? 0;
  if (keycode === 0) {
    notify("未割り当てのキーはコンボに使用できません", "error");
    return;
  }
  const option = availableKeycodes(keyboard).find((candidate) => candidate.code === keycode) ?? {
    code: keycode,
    id: `0x${keycode.toString(16).padStart(4, "0")}`,
    label: displayKeycode(keycode),
    category: "basic",
  } satisfies KeycodeOption;
  await assignComboKey(option);
}

async function ensureCombosLoaded(): Promise<boolean> {
  const keyboard = state.keyboard;
  if (!keyboard) return false;
  if (keyboard.combosLoaded || keyboard.comboCount === 0) return true;
  state.notice = { kind: "success", text: `${keyboard.comboCount}枠のコンボ設定を読み込んでいます…` };
  render();
  try {
    keyboard.combos = await invoke<Array<[number, number, number, number, number]>>("load_combos");
    keyboard.combosLoaded = true;
    if (keyboard.combos.length !== keyboard.comboCount) {
      throw new Error(`コンボ数が一致しません (${keyboard.combos.length}/${keyboard.comboCount})`);
    }
    state.notice = undefined;
    return true;
  } catch (error) {
    state.notice = { kind: "error", text: `コンボの読み込みに失敗しました: ${String(error)}` };
    render();
    return false;
  }
}

async function ensureMacrosLoaded(): Promise<boolean> {
  const keyboard = state.keyboard;
  if (!keyboard) return false;
  if (keyboard.macrosLoaded) return true;
  state.notice = { kind: "success", text: `${keyboard.macroCount}個のマクロを読み込んでいます…` };
  render();
  try {
    keyboard.macroBuffer = await invoke<number[]>("load_macros");
    keyboard.macrosLoaded = true;
    state.macroSavedBuffer = [...keyboard.macroBuffer];
    state.macros = deserializeMacros(keyboard.macroBuffer, keyboard.macroCount);
    state.notice = undefined;
    return true;
  } catch (error) {
    state.notice = { kind: "error", text: `マクロの読み込みに失敗しました: ${String(error)}` };
    render();
    return false;
  }
}

async function ensureQmkSettingsLoaded(): Promise<boolean> {
  const keyboard = state.keyboard;
  if (!keyboard) return false;
  if (!keyboard.qmkSettingsSupported) return true;
  if (keyboard.qmkSettingsLoaded) {
    if (Object.keys(state.qmkSavedValues).length === 0) syncQmkState(keyboard);
    return true;
  }
  state.notice = { kind: "success", text: "QMK詳細設定を読み込んでいます…" };
  render();
  try {
    keyboard.qmkSettings = await invoke<QmkSettingRaw[]>("load_qmk_settings");
    keyboard.qmkSettingsLoaded = true;
    syncQmkState(keyboard);
    state.notice = undefined;
    return true;
  } catch (error) {
    state.notice = { kind: "error", text: `QMK詳細設定の読み込みに失敗しました: ${String(error)}` };
    render();
    return false;
  }
}

function updateQmkSnapshot(keyboard: KeyboardSnapshot): void {
  keyboard.qmkSettings = Object.entries(state.qmkSavedValues).map(([rawId, value]) => {
    const id = Number(rawId);
    const width = qmkField(id)?.width ?? 1;
    return { id, data: qmkBytes(value, width) };
  }).sort((left, right) => left.id - right.id);
}

async function saveQmkSettings(): Promise<void> {
  const keyboard = state.keyboard;
  if (!keyboard) return;
  const changes = QMK_SETTING_FIELDS.filter(
    (field) => state.qmkValues[field.id] !== undefined
      && state.qmkValues[field.id] !== state.qmkSavedValues[field.id],
  );
  if (changes.length === 0) return;
  state.qmkBusy = true;
  render();
  try {
    if (keyboard.device.transport !== "Demo") {
      for (const field of changes) {
        await invoke("set_qmk_setting", {
          id: field.id,
          data: qmkBytes(state.qmkValues[field.id], field.width),
        });
      }
    }
    state.qmkSavedValues = { ...state.qmkValues };
    updateQmkSnapshot(keyboard);
    state.qmkBusy = false;
    notify(`${changes.length}項目のQMK設定を本体へ保存しました`);
  } catch (error) {
    state.qmkBusy = false;
    notify(`QMK設定の保存に失敗しました。再接続して状態を確認してください: ${String(error)}`, "error");
  }
}

async function resetQmkSettings(): Promise<void> {
  const keyboard = state.keyboard;
  if (!keyboard) return;
  state.qmkBusy = true;
  render();
  try {
    if (keyboard.device.transport === "Demo") {
      keyboard.qmkSettings = browserDemo().qmkSettings;
    } else {
      keyboard.qmkSettings = await invoke<QmkSettingRaw[]>("reset_qmk_settings");
    }
    keyboard.qmkSettingsLoaded = true;
    syncQmkState(keyboard);
    state.qmkResetConfirm = false;
    state.qmkBusy = false;
    notify("QMK詳細設定を初期値へ戻しました");
  } catch (error) {
    state.qmkBusy = false;
    state.qmkResetConfirm = false;
    notify(`QMK設定の初期化に失敗しました: ${String(error)}`, "error");
  }
}

function demoFirmwarePackage(): FirmwarePackageInfo {
  return {
    packageName: "Cornix-V1.13.zip",
    version: "v1.13",
    left: {
      name: "cornix-left-v1.13.uf2",
      side: "left",
      size: 267264,
      blocks: 522,
      payloadBytes: 133632,
      addressStart: 0x1000,
      addressEnd: 0x21a00,
      familyId: "ADA52840",
    },
    right: {
      name: "cornix-right-v1.13.uf2",
      side: "right",
      size: 265728,
      blocks: 519,
      payloadBytes: 132864,
      addressStart: 0x1000,
      addressEnd: 0x21700,
      familyId: "ADA52840",
    },
    warnings: [],
  };
}

async function loadFirmwareFiles(files: File[]): Promise<void> {
  if (files.length === 0) return;
  state.firmwareBusy = true;
  render();
  try {
    if (!isTauri) {
      state.firmwarePackage = demoFirmwarePackage();
    } else {
      const uploads = await Promise.all(files.map(async (file) => ({
        name: file.name,
        data: Array.from(new Uint8Array(await file.arrayBuffer())),
      })));
      state.firmwarePackage = await invoke<FirmwarePackageInfo>("validate_firmware_package", { uploads });
    }
    state.firmwareStage = "prepare";
    state.firmwareAcknowledgedPairing = false;
    state.firmwareAcknowledgedBothSides = false;
    state.firmwareCompleted = { left: false, right: false };
    state.firmwareBusy = false;
    notify("左右のUF2を検証しました");
  } catch (error) {
    state.firmwarePackage = undefined;
    state.firmwareStage = "select";
    state.firmwareBusy = false;
    notify(`ファームウェアを使用できません: ${String(error)}`, "error");
  }
}

async function clearFirmwarePackage(): Promise<void> {
  if (isTauri) {
    try {
      await invoke("clear_firmware_package");
    } catch (error) {
      notify(`ファームウェア情報を破棄できません: ${String(error)}`, "error");
      return;
    }
  }
  state.firmwarePackage = undefined;
  state.firmwareStage = "select";
  state.firmwareBootloaders = [];
  state.firmwareSelectedRoot = undefined;
  state.firmwareFlashConfirm = false;
  render();
}

async function prepareFirmwareUpdate(): Promise<void> {
  const keyboard = state.keyboard;
  if (!keyboard || !state.firmwarePackage) return;
  state.firmwareBusy = true;
  render();
  try {
    state.firmwareBackupPath = keyboard.device.transport === "Demo"
      ? "デモのため作成なし"
      : await invoke<string>("save_backup_file", {
          content: JSON.stringify(createBackup(keyboard), null, 2),
          automatic: true,
        });
    state.firmwareStage = "left";
    state.firmwareBusy = false;
    await scanFirmwareVolumes();
  } catch (error) {
    state.firmwareBusy = false;
    notify(`更新前バックアップを作成できません: ${String(error)}`, "error");
  }
}

async function scanFirmwareVolumes(): Promise<void> {
  state.firmwareBusy = true;
  render();
  try {
    state.firmwareBootloaders = isTauri
      ? await invoke<BootloaderVolume[]>("list_firmware_bootloaders")
      : [{
          root: "E:\\",
          boardId: "nRF52840-Cornix-Demo",
          description: "UF2 Bootloader Demo",
        }];
    state.firmwareSelectedRoot = state.firmwareBootloaders.length === 1
      ? state.firmwareBootloaders[0].root
      : state.firmwareBootloaders.some((volume) => volume.root === state.firmwareSelectedRoot)
        ? state.firmwareSelectedRoot
        : undefined;
    state.firmwareBusy = false;
    render();
  } catch (error) {
    state.firmwareBusy = false;
    notify(`ブートドライブを検出できません: ${String(error)}`, "error");
  }
}

async function flashFirmwareSide(): Promise<void> {
  const stage = state.firmwareStage;
  const root = state.firmwareSelectedRoot;
  if ((stage !== "left" && stage !== "right") || !root) return;
  state.firmwareBusy = true;
  render();
  try {
    const result: FirmwareFlashResult = isTauri
      ? await invoke<FirmwareFlashResult>("flash_firmware_side", { side: stage, root })
      : {
          side: stage,
          bytesWritten: state.firmwarePackage?.[stage].size ?? 0,
          drive: root,
          driveDisconnected: true,
        };
    state.firmwareCompleted[stage] = true;
    state.firmwareFlashConfirm = false;
    state.firmwareBootloaders = [];
    state.firmwareSelectedRoot = undefined;
    state.firmwareStage = stage === "left" ? "right" : "done";
    state.firmwareBusy = false;
    notify(`${stage === "left" ? "左手" : "右手"}へ${formatBytes(result.bytesWritten)}を書き込みました`);
  } catch (error) {
    state.firmwareBusy = false;
    state.firmwareFlashConfirm = false;
    notify(`ファームウェアの書き込みに失敗しました: ${String(error)}`, "error");
  }
}

function addMacroAction(type: MacroAction["type"]): void {
  const actions = state.macros[state.macroIndex];
  if (!actions) return;
  const action: MacroAction = type === "text"
    ? { type: "text", text: "" }
    : type === "delay"
      ? { type: "delay", duration: 100 }
      : { type, keycode: 0x0004 };
  actions.push(action);
  state.selectedMacroAction = actions.length - 1;
  if (["tap", "down", "up"].includes(type)) state.category = "basic";
  render();
}

function changeMacroActionType(index: number, type: MacroAction["type"]): void {
  const actions = state.macros[state.macroIndex];
  if (!actions?.[index]) return;
  actions[index] = type === "text"
    ? { type: "text", text: "" }
    : type === "delay"
      ? { type: "delay", duration: 100 }
      : { type, keycode: 0x0004 };
  state.selectedMacroAction = ["tap", "down", "up"].includes(type) ? index : undefined;
  if (state.selectedMacroAction !== undefined) state.category = "basic";
  render();
}

function assignMacroKey(option: KeycodeOption): void {
  const index = state.selectedMacroAction;
  const action = index === undefined ? undefined : state.macros[state.macroIndex]?.[index];
  if (!action || !["tap", "down", "up"].includes(action.type)) {
    notify("先にキー操作を選択してください", "error");
    return;
  }
  (action as Extract<MacroAction, { type: "tap" | "down" | "up" }>).keycode = option.code;
  render();
}

async function saveMacros(): Promise<void> {
  const keyboard = state.keyboard;
  if (!keyboard) return;
  let buffer: number[];
  try {
    buffer = macroBuffer();
    if (buffer.length > keyboard.macroMemory) {
      throw new Error(`容量を${buffer.length - keyboard.macroMemory} bytes超えています`);
    }
  } catch (error) {
    notify(String(error), "error");
    return;
  }
  state.macroBusy = true;
  render();
  try {
    if (keyboard.device.transport !== "Demo") {
      await invoke("set_macros", { buffer });
    }
    keyboard.macroBuffer = [...buffer];
    state.macroSavedBuffer = [...buffer];
    state.macroBusy = false;
    notify("マクロをキーボード本体へ保存しました");
  } catch (error) {
    state.macroBusy = false;
    notify(`マクロの保存に失敗しました: ${String(error)}`, "error");
  }
}

function createBackup(keyboard: KeyboardSnapshot): CornixBackup {
  return {
    format: "cornix-studio-backup",
    version: 1,
    createdAt: new Date().toISOString(),
    metadata: {
      uid: keyboard.uid,
      name: keyboard.device.name,
      vendorId: keyboard.device.vendorId,
      productId: keyboard.device.productId,
      viaProtocol: keyboard.viaProtocol,
      vialProtocol: keyboard.vialProtocol,
      layers: keyboard.layers,
      rows: keyboard.rows,
      cols: keyboard.cols,
      encoderCount: keyboard.encoders[0]?.length ?? 0,
      comboCount: keyboard.comboCount,
      macroCount: keyboard.macroCount,
      macroMemory: keyboard.macroMemory,
    },
    keymap: keyboard.keymap.map((layer) => layer.map((row) => [...row])),
    encoders: keyboard.encoders.map((layer) =>
      layer.map((encoder) => [...encoder] as [number, number])),
    combos: keyboard.combos.map((combo) =>
      [...combo] as [number, number, number, number, number]),
    macroBuffer: [...keyboard.macroBuffer],
    qmkSettings: keyboard.qmkSettings.map((setting) => ({
      id: setting.id,
      data: [...setting.data],
    })),
  };
}

function keycode(value: unknown, path: string, fallback?: number): number {
  if (value === -1 && fallback !== undefined) return fallback;
  if (!Number.isInteger(value) || Number(value) < 0 || Number(value) > 0xffff) {
    throw new Error(`${path} に不正なキーコードがあります`);
  }
  return Number(value);
}

function normalizeKeymap(
  value: unknown,
  keyboard: KeyboardSnapshot,
  vialFormat: boolean,
): number[][][] {
  if (!Array.isArray(value) || value.length !== keyboard.layers) {
    throw new Error(`レイヤー数が一致しません（必要: ${keyboard.layers}）`);
  }
  return value.map((layer, layerIndex) => {
    if (!Array.isArray(layer) || layer.length !== keyboard.rows) {
      throw new Error(`Layer ${layerIndex} の行数が一致しません`);
    }
    return layer.map((row, rowIndex) => {
      if (!Array.isArray(row) || row.length !== keyboard.cols) {
        throw new Error(`Layer ${layerIndex} 行${rowIndex}の列数が一致しません`);
      }
      return row.map((code, colIndex) => keycode(
        code,
        `Layer ${layerIndex} ${rowIndex},${colIndex}`,
        vialFormat ? keyboard.keymap[layerIndex][rowIndex][colIndex] : undefined,
      ));
    });
  });
}

function normalizeEncoders(
  value: unknown,
  keyboard: KeyboardSnapshot,
  vialFormat: boolean,
): Array<Array<[number, number]>> {
  const encoderCount = keyboard.encoders[0]?.length ?? 0;
  if (!Array.isArray(value) || value.length !== keyboard.layers) {
    throw new Error("エンコーダーのレイヤー数が一致しません");
  }
  return value.map((layer, layerIndex) => {
    if (!Array.isArray(layer) || layer.length !== encoderCount) {
      throw new Error(`Layer ${layerIndex} のエンコーダー数が一致しません`);
    }
    return layer.map((encoder, index) => {
      if (!Array.isArray(encoder) || encoder.length !== 2) {
        throw new Error(`Layer ${layerIndex} のエンコーダー${index}が不正です`);
      }
      return [
        keycode(encoder[0], `Encoder ${layerIndex}/${index}/0`, vialFormat ? keyboard.encoders[layerIndex][index][0] : undefined),
        keycode(encoder[1], `Encoder ${layerIndex}/${index}/1`, vialFormat ? keyboard.encoders[layerIndex][index][1] : undefined),
      ];
    });
  });
}

function normalizeCombos(
  value: unknown,
  keyboard: KeyboardSnapshot,
  vialFormat: boolean,
): Array<[number, number, number, number, number]> {
  if (!Array.isArray(value) || (!vialFormat && value.length !== keyboard.comboCount) || value.length > keyboard.comboCount) {
    throw new Error(`コンボ数が一致しません（必要: ${keyboard.comboCount}）`);
  }
  const combos = Array.from({ length: keyboard.comboCount }, (_, index) =>
    [...(keyboard.combos[index] ?? [0, 0, 0, 0, 0])] as [number, number, number, number, number]);
  value.forEach((entry, index) => {
    if (!Array.isArray(entry) || entry.length !== 5) {
      throw new Error(`Combo ${index + 1}の形式が不正です`);
    }
    combos[index] = entry.map((code, field) =>
      keycode(code, `Combo ${index + 1}/${field}`, vialFormat ? combos[index][field] : undefined),
    ) as [number, number, number, number, number];
  });
  return combos;
}

function normalizeMacroBuffer(value: unknown, keyboard: KeyboardSnapshot): number[] {
  if (!Array.isArray(value) || value.length > keyboard.macroMemory) {
    throw new Error(`マクロ容量が不正です（最大: ${keyboard.macroMemory} bytes）`);
  }
  const buffer = value.map((byte, index) => {
    if (!Number.isInteger(byte) || Number(byte) < 0 || Number(byte) > 255) {
      throw new Error(`マクロの${index}バイト目が不正です`);
    }
    return Number(byte);
  });
  if (buffer.at(-1) !== 0 || buffer.filter((byte) => byte === 0).length !== keyboard.macroCount) {
    throw new Error(`マクロ数が一致しません（必要: ${keyboard.macroCount}）`);
  }
  return buffer;
}

function normalizeQmkSettings(
  value: unknown,
  keyboard: KeyboardSnapshot,
  vialFormat: boolean,
): QmkSettingRaw[] {
  const supported = new Map(keyboard.qmkSettings.map((setting) => [
    setting.id,
    { id: setting.id, data: [...setting.data] },
  ]));
  if (value === undefined || value === null) return [...supported.values()];

  if (vialFormat) {
    if (typeof value !== "object" || Array.isArray(value)) {
      throw new Error("VialのQMK設定形式が不正です");
    }
    for (const [rawId, rawValue] of Object.entries(value as Record<string, unknown>)) {
      const id = Number(rawId);
      const current = supported.get(id);
      const field = qmkField(id);
      if (!current || !field) continue;
      const numeric = typeof rawValue === "boolean" ? Number(rawValue) : Number(rawValue);
      if (!Number.isInteger(numeric)) throw new Error(`QMK設定 ID ${id} の値が不正です`);
      if (numeric < (field.min ?? 0) || numeric > (field.max ?? 0xffffffff)) {
        throw new Error(`QMK設定 ID ${id} が範囲外です`);
      }
      if (field.type === "boolean" && numeric !== 0 && numeric !== 1) {
        throw new Error(`QMK設定 ID ${id} のオン・オフ値が不正です`);
      }
      current.data = qmkBytes(numeric, field.width);
    }
    return [...supported.values()].sort((left, right) => left.id - right.id);
  }

  if (!Array.isArray(value)) throw new Error("QMK設定の形式が不正です");
  const seen = new Set<number>();
  for (const rawSetting of value) {
    if (!rawSetting || typeof rawSetting !== "object") throw new Error("QMK設定の項目が不正です");
    const setting = rawSetting as Record<string, unknown>;
    const id = Number(setting.id);
    if (!Number.isInteger(id) || !supported.has(id) || seen.has(id)) {
      throw new Error(`QMK設定 ID ${String(setting.id)} はこのCornixでは利用できません`);
    }
    if (!Array.isArray(setting.data) || setting.data.length < 1 || setting.data.length > 4
      || setting.data.some((byte) => !Number.isInteger(byte) || Number(byte) < 0 || Number(byte) > 255)) {
      throw new Error(`QMK設定 ID ${id} のデータが不正です`);
    }
    const field = qmkField(id);
    if (field) {
      const numeric = qmkValue({ id, data: setting.data.map(Number) }, field.width);
      if (numeric < (field.min ?? 0) || numeric > (field.max ?? 0xffffffff)) {
        throw new Error(`QMK設定 ID ${id} が範囲外です`);
      }
      if (field.type === "boolean" && numeric !== 0 && numeric !== 1) {
        throw new Error(`QMK設定 ID ${id} のオン・オフ値が不正です`);
      }
    }
    supported.set(id, { id, data: setting.data.map(Number) });
    seen.add(id);
  }
  return [...supported.values()].sort((left, right) => left.id - right.id);
}

function normalizeVialMacros(value: unknown, keyboard: KeyboardSnapshot): number[] {
  if (!Array.isArray(value)) return [...keyboard.macroBuffer];
  const aliases: Record<string, string> = {
    KC_ENTER: "KC_ENT",
    KC_ESCAPE: "KC_ESC",
    KC_BSPACE: "KC_BSPC",
    KC_SPACE: "KC_SPC",
    KC_LCTRL: "KC_LCTL",
    KC_RCTRL: "KC_RCTL",
  };
  const options = [...KEYCODES, ...JIS_KEYCODES, ...macroKeycodes(keyboard), ...customKeycodes(keyboard)];
  const macros = Array.from({ length: keyboard.macroCount }, () => [] as MacroAction[]);
  value.slice(0, keyboard.macroCount).forEach((macro, macroIndex) => {
    if (!Array.isArray(macro)) throw new Error(`Vial Macro ${macroIndex}の形式が不正です`);
    for (const rawAction of macro) {
      if (!Array.isArray(rawAction) || typeof rawAction[0] !== "string") {
        throw new Error(`Vial Macro ${macroIndex}のアクションが不正です`);
      }
      const type = rawAction[0];
      if (type === "text") {
        macros[macroIndex].push({ type: "text", text: String(rawAction[1] ?? "") });
      } else if (type === "delay") {
        macros[macroIndex].push({ type: "delay", duration: Number(rawAction[1] ?? 0) });
      } else if (["tap", "down", "up"].includes(type)) {
        for (const rawId of rawAction.slice(1)) {
          const id = aliases[String(rawId)] ?? String(rawId);
          const option = options.find((candidate) => candidate.id === id);
          if (!option) throw new Error(`Vialマクロのキーコード ${String(rawId)} は未対応です`);
          macros[macroIndex].push({
            type: type as "tap" | "down" | "up",
            keycode: option.code,
          });
        }
      }
    }
  });
  const buffer = serializeMacros(macros, keyboard.macroCount);
  if (buffer.length > keyboard.macroMemory) {
    throw new Error(`Vialマクロが容量を${buffer.length - keyboard.macroMemory} bytes超えています`);
  }
  return buffer;
}

function normalizeBackup(
  raw: unknown,
  keyboard: KeyboardSnapshot,
  file: File,
): { backup: CornixBackup; source: RestorePreview["source"] } {
  if (!raw || typeof raw !== "object") throw new Error("JSONの内容が不正です");
  const data = raw as Record<string, unknown>;
  if (data.format === "cornix-studio-backup" && data.version === 1) {
    const metadata = data.metadata as Record<string, unknown> | undefined;
    if (!metadata) throw new Error("機種情報がありません");
    if (metadata.uid !== keyboard.uid) throw new Error("別のキーボード用のバックアップです");
    if (metadata.layers !== keyboard.layers || metadata.rows !== keyboard.rows || metadata.cols !== keyboard.cols) {
      throw new Error("レイヤー数または行列サイズが接続中のCornixと異なります");
    }
    if (metadata.encoderCount !== (keyboard.encoders[0]?.length ?? 0)
      || metadata.comboCount !== keyboard.comboCount) {
      throw new Error("エンコーダー数またはコンボ数が接続中のCornixと異なります");
    }
    if ((metadata.macroCount !== undefined && metadata.macroCount !== keyboard.macroCount)
      || (metadata.macroMemory !== undefined && metadata.macroMemory !== keyboard.macroMemory)) {
      throw new Error("マクロ数または保存容量が接続中のCornixと異なります");
    }
    return {
      source: "Cornix Studio",
      backup: {
        format: "cornix-studio-backup",
        version: 1,
        createdAt: typeof data.createdAt === "string" ? data.createdAt : new Date(file.lastModified).toISOString(),
        metadata: {
          uid: keyboard.uid,
          name: String(metadata.name ?? keyboard.device.name),
          vendorId: Number(metadata.vendorId ?? keyboard.device.vendorId),
          productId: Number(metadata.productId ?? keyboard.device.productId),
          viaProtocol: Number(metadata.viaProtocol ?? keyboard.viaProtocol),
          vialProtocol: Number(metadata.vialProtocol ?? keyboard.vialProtocol),
          layers: keyboard.layers,
          rows: keyboard.rows,
          cols: keyboard.cols,
          encoderCount: keyboard.encoders[0]?.length ?? 0,
          comboCount: keyboard.comboCount,
          macroCount: keyboard.macroCount,
          macroMemory: keyboard.macroMemory,
        },
        keymap: normalizeKeymap(data.keymap, keyboard, false),
        encoders: normalizeEncoders(data.encoders, keyboard, false),
        combos: normalizeCombos(data.combos, keyboard, false),
        macroBuffer: data.macroBuffer === undefined
          ? [...keyboard.macroBuffer]
          : normalizeMacroBuffer(data.macroBuffer, keyboard),
        qmkSettings: normalizeQmkSettings(data.qmkSettings, keyboard, false),
      },
    };
  }
  if (data.version === 1 && Array.isArray(data.layout)) {
    return {
      source: "Vial .vil",
      backup: {
        ...createBackup(keyboard),
        createdAt: new Date(file.lastModified).toISOString(),
        keymap: normalizeKeymap(data.layout, keyboard, true),
        encoders: normalizeEncoders(data.encoder_layout, keyboard, true),
        combos: normalizeCombos(data.combo ?? [], keyboard, true),
        macroBuffer: normalizeVialMacros(data.macro, keyboard),
        qmkSettings: normalizeQmkSettings(data.settings, keyboard, true),
      },
    };
  }
  throw new Error("Cornix StudioまたはVialの設定ファイルではありません");
}

function createRestoreRequest(backup: CornixBackup, keyboard: KeyboardSnapshot): RestoreRequest {
  const request: RestoreRequest = {
    uid: keyboard.uid,
    layers: keyboard.layers,
    rows: keyboard.rows,
    cols: keyboard.cols,
    encoderCount: keyboard.encoders[0]?.length ?? 0,
    comboCount: keyboard.comboCount,
    keys: [],
    encoders: [],
    combos: [],
    qmkSettings: [],
  };
  backup.keymap.forEach((layer, layerIndex) =>
    layer.forEach((row, rowIndex) =>
      row.forEach((code, colIndex) => {
        if (code !== keyboard.keymap[layerIndex][rowIndex][colIndex]) {
          request.keys.push({ layer: layerIndex, row: rowIndex, col: colIndex, keycode: code });
        }
      })));
  backup.encoders.forEach((layer, layerIndex) =>
    layer.forEach((encoder, index) =>
      encoder.forEach((code, direction) => {
        if (code !== keyboard.encoders[layerIndex][index][direction]) {
          request.encoders.push({ layer: layerIndex, index, direction, keycode: code });
        }
      })));
  backup.combos.forEach((entry, index) => {
    if (entry.some((code, field) => code !== keyboard.combos[index][field])) {
      request.combos.push({ index, entry });
    }
  });
  if (backup.macroBuffer.length !== keyboard.macroBuffer.length
    || backup.macroBuffer.some((byte, index) => byte !== keyboard.macroBuffer[index])) {
    request.macroBuffer = [...backup.macroBuffer];
  }
  const currentSettings = new Map(keyboard.qmkSettings.map((setting) => [setting.id, setting]));
  for (const setting of backup.qmkSettings) {
    const current = currentSettings.get(setting.id);
    const width = qmkField(setting.id)?.width ?? setting.data.length;
    const changed = !current || qmkValue(setting, width) !== qmkValue(current, width);
    if (changed) request.qmkSettings.push({ id: setting.id, data: [...setting.data] });
  }
  return request;
}

async function exportBackup(): Promise<void> {
  const keyboard = state.keyboard;
  if (!keyboard || !await ensureCombosLoaded() || !await ensureMacrosLoaded()
    || !await ensureQmkSettingsLoaded()) return;
  const backup = createBackup(keyboard);
  const content = JSON.stringify(backup, null, 2);
  try {
    if (isTauri) {
      const path = await invoke<string>("save_backup_file", { content, automatic: false });
      notify(`バックアップを保存しました: ${path}`);
    } else {
      const url = URL.createObjectURL(new Blob([content], { type: "application/json" }));
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `cornix-backup-${keyboard.uid}.json`;
      anchor.click();
      URL.revokeObjectURL(url);
      notify("デモ設定のバックアップを保存しました");
    }
  } catch (error) {
    notify(`バックアップの保存に失敗しました: ${String(error)}`, "error");
  }
}

async function loadBackupFile(file: File): Promise<void> {
  const keyboard = state.keyboard;
  if (!keyboard || !await ensureCombosLoaded() || !await ensureMacrosLoaded()
    || !await ensureQmkSettingsLoaded()) return;
  state.backupBusy = true;
  render();
  try {
    const normalized = normalizeBackup(JSON.parse(await file.text()), keyboard, file);
    state.restorePreview = {
      backup: normalized.backup,
      request: createRestoreRequest(normalized.backup, keyboard),
      fileName: file.name,
      source: normalized.source,
    };
    state.notice = undefined;
  } catch (error) {
    state.restorePreview = undefined;
    state.notice = { kind: "error", text: `設定ファイルを読み込めません: ${String(error)}` };
  } finally {
    state.backupBusy = false;
    render();
  }
}

async function restoreBackup(): Promise<void> {
  const keyboard = state.keyboard;
  const preview = state.restorePreview;
  if (!keyboard || !preview) return;
  state.backupBusy = true;
  render();
  try {
    let automaticPath = "デモのため作成なし";
    if (keyboard.device.transport !== "Demo") {
      automaticPath = await invoke<string>("save_backup_file", {
        content: JSON.stringify(createBackup(keyboard), null, 2),
        automatic: true,
      });
      await invoke("apply_configuration", { request: preview.request });
    }
    keyboard.keymap = preview.backup.keymap.map((layer) => layer.map((row) => [...row]));
    keyboard.encoders = preview.backup.encoders.map((layer) =>
      layer.map((encoder) => [...encoder] as [number, number]));
    keyboard.combos = preview.backup.combos.map((combo) =>
      [...combo] as [number, number, number, number, number]);
    keyboard.macroBuffer = [...preview.backup.macroBuffer];
    state.macroSavedBuffer = [...preview.backup.macroBuffer];
    state.macros = deserializeMacros(preview.backup.macroBuffer, keyboard.macroCount);
    keyboard.qmkSettings = preview.backup.qmkSettings.map((setting) => ({
      id: setting.id,
      data: [...setting.data],
    }));
    syncQmkState(keyboard);
    const count = preview.request.keys.length + preview.request.encoders.length
      + preview.request.combos.length + (preview.request.macroBuffer ? 1 : 0)
      + preview.request.qmkSettings.length;
    state.restorePreview = undefined;
    state.backupBusy = false;
    notify(`${count}件を復元しました。復元前バックアップ: ${automaticPath}`);
  } catch (error) {
    state.backupBusy = false;
    notify(`復元に失敗しました。再接続して状態を確認してください: ${String(error)}`, "error");
  }
}

async function openPage(page: AppPage): Promise<void> {
  const keyboard = state.keyboard;
  if (!keyboard) return;
  if (state.page === "monitor" && page !== "monitor" && state.monitor.mode !== "detached") {
    await stopMonitor();
  }
  if ((page === "combo" || page === "backup") && !await ensureCombosLoaded()) return;
  if ((page === "macro" || page === "backup") && !await ensureMacrosLoaded()) return;
  if ((page === "qmk" || page === "backup") && !await ensureQmkSettingsLoaded()) return;
  if (page === "firmware"
    && (!await ensureCombosLoaded() || !await ensureMacrosLoaded() || !await ensureQmkSettingsLoaded())) return;
  state.notice = undefined;
  state.page = page;
  state.selected = undefined;
  render();
  if (page === "monitor" && state.monitor.mode !== "detached") void initializeMonitor();
}

function bindEvents(): void {
  document.querySelector("#scan")?.addEventListener("click", scan);
  document.querySelector("#demo")?.addEventListener("click", () => connect());
  document.querySelectorAll<HTMLElement>("[data-page]").forEach((element) =>
    element.addEventListener("click", () => {
      void openPage((element.dataset.page as AppPage) ?? "keymap");
    }));
  document.querySelectorAll<HTMLElement>("[data-connect]").forEach((element) =>
    element.addEventListener("click", () => connect(element.dataset.connect)));
  document.querySelector("#start-monitor-unlock")?.addEventListener("click", () => {
    void startMonitorUnlock();
  });
  document.querySelector("#open-live-overlay")?.addEventListener("click", () => {
    void openLiveOverlay();
  });
  document.querySelector("#stop-monitor")?.addEventListener("click", () => {
    void stopMonitor();
  });
  document.querySelector("#retry-monitor")?.addEventListener("click", () => {
    void initializeMonitor();
  });
  document.querySelector("#disconnect")?.addEventListener("click", async () => {
    await stopMonitor();
    if (isTauri) {
      await invoke("clear_firmware_package");
      await invoke("disconnect");
    }
    state.keyboard = undefined;
    state.page = "keymap";
    resetMonitorState();
    state.selected = undefined;
    state.restorePreview = undefined;
    state.macros = [];
    state.macroSavedBuffer = [];
    state.qmkValues = {};
    state.qmkSavedValues = {};
    state.qmkResetConfirm = false;
    state.firmwarePackage = undefined;
    state.firmwareStage = "select";
    state.firmwareBootloaders = [];
    state.firmwareSelectedRoot = undefined;
    state.firmwareFlashConfirm = false;
    state.firmwareBackupPath = undefined;
    state.firmwareCompleted = { left: false, right: false };
    await scan();
  });
  document.querySelector<HTMLInputElement>("#firmware-file")?.addEventListener("change", (event) => {
    const files = Array.from((event.target as HTMLInputElement).files ?? []);
    if (files.length) void loadFirmwareFiles(files);
  });
  document.querySelector("#firmware-demo-package")?.addEventListener("click", () => {
    state.firmwarePackage = demoFirmwarePackage();
    state.firmwareStage = "prepare";
    render();
  });
  document.querySelector("#change-firmware-package")?.addEventListener("click", () => {
    void clearFirmwarePackage();
  });
  document.querySelector<HTMLInputElement>("#ack-firmware-pairing")?.addEventListener("change", (event) => {
    state.firmwareAcknowledgedPairing = (event.target as HTMLInputElement).checked;
    render();
  });
  document.querySelector<HTMLInputElement>("#ack-firmware-sides")?.addEventListener("change", (event) => {
    state.firmwareAcknowledgedBothSides = (event.target as HTMLInputElement).checked;
    render();
  });
  document.querySelector("#prepare-firmware")?.addEventListener("click", () => {
    void prepareFirmwareUpdate();
  });
  document.querySelector("#scan-firmware-volumes")?.addEventListener("click", () => {
    void scanFirmwareVolumes();
  });
  document.querySelectorAll<HTMLElement>("[data-firmware-volume]").forEach((element) =>
    element.addEventListener("click", () => {
      state.firmwareSelectedRoot = element.dataset.firmwareVolume;
      state.firmwareFlashConfirm = false;
      render();
    }));
  document.querySelector("#start-firmware-flash")?.addEventListener("click", () => {
    state.firmwareFlashConfirm = true;
    render();
  });
  document.querySelector("#cancel-firmware-flash")?.addEventListener("click", () => {
    state.firmwareFlashConfirm = false;
    render();
  });
  document.querySelector("#confirm-firmware-flash")?.addEventListener("click", () => {
    void flashFirmwareSide();
  });
  document.querySelector("#finish-firmware-update")?.addEventListener("click", async () => {
    if (isTauri) {
      await invoke("clear_firmware_package");
      await invoke("disconnect");
    }
    state.keyboard = undefined;
    state.page = "keymap";
    resetMonitorState();
    state.firmwarePackage = undefined;
    state.firmwareStage = "select";
    state.firmwareBootloaders = [];
    state.firmwareBackupPath = undefined;
    await scan();
  });
  document.querySelector("#export-backup")?.addEventListener("click", () => {
    void exportBackup();
  });
  document.querySelector<HTMLInputElement>("#backup-file")?.addEventListener("change", (event) => {
    const file = (event.target as HTMLInputElement).files?.[0];
    if (file) void loadBackupFile(file);
  });
  document.querySelector("#cancel-restore")?.addEventListener("click", () => {
    state.restorePreview = undefined;
    render();
  });
  document.querySelector("#confirm-restore")?.addEventListener("click", () => {
    void restoreBackup();
  });
  document.querySelectorAll<HTMLElement>("[data-macro-index]").forEach((element) =>
    element.addEventListener("click", () => {
      state.macroIndex = Number(element.dataset.macroIndex);
      state.selectedMacroAction = undefined;
      render();
    }));
  document.querySelectorAll<HTMLSelectElement>("[data-macro-type]").forEach((element) =>
    element.addEventListener("change", () => {
      changeMacroActionType(Number(element.dataset.macroType), element.value as MacroAction["type"]);
    }));
  document.querySelectorAll<HTMLTextAreaElement>("[data-macro-text]").forEach((element) =>
    element.addEventListener("input", () => {
      const action = state.macros[state.macroIndex]?.[Number(element.dataset.macroText)];
      if (action?.type === "text") action.text = element.value;
    }));
  document.querySelectorAll<HTMLTextAreaElement>("[data-macro-text]").forEach((element) =>
    element.addEventListener("change", render));
  document.querySelectorAll<HTMLInputElement>("[data-macro-delay]").forEach((element) =>
    element.addEventListener("input", () => {
      const action = state.macros[state.macroIndex]?.[Number(element.dataset.macroDelay)];
      if (action?.type === "delay") {
        action.duration = Math.max(0, Math.min(65024, Number(element.value) || 0));
      }
    }));
  document.querySelectorAll<HTMLInputElement>("[data-macro-delay]").forEach((element) =>
    element.addEventListener("change", render));
  document.querySelectorAll<HTMLElement>("[data-macro-select]").forEach((element) =>
    element.addEventListener("click", () => {
      state.selectedMacroAction = Number(element.dataset.macroSelect);
      render();
    }));
  document.querySelectorAll<HTMLElement>("[data-add-macro]").forEach((element) =>
    element.addEventListener("click", () => {
      addMacroAction((element.dataset.addMacro as MacroAction["type"]) ?? "text");
    }));
  document.querySelectorAll<HTMLElement>("[data-macro-remove]").forEach((element) =>
    element.addEventListener("click", () => {
      const index = Number(element.dataset.macroRemove);
      state.macros[state.macroIndex]?.splice(index, 1);
      state.selectedMacroAction = undefined;
      render();
    }));
  document.querySelectorAll<HTMLElement>("[data-macro-move]").forEach((element) =>
    element.addEventListener("click", () => {
      const [index, offset] = (element.dataset.macroMove ?? "").split(",").map(Number);
      const actions = state.macros[state.macroIndex];
      const target = index + offset;
      if (!actions || target < 0 || target >= actions.length) return;
      [actions[index], actions[target]] = [actions[target], actions[index]];
      state.selectedMacroAction = target;
      render();
    }));
  document.querySelector("#save-macros")?.addEventListener("click", () => {
    void saveMacros();
  });
  document.querySelector("#revert-macros")?.addEventListener("click", () => {
    state.macros = deserializeMacros(state.macroSavedBuffer, state.keyboard?.macroCount ?? 0);
    state.selectedMacroAction = undefined;
    render();
  });
  document.querySelectorAll<HTMLInputElement>("[data-qmk-setting]").forEach((element) =>
    element.addEventListener("input", () => {
      const id = Number(element.dataset.qmkSetting);
      const field = qmkField(id);
      if (!field) return;
      if (field.type === "boolean") {
        state.qmkValues[id] = element.checked ? 1 : 0;
        render();
      } else {
        const value = Number.isFinite(element.valueAsNumber) ? element.valueAsNumber : (field.min ?? 0);
        state.qmkValues[id] = Math.round(Math.max(field.min ?? 0, Math.min(field.max ?? 0xffffffff, value)));
      }
    }));
  document.querySelectorAll<HTMLInputElement>("[data-qmk-setting]").forEach((element) =>
    element.addEventListener("change", () => {
      const id = Number(element.dataset.qmkSetting);
      const field = qmkField(id);
      if (field?.type === "integer") render();
    }));
  document.querySelector("#save-qmk")?.addEventListener("click", () => {
    void saveQmkSettings();
  });
  document.querySelector("#revert-qmk")?.addEventListener("click", () => {
    state.qmkValues = { ...state.qmkSavedValues };
    render();
  });
  document.querySelector("#start-qmk-reset")?.addEventListener("click", () => {
    state.qmkResetConfirm = true;
    render();
  });
  document.querySelector("#cancel-qmk-reset")?.addEventListener("click", () => {
    state.qmkResetConfirm = false;
    render();
  });
  document.querySelector("#confirm-qmk-reset")?.addEventListener("click", () => {
    void resetQmkSettings();
  });
  document.querySelectorAll<HTMLElement>("[data-layer]").forEach((element) =>
    element.addEventListener("click", () => {
      state.layer = Number(element.dataset.layer);
      state.selected = undefined;
      render();
    }));
  document.querySelectorAll<HTMLElement>("[data-key]").forEach((element) =>
    element.addEventListener("click", () => {
      const key = state.physicalKeys.find((candidate) => candidate.id === element.dataset.key);
      if (!key) return;
      if (state.page === "combo") {
        void assignComboFromPhysicalKey(key);
      } else {
        state.selected = key;
        render();
      }
    }));
  document.querySelectorAll<HTMLElement>("[data-combo-index]").forEach((element) =>
    element.addEventListener("click", () => {
      state.comboIndex = Number(element.dataset.comboIndex);
      state.comboField = 0;
      render();
    }));
  document.querySelectorAll<HTMLElement>("[data-combo-field]").forEach((element) =>
    element.addEventListener("click", () => {
      state.comboField = Number(element.dataset.comboField);
      render();
    }));
  document.querySelector("#clear-combo")?.addEventListener("click", () => {
    void saveCombo([0, 0, 0, 0, 0], `Combo ${state.comboIndex + 1}を無効化しました`);
  });
  document.querySelectorAll<HTMLElement>("[data-category]").forEach((element) =>
    element.addEventListener("click", () => {
      state.category = element.dataset.category ?? "basic";
      render();
    }));
  document.querySelectorAll<HTMLElement>("[data-host-layout]").forEach((element) =>
    element.addEventListener("click", () => {
      state.hostKeyLayout = element.dataset.hostLayout === "jis" ? "jis" : "us";
      localStorage.setItem("cornix-host-key-layout", state.hostKeyLayout);
      render();
    }));
  document.querySelector<HTMLInputElement>("#key-search")?.addEventListener("input", (event) => {
    state.query = (event.target as HTMLInputElement).value;
    render();
    document.querySelector<HTMLInputElement>("#key-search")?.focus();
  });
  document.querySelectorAll<HTMLElement>("[data-code]").forEach((element) =>
    element.addEventListener("click", () => {
      const option = availableKeycodes(state.keyboard).find((key) => key.code === Number(element.dataset.code));
      if (!option) return;
      if (state.page === "combo") {
        void assignComboKey(option);
      } else if (state.page === "macro") {
        assignMacroKey(option);
      } else {
        void assignKey(option);
      }
    }));
}

if (isOverlayWindow) {
  void initializeLiveOverlayWindow();
} else {
  render();
  void scan();
  if (isTauri) {
    void listen("live-overlay-closed", () => {
      localStorage.removeItem(overlayBootstrapKey);
      if (state.monitor.mode !== "detached") return;
      resetMonitorState();
      if (state.page === "monitor") void initializeMonitor();
      else render();
    });
    void listen("live-overlay-ready", () => {
      if (state.monitor.mode !== "active") return;
      resetMonitorState("detached");
      render();
    });
  }
}

let resizeTimer: number | undefined;
window.addEventListener("resize", () => {
  window.clearTimeout(resizeTimer);
  resizeTimer = window.setTimeout(render, 100);
});

window.addEventListener("keydown", (event) => {
  const target = event.target as HTMLElement | null;
  const acceptsText = target?.matches("input, textarea, select, [contenteditable='true']");
  if (state.monitor.mode === "active" && !acceptsText) {
    event.preventDefault();
  }
});
