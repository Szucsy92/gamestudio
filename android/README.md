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

## Használat

1. *Repó* → **Repó megnyitása (ZIP)**: válaszd ki a játék repóját (pl. a GitHubról letöltött `woodland-weave-run-main.zip`). A stúdió megkeresi a Kotlin kódban a hangolható számokat (a repó ZIP-je az app saját mappájában marad, újraindítás után folytatódik).
2. A dock elemei (Kapuk, Fekete lyuk, Power-up, Színek, Fények, Grafika, Játékmenet, Hang, Egyéb, Kód) lenyíló csoportokat és csúszkákat nyitnak; a módosított sor mellett ↺ visszaállít.
3. *Változások*: a módosított értékek listája egyenkénti és együttes visszavonással, és **Módosított ZIP mentése**: az eredeti repó minden fájlja változatlanul, a módosított Kotlin források átírva, mellé `GameStudio/CHANGES.md`.

## Állapot

Ezt a kódot **nem fordítottam le** (nem volt Android SDK / Kotlin-fordító a környezetben); az első CI-futásnál számíts apró hibákra (import, API-név): a hiba a `tests` vagy az `android` lépés naplójában lesz.

Átvitt motor (a TS `src/studio` portja, `android/app/src/main/java/hu/gamestudio/app/studio/`):

| Kotlin | TS forrás | Tartalom |
|---|---|---|
| `Scan.kt` | `scan.ts` | számkereső (Kotlin + GLSL), kiírás, visszaírás, csúszkatartomány, megjegyzések |
| `Catalog.kt`, `StudioData.kt` | `catalog.ts`, `curated.ts` | elemek → csoportok → sorok, kurált magyar sorok, kódnevek |
| `Repo.kt`, `StudioStore.kt` | `repo.ts` | ZIP olvasás/írás, állapot, mentés |

**Ellenőrzés:** `StudioGoldenTest` a TS motor kimenetét (`src/test/resources/golden/*.tsv`, a `src/kotlin` mintafájlokon) veti össze a Kotlin portéval: literálok, katalógus, kiírás és az átírt fájlok tartalma. Ha elbukik, az üzenet az első eltéréseket mutatja. Az adatok újragenerálása: `tsx --tsconfig tsconfig.json android/tools/gen-golden.ts` (és `gen-studio-data.ts` a `StudioData.kt`-hez), ha a TS motor szándékosan változik.

**Még nincs átvive** (ebben a sorrendben):

1. Fa-háló és Kotlin-generátor (`src/tree/*`): a fa-szerkesztő, a háromszög-optimalizáló
2. 3D nézet (OpenGL ES) és a jelenetek (`src/studio/scene.ts`): a nézet most üres rács
3. Elemző és törlőmotor (`src/studio/code/*`, `removals.ts`), törlő gombok és visszavonás
4. Keresés, patch-import, a további TS funkciók

A web változat addig a referencia marad; ha a natív változat eléri a paritást, a `src/` törölhető.
