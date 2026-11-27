package hu.gamestudio.app.ui

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import hu.gamestudio.app.AppGraph
import hu.gamestudio.app.UpdateCheck
import hu.gamestudio.app.UpdateStatus
import hu.gamestudio.app.domain.AppRelease

private enum class Panel(val label: String) { STUDIO("Stúdió"), UPDATE("Frissítés") }

/**
 * Egyetlen, teljes képernyős felület: a 3D nézet kitölti a képernyőt (a rendszersávok alatt is), minden vezérlő az alsó
 * munkaasztalon (dock + felfelé nyíló fiók) van. Az új verzió felugró ablakban jelenik meg.
 */
@Composable
fun StudioScreen(graph: AppGraph) {
    var open by remember { mutableStateOf<Panel?>(null) }
    val avail by graph.availableUpdate.collectAsState()
    val dismissed by graph.updateDismissed.collectAsState()
    val status by graph.updateStatus.collectAsState()
    val percent by graph.updatePercent.collectAsState()
    BackHandler(enabled = open != null) { open = null }

    Box(Modifier.fillMaxSize().background(Palette.bg)) {
        Viewport(Modifier.fillMaxSize())
        Column(Modifier.align(Alignment.TopStart).statusBarsPadding().padding(16.dp)) {
            Text("GameStudio", color = Palette.text, fontSize = 18.sp, fontWeight = FontWeight.SemiBold)
            Text("natív változat · ${graph.updater.installedVersionName()}", color = Palette.muted, fontSize = 12.sp)
        }
        Workbench(open, { open = if (open == it) null else it }, graph, Modifier.align(Alignment.BottomCenter))
        val release = avail
        if (release != null && !dismissed) {
            UpdateDialog(release, status, percent, onLater = { graph.dismissUpdate() }, onDownload = { graph.startUpdate() })
        }
    }
}

/** A 3D nézet helye: a teljes képernyőt kitölti; a motor átvitele a következő lépés (lásd android/README.md). */
@Composable
private fun Viewport(modifier: Modifier) {
    Canvas(modifier) {
        drawRect(Brush.verticalGradient(listOf(Palette.bgTop, Palette.bg)))
        val step = 48.dp.toPx()
        var x = 0f
        while (x < size.width) { drawLine(Palette.border, Offset(x, 0f), Offset(x, size.height), strokeWidth = 1f); x += step }
        var y = 0f
        while (y < size.height) { drawLine(Palette.border, Offset(0f, y), Offset(size.width, y), strokeWidth = 1f); y += step }
    }
}

