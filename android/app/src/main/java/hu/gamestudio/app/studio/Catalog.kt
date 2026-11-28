package hu.gamestudio.app.studio

import java.util.regex.Pattern
import kotlin.math.abs

/**
 * A beolvasott repóból a stúdió elemlistája: elemek (fák, kapuk, …) → lenyíló csoportok → sorok, mindegyik sor egy
 * csúszka (vagy szín), amely a Kotlin források egy vagy több literáljához kötődik.
 * A src/studio/catalog.ts és a curated.ts portja.
 */
sealed interface CuratedSrc {
    val file: String

    data class Decl(override val file: String, val decl: String) : CuratedSrc
    data class Pattern(override val file: String, val find: String, val pick: List<Int>, val after: String?, val nth: Int?, val all: Boolean) : CuratedSrc
}

data class CuratedDef(
    val key: String,
    val element: String,
    val group: String,
    val label: String,
    val hint: String?,
    val unit: String?,
    /** "num" | "color" | "color3" */
    val kind: String,
    val min: Double?,
    val max: Double?,
    val step: Double?,
    val src: CuratedSrc,
)

data class Row(
    val key: String,
    val label: String,
    val hint: String?,
    val unit: String?,
    /** "num" | "color" | "color3" | "bool" */
    val kind: String,
    val ids: List<String>,
    val range: Range,
    /** A forrássort mutatja (általános sorok). */
    val code: Boolean,
)

class Group(val id: String, val label: String, val rows: MutableList<Row> = ArrayList(), val sub: List<Group>? = null)

data class ElementDef(
    val id: String,
    val label: String,
    val short: String,
    val scene: String,
    val groups: List<Group>,
    /** A dinamikusan talált elemek Kotlin object/class szakasza (pl. "Visuals.GateRing"). */
    val section: String?,
    val file: String?,
)

class FileIndex(val path: String, val src: String, val byStart: Map<Int, Literal>, val byDecl: Map<String, List<Literal>>)

class Model(
    val files: Map<String, FileIndex>,
    /** A repó minden Kotlin forrása (a tesztekkel együtt). */
    val kt: Map<String, String>,
    val lits: Map<String, Literal>,
    val elements: List<ElementDef>,
    val curated: Map<String, List<String>>,
    /** A repó fa-szakasza hangolható-e (vannak TREE_* tömbjei). */
    val treeFound: Boolean,
    val dynamic: Boolean,
)

val ELEMENTS: List<ElementDef> = listOf(
    ElementDef("trees", "Fák", "Fák", "tree", emptyList(), null, null),
    ElementDef("gates", "Kapuk és oszlopok", "Kapuk", "gates", emptyList(), null, null),
    ElementDef("hole", "Fekete lyuk és féreglyuk", "Fekete lyuk", "hole", emptyList(), null, null),
    ElementDef("orbs", "Power-up gömbök", "Power-up", "orbs", emptyList(), null, null),
    ElementDef("colors", "Színek", "Színek", "world", emptyList(), null, null),
    ElementDef("lights", "Fények és ég", "Fények", "world", emptyList(), null, null),
    ElementDef("graphics", "Grafika", "Grafika", "world", emptyList(), null, null),
    ElementDef("gameplay", "Játékmenet", "Játékmenet", "world", emptyList(), null, null),
    ElementDef("sound", "Hang", "Hang", "world", emptyList(), null, null),
    ElementDef("other", "Egyéb", "Egyéb", "world", emptyList(), null, null),
    ElementDef("code", "Kód – minden szám", "Kód", "world", emptyList(), null, null),
)

// ---- kurált sorok feloldása

private const val NUM_GROUP = "(-?(?:0[xX][0-9a-fA-F_]+|(?:\\d[\\d_]*)?\\.\\d[\\d_]*(?:[eE][-+]?\\d+)?|\\d[\\d_]*(?:[eE][-+]?\\d+)?)[fFL]?)"
private const val REGEX_SPECIAL = ".*+?^\${}()|[]\\"
private val WS_RE = Regex("\\s+")

