package hu.gamestudio.app.ui

import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Slider
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import hu.gamestudio.app.AppGraph
import hu.gamestudio.app.studio.ElementDef
import hu.gamestudio.app.studio.Group
import hu.gamestudio.app.studio.Literal
import hu.gamestudio.app.studio.Model
import hu.gamestudio.app.studio.Range
import hu.gamestudio.app.studio.Row as StudioRow
import hu.gamestudio.app.studio.StudioStore
import hu.gamestudio.app.studio.codeRef
import hu.gamestudio.app.studio.countChanged
import hu.gamestudio.app.studio.formatLiteral
import hu.gamestudio.app.studio.labelIndex
import hu.gamestudio.app.studio.rowChanged
import hu.gamestudio.app.studio.valueOf
import java.math.BigDecimal
import java.math.MathContext
import kotlin.math.abs
import kotlin.math.pow
import kotlin.math.roundToLong

// ---- az elemek fiókja: lenyíló csoportok és csúszkás sorok

private sealed interface Item {
    val key: String
}

private class Head(val group: Group, val depth: Int, val isOpen: Boolean, val changed: Int) : Item {
    override val key get() = "h:${group.id}"
}

private class RowItem(val group: Group, val row: StudioRow) : Item {
    override val key get() = "r:${group.id}:${row.key}"
}

private fun flatten(model: Model, edits: Map<String, Double>, groups: List<Group>, open: Set<String>, depth: Int, out: MutableList<Item>) {
    for (g in groups) {
        val isOpen = g.id in open
        out.add(Head(g, depth, isOpen, countChanged(model, edits, g)))
        if (!isOpen) continue
        for (r in g.rows) out.add(RowItem(g, r))
        g.sub?.let { flatten(model, edits, it, open, depth + 1, out) }
    }
}

@Composable
internal fun ElementPanel(model: Model, el: ElementDef, edits: Map<String, Double>, store: StudioStore) {
    // Elsőre az első csoport nyitva (a Fák és a Kód elemnél nem: ott sok a csoport).
    var open by remember(el.id) { mutableStateOf<Set<String>>(if (el.id == "trees" || el.id == "code") emptySet<String>() else setOfNotNull(el.groups.firstOrNull()?.id)) }
    val items = remember(el.id, open, edits, model) {
        val out = ArrayList<Item>()
        flatten(model, edits, el.groups, open, 0, out)
        out
    }
    LazyColumn(Modifier.fillMaxWidth(), contentPadding = PaddingValues(horizontal = 20.dp, vertical = 12.dp)) {
        item(key = "title") { Text(el.label, color = Palette.text, fontSize = 16.sp, fontWeight = FontWeight.SemiBold, modifier = Modifier.padding(bottom = 4.dp)) }
        if (el.groups.isEmpty()) {
            item(key = "empty") {
                Text(
                    if (el.id == "trees") "A fa-szerkesztő (a fák alakja és háromszögszáma) a következő lépésben kerül át a natív változatba."
                    else "Ebben a repóban nincs ide tartozó szám.",
                    color = Palette.muted, fontSize = 13.sp,
                )
            }
        }
        items(items, key = { it.key }) { item ->
            when (item) {
                is Head -> GroupHeader(item) { open = if (item.group.id in open) open - item.group.id else open + item.group.id }
                is RowItem -> RowView(model, item.row, edits, store)
            }
        }
    }
}

