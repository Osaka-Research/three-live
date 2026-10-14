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

import java.io.ByteArrayOutputStream
import java.io.EOFException
import java.io.IOException
import java.io.InputStream
import java.net.URI
import java.nio.ByteBuffer
import java.nio.charset.CharacterCodingException
import java.nio.charset.CodingErrorAction
import java.security.MessageDigest
import java.util.Locale
import java.util.Random

/**
 * Pure RFC 6455 framing and handshake helpers used by [WebSocketLiveTransport].
 *
 * Kept free of sockets and threads so every byte-level rule (masking, extended lengths,
 * fragmentation, control-frame limits, close codes, UTF-8 validation) is unit-testable on the JVM.
 */
internal object WebSocketCodec {

  const val OP_CONTINUATION = 0x0
  const val OP_TEXT = 0x1
  const val OP_BINARY = 0x2
  const val OP_CLOSE = 0x8
  const val OP_PING = 0x9
  const val OP_PONG = 0xA

  const val CLOSE_NORMAL = 1000
  const val CLOSE_GOING_AWAY = 1001
  const val CLOSE_PROTOCOL_ERROR = 1002
  const val CLOSE_NO_STATUS = 1005
  const val CLOSE_INVALID_PAYLOAD = 1007
  const val CLOSE_TOO_BIG = 1009

  /** Maximum payload of a control frame (RFC 6455 section 5.5). */
  const val MAX_CONTROL_PAYLOAD = 125

  /** Maximum bytes of the HTTP response head accepted during the handshake. */
  const val MAX_HANDSHAKE_BYTES = 16 * 1024

  private const val ACCEPT_GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11"

  private val RESERVED_HEADERS =
    setOf(
      "host",
      "upgrade",
      "connection",
      "sec-websocket-key",
      "sec-websocket-version",
      "sec-websocket-extensions",
      "sec-websocket-protocol",
      "content-length",
      "transfer-encoding",
    )

  /** A protocol violation; [closeCode] is sent to the peer before the connection is dropped. */
  class ProtocolException(val closeCode: Int, message: String) : IOException(message)

  /** One decoded frame. */
  class Frame(val fin: Boolean, val opcode: Int, val payload: ByteArray)

  /** One complete event produced by [MessageReader]. */
  sealed class Event {
    /** A complete text message. */
    class Text(val text: String) : Event()

    /** A complete binary message. */
    class Binary(val bytes: ByteArray) : Event()

    /** A ping; answer with a pong carrying the same payload. */
    class Ping(val payload: ByteArray) : Event()

    /** A pong. */
    class Pong(val payload: ByteArray) : Event()

    /** A close frame. [code] is [CLOSE_NO_STATUS] when the frame carried no status. */
    class Close(val code: Int, val reason: String) : Event()
  }

  /** Returns a fresh `Sec-WebSocket-Key` (16 random bytes, base64). */
  fun newKey(random: Random): String {
    val bytes = ByteArray(16)
    random.nextBytes(bytes)
    return LiveBase64.encode(bytes)
  }

  /** The `Sec-WebSocket-Accept` value a server must answer for [key]. */
  fun acceptFor(key: String): String {
    val sha1 = MessageDigest.getInstance("SHA-1")
    return LiveBase64.encode(sha1.digest((key + ACCEPT_GUID).toByteArray(Charsets.US_ASCII)))
  }