private fun escapeRegex(w: String): String {
    val sb = StringBuilder()
    for (c in w) {
        if (c in REGEX_SPECIAL) sb.append('\\')
        sb.append(c)
    }
    return sb.toString()
}

/** A `#` tetszőleges számot jelent; a szóközök bármennyi szóközt/sortörést. (A TS patternRegex-szel azonos viselkedés.) */
fun patternRegex(find: String): Pattern {
    val re = StringBuilder()
    for (part in find.split("#")) {
        if (re.isNotEmpty()) re.append(NUM_GROUP)
        re.append(part.split(WS_RE).joinToString("\\s*") { escapeRegex(it) })
    }
    return Pattern.compile(re.toString())
}

fun findFile(files: Map<String, FileIndex>, suffix: String): FileIndex? {
    for ((p, f) in files) if (p == suffix || p.endsWith("/$suffix")) return f
    return null
}

/** Azok a literál-azonosítók, amelyekbe egy kurált vezérlő ír; üres, ha a repóban nincs ilyen kód. */
fun resolveCurated(def: CuratedDef, files: Map<String, FileIndex>): List<String> {
    val f = findFile(files, def.src.file) ?: return emptyList()
    val src = def.src
    if (src is CuratedSrc.Decl) return (f.byDecl[src.decl] ?: emptyList()).map { it.id }
    src as CuratedSrc.Pattern
    val from = if (src.after != null) f.src.indexOf(src.after) else 0
    if (from < 0) return emptyList()
    val m = patternRegex(src.find).matcher(f.src)
    val ids = ArrayList<String>()
    var count = 0
    var found = m.find(from)
    while (found) {
        count++
        if (src.all || count == (src.nth ?: 1)) {
            for (p in src.pick) {
                val lit = f.byStart[m.start(p + 1)] ?: return emptyList()
                ids.add(lit.id)
            }
            if (!src.all) break
        }
        found = m.find()
    }
    return ids
}

// ---- nevek

/** UPPER_SNAKE_CASE vagy camelCase azonosítóból olvasható címke. */
fun humanizeIdent(name: String): String {
    val base = name.split('.', '[')[0]
    val idx = Regex("\\[(\\d+)]").find(name)
    val suffix = if (idx != null) " #${idx.groupValues[1].toInt() + 1}" else ""
    val common = COMMON_WORDS[base]
    if (common != null) return "$common$suffix"
    val spaced = base.replace(Regex("([a-z0-9])([A-Z])"), "\$1 \$2").replace("_", " ").trim().lowercase()
    if (spaced.isEmpty()) return name
    return "${spaced.substring(0, 1).uppercase()}${spaced.substring(1)}$suffix"
}

fun humanizeObject(section: String): String {
    val leaf = section.substringAfterLast('.')
    return leaf.replace(Regex("([a-z0-9])([A-Z])"), "\$1 \$2").trim()
}

private val SKIP_DECL = Regex("^(K_\\w+|KINDS|SHAPES|XYZ|YXZ|RATE|VOLUME_POLL_NS|SLOTS|vertexCount|eps)$")
private val SKIP_SECTION = setOf("UiState", "Settings", "UpdateEvent", "MeshData", "EffectState", "Blip", "MainActivity", "SettingsRepo", "Updater", "EffectsModel", "FxTuning", "Features", "SkyLights", "Sprites")
private val CORE_SINGLETONS = setOf("Palette", "SkyLight", "Quality", "Shaders", "Meshes", "GameRenderer", "Simulation", "GameEngine", "PostFx", "ShadowMap", "Effects", "GlUtil", "Mat", "GlassState", "PerfStats", "ForestAudio", "Haptics", "TiltSensor", "ForestUi", "Visuals")
private val NON_OBJECT_FILE = Regex("^(Shaders|Quality|PostFx|Effects|SkyLight|ShadowMap|Palette|GlUtil|Mat|GlassState|PerfStats|GameRenderer)\\.kt$", RegexOption.IGNORE_CASE)
private val NON_VISUAL_DIR = Regex("/(audio|ui|update|data|input)/", RegexOption.IGNORE_CASE)
private val VISUAL_DIR = Regex("/(gl|render|visual|scene|entity|entities|mesh|3d|world|objects?)/", RegexOption.IGNORE_CASE)
private val VISUAL_FILE = Regex("(Visual|Render|Scene|Mesh|Entity|Object|Prop|Effect)", RegexOption.IGNORE_CASE)
private val VISUAL_NAMES = Regex("^(ON|SIZE|RADIUS|HEIGHT|WIDTH|DEPTH|ALPHA|EMISSIVE|ROUGH|TORUS_R|GLOW|COLOR|COUNT|SPIN|BOB)$", RegexOption.IGNORE_CASE)

