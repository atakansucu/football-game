# Capacitor iOS App Store / TestFlight yayın rehberi

Aktif iOS mimarisi, Next.js statik export çıktısını yerel bir Capacitor 8
kabuğunda paketler. Native bağımlılıklar Swift Package Manager (SPM) ile
`ios/App/CapApp-SPM` üzerinden yönetilir. Expo/EAS bu yayın akışının parçası
değildir.

Bu belge komutları çalıştırma veya App Store Connect'te işlem yapma yetkisi
vermez. Dış işlem ve production adımlarından önce ilgili onay kapısı geçilmelidir.

## Kesin yayın blokörleri

- [ ] **Veri lisansı:** Oyuncu, kulüp, kariyer ve maç verilerinin kaynağı
  Transfermarkt tabanlı Kaggle `player-scores` veri kümesidir. Kaggle'da
  erişilebilir olması App Store'da ticari dağıtım hakkı verildiğini tek başına
  kanıtlamaz. Hak sahibinden kapsamı iOS dağıtımını içeren yazılı izin alınmadan
  veya veri açık lisanslı ve kaynağı belgelenmiş bir alternatifle tamamen
  değiştirilmeden **release yoktur**.
- [ ] **Kulüp görselleri:** Uygulama yalnızca kulüp adından yerel olarak üretilen
  resmî olmayan rozetleri kullanmalıdır. Logo URL'si, uzaktan görsel veya
  üçüncü taraf arma yolu bulunmadığı kod ve ağ trafiği üzerinden; üretilen
  rozetlerin tutarlı gösterildiği de cihaz üzerinde doğrulanır.
- [ ] Privacy Policy ve Support URL'leri gerçek, herkese açık HTTPS adresleri
  olmalıdır. Yer tutucular gönderilemez.
- [ ] Veri saklama süreleri, silme yöntemi ve veri sorumlusu bilgileri
  kesinleştirilip privacy metnine işlenmelidir.
- [ ] Uygulama içinden anonim hesabı ve ilişkili sunucu verisini silme yolu
  uygulanmalı ve test edilmelidir. Yalnızca uygulamayı silmek sunucu kayıtlarını
  silmez.

## 1. Yayın öncesi hazırlık

- [ ] Nihai ad, bundle ID ve SKU doğrulandı:
  - Uygulama/görünen ad: `3-2-1 Football`
  - Bundle ID: `com.atakansucu.footballduel`
  - iOS minimum sürümü: `15.0`
- [ ] Sürüm ve build numarası bir önceki App Store Connect build'inden büyük.
- [ ] App Store metadata şablonundaki tüm `TODO` alanları dolduruldu.
- [ ] Privacy data inventory, App Store Privacy cevapları ve
  `PrivacyInfo.xcprivacy` aynı davranışı tarif ediyor.
- [ ] Lisans kanıtları release kaydına eklendi.
- [ ] Production Supabase projesi, veri bölgesi, log politikası ve yedekleme
  politikası doğrulandı.
- [ ] [`IOS_RELEASE_CHECKLIST.md`](./IOS_RELEASE_CHECKLIST.md) gerçek cihaz
  matrisi geçti; kritik/açık hata yok.
- [ ] Archive üzerinde ikon, açılış ekranı, ürün adı ve sürüm kontrol edildi.
- [ ] Export compliance yanıtı doğrulandı. Mevcut iOS yapılandırması
  `ITSAppUsesNonExemptEncryption=false` diyor; kullanılan SDK ve ağ
  davranışlarıyla yeniden teyit edilmelidir.

## 2. Araçlar ve ortam

- macOS ve App Store Connect'in kabul ettiği güncel Xcode
- Node.js `>=22.0.0` (Capacitor CLI 8.5.0 gereksinimi)
- npm ve kilit dosyasına uygun bağımlılıklar (`npm ci`)
- Apple Developer / App Store Connect erişimi (değeri bu belgede tutulmaz)
- Dolu `.env.local`:
  - `NEXT_PUBLIC_SUPABASE_URL`
  - `NEXT_PUBLIC_SUPABASE_ANON_KEY`

`SUPABASE_SERVICE_ROLE_KEY` yalnızca test/import scriptleri içindir; statik web
çıktısına veya iOS uygulamasına gömülmez.

## 3. Statik build ve Capacitor sync

Yerel doğrulama:

