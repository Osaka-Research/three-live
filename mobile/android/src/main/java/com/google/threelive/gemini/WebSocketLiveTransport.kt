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

import com.google.threelive.MiniJson
import java.io.BufferedInputStream
import java.io.IOException
import java.io.InputStream
import java.io.OutputStream
import java.net.InetSocketAddress
import java.net.Socket
import java.net.URI
import java.security.SecureRandom
import java.util.concurrent.ExecutorService
import java.util.concurrent.Executors
import java.util.concurrent.RejectedExecutionException
import java.util.concurrent.atomic.AtomicBoolean
import javax.net.ssl.HttpsURLConnection
import javax.net.ssl.SSLSocket
import javax.net.ssl.SSLSocketFactory

/**
 * Zero-dependency [GeminiLiveTransport] over an RFC 6455 WebSocket.
 *
 * Only `wss:` URLs are accepted (plus `ws:` to loopback for local development), matching the web
 * client. TLS uses the platform trust store with explicit hostname verification. Messages sent
 * before the handshake completes are queued and delivered in order; server text and binary frames
 * are both parsed as JSON (the Live API sends JSON in binary frames). Nothing is logged.
 *
 * @param url a Live endpoint such as [GeminiLiveEndpoints.ephemeralTokenUrl] or your proxy.
 * @param headers extra handshake headers (e.g. [GeminiLiveEndpoints.ephemeralTokenHeaders]).
 * @param maxMessageBytes cap on one reassembled server message.
 */
