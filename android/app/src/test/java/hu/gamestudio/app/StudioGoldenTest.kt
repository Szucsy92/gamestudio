package hu.gamestudio.app

import hu.gamestudio.app.studio.Group
import hu.gamestudio.app.studio.Literal
import hu.gamestudio.app.studio.Model
import hu.gamestudio.app.studio.buildModel
import hu.gamestudio.app.studio.formatLiteral
import hu.gamestudio.app.studio.patchSource
import java.io.File
import java.security.MessageDigest
import kotlin.math.abs
import kotlin.math.max
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * A natív motor-port ellenőrzése: a TS motor (src/studio) kimenete a src/kotlin mintafájlokon (golden/*.tsv,
 * generálja: android/tools/gen-golden.ts) és a Kotlin port kimenete egyezik-e.
 */
class StudioGoldenTest {
    companion object {
        private val FIXTURES = listOf(
            "app/src/main/java/x/gl/GameRenderer.kt" to "GameRenderer.kt",
            "app/src/main/java/x/sim/Simulation.kt" to "Simulation.kt",
            "app/src/main/java/x/gl/Quality.kt" to "Quality.kt",
            "app/src/main/java/x/gl/Shaders.kt" to "Shaders.kt",
            "app/src/main/java/x/gl/Meshes.kt" to "Meshes_Reference_Tree.kt",
        )
        private val texts: Map<String, String> by lazy {
            // a gradle az android/app mappából futtatja a teszteket
            FIXTURES.associate { (path, file) -> path to File("../../src/kotlin/$file").readText(Charsets.UTF_8) }
        }
        private val model: Model by lazy { buildModel(texts) }

        private fun golden(name: String): List<List<String>> =
            StudioGoldenTest::class.java.getResourceAsStream("/golden/$name")!!.bufferedReader(Charsets.UTF_8).readLines()
                .filter { it.isNotEmpty() }.map { it.split('\t') }
    }

    private fun near(a: Double, b: Double) = abs(a - b) <= 1e-9 * max(1.0, max(abs(a), abs(b)))
    private fun nul(s: String): String? = if (s == "-") null else s

    private fun report(what: String, bad: List<String>) =
        assertTrue("$what: ${bad.size} eltérés, az első néhány:\n" + bad.take(12).joinToString("\n"), bad.isEmpty())

    @Test fun scannerMatchesTs() {
        val g = golden("scan.tsv")
        val bad = ArrayList<String>()
        if (model.lits.size != g.size) bad.add("literálok száma: Kotlin ${model.lits.size}, TS ${g.size}")
        for (row in g) {
            val id = row[0]
            val l: Literal? = model.lits[id]
            if (l == null) { bad.add("hiányzik: $id"); continue }
            fun chk(name: String, kt: Any?, ts: Any?) { if (kt != ts) bad.add("$id $name: Kotlin=$kt TS=$ts (${l.raw} @${l.line})") }
            chk("start", l.start, row[1].toInt())
            chk("end", l.end, row[2].toInt())
            chk("raw", l.raw, row[3])
            if (!near(l.value, row[4].toDouble())) bad.add("$id value: Kotlin=${l.value} TS=${row[4]}")
            chk("kind", l.kind.name.lowercase(), row[5])
            chk("suffix", l.suffix.ifEmpty { "-" }, row[6])
            chk("leadingDot", l.leadingDot, row[7].toBoolean())
            chk("upperHex", l.upperHex, row[8].toBoolean())
            chk("glsl", l.glsl, row[9].toBoolean())
            chk("section", l.section, row[10])
            chk("decl", l.decl, nul(row[11]))
            chk("declBase", l.declBase, nul(row[12]))
            chk("inFunction", l.inFunction, row[13].toBoolean())
            chk("line", l.line, row[14].toInt())
            chk("stmtLine", l.stmtLine, row[15].toInt())
        }
        report("számkereső", bad)
    }

    @Test fun catalogMatchesTs() {
        val g = golden("model.tsv")
        val bad = ArrayList<String>()
        var pos = 0
        fun next(): List<String>? = if (pos < g.size) g[pos++] else null
        fun walk(groups: List<Group>, depth: Int, withRows: Boolean) {
            for (grp in groups) {
                val e = next()
                if (e == null || e[0] != "G") { bad.add("csoport hiányzik: ${grp.id} (${e?.joinToString("|")})"); return }
                if (e[1].toInt() != depth || e[2] != grp.id || e[3] != grp.label || e[4].toInt() != grp.rows.size) bad.add("csoport: Kotlin=$depth|${grp.id}|${grp.label}|${grp.rows.size} TS=${e.drop(1).joinToString("|")}")
                if (withRows) for (r in grp.rows) {
                    val x = next()
                    if (x == null || x[0] != "R") { bad.add("sor hiányzik: ${r.key}"); return }
                    fun chk(name: String, kt: Any?, ts: Any?) { if (kt != ts) bad.add("${r.key} $name: Kotlin=$kt TS=$ts") }
                    chk("key", r.key, x[1]); chk("label", r.label, x[2]); chk("hint", r.hint, nul(x[3])); chk("unit", r.unit, nul(x[4]))
                    chk("kind", r.kind, x[5]); chk("ids", r.ids.joinToString(","), x[6])
                    if (!near(r.range.min, x[7].toDouble()) || !near(r.range.max, x[8].toDouble()) || !near(r.range.step, x[9].toDouble())) {
                        bad.add("${r.key} tartomány: Kotlin=${r.range.min}..${r.range.max}/${r.range.step} TS=${x[7]}..${x[8]}/${x[9]}")
                    }
                    chk("int", r.range.int, x[10].toBoolean()); chk("code", r.code, x[11].toBoolean())
                }
                grp.sub?.let { walk(it, depth + 1, withRows) }
            }
        }
        for (el in model.elements) {
            val e = next()
            if (e == null || e[0] != "E") { bad.add("elem hiányzik: ${el.id} (${e?.joinToString("|")})"); break }
            val kt = listOf(el.id, el.label, el.short, el.scene, el.section ?: "-", el.file ?: "-")
            if (kt != e.drop(1)) bad.add("elem: Kotlin=$kt TS=${e.drop(1)}")
            walk(el.groups, 0, el.id != "code")
        }
        while (true) {
            val c = next() ?: break
            if (c[0] != "C") { bad.add("felesleges TS-sor: ${c.joinToString("|")}"); continue }
            val ids = model.curated[c[1]]?.joinToString(",") ?: "<nincs>"
            if (ids != c.getOrElse(2) { "" }) bad.add("kurált ${c[1]}: Kotlin=$ids TS=${c.getOrElse(2) { "" }}")
        }
        report("katalógus", bad)
    }

    @Test fun formattingAndPatchingMatchTs() {
        val g = golden("edits.tsv")
        val edits = HashMap<String, Double>()
        val bad = ArrayList<String>()
        for (row in g) if (row[0] == "F") {
            val l = model.lits.getValue(row[1])
            val v = row[2].toDouble()
            edits[l.id] = v
            val s = formatLiteral(l, v)
            if (s != row[3]) bad.add("${l.id} (${l.raw}, ${l.kind}) → $v: Kotlin=$s TS=${row[3]}")
        }
        report("számkiírás", bad)
        val sha = MessageDigest.getInstance("SHA-256")
        for (row in g) if (row[0] == "P") {
            val path = row[1]
            val f = model.files.getValue(path)
            val patched = patchSource(f.src, f.byStart.values.toList(), edits)
            val hex = sha.digest(patched.toByteArray(Charsets.UTF_8)).joinToString("") { "%02x".format(it) }
            assertEquals("$path: az átírt fájl hossza", row[3].toInt(), patched.length)
            assertEquals("$path: az átírt fájl tartalma", row[2], hex)
        }
    }
}
