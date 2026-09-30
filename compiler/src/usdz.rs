// Copyright 2026 Google LLC
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

//! High-performance native Rust accelerators for Apple USDZ export.
//!
//! Provides hardware-accelerated CRC-32, rapid USDA floating-point formatting,
//! and 64-byte payload-aligned uncompressed ZIP archiving for Apple RealityKit.

use crate::constants::SECURITY_3D_MAX_HEAP_BYTES;
use boa_engine::{
    js_string,
    object::builtins::{JsArray, JsArrayBuffer, JsTypedArray, JsUint8Array},
    Context, JsNativeError, JsResult, JsValue, NativeFunction,
};

/// Rejects a zero-copy native-hook input larger than the per-context heap ceiling.
///
/// The slow `extract_byte_buffer` fallback has always enforced this, but the fast
/// paths below slice the backing `ArrayBuffer` directly and were unbounded. Because
/// these hooks are installed as frozen, non-deletable globals, a script could hand
/// one an arbitrarily large buffer and force a proportional Rust allocation — and a
/// Rust allocation failure aborts the process, which `catch_unwind` cannot contain.
#[inline]
fn check_native_input_size(len: usize, hook: &str) -> JsResult<()> {
    if len > SECURITY_3D_MAX_HEAP_BYTES {
        return Err(JsNativeError::range()
            .with_message(format!(
                "{} input ({} bytes) exceeds SECURITY_3D_MAX_HEAP_BYTES ({})",
                hook, len, SECURITY_3D_MAX_HEAP_BYTES
            ))
            .into());
    }
    Ok(())
}

/// Precomputed standard IEEE 802.3 32-bit CRC table generated at compile time.
const CRC_TABLE: [u32; 256] = {
    let mut table = [0u32; 256];
    let mut i = 0;
    while i < 256 {
        let mut c = i as u32;
        let mut k = 0;
        while k < 8 {
            if c & 1 != 0 {
                c = 0xedb88320 ^ (c >> 1);
            } else {
                c >>= 1;
            }
            k += 1;
        }
        table[i] = c;
        i += 1;
    }
    table
};

/// Calculates the standard IEEE 802.3 CRC-32 checksum of a byte slice.
pub fn calculate_crc32(bytes: &[u8]) -> u32 {
    let mut crc = 0xffff_ffffu32;
    for &b in bytes {
        crc = (crc >> 8) ^ CRC_TABLE[((crc ^ (b as u32)) & 0xff) as usize];
    }
    crc ^ 0xffff_ffffu32
}

/// Formats a single 32-bit float compactly matching USDA syntax.
#[inline]
fn format_num(n: f32, s: &mut String) {
    if !n.is_finite() || n == 0.0 {
        s.push('0');
        return;
    }
    // Five fixed decimals is compact and matches USDA convention at the scales models
    // normally use, but it rounds anything below 1e-5 away to zero. Geometry authored
    // in meters with millimeter detail lives exactly there, and collapsing it
    // degenerates the mesh. Below the threshold, fall back to the shortest round-trip
    // decimal form — Rust's `Display` never renders f32 in scientific notation, so the
    // result stays directly parseable as USDA.
    if n.abs() < 1e-5 {
        s.push_str(&n.to_string());
        return;
    }
    let raw = format!("{:.5}", n);
    let trimmed = raw.trim_end_matches('0');
    if trimmed.ends_with('.') {
        s.push_str(trimmed);
        s.push('0');
    } else if !trimmed.contains('.') {
        s.push_str(trimmed);
        s.push_str(".0");
    } else {
        s.push_str(trimmed);
    }
}

/// Rapidly formats a flat slice of 3D point triplets into USDA point3f syntax.
pub fn format_usda_points(positions: &[f32]) -> String {
    let pos_count = positions.len() / 3;
    let mut s = String::with_capacity(pos_count * 32);
    for i in 0..pos_count {
        let x = positions[i * 3];
        let y = positions[i * 3 + 1];
        let z = positions[i * 3 + 2];
        s.push('(');
        format_num(x, &mut s);
        s.push_str(", ");
        format_num(y, &mut s);
        s.push_str(", ");
        format_num(z, &mut s);
        s.push(')');
        if i + 1 < pos_count {
            s.push_str(", ");
        }
    }
    s
}

/// An entry in a USDZ zip archive.
#[derive(Debug, Clone)]
pub struct ZipEntry {
    pub filename: String,
    pub data: Vec<u8>,
}

/// Borrowed view of an entry in a USDZ zip archive for zero-copy assembly.
#[derive(Debug, Clone, Copy)]
pub struct ZipEntryRef<'a> {
    pub filename: &'a str,
    pub data: &'a [u8],
}

thread_local! {
    static CAPTURE_USDZ_DIRECT: std::cell::Cell<bool> = const { std::cell::Cell::new(false) };
    static STASHED_USDZ_BYTES: std::cell::RefCell<Option<Vec<u8>>> = const { std::cell::RefCell::new(None) };
}

