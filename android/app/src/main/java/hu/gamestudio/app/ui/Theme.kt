package hu.gamestudio.app.ui

import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color

object Palette {
    val bg = Color(0xFF0B1425)
    val bgTop = Color(0xFF16233D)
    val panel = Color(0xE6101B31)
    val border = Color(0x33FFFFFF)
    val text = Color(0xFFE8EEF8)
    val muted = Color(0xFF9AA8C2)
    val accent = Color(0xFF7BC96F)
    val danger = Color(0xFFE5736A)
}

@Composable
fun StudioTheme(content: @Composable () -> Unit) {
    MaterialTheme(
        colorScheme = darkColorScheme(primary = Palette.accent, background = Palette.bg, surface = Palette.panel, onSurface = Palette.text, onBackground = Palette.text),
        content = content,
    )
}
