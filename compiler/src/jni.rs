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

//! JNI exports for Android integration and zero-copy DirectByteBuffer operations.

use jni::objects::{JByteBuffer, JClass, JString};
use jni::sys::{jbyteArray, jlong, jobject, jstring};
use jni::JNIEnv;
use std::collections::HashMap;
use std::sync::{Mutex, OnceLock};

static ALLOCATED_BUFFERS: OnceLock<Mutex<HashMap<usize, usize>>> = OnceLock::new();

fn buffer_registry() -> &'static Mutex<HashMap<usize, usize>> {
    ALLOCATED_BUFFERS.get_or_init(|| Mutex::new(HashMap::new()))
}

/// Locks the registry, recovering from poisoning.
///
/// The map holds nothing but `(address, length)` integers, so there is no broken
/// invariant for a poisoned lock to protect. Honoring the poison instead would be
/// actively harmful: `register_direct_buffer` discards the error, so a single panic
/// anywhere under the lock would silently leak every buffer allocated from then on.
fn lock_buffer_registry() -> std::sync::MutexGuard<'static, HashMap<usize, usize>> {
    buffer_registry().lock().unwrap_or_else(|poisoned| poisoned.into_inner())
}

pub(crate) fn register_direct_buffer(ptr: *mut u8, len: usize) {
    lock_buffer_registry().insert(ptr as usize, len);
}

fn unregister_direct_buffer(address: usize) -> Option<usize> {
    lock_buffer_registry().remove(&address)
}

/// Compiles a Three.js scene script into a zero-copy direct `java.nio.ByteBuffer`.
///
/// Ownership: The native heap memory backing the returned direct buffer is owned
/// by the caller and must be deallocated using `nativeFreeDirectBuffer(address, capacity)`.
///
/// # Safety
/// Standard JNI entry point dynamically discovered by Android ART / JVM.
#[no_mangle]
pub unsafe extern "system" fn Java_com_google_threelive_ThreeCompiler_compileToDirectBuffer<
    'local,
>(
    mut env: JNIEnv<'local>,
    _class: JClass<'local>,
    script: JString<'local>,
) -> jobject {
    let outer = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        if script.is_null() {
            let _ = env.throw_new("java/lang/IllegalArgumentException", "Script must not be null");
            return std::ptr::null_mut();
        }

        let script_str: String = match env.get_string(&script) {
            Ok(jstr) => {
                if jstr.to_bytes().len() > crate::constants::SECURITY_3D_MAX_SCRIPT_BYTES {
                    let _ = env.throw_new(
                        "com/google/threelive/ThreeCompilerException",
                        format!(
                            "Script length ({} bytes) exceeds SECURITY_3D_MAX_SCRIPT_BYTES ({})",
                            jstr.to_bytes().len(),
                            crate::constants::SECURITY_3D_MAX_SCRIPT_BYTES
                        ),
                    );
                    return std::ptr::null_mut();
                }
                jstr.into()
            }
            Err(e) => {
                let _ = env.throw_new(
                    "java/lang/IllegalArgumentException",
                    format!("Invalid UTF-8 script: {:?}", e),
                );
                return std::ptr::null_mut();
            }
        };

        let compile_res = crate::transcode_three_to_glb(&script_str);

        match compile_res {
            Ok(bytes) => {
                if bytes.is_empty() {
                    let _ = env.throw_new(
                        "com/google/threelive/ThreeCompilerException",
                        "Compilation produced empty GLB output",
                    );
                    return std::ptr::null_mut();
                }
                let boxed = bytes.into_boxed_slice();
                let len = boxed.len();
                let ptr = Box::into_raw(boxed) as *mut u8;
                register_direct_buffer(ptr, len);

                match env.new_direct_byte_buffer(ptr, len) {
                    Ok(byte_buf) => byte_buf.into_raw(),
                    Err(e) => {
                        if let Some(alloc_len) = unregister_direct_buffer(ptr as usize) {
                            let _ =
                                Box::from_raw(std::ptr::slice_from_raw_parts_mut(ptr, alloc_len));
                        }
                        let _ = env.throw_new(
                            "java/lang/OutOfMemoryError",
                            format!("Failed to create direct ByteBuffer: {:?}", e),
                        );
                        std::ptr::null_mut()
                    }
                }
            }
            Err(err) => {
                if env.throw_new("com/google/threelive/ThreeCompilerException", &err).is_err() {
                    let _ = env.throw_new("java/lang/RuntimeException", err);
                }
                std::ptr::null_mut()
            }
        }
    }));

    match outer {
        Ok(ptr) => ptr,
        Err(_) => {
            let _ = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
                if env
                    .throw_new(
                        "com/google/threelive/ThreeCompilerException",
                        "3D Transcoder encountered an internal panic",
                    )
                    .is_err()
                {
                    let _ = env.throw_new(
                        "java/lang/RuntimeException",
                        "3D Transcoder encountered an internal panic",
                    );
                }
            }));
            std::ptr::null_mut()
        }
    }
}