@Composable
private fun Workbench(open: Panel?, onSelect: (Panel) -> Unit, graph: AppGraph, modifier: Modifier) {
    val shape = RoundedCornerShape(topStart = 24.dp, topEnd = 24.dp)
    Column(modifier.fillMaxWidth().clip(shape).background(Palette.panel).border(1.dp, Palette.border, shape).navigationBarsPadding()) {
        if (open != null) {
            Column(Modifier.fillMaxWidth().heightIn(max = 320.dp).verticalScroll(rememberScrollState()).padding(horizontal = 20.dp, vertical = 16.dp)) {
                when (open) {
                    Panel.STUDIO -> StudioPanel()
                    Panel.UPDATE -> UpdatePanel(graph)
                }
            }
        }
        Row(Modifier.fillMaxWidth().padding(horizontal = 12.dp, vertical = 8.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            for (p in Panel.values()) DockChip(p.label, selected = open == p, onClick = { onSelect(p) })
        }
    }
}

@Composable
private fun DockChip(text: String, selected: Boolean, onClick: () -> Unit) {
    val shape = RoundedCornerShape(50)
    Box(
        Modifier.heightIn(min = 44.dp).clip(shape)
            .then(if (selected) Modifier.background(Palette.accent) else Modifier.border(1.dp, Palette.border, shape))
            .clickable(onClick = onClick).padding(horizontal = 18.dp),
        contentAlignment = Alignment.Center,
    ) {
        Text(text, color = if (selected) Palette.bg else Palette.text, fontSize = 14.sp, fontWeight = FontWeight.Medium)
    }
}

@Composable
private fun StudioPanel() {
    Text("Natív GameStudio", color = Palette.text, fontSize = 16.sp, fontWeight = FontWeight.SemiBold)
    Text(
        "A stúdió motorja (Kotlin-elemző, törlés, fa-háló) és a 3D nézet átvitele folyamatban van. Ez a kiadás a natív alapot adja: " +
            "teljes képernyős felület, átlátszó rendszersávok, GitHub Actions építés és frissítés felugró ablakkal.",
        color = Palette.muted, fontSize = 13.sp, modifier = Modifier.padding(top = 8.dp),
    )
}

@Composable
private fun UpdatePanel(graph: AppGraph) {
    val check by graph.updateCheck.collectAsState()
    val avail by graph.availableUpdate.collectAsState()
    val status by graph.updateStatus.collectAsState()
    val percent by graph.updatePercent.collectAsState()
    val downloading = status == UpdateStatus.DOWNLOADING
    Text("Frissítés", color = Palette.text, fontSize = 16.sp, fontWeight = FontWeight.SemiBold)
    Text("Telepített verzió: ${graph.updater.installedVersionName()}", color = Palette.muted, fontSize = 13.sp, modifier = Modifier.padding(top = 6.dp))
    val line = when {
        downloading -> "Letöltés…${percent?.let { " $it%" } ?: ""}"
        status == UpdateStatus.PERMISSION -> "Engedélyezd a telepítést a GameStudio számára, majd koppints újra a Letöltésre."
        avail != null -> "Új verzió érhető el: ${avail?.version}"
        check == UpdateCheck.CHECKING -> "Keresés…"
        check == UpdateCheck.LATEST -> "A legfrissebb verziót használod."
        check == UpdateCheck.ERROR -> "A frissítés keresése nem sikerült."
        else -> "Az app induláskor és előtérbe lépéskor magától keres új verziót."
    }
    Text(line, color = if (check == UpdateCheck.ERROR) Palette.danger else Palette.text, fontSize = 13.sp, modifier = Modifier.padding(top = 6.dp))
    Row(Modifier.padding(top = 12.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        if (avail != null && check != UpdateCheck.CHECKING) {
            ActionButton(if (downloading) "Letöltés…${percent?.let { " $it%" } ?: ""}" else "Letöltés", enabled = !downloading, onClick = { graph.updateDismissed.value = true; graph.startUpdate() })
        } else {
            ActionButton("Keresés", outline = true, enabled = check != UpdateCheck.CHECKING, onClick = { graph.checkForUpdate(true) })
        }
    }
}

@Composable
private fun UpdateDialog(release: AppRelease, status: UpdateStatus, percent: Int?, onLater: () -> Unit, onDownload: () -> Unit) {
    val busy = status == UpdateStatus.DOWNLOADING
    val shape = RoundedCornerShape(20.dp)
    Dialog(onDismissRequest = onLater, properties = DialogProperties(dismissOnBackPress = !busy, dismissOnClickOutside = !busy)) {
        Column(Modifier.clip(shape).background(Color(0xFF101B31)).border(1.dp, Palette.border, shape).padding(20.dp)) {
            Text("Új frissítés elérhető", color = Palette.text, fontSize = 17.sp, fontWeight = FontWeight.SemiBold)
            Text("Verzió: ${release.version}", color = Palette.muted, fontSize = 13.sp, modifier = Modifier.padding(top = 4.dp))
            val note = when {
                busy -> "Letöltés…${percent?.let { " $it%" } ?: ""}"
                status == UpdateStatus.PERMISSION -> "Engedélyezd a telepítést a GameStudio számára, majd koppints újra a Letöltésre."
                else -> "A letöltés után a rendszer telepítője kéri a megerősítést."
            }
            Text(note, color = Palette.text, fontSize = 13.sp, modifier = Modifier.padding(top = 12.dp))
            Row(Modifier.fillMaxWidth().padding(top = 20.dp), horizontalArrangement = Arrangement.spacedBy(8.dp, Alignment.End)) {
                ActionButton("Később", outline = true, enabled = !busy, onClick = onLater)
                ActionButton("Letöltés", enabled = !busy, onClick = onDownload)
            }
        }
    }
}

@Composable
private fun ActionButton(text: String, onClick: () -> Unit, enabled: Boolean = true, outline: Boolean = false) {
    val shape = RoundedCornerShape(12.dp)
    Box(
        Modifier.alpha(if (enabled) 1f else 0.5f).heightIn(min = 44.dp).clip(shape)
            .then(if (outline) Modifier.border(1.dp, Palette.border, shape) else Modifier.background(Palette.accent))
            .clickable(enabled = enabled, onClick = onClick).padding(horizontal = 18.dp),
        contentAlignment = Alignment.Center,
    ) {
        Text(text, color = if (outline) Palette.text else Palette.bg, fontSize = 14.sp, fontWeight = FontWeight.Medium)
    }
}