  /**
   * Encodes one frame. Client frames must pass a 4-byte [maskKey]; `null` produces an unmasked
   * (server-style) frame, used only by tests.
   */
  fun encodeFrame(
    opcode: Int,
    payload: ByteArray,
    fin: Boolean = true,
    maskKey: ByteArray? = null,
    offset: Int = 0,
    length: Int = payload.size - offset,
  ): ByteArray {
    require(offset >= 0 && length >= 0 && offset + length <= payload.size) { "Bad slice" }
    require(maskKey == null || maskKey.size == 4) { "Mask key must be 4 bytes" }
    if (opcode >= OP_CLOSE) {
      require(fin && length <= MAX_CONTROL_PAYLOAD) { "Invalid control frame" }
    }
    val extLen =
      when {
        length <= 125 -> 0
        length <= 0xFFFF -> 2
        else -> 8
      }
    val maskLen = if (maskKey != null) 4 else 0
    val out = ByteArray(2 + extLen + maskLen + length)
    out[0] = ((if (fin) 0x80 else 0) or (opcode and 0x0F)).toByte()
    val maskBit = if (maskKey != null) 0x80 else 0
    var p = 2
    when (extLen) {
      0 -> out[1] = (maskBit or length).toByte()
      2 -> {
        out[1] = (maskBit or 126).toByte()
        out[2] = (length ushr 8).toByte()
        out[3] = length.toByte()
        p = 4
      }
      else -> {
        out[1] = (maskBit or 127).toByte()
        val l = length.toLong()
        for (i in 0 until 8) out[2 + i] = (l ushr (56 - 8 * i)).toByte()
        p = 10
      }
    }
    if (maskKey != null) {
      System.arraycopy(maskKey, 0, out, p, 4)
      p += 4
      for (i in 0 until length) {
        out[p + i] = (payload[offset + i].toInt() xor maskKey[i and 3].toInt()).toByte()
      }
    } else {
      System.arraycopy(payload, offset, out, p, length)
    }
    return out
  }

  /** Payload of a close frame: big-endian [code] followed by a UTF-8 [reason] (≤ 123 bytes). */
  fun closePayload(code: Int, reason: String = ""): ByteArray {
    var reasonBytes = reason.toByteArray(Charsets.UTF_8)
    if (reasonBytes.size > MAX_CONTROL_PAYLOAD - 2) {
      reasonBytes = reasonBytes.copyOf(MAX_CONTROL_PAYLOAD - 2)
    }
    val out = ByteArray(2 + reasonBytes.size)
    out[0] = (code ushr 8).toByte()
    out[1] = code.toByte()
    System.arraycopy(reasonBytes, 0, out, 2, reasonBytes.size)
    return out
  }

  /**
   * Reads one frame from [input].
   *
   * @param maxPayload frames whose declared payload exceeds this fail with [CLOSE_TOO_BIG].
   * @param expectMasked servers must not mask (`false`); servers reading client frames expect
   *   masking (`true`, tests only).
   * @throws EOFException when the stream ends, [ProtocolException] on any violation.
   */
  fun readFrame(input: InputStream, maxPayload: Long, expectMasked: Boolean = false): Frame {
    val b0 = input.read()
    if (b0 < 0) throw EOFException("WebSocket stream ended")
    val b1 = readByte(input)
    val fin = (b0 and 0x80) != 0
    if ((b0 and 0x70) != 0) throw ProtocolException(CLOSE_PROTOCOL_ERROR, "Reserved bits set")
    val opcode = b0 and 0x0F
    val known =
      opcode == OP_CONTINUATION ||
        opcode == OP_TEXT ||
        opcode == OP_BINARY ||
        opcode == OP_CLOSE ||
        opcode == OP_PING ||
        opcode == OP_PONG
    if (!known) throw ProtocolException(CLOSE_PROTOCOL_ERROR, "Unknown opcode $opcode")
    val masked = (b1 and 0x80) != 0
    if (masked != expectMasked) {
      throw ProtocolException(CLOSE_PROTOCOL_ERROR, "Unexpected frame masking")
    }
    var len = (b1 and 0x7F).toLong()
    if (len == 126L) {
      len = ((readByte(input) shl 8) or readByte(input)).toLong()
    } else if (len == 127L) {
      len = 0L
      for (i in 0 until 8) len = (len shl 8) or readByte(input).toLong()
      if (len < 0) throw ProtocolException(CLOSE_PROTOCOL_ERROR, "Negative frame length")
    }
    if (opcode >= OP_CLOSE && (!fin || len > MAX_CONTROL_PAYLOAD)) {
      throw ProtocolException(CLOSE_PROTOCOL_ERROR, "Invalid control frame")
    }
    if (len > maxPayload || len > Int.MAX_VALUE - 8) {
      throw ProtocolException(CLOSE_TOO_BIG, "Frame exceeds $maxPayload bytes")
    }
    val mask = if (masked) readFully(input, 4) else null
    val payload = readFully(input, len.toInt())
    if (mask != null) {
      for (i in payload.indices) payload[i] = (payload[i].toInt() xor mask[i and 3].toInt()).toByte()
    }
    return Frame(fin, opcode, payload)
  }

