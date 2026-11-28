package hu.gamestudio.app.studio

import java.math.BigDecimal
import java.math.MathContext
import java.math.RoundingMode
import java.util.Locale
import java.util.regex.Pattern
import kotlin.math.abs
import kotlin.math.ceil
import kotlin.math.floor
import kotlin.math.log10
import kotlin.math.max
import kotlin.math.min
import kotlin.math.pow

/**
 * Minden hangolható szám megkeresése egy Kotlin forrásban (és a nyers szövegekben lévő GLSL-ben), a címkézéséhez
 * szükséges környezettel, és a módosított érték visszaírása pontosan ugyanarra a helyre.
 * A src/studio/scan.ts portja; a viselkedésnek egyeznie kell vele (a tesztek a TS kimenetével vetik össze).
 */
enum class LitKind { INT, LONG, FLOAT, DOUBLE, HEX, BOOL }

data class Literal(
    /** `${file}#${ordinal}`: egy betöltött repón belül állandó. */
    val id: String,
    val file: String,
    val ordinal: Int,
    /** A forrásbeli szakasz, az előjelet is beleértve. */
    val start: Int,
    val end: Int,
    val raw: String,
    val value: Double,
    val kind: LitKind,
    val suffix: String,
    val leadingDot: Boolean,
    val upperHex: Boolean,
    val glsl: Boolean,
    /** "GameRenderer.drawLandmarks", "Palette", "Shaders.LIT_FS" … */
    val section: String,
    /** Osztály-/fájlszintű értékek deklarációs címkéje: "GATE_HALF", "SUN.minElDeg", "odd[3]". */
    val decl: String?,
    /** Index nélküli deklaráció: "odd" az "odd[3]"-hoz. */
    val declBase: String?,
    val inFunction: Boolean,
    val line: Int,
    /** Az utasítás kezdősora (az fölötte lévő KDoc-hoz). */
    val stmtLine: Int,
)

private val NUM_RE: Pattern = Pattern.compile("0[xX][0-9a-fA-F_]+[lL]?|(?:\\d[\\d_]*)?\\.\\d[\\d_]*(?:[eE][-+]?\\d+)?[fF]?|\\d[\\d_]*(?:[eE][-+]?\\d+)?[fFL]?")
private val GLSL_NUM_RE: Pattern = Pattern.compile("(?:\\d+)?\\.\\d+(?:[eE][-+]?\\d+)?[fF]?|\\d+\\.(?![\\d.A-Za-z_])(?:[eE][-+]?\\d+)?|\\d+(?:[eE][-+]?\\d+)?")

/** Ezeknek a hívásoknak az argumentumai magok, méretek vagy GL-konstansok, nem megjelenést állítanak. */
private val SKIP_CALLS = setOf(
    "hash", "rnd", "r", "h", "FloatArray", "IntArray", "ShortArray", "DoubleArray", "ByteArray", "BooleanArray", "LongArray",
    "ArrayList", "HashMap", "arrayOfNulls", "copyOf", "allocateDirect", "sleep", "layout", "Color", "toInt", "shl", "shr",
)
private val UNARY_BEFORE = setOf('(', ',', '=', ':', '[', '{', '+', '-', '*', '/', '%', '<', '>', '!', '?', '&', '|', '^')
private val UNARY_WORDS = setOf("return", "else", "to", "in", "until", "downTo", "step")

internal fun isIdChar(c: Char): Boolean = c in 'A'..'Z' || c in 'a'..'z' || c in '0'..'9' || c == '_'
private fun isDigit(c: Char): Boolean = c in '0'..'9'

/** Az `src` i. karaktere, vagy '\u0000' a tartományon kívül (a JS `undefined` megfelelője). */
private fun CharSequence.at(i: Int): Char = if (i in 0 until length) this[i] else '\u0000'

private fun lineStarts(src: String): IntArray {
    val out = ArrayList<Int>()
    out.add(0)
    for (i in src.indices) if (src[i] == '\n') out.add(i + 1)
    return out.toIntArray()
}

fun lineAt(starts: IntArray, pos: Int): Int {
    var lo = 0
    var hi = starts.size - 1
    while (lo < hi) {
        val mid = (lo + hi + 1) shr 1
        if (starts[mid] <= pos) lo = mid else hi = mid - 1
    }
    return lo + 1
}

private class Parsed(val value: Double, val kind: LitKind, val suffix: String)

