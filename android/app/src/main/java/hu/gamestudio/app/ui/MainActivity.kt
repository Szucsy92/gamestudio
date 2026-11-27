package hu.gamestudio.app.ui

import android.graphics.Color
import android.os.Build
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.SystemBarStyle
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import hu.gamestudio.app.GameStudioApp

/** Az egyetlen Activity: teljes képernyős, átlátszó állapot- és navigációs sávval. */
class MainActivity : ComponentActivity() {
    private val graph get() = (application as GameStudioApp).graph

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        // Átlátszó sávok rendszer-scrim nélkül (különben a 3 gombos navigációnál világosabb csík marad); a felület mindig sötét: világos ikonok
        enableEdgeToEdge(
            statusBarStyle = SystemBarStyle.dark(Color.TRANSPARENT),
            navigationBarStyle = SystemBarStyle.dark(Color.TRANSPARENT),
        )
        if (Build.VERSION.SDK_INT >= 29) window.isNavigationBarContrastEnforced = false
        setContent { StudioTheme { StudioScreen(graph) } }
    }

    // Előtérbe lépéskor (és induláskor) új verzió keresése, legfeljebb 10 percenként
    override fun onStart() {
        super.onStart()
        graph.checkForUpdate(false)
    }
}