  /** Decodes strict UTF-8, failing with [CLOSE_INVALID_PAYLOAD] on malformed input. */
  fun decodeUtf8(bytes: ByteArray): String {
    val decoder =
      Charsets.UTF_8.newDecoder()
        .onMalformedInput(CodingErrorAction.REPORT)
        .onUnmappableCharacter(CodingErrorAction.REPORT)
    return try {
      decoder.decode(ByteBuffer.wrap(bytes)).toString()
    } catch (e: CharacterCodingException) {
      throw ProtocolException(CLOSE_INVALID_PAYLOAD, "Invalid UTF-8")
    }
  }

  /** Parses a close frame payload into an [Event.Close]. */
  fun parseClose(payload: ByteArray): Event.Close {
    if (payload.isEmpty()) return Event.Close(CLOSE_NO_STATUS, "")
    if (payload.size == 1) throw ProtocolException(CLOSE_PROTOCOL_ERROR, "Truncated close code")
    val code = ((payload[0].toInt() and 0xFF) shl 8) or (payload[1].toInt() and 0xFF)
    val invalid =
      code < 1000 ||
        code == 1004 ||
        code == CLOSE_NO_STATUS ||
        code == 1006 ||
        code == 1015 ||
        (code in 1016..2999) ||
        code > 4999
    if (invalid) throw ProtocolException(CLOSE_PROTOCOL_ERROR, "Invalid close code $code")
    return Event.Close(code, decodeUtf8(payload.copyOfRange(2, payload.size)))
  }

  /**
   * Reassembles fragmented data messages and surfaces interleaved control frames, enforcing a
   * per-message size cap.
   */
  class MessageReader(
    private val input: InputStream,
    private val maxMessageBytes: Int,
    private val expectMasked: Boolean = false,
  ) {
    private var fragments: ByteArrayOutputStream? = null
    private var fragmentOpcode = 0

    /** Reads frames until one complete [Event] is available. */
    fun next(): Event {
      while (true) {
        val inMessage = fragments?.size()?.toLong() ?: 0L
        val frame = readFrame(input, maxMessageBytes - inMessage, expectMasked)
        when (frame.opcode) {
          OP_PING -> return Event.Ping(frame.payload)
          OP_PONG -> return Event.Pong(frame.payload)
          OP_CLOSE -> return parseClose(frame.payload)
          OP_TEXT,
          OP_BINARY -> {
            if (fragments != null) {
              throw ProtocolException(CLOSE_PROTOCOL_ERROR, "New message inside fragmented one")
            }
            if (frame.fin) return complete(frame.opcode, frame.payload)
            fragmentOpcode = frame.opcode
            fragments = ByteArrayOutputStream(maxOf(frame.payload.size * 2, 256))
              .also { it.write(frame.payload) }
          }
          else -> {
            val buf =
              fragments
                ?: throw ProtocolException(CLOSE_PROTOCOL_ERROR, "Continuation without message")
            buf.write(frame.payload)
            if (frame.fin) {
              fragments = null
              return complete(fragmentOpcode, buf.toByteArray())
            }
          }
        }
      }
    }

    private fun complete(opcode: Int, payload: ByteArray): Event {
      return if (opcode == OP_TEXT) Event.Text(decodeUtf8(payload)) else Event.Binary(payload)
    }
  }

  /** Builds the HTTP/1.1 upgrade request for [uri]. */
  fun buildHandshakeRequest(uri: URI, key: String, extraHeaders: Map<String, String>): String {
    val host = uri.host ?: throw IllegalArgumentException("URL has no host")
    val secure = uri.scheme.equals("wss", ignoreCase = true)
    val defaultPort = if (secure) 443 else 80
    val hostHeader = if (uri.port == -1 || uri.port == defaultPort) host else "$host:${uri.port}"
    val path = uri.rawPath.let { if (it.isNullOrEmpty()) "/" else it }
    val target = if (uri.rawQuery != null) "$path?${uri.rawQuery}" else path
    val sb = StringBuilder()
    sb.append("GET ").append(target).append(" HTTP/1.1\r\n")
    sb.append("Host: ").append(hostHeader).append("\r\n")
    sb.append("Upgrade: websocket\r\n")
    sb.append("Connection: Upgrade\r\n")
    sb.append("Sec-WebSocket-Key: ").append(key).append("\r\n")
    sb.append("Sec-WebSocket-Version: 13\r\n")
    for ((name, value) in extraHeaders) {
      validateHeader(name, value)
      sb.append(name).append(": ").append(value).append("\r\n")
    }
    sb.append("\r\n")
    return sb.toString()
  }