private fun parseValue(raw: String): Parsed? {
    val clean = raw.replace("_", "")
    if (clean.startsWith("0x") || clean.startsWith("0X")) {
        var digits = clean.substring(2)
        if (digits.endsWith("l") || digits.endsWith("L")) digits = digits.dropLast(1)
        if (digits.length != 6) return null // csak az RGB színek hangolhatók hexként
        val v = digits.toLongOrNull(16) ?: return null
        return Parsed(v.toDouble(), LitKind.HEX, "")
    }
    val suffix = if (clean.isNotEmpty() && clean.last() in "fFL") clean.takeLast(1) else ""
    val body = if (suffix.isNotEmpty()) clean.dropLast(1) else clean
    val value = body.toDoubleOrNull() ?: return null
    if (value.isNaN() || value.isInfinite()) return null
    val isFrac = body.any { it == '.' || it == 'e' || it == 'E' }
    val kind = when {
        suffix == "f" || suffix == "F" -> LitKind.FLOAT
        suffix == "L" -> LitKind.LONG
        isFrac -> LitKind.DOUBLE
        else -> LitKind.INT
    }
    return Parsed(value, kind, suffix)
}

private class Scope(val kind: String, val name: String) // kind: "class" | "fun" | "block"

private val FUN_RE = Regex("\\bfun\\s+(?:<[^>]*>\\s*)?(?:[\\w.]+\\.)?(\\w+)\\s*\\(")
private val CLS_RE = Regex("\\b(?:class|object|interface)\\s+(\\w+)")
private val COMPANION_RE = Regex("\\bcompanion\\s+object\\b")
private val OBJECT_RE = Regex("\\bobject\\b")
private val INIT_RE = Regex("\\binit\\s*$")

private fun scopeFromHeader(header: String): Scope {
    val fn = FUN_RE.findAll(header).lastOrNull()
    val cls = CLS_RE.findAll(header).lastOrNull()
    if (fn != null && (cls == null || fn.range.first > cls.range.first)) return Scope("fun", fn.groupValues[1])
    if (cls != null) return Scope("class", cls.groupValues[1])
    if (COMPANION_RE.containsMatchIn(header)) return Scope("class", "companion")
    if (OBJECT_RE.containsMatchIn(header)) return Scope("class", "object")
    if (INIT_RE.containsMatchIn(header.trim())) return Scope("fun", "init")
    return Scope("block", "")
}

private fun sectionName(scopes: List<Scope>, fileBase: String): String {
    val named = scopes.filter { it.name.isNotEmpty() && it.name != "companion" }
    val fn = named.reversed().firstOrNull { it.kind == "fun" }
    val classes = named.filter { it.kind == "class" }.map { it.name }
    val clsPath = if (classes.isNotEmpty()) classes.joinToString(".") else ""
    if (fn != null) return "${clsPath.ifEmpty { fileBase }}.${fn.name}"
    return clsPath.ifEmpty { fileBase }
}

private class Pending(
    val file: String, val start: Int, val end: Int, val raw: String, val value: Double, val kind: LitKind, val suffix: String,
    val leadingDot: Boolean, val upperHex: Boolean, val glsl: Boolean, val section: String, val inFunction: Boolean,
    val line: Int, val stmtLine: Int, val declName: String?, val named: String?, val stmt: Int,
)

private val CLASS_CTOR_RE = Regex("\\bclass\\s+(\\w+)\\s*(?:<[^>]*>)?\\s*\\(")
private val VALVAR_RE = Regex("\\b(val|var)\\s+(\\w+)")
private val CMP_END_RE = Regex("(?:[<>!]=?|==)\\s*-?\\s*$")
private val ASSIGN_END_RE = Regex("[^=!<>]=\\s*-?\\s*$")
private val EQ_RE = Regex("(?<![=!<>])=(?!=)")
private val NAMED_ARG_RE = Regex("^\\s*(\\w+)\\s*=(?!=)")
private val GLSL_HINT_RE = Regex("void\\s+main|#version|\\buniform\\b|\\bvec[234]\\b")
private val GLSL_DIRECTIVE_RE = Regex("^#(version|extension|if|ifdef|ifndef|elif|else|endif|line|pragma)\\b")
private val DEFINE_RE = Regex("^#define\\s+(\\w+)\\s+")
private val CONST_RE = Regex("\\bconst\\s+(?:float|int)\\s+(\\w+)\\s*=\\s*-?\\s*$")
private val CALL_BEFORE_RE = Regex("([A-Za-z_]\\w*)\\s*$")
private val WORD_END_RE = Regex("(\\w+)$")
private val GL_CALL_RE = Regex("^gl[A-Z]")

