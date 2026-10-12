# iOS release ve gerçek cihaz kontrol listesi

Bu liste Capacitor 8 / SPM release candidate'ı içindir. Her satır build numarası,
cihaz, iOS sürümü, ağ ve sonucu içeren release kaydına bağlanmalıdır.

## İki cihazlı multiplayer matrisi

Her senaryo iki fiziksel cihazda ve ardından aynı TestFlight build'inde
tekrarlanır.

- [ ] A ve B temiz kurulum: açılış, anonim oturum ve ana ekran başarılı.
- [ ] A oda oluşturur, B doğru kodla katılır; adlar iki cihazda doğru görünür.
- [ ] Geçersiz/eskimiş oda kodu anlaşılır hata verir.
- [ ] İki cihaz aynı challenge ve server timer durumunu görür.
- [ ] A doğru, B yanlış cevap verir; skor yalnızca A'ya yazılır.
- [ ] İki cihaz aynı anda doğru cevap verir; sunucu yalnızca bir tur galibi atar.
- [ ] Oyuncu seçimi modunda gizli seçimler erken sızmaz ve birlikte açılır.
- [ ] Bir cihaz arka plana gidip döner; oda/tur durumu yeniden senkronlanır.
- [ ] Bir cihaz Wi-Fi ile hücresel ağ arasında geçer; bağlantı geri gelir.
- [ ] Ağ tamamen kesilip geri gelir; veri kaybı/çift submission oluşmaz.
- [ ] Uygulama zorla kapatılıp açılır; anonim session davranışı beklenen gibidir.
- [ ] Maç tamamlanır; sonuç, çıkış ve yeni oyun akışları iki cihazda tutarlıdır.
- [ ] Kulüpler yalnızca üretilen rozetlerle gösterilir; iki cihazda renk ve
  etiketler tutarlıdır, uzaktan arma isteği oluşmaz.

Kapsama en az bir küçük ekranlı iPhone ve desteklenen güncel iOS sürümünde bir
iPhone dahil edilir. iPad desteği açık kalırsa gerçek iPad ayrıca zorunludur.

## Solo, lookup ve cihaz davranışı

- [ ] Her oyun modu/zorluk açılır; skor cihazda saklanır.
- [ ] Lookup arama, autocomplete ve oyuncu detayları çalışır.
- [ ] Yazılım klavyesi input/CTA'yı kapatmaz; dönüş ve yeniden açılış düzgündür.
- [ ] Safe-area, status bar, splash ve portrait davranışı doğru.
- [ ] Düşük güç modu, arka plan/ön plan ve memory warning sonrası temel akış sağlam.
- [ ] Production Supabase kesintisinde kişisel/teknik detay sızdırmayan hata görünür.

## ATS ve ağ

- [ ] Release build yalnızca gerekli HTTPS/WSS endpoint'lerine bağlanır.
- [ ] Production Supabase URL'si gerçek HTTPS adresidir; TODO/localhost değildir.
- [ ] `Info.plist` içinde blanket `NSAllowsArbitraryLoads` istisnası yoktur.
- [ ] Yeni ATS istisnası gerekiyorsa domain, gerekçe ve kapsam security review
  olmadan eklenmez.
- [ ] Xcode/device loglarında cleartext HTTP veya TLS hatası yoktur.
- [ ] Supabase region, log alanları, log retention ve subprocessors privacy
  envanterine işlenmiştir.

## İzinler ve privacy manifest

- [ ] Release archive'ın `Info.plist` dosyasında yalnızca gerçekten kullanılan
  permission usage description anahtarları vardır.
- [ ] Kamera, mikrofon, fotoğraf, konum, kişi listesi ve tracking izni
  beklenmiyor; archive bağımlılık taraması bunu doğrular.
- [ ] Uygulama tracking yapmıyorsa ATT prompt'u ve
  `NSUserTrackingUsageDescription` yoktur.
- [ ] `PrivacyInfo.xcprivacy`, uygulama ve transitif SDK davranışıyla uyumludur.
- [ ] UserDefaults required-reason API beyanı ve reason kodu güncel Apple
  dokümantasyonuyla doğrulanmıştır.
- [ ] App Store Privacy cevapları
  [`PRIVACY_DATA_INVENTORY.md`](./PRIVACY_DATA_INVENTORY.md) ile aynıdır.

## Erişilebilirlik

- [ ] VoiceOver ile tüm ekranlar sırayla kullanılabilir; buton/input adları nettir.
- [ ] Dynamic Type büyütüldüğünde metin kesilmez ve ana eylemler erişilebilir kalır.
- [ ] Renk tek bilgi taşıyıcısı değildir; skor, hata ve galip durumu metinle anlaşılır.
- [ ] Metin/ikon kontrastı hedeflenen WCAG seviyesine göre ölçülmüştür.
- [ ] Reduce Motion açıkken oyun kullanılabilir; zorunlu animasyon yoktur.
- [ ] Klavye odağı ve submit davranışı tutarlı; hata odağa/duyuruya yansır.
- [ ] 200% büyütme, koyu/açık görünüm ve portrait testleri geçer.

## Anonim hesap ve veri silme

Supabase anonim auth teknik olarak bir hesap oluşturur. Uygulamayı silmek
sunucudaki hesabı ve ilişkili kayıtları otomatik olarak silmez.

- [ ] Uygulamada kolay bulunan “Hesabı ve verilerimi sil” eylemi vardır.
- [ ] Eylem auth kullanıcısını ve tanımlı ilişkili server verisini siler veya
  belgelenmiş biçimde anonimleştirir.
- [ ] Yerel auth session, display name, skor ve cache kapsamı açıkça tanımlıdır.
- [ ] Aktif oda/maç sırasında silme, offline hata ve retry test edilmiştir.
- [ ] İşlem sonucu kullanıcıya anlaşılır biçimde gösterilir.
- [ ] Backup/log istisnaları ve silinme süresi privacy policy'de gerçeğe uygun yazılıdır.
- [ ] Silme akışı yoksa **release blokörüdür**.

## Archive / TestFlight kanıtı

- [ ] `npm test`, `npm run typecheck` ve `npm run mobile:build` başarılı.
- [ ] Archive commit SHA, marketing version ve build number kaydedildi.
- [ ] Bundle ID `com.atakansucu.footballduel`, görünen ad `3-2-1 Football`.
- [ ] SPM package çözümü ve Capacitor/plugin sürümleri kaydedildi.
- [ ] Archive validation geçti.
- [ ] Upload için açık kullanıcı onayı kaydedildi.
- [ ] TestFlight processing tamamlandı; dış tester gerekiyorsa ayrıca onay alındı.
- [ ] TestFlight iki cihaz matrisi geçti.
- [ ] App Review gönderimi ve final release için ayrı onaylar alındı.

## Content rights

- [ ] Transfermarkt/Kaggle verisi için iOS dağıtımını kapsayan yazılı izin var;
  **veya** tüm ilgili veri belgelenmiş açık lisanslı kaynakla değiştirildi.
- [ ] Kodda logo URL'si veya uzaktan kulüp görseli yolu yoktur; yalnızca addan
  üretilen resmî olmayan rozetler kullanılır.
- [ ] Lisans kanıtı yoksa **release yoktur**.
