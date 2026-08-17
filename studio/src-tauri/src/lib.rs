// SPDX-License-Identifier: GPL-2.0-or-later
// Copyright (C) 2026 Ponkan230 and Cornix Studio contributors

mod firmware;
mod protocol;

use hidapi::{BusType, HidApi, HidDevice};
use protocol::*;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::BTreeSet;
use std::env;
use std::ffi::CString;
use std::fs::{self, OpenOptions};
use std::io::{Read, Write};
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use tauri::{Emitter, Manager, State, WebviewUrl, WebviewWindowBuilder};
use xz2::read::XzDecoder;

const LIVE_OVERLAY_LABEL: &str = "live-overlay";

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct DeviceSummary {
    id: String,
    name: String,
    manufacturer: Option<String>,
    serial: Option<String>,
    vendor_id: u16,
    product_id: u16,
    transport: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct KeyboardSnapshot {
    device: DeviceSummary,
    definition: Value,
    via_protocol: u16,
    vial_protocol: u32,
    uid: String,
    layers: u8,
    rows: usize,
    cols: usize,
    keymap: Vec<Vec<Vec<u16>>>,
    encoders: Vec<Vec<[u16; 2]>>,
    combo_count: u8,
    combos_loaded: bool,
    combos: Vec<[u16; 5]>,
    macro_count: u8,
    macro_memory: u16,
    macros_loaded: bool,
    macro_buffer: Vec<u8>,
    qmk_settings_supported: bool,
    qmk_settings_loaded: bool,
    qmk_settings: Vec<QmkSettingRaw>,
}

struct Connection {
    device: HidDevice,
    uid: String,
    vial_protocol: u32,
    layers: u8,
    rows: usize,
    cols: usize,
    encoder_count: usize,
    combo_count: u8,
    macro_count: u8,
    macro_memory: u16,
    qmk_setting_ids: BTreeSet<u16>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct QmkSettingRaw {
    id: u16,
    data: Vec<u8>,
}

#[derive(Clone, Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
struct MatrixPosition {
    row: usize,
    col: usize,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct MonitorStatus {
    supported: bool,
    unlocked: bool,
    unlock_in_progress: bool,
    unlock_keys: Vec<MatrixPosition>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct MonitorUnlockProgress {
    unlocked: bool,
    in_progress: bool,
    remaining: u8,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct MatrixStateSnapshot {
    pressed: Vec<MatrixPosition>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct OverlayBounds {
    x: f64,
    y: f64,
    width: f64,
    height: f64,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct KeyChange {
    layer: u8,
    row: u8,
    col: u8,
    keycode: u16,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct EncoderChange {
    layer: u8,
    index: u8,
    direction: u8,
    keycode: u16,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ComboChange {
    index: u8,
    entry: [u16; 5],
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct QmkSettingChange {
    id: u16,
    data: Vec<u8>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct RestoreRequest {
    uid: String,
    layers: u8,
    rows: usize,
    cols: usize,
    encoder_count: usize,
    combo_count: u8,
    keys: Vec<KeyChange>,
    encoders: Vec<EncoderChange>,
    combos: Vec<ComboChange>,
    macro_buffer: Option<Vec<u8>>,
    qmk_settings: Vec<QmkSettingChange>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct AppliedChanges {
    keys: usize,
    encoders: usize,
    combos: usize,
    macros: usize,
    qmk_settings: usize,
}

#[derive(Default)]
struct AppState {
    connection: Arc<Mutex<Option<Connection>>>,
    firmware_package: Mutex<Option<firmware::ValidatedFirmwarePackage>>,
}

fn transport_name(bus: BusType) -> String {
    match bus {
        BusType::Bluetooth => "Bluetooth",
        BusType::Usb => "USB",
        _ => "Unknown",
    }
    .to_owned()
}

fn summary(info: &hidapi::DeviceInfo) -> DeviceSummary {
    let product = info.product_string().filter(|name| !name.trim().is_empty());
    DeviceSummary {
        id: hex::encode(info.path().to_bytes()),
        name: product.unwrap_or("Vial compatible keyboard").to_owned(),
        manufacturer: info.manufacturer_string().map(str::to_owned),
        serial: info.serial_number().map(str::to_owned),
        vendor_id: info.vendor_id(),
        product_id: info.product_id(),
        transport: transport_name(info.bus_type()),
    }
}

#[tauri::command]
async fn list_devices() -> Result<Vec<DeviceSummary>, String> {
    tauri::async_runtime::spawn_blocking(|| {
        let api = HidApi::new().map_err(|error| error.to_string())?;
        Ok(api
            .device_list()
            .filter(|info| info.usage_page() == RAW_USAGE_PAGE && info.usage() == RAW_USAGE)
            .map(summary)
            .collect())
    })
    .await
    .map_err(|error| error.to_string())?
}

fn exchange(
    device: &HidDevice,
    payload: &[u8],
    retries: usize,
) -> Result<[u8; REPORT_SIZE], String> {
    exchange_with_timeout(device, payload, retries, 900, 90)
}

fn exchange_with_timeout(
    device: &HidDevice,
    payload: &[u8],
    retries: usize,
    read_timeout_ms: i32,
    retry_delay_ms: u64,
) -> Result<[u8; REPORT_SIZE], String> {
    let packet = report(payload)?;
    let mut last_error = String::from("no response from keyboard");
    for attempt in 0..retries {
        if attempt > 0 {
            thread::sleep(Duration::from_millis(retry_delay_ms));
        }
        match device.write(&packet) {
            Ok(written) if written == packet.len() => {}
            Ok(written) => {
                last_error = format!("short HID write: {written}/{}", packet.len());
                continue;
            }
            Err(error) => {
                last_error = error.to_string();
                continue;
            }
        }

        let mut response = [0_u8; REPORT_SIZE];
        match device.read_timeout(&mut response, read_timeout_ms) {
            Ok(read) if read > 0 => return Ok(response),
            Ok(_) => last_error = "keyboard timed out".to_owned(),
            Err(error) => last_error = error.to_string(),
        }
    }
    Err(format!("Vial communication failed: {last_error}"))
}

fn le_u32(bytes: &[u8]) -> u32 {
    u32::from_le_bytes(bytes[..4].try_into().expect("four byte slice"))
}

fn encoder_indices(definition: &Value) -> Vec<u8> {
    fn visit(value: &Value, indices: &mut BTreeSet<u8>) {
        match value {
            Value::Array(items) => {
                for item in items {
                    visit(item, indices);
                }
            }
            Value::String(serialized) => {
                let labels = serialized.split('\n').collect::<Vec<_>>();
                if labels.contains(&"e")
                    && let Some((index, _)) = labels[0].split_once(',')
                    && let Ok(index) = index.parse::<u8>()
                {
                    indices.insert(index);
                }
            }
            _ => {}
        }
    }

    let mut indices = BTreeSet::new();
    if let Some(keymap) = definition.pointer("/layouts/keymap") {
        visit(keymap, &mut indices);
    }
    indices.into_iter().collect()
}

fn monitor_supported(connection: &Connection) -> bool {
    connection.vial_protocol >= VIAL_PROTOCOL_MATRIX_TESTER
        && connection.rows * connection.cols.div_ceil(8) <= BUFFER_CHUNK
}

fn unlock_keys(response: &[u8], rows: usize, cols: usize) -> Vec<MatrixPosition> {
    response[2..]
        .chunks_exact(2)
        .filter_map(|pair| {
            let row = pair[0] as usize;
            let col = pair[1] as usize;
            (row != u8::MAX as usize && col != u8::MAX as usize && row < rows && col < cols)
                .then_some(MatrixPosition { row, col })
        })
        .collect()
}

fn decode_matrix_state(
    response: &[u8],
    rows: usize,
    cols: usize,
) -> Result<Vec<MatrixPosition>, String> {
    let row_size = cols.div_ceil(8);
    let matrix_size = rows
        .checked_mul(row_size)
        .ok_or("matrix dimensions are too large")?;
    if matrix_size > BUFFER_CHUNK || response.len() < matrix_size + 2 {
        return Err("keyboard returned an invalid matrix state".to_owned());
    }

    let mut pressed = Vec::new();
    for row in 0..rows {
        let row_data = &response[2 + row * row_size..2 + (row + 1) * row_size];
        for col in 0..cols {
            let byte = row_size - 1 - col / 8;
            if row_data[byte] & (1 << (col % 8)) != 0 {
                pressed.push(MatrixPosition { row, col });
            }
        }
    }
    Ok(pressed)
}

fn read_combos(device: &HidDevice, combo_count: u8) -> Result<Vec<[u16; 5]>, String> {
    let mut combos = Vec::with_capacity(combo_count as usize);
    for index in 0..combo_count {
        let response = exchange(device, &get_combo(index), 20)?;
        if response[0] != 0 {
            return Err(format!(
                "keyboard rejected combo {} with status {}",
                index + 1,
                response[0]
            ));
        }
        let mut entry = [0_u16; 5];
        for (key, value) in entry.iter_mut().enumerate() {
            let offset = 1 + key * 2;
            *value = u16::from_le_bytes([response[offset], response[offset + 1]]);
        }
        combos.push(entry);
    }
    Ok(combos)
}

fn read_macro_buffer(
    device: &HidDevice,
    macro_count: u8,
    macro_memory: u16,
) -> Result<Vec<u8>, String> {
    if macro_count == 0 || macro_memory == 0 {
        return Ok(Vec::new());
    }
    let mut buffer = Vec::with_capacity(macro_memory as usize);
    for offset in (0..macro_memory as usize).step_by(BUFFER_CHUNK) {
        let size = (macro_memory as usize - offset).min(BUFFER_CHUNK);
        let response = exchange(device, &get_macro_chunk(offset, size)?, 20)?;
        buffer.extend_from_slice(&response[4..4 + size]);
        if buffer.iter().filter(|byte| **byte == 0).count() >= macro_count as usize {
            break;
        }
    }
    if let Some(end) = buffer
        .iter()
        .enumerate()
        .filter(|(_, byte)| **byte == 0)
        .nth(macro_count as usize - 1)
        .map(|(index, _)| index + 1)
    {
        buffer.truncate(end);
    } else {
        let missing = macro_count as usize - buffer.iter().filter(|byte| **byte == 0).count();
        buffer.extend(std::iter::repeat_n(0, missing));
    }
    Ok(buffer)
}

fn read_qmk_settings(device: &HidDevice) -> Result<Vec<QmkSettingRaw>, String> {
    let mut ids = BTreeSet::new();
    let mut cursor = 0_u16;
    for _ in 0..256 {
        let response = exchange(device, &query_qmk_settings(cursor), 20)?;
        let mut reached_end = false;
        let previous_cursor = cursor;
        for chunk in response.chunks_exact(2) {
            let id = u16::from_le_bytes([chunk[0], chunk[1]]);
            if id == u16::MAX {
                reached_end = true;
                break;
            }
            ids.insert(id);
            cursor = cursor.max(id);
        }
        if reached_end {
            break;
        }
        if cursor == previous_cursor {
            return Err("QMK settings query did not advance".to_owned());
        }
    }

    let mut settings = Vec::with_capacity(ids.len());
    for id in ids {
        let response = exchange(device, &get_qmk_setting(id), 20)?;
        if response[0] != 0 {
            return Err(format!(
                "keyboard rejected QMK setting {id} with status {}",
                response[0]
            ));
        }
        settings.push(QmkSettingRaw {
            id,
            data: response[1..5].to_vec(),
        });
    }
    Ok(settings)
}

fn load_keyboard(
    device: &HidDevice,
    device_summary: DeviceSummary,
) -> Result<KeyboardSnapshot, String> {
    let protocol_response = exchange(device, &[CMD_GET_PROTOCOL_VERSION], 6)?;
    let via_protocol = u16::from_be_bytes([protocol_response[1], protocol_response[2]]);

    let id_response = exchange(device, &[CMD_VIAL_PREFIX, CMD_VIAL_GET_KEYBOARD_ID], 10)?;
    let vial_protocol = le_u32(&id_response[0..4]);
    if id_response[4..12].iter().all(|byte| *byte == 0) {
        return Err("This HID interface did not answer as a Vial keyboard".to_owned());
    }
    let uid = id_response[4..12]
        .iter()
        .rev()
        .map(|byte| format!("{byte:02x}"))
        .collect::<String>();

    let size_response = exchange(device, &[CMD_VIAL_PREFIX, CMD_VIAL_GET_SIZE], 10)?;
    let definition_size = le_u32(&size_response[0..4]) as usize;
    if definition_size == 0 || definition_size > 512 * 1024 {
        return Err(format!("invalid Vial definition size: {definition_size}"));
    }

    let mut compressed = Vec::with_capacity(definition_size);
    let mut block = 0_u32;
    while compressed.len() < definition_size {
        let mut command = vec![CMD_VIAL_PREFIX, CMD_VIAL_GET_DEFINITION];
        command.extend_from_slice(&block.to_le_bytes());
        let response = exchange(device, &command, 12)?;
        let remaining = definition_size - compressed.len();
        compressed.extend_from_slice(&response[..remaining.min(REPORT_SIZE)]);
        block += 1;
    }

    let mut decoder = XzDecoder::new(compressed.as_slice());
    let mut definition_json = String::new();
    decoder
        .read_to_string(&mut definition_json)
        .map_err(|error| format!("invalid compressed Vial definition: {error}"))?;
    let definition: Value = serde_json::from_str(&definition_json)
        .map_err(|error| format!("invalid Vial definition JSON: {error}"))?;

    let rows = definition
        .pointer("/matrix/rows")
        .and_then(Value::as_u64)
        .ok_or("Vial definition has no matrix.rows")? as usize;
    let cols = definition
        .pointer("/matrix/cols")
        .and_then(Value::as_u64)
        .ok_or("Vial definition has no matrix.cols")? as usize;
    let layer_response = exchange(device, &[CMD_GET_LAYER_COUNT], 10)?;
    let layers = layer_response[1];
    let macro_count_response = exchange(device, &[CMD_MACRO_GET_COUNT], 10)?;
    let macro_count = macro_count_response[1];
    let macro_memory_response = exchange(device, &[CMD_MACRO_GET_BUFFER_SIZE], 10)?;
    let macro_memory = u16::from_be_bytes([macro_memory_response[1], macro_memory_response[2]]);
    if layers == 0 || rows == 0 || cols == 0 {
        return Err("keyboard reported an empty keymap".to_owned());
    }

    let keymap_size = layers as usize * rows * cols * 2;
    let mut raw_keymap = Vec::with_capacity(keymap_size);
    for offset in (0..keymap_size).step_by(BUFFER_CHUNK) {
        let size = (keymap_size - offset).min(BUFFER_CHUNK);
        let response = exchange(device, &get_keymap_chunk(offset, size)?, 12)?;
        raw_keymap.extend_from_slice(&response[4..4 + size]);
    }

    let mut keymap = vec![vec![vec![0_u16; cols]; rows]; layers as usize];
    for (layer, layer_map) in keymap.iter_mut().enumerate() {
        for (row, row_map) in layer_map.iter_mut().enumerate() {
            for (col, value) in row_map.iter_mut().enumerate() {
                let offset = layer * rows * cols * 2 + row * cols * 2 + col * 2;
                *value = u16::from_be_bytes([raw_keymap[offset], raw_keymap[offset + 1]]);
            }
        }
    }

    let indices = encoder_indices(&definition);
    let encoder_count = indices
        .iter()
        .copied()
        .max()
        .map_or(0, |index| index as usize + 1);
    let mut encoders = vec![vec![[0_u16; 2]; encoder_count]; layers as usize];
    for layer in 0..layers {
        for &index in &indices {
            let response = exchange(device, &get_encoder(layer, index), 12)?;
            encoders[layer as usize][index as usize] = [
                u16::from_be_bytes([response[0], response[1]]),
                u16::from_be_bytes([response[2], response[3]]),
            ];
        }
    }

    let combo_count = if vial_protocol >= VIAL_PROTOCOL_DYNAMIC {
        let count_response = exchange(device, &get_dynamic_entry_count(), 20)?;
        count_response[1]
    } else {
        0
    };

    Ok(KeyboardSnapshot {
        device: device_summary,
        definition,
        via_protocol,
        vial_protocol,
        uid,
        layers,
        rows,
        cols,
        keymap,
        encoders,
        combo_count,
        combos_loaded: false,
        combos: Vec::new(),
        macro_count,
        macro_memory,
        macros_loaded: false,
        macro_buffer: Vec::new(),
        qmk_settings_supported: vial_protocol >= VIAL_PROTOCOL_DYNAMIC,
        qmk_settings_loaded: false,
        qmk_settings: Vec::new(),
    })
}

#[tauri::command]
async fn connect_device(
    id: String,
    state: State<'_, AppState>,
) -> Result<KeyboardSnapshot, String> {
    let shared_connection = Arc::clone(&state.connection);
    tauri::async_runtime::spawn_blocking(move || {
        let path_bytes = hex::decode(id).map_err(|error| format!("invalid device id: {error}"))?;
        let path = CString::new(path_bytes).map_err(|_| "invalid HID path")?;
        let api = HidApi::new().map_err(|error| error.to_string())?;
        let info = api
            .device_list()
            .find(|info| info.path() == path.as_c_str())
            .ok_or("keyboard is no longer connected")?;
        let device_summary = summary(info);
        let device = info.open_device(&api).map_err(|error| {
            format!(
                "Could not open {}. Close Vial and try again: {error}",
                device_summary.name
            )
        })?;
        let snapshot = load_keyboard(&device, device_summary)?;
        let connection = Connection {
            device,
            uid: snapshot.uid.clone(),
            vial_protocol: snapshot.vial_protocol,
            layers: snapshot.layers,
            rows: snapshot.rows,
            cols: snapshot.cols,
            encoder_count: snapshot.encoders.first().map_or(0, Vec::len),
            combo_count: snapshot.combo_count,
            macro_count: snapshot.macro_count,
            macro_memory: snapshot.macro_memory,
            qmk_setting_ids: BTreeSet::new(),
        };
        *shared_connection
            .lock()
            .map_err(|_| "connection lock failed")? = Some(connection);
        Ok(snapshot)
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
fn get_monitor_status(state: State<'_, AppState>) -> Result<MonitorStatus, String> {
    let guard = state
        .connection
        .lock()
        .map_err(|_| "connection lock failed")?;
    let connection = guard.as_ref().ok_or("keyboard is not connected")?;
    if !monitor_supported(connection) {
        return Ok(MonitorStatus {
            supported: false,
            unlocked: false,
            unlock_in_progress: false,
            unlock_keys: Vec::new(),
        });
    }

    let response = exchange(&connection.device, &protocol::get_unlock_status(), 3)?;
    Ok(MonitorStatus {
        supported: true,
        unlocked: response[0] == 1,
        unlock_in_progress: response[1] == 1,
        unlock_keys: unlock_keys(&response, connection.rows, connection.cols),
    })
}

#[tauri::command]
fn start_monitor_unlock(state: State<'_, AppState>) -> Result<(), String> {
    let guard = state
        .connection
        .lock()
        .map_err(|_| "connection lock failed")?;
    let connection = guard.as_ref().ok_or("keyboard is not connected")?;
    if !monitor_supported(connection) {
        return Err("This keyboard does not support safe matrix monitoring".to_owned());
    }
    exchange(&connection.device, &protocol::start_unlock(), 3)?;
    Ok(())
}

#[tauri::command]
fn poll_monitor_unlock(state: State<'_, AppState>) -> Result<MonitorUnlockProgress, String> {
    let guard = state
        .connection
        .lock()
        .map_err(|_| "connection lock failed")?;
    let connection = guard.as_ref().ok_or("keyboard is not connected")?;
    if !monitor_supported(connection) {
        return Err("This keyboard does not support safe matrix monitoring".to_owned());
    }
    let response = exchange(&connection.device, &protocol::poll_unlock(), 3)?;
    Ok(MonitorUnlockProgress {
        unlocked: response[0] == 1,
        in_progress: response[1] == 1,
        remaining: response[2],
    })
}

#[tauri::command]
async fn poll_matrix_state(state: State<'_, AppState>) -> Result<MatrixStateSnapshot, String> {
    let shared_connection = Arc::clone(&state.connection);
    tauri::async_runtime::spawn_blocking(move || {
        let guard = shared_connection
            .lock()
            .map_err(|_| "connection lock failed")?;
        let connection = guard.as_ref().ok_or("keyboard is not connected")?;
        if !monitor_supported(connection) {
            return Err("This keyboard does not support safe matrix monitoring".to_owned());
        }
        let response = exchange_with_timeout(
            &connection.device,
            &protocol::get_switch_matrix_state(),
            1,
            180,
            0,
        )?;
        Ok(MatrixStateSnapshot {
            pressed: decode_matrix_state(&response, connection.rows, connection.cols)?,
        })
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
fn lock_monitor(state: State<'_, AppState>) -> Result<(), String> {
    let guard = state
        .connection
        .lock()
        .map_err(|_| "connection lock failed")?;
    let connection = guard.as_ref().ok_or("keyboard is not connected")?;
    if monitor_supported(connection) {
        exchange(&connection.device, &protocol::lock(), 3)?;
    }
    Ok(())
}

#[tauri::command]
async fn open_live_overlay(
    app: tauri::AppHandle,
    bounds: Option<OverlayBounds>,
) -> Result<(), String> {
    if let Some(window) = app.get_webview_window(LIVE_OVERLAY_LABEL) {
        window.show().map_err(|error| error.to_string())?;
        return Ok(());
    }

    let mut builder = WebviewWindowBuilder::new(
        &app,
        LIVE_OVERLAY_LABEL,
        WebviewUrl::App("index.html?overlay=1".into()),
    )
    .title("Cornix Live")
    .inner_size(920.0, 440.0)
    .min_inner_size(620.0, 300.0)
    .resizable(true)
    .decorations(false)
    .focused(false)
    .focusable(false)
    .transparent(true)
    .shadow(true)
    .always_on_top(true)
    .skip_taskbar(false);

    if let Some(bounds) = bounds
        && bounds.x.is_finite()
        && bounds.y.is_finite()
        && bounds.width.is_finite()
        && bounds.height.is_finite()
    {
        builder = builder
            .position(
                bounds.x.clamp(-10_000.0, 10_000.0),
                bounds.y.clamp(-10_000.0, 10_000.0),
            )
            .inner_size(
                bounds.width.clamp(620.0, 1_800.0),
                bounds.height.clamp(300.0, 1_000.0),
            );
    }

    builder.build().map_err(|error| error.to_string())?;
    Ok(())
}

#[tauri::command]
fn close_live_overlay(app: tauri::AppHandle) -> Result<(), String> {
    if let Some(window) = app.get_webview_window(LIVE_OVERLAY_LABEL) {
        window.close().map_err(|error| error.to_string())?;
    }
    Ok(())
}

#[tauri::command]
fn set_key(
    layer: u8,
    row: u8,
    col: u8,
    keycode: u16,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let guard = state
        .connection
        .lock()
        .map_err(|_| "connection lock failed")?;
    let connection = guard.as_ref().ok_or("keyboard is not connected")?;
    exchange(
        &connection.device,
        &protocol::set_key(layer, row, col, keycode),
        12,
    )?;
    Ok(())
}

#[tauri::command]
fn set_encoder(
    layer: u8,
    index: u8,
    direction: u8,
    keycode: u16,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let guard = state
        .connection
        .lock()
        .map_err(|_| "connection lock failed")?;
    let connection = guard.as_ref().ok_or("keyboard is not connected")?;
    exchange(
        &connection.device,
        &protocol::set_encoder(layer, index, direction, keycode)?,
        12,
    )?;
    Ok(())
}

#[tauri::command]
fn set_combo(index: u8, entry: [u16; 5], state: State<'_, AppState>) -> Result<(), String> {
    let guard = state
        .connection
        .lock()
        .map_err(|_| "connection lock failed")?;
    let connection = guard.as_ref().ok_or("keyboard is not connected")?;
    if index >= connection.combo_count {
        return Err(format!("invalid combo index: {index}"));
    }
    exchange(&connection.device, &protocol::set_combo(index, entry), 20)?;
    Ok(())
}

#[tauri::command]
fn load_combos(state: State<'_, AppState>) -> Result<Vec<[u16; 5]>, String> {
    let guard = state
        .connection
        .lock()
        .map_err(|_| "connection lock failed")?;
    let connection = guard.as_ref().ok_or("keyboard is not connected")?;
    read_combos(&connection.device, connection.combo_count)
}

#[tauri::command]
fn load_macros(state: State<'_, AppState>) -> Result<Vec<u8>, String> {
    let guard = state
        .connection
        .lock()
        .map_err(|_| "connection lock failed")?;
    let connection = guard.as_ref().ok_or("keyboard is not connected")?;
    read_macro_buffer(
        &connection.device,
        connection.macro_count,
        connection.macro_memory,
    )
}

#[tauri::command]
fn set_macros(buffer: Vec<u8>, state: State<'_, AppState>) -> Result<(), String> {
    let guard = state
        .connection
        .lock()
        .map_err(|_| "connection lock failed")?;
    let connection = guard.as_ref().ok_or("keyboard is not connected")?;
    if buffer.len() > connection.macro_memory as usize {
        return Err(format!(
            "macro data uses {} bytes; keyboard capacity is {}",
            buffer.len(),
            connection.macro_memory
        ));
    }
    if connection.macro_count > 0
        && (buffer.last() != Some(&0)
            || buffer.iter().filter(|byte| **byte == 0).count() != connection.macro_count as usize)
    {
        return Err("macro data does not contain the expected number of entries".to_owned());
    }
    for (chunk_index, chunk) in buffer.chunks(BUFFER_CHUNK).enumerate() {
        let offset = chunk_index * BUFFER_CHUNK;
        exchange(&connection.device, &set_macro_chunk(offset, chunk)?, 20)
            .map_err(|error| format!("failed writing macro buffer at byte {offset}: {error}"))?;
    }
    Ok(())
}

#[tauri::command]
fn load_qmk_settings(state: State<'_, AppState>) -> Result<Vec<QmkSettingRaw>, String> {
    let mut guard = state
        .connection
        .lock()
        .map_err(|_| "connection lock failed")?;
    let connection = guard.as_mut().ok_or("keyboard is not connected")?;
    let settings = read_qmk_settings(&connection.device)?;
    connection.qmk_setting_ids = settings.iter().map(|setting| setting.id).collect();
    Ok(settings)
}

#[tauri::command]
fn set_qmk_setting(id: u16, data: Vec<u8>, state: State<'_, AppState>) -> Result<(), String> {
    let guard = state
        .connection
        .lock()
        .map_err(|_| "connection lock failed")?;
    let connection = guard.as_ref().ok_or("keyboard is not connected")?;
    if !connection.qmk_setting_ids.contains(&id) {
        return Err(format!("unsupported QMK setting: {id}"));
    }
    if data.is_empty() || data.len() > 4 {
        return Err("QMK setting values must use 1 to 4 bytes".to_owned());
    }
    let response = exchange(
        &connection.device,
        &protocol::set_qmk_setting(id, &data)?,
        20,
    )?;
    if response[0] != 0 {
        return Err(format!(
            "keyboard rejected QMK setting {id} with status {}",
            response[0]
        ));
    }
    Ok(())
}

#[tauri::command]
fn reset_qmk_settings(state: State<'_, AppState>) -> Result<Vec<QmkSettingRaw>, String> {
    let mut guard = state
        .connection
        .lock()
        .map_err(|_| "connection lock failed")?;
    let connection = guard.as_mut().ok_or("keyboard is not connected")?;
    exchange(&connection.device, &protocol::reset_qmk_settings(), 20)?;
    let settings = read_qmk_settings(&connection.device)?;
    connection.qmk_setting_ids = settings.iter().map(|setting| setting.id).collect();
    Ok(settings)
}

fn backup_directory(automatic: bool) -> Result<PathBuf, String> {
    let directory = if automatic {
        env::var_os("LOCALAPPDATA")
            .map(PathBuf::from)
            .unwrap_or(env::current_dir().map_err(|error| error.to_string())?)
            .join("Cornix Studio")
            .join("backups")
    } else {
        env::var_os("USERPROFILE")
            .or_else(|| env::var_os("HOME"))
            .map(PathBuf::from)
            .unwrap_or(env::current_dir().map_err(|error| error.to_string())?)
            .join("Downloads")
    };
    fs::create_dir_all(&directory)
        .map_err(|error| format!("could not create {}: {error}", directory.display()))?;
    Ok(directory)
}

#[tauri::command]
fn save_backup_file(
    content: String,
    automatic: bool,
    state: State<'_, AppState>,
) -> Result<String, String> {
    if content.len() > 4 * 1024 * 1024 {
        return Err("backup file is unexpectedly large".to_owned());
    }
    let guard = state
        .connection
        .lock()
        .map_err(|_| "connection lock failed")?;
    let connection = guard.as_ref().ok_or("keyboard is not connected")?;
    let uid = connection
        .uid
        .chars()
        .filter(char::is_ascii_hexdigit)
        .collect::<String>();
    let timestamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|error| error.to_string())?
        .as_secs();
    let directory = backup_directory(automatic)?;
    let prefix = if automatic {
        "cornix-auto-backup"
    } else {
        "cornix-backup"
    };
    for suffix in 0..100_u8 {
        let duplicate = if suffix == 0 {
            String::new()
        } else {
            format!("-{suffix}")
        };
        let path = directory.join(format!("{prefix}-{uid}-{timestamp}{duplicate}.json"));
        match OpenOptions::new().write(true).create_new(true).open(&path) {
            Ok(mut file) => {
                file.write_all(content.as_bytes())
                    .map_err(|error| format!("could not write {}: {error}", path.display()))?;
                return Ok(path.display().to_string());
            }
            Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => continue,
            Err(error) => {
                return Err(format!("could not create {}: {error}", path.display()));
            }
        }
    }
    Err("could not choose a unique backup filename".to_owned())
}

#[tauri::command]
fn apply_configuration(
    request: RestoreRequest,
    state: State<'_, AppState>,
) -> Result<AppliedChanges, String> {
    let guard = state
        .connection
        .lock()
        .map_err(|_| "connection lock failed")?;
    let connection = guard.as_ref().ok_or("keyboard is not connected")?;
    if request.uid != connection.uid {
        return Err("backup belongs to a different keyboard".to_owned());
    }
    if request.layers != connection.layers
        || request.rows != connection.rows
        || request.cols != connection.cols
        || request.encoder_count != connection.encoder_count
        || request.combo_count != connection.combo_count
    {
        return Err("backup dimensions do not match the connected keyboard".to_owned());
    }
    if request.keys.len() > connection.layers as usize * connection.rows * connection.cols
        || request.encoders.len() > connection.layers as usize * connection.encoder_count * 2
        || request.combos.len() > connection.combo_count as usize
        || request.qmk_settings.len() > connection.qmk_setting_ids.len()
    {
        return Err("backup contains too many changes".to_owned());
    }

    for change in &request.keys {
        if change.layer >= connection.layers
            || change.row as usize >= connection.rows
            || change.col as usize >= connection.cols
        {
            return Err("backup contains an invalid key position".to_owned());
        }
    }
    for change in &request.encoders {
        if change.layer >= connection.layers
            || change.index as usize >= connection.encoder_count
            || change.direction > 1
        {
            return Err("backup contains an invalid encoder position".to_owned());
        }
    }
    if request
        .combos
        .iter()
        .any(|change| change.index >= connection.combo_count)
    {
        return Err("backup contains an invalid combo index".to_owned());
    }
    if let Some(buffer) = &request.macro_buffer
        && (buffer.len() > connection.macro_memory as usize
            || buffer.last() != Some(&0)
            || buffer.iter().filter(|byte| **byte == 0).count() != connection.macro_count as usize)
    {
        return Err("backup contains invalid macro data".to_owned());
    }
    let mut qmk_ids = BTreeSet::new();
    if request.qmk_settings.iter().any(|change| {
        !connection.qmk_setting_ids.contains(&change.id)
            || change.data.is_empty()
            || change.data.len() > 4
            || !qmk_ids.insert(change.id)
    }) {
        return Err("backup contains invalid QMK setting data".to_owned());
    }

    for change in &request.keys {
        exchange(
            &connection.device,
            &protocol::set_key(change.layer, change.row, change.col, change.keycode),
            12,
        )
        .map_err(|error| {
            format!(
                "failed at Layer {} key {},{}: {error}",
                change.layer, change.row, change.col
            )
        })?;
    }
    for change in &request.encoders {
        exchange(
            &connection.device,
            &protocol::set_encoder(change.layer, change.index, change.direction, change.keycode)?,
            12,
        )
        .map_err(|error| {
            format!(
                "failed at Layer {} encoder {} direction {}: {error}",
                change.layer, change.index, change.direction
            )
        })?;
    }
    for change in &request.combos {
        exchange(
            &connection.device,
            &protocol::set_combo(change.index, change.entry),
            20,
        )
        .map_err(|error| format!("failed at Combo {}: {error}", change.index + 1))?;
    }
    if let Some(buffer) = &request.macro_buffer {
        for (chunk_index, chunk) in buffer.chunks(BUFFER_CHUNK).enumerate() {
            let offset = chunk_index * BUFFER_CHUNK;
            exchange(&connection.device, &set_macro_chunk(offset, chunk)?, 20).map_err(
                |error| format!("failed restoring macro buffer at byte {offset}: {error}"),
            )?;
        }
    }
    for change in &request.qmk_settings {
        let response = exchange(
            &connection.device,
            &protocol::set_qmk_setting(change.id, &change.data)?,
            20,
        )
        .map_err(|error| format!("failed restoring QMK setting {}: {error}", change.id))?;
        if response[0] != 0 {
            return Err(format!(
                "keyboard rejected QMK setting {} with status {}",
                change.id, response[0]
            ));
        }
    }

    Ok(AppliedChanges {
        keys: request.keys.len(),
        encoders: request.encoders.len(),
        combos: request.combos.len(),
        macros: usize::from(request.macro_buffer.is_some()),
        qmk_settings: request.qmk_settings.len(),
    })
}

#[tauri::command]
fn disconnect(state: State<'_, AppState>) -> Result<(), String> {
    let mut guard = state
        .connection
        .lock()
        .map_err(|_| "connection lock failed")?;
    if let Some(connection) = guard.as_ref()
        && monitor_supported(connection)
    {
        let _ = exchange(&connection.device, &protocol::lock(), 1);
    }
    *guard = None;
    Ok(())
}

#[tauri::command]
fn validate_firmware_package(
    uploads: Vec<firmware::FirmwareUpload>,
    state: State<'_, AppState>,
) -> Result<firmware::FirmwarePackageInfo, String> {
    let package = firmware::validate_package(uploads)?;
    let info = package.info.clone();
    *state
        .firmware_package
        .lock()
        .map_err(|_| "firmware package lock failed")? = Some(package);
    Ok(info)
}

#[tauri::command]
fn list_firmware_bootloaders() -> Vec<firmware::BootloaderVolume> {
    firmware::list_bootloader_volumes()
}

#[tauri::command]
fn flash_firmware_side(
    side: firmware::FirmwareSide,
    root: String,
    state: State<'_, AppState>,
) -> Result<firmware::FirmwareFlashResult, String> {
    let guard = state
        .firmware_package
        .lock()
        .map_err(|_| "firmware package lock failed")?;
    let package = guard.as_ref().ok_or("firmware package is not selected")?;
    firmware::flash_side(package, side, &root)
}

#[tauri::command]
fn clear_firmware_package(state: State<'_, AppState>) -> Result<(), String> {
    *state
        .firmware_package
        .lock()
        .map_err(|_| "firmware package lock failed")? = None;
    Ok(())
}

fn demo_definition() -> Value {
    serde_json::from_str(include_str!("../../src/fixtures/cornix-v1.12.json"))
        .expect("bundled Cornix demo definition")
}

#[tauri::command]
fn connect_demo() -> KeyboardSnapshot {
    let rows = 8;
    let cols = 7;
    let layers = 10;
    let mut keymap = vec![vec![vec![0_u16; cols]; rows]; layers];
    let mut encoders = vec![vec![[0_u16; 2]; 2]; layers];
    keymap[0][0] = vec![0x2b, 0x14, 0x1a, 0x08, 0x15, 0x17, 0];
    keymap[0][1] = vec![0x39, 0x04, 0x16, 0x07, 0x09, 0x0a, 0];
    keymap[0][2] = vec![0xe1, 0x1d, 0x1b, 0x06, 0x19, 0x05, 0x90];
    keymap[0][3] = vec![0xe0, 0xe3, 0xe2, 0x5221, 0x5223, 0x2c, 0];
    keymap[0][4] = vec![0x2a, 0x13, 0x12, 0x0c, 0x18, 0x1c, 0];
    keymap[0][5] = vec![0x28, 0x31, 0x0f, 0x0e, 0x0d, 0x0b, 0x91];
    keymap[0][6] = vec![0x38, 0x52, 0x37, 0x36, 0x10, 0x11, 0];
    keymap[0][7] = vec![0x4f, 0x51, 0x50, 0x5222, 0x5224, 0x2c, 0];
    encoders[0][0] = [0x00aa, 0x00a9];
    encoders[0][1] = [0x00ac, 0x00ab];
    let mut combos = vec![[0_u16; 5]; 32];
    combos[0] = [0x0007, 0x0009, 0, 0, 0x0029];
    combos[1] = [0x000d, 0x000e, 0, 0, 0x0028];

    KeyboardSnapshot {
        device: DeviceSummary {
            id: "demo".to_owned(),
            name: "Cornix LP · Demo".to_owned(),
            manufacturer: Some("Jezail".to_owned()),
            serial: None,
            vendor_id: 0,
            product_id: 0,
            transport: "Demo".to_owned(),
        },
        definition: demo_definition(),
        via_protocol: 9,
        vial_protocol: 6,
        uid: "demo000000000001".to_owned(),
        layers: layers as u8,
        rows,
        cols,
        keymap,
        encoders,
        combo_count: combos.len() as u8,
        combos_loaded: true,
        combos,
        macro_count: 32,
        macro_memory: 1024,
        macros_loaded: true,
        macro_buffer: {
            let mut buffer = b"Hello from Cornix Studio".to_vec();
            buffer.extend(std::iter::repeat_n(0, 32));
            buffer
        },
        qmk_settings_supported: true,
        qmk_settings_loaded: true,
        qmk_settings: vec![
            QmkSettingRaw {
                id: 2,
                data: vec![50, 0, 255, 255],
            },
            QmkSettingRaw {
                id: 6,
                data: vec![232, 3, 255, 255],
            },
            QmkSettingRaw {
                id: 7,
                data: vec![250, 0, 255, 255],
            },
            QmkSettingRaw {
                id: 18,
                data: vec![20, 0, 255, 255],
            },
            QmkSettingRaw {
                id: 19,
                data: vec![20, 0, 255, 255],
            },
            QmkSettingRaw {
                id: 22,
                data: vec![1, 255, 255, 255],
            },
            QmkSettingRaw {
                id: 23,
                data: vec![0, 255, 255, 255],
            },
            QmkSettingRaw {
                id: 26,
                data: vec![1, 255, 255, 255],
            },
            QmkSettingRaw {
                id: 27,
                data: vec![120, 0, 255, 255],
            },
        ],
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let app = tauri::Builder::default()
        .manage(AppState::default())
        .invoke_handler(tauri::generate_handler![
            list_devices,
            connect_device,
            connect_demo,
            get_monitor_status,
            start_monitor_unlock,
            poll_monitor_unlock,
            poll_matrix_state,
            lock_monitor,
            open_live_overlay,
            close_live_overlay,
            set_key,
            set_encoder,
            load_combos,
            set_combo,
            load_macros,
            set_macros,
            load_qmk_settings,
            set_qmk_setting,
            reset_qmk_settings,
            save_backup_file,
            apply_configuration,
            validate_firmware_package,
            list_firmware_bootloaders,
            flash_firmware_side,
            clear_firmware_package,
            disconnect
        ])
        .on_window_event(|window, event| {
            if window.label() == LIVE_OVERLAY_LABEL
                && matches!(event, tauri::WindowEvent::Destroyed)
            {
                let state = window.state::<AppState>();
                if let Ok(guard) = state.connection.lock()
                    && let Some(connection) = guard.as_ref()
                    && monitor_supported(connection)
                {
                    let _ = exchange(&connection.device, &protocol::lock(), 1);
                }
                let _ = window
                    .app_handle()
                    .emit_to("main", "live-overlay-closed", ());
            }
        })
        .build(tauri::generate_context!())
        .expect("error while running Cornix Studio");
    app.run(|app_handle, event| {
        if matches!(event, tauri::RunEvent::ExitRequested { .. }) {
            let state = app_handle.state::<AppState>();
            if let Ok(guard) = state.connection.lock()
                && let Some(connection) = guard.as_ref()
                && monitor_supported(connection)
            {
                let _ = exchange(&connection.device, &protocol::lock(), 1);
            }
        }
    });
}

#[cfg(test)]
mod hardware_tests {
    use super::*;

    #[test]
    #[ignore = "requires a connected Vial keyboard"]
    fn inspect_connected_vial_definition() {
        let api = HidApi::new().expect("HID API");
        for info in api
            .device_list()
            .filter(|info| info.usage_page() == RAW_USAGE_PAGE && info.usage() == RAW_USAGE)
        {
            let Ok(device) = info.open_device(&api) else {
                continue;
            };
            if let Ok(snapshot) = load_keyboard(&device, summary(info)) {
                let combos = read_combos(&device, snapshot.combo_count).expect("read combos");
                let macro_buffer =
                    read_macro_buffer(&device, snapshot.macro_count, snapshot.macro_memory)
                        .expect("read macros");
                let qmk_settings = read_qmk_settings(&device).expect("read QMK settings");
                println!(
                    "VIAL_HARDWARE_SNAPSHOT={}",
                    serde_json::to_string(&serde_json::json!({
                        "device": snapshot.device,
                        "definition": snapshot.definition,
                        "layers": snapshot.layers,
                        "rows": snapshot.rows,
                        "cols": snapshot.cols,
                        "comboCount": snapshot.combo_count,
                        "combos": combos,
                        "macroCount": snapshot.macro_count,
                        "macroMemory": snapshot.macro_memory,
                        "macroBytes": macro_buffer.len(),
                        "qmkSettings": qmk_settings
                    }))
                    .expect("serialize snapshot")
                );
                return;
            }
        }
        panic!("no connected Vial Raw HID interface answered");
    }

    #[test]
    #[ignore = "requires a connected Vial keyboard"]
    fn inspect_connected_qmk_settings() {
        let api = HidApi::new().expect("HID API");
        for info in api
            .device_list()
            .filter(|info| info.usage_page() == RAW_USAGE_PAGE && info.usage() == RAW_USAGE)
        {
            let Ok(device) = info.open_device(&api) else {
                continue;
            };
            if load_keyboard(&device, summary(info)).is_ok() {
                let settings = read_qmk_settings(&device).expect("read QMK settings");
                println!(
                    "VIAL_QMK_SETTINGS={}",
                    serde_json::to_string(&settings).expect("serialize settings")
                );
                return;
            }
        }
        panic!("no connected Vial Raw HID interface answered");
    }
}

#[cfg(test)]
mod monitor_tests {
    use super::*;

    #[test]
    fn matrix_state_uses_via_row_bit_order() {
        let mut response = [0_u8; REPORT_SIZE];
        response[0] = CMD_GET_KEYBOARD_VALUE;
        response[1] = VIA_SWITCH_MATRIX_STATE;
        response[2] = 0b0000_0010;
        response[3] = 0b0000_0001;
        response[4] = 0;
        response[5] = 0b0000_0100;

        let pressed = decode_matrix_state(&response, 2, 10).unwrap();
        assert_eq!(
            pressed,
            [
                MatrixPosition { row: 0, col: 0 },
                MatrixPosition { row: 0, col: 9 },
                MatrixPosition { row: 1, col: 2 },
            ]
        );
    }

    #[test]
    fn unlock_key_parser_ignores_padding_and_invalid_positions() {
        let mut response = [u8::MAX; REPORT_SIZE];
        response[0] = 0;
        response[1] = 0;
        response[2..8].copy_from_slice(&[0, 1, 7, 6, 9, 9]);
        assert_eq!(
            unlock_keys(&response, 8, 7),
            [
                MatrixPosition { row: 0, col: 1 },
                MatrixPosition { row: 7, col: 6 },
            ]
        );
    }
}
