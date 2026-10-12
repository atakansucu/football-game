# Transfermarkt veri kapsamı analizi

Tarih: 12 Ekim 2026  
Kaynak: Kaggle `davidcariboo/player-scores`, sürüm **677** (5 Ağustos 2026)  
Kapsam: Salt-okunur yerel analiz; Supabase'e bağlanılmadı ve oyun verisi değiştirilmedi.

## Sonuç

Mevcut **16.847** oyuncu sayısı bir `MAX_PLAYERS` sınırından kaynaklanmıyor. Dönüştürücü yalnızca `clubs.csv` içinde eşlenebilen `appearances.csv` satırlarını kullanıyor ve oynanamayacak 0/1-kulüplü oyuncuları bilinçli olarak eliyor. Fakat kaynak kapsamındaki boşluklar nedeniyle bu yaklaşım gereğinden fazla dar:

- `players.csv`: **50.149** benzersiz oyuncu.
- Yalnız `appearances.csv` ve profil cap alanıyla kurala uyan: **18.203** oyuncu; milli takımı kaynakta eşlenebilen kullanılabilir alt küme **17.944**.
- `appearances.csv` içindeki gerçek milli maç görünümleri de kullanıldığında: **17.981**.
- Başlangıç kadroları resmî görünüm kanıtı olarak eklendiğinde: **28.411**.
- Saha içi olaylar da (gol, kart, asist, oyuna giren/çıkan oyuncu) eklendiğinde: **30.741** doğrulanabilir oyuncu.

Dolayısıyla `players.csv` evrenindeki muhafazakâr, kaynakla kanıtlanabilir üst sınır **30.741** oyuncudur. Bu, mevcut veriye göre **13.895 ek geçerli oyuncu** ve cap kontrolü hatası nedeniyle **1 oyuncunun çıkarılması** demektir (net `+13.894`).

## Kaynak ve tekrar üretilebilirlik

Yerel dört CSV, Kaggle sürüm 677'deki dosyalarla byte-byte aynıdır:

| Dosya | Satır | SHA-256 |
|---|---:|---|
| `players.csv` | 50.149 | `ea3a3903eda7d40cbf265b3e470307ea60622d7d03a7de06a055b2f1d36bc727` |
| `appearances.csv` | 1.894.350 | `aa892fae30fa944f8e8ea1c511274db6acb51306d45f1a5475bef1efddcba7f1` |
| `clubs.csv` | 796 | `0d6ce1af95b7af66833e2b0c78f72295db287bd759c8859dc6c91da8eb1ce0b3` |
| `transfers.csv` | 175.165 | `8ca03c11c3df5215a62be7fb303c679bc78971f461209b396f1f7640d933fc34` |

Yerelde eksik olan `games.csv`, `competitions.csv`, `national_teams.csv`, `game_lineups.csv`, `game_events.csv` ve `player_valuations.csv` aynı Kaggle sürümünden geçici dizine indirildi. Dört ortak dosyanın hash eşleşmesi sürümün doğru olduğunu doğruladı.

Kaggle metadata'sı sürüm 677'yi 5 Ağustos 2026'da yayımlanmış, CC0 lisanslı snapshot olarak tanımlıyor. Kaynakta oyunlar 6 Temmuz 2026'ya, appearances 28 Haziran 2026'ya ve valuations 12 Haziran 2026'ya kadar güncel.

## Mevcut importer

`scripts/data-import/fromTransfermarkt.ts` şu davranışı uyguluyor:

1. `appearances.csv.player_club_id` yalnızca `clubs.csv` içindeki ID'lere eşlenirse görünüm sayılıyor.
2. `MIN_APPEARANCES` varsayılanı `1`; `MAX_PLAYERS` varsayılanı `Infinity`.
3. En az iki eşlenmiş kulübü veya milli takım + en az bir kulübü olmayan oyuncu eleniyor.
4. Milli takım, `current_national_team_id`; bu eşlenmezse `international_caps >= 1` ve vatandaşlık üzerinden bulunuyor.

`importFootballData.ts` daha sonra `appearances >= 1` ilişkilerini yüklüyor. `rebuild_answers()` kuralları oyun tanımıyla uyumlu: Club × Club için iki farklı kulüpte görünüm, National Team × Club için milli takım ilişkisi ve bir kulüpte görünüm gerekiyor.

### Doğrulanmış importer kusurları