private fun matchAtPos(p: Pattern, src: String, at: Int): String? {
    val m = p.matcher(src)
    m.region(at, src.length)
    return if (m.lookingAt()) m.group() else null
}

/** Egy Kotlin fájl vizsgálata. A `file` a repón belüli relatív útvonal. */
fun scanKotlin(file: String, src: String): List<Literal> {
    val starts = lineStarts(src)
    val fileBase = file.substringAfterLast('/').replace(Regex("\\.kts?$"), "")
    val scopes = ArrayList<Scope>()
    val calls = ArrayList<String>()
    val pending = ArrayList<Pending>()
    var stmtStart = 0
    var stmtId = 0
    var paren = 0
    val n = src.length
    var i = 0

    /** A JS `slice` megfelelője: üres szöveg, ha a vége nem nagyobb a kezdetnél. */
    fun slice(a: Int, b: Int): String = if (b <= a) "" else src.substring(a, b)
    fun resetStmt(at: Int) { stmtStart = at; stmtId++ }
    fun prevNonSpace(from: Int): Int {
        var j = from
        while (j >= 0 && (src.at(j) == ' ' || src.at(j) == '\t')) j--
        return j
    }
    fun isUnary(minusAt: Int): Boolean {
        val j = prevNonSpace(minusAt - 1)
        if (j < 0 || src[j] == '\n') return true
        if (src[j] in UNARY_BEFORE) return true
        val word = WORD_END_RE.find(src.substring(max(0, j - 8), j + 1))
        return word != null && word.groupValues[1] in UNARY_WORDS
    }
    fun callBefore(at: Int): String = CALL_BEFORE_RE.find(src.substring(max(0, at - 40), at))?.groupValues?.get(1) ?: ""
    fun skipping(): Boolean = calls.any { it == "[" || it in SKIP_CALLS || GL_CALL_RE.containsMatchIn(it) }

    fun emit(start: Int, end: Int, raw: String, glsl: Boolean, section: String, inFunction: Boolean, declName: String?, named: String?) {
        val body = raw.replace(Regex("^-\\s*"), "")
        val parsed = parseValue(body) ?: return
        val neg = raw.startsWith("-")
        pending.add(
            Pending(
                file, start, end, raw, if (neg) -parsed.value else parsed.value, parsed.kind, parsed.suffix,
                body.startsWith("."), Regex("^0[xX].*[A-F]").containsMatchIn(body), glsl, section, inFunction,
                lineAt(starts, start), lineAt(starts, stmtStart), declName, named, if (glsl) -1 else stmtId,
            ),
        )
    }

    /** Osztály-/fájlszintű literál deklarációs neve és a névvel hívott argumentum. */
    fun declFor(litStart: Int): Pair<String?, String?> {
        val header = slice(stmtStart, litStart)
        val last = VALVAR_RE.findAll(header).lastOrNull()
        if (last == null || last.groupValues[1] == "var") return Pair(null, null)
        // Az `if (r >= 2)`-féle küszöbök logika, nem megjelenés.
        if (CMP_END_RE.containsMatchIn(header) && !ASSIGN_END_RE.containsMatchIn(header)) return Pair(null, null)
        val after = header.substring(last.range.first + last.value.length)
        val eq = EQ_RE.find(after)?.range?.first ?: -1
        if (eq < 0) return Pair(null, null)
        val rest = after.substring(eq + 1)
        val cut = max(rest.lastIndexOf(','), rest.lastIndexOf('('))
        val seg = if (cut >= 0) rest.substring(cut + 1) else ""
        val named = NAMED_ARG_RE.find(seg)
        return Pair(last.groupValues[2], named?.groupValues?.get(1))
    }

    fun scanGlsl(from: Int, to: Int, section: String, inFunction: Boolean) {
        var j = from
        val brackets = ArrayList<String>()
        var defineName: String? = null
        var lineStart = from
        while (j < to) {
            val c = src[j]
            if (c == '\n') {
                defineName = null
                lineStart = j + 1
                j++
                continue
            }
            if (c == '/' && src.at(j + 1) == '/') {
                while (j < to && src[j] != '\n') j++
                continue
            }
            if (c == '/' && src.at(j + 1) == '*') {
                val e = src.indexOf("*/", j + 2)
                j = if (e < 0 || e > to) to else e + 2
                continue
            }
            if (c == '$' && src.at(j + 1) == '{') {
                var depth = 0
                while (j < to) {
                    if (src[j] == '{') depth++
                    else if (src[j] == '}') { depth--; if (depth == 0) break }
                    j++
                }
                j++
                continue
            }
            if (c == '#') {
                val nl = src.indexOf('\n', j)
                val lineText = src.substring(j, if (nl < 0) to else min(to, nl))
                if (GLSL_DIRECTIVE_RE.containsMatchIn(lineText)) {
                    while (j < to && src[j] != '\n') j++
                    continue
                }
                val d = DEFINE_RE.find(lineText)
                if (d != null) defineName = d.groupValues[1]
            }
            if (c == '[') brackets.add("[")
            if (c == ']' && brackets.isNotEmpty()) brackets.removeAt(brackets.size - 1)
            if (c == '(') brackets.add(callBefore(j))
            if (c == ')' && brackets.isNotEmpty()) brackets.removeAt(brackets.size - 1)
            val prev = if (j > 0) src[j - 1] else ' '
            if ((isDigit(c) || (c == '.' && isDigit(src.at(j + 1)))) && !isIdChar(prev) && prev != '.') {
                val m = matchAtPos(GLSL_NUM_RE, src, j)
                if (m != null && !isIdChar(src.at(j + m.length).let { if (it == '\u0000') ' ' else it })) {
                    var start = j
                    val k = prevNonSpace(j - 1)
                    if (src.at(k) == '-' && isUnary(k)) start = k
                    val raw = src.substring(start, j + m.length)
                    val constMatch = CONST_RE.find(src.substring(lineStart, start))
                    val name = defineName ?: constMatch?.groupValues?.get(1)
                    if (brackets.none { it == "[" || it == "layout" }) emit(start, j + m.length, raw, true, section, inFunction, name, null)
                    j += m.length
                    continue
                }
            }
            j++
        }
    }

    while (i < n) {
        val c = src[i]
        // megjegyzések
        if (c == '/' && src.at(i + 1) == '/') {
            while (i < n && src[i] != '\n') i++
            continue
        }
        if (c == '/' && src.at(i + 1) == '*') {
            var depth = 1
            i += 2
            while (i < n && depth > 0) {
                if (src[i] == '/' && src.at(i + 1) == '*') { depth++; i += 2 }
                else if (src[i] == '*' && src.at(i + 1) == '/') { depth--; i += 2 }
                else i++
            }
            continue
        }
        // szövegek
        if (c == '"' && src.startsWith("\"\"\"", i)) {
            var e = src.indexOf("\"\"\"", i + 3)
            if (e < 0) e = n
            while (src.at(e + 3) == '"') e++
            val body = src.substring(i + 3, e)
            if (GLSL_HINT_RE.containsMatchIn(body)) {
                val header = slice(stmtStart, i)
                val v = VALVAR_RE.findAll(header).lastOrNull()
                // a TS változat itt csak a `val|var` utáni nevet veszi (a [\b(?:val|var)\s+(\w+)] minta)
                val base = sectionName(scopes, fileBase)
                scanGlsl(i + 3, e, if (v != null) "$base.${v.groupValues[2]}" else base, scopes.any { it.kind != "class" })
            }
            i = e + 3
            continue
        }
        if (c == '"') {
            var j = i + 1
            while (j < n && src[j] != '"' && src[j] != '\n') {
                if (src[j] == '\\') j += 2
                else if (src[j] == '$' && src.at(j + 1) == '{') {
                    var depth = 0
                    while (j < n) {
                        if (src[j] == '{') depth++
                        else if (src[j] == '}') { depth--; if (depth == 0) break }
                        j++
                    }
                    j++
                } else j++
            }
            i = j + 1
            continue
        }
        if (c == '\'') {
            val e = src.indexOf('\'', i + (if (src.at(i + 1) == '\\') 3 else 2))
            i = if (e > i && e - i < 10) e + 1 else i + 1
            continue
        }
        if (c == '{') {
            scopes.add(scopeFromHeader(slice(stmtStart, i)))
            resetStmt(i + 1)
            i++
            continue
        }
        if (c == '}') {
            if (scopes.isNotEmpty()) scopes.removeAt(scopes.size - 1)
            resetStmt(i + 1)
            i++
            continue
        }
        if (c == ';') {
            resetStmt(i + 1)
            i++
            continue
        }
        if (c == '\n') {
            if (paren == 0) resetStmt(i + 1)
            i++
            continue
        }
        if (c == '(' || c == '[') {
            paren++
            calls.add(if (c == '[') "[" else callBefore(i))
            i++
            continue
        }
        if (c == ')' || c == ']') {
            paren = max(0, paren - 1)
            if (calls.isNotEmpty()) calls.removeAt(calls.size - 1)
            i++
            continue
        }
        if (c == '@') {
            // annotáció: a neve kimarad (az argumentumai többnyire szövegek)
            i++
            while (i < n && isIdChar(src[i])) i++
            continue
        }
        val prev = if (i > 0) src[i - 1] else ' '
        val digitStart = isDigit(c) && !isIdChar(prev)
        val dotStart = c == '.' && isDigit(src.at(i + 1)) && !isIdChar(prev) && prev != '.'
        if (digitStart || dotStart) {
            val m = matchAtPos(NUM_RE, src, i)
            if (m != null && !isIdChar(src.at(i + m.length).let { if (it == '\u0000') ' ' else it })) {
                val end = i + m.length
                var start = i
                val k = prevNonSpace(i - 1)
                if (src.at(k) == '-' && isUnary(k)) start = k
                if (!skipping()) {
                    val inFunction = scopes.any { it.kind != "class" }
                    val header = slice(stmtStart, start)
                    val ctor = CLASS_CTOR_RE.find(header)
                    val section = if (ctor != null && !inFunction) ctor.groupValues[1] else sectionName(scopes, fileBase)
                    val d = if (inFunction) Pair(null, null) else declFor(start)
                    emit(start, end, src.substring(start, end), false, section, inFunction, d.first, d.second)
                }
                i = end
                continue
            }
        }
        if (isIdChar(c)) {
            val start = i
            while (i < n && isIdChar(src[i])) i++
            val word = src.substring(start, i)
            if ((word == "true" || word == "false") && !skipping()) {
                val inFunction = scopes.any { it.kind != "class" }
                if (!inFunction) {
                    val d = declFor(start)
                    if (d.first != null) {
                        val header = slice(stmtStart, start)
                        val ctor = CLASS_CTOR_RE.find(header)
                        val section = if (ctor != null) ctor.groupValues[1] else sectionName(scopes, fileBase)
                        pending.add(
                            Pending(
                                file, start, i, word, if (word == "true") 1.0 else 0.0, LitKind.BOOL, "", false, false, false, section, false,
                                lineAt(starts, start), lineAt(starts, stmtStart), d.first, d.second, stmtId,
                            ),
                        )
                    }
                }
            }
            continue
        }
        i++
    }

    // Címkék: egy deklarációhoz egy literál a sima nevet kapja, több literál indexet.
    val groups = LinkedHashMap<String, MutableList<Int>>()
    for ((idx, p) in pending.withIndex()) {
        val dn = p.declName ?: continue
        val key = if (p.glsl) "g:$dn:${p.section}" else "${p.stmt}:$dn:${p.named ?: ""}"
        groups.getOrPut(key) { ArrayList() }.add(idx)
    }
    val declOf = arrayOfNulls<String>(pending.size)
    val baseOf = arrayOfNulls<String>(pending.size)
    for (g in groups.values) {
        for ((k, idx) in g.withIndex()) {
            val p = pending[idx]
            val base = if (p.named != null) "${p.declName}.${p.named}" else p.declName!!
            baseOf[idx] = base
            declOf[idx] = if (g.size > 1) "$base[$k]" else base
        }
    }
    return pending.mapIndexed { ordinal, p ->
        Literal(
            "$file#$ordinal", file, ordinal, p.start, p.end, p.raw, p.value, p.kind, p.suffix, p.leadingDot, p.upperHex, p.glsl,
            p.section, declOf[ordinal], baseOf[ordinal], p.inFunction, p.line, p.stmtLine,
        )
    }
}

