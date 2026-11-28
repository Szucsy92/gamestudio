package hu.gamestudio.app.studio

import java.io.InputStream
import java.io.OutputStream
import java.util.zip.ZipEntry
import java.util.zip.ZipInputStream
import java.util.zip.ZipOutputStream

/** A stúdió exportjában a repó mellé kerülő mappa; ZIP visszatöltésekor figyelmen kívül marad. */
const val STUDIO_DIR = "GameStudio"

/** A betöltött alap-repó: csak a Kotlin források szövege él a memóriában, a többi fájl a ZIP-ben marad. */
class RepoData(val name: String, val root: String, val texts: Map<String, String>, val size: Long)

private fun skipEntry(name: String): Boolean =
    name.startsWith("__MACOSX/") || Regex("(^|/)\\.git/").containsMatchIn(name) || name.startsWith("$STUDIO_DIR/") || Regex("(^|/)\\.DS_Store$").containsMatchIn(name)

/** A ZIP legfelső mappája, ha minden fájl abban van (a GitHub-letöltések `repo-main/` mappája), különben üres. */
private fun rootOf(names: List<String>): String {
    if (names.isEmpty()) return ""
    val firsts = names.map { if (it.contains('/')) it.substringBefore('/') else "" }.toSet()
    return if (firsts.size == 1 && "" !in firsts) firsts.first() else ""
}

fun parseRepoZip(input: InputStream, name: String, size: Long): RepoData {
    val raw = LinkedHashMap<String, ByteArray>()
    val names = ArrayList<String>()
    ZipInputStream(input).use { zin ->
        while (true) {
            val e: ZipEntry = zin.nextEntry ?: break
            if (e.isDirectory || skipEntry(e.name)) continue
            names.add(e.name)
            // csak a Kotlin forrásokat tartjuk meg; a többi fájlt átugorjuk
            if (e.name.endsWith(".kt")) raw[e.name] = zin.readBytes()
        }
    }
    if (names.isEmpty()) throw IllegalArgumentException("A ZIP üres.")
    val root = rootOf(names)
    val texts = LinkedHashMap<String, String>()
    for ((n, bytes) in raw) texts[if (root.isNotEmpty()) n.substring(root.length + 1) else n] = String(bytes, Charsets.UTF_8)
    if (texts.isEmpty()) throw IllegalArgumentException("Ebben a ZIP-ben nincs Kotlin forrásfájl (.kt).")
    return RepoData(name, root, texts, size)
}

/** A változások leírása a ZIP-be kerülő CHANGES.md-hez. */
fun changesMarkdown(repo: RepoData, model: Model, edits: Map<String, Double>): String {
    val labels = labelIndex(model)
    val sb = StringBuilder()
    sb.append("# GameStudio – módosítások\n\nAlap: **").append(repo.name).append("**\n\n")
    var n = 0
    for (f in model.files.values) {
        val rows = f.byStart.values.filter { l -> edits[l.id]?.let { kotlin.math.abs(it - l.value) > 1e-12 } == true }
        if (rows.isEmpty()) continue
        sb.append("## ").append(f.path).append("\n\n")
        for (l in rows) {
            n++
            val v = edits.getValue(l.id)
            sb.append("- ").append(labels[l.id] ?: l.decl ?: "${l.line}. sor").append(" (sor ").append(l.line).append("): `")
                .append(l.raw).append("` → `").append(formatLiteral(l, v)).append("`\n")
        }
        sb.append('\n')
    }
    if (n == 0) sb.append("Nincs módosított érték.\n")
    return sb.toString()
}

/** Az eredeti ZIP minden fájlja változatlanul, a módosított Kotlin források átírva; mellé a GameStudio/CHANGES.md. */
fun writePatchedZip(original: () -> InputStream, repo: RepoData, model: Model, edits: Map<String, Double>, out: OutputStream) {
    val patched = HashMap<String, ByteArray>()
    for (f in model.files.values) {
        val lits = f.byStart.values.toList()
        val text = patchSource(f.src, lits, edits)
        if (text != f.src) patched[(if (repo.root.isNotEmpty()) repo.root + "/" else "") + f.path] = text.toByteArray(Charsets.UTF_8)
    }
    ZipOutputStream(out).use { zout ->
        ZipInputStream(original()).use { zin ->
            val buf = ByteArray(64 * 1024)
            while (true) {
                val e = zin.nextEntry ?: break
                if (skipEntry(e.name)) continue
                zout.putNextEntry(ZipEntry(e.name))
                if (!e.isDirectory) {
                    val repl = patched[e.name]
                    if (repl != null) zout.write(repl)
                    else while (true) { val n = zin.read(buf); if (n < 0) break; zout.write(buf, 0, n) }
                }
                zout.closeEntry()
            }
        }
        zout.putNextEntry(ZipEntry("$STUDIO_DIR/CHANGES.md"))
        zout.write(changesMarkdown(repo, model, edits).toByteArray(Charsets.UTF_8))
        zout.closeEntry()
    }
}
