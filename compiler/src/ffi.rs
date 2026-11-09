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

//! C-ABI exports for mobile / foreign language interoperability and zero-copy operations.

use crate::constants::SECURITY_3D_MAX_SCRIPT_BYTES;
use crate::{
    transcode_glb_to_usdz, transcode_three_to_glb, transcode_three_to_usdz, ConversionResult,
};
use std::collections::{HashMap, HashSet};
use std::ffi::CString;
use std::os::raw::c_char;
use std::sync::{Mutex, OnceLock};

static ALLOCATED_FFI_BUFFERS: OnceLock<Mutex<HashMap<usize, usize>>> = OnceLock::new();
static ALLOCATED_FFI_ERRORS: OnceLock<Mutex<HashSet<usize>>> = OnceLock::new();

fn lock_ffi_buffers() -> std::sync::MutexGuard<'static, HashMap<usize, usize>> {
    ALLOCATED_FFI_BUFFERS
        .get_or_init(|| Mutex::new(HashMap::new()))
        .lock()
        .unwrap_or_else(|p| p.into_inner())
}

fn lock_ffi_errors() -> std::sync::MutexGuard<'static, HashSet<usize>> {
    ALLOCATED_FFI_ERRORS
        .get_or_init(|| Mutex::new(HashSet::new()))
        .lock()
        .unwrap_or_else(|p| p.into_inner())
}

/// Representation of a zero-copy memory buffer allocated by Rust.
#[repr(C)]
#[derive(Debug)]
pub struct ThreeLiveGlbBuffer {
    pub data: *mut u8,
    pub len: usize,
    pub capacity: usize,
    pub error_msg: *mut c_char,
}

pub type ThreeLiveBuffer = ThreeLiveGlbBuffer;

impl ThreeLiveGlbBuffer {
    pub fn empty() -> Self {
        Self { data: std::ptr::null_mut(), len: 0, capacity: 0, error_msg: std::ptr::null_mut() }
    }

    pub fn with_error(msg: &str) -> Self {
        let sanitized: Vec<u8> = msg.as_bytes().iter().copied().filter(|&b| b != 0).collect();
        // Safe: all interior NUL bytes were filtered out above.
        let c_err = unsafe { CString::from_vec_unchecked(sanitized) };
        let raw_ptr = c_err.into_raw();
        lock_ffi_errors().insert(raw_ptr as usize);
        Self { data: std::ptr::null_mut(), len: 0, capacity: 0, error_msg: raw_ptr }
    }

    pub fn from_vec(bytes: Vec<u8>) -> Self {
        if bytes.is_empty() {
            return Self::empty();
        }
        let boxed = bytes.into_boxed_slice();
        let len = boxed.len();
        let data = Box::into_raw(boxed) as *mut u8;
        lock_ffi_buffers().insert(data as usize, len);
        Self { data, len, capacity: len, error_msg: std::ptr::null_mut() }
    }
}

/// Borrows a caller-provided C script as UTF-8, enforcing the script size ceiling.
///
/// The engine applies `SECURITY_3D_MAX_SCRIPT_BYTES` itself, but applying it here too
/// keeps the FFI surface symmetric with the input ceiling already enforced by
/// `three_live_glb_to_usdz`, and avoids running a multi-megabyte UTF-8 validation pass
/// over input that is guaranteed to be rejected. The terminator scan is bounded
/// (`strnlen`-style) so an oversized script is rejected without walking all of it.
///
/// # Safety
/// `script` must be a valid, null-terminated C string.
unsafe fn borrow_script<'a>(script: *const c_char) -> Result<&'a str, ThreeLiveGlbBuffer> {
    let max_scan = SECURITY_3D_MAX_SCRIPT_BYTES + 1;
    let base = script as *const u8;
    let mut len = 0usize;
    while len < max_scan {
        if *base.add(len) == 0 {
            break;
        }
        len += 1;
    }
    if len > SECURITY_3D_MAX_SCRIPT_BYTES {
        return Err(ThreeLiveGlbBuffer::with_error(&format!(
            "Script length (>= {}) exceeds SECURITY_3D_MAX_SCRIPT_BYTES ({})",
            len, SECURITY_3D_MAX_SCRIPT_BYTES
        )));
    }
    let raw = std::slice::from_raw_parts(base, len);
    match std::str::from_utf8(raw) {
        Ok(s) => Ok(s),
        Err(_) => Err(ThreeLiveGlbBuffer::with_error("Script is not valid UTF-8")),
    }
}