class WebSocketLiveTransport
@JvmOverloads
constructor(
  url: String,
  private val headers: Map<String, String> = emptyMap(),
  private val maxMessageBytes: Int = DEFAULT_MAX_MESSAGE_BYTES,
  private val connectTimeoutMs: Int = DEFAULT_CONNECT_TIMEOUT_MS,
  private val socketFactory: (URI) -> Socket = ::openSocket,
) : GeminiLiveTransport {

  override var listener: GeminiLiveTransport.Listener? = null

  private val uri: URI
  private val writer: ExecutorService = Executors.newSingleThreadExecutor { r -> Thread(r, "three-live-ws-writer").apply { isDaemon = true } }
  private val closed = AtomicBoolean(false)
  private val closeNotified = AtomicBoolean(false)
  private val random = SecureRandom()

  @Volatile private var socket: Socket? = null
  @Volatile private var output: OutputStream? = null

  init {
    require(GeminiLiveEndpoints.isAllowedLiveUrl(url)) { "Gemini Live URL must be wss:// (or ws:// to loopback)" }
    for ((name, value) in headers) WebSocketCodec.validateHeader(name, value)
    uri = URI(url)
    submit { connect() }
  }

  override fun send(message: Map<String, Any?>) {
    if (closed.get()) return
    val text = MiniJson.stringify(message).toByteArray(Charsets.UTF_8)
    submit {
      val out = output ?: return@submit
      writeFrame(out, WebSocketCodec.OP_TEXT, text)
    }
  }

  override fun close() {
    if (!closed.compareAndSet(false, true)) return
    submit {
      output?.let {
        try {
          writeFrame(it, WebSocketCodec.OP_CLOSE, WebSocketCodec.closePayload(WebSocketCodec.CLOSE_NORMAL))
        } catch (e: IOException) {
          // Already broken; closing anyway.
        }
      }
      closeSocket()
    }
    writer.shutdown()
  }

  private fun connect() {
    try {
      val s = socketFactory(uri)
      socket = s
      if (closed.get()) {
        closeSocket()
        return
      }
      s.soTimeout = connectTimeoutMs
      val input = BufferedInputStream(s.getInputStream())
      val out = s.getOutputStream()
      val key = WebSocketCodec.newKey(random)
      out.write(WebSocketCodec.buildHandshakeRequest(uri, key, headers).toByteArray(Charsets.ISO_8859_1))
      out.flush()
      WebSocketCodec.validateHandshakeResponse(WebSocketCodec.readHttpHead(input), key)
      s.soTimeout = 0
      output = out
      Thread({ readLoop(input) }, "three-live-ws-reader").apply { isDaemon = true }.start()
    } catch (e: IOException) {
      fail()
    } catch (e: RuntimeException) {
      fail()
    }
  }

  private fun readLoop(input: InputStream) {
    val reader = WebSocketCodec.MessageReader(input, maxMessageBytes)
    try {
      while (!closed.get()) {
        when (val ev = reader.next()) {
          is WebSocketCodec.Event.Text -> deliver(ev.text)
          is WebSocketCodec.Event.Binary -> deliver(WebSocketCodec.decodeUtf8(ev.bytes))
          is WebSocketCodec.Event.Ping ->
            submit { output?.let { writeFrame(it, WebSocketCodec.OP_PONG, ev.payload) } }
          is WebSocketCodec.Event.Pong -> {}
          is WebSocketCodec.Event.Close -> {
            closeFromPeer(ev.code)
            return
          }
        }
      }
    } catch (e: WebSocketCodec.ProtocolException) {
      closeFromPeer(e.closeCode)
    } catch (e: IOException) {
      fail()
    }
  }

  private fun deliver(text: String) {
    val message = MiniJson.parseObjectOrNull(text) ?: return
    try {
      listener?.onMessage(message)
    } catch (e: RuntimeException) {
      // A misbehaving listener must not kill the reader thread.
    }
  }

  private fun closeFromPeer(code: Int) {
    if (closed.compareAndSet(false, true)) {
      val reply = if (code == WebSocketCodec.CLOSE_NO_STATUS) WebSocketCodec.CLOSE_NORMAL else code
      submit {
        output?.let {
          try {
            writeFrame(it, WebSocketCodec.OP_CLOSE, WebSocketCodec.closePayload(reply))
          } catch (e: IOException) {
            // Ignore.
          }
        }
        closeSocket()
      }
      writer.shutdown()
    } else {
      closeSocket()
    }
  }

  private fun fail() {
    closed.set(true)
    closeSocket()
    writer.shutdown()
  }

  private fun writeFrame(out: OutputStream, opcode: Int, payload: ByteArray) {
    val mask = ByteArray(4).also { random.nextBytes(it) }
    out.write(WebSocketCodec.encodeFrame(opcode, payload, maskKey = mask))
    out.flush()
  }

  private fun closeSocket() {
    try {
      socket?.close()
    } catch (e: IOException) {
      // Ignore.
    }
    output = null
    if (closeNotified.compareAndSet(false, true)) {
      try {
        listener?.onClose()
      } catch (e: RuntimeException) {
        // Ignore listener failures.
      }
    }
  }

  private fun submit(task: () -> Unit) {
    try {
      writer.execute {
        try {
          task()
        } catch (e: IOException) {
          fail()
        } catch (e: RuntimeException) {
          fail()
        }
      }
    } catch (e: RejectedExecutionException) {
      // Closed: drop.
    }
  }

  companion object {
    /** Default cap on one server message (16 MiB). */
    const val DEFAULT_MAX_MESSAGE_BYTES: Int = 16 * 1024 * 1024

    /** Default TCP connect and handshake timeout. */
    const val DEFAULT_CONNECT_TIMEOUT_MS: Int = 15_000

    /** Opens a TLS socket (hostname-verified) for `wss:` or a plain socket for loopback `ws:`. */
    @JvmStatic
    fun openSocket(uri: URI): Socket {
      val host = uri.host ?: throw IOException("URL has no host")
      val secure = uri.scheme.equals("wss", ignoreCase = true)
      val port = if (uri.port != -1) uri.port else if (secure) 443 else 80
      val plain = Socket()
      plain.connect(InetSocketAddress(host, port), DEFAULT_CONNECT_TIMEOUT_MS)
      if (!secure) return plain
      val tls = (SSLSocketFactory.getDefault() as SSLSocketFactory).createSocket(plain, host, port, true) as SSLSocket
      tls.soTimeout = DEFAULT_CONNECT_TIMEOUT_MS
      tls.startHandshake()
      if (!HttpsURLConnection.getDefaultHostnameVerifier().verify(host, tls.session)) {
        tls.close()
        throw IOException("TLS hostname verification failed")
      }
      return tls
    }
  }
}