private fun fileName(p: String) = p.substringAfterLast('/')

private fun isVisualCandidate(path: String, section: String, lits: List<Literal>): Boolean {
    if (lits.isEmpty()) return false
    val leaf = section.substringAfterLast('.')
    if (leaf in SKIP_SECTION || section in CORE_SINGLETONS) return false
    if (NON_VISUAL_DIR.containsMatchIn(path)) return false
    if (NON_OBJECT_FILE.containsMatchIn(fileName(path))) return false
    // Tárolóba ágyazott objektum (pl. Visuals.GateRing) mindig önálló vizuális objektum.
    if (section.contains('.')) return true
    val inVisualDir = VISUAL_DIR.containsMatchIn(path) || VISUAL_FILE.containsMatchIn(fileName(path))
    if (inVisualDir && leaf !in CORE_SINGLETONS && lits.size >= 2) return true
    val visualNames = lits.count { VISUAL_NAMES.containsMatchIn(it.declBase ?: "") }
    return visualNames >= 2
}

private val LIGHT_FILE = Regex("SkyLight|Light|Sun|Moon|Atmos", RegexOption.IGNORE_CASE)
private val GFX_DIR = Regex("/(gl|shader|render)/", RegexOption.IGNORE_CASE)
private val GFX_FILE = Regex("Shader|PostFx|Quality|Shadow|Renderer", RegexOption.IGNORE_CASE)
private val SND_DIR = Regex("/(audio|sound)/", RegexOption.IGNORE_CASE)
private val SND_FILE = Regex("Audio|Sound|Haptics", RegexOption.IGNORE_CASE)
private val GAME_DIR = Regex("/(sim|input|game|physics)/", RegexOption.IGNORE_CASE)
private val GAME_FILE = Regex("Engine|Simulation|Gameplay", RegexOption.IGNORE_CASE)
private val PALETTE_PATH = Regex("Palette\\.kt$", RegexOption.IGNORE_CASE)

private fun classify(path: String, lit: Literal): String {
    if (lit.kind == LitKind.HEX || PALETTE_PATH.containsMatchIn(path)) return "colors"
    if (LIGHT_FILE.containsMatchIn(fileName(path))) return "lights"
    if (path.endsWith("/Meshes.kt")) return "trees"
    if (GFX_DIR.containsMatchIn(path) || GFX_FILE.containsMatchIn(fileName(path))) return "graphics"
    if (SND_DIR.containsMatchIn(path) || SND_FILE.containsMatchIn(fileName(path))) return "sound"
    if (GAME_DIR.containsMatchIn(path) || GAME_FILE.containsMatchIn(fileName(path))) return "gameplay"
    return "other"
}

fun scanFiles(texts: Map<String, String>): Map<String, FileIndex> {
    val files = LinkedHashMap<String, FileIndex>()
    for ((path, src) in texts) {
        if (!path.endsWith(".kt") || Regex("/src/test/").containsMatchIn(path)) continue
        val lits = scanKotlin(path, src)
        val byDecl = LinkedHashMap<String, MutableList<Literal>>()
        for (l in lits) {
            val b = l.declBase ?: continue
            byDecl.getOrPut(b) { ArrayList() }.add(l)
        }
        files[path] = FileIndex(path, src, LinkedHashMap<Int, Literal>().also { m -> lits.forEach { m[it.start] = it } }, byDecl)
    }
    return files
}

fun rowFor(l: Literal, label: String, unit: String? = null): Row {
    val kind = if (l.kind == LitKind.HEX) "color" else if (l.kind == LitKind.BOOL) "bool" else "num"
    return Row(l.id, label, null, unit, kind, listOf(l.id), autoRange(l), true)
}