/// Compiles a Three.js scene script into a standard Java heap `byte[]` array.
///
/// Note: Incurs a memory copy across the JNI boundary. For performance-critical
/// 3D rendering (e.g. Filament), prefer `compileToDirectBuffer`.
///
/// # Safety
/// Standard JNI entry point dynamically discovered by Android ART / JVM.
#[no_mangle]
pub unsafe extern "system" fn Java_com_google_threelive_ThreeCompiler_compileToByteArray<'local>(
    mut env: JNIEnv<'local>,
    _class: JClass<'local>,
    script: JString<'local>,
) -> jbyteArray {
    let outer = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        if script.is_null() {
            let _ = env.throw_new("java/lang/IllegalArgumentException", "Script must not be null");
            return std::ptr::null_mut();
        }

        let script_str: String = match env.get_string(&script) {
            Ok(jstr) => {
                if jstr.to_bytes().len() > crate::constants::SECURITY_3D_MAX_SCRIPT_BYTES {
                    let _ = env.throw_new(
                        "com/google/threelive/ThreeCompilerException",
                        format!(
                            "Script length ({} bytes) exceeds SECURITY_3D_MAX_SCRIPT_BYTES ({})",
                            jstr.to_bytes().len(),
                            crate::constants::SECURITY_3D_MAX_SCRIPT_BYTES
                        ),
                    );
                    return std::ptr::null_mut();
                }
                jstr.into()
            }
            Err(e) => {
                let _ = env.throw_new(
                    "java/lang/IllegalArgumentException",
                    format!("Invalid UTF-8 script: {:?}", e),
                );
                return std::ptr::null_mut();
            }
        };

        let compile_res = crate::transcode_three_to_glb(&script_str);

        match compile_res {
            Ok(bytes) => {
                if bytes.is_empty() {
                    let _ = env.throw_new(
                        "com/google/threelive/ThreeCompilerException",
                        "Compilation produced empty GLB output",
                    );
                    return std::ptr::null_mut();
                }
                match env.byte_array_from_slice(&bytes) {
                    Ok(arr) => arr.into_raw(),
                    Err(e) => {
                        let _ = env.throw_new(
                            "java/lang/OutOfMemoryError",
                            format!("Failed to allocate jbyteArray: {:?}", e),
                        );
                        std::ptr::null_mut()
                    }
                }
            }
            Err(err) => {
                if env.throw_new("com/google/threelive/ThreeCompilerException", &err).is_err() {
                    let _ = env.throw_new("java/lang/RuntimeException", err);
                }
                std::ptr::null_mut()
            }
        }
    }));

    match outer {
        Ok(arr) => arr,
        Err(_) => {
            let _ = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
                if env
                    .throw_new(
                        "com/google/threelive/ThreeCompilerException",
                        "3D Transcoder encountered an internal panic",
                    )
                    .is_err()
                {
                    let _ = env.throw_new(
                        "java/lang/RuntimeException",
                        "3D Transcoder encountered an internal panic",
                    );
                }
            }));
            std::ptr::null_mut()
        }
    }
}