/// Compiles a procedural Three.js scene script into a binary GLB wire buffer.
///
/// # Safety
/// `script` must be a valid, null-terminated C string or null.
#[no_mangle]
pub unsafe extern "C" fn three_live_compile(script: *const c_char) -> ThreeLiveGlbBuffer {
    std::panic::catch_unwind(|| {
        if script.is_null() {
            return ThreeLiveGlbBuffer::with_error("Null script pointer provided");
        }
        let script_str = match borrow_script(script) {
            Ok(s) => s,
            Err(buf) => return buf,
        };

        match transcode_three_to_glb(script_str) {
            Ok(bytes) => ThreeLiveGlbBuffer::from_vec(bytes),
            Err(err) => ThreeLiveGlbBuffer::with_error(&err),
        }
    })
    .unwrap_or_else(|_| {
        ThreeLiveGlbBuffer::with_error("Internal compiler panic caught safely at FFI boundary")
    })
}

/// Compiles a procedural Three.js scene script directly into a binary USDZ wire buffer.
///
/// # Safety
/// `script` must be a valid, null-terminated C string or null.
#[no_mangle]
pub unsafe extern "C" fn three_live_compile_usdz(script: *const c_char) -> ThreeLiveBuffer {
    std::panic::catch_unwind(|| {
        if script.is_null() {
            return ThreeLiveBuffer::with_error("Null script pointer provided");
        }
        let script_str = match borrow_script(script) {
            Ok(s) => s,
            Err(buf) => return buf,
        };

        match transcode_three_to_usdz(script_str) {
            Ok(bytes) => ThreeLiveBuffer::from_vec(bytes),
            Err(err) => ThreeLiveBuffer::with_error(&err),
        }
    })
    .unwrap_or_else(|_| {
        ThreeLiveBuffer::with_error("Internal compiler panic caught safely at FFI boundary")
    })
}

/// Transcodes a binary GLB model into a binary USDZ wire buffer.
///
/// # Safety
/// `data` must point to a valid buffer of `len` bytes, or `data` must be null with `len == 0`.
#[no_mangle]
pub unsafe extern "C" fn three_live_glb_to_usdz(data: *const u8, len: usize) -> ThreeLiveBuffer {
    std::panic::catch_unwind(|| {
        if data.is_null() || len == 0 {
            return ThreeLiveBuffer::with_error("Null or empty GLB data provided");
        }
        if len > 16 * 1024 * 1024 {
            return ThreeLiveBuffer::with_error("GLB input exceeds maximum allowed size (16 MB)");
        }
        let glb_slice = std::slice::from_raw_parts(data, len);
        match transcode_glb_to_usdz(glb_slice) {
            Ok(bytes) => ThreeLiveBuffer::from_vec(bytes),
            Err(err) => ThreeLiveBuffer::with_error(&err),
        }
    })
    .unwrap_or_else(|_| {
        ThreeLiveBuffer::with_error("Internal compiler panic caught safely at FFI boundary")
    })
}

/// Frees a GLB wire buffer previously allocated by `three_live_compile`.
///
/// Ownership is checked against `ALLOCATED_FFI_BUFFERS` and the recorded allocation
/// length is used instead of the caller's `capacity`, so pointers this library never
/// handed out (or already freed, until the allocator reuses the address) are ignored
/// rather than corrupting the heap. This is defense in depth, not a substitute for
/// the caller contract below.
///
/// # Safety
/// Must only be called with `data` returned by `three_live_compile`.
#[no_mangle]
pub unsafe extern "C" fn three_live_free_buffer(data: *mut u8, _capacity: usize) {
    if !data.is_null() {
        let _ = std::panic::catch_unwind(|| {
            if let Some(alloc_len) = lock_ffi_buffers().remove(&(data as usize)) {
                let _ = Box::from_raw(std::ptr::slice_from_raw_parts_mut(data, alloc_len));
            }
        });
    }
}