struct DirectCaptureGuard;

impl Drop for DirectCaptureGuard {
    fn drop(&mut self) {
        CAPTURE_USDZ_DIRECT.with(|c| c.set(false));
        STASHED_USDZ_BYTES.with(|s| {
            let _ = s.borrow_mut().take();
        });
    }
}

/// Runs a closure with direct Rust USDZ buffer capture enabled, bypassing the Boa JS heap
/// round-trip.
pub fn with_direct_usdz_capture<F, R>(f: F) -> (R, Option<Vec<u8>>)
where
    F: FnOnce() -> R,
{
    let _guard = DirectCaptureGuard;
    CAPTURE_USDZ_DIRECT.with(|c| c.set(true));
    STASHED_USDZ_BYTES.with(|s| *s.borrow_mut() = None);
    let res = f();
    let captured = STASHED_USDZ_BYTES.with(|s| s.borrow_mut().take());
    (res, captured)
}

/// Creates a Boa `JsUint8Array` from a byte slice with a single exact-sized 64-byte aligned
/// allocation, avoiding `JsUint8Array::from_iter`'s `FlatMap` `size_hint() == 0` reallocation loop.
pub fn js_uint8_array_from_slice(slice: &[u8], context: &mut Context) -> JsResult<JsUint8Array> {
    let mut aligned = boa_engine::object::builtins::AlignedVec::with_capacity(64, slice.len());
    aligned.extend_from_slice(slice);
    let arr_buf = JsArrayBuffer::from_byte_block(aligned, context)?;
    JsUint8Array::from_array_buffer(arr_buf, context)
}

/// Sanitizes a ZIP entry filename to prevent Zip Slip path traversal (`../`, leading `/`)
/// and enforces the 255-byte filename length limit.
pub fn sanitize_zip_filename(name: &str, idx: usize) -> String {
    let segments: Vec<String> = name
        .replace('\\', "/")
        .split('/')
        .filter(|part| !part.is_empty() && *part != "." && *part != "..")
        .map(|seg| {
            seg.chars()
                .filter(|c| c.is_ascii_alphanumeric() || *c == '.' || *c == '_' || *c == '-')
                .collect::<String>()
        })
        .filter(|seg| !seg.is_empty() && seg != "." && seg != "..")
        .collect();
    let joined = segments.join("/");
    if joined.is_empty() {
        format!("file_{}.bin", idx)
    } else if joined.len() > 255 {
        joined[..255].to_string()
    } else {
        joined
    }
}