@Composable
private fun GroupHeader(h: Head, onToggle: () -> Unit) {
    Row(
        Modifier.fillMaxWidth().heightIn(min = 48.dp).clickable(onClick = onToggle).padding(start = (h.depth * 12).dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Text(if (h.isOpen) "▾" else "▸", color = Palette.muted, fontSize = 14.sp, modifier = Modifier.padding(end = 8.dp))
        Text(h.group.label, color = Palette.text, fontSize = 14.sp, fontWeight = FontWeight.Medium, modifier = Modifier.weight(1f))
        if (h.changed > 0) {
            Text("${h.changed}", color = Palette.bg, fontSize = 11.sp, modifier = Modifier.clip(RoundedCornerShape(50)).background(Palette.accent).padding(horizontal = 7.dp, vertical = 1.dp))
        }
    }
}

@Composable
private fun RowView(model: Model, row: StudioRow, edits: Map<String, Double>, store: StudioStore) {
    when (row.kind) {
        "bool" -> BoolRow(model, row, edits, store)
        "color" -> HexColorRow(model, row, edits, store)
        "color3" -> Color3Row(model, row, edits, store)
        else -> NumRow(model, row, edits, store)
    }
}

@Composable
private fun RowLabel(model: Model, row: StudioRow, modifier: Modifier) {
    val ref = remember(row.key, model) { codeRef(model, row) }
    Column(modifier) {
        Text(row.label, color = Palette.text, fontSize = 14.sp)
        if (row.hint != null) Text(row.hint, color = Palette.muted, fontSize = 11.sp)
        if (ref != null) Text(ref.where + " · " + ref.name, color = Palette.muted, fontSize = 11.sp, maxLines = 1)
    }
}

@Composable
private fun RevertButton(visible: Boolean, onClick: () -> Unit) {
    if (visible) Text("↺", color = Palette.accent, fontSize = 18.sp, modifier = Modifier.clickable(onClick = onClick).padding(horizontal = 10.dp, vertical = 6.dp))
}

private fun clean(x: Double): Double = BigDecimal(x).round(MathContext(7)).toDouble()

private fun quantize(x: Double, r: Range): Double {
    if (r.int) return x.roundToLong().toDouble()
    if (r.step <= 0.0) return clean(x)
    return clean(((x - r.min) / r.step).roundToLong() * r.step + r.min)
}

private fun fmt(v: Double, int: Boolean): String =
    if (int) v.roundToLong().toString() else BigDecimal(v).round(MathContext(5)).stripTrailingZeros().toPlainString()

@Composable
private fun NumRow(model: Model, row: StudioRow, edits: Map<String, Double>, store: StudioStore) {
    val v = valueOf(model, edits, row.ids[0])
    val changed = rowChanged(model, edits, row)
    val r = row.range
    val lo = minOf(r.min, v)
    val hi = maxOf(if (r.max > r.min) r.max else r.min + 1.0, v)
    val steps = if (r.int && r.step > 0 && (hi - lo) / r.step <= 200) ((hi - lo) / r.step).toInt() - 1 else 0
    Column(Modifier.fillMaxWidth().padding(vertical = 4.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            RowLabel(model, row, Modifier.weight(1f))
            Text(fmt(v, r.int) + (row.unit?.let { " $it" } ?: ""), color = if (changed) Palette.accent else Palette.muted, fontSize = 13.sp)
            RevertButton(changed) { store.revert(row.ids) }
        }
        Slider(
            value = v.toFloat().coerceIn(lo.toFloat(), hi.toFloat()),
            onValueChange = { f -> val q = quantize(f.toDouble(), r); store.setValues(row.ids.map { it to q }) },
            valueRange = lo.toFloat()..hi.toFloat(),
            steps = maxOf(0, steps),
        )
    }
}

@Composable
private fun BoolRow(model: Model, row: StudioRow, edits: Map<String, Double>, store: StudioStore) {
    val v = valueOf(model, edits, row.ids[0])
    val changed = rowChanged(model, edits, row)
    Row(Modifier.fillMaxWidth().padding(vertical = 4.dp), verticalAlignment = Alignment.CenterVertically) {
        RowLabel(model, row, Modifier.weight(1f))
        RevertButton(changed) { store.revert(row.ids) }
        Switch(checked = v >= 0.5, onCheckedChange = { on -> store.setValues(row.ids.map { it to (if (on) 1.0 else 0.0) }) })
    }
}

@Composable
private fun Swatch(color: Color) {
    Box(Modifier.size(28.dp).clip(RoundedCornerShape(8.dp)).background(color).border(1.dp, Palette.border, RoundedCornerShape(8.dp)))
}

@Composable
private fun ChannelSlider(name: String, value: Float, max: Float, onChange: (Float) -> Unit) {
    Row(verticalAlignment = Alignment.CenterVertically) {
        Text(name, color = Palette.muted, fontSize = 12.sp, modifier = Modifier.padding(end = 8.dp))
        Slider(value = value.coerceIn(0f, max), onValueChange = onChange, valueRange = 0f..max, modifier = Modifier.weight(1f))
    }
}

/** 0xRRGGBB szín egyetlen literálban: három 0…255 csúszka. */
@Composable
private fun HexColorRow(model: Model, row: StudioRow, edits: Map<String, Double>, store: StudioStore) {
    val rgb = valueOf(model, edits, row.ids[0]).toInt().coerceIn(0, 0xFFFFFF)
    val changed = rowChanged(model, edits, row)
    fun set(c: Int, shift: Int, f: Float) {
        val next = (rgb and (0xFF shl shift).inv()) or (f.toInt().coerceIn(0, 255) shl shift)
        store.setValues(row.ids.map { it to next.toDouble() })
    }
    Column(Modifier.fillMaxWidth().padding(vertical = 4.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            RowLabel(model, row, Modifier.weight(1f))
            Swatch(Color(0xFF000000.toInt() or rgb))
            RevertButton(changed) { store.revert(row.ids) }
        }
        ChannelSlider("R", ((rgb shr 16) and 255).toFloat(), 255f) { set(rgb, 16, it) }
        ChannelSlider("G", ((rgb shr 8) and 255).toFloat(), 255f) { set(rgb, 8, it) }
        ChannelSlider("B", (rgb and 255).toFloat(), 255f) { set(rgb, 0, it) }
    }
}

private fun lin2srgb(c: Double): Float {
    val x = c.coerceIn(0.0, 1.0)
    return (if (x <= 0.0031308) 12.92 * x else 1.055 * x.pow(1 / 2.4) - 0.055).toFloat()
}

/** Három lineáris 0…1 lebegőpontos szám egy színként. */
@Composable
private fun Color3Row(model: Model, row: StudioRow, edits: Map<String, Double>, store: StudioStore) {
    if (row.ids.size < 3) return NumRow(model, row, edits, store)
    val c = row.ids.take(3).map { valueOf(model, edits, it) }
    val changed = rowChanged(model, edits, row)
    Column(Modifier.fillMaxWidth().padding(vertical = 4.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            RowLabel(model, row, Modifier.weight(1f))
            Swatch(Color(lin2srgb(c[0]), lin2srgb(c[1]), lin2srgb(c[2])))
            RevertButton(changed) { store.revert(row.ids) }
        }
        val names = listOf("R", "G", "B")
        for (i in 0 until 3) ChannelSlider(names[i], c[i].toFloat(), 1f) { f -> store.setValues(listOf(row.ids[i] to clean((f * 100.0).roundToLong() / 100.0))) }
    }
}

// ---- Változások

@Composable
internal fun ChangesPanel(graph: AppGraph) {
    val store = graph.studio
    val model by store.model.collectAsState()
    val repo by store.repo.collectAsState()
    val edits by store.edits.collectAsState()
    val busy by store.busy.collectAsState()
    val saveLauncher = rememberLauncherForActivityResult(ActivityResultContracts.CreateDocument("application/zip")) { uri -> if (uri != null) store.export(uri) }
    val m = model
    val labels = remember(m) { if (m != null) labelIndex(m) else emptyMap<String, String>() }
    val changed = remember(edits, m) {
        if (m == null) emptyList<Literal>()
        else edits.keys.mapNotNull { m.lits[it] }.filter { l -> abs((edits[l.id] ?: l.value) - l.value) > 1e-12 }.sortedWith(compareBy({ it.file }, { it.start }))
    }
    LazyColumn(Modifier.fillMaxWidth(), contentPadding = PaddingValues(horizontal = 20.dp, vertical = 12.dp)) {
        item(key = "head") {
            Column {
                Text("Változások", color = Palette.text, fontSize = 16.sp, fontWeight = FontWeight.SemiBold)
                Text(if (changed.isEmpty()) "Még nincs módosított érték." else "${changed.size} módosított érték", color = Palette.muted, fontSize = 13.sp, modifier = Modifier.padding(top = 4.dp))
                Row(Modifier.padding(vertical = 10.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    ActionButton("Módosított ZIP mentése", enabled = repo != null && busy == null, onClick = { saveLauncher.launch("${repo?.name ?: "repo"}-studio.zip") })
                    if (changed.isNotEmpty()) ActionButton("Mind vissza", outline = true, onClick = { store.revertAll() })
                }
            }
        }
        items(changed, key = { it.id }) { l ->
            val v = edits[l.id] ?: l.value
            Row(Modifier.fillMaxWidth().padding(vertical = 4.dp), verticalAlignment = Alignment.CenterVertically) {
                Column(Modifier.weight(1f)) {
                    Text(labels[l.id] ?: l.decl ?: "${l.line}. sor", color = Palette.text, fontSize = 14.sp)
                    Text("${l.file.substringAfterLast('/')}:${l.line} · ${l.raw} → ${formatLiteral(l, v)}", color = Palette.muted, fontSize = 11.sp)
                }
                RevertButton(true) { store.revert(listOf(l.id)) }
            }
        }
    }
}
