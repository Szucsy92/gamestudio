plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
    id("org.jetbrains.kotlin.plugin.compose")
}

android {
    namespace = "hu.gamestudio.app"
    compileSdk = 35
    defaultConfig {
        applicationId = "hu.gamestudio.app"
        minSdk = 26
        targetSdk = 35
        // A CI adja: versionCode = futás sorszáma (+ eltolás), versionName = dátumos verzió (pl. 2026.11.27-1530)
        versionCode = System.getenv("APP_VERSION_CODE")?.toIntOrNull() ?: (project.findProperty("versionCode") as String?)?.toInt() ?: 1
        versionName = System.getenv("APP_VERSION_NAME") ?: (project.findProperty("versionName") as String?) ?: "dev"
        // Az OTA-frissítő ebből a GitHub-tárolóból keresi a legújabb kiadást (CI-ben: GITHUB_REPOSITORY)
        buildConfigField("String", "RELEASE_REPOSITORY", "\"${System.getenv("GITHUB_REPOSITORY") ?: project.findProperty("releaseRepo") ?: ""}\"")
    }
    buildFeatures { compose = true; buildConfig = true }
    compileOptions { sourceCompatibility = JavaVersion.VERSION_17; targetCompatibility = JavaVersion.VERSION_17 }
    kotlinOptions { jvmTarget = "17" }
    // Kiadási aláírás: mindig ugyanaz az állandó kulcs (különben az OTA-frissítés nem települ a meglévő app fölé).
    // Kulcs nélkül a release build szándékosan elbukik – ideiglenes kulccsal aláírt APK-t soha nem készítünk.
    signingConfigs {
        create("release") {
            System.getenv("KS_FILE")?.let { f ->
                storeFile = file(f); storePassword = System.getenv("KS_PASSWORD")
                keyAlias = System.getenv("KS_ALIAS") ?: "gamestudio"; keyPassword = System.getenv("KS_PASSWORD")
            }
        }
    }
    buildTypes { release { isMinifyEnabled = false; signingConfig = signingConfigs.getByName("release") } }
    packaging { resources.excludes += setOf("META-INF/versions/**", "META-INF/*.kotlin_module") }
    testOptions { unitTests.isReturnDefaultValues = true }
}

dependencies {
    val composeBom = platform("androidx.compose:compose-bom:2024.09.03")
    implementation(composeBom)
    implementation("androidx.compose.ui:ui")
    implementation("androidx.compose.foundation:foundation")
    implementation("androidx.compose.material3:material3")
    implementation("androidx.activity:activity-compose:1.9.2")
    implementation("androidx.core:core-ktx:1.13.1")
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-android:1.8.1")

    testImplementation("junit:junit:4.13.2")
    testImplementation("org.json:json:20240303")
}