private fun trimNumber(a: Double): String {
    if (a != 0.0 && (a < 1e-5 || a >= 1e9)) {
        // JS toExponential(6): "1.234560e+9"; a felesleges nullák az e előtt elhagyva
        val s = String.format(Locale.ROOT, "%.6e", a)
        val mant = s.substringBefore('e')
        val exp = s.substringAfter('e').toInt()
        val js = "${mant}e${if (exp >= 0) "+" else "-"}${abs(exp)}"
        return js.replace(Regex("\\.?0+e"), "e")
    }
    return BigDecimal(a).setScale(6, RoundingMode.HALF_UP).stripTrailingZeros().toPlainString()
}

/** Az értéket úgy írja le, ahogy az eredeti literál volt írva (utótag, vezető pont, hex kis-/nagybetű). */
fun formatLiteral(l: Literal, v: Double): String = formatLiteral(l.kind, l.suffix, l.leadingDot, l.upperHex, l.glsl, v)

fun formatLiteral(kind: LitKind, suffix: String, leadingDot: Boolean, upperHex: Boolean, glsl: Boolean, v: Double): String {
    if (kind == LitKind.BOOL) return if (v >= 0.5) "true" else "false"
    if (kind == LitKind.HEX) {
        val x = max(0.0, min(16777215.0, floor(v + 0.5))).toLong()
        val h = x.toString(16).padStart(6, '0')
        return "0x${if (upperHex) h.uppercase(Locale.ROOT) else h}"
    }
    val neg = v < 0
    val a = abs(v)
    var s: String
    if (kind == LitKind.INT || kind == LitKind.LONG) {
        s = floor(a + 0.5).toLong().toString()
    } else {
        s = trimNumber(a)
        if (s.none { it == '.' || it == 'e' || it == 'E' } && (kind == LitKind.DOUBLE || glsl)) s += ".0"
        if (leadingDot && s.startsWith("0.")) s = s.substring(1)
    }
    return "${if (neg) "-" else ""}$s$suffix"
}

