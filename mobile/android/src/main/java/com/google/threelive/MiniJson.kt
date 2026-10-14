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

package com.google.threelive

/**
 * Small, strict, zero-dependency RFC 8259 JSON parser and serializer.
 *
 * The Android client library deliberately avoids `org.json` (which is stubbed out in JVM unit
 * tests) and third-party JSON libraries. Values are decoded to plain Kotlin types:
 * - objects -> [Map]<[String], [Any]?> (insertion ordered; duplicate keys keep the last value)
 * - arrays -> [List]<[Any]?>
 * - strings -> [String]
 * - numbers -> [Double]
 * - `true` / `false` -> [Boolean]
 * - `null` -> `null`
 *
 * Nesting depth and input size are bounded so hostile `.glb` files cannot exhaust the stack or
 * heap.
 */
object MiniJson {

  /** Default maximum container nesting depth. */
  const val DEFAULT_MAX_DEPTH = 64

  /** Default maximum input length in UTF-16 chars (32 Mi). */
  const val DEFAULT_MAX_CHARS = 32 * 1024 * 1024

  /** Default maximum number of decoded values (scalars + containers) per document. */
  const val DEFAULT_MAX_VALUES = 2_000_000

  /** Maximum length of a single number token. */
  const val MAX_NUMBER_CHARS = 1024

  /** Thrown by [parse] for malformed or over-limit input. */
  class ParseException(message: String) : IllegalArgumentException(message)

  /**
   * Parses [text] as a single JSON value.
   *
   * @throws ParseException when the input is malformed, nests deeper than [maxDepth], is longer
   *   than [maxChars], or decodes to more than [maxValues] values.
   */
  @JvmStatic
  @JvmOverloads
  fun parse(
    text: String,
    maxDepth: Int = DEFAULT_MAX_DEPTH,
    maxChars: Int = DEFAULT_MAX_CHARS,
    maxValues: Int = DEFAULT_MAX_VALUES,
  ): Any? {
    if (text.length > maxChars) throw ParseException("JSON input exceeds $maxChars chars")
    val p = Parser(text, maxDepth, maxValues)
    p.skipWs()
    val v = p.readValue(0)
    p.skipWs()
    if (p.pos != text.length) p.fail("Trailing characters")
    return v
  }

  /**
   * Like [parse] but returns `null` instead of throwing. Note that the literal `null` document also
   * yields `null`.
   */
  @JvmStatic
  @JvmOverloads
  fun parseOrNull(
    text: String,
    maxDepth: Int = DEFAULT_MAX_DEPTH,
    maxChars: Int = DEFAULT_MAX_CHARS,
    maxValues: Int = DEFAULT_MAX_VALUES,
  ): Any? =
    try {
      parse(text, maxDepth, maxChars, maxValues)
    } catch (e: ParseException) {
      null
    }

  /** Parses [text] and returns it only when the root is an object; `null` otherwise. */
  @JvmStatic
  fun parseObjectOrNull(text: String): Map<String, Any?>? = asMap(parseOrNull(text))

  /** Returns [v] as a string-keyed map, or `null`. */
  @Suppress("UNCHECKED_CAST")
  @JvmStatic
  fun asMap(v: Any?): Map<String, Any?>? = v as? Map<String, Any?>

  /** Returns [v] as a list, or `null`. */
  @JvmStatic fun asList(v: Any?): List<Any?>? = v as? List<Any?>

  /** Returns [v] as a non-empty string, or `null`. */
  @JvmStatic fun asString(v: Any?): String? = (v as? String)?.takeIf { it.isNotEmpty() }

  /** Returns [v] as a finite double, or `null`. */
  @JvmStatic fun asFiniteDouble(v: Any?): Double? = (v as? Double)?.takeIf { it.isFinite() }

  /** Returns [v] as a boolean, or `null`. */
  @JvmStatic fun asBoolean(v: Any?): Boolean? = v as? Boolean

  /**
   * Serializes [value] to compact JSON. Supports maps (string keys), lists, arrays of primitives,
   * strings, numbers, booleans and `null`. Non-finite numbers become `null` (as in
   * `JSON.stringify`); integral doubles are written without a fractional part.
   */
  @JvmStatic
  fun stringify(value: Any?): String {
    val sb = StringBuilder()
    write(sb, value, 0)
    return sb.toString()
  }