/// Runs one AI scene-editing / voice-protocol JSON request (see `crate::ai_edit::ai_call`).
///
/// Always returns a JSON string (`{"error": ...}` on bad input or an internal panic). Ops that
/// compile scripts use this thread's warm JS engine, like `compileToByteArray`.
///
/// # Safety
/// Standard JNI entry point dynamically discovered by Android ART / JVM.
#[no_mangle]
pub unsafe extern "system" fn Java_com_google_threelive_ThreeCompiler_nativeAiCall<'local>(
    mut env: JNIEnv<'local>,
    _class: JClass<'local>,
    request: JString<'local>,
) -> jstring {
    let response = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        if request.is_null() {
            return "{\"error\":\"null request\"}".to_string();
        }
        match env.get_string(&request) {
            Ok(jstr) => {
                if jstr.to_bytes().len()
                    > crate::constants::SECURITY_3D_MAX_SCRIPT_BYTES * 2 + 65_536
                {
                    return "{\"error\":\"request too large\"}".to_string();
                }
                let text: String = jstr.into();
                crate::ai_edit::ai_call(&text)
            }
            Err(_) => "{\"error\":\"request is not valid UTF-8\"}".to_string(),
        }
    }))
    .unwrap_or_else(|_| "{\"error\":\"internal panic\"}".to_string());
    match env.new_string(response) {
        Ok(s) => s.into_raw(),
        Err(_) => std::ptr::null_mut(),
    }
}

/// Deallocates the native heap buffer backing a direct ByteBuffer via standard dynamic JNI.
///
/// # Safety
/// `address` must be the non-null native address of a buffer allocated by `compileToDirectBuffer`.
#[no_mangle]
pub unsafe extern "system" fn Java_com_google_threelive_ThreeCompiler_nativeFreeDirectBuffer<
    'local,
>(
    _env: JNIEnv<'local>,
    _class: JClass<'local>,
    address: jlong,
    capacity: jlong,
) {
    three_live_critical_free_buffer(address, capacity);
}

/// Retrieves the native memory address backing a direct ByteBuffer.
///
/// # Safety
/// Standard JNI entry point discovered by Android ART / JVM.
#[no_mangle]
pub unsafe extern "system" fn Java_com_google_threelive_ThreeCompiler_nativeGetDirectBufferAddress<
    'local,
>(
    env: JNIEnv<'local>,
    _class: JClass<'local>,
    buffer: JByteBuffer<'local>,
) -> jlong {
    std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        if buffer.is_null() {
            return 0;
        }
        match env.get_direct_buffer_address(&buffer) {
            Ok(ptr) => ptr as jlong,
            Err(_) => 0,
        }
    }))
    .unwrap_or(0)
}

/// Fast native deallocation entry point for `nativeFreeDirectBuffer` and direct
/// native C callers.
///
/// Skips JNIEnv / jclass passing and validates ownership against `ALLOCATED_BUFFERS`
/// to prevent double-free or sized-deallocation undefined behavior.
///
/// > **Not `@CriticalNative`-safe.** A `@CriticalNative` method executes without
/// > transitioning the calling thread out of the `Runnable` state, which means the
/// > GC cannot suspend it. This function takes the `ALLOCATED_BUFFERS` mutex, and
/// > blocking on a lock inside that window can stall garbage collection across the
/// > whole app — or deadlock outright against a thread the GC is waiting on. Register
/// > it as a normal JNI method (as `nativeFreeDirectBuffer` does) and keep the
/// > ownership check; the check is the part worth having.
///
/// # Safety
/// `address` must be the non-null native address of a buffer allocated by `compileToDirectBuffer`.
#[no_mangle]
pub unsafe extern "C" fn three_live_critical_free_buffer(address: jlong, _capacity: jlong) {
    if address != 0 {
        let _ = std::panic::catch_unwind(|| {
            if let Some(alloc_len) = unregister_direct_buffer(address as usize) {
                let ptr = address as *mut u8;
                let _ = Box::from_raw(std::ptr::slice_from_raw_parts_mut(ptr, alloc_len));
            }
        });
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_critical_free_buffer_safety() {
        let data = vec![1u8, 2, 3, 4, 5];
        let boxed = data.into_boxed_slice();
        let len = boxed.len();
        let ptr = Box::into_raw(boxed) as *mut u8;
        register_direct_buffer(ptr, len);

        unsafe {
            // Valid deallocation
            three_live_critical_free_buffer(ptr as jlong, len as jlong);
            // Double-free attempt is safely ignored
            three_live_critical_free_buffer(ptr as jlong, len as jlong);
            // Null or invalid address attempts are safely ignored
            three_live_critical_free_buffer(0, 100);
            three_live_critical_free_buffer(ptr as jlong, 0);
            three_live_critical_free_buffer(-1, 100);
        }
    }
}