/** A módosítások (literál-azonosító → új érték) alkalmazása egy fájl forrására. A nem változó értékek eredeti szövege marad. */
fun patchSource(src: String, lits: List<Literal>, edits: Map<String, Double>): String {
    val changes = lits.filter { l -> edits[l.id]?.let { abs(it - l.value) > 1e-12 } == true }.sortedByDescending { it.start }
    if (changes.isEmpty()) return src
    val out = StringBuilder(src)
    for (l in changes) out.replace(l.start, l.end, formatLiteral(l, edits.getValue(l.id)))
    return out.toString()
}

data class Range(val min: Double, val max: Double, val step: Double, val int: Boolean)

private fun precision6(x: Double): Double = BigDecimal(x).round(MathContext(6)).toDouble()

/** Csúszkatartomány az érték körül: pozitívnál 0…3×, negatívnál szimmetrikus. */
fun autoRange(l: Literal): Range = autoRange(l.kind, l.value)

fun autoRange(kind: LitKind, value: Double): Range {
    if (kind == LitKind.BOOL) return Range(0.0, 1.0, 1.0, true)
    val v = value
    val int = kind == LitKind.INT || kind == LitKind.LONG
    val a = abs(v)
    if (int) {
        if (v == 0.0) return Range(0.0, 10.0, 1.0, int)
        if (v > 0) return Range(0.0, max(4.0, ceil(v * 3)), 1.0, int)
        return Range(floor(v * 3), ceil(a * 3), 1.0, int)
    }
    if (a == 0.0) return Range(-1.0, 1.0, 0.01, int)
    val step = 10.0.pow(floor(log10(a)) - 2)
    if (v > 0) return Range(0.0, precision6(v * 3), step, int)
    return Range(precision6(v * 3), precision6(a * 3), step, int)
}

