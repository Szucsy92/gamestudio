package hu.gamestudio.app.domain

import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class UpdateTest {
    @Test fun releaseTagEndsWithTheVersionCode() {
        assertEquals(42L, buildFromTag("build-2026-11-27_1530-42"))
        assertNull(buildFromTag("latest"))
    }

    @Test fun picksTheApkAndComparesBuilds() {
        val url = "https://github.com/o/r/releases/download/build-2026-11-27_1530-42/game-studio-2026-11-27_1530.apk"
        val rel = JSONObject("""{"tag_name":"build-2026-11-27_1530-42","assets":[
            {"name":"game-studio-release.json","browser_download_url":"https://github.com/o/r/releases/download/build-2026-11-27_1530-42/game-studio-release.json"},
            {"name":"game-studio-2026-11-27_1530.apk","browser_download_url":"$url"}]}""")
        val r = pickRelease(rel)!!
        assertEquals(42L, r.versionCode)
        assertEquals(url, r.apk)
        assertTrue(needsUpdate(41, r.versionCode))
        assertFalse(needsUpdate(42, r.versionCode))
    }

    @Test fun refusesReleasesItCannotTrust() {
        assertNull(pickRelease(JSONObject("""{"tag_name":"latest","assets":[]}""")))
        assertNull(pickRelease(JSONObject("""{"tag_name":"build-x-7","assets":[]}""")))
        assertFalse(validApkUrl("http://github.com/o/r/releases/download/t/a.apk"))
        assertFalse(validApkUrl("https://evil.example/o/r/releases/download/t/a.apk"))
        assertFalse(validApkUrl(null))
        assertTrue(validRepository("o/r"))
        assertFalse(validRepository("o/r/x"))
        assertFalse(validRepository(""))
    }
}