- Açık `current_national_team_id` bulunduğunda cap kontrolü yapılmıyor. **264** sıfır/boş cap oyuncusu milli oyuncu kabul ediliyor; bunların **7**'si National Team × Club uygunluğuna, **4**'ü oyuncu birleşimine giriyor. Mevcut sette bu hata **12** National Team × Club cevap ilişkisi ve **3** challenge üretiyor.
- `games.csv` kullanılmadığı için milli takım maçları ile kulüp maçları açıkça sınıflandırılmıyor.
- `clubs.csv` dışında kalan fakat `games.csv` taraf isimleriyle çözülebilen kulüp ID'leri atılıyor.
- `game_lineups.csv` başlangıç kadroları ve `game_events.csv` saha içi olayları kullanılmıyor.

## İstenen temel ölçümler

Bu tablo yalnızca `appearances.csv` içindeki **kulüp müsabakalarını** sayar; milli takım maçları kulüp geçmişi değildir.

| Ölçüm | Oyuncu |
|---|---:|
| `players.csv` benzersiz oyuncu | **50.149** |
| Sıfır kayıtlı kulüp görünümü | **20.820** |
| Tam bir farklı kulüp | **15.025** |
| En az iki farklı kulüp | **14.304** |
| `international_caps >= 1` ve en az bir kulüp | **9.587** |
| İki modun ham kural birleşimi, çift sayım yok | **18.203** |
| Bunlardan milli takımı eşlenmiş National Team × Club | **8.855** |
| Milli takımı eşlenmiş, kullanılabilir iki-mod birleşimi | **17.944** |
| Gerçek milli maç appearance'ları da eklenmiş National Team × Club | **9.037** |
| Gerçek milli maç appearance'ları da eklenmiş birleşim | **17.981** |

Kontrol: `20.820 + 15.025 + 14.304 = 50.149`.

### Importer'ın fiilen gördüğü daha dar grafik

| Ölçüm | Oyuncu |
|---|---:|
| Sıfır eşlenmiş kulüp | 21.662 |
| Tam bir eşlenmiş kulüp | 15.188 |
| En az iki eşlenmiş kulüp | 13.299 |
| National Team × Club, cap şartı doğru uygulanırsa | 8.469 |
| İki mod birleşimi, cap şartı doğru uygulanırsa | 16.843 |
| Mevcut bug dahil gerçek çıktı | **16.847** |

`MIN_APPEARANCES=1` nedeniyle elenen geçerli oyuncu **0**, varsayılan `MAX_PLAYERS=Infinity` nedeniyle elenen oyuncu **0**. Aradaki fark limit değil, eligibility ve kaynak/eşleme kapsamıdır.

## Dışlama nedenleri

### Birbirini dışlayan ana ayrım

| Aşama | Oyuncu | Önceki aşamaya ek |
|---|---:|---:|
| Mevcut importer, amaçlanan cap kuralı | 16.843 | — |
| Tüm appearance kulüp ID'lerini ve milli appearance'ları kullan | 17.981 | **1.138** |
| Eksik appearance yerine başlangıç kadrosu kanıtını ekle | 28.411 | **10.430** |
| Saha içi event kanıtını ekle | **30.741** | **2.330** |
| Kaynakta geçerli olmayan: sıfır kulüp kanıtı | 9.935 | — |
| Kaynakta geçerli olmayan: tek kulüp, milli cap yok | 9.472 | — |

Üstteki son iki satır maksimum grafikte de oynanamaz ve toplam **19.407** oyuncudur. `30.741 + 19.407 + 1` eşitliği 50.149'u verir; son **1** oyuncu mevcut importer'ın sıfır-cap bug'ıyla yanlış kabul ettiği oyuncudur.

### Örtüşebilen veri-kalitesi bayrakları

Bu tablo potansiyel sorunları gösterir; satırlar aynı oyuncuyu içerebildiğinden toplanmamalıdır.

| Sorun | Doğrulanmış ölçüm |
|---|---:|
| `clubs.csv` içinde olmayan kulüpte appearance'ı olan oyuncu | 2.830 |
| Eşlenmeyen farklı kulüp ID'si / appearance satırı | 624 / 8.033 |
| Yalnız kulüp eşlemesini düzelterek appearance grafiğine eklenen oyuncu | 1.101 |
| Hem kulüp hem milli takım düzeltmesi gerektiren oyuncu | 4 |
| Cap'i olup milli takıma eşlenemeyen profil | 968 |
| Bunlardan kayıtlı kulübü bulunan | 732 |
| Bunlardan gerçek milli appearance ile kurtarılan | 226 |
| Appearance'ta olmayan başlangıç-kadro kulüp ilişkisi | 36.191 |
| Appearance ve başlangıçta olmayan event kulüp ilişkisi | 16.422 |
| Yalnız bench kaydı bulunan, kanıt sayılmayan kulüp ilişkisi | 12.925 |

