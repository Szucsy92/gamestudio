package hu.gamestudio.app

import android.app.Application
import hu.gamestudio.app.data.InstallState
import hu.gamestudio.app.data.Updater
import hu.gamestudio.app.domain.AppRelease
import hu.gamestudio.app.domain.needsUpdate
import hu.gamestudio.app.domain.validRepository
import hu.gamestudio.app.studio.StudioStore
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.launch

enum class UpdateStatus { IDLE, DOWNLOADING, PERMISSION }
enum class UpdateCheck { IDLE, CHECKING, LATEST, ERROR }

/**
 * OTA-frissítés (GitHub Releases): induláskor, előtérbe lépéskor (legfeljebb 10 percenként) és kézzel.
 * Az új verzió felugró ablakban jelenik meg („Később” / „Letöltés”).
 */
class AppGraph(app: Application) {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main)
    val updater = Updater(app)
    val studio = StudioStore(app, scope)

    val availableUpdate = MutableStateFlow<AppRelease?>(null)
    val updateDismissed = MutableStateFlow(false)
    val updateStatus = MutableStateFlow(UpdateStatus.IDLE)
    val updatePercent = MutableStateFlow<Int?>(null)
    val updateCheck = MutableStateFlow(UpdateCheck.IDLE)
    private var lastCheckAt = 0L

    fun checkForUpdate(manual: Boolean) {
        val repo = BuildConfig.RELEASE_REPOSITORY
        if (!validRepository(repo)) { if (manual) updateCheck.value = UpdateCheck.ERROR; return }
        if (!manual && System.currentTimeMillis() - lastCheckAt < 10 * 60_000) return
        lastCheckAt = System.currentTimeMillis()
        if (manual) updateCheck.value = UpdateCheck.CHECKING
        scope.launch {
            runCatching { updater.latest(repo) }.onSuccess { r ->
                if (r != null && needsUpdate(updater.installedVersionCode(), r.versionCode)) {
                    availableUpdate.value = r; updateDismissed.value = false; updateCheck.value = UpdateCheck.IDLE
                } else updateCheck.value = if (manual) UpdateCheck.LATEST else UpdateCheck.IDLE
            }.onFailure { updateCheck.value = if (manual) UpdateCheck.ERROR else UpdateCheck.IDLE }
        }
    }

    fun startUpdate() {
        val r = availableUpdate.value ?: return
        if (updateStatus.value == UpdateStatus.DOWNLOADING) return
        updateStatus.value = UpdateStatus.DOWNLOADING; updatePercent.value = null
        scope.launch {
            when (updater.downloadAndInstall(r.apk) { updatePercent.value = it }) {
                InstallState.INSTALLING -> { updateStatus.value = UpdateStatus.IDLE; updateDismissed.value = true }
                InstallState.NEEDS_PERMISSION -> updateStatus.value = UpdateStatus.PERMISSION
                InstallState.FAILED -> { updateStatus.value = UpdateStatus.IDLE; updateDismissed.value = true; updater.openInBrowser(r.apk) }   // tartalék: böngésző
            }
        }
    }

    fun dismissUpdate() { if (updateStatus.value != UpdateStatus.DOWNLOADING) updateDismissed.value = true }
}