/// Fallible version of `build_usdz_zip_refs` that enforces entry count, filename length,
/// and total output buffer size limits to prevent integer truncation and OOM aborts.
pub fn try_build_usdz_zip_refs(entries: &[ZipEntryRef<'_>]) -> Result<Vec<u8>, String> {
    if entries.len() > u16::MAX as usize {
        return Err(format!("Too many ZIP entries ({})", entries.len()));
    }

    struct LocalHeaderMeta {
        offset: u32,
        uncompressed_size: u32,
        crc: u32,
        filename_bytes: Vec<u8>,
        extra_padding: u16,
    }

    let mut file_headers = Vec::with_capacity(entries.len());
    let mut current_offset = 0usize;

    for (i, entry) in entries.iter().enumerate() {
        let safe_name = sanitize_zip_filename(entry.filename, i);
        let filename_bytes = safe_name.into_bytes();
        if filename_bytes.len() > u16::MAX as usize {
            return Err(format!("Filename too long in entry {}", i));
        }
        let uncompressed_size = u32::try_from(entry.data.len())
            .map_err(|_| format!("Entry {} data size exceeds 4GB limit", i))?;
        let offset_u32 = u32::try_from(current_offset)
            .map_err(|_| "ZIP archive offset exceeds 4GB limit".to_string())?;

        let crc = calculate_crc32(entry.data);

        let local_header_base = 30 + filename_bytes.len();
        let potential_data_offset = current_offset + local_header_base;
        let rem = potential_data_offset % 64;
        let mut extra_padding = if rem != 0 { 64 - rem } else { 0 };

        // ZIP extra fields require at least 4 bytes for standard sub-header ID and length
        if extra_padding > 0 && extra_padding < 4 {
            extra_padding += 64;
        }

        let header_len = local_header_base + extra_padding;
        file_headers.push(LocalHeaderMeta {
            offset: offset_u32,
            uncompressed_size,
            crc,
            filename_bytes,
            extra_padding: extra_padding as u16,
        });

        current_offset = current_offset
            .checked_add(header_len)
            .and_then(|v| v.checked_add(entry.data.len()))
            .ok_or_else(|| "ZIP archive total size overflow".to_string())?;
    }

    let central_dir_start = current_offset;
    let mut central_dir_size = 0usize;
    for h in &file_headers {
        central_dir_size = central_dir_size
            .checked_add(46 + h.filename_bytes.len())
            .ok_or_else(|| "Central directory size overflow".to_string())?;
    }
    let exact_total_size = central_dir_start
        .checked_add(central_dir_size)
        .and_then(|v| v.checked_add(22))
        .ok_or_else(|| "ZIP total size overflow".to_string())?;

    // Enforce maximum archive size budget (2x heap limit = 32 MB)
    const MAX_USDZ_ARCHIVE_BYTES: usize = crate::constants::SECURITY_3D_MAX_HEAP_BYTES * 2;
    if exact_total_size > MAX_USDZ_ARCHIVE_BYTES {
        return Err(format!(
            "USDZ archive size ({} bytes) exceeds maximum allowed ceiling ({} bytes)",
            exact_total_size, MAX_USDZ_ARCHIVE_BYTES
        ));
    }

    let cd_start_u32 = u32::try_from(central_dir_start)
        .map_err(|_| "Central directory offset exceeds 4GB limit".to_string())?;
    let cd_size_u32 = u32::try_from(central_dir_size)
        .map_err(|_| "Central directory size exceeds 4GB limit".to_string())?;

    let mut output = Vec::with_capacity(exact_total_size);

    for (entry, h) in entries.iter().zip(file_headers.iter()) {
        // 1. Local File Header (30 bytes base + filename + extra padding)
        output.extend_from_slice(&0x04034b50u32.to_le_bytes());
        output.extend_from_slice(&20u16.to_le_bytes());
        output.extend_from_slice(&0u16.to_le_bytes());
        output.extend_from_slice(&0u16.to_le_bytes());
        output.extend_from_slice(&0u32.to_le_bytes());
        output.extend_from_slice(&h.crc.to_le_bytes());
        output.extend_from_slice(&h.uncompressed_size.to_le_bytes());
        output.extend_from_slice(&h.uncompressed_size.to_le_bytes());
        output.extend_from_slice(&(h.filename_bytes.len() as u16).to_le_bytes());
        output.extend_from_slice(&h.extra_padding.to_le_bytes());
        output.extend_from_slice(&h.filename_bytes);

        let extra_pad = h.extra_padding as usize;
        if extra_pad >= 4 {
            output.extend_from_slice(&0x1986u16.to_le_bytes());
            output.extend_from_slice(&((extra_pad - 4) as u16).to_le_bytes());
            output.resize(output.len() + (extra_pad - 4), 0);
        } else if extra_pad > 0 {
            output.resize(output.len() + extra_pad, 0);
        }

        // 2. Payload bytes
        output.extend_from_slice(entry.data);
    }

    // 3. Central Directory Records
    for h in &file_headers {
        output.extend_from_slice(&0x02014b50u32.to_le_bytes());
        output.extend_from_slice(&20u16.to_le_bytes());
        output.extend_from_slice(&20u16.to_le_bytes());
        output.extend_from_slice(&0u16.to_le_bytes());
        output.extend_from_slice(&0u16.to_le_bytes());
        output.extend_from_slice(&0u32.to_le_bytes());
        output.extend_from_slice(&h.crc.to_le_bytes());
        output.extend_from_slice(&h.uncompressed_size.to_le_bytes());
        output.extend_from_slice(&h.uncompressed_size.to_le_bytes());
        output.extend_from_slice(&(h.filename_bytes.len() as u16).to_le_bytes());
        output.extend_from_slice(&0u16.to_le_bytes());
        output.extend_from_slice(&0u16.to_le_bytes());
        output.extend_from_slice(&0u16.to_le_bytes());
        output.extend_from_slice(&0u16.to_le_bytes());
        output.extend_from_slice(&0u32.to_le_bytes());
        output.extend_from_slice(&h.offset.to_le_bytes());
        output.extend_from_slice(&h.filename_bytes);
    }

    // 4. End of Central Directory Record (22 bytes, signature 0x06054b50)
    let entries_count = file_headers.len() as u16;
    output.extend_from_slice(&0x06054b50u32.to_le_bytes());
    output.extend_from_slice(&0u16.to_le_bytes());
    output.extend_from_slice(&0u16.to_le_bytes());
    output.extend_from_slice(&entries_count.to_le_bytes());
    output.extend_from_slice(&entries_count.to_le_bytes());
    output.extend_from_slice(&cd_size_u32.to_le_bytes());
    output.extend_from_slice(&cd_start_u32.to_le_bytes());
    output.extend_from_slice(&0u16.to_le_bytes());

    debug_assert_eq!(output.len(), exact_total_size);
    Ok(output)
}

/// Packs borrowed file slices into a ZIP archive with strict Apple 64-byte payload offset alignment
/// using a single exact-capacity allocation and zero intermediate buffers.
pub fn build_usdz_zip_refs(entries: &[ZipEntryRef<'_>]) -> Vec<u8> {
    try_build_usdz_zip_refs(entries).unwrap_or_default()
}

/// Packs owned `ZipEntry` items into a 64-byte aligned USDZ ZIP archive.
pub fn build_usdz_zip(entries: &[ZipEntry]) -> Vec<u8> {
    let refs: Vec<ZipEntryRef<'_>> =
        entries.iter().map(|e| ZipEntryRef { filename: &e.filename, data: &e.data }).collect();
    build_usdz_zip_refs(&refs)
}

/// Helper to extract binary buffer bytes from either a TypedArray, ArrayBuffer, or Array.
pub fn extract_byte_buffer(val: &JsValue, context: &mut Context) -> Result<Vec<u8>, String> {
    if let Some(obj) = val.as_object() {
        if let Ok(typed_arr) = JsTypedArray::from_object(obj.clone()) {
            let buf_val =
                typed_arr.buffer(context).map_err(|e| format!("Buffer access error: {}", e))?;
            if let Some(buf_obj) = buf_val.as_object() {
                if let Ok(arr_buf) = JsArrayBuffer::from_object(buf_obj.clone()) {
                    if let Some(data) = arr_buf.data() {
                        let offset = typed_arr.byte_offset(context).unwrap_or(0);
                        let len = typed_arr.byte_length(context).unwrap_or(0);
                        let start = offset.min(data.len());
                        let end = offset.saturating_add(len).min(data.len());
                        let slice = &data[start..end];
                        if slice.len() > crate::constants::SECURITY_3D_MAX_HEAP_BYTES {
                            return Err(format!(
                                "Buffer length ({}) exceeds SECURITY_3D_MAX_HEAP_BYTES ({})",
                                slice.len(),
                                crate::constants::SECURITY_3D_MAX_HEAP_BYTES
                            ));
                        }
                        return Ok(slice.to_vec());
                    }
                }
            }
        }
        if let Ok(arr_buf) = JsArrayBuffer::from_object(obj.clone()) {
            if let Some(data) = arr_buf.data() {
                if data.len() > crate::constants::SECURITY_3D_MAX_HEAP_BYTES {
                    return Err(format!(
                        "ArrayBuffer length ({}) exceeds SECURITY_3D_MAX_HEAP_BYTES ({})",
                        data.len(),
                        crate::constants::SECURITY_3D_MAX_HEAP_BYTES
                    ));
                }
                return Ok(data.to_vec());
            }
        }
        if let Ok(js_arr) = JsArray::from_object(obj.clone()) {
            let len = js_arr.length(context).unwrap_or(0) as usize;
            if len > crate::constants::SECURITY_3D_MAX_HEAP_BYTES {
                return Err(format!(
                    "Array length ({}) exceeds SECURITY_3D_MAX_HEAP_BYTES ({})",
                    len,
                    crate::constants::SECURITY_3D_MAX_HEAP_BYTES
                ));
            }
            let mut bytes = Vec::with_capacity(len);
            for i in 0..len {
                let v = js_arr.at(i as i64, context).unwrap_or(JsValue::undefined());
                bytes.push(v.as_number().unwrap_or(0.0) as u8);
            }
            return Ok(bytes);
        }
    }
    Ok(Vec::new())
}

/// Native Boa hook for computing CRC-32 without copying `ArrayBuffer` memory.
pub fn native_crc32(_this: &JsValue, args: &[JsValue], context: &mut Context) -> JsResult<JsValue> {
    if let Some(val) = args.first() {
        if let Some(obj) = val.as_object() {
            if let Ok(typed_arr) = JsTypedArray::from_object(obj.clone()) {
                if let Ok(buf_val) = typed_arr.buffer(context) {
                    if let Some(buf_obj) = buf_val.as_object() {
                        if let Ok(arr_buf) = JsArrayBuffer::from_object(buf_obj.clone()) {
                            let offset = typed_arr.byte_offset(context).unwrap_or(0);
                            let len = typed_arr.byte_length(context).unwrap_or(0);
                            if let Some(data) = arr_buf.data() {
                                let end = offset.saturating_add(len).min(data.len());
                                let start = offset.min(end);
                                let slice = &data[start..end];
                                check_native_input_size(slice.len(), "native_crc32")?;
                                return Ok(JsValue::new(calculate_crc32(slice)));
                            }
                        }
                    }
                }
            } else if let Ok(arr_buf) = JsArrayBuffer::from_object(obj.clone()) {
                if let Some(data) = arr_buf.data() {
                    check_native_input_size(data.len(), "native_crc32")?;
                    return Ok(JsValue::new(calculate_crc32(&data)));
                }
            }
        }
        let bytes =
            extract_byte_buffer(val, context).map_err(|e| JsNativeError::typ().with_message(e))?;
        return Ok(JsValue::new(calculate_crc32(&bytes)));
    }
    Ok(JsValue::new(calculate_crc32(&[])))
}

/// Formats USDA point3f triplets directly from raw IEEE-754 float bytes without intermediate
/// Vec<f32> allocation.
fn format_usda_points_from_bytes(bytes: &[u8]) -> String {
    let pos_count = bytes.len() / 12;
    let mut s = String::with_capacity(pos_count * 32);
    for i in 0..pos_count {
        let base = i * 12;
        let x =
            f32::from_ne_bytes([bytes[base], bytes[base + 1], bytes[base + 2], bytes[base + 3]]);
        let y = f32::from_ne_bytes([
            bytes[base + 4],
            bytes[base + 5],
            bytes[base + 6],
            bytes[base + 7],
        ]);
        let z = f32::from_ne_bytes([
            bytes[base + 8],
            bytes[base + 9],
            bytes[base + 10],
            bytes[base + 11],
        ]);
        s.push('(');
        format_num(x, &mut s);
        s.push_str(", ");
        format_num(y, &mut s);
        s.push_str(", ");
        format_num(z, &mut s);
        s.push(')');
        if i + 1 < pos_count {
            s.push_str(", ");
        }
    }
    s
}

/// Native Boa hook for formatting USDA points directly from JS TypedArray buffers.
pub fn native_format_usda_points(
    _this: &JsValue,
    args: &[JsValue],
    context: &mut Context,
) -> JsResult<JsValue> {
    if let Some(val) = args.first() {
        if let Some(obj) = val.as_object() {
            if let Ok(typed_arr) = JsTypedArray::from_object(obj.clone()) {
                if let Ok(buf_val) = typed_arr.buffer(context) {
                    if let Some(buf_obj) = buf_val.as_object() {
                        if let Ok(arr_buf) = JsArrayBuffer::from_object(buf_obj.clone()) {
                            let offset = typed_arr.byte_offset(context).unwrap_or(0);
                            let len = typed_arr.byte_length(context).unwrap_or(0);
                            if let Some(data) = arr_buf.data() {
                                let end = offset.saturating_add(len).min(data.len());
                                let start = offset.min(end);
                                let slice = &data[start..end];
                                check_native_input_size(slice.len(), "native_format_usda_points")?;
                                let formatted = format_usda_points_from_bytes(slice);
                                return Ok(JsValue::from(js_string!(formatted)));
                            }
                        }
                    }
                }
            }
        }
        let positions = crate::engine::extract_float_buffer(val, context)
            .map_err(|e| JsNativeError::typ().with_message(e))?;
        let formatted = format_usda_points(&positions);
        return Ok(JsValue::from(js_string!(formatted)));
    }
    Ok(JsValue::from(js_string!("")))
}

/// Formats USDA texCoord2f (u, 1 - v) pairs directly from raw IEEE-754 float bytes.
fn format_usda_uvs_from_bytes(bytes: &[u8]) -> String {
    let uv_count = bytes.len() / 8;
    let mut s = String::with_capacity(uv_count * 24);
    for i in 0..uv_count {
        let base = i * 8;
        let u =
            f32::from_ne_bytes([bytes[base], bytes[base + 1], bytes[base + 2], bytes[base + 3]]);
        let v = f32::from_ne_bytes([
            bytes[base + 4],
            bytes[base + 5],
            bytes[base + 6],
            bytes[base + 7],
        ]);
        s.push('(');
        format_num(u, &mut s);
        s.push_str(", ");
        format_num(1.0 - v, &mut s);
        s.push(')');
        if i + 1 < uv_count {
            s.push_str(", ");
        }
    }
    s
}

/// Native Boa hook for formatting USDA UVs directly from JS Float32Array buffers.
pub fn native_format_usda_uvs(
    _this: &JsValue,
    args: &[JsValue],
    context: &mut Context,
) -> JsResult<JsValue> {
    if let Some(val) = args.first() {
        if let Some(obj) = val.as_object() {
            if let Ok(typed_arr) = JsTypedArray::from_object(obj.clone()) {
                if let Ok(buf_val) = typed_arr.buffer(context) {
                    if let Some(buf_obj) = buf_val.as_object() {
                        if let Ok(arr_buf) = JsArrayBuffer::from_object(buf_obj.clone()) {
                            let offset = typed_arr.byte_offset(context).unwrap_or(0);
                            let len = typed_arr.byte_length(context).unwrap_or(0);
                            if let Some(data) = arr_buf.data() {
                                let end = offset.saturating_add(len).min(data.len());
                                let start = offset.min(end);
                                let slice = &data[start..end];
                                check_native_input_size(slice.len(), "native_format_usda_uvs")?;
                                let formatted = format_usda_uvs_from_bytes(slice);
                                return Ok(JsValue::from(js_string!(formatted)));
                            }
                        }
                    }
                }
            }
        }
        let uvs = crate::engine::extract_float_buffer(val, context)
            .map_err(|e| JsNativeError::typ().with_message(e))?;
        let uv_count = uvs.len() / 2;
        let mut s = String::with_capacity(uv_count * 24);
        for i in 0..uv_count {
            s.push('(');
            format_num(uvs[i * 2], &mut s);
            s.push_str(", ");
            format_num(1.0 - uvs[i * 2 + 1], &mut s);
            s.push(')');
            if i + 1 < uv_count {
                s.push_str(", ");
            }
        }
        return Ok(JsValue::from(js_string!(s)));
    }
    Ok(JsValue::from(js_string!("")))
}

/// Native Boa hook for formatting integer index arrays directly from JS Uint16Array/Uint32Array.
pub fn native_format_usda_ints(
    _this: &JsValue,
    args: &[JsValue],
    context: &mut Context,
) -> JsResult<JsValue> {
    if let Some(val) = args.first() {
        if let Some(obj) = val.as_object() {
            if let Ok(typed_arr) = JsTypedArray::from_object(obj.clone()) {
                if let Ok(buf_val) = typed_arr.buffer(context) {
                    if let Some(buf_obj) = buf_val.as_object() {
                        if let Ok(arr_buf) = JsArrayBuffer::from_object(buf_obj.clone()) {
                            let offset = typed_arr.byte_offset(context).unwrap_or(0);
                            let len = typed_arr.byte_length(context).unwrap_or(0);
                            if let Some(data) = arr_buf.data() {
                                let end = offset.saturating_add(len).min(data.len());
                                let start = offset.min(end);
                                let slice = &data[start..end];
                                check_native_input_size(slice.len(), "native_format_usda_ints")?;
                                let kind = typed_arr.kind();
                                if kind
                                    == Some(
                                        boa_engine::builtins::typed_array::TypedArrayKind::Uint16,
                                    )
                                {
                                    let count = slice.len() / 2;
                                    let mut s = String::with_capacity(count * 8);
                                    for (i, c) in slice.as_chunks::<2>().0.iter().enumerate() {
                                        let v = u16::from_ne_bytes([c[0], c[1]]);
                                        s.push_str(&v.to_string());
                                        if i + 1 < count {
                                            s.push_str(", ");
                                        }
                                    }
                                    return Ok(JsValue::from(js_string!(s)));
                                } else {
                                    let count = slice.len() / 4;
                                    let mut s = String::with_capacity(count * 8);
                                    for (i, c) in slice.as_chunks::<4>().0.iter().enumerate() {
                                        let v = u32::from_ne_bytes([c[0], c[1], c[2], c[3]]);
                                        s.push_str(&v.to_string());
                                        if i + 1 < count {
                                            s.push_str(", ");
                                        }
                                    }
                                    return Ok(JsValue::from(js_string!(s)));
                                }
                            }
                        }
                    }
                }
            }
        }
    }
    Ok(JsValue::from(js_string!("")))
}

/// Native Boa hook for assembling a 64-byte aligned USDZ ZIP package with zero entry copies.
pub fn native_build_usdz_zip(
    _this: &JsValue,
    args: &[JsValue],
    context: &mut Context,
) -> JsResult<JsValue> {
    enum RawEntrySource {
        ArrayBuf { buf: JsArrayBuffer, offset: usize, len: usize },
        Owned(Vec<u8>),
    }

    let entries_val =
        args.first().ok_or_else(|| JsNativeError::typ().with_message("Expected entries array"))?;

    let entries_obj = entries_val
        .as_object()
        .ok_or_else(|| JsNativeError::typ().with_message("Entries must be an array"))?;

    let js_arr = JsArray::from_object(entries_obj.clone())
        .map_err(|e| JsNativeError::typ().with_message(format!("Not an array: {}", e)))?;

    let len = js_arr
        .length(context)
        .map_err(|e| JsNativeError::typ().with_message(format!("Array length error: {}", e)))?
        as usize;

    const MAX_ZIP_ENTRIES: usize = 1024;
    if len > MAX_ZIP_ENTRIES {
        return Err(JsNativeError::range()
            .with_message(format!(
                "USDZ archive entry count ({}) exceeds limit ({})",
                len, MAX_ZIP_ENTRIES
            ))
            .into());
    }

    let mut raw_entries = Vec::with_capacity(len);
    for i in 0..len {
        let item_val = js_arr
            .at(i as i64, context)
            .map_err(|e| JsNativeError::typ().with_message(format!("Item error: {}", e)))?;
        let item_obj = item_val.as_object().ok_or_else(|| {
            JsNativeError::typ().with_message(format!("Entry {} must be an object", i))
        })?;

        let raw_filename = item_obj
            .get(js_string!("filename"), context)
            .ok()
            .and_then(|v| v.as_string().map(|s| s.to_std_string_escaped()))
            .unwrap_or_else(|| format!("file_{}", i));
        let filename = sanitize_zip_filename(&raw_filename, i);

        let data_val = item_obj.get(js_string!("data"), context).unwrap_or(JsValue::undefined());

        let mut source_opt = None;
        if let Some(obj) = data_val.as_object() {
            if let Ok(typed_arr) = JsTypedArray::from_object(obj.clone()) {
                if let Ok(buf_val) = typed_arr.buffer(context) {
                    if let Some(buf_obj) = buf_val.as_object() {
                        if let Ok(arr_buf) = JsArrayBuffer::from_object(buf_obj.clone()) {
                            let offset = typed_arr.byte_offset(context).unwrap_or(0);
                            let byte_len = typed_arr.byte_length(context).unwrap_or(0);
                            source_opt = Some(RawEntrySource::ArrayBuf {
                                buf: arr_buf,
                                offset,
                                len: byte_len,
                            });
                        }
                    }
                }
            } else if let Ok(arr_buf) = JsArrayBuffer::from_object(obj.clone()) {
                let byte_len = arr_buf.data().map(|d| d.len()).unwrap_or(0);
                source_opt =
                    Some(RawEntrySource::ArrayBuf { buf: arr_buf, offset: 0, len: byte_len });
            }
        }

        let source = match source_opt {
            Some(s) => s,
            None => {
                let bytes = extract_byte_buffer(&data_val, context).map_err(|e| {
                    JsNativeError::typ().with_message(format!("Entry {} data error: {}", i, e))
                })?;
                RawEntrySource::Owned(bytes)
            }
        };

        raw_entries.push((filename, source));
    }

    // Borrow ArrayBuffer slices in-place and assemble the USDZ ZIP in a single allocation
    let zip_bytes = {
        let borrows: Vec<Option<_>> = raw_entries
            .iter()
            .map(|(_, src)| match src {
                RawEntrySource::ArrayBuf { buf, .. } => buf.data(),
                RawEntrySource::Owned(_) => None,
            })
            .collect();

        let mut zip_refs = Vec::with_capacity(raw_entries.len());
        for ((filename, src), borrow_opt) in raw_entries.iter().zip(borrows.iter()) {
            let slice: &[u8] = match (src, borrow_opt) {
                (RawEntrySource::ArrayBuf { offset, len, .. }, Some(guard)) => {
                    let end = offset.saturating_add(*len).min(guard.len());
                    let start = (*offset).min(end);
                    &guard[start..end]
                }
                (RawEntrySource::Owned(vec), _) => vec.as_slice(),
                _ => &[],
            };
            zip_refs.push(ZipEntryRef { filename: filename.as_str(), data: slice });
        }

        try_build_usdz_zip_refs(&zip_refs).map_err(|e| JsNativeError::range().with_message(e))?
    };

    // If direct Rust capture is active (compile_usdz / glb_to_usdz), stash the Vec<u8>
    // directly without copying it into or out of the Boa JS heap.
    if CAPTURE_USDZ_DIRECT.with(|c| c.get()) {
        STASHED_USDZ_BYTES.with(|s| *s.borrow_mut() = Some(zip_bytes));
        let empty_arr = js_uint8_array_from_slice(&[], context)?;
        return Ok(JsValue::from(empty_arr));
    }

    let uint8_arr = js_uint8_array_from_slice(&zip_bytes, context)?;
    Ok(JsValue::from(uint8_arr))
}

/// Native Boa hook for UTF-8 encoding strings (`TextEncoder.prototype.encode`) in O(1) JS loop
/// iterations so large USDA scene graphs (>250 KB) do not trip Boa's loop iteration limit.
pub fn native_utf8_encode(
    _this: &JsValue,
    args: &[JsValue],
    context: &mut Context,
) -> JsResult<JsValue> {
    let val = args.first().cloned().unwrap_or(JsValue::undefined());
    if val.is_undefined() {
        let empty = js_uint8_array_from_slice(&[], context)?;
        return Ok(JsValue::from(empty));
    }
    let js_str = val.to_string(context)?;
    check_native_input_size(js_str.len(), "native_utf8_encode")?;
    let rust_str = js_str.to_std_string_escaped();
    check_native_input_size(rust_str.len(), "native_utf8_encode")?;
    let arr = js_uint8_array_from_slice(rust_str.as_bytes(), context)?;
    Ok(JsValue::from(arr))
}

/// Native Boa hook for UTF-8 decoding byte buffers (`TextDecoder.prototype.decode`) in O(1) JS
/// loop iterations.
pub fn native_utf8_decode(
    _this: &JsValue,
    args: &[JsValue],
    context: &mut Context,
) -> JsResult<JsValue> {
    let val = args.first().cloned().unwrap_or(JsValue::undefined());
    if val.is_undefined() || val.is_null() {
        return Ok(JsValue::from(js_string!("")));
    }
    let bytes =
        extract_byte_buffer(&val, context).map_err(|e| JsNativeError::typ().with_message(e))?;
    let decoded = String::from_utf8_lossy(&bytes).into_owned();
    Ok(JsValue::from(js_string!(decoded)))
}

/// Registers native USDZ accelerator functions on the Boa global object.
pub fn register_native_usdz_callables(context: &mut Context) -> JsResult<()> {
    context.register_global_builtin_callable(
        js_string!("__three_live_native_crc32__"),
        1,
        NativeFunction::from_fn_ptr(native_crc32),
    )?;
    context.register_global_builtin_callable(
        js_string!("__three_live_native_build_usdz_zip__"),
        1,
        NativeFunction::from_fn_ptr(native_build_usdz_zip),
    )?;
    context.register_global_builtin_callable(
        js_string!("__three_live_native_format_usda_points__"),
        1,
        NativeFunction::from_fn_ptr(native_format_usda_points),
    )?;
    context.register_global_builtin_callable(
        js_string!("__three_live_native_format_usda_uvs__"),
        1,
        NativeFunction::from_fn_ptr(native_format_usda_uvs),
    )?;
    context.register_global_builtin_callable(
        js_string!("__three_live_native_format_usda_ints__"),
        1,
        NativeFunction::from_fn_ptr(native_format_usda_ints),
    )?;
    context.register_global_builtin_callable(
        js_string!("__three_live_native_utf8_encode__"),
        1,
        NativeFunction::from_fn_ptr(native_utf8_encode),
    )?;
    context.register_global_builtin_callable(
        js_string!("__three_live_native_utf8_decode__"),
        1,
        NativeFunction::from_fn_ptr(native_utf8_decode),
    )?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_calculate_crc32() {
        let test_bytes = b"123456789";
        let crc = calculate_crc32(test_bytes);
        assert_eq!(crc, 0xcbf43926);
    }

    #[test]
    fn test_format_usda_points() {
        let positions = vec![0.0f32, 1.0f32, 2.5f32, -1.25f32, 0.0f32, 3.14159f32];
        let formatted = format_usda_points(&positions);
        assert_eq!(formatted, "(0, 1.0, 2.5), (-1.25, 0, 3.14159)");
    }

    #[test]
    fn test_build_usdz_zip_64_byte_alignment() {
        let entry1 = ZipEntry {
            filename: "model.usda".to_string(),
            data: b"#usda 1.0\ndef Xform \"Root\" {}\n".to_vec(),
        };
        let entry2 = ZipEntry {
            filename: "texture.png".to_string(),
            data: vec![0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00],
        };

        let zip = build_usdz_zip(&[entry1, entry2]);
        assert!(zip.len() > 100);

        // Verify alignment of all local headers
        let mut offset = 0;
        let mut entries_found = 0;
        while offset < zip.len() {
            let sig = u32::from_le_bytes([
                zip[offset],
                zip[offset + 1],
                zip[offset + 2],
                zip[offset + 3],
            ]);
            if sig == 0x04034b50 {
                entries_found += 1;
                let fn_len = u16::from_le_bytes([zip[offset + 26], zip[offset + 27]]) as usize;
                let extra_len = u16::from_le_bytes([zip[offset + 28], zip[offset + 29]]) as usize;
                let compressed_size = u32::from_le_bytes([
                    zip[offset + 18],
                    zip[offset + 19],
                    zip[offset + 20],
                    zip[offset + 21],
                ]) as usize;
                let payload_offset = offset + 30 + fn_len + extra_len;
                assert_eq!(
                    payload_offset % 64,
                    0,
                    "Payload offset {} is not 64-byte aligned",
                    payload_offset
                );
                offset = payload_offset + compressed_size;
            } else {
                break;
            }
        }
        assert_eq!(entries_found, 2);
    }

    #[test]
    fn test_direct_usdz_capture_and_from_slice() {
        let mut context = Context::default();
        register_native_usdz_callables(&mut context).unwrap();

        let data = b"hello zero-realloc 64-byte aligned buffer";
        let arr = js_uint8_array_from_slice(data, &mut context).unwrap();
        let extracted = extract_byte_buffer(&arr.into(), &mut context).unwrap();
        assert_eq!(extracted, data);

        // Verify direct USDZ capture bypasses JS heap copy
        let entry1 = ZipEntry {
            filename: "model.usda".to_string(),
            data: b"#usda 1.0\ndef Xform \"Root\" {}\n".to_vec(),
        };
        let expected_zip = build_usdz_zip(&[entry1]);

        let (js_res, captured) = with_direct_usdz_capture(|| {
            // `TextEncoder` is a Web API rather than a JS builtin, so it does not exist in a
            // bare Boa context. Build the byte array directly; the payload is ASCII, so
            // `charCodeAt` is byte-exact.
            let script = r#"
                const text = '#usda 1.0\ndef Xform "Root" {}\n';
                const usda = new Uint8Array(text.length);
                for (let i = 0; i < text.length; i++) { usda[i] = text.charCodeAt(i); }
                __three_live_native_build_usdz_zip__([{ filename: "model.usda", data: usda }]);
            "#;
            context.eval(boa_engine::Source::from_bytes(script.as_bytes())).unwrap()
        });

        let captured_bytes = captured.expect("Direct USDZ bytes should be captured");
        assert_eq!(captured_bytes, expected_zip);

        // The returned JS array during direct capture is intentionally empty (0 bytes)
        let js_returned_bytes = extract_byte_buffer(&js_res, &mut context).unwrap();
        assert!(js_returned_bytes.is_empty());
    }
}