private val TRAIL_COMMENT_RE = Regex("//\\s*(.+)$")
private val STRING_RE = Regex("\"(?:[^\"\\\\]|\\\\.)*\"")
private val KDOC_END_RE = Regex("\\*/\\s*$")
private val KDOC_STRIP_RE = Regex("^/\\*\\*?|\\*/$|^\\*")
private val LINE_COMMENT_RE = Regex("^\\s*//\\s*(.+)$")

/** A literál sorának záró `//` megjegyzése, vagy az utasítás fölötti KDoc. */
fun hintFor(src: String, line: Int, stmtLine: Int): String? {
    val lines = src.split("\n")
    val own = lines.getOrElse(line - 1) { "" }
    val tc = TRAIL_COMMENT_RE.find(own.replace(STRING_RE, "\"\""))
    if (tc != null) return tc.groupValues[1].trim()
    var k = stmtLine - 2
    if (k >= 0 && KDOC_END_RE.containsMatchIn(lines.getOrElse(k) { "" })) {
        val buf = ArrayList<String>()
        while (k >= 0) {
            val t = lines[k].trim()
            buf.add(0, t.replace(KDOC_STRIP_RE, "").trim())
            if (t.startsWith("/*")) break
            k--
        }
        val s = buf.filter { it.isNotEmpty() }.joinToString(" ")
        return s.ifEmpty { null }
    }
    if (k >= 0) {
        val m = LINE_COMMENT_RE.find(lines.getOrElse(k) { "" })
        if (m != null) return m.groupValues[1].trim()
    }
    return null
}