  /** Rejects header injection (CR/LF, non-token names) and overriding handshake headers. */
  fun validateHeader(name: String, value: String) {
    val validName =
      name.isNotEmpty() &&
        name.all { c -> c.code in 0x21..0x7E && c !in "()<>@,;:\\\"/[]?={}" }
    require(validName) { "Invalid header name" }
    require(name.lowercase(Locale.ROOT) !in RESERVED_HEADERS) { "Reserved header: $name" }
    require(value.none { it == '\r' || it == '\n' || it == '\u0000' }) { "Invalid header value" }
  }

  /** Reads the HTTP response head (status line + headers) byte by byte, without over-reading. */
  fun readHttpHead(input: InputStream): List<String> {
    val lines = ArrayList<String>()
    val line = ByteArrayOutputStream()
    var total = 0
    var prev = -1
    while (true) {
      val b = input.read()
      if (b < 0) throw EOFException("Connection closed during WebSocket handshake")
      if (++total > MAX_HANDSHAKE_BYTES) throw IOException("WebSocket handshake response too large")
      if (b == '\n'.code && prev == '\r'.code) {
        val bytes = line.toByteArray()
        val text = String(bytes, 0, bytes.size - 1, Charsets.ISO_8859_1)
        if (text.isEmpty()) return lines
        lines.add(text)
        line.reset()
        prev = -1
        continue
      }
      line.write(b)
      prev = b
    }
  }

  /**
   * Validates a server handshake response for [key].
   *
   * @throws IOException with a message that never contains the URL or credentials.
   */
  fun validateHandshakeResponse(head: List<String>, key: String) {
    val status = head.firstOrNull() ?: throw IOException("Empty WebSocket handshake response")
    val parts = status.split(' ')
    if (parts.size < 2 || !parts[0].startsWith("HTTP/1.1")) {
      throw IOException("Malformed WebSocket handshake response")
    }
    if (parts[1] != "101") {
      val code = parts[1].take(3).filter { it.isDigit() }
      throw IOException("WebSocket handshake failed: HTTP $code")
    }
    val headers = HashMap<String, String>()
    for (i in 1 until head.size) {
      val colon = head[i].indexOf(':')
      if (colon <= 0) throw IOException("Malformed WebSocket handshake header")
      val name = head[i].substring(0, colon).trim().lowercase(Locale.ROOT)
      val value = head[i].substring(colon + 1).trim()
      headers[name] = headers[name]?.let { "$it, $value" } ?: value
    }
    if (!headers["upgrade"].equals("websocket", ignoreCase = true)) {
      throw IOException("WebSocket handshake missing Upgrade: websocket")
    }
    val connection = headers["connection"].orEmpty().split(',').map { it.trim() }
    if (connection.none { it.equals("upgrade", ignoreCase = true) }) {
      throw IOException("WebSocket handshake missing Connection: Upgrade")
    }
    if (headers["sec-websocket-accept"] != acceptFor(key)) {
      throw IOException("WebSocket handshake Sec-WebSocket-Accept mismatch")
    }
    if (!headers["sec-websocket-extensions"].isNullOrEmpty()) {
      throw IOException("WebSocket server negotiated an unrequested extension")
    }
    if (!headers["sec-websocket-protocol"].isNullOrEmpty()) {
      throw IOException("WebSocket server selected an unrequested subprotocol")
    }
  }

  private fun readByte(input: InputStream): Int {
    val b = input.read()
    if (b < 0) throw EOFException("WebSocket stream ended mid-frame")
    return b
  }

  private fun readFully(input: InputStream, n: Int): ByteArray {
    val out = ByteArray(n)
    var off = 0
    while (off < n) {
      val r = input.read(out, off, n - off)
      if (r < 0) throw EOFException("WebSocket stream ended mid-frame")
      off += r
    }
    return out
  }
}