Transfer, valuation ve current-club alanları görünüm kanıtı yapılmadı:

| Kanıt olmayan sinyal | Resmî görünüm kanıtı olmayan ilişki | Hiç kulüp kanıtı olmayan etkilenen oyuncu |
|---|---:|---:|
| `players.current_club_id` | 14.226 | 9.935 |
| `player_valuations.csv` | 45.123 | 5.134 |
| `transfers.csv` | 111.161 | 3.680 |

Bu kayıtlar yalnızca eksik kapsam göstergesidir. Transfer, valuation, kadro üyeliği, bench kaydı ve genç takım geçmişi resmî senior appearance kabul edilmedi.

## Kapsam sınırlamaları

### Tarih ve sezon

- Kulüp oyunları: **3 Temmuz 2012 – 6 Temmuz 2026**.
- Milli oyunlar: **9 Haziran 2006 – 28 Haziran 2026**.
- Appearance kayıtları: **3 Temmuz 2012 – 28 Haziran 2026**.
- Kaynak appearance satırları: **1.891.321 kulüp**, **3.027 milli takım**, 2 bilinmeyen oyuncu satırı.
- Başlangıç/bench kadroları: **2 Temmuz 2013 – 6 Temmuz 2026**, 3.179.016 satır.
- Saha içi olaylar: **9 Haziran 2006 – 6 Temmuz 2026**, 1.274.469 satır.
- Valuations 2000'de, transfers 1993'te başlar; fakat bunlar görünüm kanıtı değildir. Transfers 2030'a uzanan planlı/loan dönüş kayıtları da içerir.

2012 öncesi kulüp kariyerleri appearance ile doğrulanamaz. Örneğin eski oyuncuların erken kulüpleri yalnız transfer/valuation verisinde görünse bile oyuna eklenmemelidir.

### Competition ve coğrafya

Appearance verisi yerel müsabakalarda yalnızca şu **14 Avrupa ülkesini** kapsıyor: Belçika, Danimarka, İngiltere, Fransa, Almanya, Yunanistan, İtalya, Hollanda, Portekiz, Rusya, İskoçya, İspanya, Türkiye ve Ukrayna.

Ana dolu ligler `BE1, DK1, ES1, FR1, GB1, GR1, IT1, L1, NL1, PO1, RU1, SC1, TR1, UKR1`; bunların appearance sezonu 2012–2025'tir. İlgili yerel kupalar ve süper kupalar da çoğunlukla 2012–2025 aralığındadır. Avrupa kulüp kapsamı:

- `CL`, `CLQ`, `EL`, `ELQ`: 2012–2025
- `ECLQ`: 2021–2025
- `USC`: 2012–2025
- Metadata'sı eksik `CGB`, `KLUB`, `POCP`, `UKRS` kayıtları da appearance içerir.

Milli appearance kapsamı çok dardır:

- `AFCN`: yalnız 2025 sezonu (21 Aralık 2025 – 18 Ocak 2026), 776 satır.
- `FIWC`: yalnız 2025 sezonu (11–28 Haziran 2026), 2.251 satır.

Oyun kaydı bulunduğu halde **sıfır appearance** içeren 22 competition:

`A1, AFAC, ARG1, AUS1, BRA1, C1, COL1, COPA, EURO, JAP1, KR1, MEX1, MLS1, NO1, PL1, RO1, RSK1, SA1, SE1, SER1, TS1, UCOL`.

Bunlar Avusturya, Arjantin, Avustralya, Brezilya, İsviçre, Hırvatistan, Japonya, Meksika, ABD, Norveç, Polonya, Romanya, Güney Kore, Suudi Arabistan, İsveç, Sırbistan ve Çekya ligleri ile bazı milli/uluslararası turnuvaları içerir. Çoğu yeni yerel lig yalnız 2024–2025 sezonlarında `games.csv` içindedir. Bu boşluk, lineups/events eklenince oluşan büyük artışın ana nedenidir.

### `players.csv` dışındaki kimlikler

`game_lineups.csv` 114.893 oyuncu ID'si içeriyor; **69.943** ID `players.csv` içinde yok. Bu nedenle 315.555 lineup satırı ana analizden çıkarıldı. Event rollerinde de 51.180 profil-dışı ID var.

Bu profil-dışı evrende resmî başlangıç/event kanıtıyla 19.606 ID teorik olarak iki moddan birine hak kazanıyor; 19.566'sının lineup adı bulunuyor. Ancak bunlar 50.149 `players.csv` oyuncusunun parçası değildir, 211 ID birden fazla adla görünür ve 40 uygun ID'nin adı yoktur. Bu yüzden **30.741 ana maksimuma dahil edilmediler**. Profil zenginleştirme ve kimlik tekilleştirme yapılmadan üretime alınmaları güvenilir değildir.

