// Built-in phrasebook for 20 common languages, extendable at runtime with
// extra languages fetched from a plain-text file on GitHub. Used to translate
// messages when the browser has no on-device translation model: the built-in
// set never needs a download or a server, so encrypted messages still work
// offline; the remote set is an optional, best-effort enhancement.
//
// Each row is one meaning, in this column order:
export const PHRASEBOOK_LANGS = ['en', 'es', 'pt', 'fr', 'de', 'it', 'nl', 'pl', 'tr', 'ru', 'uk', 'ar', 'hi', 'ja', 'ko', 'zh', 'vi', 'id', 'th', 'sv'] as const;
export type PhraseLang = (typeof PHRASEBOOK_LANGS)[number];

// Alternatives within a cell are separated by "/" (the first is used as output).
const ROWS = `
hello|hola|olá/oi|bonjour/salut|hallo|ciao/salve|hallo/hoi|cześć/witaj|merhaba/selam|привет/здравствуйте|привіт/вітаю|مرحبا/أهلا|नमस्ते/हैलो|こんにちは|안녕하세요/안녕|你好|xin chào/chào|halo/hai|สวัสดี|hej/hallå
hi|hola|oi|salut|hi|ciao|hoi|hej|selam|привет|привіт|أهلا|हाय|やあ|안녕|嗨|chào|hai|หวัดดี|hej
good morning|buenos días|bom dia|bonjour|guten morgen|buongiorno|goedemorgen|dzień dobry|günaydın|доброе утро|доброго ранку|صباح الخير|सुप्रभात|おはよう/おはようございます|좋은 아침|早上好/早安|chào buổi sáng|selamat pagi|อรุณสวัสดิ์|god morgon
good afternoon|buenas tardes|boa tarde|bon après-midi|guten tag|buon pomeriggio|goedemiddag|dzień dobry|tünaydın|добрый день|доброго дня|مساء الخير|शुभ दोपहर|こんにちは|안녕하세요|下午好|chào buổi chiều|selamat siang|สวัสดีตอนบ่าย|god eftermiddag
good evening|buenas noches|boa noite|bonsoir|guten abend|buonasera|goedenavond|dobry wieczór|iyi akşamlar|добрый вечер|добрий вечір|مساء الخير|शुभ संध्या|こんばんは|좋은 저녁|晚上好|chào buổi tối|selamat malam|สวัสดีตอนเย็น|god kväll
good night|buenas noches|boa noite|bonne nuit|gute nacht|buonanotte|welterusten/goedenacht|dobranoc|iyi geceler|спокойной ночи|на добраніч|تصبح على خير|शुभ रात्रि|おやすみ/おやすみなさい|잘 자/안녕히 주무세요|晚安|chúc ngủ ngon|selamat tidur|ราตรีสวัสดิ์|god natt
goodbye|adiós|tchau/adeus|au revoir|tschüss/auf wiedersehen|arrivederci/ciao|tot ziens/doei|do widzenia/pa|hoşça kal/görüşürüz|до свидания/пока|до побачення/бувай|مع السلامة/وداعا|अलविदा|さようなら/バイバイ|안녕히 가세요/잘 가|再见|tạm biệt|selamat tinggal/dah|ลาก่อน|hej då
bye|adiós/chao|tchau|salut|tschüss|ciao|doei|pa|bay bay|пока|бувай|باي|बाय|バイバイ|잘 가|拜拜|tạm biệt|dah|บาย|hej då
see you later|hasta luego|até logo|à plus tard/à plus|bis später|a dopo|tot later|do zobaczenia|sonra görüşürüz|увидимся позже|побачимося пізніше|أراك لاحقا|बाद में मिलते हैं|またね/また後で|나중에 봐|回头见|hẹn gặp lại|sampai jumpa|แล้วเจอกัน|vi ses senare
see you tomorrow|hasta mañana|até amanhã|à demain|bis morgen|a domani|tot morgen|do jutra|yarın görüşürüz|до завтра|до завтра|أراك غدا|कल मिलते हैं|また明日|내일 봐|明天见|hẹn gặp ngày mai|sampai besok|เจอกันพรุ่งนี้|vi ses imorgon
how are you|cómo estás/qué tal|como você está/tudo bem|comment ça va/ça va|wie geht's/wie geht es dir|come stai|hoe gaat het|jak się masz/co słychać|nasılsın|как дела/как ты|як справи|كيف حالك|आप कैसे हैं/कैसे हो|元気ですか/お元気ですか|잘 지내요/어떻게 지내요|你好吗|bạn khỏe không|apa kabar|สบายดีไหม|hur mår du
i am fine|estoy bien|estou bem|je vais bien|mir geht's gut|sto bene|het gaat goed|dobrze/mam się dobrze|iyiyim|я в порядке/хорошо|я в порядку|أنا بخير|मैं ठीक हूँ|元気です|잘 지내요|我很好|tôi khỏe|saya baik|สบายดี|jag mår bra
thank you very much|muchas gracias|muito obrigado/muito obrigada|merci beaucoup|vielen dank|grazie mille|heel erg bedankt|bardzo dziękuję|çok teşekkür ederim|большое спасибо|дуже дякую|شكرا جزيلا|बहुत धन्यवाद|どうもありがとうございます|정말 감사합니다|非常感谢|cảm ơn rất nhiều|terima kasih banyak|ขอบคุณมาก|tack så mycket
thank you|gracias|obrigado/obrigada|merci|danke|grazie|dank je/bedankt|dziękuję/dzięki|teşekkür ederim/teşekkürler|спасибо|дякую|شكرا|धन्यवाद/शुक्रिया|ありがとう/ありがとうございます|감사합니다/고마워|谢谢|cảm ơn|terima kasih|ขอบคุณ|tack
thanks|gracias|valeu/obrigado|merci|danke|grazie|bedankt|dzięki|sağ ol|спасибо|дякую|شكرا|थैंक्स|ありがとう|고마워|谢了|cảm ơn|makasih|ขอบใจ|tack
you're welcome|de nada|de nada|de rien|bitte/gern geschehen|prego|graag gedaan|proszę bardzo|rica ederim|пожалуйста|будь ласка|عفوا|आपका स्वागत है|どういたしまして|천만에요|不客气|không có gì|sama-sama|ไม่เป็นไร|varsågod
please|por favor|por favor|s'il vous plaît/s'il te plaît|bitte|per favore|alsjeblieft|proszę|lütfen|пожалуйста|будь ласка|من فضلك|कृपया|お願いします/ください|제발/부탁해요|请|làm ơn|tolong|กรุณา|snälla/tack
sorry|lo siento/perdón|desculpa/desculpe|désolé/pardon|entschuldigung/sorry|scusa/mi dispiace|sorry/excuses|przepraszam|özür dilerim/pardon|извини/простите|вибач/вибачте|آسف|माफ़ कीजिए/सॉरी|ごめん/すみません|미안해/죄송합니다|对不起|xin lỗi|maaf|ขอโทษ|förlåt/ursäkta
excuse me|disculpe/perdone|com licença|excusez-moi|entschuldigen sie|mi scusi|pardon|przepraszam|affedersiniz|извините|перепрошую|عذرا|क्षमा कीजिए|すみません|실례합니다|打扰一下|xin lỗi|permisi|ขอโทษครับ|ursäkta
no problem|no hay problema|sem problema|pas de problème|kein problem|nessun problema|geen probleem|nie ma problemu|sorun değil|без проблем|без проблем|لا مشكلة|कोई बात नहीं|問題ない/大丈夫|문제없어요|没问题|không sao|tidak masalah|ไม่มีปัญหา|inga problem
of course|por supuesto/claro|claro/com certeza|bien sûr|natürlich|certo/certamente|natuurlijk|oczywiście|tabii ki|конечно|звичайно|بالطبع|बिल्कुल|もちろん|물론이죠|当然|tất nhiên|tentu saja|แน่นอน|självklart
i love you|te quiero/te amo|eu te amo|je t'aime|ich liebe dich|ti amo|ik hou van je|kocham cię|seni seviyorum|я тебя люблю|я тебе кохаю|أحبك|मैं तुमसे प्यार करता हूँ|愛してる|사랑해|我爱你|anh yêu em/em yêu anh|aku cinta kamu|ฉันรักเธอ|jag älskar dig
i miss you|te extraño|sinto sua falta|tu me manques|ich vermisse dich|mi manchi|ik mis je|tęsknię za tobą|seni özledim|я скучаю по тебе|я сумую за тобою|اشتقت إليك|मुझे तुम्हारी याद आती है|会いたい/寂しい|보고 싶어|我想你|nhớ bạn|aku kangen kamu|คิดถึง|jag saknar dig
welcome|bienvenido/bienvenida|bem-vindo/bem-vinda|bienvenue|willkommen|benvenuto/benvenuta|welkom|witaj/witamy|hoş geldin/hoş geldiniz|добро пожаловать|ласкаво просимо|أهلا وسهلا/مرحبا بك|स्वागत है|ようこそ|환영합니다|欢迎|chào mừng|selamat datang|ยินดีต้อนรับ|välkommen
congratulations|felicidades/enhorabuena|parabéns|félicitations|herzlichen glückwunsch/glückwunsch|congratulazioni/complimenti|gefeliciteerd|gratulacje|tebrikler|поздравляю|вітаю|مبروك/تهانينا|बधाई हो|おめでとう/おめでとうございます|축하해요|恭喜|chúc mừng|selamat|ยินดีด้วย|grattis
happy birthday|feliz cumpleaños|feliz aniversário|joyeux anniversaire|alles gute zum geburtstag|buon compleanno|gefeliciteerd met je verjaardag|wszystkiego najlepszego|doğum günün kutlu olsun|с днём рождения|з днем народження|عيد ميلاد سعيد|जन्मदिन मुबारक|誕生日おめでとう|생일 축하해|生日快乐|chúc mừng sinh nhật|selamat ulang tahun|สุขสันต์วันเกิด|grattis på födelsedagen
good luck|buena suerte|boa sorte|bonne chance|viel glück|buona fortuna|veel succes/succes|powodzenia|iyi şanslar/bol şans|удачи|удачі|حظا سعيدا|शुभकामनाएं|頑張って/幸運を|행운을 빌어요|祝你好运|chúc may mắn|semoga berhasil|โชคดี|lycka till
have a nice day|que tengas un buen día|tenha um bom dia|bonne journée|schönen tag noch|buona giornata|fijne dag|miłego dnia|iyi günler|хорошего дня|гарного дня|يوما سعيدا|आपका दिन शुभ हो|良い一日を|좋은 하루 보내세요|祝你今天愉快|chúc một ngày tốt lành|semoga harimu menyenangkan|ขอให้มีวันที่ดี|ha en bra dag
what is your name|cómo te llamas|qual é o seu nome/como você se chama|comment tu t'appelles/comment vous appelez-vous|wie heißt du|come ti chiami|hoe heet je|jak masz na imię|adın ne|как тебя зовут|як тебе звати|ما اسمك|आपका नाम क्या है|お名前は何ですか/名前は|이름이 뭐예요|你叫什么名字|bạn tên là gì|siapa namamu|คุณชื่ออะไร|vad heter du
my name is|me llamo/mi nombre es|meu nome é/eu me chamo|je m'appelle|ich heiße|mi chiamo|ik heet|mam na imię/nazywam się|benim adım|меня зовут|мене звати|اسمي|मेरा नाम है|私の名前は|제 이름은|我叫|tôi tên là|nama saya|ฉันชื่อ|jag heter
nice to meet you|mucho gusto/encantado|prazer em conhecê-lo/prazer|enchanté|freut mich|piacere|aangenaam/leuk je te ontmoeten|miło cię poznać|tanıştığıma memnun oldum|приятно познакомиться|приємно познайомитися|تشرفت بمعرفتك|आपसे मिलकर खुशी हुई|はじめまして/よろしく|만나서 반가워요|很高兴认识你|rất vui được gặp bạn|senang bertemu denganmu|ยินดีที่ได้รู้จัก|trevligt att träffas
where are you from|de dónde eres|de onde você é|d'où viens-tu|woher kommst du|di dove sei|waar kom je vandaan|skąd jesteś|nerelisin|откуда ты|звідки ти|من أين أنت|आप कहाँ से हैं|どこから来ましたか/出身はどこですか|어디에서 왔어요|你是哪里人|bạn từ đâu đến|kamu dari mana|คุณมาจากไหน|varifrån kommer du
i don't understand|no entiendo|não entendo|je ne comprends pas|ich verstehe nicht|non capisco|ik begrijp het niet|nie rozumiem|anlamıyorum|я не понимаю|я не розумію|لا أفهم|मुझे समझ नहीं आया|わかりません|이해가 안 돼요|我不明白/我不懂|tôi không hiểu|saya tidak mengerti|ฉันไม่เข้าใจ|jag förstår inte
i understand|entiendo|entendo|je comprends|ich verstehe|capisco|ik begrijp het|rozumiem|anlıyorum|я понимаю|я розумію|أفهم|मैं समझता हूँ|わかります/わかった|알겠어요|我明白|tôi hiểu|saya mengerti|ฉันเข้าใจ|jag förstår
i don't know|no sé|não sei|je ne sais pas|ich weiß nicht|non lo so|ik weet het niet|nie wiem|bilmiyorum|я не знаю|я не знаю|لا أعرف|मुझे नहीं पता|わからない/知らない|몰라요|我不知道|tôi không biết|saya tidak tahu|ไม่รู้|jag vet inte
do you speak english|hablas inglés|você fala inglês|parles-tu anglais|sprichst du englisch|parli inglese|spreek je engels|mówisz po angielsku|ingilizce konuşuyor musun|ты говоришь по-английски|ти розмовляєш англійською|هل تتكلم الإنجليزية|क्या आप अंग्रेज़ी बोलते हैं|英語を話せますか|영어 할 줄 알아요|你会说英语吗|bạn có nói tiếng anh không|apakah kamu bisa bahasa inggris|คุณพูดภาษาอังกฤษได้ไหม|pratar du engelska
can you help me|puedes ayudarme|você pode me ajudar|peux-tu m'aider|kannst du mir helfen|puoi aiutarmi|kun je me helpen|możesz mi pomóc|bana yardım edebilir misin|можешь мне помочь|можеш мені допомогти|هل يمكنك مساعدتي|क्या आप मेरी मदद कर सकते हैं|手伝ってくれますか|도와줄 수 있어요|你能帮我吗|bạn có thể giúp tôi không|bisakah kamu membantuku|ช่วยฉันได้ไหม|kan du hjälpa mig
what are you doing|qué haces/qué estás haciendo|o que você está fazendo|qu'est-ce que tu fais|was machst du|cosa fai|wat ben je aan het doen|co robisz|ne yapıyorsun|что ты делаешь|що ти робиш|ماذا تفعل|तुम क्या कर रहे हो|何してる|뭐 해요|你在做什么/你在干嘛|bạn đang làm gì|kamu sedang apa|ทำอะไรอยู่|vad gör du
let's play|vamos a jugar|vamos jogar|on joue/jouons|lass uns spielen|giochiamo|laten we spelen|zagrajmy|hadi oynayalım|давай играть/давай поиграем|давай грати|هيا نلعب|चलो खेलते हैं|遊ぼう|놀자/게임하자|我们玩吧|chơi thôi|ayo main|มาเล่นกัน|vi spelar
what time is it|qué hora es|que horas são|quelle heure est-il|wie spät ist es|che ore sono|hoe laat is het|która godzina|saat kaç|который час|котра година|كم الساعة|कितने बजे हैं|今何時ですか|몇 시예요|几点了|mấy giờ rồi|jam berapa|กี่โมงแล้ว|vad är klockan
how much|cuánto|quanto|combien|wie viel|quanto|hoeveel|ile|ne kadar|сколько|скільки|كم|कितना|いくら|얼마|多少|bao nhiêu|berapa|เท่าไหร่|hur mycket
are you okay|estás bien|você está bem|ça va/tu vas bien|geht es dir gut|stai bene|gaat het|wszystko w porządku|iyi misin|ты в порядке|ти в порядку|هل أنت بخير|क्या तुम ठीक हो|大丈夫|괜찮아요|你还好吗|bạn ổn không|kamu baik-baik saja|โอเคไหม|är du okej
me too|yo también|eu também|moi aussi|ich auch|anch'io|ik ook|ja też|ben de|я тоже|я теж|وأنا أيضا|मैं भी|私も|나도|我也是|tôi cũng vậy|aku juga|ฉันด้วย|jag också
not bad|no está mal|nada mal|pas mal|nicht schlecht|non male|niet slecht|nieźle|fena değil|неплохо|непогано|ليس سيئا|बुरा नहीं|悪くない|나쁘지 않아|不错|không tệ|lumayan|ไม่เลว|inte illa
very good|muy bien|muito bem/muito bom|très bien|sehr gut|molto bene|heel goed|bardzo dobrze|çok iyi|очень хорошо|дуже добре|جيد جدا|बहुत अच्छा|とても良い|아주 좋아요|很好|rất tốt|sangat bagus|ดีมาก|mycket bra
right now|ahora mismo|agora mesmo|tout de suite/maintenant|jetzt sofort|subito/proprio ora|nu meteen|teraz/w tej chwili|şimdi/hemen|прямо сейчас|прямо зараз|الآن|अभी|今すぐ|지금 바로|现在/马上|ngay bây giờ|sekarang juga|ตอนนี้|just nu
happy new year|feliz año nuevo|feliz ano novo|bonne année|frohes neues jahr|buon anno|gelukkig nieuwjaar|szczęśliwego nowego roku|mutlu yıllar|с новым годом|з новим роком|سنة سعيدة|नया साल मुबारक|あけましておめでとう|새해 복 많이 받으세요|新年快乐|chúc mừng năm mới|selamat tahun baru|สวัสดีปีใหม่|gott nytt år
merry christmas|feliz navidad|feliz natal|joyeux noël|frohe weihnachten|buon natale|vrolijk kerstfeest|wesołych świąt|mutlu noeller|с рождеством|з різдвом|عيد ميلاد مجيد|क्रिसमस की शुभकामनाएं|メリークリスマス|메리 크리스마스|圣诞快乐|giáng sinh vui vẻ|selamat natal|สุขสันต์วันคริสต์มาส|god jul
yes|sí|sim|oui|ja|sì|ja|tak|evet|да|так|نعم|हाँ|はい/うん|네/응|是/是的|vâng/có|ya|ใช่|ja
no|no|não|non|nein|no|nee|nie|hayır|нет|ні|لا|नहीं|いいえ/いや|아니요/아니|不/不是|không|tidak/nggak|ไม่|nej
ok|vale/de acuerdo|ok/tá bom|d'accord|okay/in ordnung|va bene|oké|dobrze/okej|tamam|хорошо/ладно|добре/гаразд|حسنا|ठीक है|オーケー/わかった|알았어|好的/好|được|oke|โอเค|okej
maybe|quizás/tal vez|talvez|peut-être|vielleicht|forse|misschien|może|belki|может быть/возможно|можливо|ربما|शायद|たぶん/かもしれない|아마|也许/可能|có lẽ|mungkin|อาจจะ|kanske
i|yo|eu|je|ich|io|ik|ja|ben|я|я|أنا|मैं|私|나/저|我|tôi|saya/aku|ฉัน|jag
you|tú|você|tu/vous|du|tu|jij/je|ty|sen|ты|ти|أنت|तुम/आप|あなた|너/당신|你|bạn|kamu/anda|คุณ|du
he|él|ele|il|er|lui|hij|on|o|он|він|هو|वह|彼|그|他|anh ấy|dia|เขา|han
she|ella|ela|elle|sie|lei|zij|ona|o|она|вона|هي|वह|彼女|그녀|她|cô ấy|dia|เธอ|hon
we|nosotros|nós|nous|wir|noi|wij|my|biz|мы|ми|نحن|हम|私たち|우리|我们|chúng tôi/chúng ta|kami/kita|เรา|vi
they|ellos|eles|ils|sie|loro|zij|oni|onlar|они|вони|هم|वे|彼ら|그들|他们|họ|mereka|พวกเขา|de
this|esto/este|isto/este|ceci/ce|das/dies|questo|dit|to|bu|это|це|هذا|यह|これ|이것|这|cái này|ini|นี่|det här
that|eso/ese|isso/esse|cela/ça|das|quello|dat|tamto|şu/o|то|те|ذلك|वह|それ|그것|那|cái đó|itu|นั่น|det där
what|qué|o que|quoi|was|cosa|wat|co|ne|что|що|ماذا|क्या|何|뭐|什么|cái gì|apa|อะไร|vad
who|quién|quem|qui|wer|chi|wie|kto|kim|кто|хто|من|कौन|誰|누구|谁|ai|siapa|ใคร|vem
where|dónde|onde|où|wo|dove|waar|gdzie|nerede|где|де|أين|कहाँ|どこ|어디|哪里|ở đâu|di mana|ที่ไหน|var
when|cuándo|quando|quand|wann|quando|wanneer|kiedy|ne zaman|когда|коли|متى|कब|いつ|언제|什么时候|khi nào|kapan|เมื่อไหร่|när
why|por qué|por que|pourquoi|warum|perché|waarom|dlaczego|neden|почему|чому|لماذا|क्यों|なぜ/なんで|왜|为什么|tại sao|kenapa/mengapa|ทำไม|varför
how|cómo|como|comment|wie|come|hoe|jak|nasıl|как|як|كيف|कैसे|どう/どうやって|어떻게|怎么|như thế nào|bagaimana|อย่างไร|hur
good|bueno/bien|bom|bon/bien|gut|buono/bene|goed|dobry/dobrze|iyi|хорошо/хороший|добре/добрий|جيد|अच्छा|良い/いい|좋은/좋아요|好|tốt|baik/bagus|ดี|bra
bad|malo|mau/ruim|mauvais|schlecht|cattivo/male|slecht|zły|kötü|плохо/плохой|погано/поганий|سيء|बुरा|悪い|나쁜|坏/不好|tệ/xấu|buruk/jelek|ไม่ดี|dålig
great|genial|ótimo|génial|toll/super|fantastico|geweldig|świetnie|harika|отлично|чудово|رائع|बढ़िया|すごい/素晴らしい|대박/훌륭해요|太棒了|tuyệt vời|hebat/keren|เยี่ยม|toppen
cool|genial/chido|legal|cool/sympa|cool|figo|gaaf/cool|fajnie|güzel/havalı|круто|круто|رائع|कूल|かっこいい|멋져요|酷|ngầu|keren|เท่|coolt
beautiful|hermoso/bonito|bonito/lindo|beau/belle|schön|bello/bella|mooi|piękny|güzel|красивый|гарний|جميل|सुंदर|きれい/美しい|아름다운/예뻐요|漂亮/美丽|đẹp|cantik/indah|สวย|vacker
funny|gracioso|engraçado|drôle|lustig|divertente|grappig|zabawny|komik|смешно/смешной|смішно|مضحك|मज़ेदार|面白い|웃겨요|好笑/有趣|buồn cười|lucu|ตลก|rolig
happy|feliz|feliz|heureux|glücklich|felice|blij/gelukkig|szczęśliwy|mutlu|счастливый|щасливий|سعيد|खुश|嬉しい/幸せ|행복해요|快乐/开心|vui/hạnh phúc|senang/bahagia|มีความสุข|glad
sad|triste|triste|triste|traurig|triste|verdrietig|smutny|üzgün|грустно/грустный|сумно|حزين|उदास|悲しい|슬퍼요|难过/伤心|buồn|sedih|เศร้า|ledsen
tired|cansado|cansado|fatigué|müde|stanco|moe|zmęczony|yorgun|устал/уставший|втомлений|متعب|थका हुआ|疲れた|피곤해요|累|mệt|capek/lelah|เหนื่อย|trött
hungry|hambriento/tengo hambre|com fome|faim|hungrig|affamato|honger|głodny|aç|голодный|голодний|جائع|भूखा|お腹が空いた|배고파요|饿|đói|lapar|หิว|hungrig
friend|amigo|amigo|ami|freund|amico|vriend|przyjaciel|arkadaş|друг|друг|صديق|दोस्त|友達|친구|朋友|bạn|teman|เพื่อน|vän
friends|amigos|amigos|amis|freunde|amici|vrienden|przyjaciele|arkadaşlar|друзья|друзі|أصدقاء|दोस्त|友達|친구들|朋友们|bạn bè|teman-teman|เพื่อนๆ|vänner
family|familia|família|famille|familie|famiglia|familie|rodzina|aile|семья|сім'я|عائلة|परिवार|家族|가족|家人|gia đình|keluarga|ครอบครัว|familj
love|amor|amor|amour|liebe|amore|liefde|miłość|aşk|любовь|кохання|حب|प्यार|愛|사랑|爱|tình yêu|cinta|ความรัก|kärlek
game|juego|jogo|jeu|spiel|gioco|spel|gra|oyun|игра|гра|لعبة|खेल|ゲーム|게임|游戏|trò chơi|permainan/game|เกม|spel
games|juegos|jogos|jeux|spiele|giochi|spellen|gry|oyunlar|игры|ігри|ألعاب|खेल|ゲーム|게임|游戏|trò chơi|game|เกม|spel
music|música|música|musique|musik|musica|muziek|muzyka|müzik|музыка|музика|موسيقى|संगीत|音楽|음악|音乐|âm nhạc|musik|เพลง|musik
movie|película|filme|film|film|film|film|film|film|фильм|фільм|فيلم|फ़िल्म|映画|영화|电影|phim|film|หนัง|film
food|comida|comida|nourriture|essen|cibo|eten|jedzenie|yemek|еда|їжа|طعام|खाना|食べ物|음식|食物|đồ ăn|makanan|อาหาร|mat
water|agua|água|eau|wasser|acqua|water|woda|su|вода|вода|ماء|पानी|水|물|水|nước|air|น้ำ|vatten
school|escuela|escola|école|schule|scuola|school|szkoła|okul|школа|школа|مدرسة|स्कूल|学校|학교|学校|trường học|sekolah|โรงเรียน|skola
work|trabajo|trabalho|travail|arbeit|lavoro|werk|praca|iş|работа|робота|عمل|काम|仕事|일|工作|công việc|kerja|งาน|jobb
home|casa|casa|maison|zuhause|casa|thuis|dom|ev|дом|дім|بيت|घर|家|집|家|nhà|rumah|บ้าน|hem
time|tiempo|tempo|temps|zeit|tempo|tijd|czas|zaman|время|час|وقت|समय|時間|시간|时间|thời gian|waktu|เวลา|tid
day|día|dia|jour|tag|giorno|dag|dzień|gün|день|день|يوم|दिन|日|날|天|ngày|hari|วัน|dag
night|noche|noite|nuit|nacht|notte|nacht|noc|gece|ночь|ніч|ليل|रात|夜|밤|晚上|đêm|malam|กลางคืน|natt
today|hoy|hoje|aujourd'hui|heute|oggi|vandaag|dzisiaj|bugün|сегодня|сьогодні|اليوم|आज|今日|오늘|今天|hôm nay|hari ini|วันนี้|idag
tomorrow|mañana|amanhã|demain|morgen|domani|morgen|jutro|yarın|завтра|завтра|غدا|कल|明日|내일|明天|ngày mai|besok|พรุ่งนี้|imorgon
yesterday|ayer|ontem|hier|gestern|ieri|gisteren|wczoraj|dün|вчера|вчора|أمس|कल|昨日|어제|昨天|hôm qua|kemarin|เมื่อวาน|igår
now|ahora|agora|maintenant|jetzt|ora|nu|teraz|şimdi|сейчас|зараз|الآن|अब|今|지금|现在|bây giờ|sekarang|ตอนนี้|nu
later|luego/más tarde|mais tarde|plus tard|später|più tardi|later|później|sonra|позже|пізніше|لاحقا|बाद में|後で|나중에|以后/待会儿|sau|nanti|ทีหลัง|senare
soon|pronto|logo/em breve|bientôt|bald|presto|binnenkort|wkrótce|yakında|скоро|скоро|قريبا|जल्द ही|もうすぐ|곧|很快|sớm|segera|เร็วๆ นี้|snart
always|siempre|sempre|toujours|immer|sempre|altijd|zawsze|her zaman|всегда|завжди|دائما|हमेशा|いつも|항상|总是|luôn luôn|selalu|เสมอ|alltid
never|nunca|nunca|jamais|nie|mai|nooit|nigdy|asla|никогда|ніколи|أبدا|कभी नहीं|決して|절대|从不|không bao giờ|tidak pernah|ไม่เคย|aldrig
here|aquí|aqui|ici|hier|qui|hier|tutaj|burada|здесь|тут|هنا|यहाँ|ここ|여기|这里|ở đây|di sini|ที่นี่|här
there|allí/ahí|ali/lá|là|dort|lì|daar|tam|orada|там|там|هناك|वहाँ|そこ|거기|那里|ở đó|di sana|ที่นั่น|där
with|con|com|avec|mit|con|met|z|ile|с|з|مع|के साथ|と一緒に|와 함께|和/跟|với|dengan|กับ|med
without|sin|sem|sans|ohne|senza|zonder|bez|olmadan|без|без|بدون|बिना|なしで|없이|没有|không có|tanpa|ไม่มี|utan
and|y|e|et|und|e|en|i|ve|и|і|و|और|と|그리고|和|và|dan|และ|och
or|o|ou|ou|oder|o|of|lub/albo|veya|или|або|أو|या|または|또는|或者|hoặc|atau|หรือ|eller
but|pero|mas|mais|aber|ma|maar|ale|ama|но|але|لكن|लेकिन|でも|하지만|但是|nhưng|tapi|แต่|men
because|porque|porque|parce que|weil|perché|omdat|ponieważ|çünkü|потому что|тому що|لأن|क्योंकि|なぜなら|왜냐하면|因为|bởi vì|karena|เพราะ|eftersom
very|muy|muito|très|sehr|molto|heel|bardzo|çok|очень|дуже|جدا|बहुत|とても|아주/정말|很|rất|sangat|มาก|mycket
more|más|mais|plus|mehr|più|meer|więcej|daha|больше|більше|أكثر|अधिक|もっと|더|更多|nhiều hơn|lebih|มากกว่า|mer
all|todo/todos|todo/todos|tout/tous|alle|tutto/tutti|alle|wszystko|hepsi|все|все|كل|सब|全部/みんな|모두|所有/都|tất cả|semua|ทั้งหมด|alla
everyone|todos|todos|tout le monde|alle|tutti|iedereen|wszyscy|herkes|все|усі|الجميع|सब लोग|みんな|모두|大家|mọi người|semua orang|ทุกคน|alla
nothing|nada|nada|rien|nichts|niente|niets|nic|hiçbir şey|ничего|нічого|لا شيء|कुछ नहीं|何も|아무것도|没什么|không có gì|tidak ada|ไม่มีอะไร|ingenting
something|algo|algo|quelque chose|etwas|qualcosa|iets|coś|bir şey|что-то|щось|شيء ما|कुछ|何か|뭔가|某事/一些|cái gì đó|sesuatu|บางอย่าง|något
want|querer|querer|vouloir|wollen|volere|willen|chcieć|istemek|хотеть|хотіти|يريد|चाहना|欲しい|원하다|想要|muốn|mau/ingin|อยากได้|vilja
need|necesitar|precisar|avoir besoin|brauchen|avere bisogno|nodig hebben|potrzebować|ihtiyaç|нужно|потрібно|يحتاج|ज़रूरत|必要|필요|需要|cần|perlu|ต้องการ|behöva
help|ayuda|ajuda|aide|hilfe|aiuto|hulp|pomoc|yardım|помощь|допомога|مساعدة|मदद|助けて/ヘルプ|도움|帮助|giúp đỡ|bantuan|ช่วย|hjälp
know|saber|saber|savoir|wissen|sapere|weten|wiedzieć|bilmek|знать|знати|يعرف|जानना|知る|알다|知道|biết|tahu|รู้|veta
think|pensar|pensar|penser|denken|pensare|denken|myśleć|düşünmek|думать|думати|يفكر|सोचना|思う|생각하다|想|nghĩ|pikir|คิด|tänka
like|gustar|gostar|aimer|mögen|piacere|leuk vinden|lubić|sevmek|нравиться|подобатися|يحب|पसंद|好き|좋아하다|喜欢|thích|suka|ชอบ|gilla
play|jugar|jogar|jouer|spielen|giocare|spelen|grać|oynamak|играть|грати|يلعب|खेलना|遊ぶ|놀다|玩|chơi|main|เล่น|spela
eat|comer|comer|manger|essen|mangiare|eten|jeść|yemek|есть|їсти|يأكل|खाना|食べる|먹다|吃|ăn|makan|กิน|äta
sleep|dormir|dormir|dormir|schlafen|dormire|slapen|spać|uyumak|спать|спати|ينام|सोना|寝る|자다|睡觉|ngủ|tidur|นอน|sova
go|ir|ir|aller|gehen|andare|gaan|iść|gitmek|идти|йти|يذهب|जाना|行く|가다|去|đi|pergi|ไป|gå
come|venir|vir|venir|kommen|venire|komen|przyjść|gelmek|прийти|прийти|يأتي|आना|来る|오다|来|đến|datang|มา|komma
see|ver|ver|voir|sehen|vedere|zien|widzieć|görmek|видеть|бачити|يرى|देखना|見る|보다|看|thấy|lihat|เห็น|se
talk|hablar|falar|parler|sprechen|parlare|praten|rozmawiać|konuşmak|говорить|говорити|يتكلم|बात करना|話す|말하다|说话|nói chuyện|bicara|พูด|prata
message|mensaje|mensagem|message|nachricht|messaggio|bericht|wiadomość|mesaj|сообщение|повідомлення|رسالة|संदेश|メッセージ|메시지|消息|tin nhắn|pesan|ข้อความ|meddelande
server|servidor|servidor|serveur|server|server|server|serwer|sunucu|сервер|сервер|خادم|सर्वर|サーバー|서버|服务器|máy chủ|server|เซิร์ฟเวอร์|server
channel|canal|canal|salon/canal|kanal|canale|kanaal|kanał|kanal|канал|канал|قناة|चैनल|チャンネル|채널|频道|kênh|saluran|ช่อง|kanal
call|llamada|chamada|appel|anruf|chiamata|oproep|połączenie|arama|звонок|дзвінок|مكالمة|कॉल|通話|통화|通话|cuộc gọi|panggilan|โทร|samtal
voice|voz|voz|voix|stimme|voce|stem|głos|ses|голос|голос|صوت|आवाज़|声|목소리|声音|giọng nói|suara|เสียง|röst
picture|foto/imagen|foto/imagem|photo/image|bild/foto|foto/immagine|foto/afbeelding|zdjęcie|resim/fotoğraf|фото|фото|صورة|तस्वीर|写真|사진|图片|ảnh|gambar/foto|รูป|bild
video|vídeo|vídeo|vidéo|video|video|video|wideo|video|видео|відео|فيديو|वीडियो|動画|동영상|视频|video|video|วิดีโอ|video
phone|teléfono|telefone|téléphone|telefon|telefono|telefoon|telefon|telefon|телефон|телефон|هاتف|फ़ोन|電話|전화|电话|điện thoại|telepon|โทรศัพท์|telefon
computer|computadora/ordenador|computador|ordinateur|computer|computer|computer|komputer|bilgisayar|компьютер|комп'ютер|حاسوب|कंप्यूटर|コンピューター/パソコン|컴퓨터|电脑|máy tính|komputer|คอมพิวเตอร์|dator
name|nombre|nome|nom|name|nome|naam|imię|ad/isim|имя|ім'я|اسم|नाम|名前|이름|名字|tên|nama|ชื่อ|namn
people|gente|pessoas|gens|leute|gente/persone|mensen|ludzie|insanlar|люди|люди|ناس|लोग|人々|사람들|人们|mọi người|orang-orang|ผู้คน|folk
man|hombre|homem|homme|mann|uomo|man|mężczyzna|adam|мужчина|чоловік|رجل|आदमी|男|남자|男人|đàn ông|pria|ผู้ชาย|man
woman|mujer|mulher|femme|frau|donna|vrouw|kobieta|kadın|женщина|жінка|امرأة|औरत|女|여자|女人|phụ nữ|wanita|ผู้หญิง|kvinna
big|grande|grande|grand|groß|grande|groot|duży|büyük|большой|великий|كبير|बड़ा|大きい|큰|大|lớn|besar|ใหญ่|stor
small|pequeño|pequeno|petit|klein|piccolo|klein|mały|küçük|маленький|малий|صغير|छोटा|小さい|작은|小|nhỏ|kecil|เล็ก|liten
new|nuevo|novo|nouveau|neu|nuovo|nieuw|nowy|yeni|новый|новий|جديد|नया|新しい|새로운|新|mới|baru|ใหม่|ny
old|viejo|velho|vieux|alt|vecchio|oud|stary|eski|старый|старий|قديم|पुराना|古い|오래된|旧/老|cũ|lama|เก่า|gammal
fast|rápido|rápido|rapide|schnell|veloce|snel|szybki|hızlı|быстро|швидко|سريع|तेज़|速い|빠른|快|nhanh|cepat|เร็ว|snabb
slow|lento|lento|lent|langsam|lento|langzaam|wolny|yavaş|медленно|повільно|بطيء|धीमा|遅い|느린|慢|chậm|lambat|ช้า|långsam
easy|fácil|fácil|facile|einfach|facile|makkelijk|łatwy|kolay|легко|легко|سهل|आसान|簡単|쉬운|容易|dễ|mudah|ง่าย|lätt
hard|difícil|difícil|difficile|schwer|difficile|moeilijk|trudny|zor|трудно|важко|صعب|मुश्किल|難しい|어려운|难|khó|sulit|ยาก|svår
hot|caliente/calor|quente|chaud|heiß|caldo|heet|gorący|sıcak|горячий/жарко|гарячий|حار|गर्म|暑い/熱い|더운|热|nóng|panas|ร้อน|varm
cold|frío|frio|froid|kalt|freddo|koud|zimny|soğuk|холодно|холодно|بارد|ठंडा|寒い/冷たい|추운|冷|lạnh|dingin|หนาว|kall
one|uno|um|un|eins|uno|een|jeden|bir|один|один|واحد|एक|一|하나|一|một|satu|หนึ่ง|en
two|dos|dois|deux|zwei|due|twee|dwa|iki|два|два|اثنان|दो|二|둘|二|hai|dua|สอง|två
three|tres|três|trois|drei|tre|drie|trzy|üç|три|три|ثلاثة|तीन|三|셋|三|ba|tiga|สาม|tre
is|es/está|é/está|est|ist|è|is|jest|-|-|-|-|है|です|이에요|是|là|adalah|คือ|är
are|son/están|são/estão|sont|sind|sono|zijn|są|-|-|-|-|हैं|です|이에요|是|là|adalah|คือ|är
not|no|não|pas|nicht|non|niet|nie|değil|не|не|لا|नहीं|ない|안|不|không|tidak|ไม่|inte
my|mi|meu/minha|mon/ma|mein|mio/mia|mijn|mój|benim|мой|мій|لي|मेरा|私の|내|我的|của tôi|saya|ของฉัน|min
your|tu|seu/sua|ton/ta|dein|tuo/tua|jouw/je|twój|senin|твой|твій|لك|तुम्हारा|あなたの|너의|你的|của bạn|kamu|ของคุณ|din
the|el/la/los/las|o/a/os/as|le/la/les|der/die/das|il/la/lo|de/het|-|-|-|-|-|-|-|-|-|-|-|-|-
a|un/una|um/uma|un/une|ein/eine|un/una|een|-|bir|-|-|-|एक|-|-|一个|một|sebuah|-|en/ett
to|a|para|à|zu|a|naar|do|-e|в/к|до|إلى|को|に|에|到|đến|ke|ไป|till
in|en|em|dans/en|in|in|in|w|-de|в|в|في|में|で/に|에서|在|trong|di|ใน|i
of|de|de|de|von|di|van|-|-|-|-|من|का|の|의|的|của|dari|ของ|av
for|para/por|para/por|pour|für|per|voor|dla|için|для|для|لـ|के लिए|のために|위해|为了|cho|untuk|สำหรับ|för
lol|jaja|kkkk/rsrs|mdr|haha|ahah|haha|haha|ahaha|ахах|ахах|ههههه|हाहा|笑/w|ㅋㅋㅋ|哈哈|haha|wkwk|555|haha
`;

