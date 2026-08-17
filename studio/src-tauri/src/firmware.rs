// SPDX-License-Identifier: GPL-2.0-or-later
// Copyright (C) 2026 Ponkan230 and Cornix Studio contributors

use serde::{Deserialize, Serialize};
use std::collections::BTreeSet;
use std::fs::{self, OpenOptions};
use std::io::{Cursor, Read, Write};
use std::path::{Path, PathBuf};
use std::thread;
use std::time::Duration;
use zip::ZipArchive;

const UF2_BLOCK_SIZE: usize = 512;
const UF2_MAGIC_START0: u32 = 0x0a32_4655;
const UF2_MAGIC_START1: u32 = 0x9e5d_5157;
const UF2_MAGIC_END: u32 = 0x0ab1_6f30;
const UF2_FLAG_FAMILY_ID: u32 = 0x0000_2000;
const NRF52840_FAMILY_ID: u32 = 0xada5_2840;
const MAX_PACKAGE_SIZE: usize = 20 * 1024 * 1024;
const MAX_IMAGE_SIZE: usize = 2 * 1024 * 1024;

#[derive(Clone, Copy, Debug, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum FirmwareSide {
    Left,
    Right,
}

impl FirmwareSide {
    fn label(self) -> &'static str {
        match self {
            Self::Left => "left",
            Self::Right => "right",
        }
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FirmwareUpload {
    pub name: String,
    pub data: Vec<u8>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FirmwareImageInfo {
    pub name: String,
    pub side: String,
    pub size: usize,
    pub blocks: u32,
    pub payload_bytes: usize,
    pub address_start: u32,
    pub address_end: u32,
    pub family_id: Option<String>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FirmwarePackageInfo {
    pub package_name: String,
    pub version: Option<String>,
    pub left: FirmwareImageInfo,
    pub right: FirmwareImageInfo,
    pub warnings: Vec<String>,
}

struct FirmwareImage {
    info: FirmwareImageInfo,
    data: Vec<u8>,
}

pub struct ValidatedFirmwarePackage {
    pub info: FirmwarePackageInfo,
    left: FirmwareImage,
    right: FirmwareImage,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BootloaderVolume {
    pub root: String,
    pub board_id: Option<String>,
    pub description: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FirmwareFlashResult {
    pub side: String,
    pub bytes_written: usize,
    pub drive: String,
    pub drive_disconnected: bool,
}

fn read_u32(block: &[u8], offset: usize) -> u32 {
    u32::from_le_bytes(block[offset..offset + 4].try_into().expect("four bytes"))
}

fn parse_side(name: &str) -> Option<FirmwareSide> {
    let lower = name.to_ascii_lowercase();
    let stem = Path::new(&lower)
        .file_stem()
        .and_then(|part| part.to_str())
        .unwrap_or(&lower);
    let tokens = stem.split(|character: char| !character.is_ascii_alphanumeric());
    let mut side = None;
    for token in tokens {
        match token {
            "left" | "lhs" => side = Some(FirmwareSide::Left),
            "right" | "rhs" => side = Some(FirmwareSide::Right),
            _ => {}
        }
    }
    side
}

fn version_from_name(name: &str) -> Option<String> {
    let lower = name.to_ascii_lowercase();
    for (index, character) in lower.char_indices() {
        if character != 'v' {
            continue;
        }
        let tail = &lower[index + 1..];
        let version: String = tail
            .chars()
            .take_while(|candidate| candidate.is_ascii_digit() || *candidate == '.')
            .collect();
        if version.chars().any(|candidate| candidate.is_ascii_digit()) {
            return Some(format!("v{}", version.trim_end_matches('.')));
        }
    }
    None
}

fn validate_uf2(
    name: String,
    side: FirmwareSide,
    data: Vec<u8>,
) -> Result<(FirmwareImage, Vec<String>), String> {
    if data.is_empty() || data.len() > MAX_IMAGE_SIZE || data.len() % UF2_BLOCK_SIZE != 0 {
        return Err(format!(
            "{name}: UF2のサイズが不正です（512バイト単位、最大2MB）"
        ));
    }
    let actual_blocks = u32::try_from(data.len() / UF2_BLOCK_SIZE)
        .map_err(|_| format!("{name}: UF2のブロック数が多すぎます"))?;
    let mut seen = BTreeSet::new();
    let mut expected_blocks = None;
    let mut family_id = None;
    let mut payload_bytes = 0_usize;
    let mut address_start = u32::MAX;
    let mut address_end = 0_u32;
    let mut flash_blocks = 0_u32;

    for block in data.chunks_exact(UF2_BLOCK_SIZE) {
        if read_u32(block, 0) != UF2_MAGIC_START0
            || read_u32(block, 4) != UF2_MAGIC_START1
            || read_u32(block, 508) != UF2_MAGIC_END
        {
            return Err(format!("{name}: UF2の署名が不正です"));
        }
        let flags = read_u32(block, 8);
        let target = read_u32(block, 12);
        let payload_size = read_u32(block, 16) as usize;
        let block_number = read_u32(block, 20);
        let block_count = read_u32(block, 24);
        if payload_size == 0 || payload_size > 476 {
            return Err(format!("{name}: UF2のペイロードサイズが不正です"));
        }
        if block_count != actual_blocks || block_number >= block_count || !seen.insert(block_number)
        {
            return Err(format!("{name}: UF2のブロック順序または総数が不正です"));
        }
        if expected_blocks
            .replace(block_count)
            .is_some_and(|old| old != block_count)
        {
            return Err(format!("{name}: UF2内でブロック総数が一致しません"));
        }
        if flags & UF2_FLAG_FAMILY_ID != 0 {
            let block_family = read_u32(block, 28);
            if block_family != NRF52840_FAMILY_ID {
                return Err(format!(
                    "{name}: nRF52840用ではありません（family ID {block_family:08X}）"
                ));
            }
            if family_id
                .replace(block_family)
                .is_some_and(|old| old != block_family)
            {
                return Err(format!("{name}: UF2内でfamily IDが一致しません"));
            }
        }
        let end = target
            .checked_add(payload_size as u32)
            .ok_or_else(|| format!("{name}: UF2の書き込みアドレスが不正です"))?;
        let in_flash = target < 0x0010_0000 && end <= 0x0010_0000;
        let in_uicr = target >= 0x1000_1000 && end <= 0x1000_2000;
        if !in_flash && !in_uicr {
            return Err(format!(
                "{name}: nRF52840の範囲外に書き込むブロックがあります（0x{target:08X}）"
            ));
        }
        if in_flash {
            flash_blocks += 1;
            address_start = address_start.min(target);
            address_end = address_end.max(end);
        }
        payload_bytes += payload_size;
    }
    if flash_blocks == 0 || seen.len() != actual_blocks as usize {
        return Err(format!("{name}: フラッシュ領域のデータがありません"));
    }
    let mut warnings = Vec::new();
    if family_id.is_none() {
        warnings.push(format!(
            "{name}: UF2にfamily IDがないため、ファイル名とアドレス範囲で検証しました"
        ));
    }
    let info = FirmwareImageInfo {
        name,
        side: side.label().to_owned(),
        size: data.len(),
        blocks: actual_blocks,
        payload_bytes,
        address_start,
        address_end,
        family_id: family_id.map(|id| format!("{id:08X}")),
    };
    Ok((FirmwareImage { info, data }, warnings))
}

fn collect_uf2_files(
    uploads: Vec<FirmwareUpload>,
) -> Result<(String, Vec<(String, Vec<u8>)>), String> {
    if uploads.is_empty() || uploads.len() > 2 {
        return Err("公式ZIPを1つ、またはleft/rightのUF2を2つ選択してください".to_owned());
    }
    if uploads
        .iter()
        .any(|upload| upload.data.len() > MAX_PACKAGE_SIZE)
    {
        return Err("ファームウェアファイルが大きすぎます（最大20MB）".to_owned());
    }
    if uploads.len() == 1 && uploads[0].name.to_ascii_lowercase().ends_with(".zip") {
        let upload = uploads.into_iter().next().expect("one upload");
        let mut archive = ZipArchive::new(Cursor::new(upload.data))
            .map_err(|error| format!("ZIPを開けません: {error}"))?;
        let mut files = Vec::new();
        for index in 0..archive.len() {
            let mut entry = archive
                .by_index(index)
                .map_err(|error| format!("ZIPの項目を読めません: {error}"))?;
            if entry.is_dir() || !entry.name().to_ascii_lowercase().ends_with(".uf2") {
                continue;
            }
            if entry.size() as usize > MAX_IMAGE_SIZE {
                return Err(format!("{}: UF2が大きすぎます", entry.name()));
            }
            let name = Path::new(entry.name())
                .file_name()
                .and_then(|part| part.to_str())
                .ok_or("ZIP内のファイル名が不正です")?
                .to_owned();
            let mut data = Vec::with_capacity(entry.size() as usize);
            entry
                .read_to_end(&mut data)
                .map_err(|error| format!("{name}を展開できません: {error}"))?;
            files.push((name, data));
        }
        return Ok((upload.name, files));
    }
    if uploads
        .iter()
        .any(|upload| !upload.name.to_ascii_lowercase().ends_with(".uf2"))
    {
        return Err("ZIPまたはUF2ファイルだけを選択できます".to_owned());
    }
    let package_name = uploads
        .iter()
        .map(|upload| upload.name.as_str())
        .collect::<Vec<_>>()
        .join(" + ");
    Ok((
        package_name,
        uploads
            .into_iter()
            .map(|upload| (upload.name, upload.data))
            .collect(),
    ))
}

pub fn validate_package(uploads: Vec<FirmwareUpload>) -> Result<ValidatedFirmwarePackage, String> {
    let (package_name, files) = collect_uf2_files(uploads)?;
    if files.len() != 2 {
        return Err("left用とright用のUF2が1つずつ必要です".to_owned());
    }
    let mut left = None;
    let mut right = None;
    let mut warnings = Vec::new();
    for (name, data) in files {
        let side = parse_side(&name)
            .ok_or_else(|| format!("{name}: ファイル名からleft/rightを判別できません"))?;
        let (image, image_warnings) = validate_uf2(name, side, data)?;
        warnings.extend(image_warnings);
        match side {
            FirmwareSide::Left => {
                if left.replace(image).is_some() {
                    return Err("left用UF2が複数あります".to_owned());
                }
            }
            FirmwareSide::Right => {
                if right.replace(image).is_some() {
                    return Err("right用UF2が複数あります".to_owned());
                }
            }
        }
    }
    let left = left.ok_or("left用UF2がありません")?;
    let right = right.ok_or("right用UF2がありません")?;
    if left.info.family_id != right.info.family_id {
        return Err("左右UF2のfamily IDが一致しません".to_owned());
    }
    let info = FirmwarePackageInfo {
        package_name: package_name.clone(),
        version: version_from_name(&package_name)
            .or_else(|| version_from_name(&left.info.name))
            .or_else(|| version_from_name(&right.info.name)),
        left: left.info.clone(),
        right: right.info.clone(),
        warnings,
    };
    Ok(ValidatedFirmwarePackage { info, left, right })
}

fn board_id_from_info(info: &str) -> Option<String> {
    info.lines().find_map(|line| {
        let (key, value) = line.split_once(':')?;
        key.trim()
            .eq_ignore_ascii_case("Board-ID")
            .then(|| value.trim().to_owned())
    })
}

pub fn list_bootloader_volumes() -> Vec<BootloaderVolume> {
    let mut volumes = Vec::new();
    for letter in b'D'..=b'Z' {
        let root = format!("{}:\\", letter as char);
        let info_path = Path::new(&root).join("INFO_UF2.TXT");
        let Ok(info) = fs::read_to_string(&info_path) else {
            continue;
        };
        let lower = info.to_ascii_lowercase();
        let board_id = board_id_from_info(&info);
        if !lower.contains("uf2") {
            continue;
        }
        volumes.push(BootloaderVolume {
            root,
            board_id,
            description: info.lines().take(4).collect::<Vec<_>>().join(" · "),
        });
    }
    volumes
}

fn checked_volume(root: &str) -> Result<BootloaderVolume, String> {
    let normalized = root.to_ascii_uppercase();
    if normalized.len() != 3
        || normalized.as_bytes()[1] != b':'
        || normalized.as_bytes()[2] != b'\\'
        || !normalized.as_bytes()[0].is_ascii_alphabetic()
    {
        return Err("ブートドライブのパスが不正です".to_owned());
    }
    let volume = list_bootloader_volumes()
        .into_iter()
        .find(|volume| volume.root.eq_ignore_ascii_case(&normalized))
        .ok_or("UF2ブートドライブが見つかりません")?;
    let identity = format!(
        "{} {}",
        volume.board_id.as_deref().unwrap_or_default(),
        volume.description
    )
    .to_ascii_lowercase();
    if !["nrf52840", "cornix", "nice", "adafruit"]
        .iter()
        .any(|marker| identity.contains(marker))
    {
        return Err(format!(
            "{} はCornix/nRF52840のブートドライブとして確認できません",
            volume.root
        ));
    }
    Ok(volume)
}

pub fn flash_side(
    package: &ValidatedFirmwarePackage,
    side: FirmwareSide,
    root: &str,
) -> Result<FirmwareFlashResult, String> {
    let volume = checked_volume(root)?;
    let image = match side {
        FirmwareSide::Left => &package.left,
        FirmwareSide::Right => &package.right,
    };
    let target = PathBuf::from(&volume.root).join(format!("cornix-{}-update.uf2", side.label()));
    let write_result = (|| -> Result<(), std::io::Error> {
        let mut file = OpenOptions::new()
            .write(true)
            .create(true)
            .truncate(true)
            .open(&target)?;
        file.write_all(&image.data)?;
        file.flush()
    })();
    if let Err(error) = write_result {
        if Path::new(&volume.root).exists() {
            return Err(format!("UF2の書き込みに失敗しました: {error}"));
        }
    }
    let mut disconnected = false;
    for _ in 0..30 {
        if !Path::new(&volume.root).exists() {
            disconnected = true;
            break;
        }
        thread::sleep(Duration::from_millis(100));
    }
    Ok(FirmwareFlashResult {
        side: side.label().to_owned(),
        bytes_written: image.data.len(),
        drive: volume.root,
        drive_disconnected: disconnected,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn uf2(block_count: u32, family_id: u32) -> Vec<u8> {
        let mut result = Vec::new();
        for block_number in 0..block_count {
            let mut block = [0_u8; UF2_BLOCK_SIZE];
            block[0..4].copy_from_slice(&UF2_MAGIC_START0.to_le_bytes());
            block[4..8].copy_from_slice(&UF2_MAGIC_START1.to_le_bytes());
            block[8..12].copy_from_slice(&UF2_FLAG_FAMILY_ID.to_le_bytes());
            block[12..16].copy_from_slice(&(0x1000 + block_number * 256).to_le_bytes());
            block[16..20].copy_from_slice(&256_u32.to_le_bytes());
            block[20..24].copy_from_slice(&block_number.to_le_bytes());
            block[24..28].copy_from_slice(&block_count.to_le_bytes());
            block[28..32].copy_from_slice(&family_id.to_le_bytes());
            block[508..512].copy_from_slice(&UF2_MAGIC_END.to_le_bytes());
            result.extend_from_slice(&block);
        }
        result
    }

    #[test]
    fn validates_nrf52840_uf2() {
        let (image, warnings) = validate_uf2(
            "cornix-left-v1.12.uf2".to_owned(),
            FirmwareSide::Left,
            uf2(3, NRF52840_FAMILY_ID),
        )
        .expect("valid UF2");
        assert_eq!(image.info.blocks, 3);
        assert_eq!(image.info.family_id.as_deref(), Some("ADA52840"));
        assert!(warnings.is_empty());
    }

    #[test]
    fn rejects_other_families_and_corrupt_magic() {
        assert!(
            validate_uf2(
                "cornix-right.uf2".to_owned(),
                FirmwareSide::Right,
                uf2(1, 0x1234_5678)
            )
            .is_err()
        );
        let mut corrupt = uf2(1, NRF52840_FAMILY_ID);
        corrupt[0] = 0;
        assert!(validate_uf2("cornix-left.uf2".to_owned(), FirmwareSide::Left, corrupt).is_err());
    }

    #[test]
    fn extracts_side_and_version_from_official_style_names() {
        assert_eq!(
            parse_side("folder/cornix-left-v1.12.uf2"),
            Some(FirmwareSide::Left)
        );
        assert_eq!(parse_side("cornix_right.uf2"), Some(FirmwareSide::Right));
        assert_eq!(version_from_name("V1.12.zip").as_deref(), Some("v1.12"));
    }
}