private val GATE_RE = Regex("^(GATE_|SECRET_)")
private val HOLE_RE = Regex("^(HOLE_|WARP_|LENS_)")
private val ORB_RE = Regex("^(POWERUP_|SHOCKWAVE_|ORB_)")

fun buildModel(texts: Map<String, String>): Model {
    val files = scanFiles(texts)
    val lits = LinkedHashMap<String, Literal>()
    for (f in files.values) for (l in f.byStart.values) lits[l.id] = l
    val meshes = findFile(files, "gl/Meshes.kt")
    val region: IntArray? = meshes?.let {
        val a = it.src.indexOf(SECTION_START)
        val b = it.src.indexOf(SECTION_END)
        if (a >= 0 && b > a) intArrayOf(a, b) else null
    }
    fun inTree(l: Literal) = region != null && meshes!!.path == l.file && l.start >= region[0] && l.start < region[1]
    val treeFound = meshes != null && TREE_ARRAYS.any { (meshes.byDecl[it]?.isNotEmpty()) == true }

    // 1. Dinamikus vizuális objektumok felfedezése a repó szakaszaiból.
    class Sec(val file: String, val lits: MutableList<Literal>)
    val bySection = LinkedHashMap<String, Sec>()
    for (f in files.values) {
        for (l in f.byStart.values) {
            val decl = l.decl
            if (decl == null || l.inFunction || inTree(l)) continue
            val base = decl.split('.', '[')[0]
            if (SKIP_DECL.matches(base) || l.section in SKIP_SECTION) continue
            val key = "${f.path}::${l.section}"
            val entry = bySection[key]
            if (entry != null) entry.lits.add(l) else bySection[key] = Sec(f.path, mutableListOf(l))
        }
    }

    class Dyn(val id: String, val section: String, val file: String, val lits: List<Literal>)
    val dynamicObjects = ArrayList<Dyn>()
    val dynamicLitIds = HashSet<String>()
    for ((key, sec) in bySection) {
        val section = key.substringAfter("::")
        if (!isVisualCandidate(sec.file, section, sec.lits)) continue
        dynamicObjects.add(Dyn("obj:$section", section, sec.file, sec.lits))
        for (l in sec.lits) dynamicLitIds.add(l.id)
    }
    val isDynamic = dynamicObjects.isNotEmpty()

    val groups = LinkedHashMap<String, LinkedHashMap<String, Group>>()
    fun groupOf(el: String, id: String, label: String): Group =
        groups.getOrPut(el) { LinkedHashMap() }.getOrPut(id) { Group(id, label) }

    // Kurált vezérlők: régi repókhoz (ha nincs dinamikus vizuális objektum, ami felülírja őket).
    val curated = LinkedHashMap<String, List<String>>()
    val used = HashSet<String>()
    for (c in CURATED) {
        val ids = resolveCurated(c, files)
        curated[c.key] = ids
        if (ids.isEmpty()) continue
        if (isDynamic && (c.element == "gates" || c.element == "hole" || c.element == "orbs")) continue
        val first = lits.getValue(ids[0])
        val range = if (c.min != null) {
            val step = c.step ?: 0.01
            Range(c.min, c.max ?: (c.min + 1), step, step >= 1)
        } else autoRange(first)
        val g = groupOf(c.element, "cur:${c.group}", c.group)
        // Egy szín több elem alatt is előfordulhat (pl. a titkos fény színe); mindegyik alatt szerkeszthető marad.
        g.rows.add(Row("cur:${c.key}", c.label, c.hint, c.unit, c.kind, ids, range, false))
        if (c.kind != "color") ids.forEach { used.add(it) }
    }

    // Minden névvel ellátott érték (osztály- vagy fájlszintű deklaráció).
    for (f in files.values) {
        for (l in f.byStart.values) {
            val decl = l.decl
            if (decl == null || l.inFunction || l.id in used || inTree(l) || l.id in dynamicLitIds) continue
            val base = decl.split('.', '[')[0]
            if (SKIP_DECL.matches(base) || l.section in SKIP_SECTION) continue
            var el = classify(f.path, l)
            if (!isDynamic) {
                if (GATE_RE.containsMatchIn(base)) el = "gates"
                else if (HOLE_RE.containsMatchIn(base)) el = "hole"
                else if (ORB_RE.containsMatchIn(base)) el = "orbs"
            }
            val lab = LABELS[decl] ?: LABELS[l.declBase ?: ""]
            val label = if (lab != null) {
                if (decl != l.declBase && LABELS[l.declBase ?: ""] != null && LABELS[decl] == null) "${lab.first} (${decl.substring(l.declBase!!.length)})" else lab.first
            } else humanizeIdent(decl)
            val gid = if (el == "colors" && fileName(f.path) == "Palette.kt") "named:palette" else "named:${f.path}:${l.section}"
            val glabel = if (gid == "named:palette") "Játék paletta" else if (l.glsl) "Shader állandók – ${l.section}" else "${fileName(f.path)} · ${l.section}"
            groupOf(el, gid, glabel).rows.add(rowFor(l, label, lab?.second))
        }
    }

    // Kód: minden fájl minden száma, fájl → szakasz.
    val codeGroups = ArrayList<Group>()
    for (f in files.values.sortedWith(compareBy(String.CASE_INSENSITIVE_ORDER) { it.path })) {
        val subs = LinkedHashMap<String, Group>()
        for (l in f.byStart.values) {
            if (inTree(l)) continue
            val g = subs.getOrPut(l.section) { Group("code:${f.path}:${l.section}", l.section) }
            g.rows.add(rowFor(l, l.decl ?: "${l.line}. sor"))
        }
        if (subs.isEmpty()) continue
        val sub = subs.values.toList()
        codeGroups.add(Group("code:${f.path}", "${fileName(f.path)} (${sub.sumOf { it.rows.size }} szám)", ArrayList(), sub))
    }

    // Dinamikus vizuális objektum elemek (a Fák után, vagy elöl, ha nincsenek fák).
    val dynamicElements = dynamicObjects.map { obj ->
        val name = humanizeObject(obj.section)
        val rows = obj.lits.map { l -> rowFor(l, humanizeIdent(l.decl ?: "")) }.toMutableList()
        ElementDef(obj.id, name, name, "dynamic", listOf(Group("dyn:${obj.section}", "${fileName(obj.file)} · ${obj.section}", rows)), obj.section, obj.file)
    }

    val elements = ArrayList<ElementDef>()
    for (e in ELEMENTS) {
        if (e.id == "trees") {
            val list = groups["trees"]?.values?.toList() ?: emptyList()
            if (treeFound || list.isNotEmpty()) elements.add(e.copy(groups = list))
            // A dinamikusan talált vizuális elemek közvetlenül a Fák után.
            elements.addAll(dynamicElements)
            continue
        }
        if (isDynamic && (e.id == "gates" || e.id == "hole" || e.id == "orbs")) continue
        if (e.id == "code") {
            elements.add(e.copy(groups = codeGroups))
            continue
        }
        val list = (groups[e.id]?.values?.toList() ?: emptyList()).sortedByDescending { if (it.id.startsWith("cur:")) 1 else 0 }
        if (list.isNotEmpty() || !isDynamic) elements.add(e.copy(groups = list))
    }
    return Model(files, texts.filterKeys { it.endsWith(".kt") }, lits, elements, curated, treeFound, isDynamic)
}

