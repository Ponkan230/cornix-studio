// SPDX-License-Identifier: GPL-2.0-or-later
// Copyright (C) 2026 Ponkan230 and Cornix Studio contributors

pub const REPORT_SIZE: usize = 32;
pub const RAW_USAGE_PAGE: u16 = 0xff60;
pub const RAW_USAGE: u16 = 0x61;
pub const CMD_GET_PROTOCOL_VERSION: u8 = 0x01;
pub const CMD_GET_KEYBOARD_VALUE: u8 = 0x02;
pub const CMD_SET_KEYCODE: u8 = 0x05;
pub const CMD_MACRO_GET_COUNT: u8 = 0x0c;
pub const CMD_MACRO_GET_BUFFER_SIZE: u8 = 0x0d;
pub const CMD_MACRO_GET_BUFFER: u8 = 0x0e;
pub const CMD_MACRO_SET_BUFFER: u8 = 0x0f;
pub const CMD_GET_LAYER_COUNT: u8 = 0x11;
pub const CMD_GET_KEYMAP_BUFFER: u8 = 0x12;
pub const CMD_VIAL_PREFIX: u8 = 0xfe;
pub const CMD_VIAL_GET_KEYBOARD_ID: u8 = 0x00;
pub const CMD_VIAL_GET_SIZE: u8 = 0x01;
pub const CMD_VIAL_GET_DEFINITION: u8 = 0x02;
pub const CMD_VIAL_GET_ENCODER: u8 = 0x03;
pub const CMD_VIAL_SET_ENCODER: u8 = 0x04;
pub const CMD_VIAL_GET_UNLOCK_STATUS: u8 = 0x05;
pub const CMD_VIAL_UNLOCK_START: u8 = 0x06;
pub const CMD_VIAL_UNLOCK_POLL: u8 = 0x07;
pub const CMD_VIAL_LOCK: u8 = 0x08;
pub const CMD_VIAL_QMK_SETTINGS_QUERY: u8 = 0x09;
pub const CMD_VIAL_QMK_SETTINGS_GET: u8 = 0x0a;
pub const CMD_VIAL_QMK_SETTINGS_SET: u8 = 0x0b;
pub const CMD_VIAL_QMK_SETTINGS_RESET: u8 = 0x0c;
pub const CMD_VIAL_DYNAMIC_ENTRY_OP: u8 = 0x0d;
pub const DYNAMIC_GET_NUMBER_OF_ENTRIES: u8 = 0x00;
pub const DYNAMIC_COMBO_GET: u8 = 0x03;
pub const DYNAMIC_COMBO_SET: u8 = 0x04;
pub const VIAL_PROTOCOL_DYNAMIC: u32 = 4;
pub const VIAL_PROTOCOL_MATRIX_TESTER: u32 = 3;
pub const VIA_SWITCH_MATRIX_STATE: u8 = 0x03;
pub const BUFFER_CHUNK: usize = 28;

pub fn report(payload: &[u8]) -> Result<[u8; REPORT_SIZE + 1], String> {
    if payload.len() > REPORT_SIZE {
        return Err(format!(
            "Vial packet is {} bytes; maximum is {REPORT_SIZE}",
            payload.len()
        ));
    }
    let mut output = [0_u8; REPORT_SIZE + 1];
    output[1..1 + payload.len()].copy_from_slice(payload);
    Ok(output)
}

pub fn get_keymap_chunk(offset: usize, size: usize) -> Result<Vec<u8>, String> {
    let offset = u16::try_from(offset).map_err(|_| "keymap offset is too large")?;
    let size = u8::try_from(size).map_err(|_| "keymap chunk is too large")?;
    Ok(vec![
        CMD_GET_KEYMAP_BUFFER,
        (offset >> 8) as u8,
        offset as u8,
        size,
    ])
}

