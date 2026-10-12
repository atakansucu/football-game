# App Store metadata şablonu

`TODO` değerleri gerçek bilgiyle değiştirilmeden App Store Connect'e
girilmemelidir. Bu belge URL üretmez veya alan adı varsaymaz.

## Uygulama kaydı

- App name: `TODO_FINAL_APP_NAME`
- Subtitle: `TODO_MAX_30_CHARACTERS`
- Bundle ID: `com.atakansucu.footballduel` (Apple Developer kaydıyla doğrula)
- SKU: `TODO_INTERNAL_SKU`
- Primary language: `TODO`
- Primary category: `TODO`
- Secondary category: `TODO_OR_NONE`
- Age rating: `TODO_COMPLETE_QUESTIONNAIRE_FROM_ACTUAL_CONTENT`
- Copyright: `TODO_RIGHTS_HOLDER_AND_YEAR`

> Aktif Capacitor/iOS yapılandırmasında görünen ad `3-2-1 Football`, bundle ID
> `com.atakansucu.footballduel` değeridir. Dokümanlarda geçen `Football Duel`
> eski/çalışma adı olabilir; nihai marka seçilmeden metadata ve görseller
> hazırlanmaz.

## URL alanları

- Privacy Policy URL: `TODO_PUBLIC_HTTPS_PRIVACY_POLICY_URL`
- Support URL: `TODO_PUBLIC_HTTPS_SUPPORT_URL`
- Marketing URL (opsiyonel): `TODO_PUBLIC_HTTPS_MARKETING_URL_OR_LEAVE_EMPTY`

Kurallar:

- URL'ler anonim tarayıcı oturumunda, giriş gerektirmeden açılmalıdır.
- Privacy URL güncel politika metnini göstermeli; Support URL iletişim yöntemi,
  beklenen yanıt dili/süresi ve temel yardım adımlarını içermelidir.
- `localhost`, örnek alan adı, repo dosya yolu veya uydurma URL kullanılamaz.
- Gönderimden önce HTTP 200, geçerli TLS ve mobil görünüm elle doğrulanır.

## Tanıtım metni ve açıklama

- Promotional text (opsiyonel, en fazla 170 karakter):
  `TODO_PROMOTIONAL_TEXT`
- Description:

```text
TODO_DESCRIPTION

Doğrulanmamış “resmî”, “eksiksiz”, “tüm oyuncular”, “gerçek zamanlı” veya
lisans sahipliği ima eden ifadeler kullanma. Özellikleri release build'inde
görüldüğü biçimde anlat.
```

- Keywords (virgülle ayrılmış, limit App Store Connect'te kontrol edilmeli):
  `TODO_KEYWORDS`
- What's New:
  `TODO_RELEASE_NOTES_FOR_THIS_VERSION`

## İnceleme bilgileri

- Contact first name: `TODO`
- Contact last name: `TODO`
- Contact phone: `TODO`
- Contact email: `TODO_MONITORED_EMAIL`
- Sign-in required: `No` (anonim Supabase oturumu arka planda oluşturuluyor;
  inceleme notunda açıklanmalı)
- Demo account: `Not applicable`, gerçek build davranışı tekrar doğrulanmalı
- Review notes:

```text
TODO_REVIEW_NOTES

Include:
- The app creates an anonymous backend session; no email/password is requested.
- Exact two-device multiplayer steps.
- Any region/network prerequisites.
- Confirmation that clubs use locally generated, non-official badges and no
  remote crest artwork is requested.
- Content-rights evidence reference, when available.
```

## Görseller

- [ ] Zorunlu iPhone ekran boyutları App Store Connect'in güncel kurallarına
  göre üretildi.
- [ ] Görseller TestFlight'a yüklenen aynı Capacitor archive build'inden alındı.
- [ ] iPad desteği açık kalacaksa zorunlu iPad görselleri ve iPad gerçek cihaz
  testi tamamlandı; aksi karar kod değişikliği gerektirir.
- [ ] Görseller release build'inden, kişisel veri içermeyen test adlarıyla alındı.
- [ ] Kulüp armaları veya lisanssız üçüncü taraf görseli görünmüyor.
- [ ] Görsel üzerindeki vaatler uygulama davranışıyla birebir uyumlu.

## App Privacy cevapları için giriş

App Store Connect yanıtları
[`PRIVACY_DATA_INVENTORY.md`](./PRIVACY_DATA_INVENTORY.md) kapanmadan
doldurulmaz. Özellikle kullanıcı kimliği, diğer kullanıcı içeriği, ürün
etkileşimi, tanılama/log verileri ve bunların kullanıcıya bağlanıp
bağlanmadığı Supabase ayarlarıyla doğrulanmalıdır.

## Content rights beyanı

- [ ] Transfermarkt/Kaggle kaynaklı veri için yazılı dağıtım izni var; **veya**
- [ ] Kaynak açık lisanslı alternatifle değiştirildi, lisans/attribution
  şartları yerine getirildi.
- [ ] Kulüpler yalnızca yerel üretilen resmî olmayan rozetlerle gösteriliyor;
  logo URL'si veya uzaktan görsel kullanılmıyor.

İlk iki koşuldan biri ve üretilen rozet koşulu sağlanmadan content-rights beyanı
verilmez ve release yapılmaz.