/// Frees an error message string previously allocated by `three_live_compile`.
///
/// Validates ownership against `ALLOCATED_FFI_ERRORS` to prevent double-free UB.
///
/// # Safety
/// Must only be called with `error_msg` returned by `three_live_compile`.
#[no_mangle]
pub unsafe extern "C" fn three_live_free_error(error_msg: *mut c_char) {
    if !error_msg.is_null() {
        let _ = std::panic::catch_unwind(|| {
            if lock_ffi_errors().remove(&(error_msg as usize)) {
                let _ = CString::from_raw(error_msg);
            }
        });
    }
}

/// Runs one AI scene-editing / voice-protocol request (see [`crate::ai_edit::ai_call`]).
///
/// `request` is a NUL-terminated UTF-8 JSON object such as
/// `{"op":"validate","code":"...","selection":"Roof","instruction":"make it red"}`. Returns a
/// newly allocated NUL-terminated JSON string (never null); free it with
/// `three_live_free_string`. Malformed input yields `{"error":"..."}`.
///
/// Ops that compile scripts (`validate`) use the calling thread's warm JS engine, so call this
/// from the same large-stack worker thread used for `three_live_compile`.
///
/// # Safety
/// `request` must be a valid, null-terminated C string or null.
#[no_mangle]
pub unsafe extern "C" fn three_live_ai_call(request: *const c_char) -> *mut c_char {
    let response = if request.is_null() {
        "{\"error\":\"null request\"}".to_string()
    } else {
        // Requests carry whole scene scripts, so allow the script ceiling plus JSON overhead.
        let max_scan = SECURITY_3D_MAX_SCRIPT_BYTES * 2 + 65_536;
        let base = request as *const u8;
        let mut len = 0usize;
        while len < max_scan && *base.add(len) != 0 {
            len += 1;
        }
        if len >= max_scan {
            "{\"error\":\"request too large\"}".to_string()
        } else {
            match std::str::from_utf8(std::slice::from_raw_parts(base, len)) {
                Ok(text) => std::panic::catch_unwind(|| crate::ai_edit::ai_call(text))
                    .unwrap_or_else(|_| "{\"error\":\"internal panic\"}".to_string()),
                Err(_) => "{\"error\":\"request is not valid UTF-8\"}".to_string(),
            }
        }
    };
    ThreeLiveGlbBuffer::with_error(&response).error_msg
}

/// Frees a string returned by `three_live_ai_call` (same allocator as `three_live_free_error`).
///
/// # Safety
/// Must only be called with a pointer returned by `three_live_ai_call`.
#[no_mangle]
pub unsafe extern "C" fn three_live_free_string(s: *mut c_char) {
    three_live_free_error(s);
}