pub fn set_key(layer: u8, row: u8, col: u8, keycode: u16) -> Vec<u8> {
    vec![
        CMD_SET_KEYCODE,
        layer,
        row,
        col,
        (keycode >> 8) as u8,
        keycode as u8,
    ]
}

pub fn get_encoder(layer: u8, index: u8) -> Vec<u8> {
    vec![CMD_VIAL_PREFIX, CMD_VIAL_GET_ENCODER, layer, index]
}

pub fn get_unlock_status() -> Vec<u8> {
    vec![CMD_VIAL_PREFIX, CMD_VIAL_GET_UNLOCK_STATUS]
}

pub fn start_unlock() -> Vec<u8> {
    vec![CMD_VIAL_PREFIX, CMD_VIAL_UNLOCK_START]
}

pub fn poll_unlock() -> Vec<u8> {
    vec![CMD_VIAL_PREFIX, CMD_VIAL_UNLOCK_POLL]
}

pub fn lock() -> Vec<u8> {
    vec![CMD_VIAL_PREFIX, CMD_VIAL_LOCK]
}

pub fn get_switch_matrix_state() -> Vec<u8> {
    vec![CMD_GET_KEYBOARD_VALUE, VIA_SWITCH_MATRIX_STATE]
}

pub fn set_encoder(layer: u8, index: u8, direction: u8, keycode: u16) -> Result<Vec<u8>, String> {
    if direction > 1 {
        return Err(format!("invalid encoder direction: {direction}"));
    }
    Ok(vec![
        CMD_VIAL_PREFIX,
        CMD_VIAL_SET_ENCODER,
        layer,
        index,
        direction,
        (keycode >> 8) as u8,
        keycode as u8,
    ])
}

pub fn get_dynamic_entry_count() -> Vec<u8> {
    vec![
        CMD_VIAL_PREFIX,
        CMD_VIAL_DYNAMIC_ENTRY_OP,
        DYNAMIC_GET_NUMBER_OF_ENTRIES,
    ]
}

pub fn get_combo(index: u8) -> Vec<u8> {
    vec![
        CMD_VIAL_PREFIX,
        CMD_VIAL_DYNAMIC_ENTRY_OP,
        DYNAMIC_COMBO_GET,
        index,
    ]
}

pub fn set_combo(index: u8, entry: [u16; 5]) -> Vec<u8> {
    let mut packet = vec![
        CMD_VIAL_PREFIX,
        CMD_VIAL_DYNAMIC_ENTRY_OP,
        DYNAMIC_COMBO_SET,
        index,
    ];
    for keycode in entry {
        packet.extend_from_slice(&keycode.to_le_bytes());
    }
    packet
}

pub fn get_macro_chunk(offset: usize, size: usize) -> Result<Vec<u8>, String> {
    let offset = u16::try_from(offset).map_err(|_| "macro offset is too large")?;
    let size = u8::try_from(size).map_err(|_| "macro chunk is too large")?;
    Ok(vec![
        CMD_MACRO_GET_BUFFER,
        (offset >> 8) as u8,
        offset as u8,
        size,
    ])
}

pub fn set_macro_chunk(offset: usize, data: &[u8]) -> Result<Vec<u8>, String> {
    let offset = u16::try_from(offset).map_err(|_| "macro offset is too large")?;
    let size = u8::try_from(data.len()).map_err(|_| "macro chunk is too large")?;
    let mut packet = vec![
        CMD_MACRO_SET_BUFFER,
        (offset >> 8) as u8,
        offset as u8,
        size,
    ];
    packet.extend_from_slice(data);
    Ok(packet)
}

pub fn query_qmk_settings(start: u16) -> Vec<u8> {
    let [low, high] = start.to_le_bytes();
    vec![CMD_VIAL_PREFIX, CMD_VIAL_QMK_SETTINGS_QUERY, low, high]
}

