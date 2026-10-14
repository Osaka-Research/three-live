/*
 * Copyright 2026 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

package com.google.threelive.gemini

/**
 * Standard (RFC 4648 section 4) base64 with padding.
 *
 * `java.util.Base64` needs API 26 and `android.util.Base64` is stubbed in JVM unit tests, so the
 * Gemini client carries this small codec instead.
 */
object LiveBase64 {

  private const val ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/"

  private val DECODE =
    IntArray(128) { -1 }.also { table -> ALPHABET.forEachIndexed { i, c -> table[c.code] = i } }

  /** Encodes [bytes] (or the `[offset, offset + length)` slice) to base64. */
  @JvmStatic
  @JvmOverloads
  fun encode(bytes: ByteArray, offset: Int = 0, length: Int = bytes.size - offset): String {
    require(offset >= 0 && length >= 0 && offset + length <= bytes.size) { "Bad slice" }
    val out = StringBuilder((length + 2) / 3 * 4)
    var i = offset
    val end = offset + length
    while (i + 3 <= end) {
      val n =
        ((bytes[i].toInt() and 0xFF) shl 16) or
          ((bytes[i + 1].toInt() and 0xFF) shl 8) or
          (bytes[i + 2].toInt() and 0xFF)
      out.append(ALPHABET[n ushr 18])
      out.append(ALPHABET[(n ushr 12) and 63])
      out.append(ALPHABET[(n ushr 6) and 63])
      out.append(ALPHABET[n and 63])
      i += 3
    }
    val rem = end - i
    if (rem == 1) {
      val n = (bytes[i].toInt() and 0xFF) shl 16
      out.append(ALPHABET[n ushr 18])
      out.append(ALPHABET[(n ushr 12) and 63])
      out.append("==")
    } else if (rem == 2) {
      val n = ((bytes[i].toInt() and 0xFF) shl 16) or ((bytes[i + 1].toInt() and 0xFF) shl 8)
      out.append(ALPHABET[n ushr 18])
      out.append(ALPHABET[(n ushr 12) and 63])
      out.append(ALPHABET[(n ushr 6) and 63])
      out.append('=')
    }
    return out.toString()
  }

  /**
   * Decodes base64 [text]. ASCII whitespace is ignored and padding is optional, matching the
   * leniency of browser `atob`.
   *
   * @throws IllegalArgumentException on characters outside the alphabet or a dangling sextet.
   */
  @JvmStatic
  fun decode(text: String): ByteArray {
    val out = ByteArray(text.length / 4 * 3 + 3)
    var outLen = 0
    var acc = 0
    var bits = 0
    var padding = 0
    for (c in text) {
      if (c == ' ' || c == '\n' || c == '\r' || c == '\t' || c == '\u000C') continue
      if (c == '=') {
        padding++
        continue
      }
      require(padding == 0) { "Invalid base64: data after padding" }
      val v = if (c.code < 128) DECODE[c.code] else -1
      require(v >= 0) { "Invalid base64 character" }
      acc = (acc shl 6) or v
      bits += 6
      if (bits >= 8) {
        bits -= 8
        out[outLen++] = (acc ushr bits).toByte()
        acc = acc and ((1 shl bits) - 1)
      }
    }
    require(bits < 6) { "Invalid base64 length" }
    require(padding <= 2) { "Invalid base64 padding" }
    return out.copyOf(outLen)
  }

  /** [decode], returning `null` instead of throwing on malformed input. */
  @JvmStatic
  fun decodeOrNull(text: String): ByteArray? =
    try {
      decode(text)
    } catch (e: IllegalArgumentException) {
      null
    }
}