  private fun write(sb: StringBuilder, v: Any?, depth: Int) {
    if (depth > DEFAULT_MAX_DEPTH) {
      sb.append("null")
      return
    }
    when (v) {
      null -> sb.append("null")
      is Boolean -> sb.append(if (v) "true" else "false")
      is String -> quote(sb, v)
      is Double -> writeNumber(sb, v)
      is Float -> writeNumber(sb, v.toDouble())
      is Number -> writeNumber(sb, v.toDouble())
      is Map<*, *> -> {
        sb.append('{')
        var first = true
        for ((k, item) in v) {
          if (!first) sb.append(',')
          first = false
          quote(sb, k.toString())
          sb.append(':')
          write(sb, item, depth + 1)
        }
        sb.append('}')
      }
      is DoubleArray -> writeSeq(sb, v.size) { writeNumber(sb, v[it]) }
      is FloatArray -> writeSeq(sb, v.size) { writeNumber(sb, v[it].toDouble()) }
      is IntArray -> writeSeq(sb, v.size) { sb.append(v[it]) }
      is BooleanArray -> writeSeq(sb, v.size) { sb.append(v[it]) }
      is Iterable<*> -> {
        sb.append('[')
        var first = true
        for (item in v) {
          if (!first) sb.append(',')
          first = false
          write(sb, item, depth + 1)
        }
        sb.append(']')
      }
      is Array<*> -> writeSeq(sb, v.size) { write(sb, v[it], depth + 1) }
      else -> quote(sb, v.toString())
    }
  }

  private inline fun writeSeq(sb: StringBuilder, n: Int, item: (Int) -> Unit) {
    sb.append('[')
    for (i in 0 until n) {
      if (i > 0) sb.append(',')
      item(i)
    }
    sb.append(']')
  }

  /**
   * Formats [d] like JavaScript's `String(number)` (ECMA-262 Number::toString): plain decimal
   * notation for `1e-6 <= |d| < 1e21`, otherwise `d.ddde±N` exponent notation.
   */
  @JvmStatic
  fun formatNumber(d: Double): String {
    if (d.isNaN()) return "NaN"
    if (d.isInfinite()) return if (d > 0) "Infinity" else "-Infinity"
    if (d == 0.0) return "0"
    if (d == Math.rint(d) && Math.abs(d) < 1e15) return d.toLong().toString()
    val bd = shortestDecimal(Math.abs(d))
    val digits = bd.unscaledValue().toString()
    val k = digits.length
    val n = k - bd.scale()
    val sb = StringBuilder()
    if (d < 0) sb.append('-')
    when {
      n in k..21 -> {
        sb.append(digits)
        for (i in 0 until n - k) sb.append('0')
      }
      n in 1..21 -> sb.append(digits, 0, n).append('.').append(digits, n, k)
      n in -5..0 -> {
        sb.append("0.")
        for (i in 0 until -n) sb.append('0')
        sb.append(digits)
      }
      else -> {
        val e = n - 1
        sb.append(digits[0])
        if (k > 1) sb.append('.').append(digits, 1, k)
        sb.append('e').append(if (e < 0) '-' else '+').append(Math.abs(e))
      }
    }
    return sb.toString()
  }

  /**
   * Returns the shortest decimal that round-trips to [d] (like JavaScript's Number#toString).
   * `Double.toString` is not shortest on JDK < 19 (e.g. `2.0E23` prints as
   * `2.0000000000000002E23`), so the digits are derived from the exact binary value instead.
   */
  private fun shortestDecimal(d: Double): java.math.BigDecimal {
    val exact = java.math.BigDecimal(d)
    for (precision in 1..17) {
      val candidate = exact.round(java.math.MathContext(precision, java.math.RoundingMode.HALF_EVEN))
      if (candidate.toDouble() == d) return candidate.stripTrailingZeros()
    }
    return exact.round(java.math.MathContext(17)).stripTrailingZeros()
  }

  private fun writeNumber(sb: StringBuilder, d: Double) {
    if (!d.isFinite()) sb.append("null") else sb.append(formatNumber(d))
  }

  private fun quote(sb: StringBuilder, s: String) {
    sb.append('"')
    for (ch in s) {
      when (ch) {
        '"' -> sb.append("\\\"")
        '\\' -> sb.append("\\\\")
        '\n' -> sb.append("\\n")
        '\r' -> sb.append("\\r")
        '\t' -> sb.append("\\t")
        '\b' -> sb.append("\\b")
        '\u000C' -> sb.append("\\f")
        else ->
          if (ch < ' ' || ch == '\u2028' || ch == '\u2029') {
            sb.append("\\u")
            val hex = Integer.toHexString(ch.code)
            for (i in hex.length until 4) sb.append('0')
            sb.append(hex)
          } else {
            sb.append(ch)
          }
      }
    }
    sb.append('"')
  }

  private class Parser(private val s: String, private val maxDepth: Int, private val maxValues: Int) {
    var pos = 0
    private var values = 0

    fun fail(msg: String): Nothing = throw ParseException("$msg at offset $pos")

    fun skipWs() {
      while (pos < s.length) {
        val c = s[pos]
        if (c == ' ' || c == '\t' || c == '\n' || c == '\r') pos++ else break
      }
    }