// Keyed by string rather than PhraseLang so languages loaded later from GitHub (see
// loadPhrasebook below) can be merged in without a type gymnastics.
const table: Record<string, string[][]> = Object.fromEntries(PHRASEBOOK_LANGS.map((l) => [l, []]));
// Per language: phrase (lower-case, single-spaced) -> row index; plus the longest phrase length in words/characters.
const index = new Map<string, Map<string, number>>();
const longest = new Map<string, number>();
const NO_SPACES = new Set<string>(['ja', 'zh', 'th']);
// Languages the translator will actually offer: the 20 built-in ones, plus whatever
// loadPhrasebook() successfully merges in from the remote file.
const knownLangs = new Set<string>(PHRASEBOOK_LANGS);

function norm(s: string) {
  return s.toLocaleLowerCase().replace(/[’`]/g, "'").replace(/\s+/g, ' ').trim();
}

const rows = ROWS.trim().split('\n').map((line) => line.split('|'));
for (const lang of PHRASEBOOK_LANGS) index.set(lang, new Map());
rows.forEach((cells, r) => {
  PHRASEBOOK_LANGS.forEach((lang, col) => {
    const alts = (cells[col] ?? '').split('/').map(norm).filter((a) => a && a !== '-');
    table[lang][r] = alts;
    for (const a of alts) {
      const m = index.get(lang)!;
      if (!m.has(a)) m.set(a, r);
      const len = NO_SPACES.has(lang) ? a.replace(/ /g, '').length : a.split(' ').length;
      longest.set(lang, Math.max(longest.get(lang) ?? 1, len));
    }
  });
});

const SCRIPT: [RegExp, string][] = [
  [/[぀-ヿ]/, 'ja'],
  [/[가-힯]/, 'ko'],
  [/[一-鿿]/, 'zh'],
  [/[฀-๿]/, 'th'],
  [/[؀-ۿ]/, 'ar'],
  [/[ऀ-ॿ]/, 'hi'],
  [/[Ͱ-Ͽ]/, 'el'],
  [/[\u0590-\u05FF]/, 'he'],
  [/[\u0980-\u09FF]/, 'bn'],
];

/** Best guess at the language of `text`, or null if it can't tell. */
export function detectLanguage(text: string): string | null {
  for (const [re, lang] of SCRIPT) if (re.test(text)) return lang;
  const lower = norm(text);
  if (/[Ѐ-ӿ]/.test(text)) return /[іїєґ]/.test(lower) ? 'uk' : 'ru';
  const words = lower.split(/[^\p{L}']+/u).filter(Boolean);
  if (!words.length) return null;
  let best: string | null = null;
  let bestScore = 0;
  for (const lang of PHRASEBOOK_LANGS) {
    if (NO_SPACES.has(lang) || ['ru', 'uk', 'ar', 'hi', 'ko'].includes(lang)) continue;
    const m = index.get(lang)!;
    let score = 0;
    for (let i = 0; i < words.length; i++) {
      if (m.has(words[i])) score += 1;
      if (i + 1 < words.length && m.has(`${words[i]} ${words[i + 1]}`)) score += 2;
    }
    // light spelling hints
    if (lang === 'es' && /[ñ¿¡]/.test(lower)) score += 2;
    if (lang === 'pt' && /[ãõç]/.test(lower)) score += 2;
    if (lang === 'fr' && /[èêàç]|\bje\b|\best\b/.test(lower)) score += 1;
    if (lang === 'de' && /[äöüß]/.test(lower)) score += 2;
    if (lang === 'pl' && /[ąęłńśźż]/.test(lower)) score += 2;
    if (lang === 'tr' && /[ğışç]/.test(lower)) score += 2;
    if (lang === 'vi' && /[ăâđêôơư]/.test(lower)) score += 2;
    if (lang === 'sv' && /[åäö]/.test(lower)) score += 1;
    if (score > bestScore) {
      bestScore = score;
      best = lang;
    }
  }
  return bestScore >= Math.max(1, Math.ceil(words.length / 4)) ? best : null;
}

export function isPhraseLang(code: string): boolean {
  return knownLangs.has(code);
}

/**
 * Phrase-by-phrase translation using the built-in phrasebook. Longest known
 * phrases are matched first; unknown words are kept as written.
 * Returns null if nothing could be translated.
 */
export function phrasebookTranslate(text: string, from: string, to: string): string | null {
  return phrasebookTranslateDetailed(text, from, to)?.text ?? null;
}

export interface PhrasebookResult {
  text: string;
  /** phrases found in the phrasebook */
  hits: number;
  /** words not in the phrasebook that `fallback` rewrote */
  fallbacks: number;
}

/**
 * Same as phrasebookTranslate, but words the phrasebook doesn't know are passed
 * to `fallback` (e.g. letter-by-letter spelling in the target script). Known
 * phrases and fallback words are stitched back together in their original order.
 * Return null from `fallback` to leave a word as written.
 */
export function phrasebookTranslateDetailed(
  text: string,
  from: string,
  to: string,
  fallback?: (word: string) => string | null,
): PhrasebookResult | null {
  if (from === to) return null;
  if (!table[from] || !table[to]) return null;
  const m = index.get(from)!;
  const max = longest.get(from) ?? 1;
  const out: string[] = [];
  let hits = 0;
  let fallbacks = 0;
  const join = NO_SPACES.has(to) ? '' : ' ';
  const pick = (r: number) => table[to][r]?.[0];

  if (NO_SPACES.has(from)) {
    const chars = [...text];
    let i = 0;
    let plain = '';
    while (i < chars.length) {
      let matched = false;
      for (let n = Math.min(max, chars.length - i); n > 0; n--) {
        const piece = norm(chars.slice(i, i + n).join(''));
        const r = m.get(piece);
        if (r !== undefined && pick(r)) {
          if (plain) out.push(plain), (plain = '');
          out.push(pick(r)!);
          hits++;
          i += n;
          matched = true;
          break;
        }
      }
      if (!matched) plain += chars[i++];
    }
    if (plain) out.push(plain);
    return hits ? { text: tidy(out.join(join || ' ')), hits, fallbacks } : null;
  }

  // keep punctuation and spacing by splitting into word / non-word runs
  const tokens = text.split(/([^\p{L}\p{M}'-]+)/u);
  const words: { w: string; sep: string }[] = [];
  for (let i = 0; i < tokens.length; i += 2) words.push({ w: tokens[i], sep: tokens[i + 1] ?? '' });
  let i = 0;
  while (i < words.length) {
    let matched = false;
    for (let n = Math.min(max, words.length - i); n > 0; n--) {
      const seg = words.slice(i, i + n);
      // phrases may only span plain spaces, not punctuation
      if (seg.slice(0, -1).some((s) => s.sep.trim() !== '')) continue;
      const r = m.get(norm(seg.map((s) => s.w).join(' ')));
      if (r !== undefined) {
        const t = pick(r) ?? ''; // empty: this language doesn't use the word (e.g. "the" in Polish)
        const first = seg[0].w;
        const cased = first && first[0] === first[0].toLocaleUpperCase() && first[0] !== first[0].toLocaleLowerCase() ? cap(t) : t;
        if (cased) out.push(cased + (NO_SPACES.has(to) ? seg[n - 1].sep.trim() : seg[n - 1].sep));
        else if (seg[n - 1].sep.trim()) out.push(seg[n - 1].sep.trim());
        hits++;
        i += n;
        matched = true;
        break;
      }
    }
    if (!matched) {
      const w = words[i].w;
      const alt = w && fallback ? fallback(w) : null;
      if (alt) fallbacks++;
      out.push((alt ?? w) + words[i].sep);
      i++;
    }
  }
  return hits || fallbacks ? { text: tidy(out.join('')), hits, fallbacks } : null;
}

function cap(s: string) {
  return s ? s[0].toLocaleUpperCase() + s.slice(1) : s;
}
function tidy(s: string) {
  return s.replace(/ +([,.!?])/g, '$1').replace(/\s{2,}/g, ' ').trim();
}

// --- Remote phrasebook (optional) -------------------------------------------
// A plain-text, pipe-delimited file hosted on GitHub that adds more languages
// using the exact same row order as ROWS above (one line per meaning). It's
// fetched once, lazily, and merged into the built-in table; if it's missing,
// out of sync, or the device is offline, translation just falls back to the
// 20 built-in languages and nothing breaks.
const REMOTE_PHRASEBOOK_URL = 'https://raw.githubusercontent.com/darkinkytheonlycuh/AI-Hosting/main/language';

// Column order of the remote file; must match the language skill shared with that repo.
const REMOTE_LANGS = ['bn', 'fi', 'da', 'no', 'cs', 'el', 'he', 'ro', 'hu'] as const;

let remoteLoad: Promise<void> | null = null;

/**
 * Fetches and merges the extended, remote-hosted phrasebook. Safe to call many
 * times and from many places (translate() does, on every call) — the network
 * request only happens once, and subsequent calls just await the same promise.
 */
export function loadPhrasebook(): Promise<void> {
  remoteLoad ??= (async () => {
    try {
      const res = await fetch(REMOTE_PHRASEBOOK_URL, { cache: 'force-cache' });
      if (!res.ok) return;
      const text = await res.text();
      const extraRows = text
        .replace(/\r\n/g, '\n')
        .trim()
        .split('\n')
        .filter((line) => line && !line.startsWith('//'))
        .map((line) => line.split('|'));
      // The remote file has to line up 1:1 with ROWS (same meaning per line) or a
      // single bad merge could translate "goodbye" into "happy birthday" etc.
      if (extraRows.length !== rows.length) {
        console.warn(`[phrasebook] remote file has ${extraRows.length} rows, expected ${rows.length}; skipping`);
        return;
      }
      for (const lang of REMOTE_LANGS) {
        table[lang] = [];
        index.set(lang, new Map());
      }
      extraRows.forEach((cells, r) => {
        REMOTE_LANGS.forEach((lang, col) => {
          const alts = (cells[col] ?? '')
            .split('/')
            .map(norm)
            .filter((a) => a && a !== '-');
          table[lang][r] = alts;
          const m = index.get(lang)!;
          for (const a of alts) {
            if (!m.has(a)) m.set(a, r);
            const len = NO_SPACES.has(lang) ? a.replace(/ /g, '').length : a.split(' ').length;
            longest.set(lang, Math.max(longest.get(lang) ?? 1, len));
          }
        });
      });
      for (const lang of REMOTE_LANGS) knownLangs.add(lang);
    } catch {
      // offline, blocked, or the repo moved — the 20 built-in languages still work
    }
  })();
  return remoteLoad;
}

/** Number of meanings in the built-in phrasebook (shown in settings). */
export const PHRASEBOOK_SIZE = rows.length;