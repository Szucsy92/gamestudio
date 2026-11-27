# Roadmap

- [x] Gyökércsatlakozás fül: gyökerek száma, vastagsága, csatlakozás magassága
- [x] Csatlakozási szög (a gyökér gerince milyen szögben fut a törzs függőlegesébe, éles cső-szerű csatlakozás nélkül) – Kotlin + előnézet egyezően
- [x] Egykezes, mobilra tervezett felület: alsó füles panel, nagy csúszkák, +/− gombok
- [x] Ellenőrzés: lefordított Kotlin = előnézet; mobil nézet képernyőképpel
- [x] Gyökérszám mind a 4 fafajnál külön (Csatlakozás fül, fafajonkénti −/+)
- [x] Talaj alatti vízszintes vágás állítható mélységgel + zárt alj kapcsoló – Kotlin + előnézet egyezően

## GameStudio
- [x] Átnevezés GameStudióra; teljes képernyős 3D, csak alsó munkasáv (asztal-szerű panelek)
- [x] Repo betöltése (ZIP) → új alapértékek; beépített alap: woodland-weave-run 2.0.0 build 586
- [x] Elemlista lenyíló alcsoportokkal: Fák, Kapuk és oszlopok, Fekete lyuk, Power-upok, Színek, Fények, Grafika, Játékmenet, Hang, Kód (minden szám)
- [x] Minden érték csúszkával, a repóból olvasott eredeti értékkel
- [x] 3D előnézet: fa, kapu, monolit, gyűrű, lámpás, fekete lyuk, power-up gömbök (animálva)
- [x] Arányos gyökérhossz (csatlakozás magassága, vastagsága követi)
- [x] Teljes repo ZIP export a módosított fájlokkal + változáslista
- [x] Kódbeli név zárójelben a magyar címke alatt (csak ha eltér)
- [x] Változások mappaszerkezet szerint, unified diff / patch letöltés (egész és fájlonként), patch a ZIP-ben, patch visszaalkalmazása
- [x] Visszaállító patch (egész és fájlonként, ZIP-ben is; új alapnál automatikusan), visszatölthető a mostani értékekre

## Törlés
- [x] Törlőmotor: Kotlin/GLSL szerkezet, hivatkozások követése, fordítható marad (blokkok, ágak, vesszők)
- [x] Érték törlése (tag a kifejezésből / deklaráció minden hivatkozással), ha típusbiztos
- [x] Animációk felismerése és törlése (időfüggő tagok)
- [x] Elemek részei (kapu oszlop, gerenda, hártya…) és teljes elemek (kapu, monolit, gyűrű, lámpás, fekete lyuk, power-upok) törlése
- [x] Törlés a felületen: kuka a fiók fejlécében (teljes elem), az objektumok fejlécében (pl. Kőkapu), alkatrész- és animációsorokon, minden csúszka/színsor végén
- [x] Visszavonás: elemenként és egyszerre (Változások lap, „Törölt tételek”)
- [ ] Újra (redo) a visszavonás után
- [x] Diff/patch/ZIP a törlésekkel; 3D előnézet elrejti a törölt részeket
- [ ] Ellenőrzés: valódi Gradle fordítás a törlések után a teljes repón (a tesztek a mellékelt src/kotlin részhalmazon futnak)

## Teljesítmény
- [x] Fa háromszögszáma a stúdióban: Felbontás csoport – háromszög / fa, cél-csúszka, „Optimalizálás” (fajonként vagy mind)
- [x] Új fa-beállítások: legkevesebb oldal (TREE_MIN_SIDES), törzstő sorai (TREE_FLARE_ROWS); régi Meshes.kt betöltéskor automatikusan megkapja
- [ ] Ellenőrzés a játékban: kép és képkockaidő a felezett fákkal (Medium/High minőség)

## Natív app (Android, Kotlin + Compose)
- [x] Natív projekt (`android/`), nincs WebView/Capacitor
- [x] APK építése GitHub Actionnel (teszt → aláírt APK → kiadás), aláírókulcs-készítő munkafolyamat
- [x] OTA frissítés felugró ablakkal (GitHub Releases), kézi keresés
- [x] Egy teljes képernyős app, átlátszó állapot- és navigációs sáv
- [ ] Első CI-futás ellenőrzése (a natív kódot még nem fordította le senki)
- [ ] Motor átvitele: számkereső + repo ZIP + csúszkák → elemző/törlő → fa-háló → 3D nézet (lásd `android/README.md`)

