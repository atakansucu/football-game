# Privacy data inventory

Durum: **yayın öncesi çalışma taslağı**. Bu envanter kod ve şema
incelemesine dayanır; production Supabase ayarları, loglar ve saklama
politikaları ayrıca doğrulanmalıdır. `TODO` alanları kapanmadan App Store
Privacy formu veya nihai hukuk metni hazırlanmış sayılmaz.

## Gözlemlenen veri akışları

### Anonim kimlik ve oturum

- Veri: Supabase anonim auth kullanıcı UUID'si; yerel auth token/session verisi.
- Amaç: oda üyeliği, skor ve realtime oyun durumu.
- Yerel saklama: native uygulamada `localStorage`, anahtar `fd-auth`; uygulama
  yeniden başlatmalarında kalır.
- Sunucu saklama: Supabase Auth ve `public.users.id`.
- Apple kategorisi adayı: **Identifiers / User ID**.
- Kullanıcıya bağlı mı: teknik olarak anonim kullanıcı UUID'sine bağlıdır.
- Tracking: kodda reklam/cross-app tracking görülmedi; production SDK ve domain
  taramasıyla doğrulanmalı.
- Saklama/silme: `TODO_AUTH_RETENTION_AND_DELETION`.

### Multiplayer görünen adı

- Veri: kullanıcının serbest metin olarak girdiği display name.
- Amaç: oda içinde oyuncuyu göstermek.
- Yerel saklama: `localStorage`, anahtar `fd:display_name`.
- Sunucu saklama: `public.users.display_name` ve
  `public.room_players.display_name`.
- Paylaşım: aynı oda/oyun durumuna erişen diğer oyuncuya gösterilir.
  `0018_security_lifecycle.sql` oda/maç/tur okumalarını katılımcılarla
  sınırlar; production'a uygulanması ve authenticated-client testi release
  kapısıdır.
- Apple kategorisi adayı: **User Content / Other User Content** ve duruma göre
  **Identifiers / User ID**.
- Saklama/silme: `TODO_DISPLAY_NAME_RETENTION_AND_DELETION`.

### Multiplayer oyun ve cevap verisi

- Veri: oda kodu/durumu, kullanıcı UUID'si, bağlantı/son görülme zamanı,
  maç/tur/galip verisi, ham ve normalize edilmiş cevap, doğruluk sonucu,
  sunucu zaman damgaları.
- Amaç: oyunu yürütmek, cevabı doğrulamak ve sonucu hesaplamak.
- Sunucu tabloları: `rooms`, `room_players`, `matches`, `rounds`,
  `submissions`.
- Paylaşım: `0018_security_lifecycle.sql` uygulandığında oda/maç/tur satırları
  yalnız oda katılımcılarına görünür; `submissions` public read değildir.
- Apple kategorisi adayı: **Usage Data / Product Interaction** ve ham cevap
  için **User Content / Other User Content**.
- Saklama/silme: şemada otomatik TTL/cleanup gözlemlenmedi.
  `TODO_GAME_DATA_RETENTION_AND_DELETION`.

### Solo oyun verisi

- Veri: oyun modu ve zorluk başına en iyi skor.
- Amaç: kişisel en iyi skoru cihazda göstermek.
- Saklama: yalnızca `localStorage`,
  `fd_solo_best_<mode>_<difficulty>` anahtarları.
- Apple kategorisi adayı: cihaz dışına çıkmıyorsa App Store “collected”
  tanımına girmeyebilir; gönderim tarihinde Apple tanımıyla doğrulanmalı.
- Silme: uygulama verisini/uygulamayı silme.

### Referans veri önbelleği ve klavye ayarı

- Veri: kulüp ve milli takım listeleri (`fd-ref-clubs`, `fd-ref-nt`) ve
  gözlemlenen native klavye yüksekliği ayarı.
- Amaç: performans ve arayüz.
- Saklama: `localStorage`.
- Kişisel veri beklenmiyor.
- Silme: uygulama verisini/uygulamayı silme.