    fun readValue(depth: Int): Any? {
      if (pos >= s.length) fail("Unexpected end of input")
      if (++values > maxValues) fail("Maximum value count $maxValues exceeded")
      return when (val c = s[pos]) {
        '{' -> readObject(depth + 1)
        '[' -> readArray(depth + 1)
        '"' -> readString()
        't' -> readLiteral("true", true)
        'f' -> readLiteral("false", false)
        'n' -> readLiteral("null", null)
        else -> if (c == '-' || c in '0'..'9') readNumber() else fail("Unexpected character '$c'")
      }
    }

    private fun readLiteral(word: String, value: Any?): Any? {
      if (!s.startsWith(word, pos)) fail("Invalid literal")
      pos += word.length
      return value
    }

    private fun readObject(depth: Int): Map<String, Any?> {
      if (depth > maxDepth) fail("Maximum nesting depth $maxDepth exceeded")
      pos++ // '{'
      val out = LinkedHashMap<String, Any?>()
      skipWs()
      if (pos < s.length && s[pos] == '}') {
        pos++
        return out
      }
      while (true) {
        skipWs()
        if (pos >= s.length || s[pos] != '"') fail("Expected object key")
        val key = readString()
        skipWs()
        if (pos >= s.length || s[pos] != ':') fail("Expected ':'")
        pos++
        skipWs()
        out[key] = readValue(depth)
        skipWs()
        if (pos >= s.length) fail("Unterminated object")
        when (s[pos]) {
          ',' -> pos++
          '}' -> {
            pos++
            return out
          }
          else -> fail("Expected ',' or '}'")
        }
      }
    }

    private fun readArray(depth: Int): List<Any?> {
      if (depth > maxDepth) fail("Maximum nesting depth $maxDepth exceeded")
      pos++ // '['
      val out = ArrayList<Any?>()
      skipWs()
      if (pos < s.length && s[pos] == ']') {
        pos++
        return out
      }
      while (true) {
        skipWs()
        out.add(readValue(depth))
        skipWs()
        if (pos >= s.length) fail("Unterminated array")
        when (s[pos]) {
          ',' -> pos++
          ']' -> {
            pos++
            return out
          }
          else -> fail("Expected ',' or ']'")
        }
      }
    }

    private fun readString(): String {
      pos++ // opening quote
      val start = pos
      // Fast path: no escapes.
      while (pos < s.length) {
        val c = s[pos]
        if (c == '"') {
          val out = s.substring(start, pos)
          pos++
          return out
        }
        if (c == '\\') break
        if (c < ' ') fail("Unescaped control character in string")
        pos++
      }
      val sb = StringBuilder(pos - start + 16)
      sb.append(s, start, pos)
      while (pos < s.length) {
        val c = s[pos]
        when {
          c == '"' -> {
            pos++
            return sb.toString()
          }
          c == '\\' -> {
            if (pos + 1 >= s.length) fail("Unterminated escape")
            when (val e = s[pos + 1]) {
              '"' -> sb.append('"')
              '\\' -> sb.append('\\')
              '/' -> sb.append('/')
              'b' -> sb.append('\b')
              'f' -> sb.append('\u000C')
              'n' -> sb.append('\n')
              'r' -> sb.append('\r')
              't' -> sb.append('\t')
              'u' -> {
                if (pos + 6 > s.length) fail("Truncated \\u escape")
                var code = 0
                for (i in 2 until 6) {
                  val h = Character.digit(s[pos + i], 16)
                  if (h < 0) fail("Invalid \\u escape")
                  code = (code shl 4) or h
                }
                sb.append(code.toChar())
                pos += 4
              }
              else -> fail("Invalid escape '\\$e'")
            }
            pos += 2
          }
          c < ' ' -> fail("Unescaped control character in string")
          else -> {
            sb.append(c)
            pos++
          }
        }
      }
      fail("Unterminated string")
    }

    private fun readNumber(): Double {
      val start = pos
      if (s[pos] == '-') pos++
      if (pos >= s.length) fail("Invalid number")
      if (s[pos] == '0') {
        pos++
      } else if (s[pos] in '1'..'9') {
        while (pos < s.length && s[pos] in '0'..'9') pos++
      } else {
        fail("Invalid number")
      }
      if (pos < s.length && s[pos] == '.') {
        pos++
        val fracStart = pos
        while (pos < s.length && s[pos] in '0'..'9') pos++
        if (pos == fracStart) fail("Invalid number fraction")
      }
      if (pos < s.length && (s[pos] == 'e' || s[pos] == 'E')) {
        pos++
        if (pos < s.length && (s[pos] == '+' || s[pos] == '-')) pos++
        val expStart = pos
        while (pos < s.length && s[pos] in '0'..'9') pos++
        if (pos == expStart) fail("Invalid number exponent")
      }
      if (pos - start > MAX_NUMBER_CHARS) fail("Number token too long")
      return try {
        java.lang.Double.parseDouble(s.substring(start, pos))
      } catch (e: NumberFormatException) {
        fail("Invalid number")
      }
    }
  }
}
