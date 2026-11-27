package hu.gamestudio.app

import android.app.Application

/** Az alkalmazás-szintű állapot (OTA-frissítés) itt él, nem az Activity életciklusához kötve. */
class GameStudioApp : Application() {
    val graph: AppGraph by lazy { AppGraph(this) }
}