fun hintFor(src: String, l: Literal): String? = hintFor(src, l.line, l.stmtLine)

data class Snippet(val before: String, val text: String, val after: String)

/** A literál körüli forrássor a pozíciójával, hogy látszódjon, mit állít a csúszka. */
fun snippetFor(src: String, l: Literal, width: Int = 72): Snippet {
    val ls = src.lastIndexOf('\n', l.start - 1) + 1
    var le = src.indexOf('\n', l.end)
    if (le < 0) le = src.length
    var before = src.substring(ls, l.start).replace(Regex("^\\s+"), "")
    var after = src.substring(l.end, le)
    val room = max(10, width - (l.end - l.start))
    if (before.length > room * 0.6) before = "…" + before.substring(before.length - floor(room * 0.6).toInt())
    if (after.length > room * 0.4) after = after.substring(0, floor(room * 0.4).toInt()) + "…"
    return Snippet(before, src.substring(l.start, l.end), after)
}

data class CallFrame(
    /** A hívott függvény, fogadó nélkül: "prim", "material", "sin". */
    val fn: String,
    /** 1-től számolt argumentumpozíció. */
    val arg: Int,
    /** Névvel hívott argumentum neve ("rough" a `rough = .8`-ban). */
    val name: String?,
)

private val CALL_NAMED_RE = Regex("^\\s*([A-Za-z_]\\w*)\\s*=(?!=)")
private val KEYWORD_CALLS = setOf("if", "while", "for", "when", "catch", "return")

/**
 * A literált tartalmazó hívások, belülről kifelé (legfeljebb `depth`): melyik függvény hányadik argumentuma.
 * A beágyazott literáloknak nincs saját nevük; ez a kódban a hozzájuk legközelebbi név.
 */
fun callContext(src: String, pos: Int, depth: Int = 2): List<CallFrame> {
    val out = ArrayList<CallFrame>()
    var level = 0
    var commas = 0
    var segEnd = pos
    var segStart = -1
    var i = pos - 1
    var count = 0
    while (i >= 0 && count < 6000 && out.size < depth) {
        val c = src[i]
        if (c == ')' || c == ']') level++
        else if (c == '[') {
            if (level == 0) return out
            level--
        } else if (c == '(') {
            if (level > 0) {
                level--
                i--; count++
                continue
            }
            var j = i - 1
            while (j >= 0 && (src[j] == ' ' || src[j] == '\t')) j--
            var k = j
            while (k >= 0 && (isIdChar(src[k]) || src[k] == '.')) k--
            val fn = src.substring(k + 1, j + 1).substringAfterLast('.')
            if (fn in KEYWORD_CALLS) return out
            // csoportosító zárójel: még ugyanaz az argumentum
            if (fn.isEmpty() || isDigit(fn[0])) {
                commas = 0
                segStart = -1
                i--; count++
                continue
            }
            val seg = src.substring(if (segStart >= 0) segStart else i + 1, max(segEnd, if (segStart >= 0) segStart else i + 1))
            val named = CALL_NAMED_RE.find(seg)
            out.add(CallFrame(fn, commas + 1, named?.groupValues?.get(1)))
            commas = 0
            segEnd = k + 1
            segStart = -1
            i = k + 1
        } else if (level == 0) {
            if (c == ',') {
                if (segStart < 0) segStart = i + 1
                commas++
            } else if (c == '{' || c == '}' || c == ';') return out
        }
        i--; count++
    }
    return out
}