fun valueOf(model: Model, edits: Map<String, Double>, id: String): Double = edits[id] ?: model.lits[id]?.value ?: 0.0

fun rowChanged(model: Model, edits: Map<String, Double>, row: Row): Boolean =
    row.ids.any { id -> edits[id]?.let { abs(it - (model.lits[id]?.value ?: 0.0)) > 1e-12 } == true }

fun countChanged(model: Model, edits: Map<String, Double>, g: Group): Int =
    g.rows.count { rowChanged(model, edits, it) } + (g.sub ?: emptyList()).sumOf { countChanged(model, edits, it) }

// ---- a sor kódbeli neve

private fun frameArg(fr: CallFrame) = if (fr.name != null) "${fr.name} = …" else "#${fr.arg}"

private fun frameText(frames: List<CallFrame>, lastArg: CallFrame? = null): String =
    frames.reversed().mapIndexed { i, fr ->
        val arg = if (i == frames.size - 1 && lastArg != null && fr.name == null) "#${fr.arg}–${lastArg.arg}" else frameArg(fr)
        "${fr.fn}($arg)"
    }.joinToString(" › ")

private val ASSIGN_RE = Regex("\\b(?:val|var)\\s+([A-Za-z_]\\w*)(?:\\s*:\\s*[\\w<>?, ]+)?\\s*=(?!=)")