/// High-level struct-returning conversion for FFI callers.
pub fn three_live_convert(script: &str) -> ConversionResult {
    match transcode_three_to_glb(script) {
        Ok(bytes) => {
            ConversionResult { success: true, glb_bytes: bytes, error_message: String::new() }
        }
        Err(err) => ConversionResult { success: false, glb_bytes: Vec::new(), error_message: err },
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::ffi::CStr;
    use std::slice;

    #[test]
    fn ai_call_round_trips_json_and_frees() {
        unsafe {
            let req =
                CString::new(r#"{"op":"extract","reply":"```js\nscene.add(x)\n```"}"#).unwrap();
            let out = three_live_ai_call(req.as_ptr());
            assert!(!out.is_null());
            let text = CStr::from_ptr(out).to_str().unwrap().to_string();
            three_live_free_string(out);
            assert_eq!(text, r#"{"code":"scene.add(x)"}"#);
            // Double free is ignored.
            three_live_free_string(out);
            let null_out = three_live_ai_call(std::ptr::null());
            assert!(CStr::from_ptr(null_out).to_str().unwrap().contains("null request"));
            three_live_free_string(null_out);
            let bad = CString::new("{").unwrap();
            let bad_out = three_live_ai_call(bad.as_ptr());
            assert!(CStr::from_ptr(bad_out).to_str().unwrap().contains("invalid request JSON"));
            three_live_free_string(bad_out);
        }
    }

    #[test]
    fn test_c_abi_compile_success_and_free() {
        let script = CString::new(
            "const g = new THREE.BoxGeometry(1, 1, 1);\nconst m = new THREE.MeshBasicMaterial();\nscene.add(new THREE.Mesh(g, m));",
        )
        .unwrap();
        unsafe {
            let buf = three_live_compile(script.as_ptr());
            assert!(!buf.data.is_null());
            assert!(buf.len > 12);
            assert!(buf.capacity >= buf.len);
            assert!(buf.error_msg.is_null());

            // Verify GLB magic header "glTF"
            let bytes = slice::from_raw_parts(buf.data, buf.len);
            assert_eq!(&bytes[0..4], b"glTF");

            // Clean up
            three_live_free_buffer(buf.data, buf.capacity);
        }
    }

    #[test]
    fn test_c_abi_compile_error_handling() {
        let script = CString::new("this is invalid syntax !!!").unwrap();
        unsafe {
            let buf = three_live_compile(script.as_ptr());
            assert!(buf.data.is_null());
            assert_eq!(buf.len, 0);
            assert!(!buf.error_msg.is_null());

            let err = CStr::from_ptr(buf.error_msg).to_str().unwrap();
            assert!(!err.is_empty());

            three_live_free_error(buf.error_msg);
        }
    }

    #[test]
    fn test_c_abi_null_pointer_safety() {
        unsafe {
            let buf = three_live_compile(std::ptr::null());
            assert!(buf.data.is_null());
            assert!(!buf.error_msg.is_null());

            let err = CStr::from_ptr(buf.error_msg).to_str().unwrap();
            assert!(err.contains("Null script"));

            three_live_free_error(buf.error_msg);
        }
    }

    #[test]
    fn test_c_abi_compile_usdz_success_and_free() {
        let script = CString::new(
            "const g = new THREE.BoxGeometry(1, 1, 1);\nconst m = new THREE.MeshBasicMaterial();\nscene.add(new THREE.Mesh(g, m));",
        )
        .unwrap();
        unsafe {
            let buf = three_live_compile_usdz(script.as_ptr());
            assert!(!buf.data.is_null());
            assert!(buf.len > 100);
            assert!(buf.capacity >= buf.len);
            assert!(buf.error_msg.is_null());

            // Verify ZIP magic "PK\x03\x04"
            let bytes = slice::from_raw_parts(buf.data, buf.len);
            assert_eq!(&bytes[0..4], b"PK\x03\x04");

            // Clean up
            three_live_free_buffer(buf.data, buf.capacity);
        }
    }

    #[test]
    fn test_c_abi_glb_to_usdz_success_and_free() {
        let script = CString::new(
            "const g = new THREE.BoxGeometry(1, 1, 1);\nconst m = new THREE.MeshBasicMaterial();\nscene.add(new THREE.Mesh(g, m));",
        )
        .unwrap();
        unsafe {
            let glb_buf = three_live_compile(script.as_ptr());
            assert!(!glb_buf.data.is_null());

            let usdz_buf = three_live_glb_to_usdz(glb_buf.data, glb_buf.len);
            assert!(!usdz_buf.data.is_null());
            assert!(usdz_buf.len > 100);
            assert!(usdz_buf.error_msg.is_null());

            let bytes = slice::from_raw_parts(usdz_buf.data, usdz_buf.len);
            assert_eq!(&bytes[0..4], b"PK\x03\x04");

            three_live_free_buffer(glb_buf.data, glb_buf.capacity);
            three_live_free_buffer(usdz_buf.data, usdz_buf.capacity);
        }
    }

    #[test]
    fn test_borrow_script_enforces_ceiling_at_the_ffi_boundary() {
        unsafe {
            let oversized = CString::new("a".repeat(SECURITY_3D_MAX_SCRIPT_BYTES + 1)).unwrap();
            let err_buf =
                borrow_script(oversized.as_ptr()).expect_err("oversized script must be rejected");
            let err = CStr::from_ptr(err_buf.error_msg).to_str().unwrap();
            assert!(
                err.contains(&(SECURITY_3D_MAX_SCRIPT_BYTES + 1).to_string()),
                "error should report the actual script length: {}",
                err
            );
            three_live_free_error(err_buf.error_msg);

            let at_limit = CString::new("a".repeat(SECURITY_3D_MAX_SCRIPT_BYTES)).unwrap();
            let accepted =
                borrow_script(at_limit.as_ptr()).expect("script at the limit must be accepted");
            assert_eq!(accepted.len(), SECURITY_3D_MAX_SCRIPT_BYTES);

            let invalid_utf8 = CString::new(vec![0xffu8, 0xfe]).unwrap();
            let utf8_err =
                borrow_script(invalid_utf8.as_ptr()).expect_err("invalid UTF-8 must be rejected");
            let utf8_msg = CStr::from_ptr(utf8_err.error_msg).to_str().unwrap();
            assert!(utf8_msg.contains("UTF-8"), "unexpected error message: {}", utf8_msg);
            three_live_free_error(utf8_err.error_msg);
        }
    }

    #[test]
    fn test_c_abi_rejects_oversized_script() {
        let oversized = "a".repeat(SECURITY_3D_MAX_SCRIPT_BYTES + 1);
        let script = CString::new(oversized).unwrap();
        unsafe {
            for buf in
                [three_live_compile(script.as_ptr()), three_live_compile_usdz(script.as_ptr())]
            {
                assert!(buf.data.is_null());
                assert_eq!(buf.len, 0);
                assert!(!buf.error_msg.is_null());

                let err = CStr::from_ptr(buf.error_msg).to_str().unwrap();
                assert!(
                    err.contains("SECURITY_3D_MAX_SCRIPT_BYTES"),
                    "unexpected error message: {}",
                    err
                );

                three_live_free_error(buf.error_msg);
            }
        }
    }

    #[test]
    fn test_c_abi_script_at_size_limit_passes_the_guard() {
        // A script exactly at the ceiling must not be rejected by the size guard; it is
        // padded with a trailing comment so the engine sees syntactically valid input.
        let prefix = "const g = new THREE.BoxGeometry(1, 1, 1);\nconst m = new THREE.MeshBasicMaterial();\nscene.add(new THREE.Mesh(g, m));\n// ";
        let padding = SECURITY_3D_MAX_SCRIPT_BYTES - prefix.len();
        let script = CString::new(format!("{}{}", prefix, "a".repeat(padding))).unwrap();
        assert_eq!(script.as_bytes().len(), SECURITY_3D_MAX_SCRIPT_BYTES);
        unsafe {
            let buf = three_live_compile(script.as_ptr());
            if !buf.error_msg.is_null() {
                let err = CStr::from_ptr(buf.error_msg).to_str().unwrap();
                assert!(
                    !err.contains("SECURITY_3D_MAX_SCRIPT_BYTES"),
                    "script at the limit was rejected by the size guard: {}",
                    err
                );
                three_live_free_error(buf.error_msg);
            } else {
                three_live_free_buffer(buf.data, buf.capacity);
            }
        }
    }

    #[test]
    fn test_c_abi_rejects_double_free_and_forged_pointers() {
        let script = CString::new(
            "const g = new THREE.BoxGeometry(1, 1, 1);\nconst m = new THREE.MeshBasicMaterial();\nscene.add(new THREE.Mesh(g, m));",
        )
        .unwrap();
        unsafe {
            let buf = three_live_compile(script.as_ptr());
            assert!(!buf.data.is_null());
            // First free succeeds; second free with same pointer or forged capacity is a safe
            // no-op.
            three_live_free_buffer(buf.data, buf.capacity + 9999);
            three_live_free_buffer(buf.data, buf.capacity);
            three_live_free_buffer(0xDEADBEEF as *mut u8, 64);

            let err_buf = three_live_compile(std::ptr::null());
            assert!(!err_buf.error_msg.is_null());
            three_live_free_error(err_buf.error_msg);
            three_live_free_error(err_buf.error_msg);
            three_live_free_error(0xDEADBEEF as *mut c_char);
        }
    }
}
