# GameStudio – natív Android (Kotlin + Jetpack Compose)

Nincs WebView, nincs Capacitor, nincs Node: az `android/` mappa egy önálló Gradle projekt (Kotlin DSL). A TypeScript/React stúdió (`src/`) a motor és a felület **forrása az átíráshoz**, a natív app ebből veszi át lépésenként a működést.

```
android/app/src/main/java/hu/gamestudio/app/
  GameStudioApp.kt   Application: az alkalmazás-szintű állapot (AppGraph)
  AppGraph.kt        OTA-frissítés állapota: keresés, letöltés, telepítés
  data/Updater.kt    GitHub Releases lekérdezés, APK letöltés, telepítés FileProvider-en át
  domain/Update.kt   tiszta, tesztelt kiadás-választás (címke → versionCode, URL-ellenőrzés)
  ui/MainActivity.kt egyetlen Activity, edge-to-edge, átlátszó sávok
  ui/StudioScreen.kt teljes képernyős felület + alsó munkaasztal + frissítés-ablak
```

## Célok és hol vannak megoldva

| Cél | Megoldás |
|---|---|
| Natív app | Kotlin + Compose, `hu.gamestudio.app`; a `build.gradle.kts`-ben nincs WebView/Capacitor függőség |
| APK építése Actionnel | `.github/workflows/app-build.yml` (Actions → *GameStudio – natív APK építése* → Run workflow): teszt → aláírt release APK → aláírás-ellenőrzés → GitHub Release |
| OTA frissítés felugró ablakkal | induláskor és előtérbe lépéskor (legfeljebb 10 percenként) az app lekéri a legújabb kiadást; ha újabb, **„Új frissítés elérhető”** ablak jön *Később* / *Letöltés* gombbal; a letöltés után a rendszer telepítője kéri a megerősítést. Kézi keresés: *Frissítés* fül |
| Egy teljes képernyős app | egyetlen `MainActivity`; `enableEdgeToEdge` átlátszó állapot- és navigációs sávval (scrim nélkül, `isNavigationBarContrastEnforced = false`), kivágásos kijelzőn is (`shortEdges`). A 3D nézet a rendszersávok alá is kiterjed, minden vezérlő az alsó munkaasztalon van (`navigationBarsPadding`) |

## Első beüzemelés (egyszer)

1. **Aláírókulcs**: Actions → *Aláírókulcs készítése* → Run workflow. A futás végén az `signing-key` artifactban van a `keystore.base64` és a `secrets.txt`.
2. Settings → Secrets and variables → Actions → **Secrets**: `ANDROID_KEYSTORE_BASE64` (a `keystore.base64` tartalma), `ANDROID_KEYSTORE_PASSWORD` (a jelszó a `secrets.txt`-ből). Utána töröld az artifactot. A kulcsot ne veszítsd el: ugyanezzel kell aláírni minden kiadást, különben az OTA-frissítés nem települ.
   - Ha már van kulcsod a Private Place-hez, használhatod ugyanazokat a titkokat; ilyenkor a Variables között add meg `ANDROID_KEY_ALIAS = privateplace`.
3. Actions → *GameStudio – natív APK építése* → Run workflow. A kiadás a *Releases* oldalon jelenik meg `game-studio-<dátum>.apk` néven.
4. Az első APK-t kézzel telepítsd (ismeretlen forrás engedélyezése). Innentől minden új kiadást az app maga ajánl fel.

A `versionCode` a futás sorszáma (+ az opcionális `VERSION_CODE_OFFSET` változó), a kiadás címkéje ezzel végződik (`build-2026-11-27_1530-42`): az app ebből ismeri fel az újabb verziót.

## Állapot – olvasd el

Ezt a kódot **nem fordítottam le** (nem volt Android SDK / Kotlin-fordító a környezetben); a frissítő és a build-konfiguráció a Private Place bevált megoldásából való. Az első CI-futásnál számíts apró hibákra (import, API-név); a hiba a `tests` vagy az `android` lépés naplójában lesz.

A stúdió **motorja és a 3D nézet még nincs átvive**; ez a kiadás a natív alapot adja. A tervezett sorrend (mindegyik tesztekkel, a TS tesztek mintájára):

1. Kotlin számkereső (`src/studio/scan.ts`) + repo ZIP olvasás/írás + csúszkák (Kód elem)
2. Elemző és törlőmotor (`src/studio/code/*`, `removals.ts`), Változások és visszavonás
3. Fa-háló és Kotlin-generátor (`src/tree/*`), háromszög-optimalizáló
4. 3D nézet (OpenGL ES), a jelenetek (`src/studio/scene.ts`)

A web változat addig a referencia marad; ha a natív változat eléri a paritást, a `src/` törölhető.