/** `bob` egy `val bob = …` utasításon belüli számhoz (ugyanaz az utasítás, legfeljebb néhány sorral feljebb). */
private fun assignedName(src: String, lit: Literal): String? {
    var from = lit.start
    var k = 0
    while (k <= lit.line - lit.stmtLine && from > 0) {
        from = src.lastIndexOf('\n', from - 1)
        k++
    }
    return ASSIGN_RE.find(src.substring(maxOf(0, from), lit.start))?.groupValues?.get(1)
}

/** Hogyan hivatkozik rá a kód: a deklaráció ("Palette.fog", "GATE_HALF"), vagy beágyazott számnál a hívás és az argumentum ("prim(#8)"). */
fun codeNameOf(model: Model, lit: Literal): String {
    val f = model.files[lit.file]
    val decl = lit.decl
    if (decl != null) {
        if (f == null) return decl
        val leaf = if (lit.section.contains('.')) lit.section.substringAfterLast('.') else lit.section
        val m = Regex("\\b(?:object|class)\\s+${Regex.escape(leaf)}\\b").find(f.src)
        return if (m != null && m.range.first < lit.start) "${lit.section}.$decl" else decl
    }
    val frames = if (f != null) callContext(f.src, lit.start) else emptyList()
    val assign = if (f != null) assignedName(f.src, lit) else null
    if (frames.isEmpty()) return if (assign != null) "$assign = …" else lit.section
    return "${if (assign != null) "$assign = " else ""}${frameText(frames)}"
}

private fun norm(s: String) = s.lowercase().replace(Regex("[^a-z0-9áéíóöőúüű]"), "")

data class CodeRef(val name: String, val where: String, val title: String)

/** A sor magyar címke alatt mutatott kódneve, vagy semmi, ha a címke már maga a kódnév. */
fun codeRef(model: Model, row: Row): CodeRef? {
    val lit = model.lits[row.ids[0]] ?: return null
    var name = codeNameOf(model, lit)
    if (row.ids.size > 1) {
        val last = model.lits[row.ids.last()]
        val f = model.files[lit.file]
        val a = if (lit.decl == null && f != null) callContext(f.src, lit.start) else emptyList()
        val b = if (last != null && last.decl == null && last.file == lit.file && f != null) callContext(f.src, last.start) else emptyList()
        val sameCall = a.isNotEmpty() && b.isNotEmpty() && a[0].fn == b[0].fn && last!!.line == lit.line
        if (sameCall) name = frameText(a, b[0])
        else if (row.kind == "num") name += " +${row.ids.size - 1}"
    }
    if (norm(name) == norm(row.label) || norm(lit.decl ?: "") == norm(row.label)) return null
    val where = "${lit.file.substringAfterLast('/')}:${lit.line}"
    val title = if (lit.decl != null) "$name – ${lit.section}, $where" else "${lit.section}: $name (#n = az n. paraméter), $where"
    return CodeRef(name, where, title)
}

/** Minden literálhoz olvasható név: a magyar sorcímke, ha van. */
fun labelIndex(model: Model): Map<String, String> {
    val out = LinkedHashMap<String, String>()
    fun walk(gs: List<Group>) {
        for (g in gs) {
            for (r in g.rows) for (id in r.ids) if (id !in out) out[id] = r.label
            g.sub?.let { walk(it) }
        }
    }
    for (el in model.elements) if (el.id != "code") walk(el.groups)
    model.elements.firstOrNull { it.id == "code" }?.let { walk(it.groups) }
    return out
}