pub fn get_qmk_setting(id: u16) -> Vec<u8> {
    let [low, high] = id.to_le_bytes();
    vec![CMD_VIAL_PREFIX, CMD_VIAL_QMK_SETTINGS_GET, low, high]
}

pub fn set_qmk_setting(id: u16, data: &[u8]) -> Result<Vec<u8>, String> {
    let [low, high] = id.to_le_bytes();
    let mut packet = vec![CMD_VIAL_PREFIX, CMD_VIAL_QMK_SETTINGS_SET, low, high];
    packet.extend_from_slice(data);
    if packet.len() > REPORT_SIZE {
        return Err("QMK setting value is too large".to_owned());
    }
    Ok(packet)
}

pub fn reset_qmk_settings() -> Vec<u8> {
    vec![CMD_VIAL_PREFIX, CMD_VIAL_QMK_SETTINGS_RESET]
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn report_has_hid_report_id_and_padding() {
        let packet = report(&[0xfe, 0]).unwrap();
        assert_eq!(packet.len(), 33);
        assert_eq!(&packet[..4], &[0, 0xfe, 0, 0]);
    }

    #[test]
    fn keymap_packet_uses_big_endian_offset() {
        assert_eq!(
            get_keymap_chunk(0x1234, 28).unwrap(),
            [0x12, 0x12, 0x34, 28]
        );
    }

    #[test]
    fn set_key_packet_uses_big_endian_keycode() {
        assert_eq!(set_key(2, 3, 4, 0x5221), [0x05, 2, 3, 4, 0x52, 0x21]);
    }

    #[test]
    fn encoder_packets_match_vial_protocol() {
        assert_eq!(get_encoder(3, 1), [0xfe, 0x03, 3, 1]);
        assert_eq!(
            set_encoder(3, 1, 0, 0x00a9).unwrap(),
            [0xfe, 0x04, 3, 1, 0, 0x00, 0xa9]
        );
        assert!(set_encoder(0, 0, 2, 0).is_err());
    }

    #[test]
    fn monitor_packets_match_vial_protocol() {
        assert_eq!(get_unlock_status(), [0xfe, 0x05]);
        assert_eq!(start_unlock(), [0xfe, 0x06]);
        assert_eq!(poll_unlock(), [0xfe, 0x07]);
        assert_eq!(lock(), [0xfe, 0x08]);
        assert_eq!(get_switch_matrix_state(), [0x02, 0x03]);
    }

    #[test]
    fn combo_packets_match_vial_protocol() {
        assert_eq!(get_dynamic_entry_count(), [0xfe, 0x0d, 0x00]);
        assert_eq!(get_combo(7), [0xfe, 0x0d, 0x03, 7]);
        assert_eq!(
            set_combo(2, [0x0004, 0x0106, 0, 0x0200, 0x5221]),
            [
                0xfe, 0x0d, 0x04, 2, 0x04, 0x00, 0x06, 0x01, 0x00, 0x00, 0x00, 0x02, 0x21, 0x52
            ]
        );
    }

    #[test]
    fn macro_packets_match_via_protocol() {
        assert_eq!(get_macro_chunk(0x0123, 28).unwrap(), [0x0e, 0x01, 0x23, 28]);
        assert_eq!(
            set_macro_chunk(0x0020, &[1, 4, 2, 1]).unwrap(),
            [0x0f, 0x00, 0x20, 4, 1, 4, 2, 1]
        );
    }

    #[test]
    fn qmk_setting_packets_use_little_endian_ids() {
        assert_eq!(query_qmk_settings(0x1234), [0xfe, 0x09, 0x34, 0x12]);
        assert_eq!(get_qmk_setting(0x1234), [0xfe, 0x0a, 0x34, 0x12]);
        assert_eq!(
            set_qmk_setting(7, &[0xc8, 0]).unwrap(),
            [0xfe, 0x0b, 7, 0, 0xc8, 0]
        );
        assert_eq!(reset_qmk_settings(), [0xfe, 0x0c]);
    }
}