```sh
node --version
npm ci
npm test
npm run typecheck
npm run mobile:build
```

`npm run mobile:build`, sırasıyla `next build` ve `cap sync ios` çalıştırır.
Next.js `output: "export"` ile `out/` üretir; Capacitor bunu iOS projesine
kopyalar ve SPM bağımlılıklarını günceller. Sadece daha önce üretilmiş `out/`
çıktısını yeniden senkronlamak için:

```sh
npm run mobile:sync
```

Ardından Xcode projesini Capacitor komutuyla aç:

```sh
npm run mobile:ios
```

Xcode'da yerel `CapApp-SPM` package'ının çözüldüğünü ve Capacitor 8.5.0 ile
Haptics, Keyboard, SplashScreen ve StatusBar paketlerinin bağlı olduğunu
doğrula. `CapApp-SPM/Package.swift` Capacitor CLI tarafından yönetilir; elle
değiştirilmez.

## 4. Gerçek cihaz doğrulaması

Bir Development signing profiliyle en az iki fiziksel iOS cihazda:

- Temiz kurulum ve yeniden açılış
- Production Supabase bağlantısı, anonim oturum ve hata halleri
- İki cihazla oda oluşturma/katılma, eşzamanlı cevap ve yeniden bağlanma
- Wi-Fi ↔ hücresel geçiş, arka plan/ön plan ve bağlantı kesilmesi
- Solo mod, lookup, klavye, safe area, koyu/açık görünüm ve erişilebilirlik
- Kulüpler için yalnız üretilen rozetlerin görünmesi ve uzaktan arma isteği olmaması
- Hesap/veri silme akışı

Sonuçlar release kaydına cihaz modeli, iOS sürümü, ağ türü, build numarası ve
pass/fail olarak eklenir.

## 5. Archive ve TestFlight onay kapıları

**ONAY KAPISI A — kullanıcı açıkça production archive onayı vermeden archive
ve dağıtım işlemi başlatılmaz.**

Onaydan önce kayda alınır:

- Git commit SHA ve çalışma ağacı durumu
- Apple Team, bundle ID, marketing version ve build number
- Seçilen signing/certificate/profile (gizli değer yazmadan)
- Lisans blokörlerinin kapandığına dair kanıt
- Privacy/Support URL'lerinin canlı kontrolü
- Gerçek cihaz test matrisi

Xcode'da `Any iOS Device (arm64)` / uygun generic device hedefi seçilir,
`Product > Archive` çalıştırılır ve Organizer validation tamamlanır.

**ONAY KAPISI B — kullanıcı Organizer'daki belirli archive sürüm/build
numarasını ve hedef App Store Connect uygulamasını açıkça onaylamadan
`Distribute App` / upload yapılmaz.**

Upload sonrası processing tamamlanır; otomatik review submission veya otomatik
release seçilmez. TestFlight internal test grubuna dağıtım da dış işlem kabul
edilir ve ayrıca açık kullanıcı onayı gerektirir.

## 6. TestFlight ve App Store yayın onay kapıları

TestFlight build'inde iki gerçek cihaz matrisi yeniden çalıştırılır. Crash,
backend uyumsuzluğu, metadata farkı veya privacy/lisans blokörü varsa süreç
durdurulur.

TestFlight'a yüklemek App Store'a yayınlamak değildir. App Store Connect'te:

1. Export compliance, content rights, age rating ve App Privacy yanıtları
   ikinci kişi tarafından incelenir.
2. Metadata ve ekran görüntüleri gerçek build ile karşılaştırılır.
3. Review notes'a iki cihazlı test adımları ve gerekiyorsa demo oda akışı yazılır.
4. **ONAY KAPISI C:** Kullanıcı “Review'a gönder” demeden gönderim yapılmaz.
5. Otomatik yayın seçilmez; inceleme kabulünden sonra ayrıca
   **ONAY KAPISI D** ile manuel yayın onayı alınır.

## 7. Geri alma ve kayıt

- App Store sürümü geri alınamaz; sorunlu sürüm için yeni build gerekir.
- Release kaydında commit, archive/App Store build numarası, test matrisi,
  lisans kanıtı, privacy metni sürümü ve onay veren kişi/tarih tutulur.
- Kritik backend sorunu için önceden belgelenmiş bakım/özellik kapatma yöntemi
  yoksa release yapılmaz.