### Ağ ve hizmet sağlayıcı verileri

- Sağlayıcı: Supabase (Auth, Postgres, RPC, Realtime).
- Olası ağ metadata'sı: IP adresi, user-agent, istek zamanı, hata/erişim
  logları. Kod incelemesi sağlayıcının fiilî log ve retention ayarını
  kanıtlamaz.
- Apple kategorisi adayları: yapılandırmaya göre **Identifiers / Device ID**
  değildir; IP ve log içeriği için güncel Apple sınıflandırması ayrıca
  doğrulanmalıdır. **Diagnostics** ancak gerçekten toplanıyorsa beyan edilir.
- TODO:
  - `TODO_SUPABASE_PROJECT_REGION`
  - `TODO_SUPABASE_LOG_FIELDS`
  - `TODO_SUPABASE_LOG_RETENTION`
  - `TODO_SUBPROCESSORS_AND_TRANSFER_REGIONS`
  - `TODO_BACKUP_RETENTION`

## Toplanmadığı iddia edilmeden önce doğrulanacaklar

Kodda reklam SDK'sı, tracking izni, kişi listesi, konum, kamera, mikrofon,
fotoğraf veya sağlık verisi kullanımı görülmedi. Bu, production build içindeki
tüm transitif SDK'ların davranışını tek başına kanıtlamaz. Release archive
üzerinde privacy manifest ve SDK taraması yapılmalıdır.

## Hesap ve veri silme

Uygulama kullanıcıdan e-posta/parola istemese de Supabase'te anonim bir hesap
oluşturur. Bu nedenle “hesap yok” veya “uygulamayı silmek tüm veriyi siler”
denmemelidir.

Uygulama tarafında Settings & Privacy ekranı ve
`request_account_deletion()` migration'ı hazırlanmıştır. Release öncesi:

- [x] Uygulama içinde kolay bulunan “Hesabı ve verilerimi sil” akışı.
- [x] Sunucu tarafında auth kullanıcısı ile ilişkili `users`, oda üyeliği,
  maç/tur ve submission kayıtlarının kapsamı tanımlı silme/anonymization
  işlemi.
- [x] Başarılı silmeden sonra `fd-auth`, `fd:display_name` ve ilgili yerel
  anahtarların temizlenmesi.
- [ ] Migration production'a onayla uygulanmalı ve gerçek anonymous auth
  hesabıyla uçtan uca doğrulanmalı.
- [ ] Aktif maç, çevrimdışı durum, başarısız istek ve tekrar deneme testi.
- [ ] Yedeklerden silinme/anonymization süresi:
  `TODO_BACKUP_DELETION_WINDOW`.
- [ ] Silme yapılamayan yasal kayıtlar ve dayanak:
  `TODO_LEGAL_RETENTION_OR_NONE`.

## Saklama karar kaydı

Aşağıdaki süreler ürün/hukuk/altyapı sahipleri tarafından doldurulmalıdır:

- Anonim auth hesabı: `TODO`
- Kullanıcı/display name profili: `TODO`
- Oda ve oda oyuncuları: `TODO`
- Maçlar ve turlar: `TODO`
- Ham/normalize cevaplar: `TODO`
- Supabase erişim/hata logları: `TODO`
- Veritabanı yedekleri: `TODO`

“Transient”, “yalnızca oyun süresince” veya “hemen silinir” ifadeleri ancak
uygulanmış ve test edilmiş TTL/silme mekanizmasıyla kullanılabilir.

## Lisans ve privacy'den ayrı content-rights blokörü

Transfermarkt tabanlı Kaggle verisinin erişilebilir olması yeniden dağıtım
hakkını kanıtlamaz. Yazılı izin veya uygun açık lisanslı alternatif olmadan
release yoktur. Kulüpler için yalnızca addan yerel olarak üretilen resmî
olmayan rozetler kullanılır; uzaktan arma veya üçüncü taraf görsel yolu
bulunmamalıdır. Bu konu privacy beyanıyla çözülemez.
