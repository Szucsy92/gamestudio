package hu.gamestudio.app.studio

import android.app.Application
import android.net.Uri
import android.provider.OpenableColumns
import java.io.File
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.launch
import org.json.JSONObject

/**
 * A stúdió állapota: a betöltött repó, a belőle épített modell és a szerkesztések.
 * A repó ZIP-je és a szerkesztések az app saját mappájában maradnak, újraindítás után folytatódik a munka.
 */
class StudioStore(private val app: Application, private val scope: CoroutineScope) {
    val busy = MutableStateFlow<String?>(null)
    val error = MutableStateFlow<String?>(null)
    val notice = MutableStateFlow<String?>(null)
    val repo = MutableStateFlow<RepoData?>(null)
    val model = MutableStateFlow<Model?>(null)
    val edits = MutableStateFlow<Map<String, Double>>(emptyMap())

    private val repoFile = File(app.filesDir, "repo.zip")
    private val stateFile = File(app.filesDir, "state.json")
    private var saveJob: Job? = null
    private var started = false

    /** Induláskor: az utoljára használt repó visszatöltése. */
    fun restore() {
        if (started) return
        started = true
        if (!repoFile.exists()) return
        scope.launch(Dispatchers.Default) {
            busy.value = "Repó betöltése…"
            try {
                val meta = runCatching { JSONObject(stateFile.readText()) }.getOrNull()
                val name = meta?.optString("name").orEmpty().ifEmpty { "repo" }
                val data = repoFile.inputStream().buffered().use { parseRepoZip(it, name, repoFile.length()) }
                val m = buildModel(data.texts)
                val saved = HashMap<String, Double>()
                val obj = meta?.optJSONObject("edits")
                if (meta != null && obj != null && meta.optLong("size") == data.size) {
                    for (k in obj.keys()) if (m.lits.containsKey(k)) saved[k] = obj.getDouble(k)
                }
                repo.value = data; model.value = m; edits.value = saved
            } catch (e: Throwable) {
                error.value = "A mentett repó nem tölthető be: ${e.message}"
            } finally { busy.value = null }
        }
    }

    /** Új repó megnyitása a rendszer fájlválasztójából kapott címről. */
    fun openRepo(uri: Uri) {
        scope.launch(Dispatchers.Default) {
            busy.value = "Repó beolvasása…"; error.value = null
            try {
                val name = displayName(uri) ?: "repo.zip"
                app.contentResolver.openInputStream(uri)!!.use { inp -> repoFile.outputStream().use { inp.copyTo(it) } }
                val data = repoFile.inputStream().buffered().use { parseRepoZip(it, name.removeSuffix(".zip"), repoFile.length()) }
                busy.value = "Számok keresése…"
                val m = buildModel(data.texts)
                repo.value = data; model.value = m; edits.value = emptyMap()
                save()
                notice.value = "${m.lits.size} szám a ${m.files.size} Kotlin fájlban."
            } catch (e: Throwable) {
                error.value = "A repó nem nyitható meg: ${e.message}"
            } finally { busy.value = null }
        }
    }

    private fun displayName(uri: Uri): String? = runCatching {
        app.contentResolver.query(uri, arrayOf(OpenableColumns.DISPLAY_NAME), null, null, null)?.use { c -> if (c.moveToFirst()) c.getString(0) else null }
    }.getOrNull()

    fun setValues(pairs: List<Pair<String, Double>>) {
        val m = model.value ?: return
        val next = HashMap(edits.value)
        for ((id, v) in pairs) {
            val base = m.lits[id]?.value
            if (base != null && kotlin.math.abs(base - v) <= 1e-12) next.remove(id) else next[id] = v
        }
        edits.value = next
        save()
    }

    fun revert(ids: Collection<String>) {
        val next = HashMap(edits.value)
        ids.forEach { next.remove(it) }
        edits.value = next
        save()
    }

    fun revertAll() { edits.value = emptyMap(); save() }

    /** A módosított repó mentése ZIP-ként a rendszer fájlmentőjével kapott címre. */
    fun export(uri: Uri) {
        val r = repo.value ?: return
        val m = model.value ?: return
        val e = edits.value
        scope.launch(Dispatchers.Default) {
            busy.value = "ZIP írása…"
            try {
                app.contentResolver.openOutputStream(uri)!!.buffered().use { out -> writePatchedZip({ repoFile.inputStream().buffered() }, r, m, e, out) }
                notice.value = "ZIP elmentve (${e.size} módosított érték)."
            } catch (t: Throwable) {
                error.value = "A mentés nem sikerült: ${t.message}"
            } finally { busy.value = null }
        }
    }

    fun clearMessages() { error.value = null; notice.value = null }

    private fun save() {
        saveJob?.cancel()
        val r = repo.value ?: return
        val snapshot = edits.value
        saveJob = scope.launch(Dispatchers.IO) {
            delay(300)
            val obj = JSONObject()
            for ((k, v) in snapshot) obj.put(k, v)
            runCatching { stateFile.writeText(JSONObject().put("name", r.name).put("size", r.size).put("edits", obj).toString()) }
        }
    }
}