## Oynanış etkisi

“Cevap” bir `(challenge, player)` ilişkisi, “challenge” ise en az bir cevabı olan benzersiz eşleşmedir. Hesaplar Supabase'e bağlanmadan mevcut JSON ve kaynak ID grafiğinden üretildi. Mevcut 16.847 JSON kaydının tamamı kaynak ID'sine benzersiz olarak geri eşlendi.

| Ölçüm | Mevcut | Maksimum geçerli | Net |
|---|---:|---:|---:|
| Kullanılabilir oyuncu | 16.847 | 30.741 | +13.894 |
| Club × Club uygun oyuncu | 13.299 | 26.320 | +13.021 |
| National Team × Club uygun oyuncu | 8.476 | 13.987 | +5.511 |
| Farklı kulüp | 545 | 2.360 | +1.815 |
| Farklı milli takım | 104 | 139 | +35 |
| Club × Club challenge | 24.537 | 83.560 | +59.023 |
| National Team × Club challenge | 7.470 | 15.490 | +8.020 net |
| Club × Club cevap | 53.821 | 175.375 | +121.554 |
| National Team × Club cevap | 19.749 | 41.718 | +21.969 net |

Küme farkı ayrıntısı:

- Club × Club: **59.023** yeni challenge, **121.554** yeni cevap, çıkarılan yok.
- National Team × Club: **8.023** yeni ve 3 hatalı challenge çıkarımı; **21.981** yeni ve 12 hatalı cevap çıkarımı.
- Toplam: **67.046** yeni challenge ve **143.535** yeni cevap ilişkisi; 3 challenge ve 12 cevap cap bug'ı nedeniyle kaldırılır.

## Önerilen importer iyileştirmeleri

1. `appearances.csv` satırlarını `games.csv` ile birleştirip club ve `national_team_competition` görünümlerini ayrı işle.
2. Kulüp ID/ad çözümünde yalnız `clubs.csv` değil, club oyunlarındaki `home_club_id/name` ve `away_club_id/name` alanlarını da kullan.
3. Milli takım için önce gerçek milli maç appearance'ını kullan; profil fallback'inde her durumda `international_caps >= 1` şartını uygula.
4. Eksik appearance kapsamını yalnız doğrulanabilir on-field kanıtla tamamla:
   - `starting_lineup` kabul edilebilir;
   - gol/kart/asist/substitution event oyuncuları kabul edilebilir;
   - `substitutes` bench kaydı tek başına kabul edilmemeli.
5. Her ilişkinin kaynak türünü, `game_id`, competition ve sezonunu koru; competition whitelist/blacklist ve tekrar üretilebilir snapshot manifesti ekle.
6. Oyuncu ve kulüp kaynak ID'lerini normalize çıktıda koru. Ad bazlı birleştirme aynı adlı farklı varlıkları kaynaştırabilir.
7. `MIN_APPEARANCES=1` ve sınırsız `MAX_PLAYERS` değerlerini koru; burada limit yükseltmek sorunu çözmez.
8. 2.360 kulübün tamamını doğrudan rastgele challenge havuzuna açma. Yeni ve az bilinen eşleşmeleri mevcut prominence/answer-count eşikleriyle derecelendir; önce kaynak doğruluğu ve kullanıcı tanınırlığı testi yap.

## Karar

**Evet, genişletme Football Duel'i anlamlı ölçüde iyileştirir.** Kaynakta halihazırda doğrulanabilen oyuncu sayısı yaklaşık %82 artıyor (`16.847 → 30.741`), Club × Club cevapları üç kattan fazla oluyor ve iki modda net 67.043 oynanabilir challenge ekleniyor.

Ancak “50.000 oyuncunun tamamını içe aktar” doğru hedef değildir: 19.407 profil oyuncusu kaynakta iki moddan hiçbiri için yeterli resmî kanıta sahip değil. Önerilen hedef, önce mevcut 50.149 profil içinde **30.741 kanıtlı oyuncuya** kontrollü genişleme; profil-dışı 19.606 aday ise ayrı bir veri-zenginleştirme çalışmasıdır.

En yüksek getirili ve en düşük riskli sıra:

1. cap kontrolü bug'ını ve milli appearance eşlemesini düzeltmek;
2. `games.csv` ile unmapped kulüpleri çözmek;
3. başlangıç kadrosu ve on-field event kanıtını provenance ile eklemek;
4. yeni kulüpleri prominence/difficulty kapılarıyla kademeli açmak.
