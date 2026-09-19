// 台本。偽の音声認識（fake-stt.js）と、実 API での通し検証（live.js）と、下調べ（probe.js）が同じものを使う。
// expect は「こう判断してほしい」の目安。Jev の答えは確率なので、cue は上位に入っていればよしとする。
//   cue: 出てほしい演出（どれか） / punch: オチかどうか / mood: 続いてほしいムード / thin: 判断材料が乏しい

export const SCRIPT = [
  { text: '今日はですね、新しく買ったキーボードの話をしようと思います', expect: { cue: ['none'], punch: false } },
  { text: 'これがね、なんと5万円もしたんですよ', expect: { cue: ['don', 'eee'] } },
  { text: 'で、届いて箱を開けたら、中身が空っぽだったんです', expect: { cue: ['gaan', 'eee'], punch: true } },
  { text: 'いやなんでやねん、箱だけ売るなよ', expect: { cue: ['bishi', 'laugh'], punch: true } },
  { text: 'えーっと、まあ、その', expect: { cue: ['none'], thin: true } },
  { text: '問い合わせたら仕様ですって言われて、もう何も言えなかった', expect: { cue: ['shiin', 'chiin', 'gaan'] } },
  { text: 'そのあと一人で部屋で泣きました。雨も降ってきてさ', expect: { mood: ['gloom'] } },
  { text: 'もう何もかも嫌になって、ずっと天井を見てました', expect: { mood: ['gloom'] } },
  { text: 'でもね、俺は天才だから、自分で作ることにしたんですよ', expect: { cue: ['kiran'], mood: ['cool'] } },
  { text: 'うおおお完成した！これはやばい、マジで神！', expect: { cue: ['don', 'pachi', 'mera'] } },
  { text: 'なんか嫌な予感がするんだよな、誰か見てる気がする', expect: { cue: ['zawa'], mood: ['horror'] } },
  { text: '…っていう夢を見たんですよ', expect: { cue: ['zukoo', 'laugh'], punch: true } },
]

/**
 * 宣伝用の 1 分の話。いろいろな演出が一通り出るように組んである。
 * 同じ擬音は 8 秒あけないと出ず、演出を出せる発話は 20 秒に 5 つまでなので、合間にふつうの説明を挟む。
 * ムード（レンズの色、雨、暗転）は別々の発話 2 つで続いて初めて入るので、悲しい話は 2 行続ける。
 * 「再生数は三回」のような自虐は、Jev は悲しみではなく笑いと読む。雨を降らせたいなら、素直に悲しいと言う。
 */
export const PROMO = [
  { text: 'どうも！今日は、僕が作ったアプリを紹介します', expect: { cue: ['none'] } },
  { text: 'このアプリ、動画の編集時間が、なんとゼロ秒になります！', expect: { cue: ['don', 'eee'] } },
  { text: '昔は、動画一本に丸一日かけてました', expect: {} },
  { text: '徹夜で作って、再生数はたったの三回', expect: { cue: ['gaan', 'chiin', 'shiin'], mood: ['gloom'] } },
  { text: 'しかもそのうち二回は、自分でした', expect: { cue: ['chiin', 'gaan', 'shiin', 'zukoo'], punch: true, mood: ['gloom'] } },
  { text: 'もう悲しくて、毎晩ひとりで泣いてました', expect: { mood: ['gloom'] } },
  { text: 'つらい。本当につらかった', expect: { mood: ['gloom'] } },
  { text: 'いや誰やねん、残りの一回見たやつ！', expect: { cue: ['bishi', 'laugh'], punch: true } },
  { text: 'そこで閃いたんです。編集、AIにやらせればいいじゃん！', expect: { cue: ['pikon'] } },
  { text: 'どうですか、この天才的な発想', expect: { cue: ['kiran'] } },
  { text: '…ただ、なんか嫌な予感がするんですよね', expect: { cue: ['zawa'], mood: ['horror'] } },
  { text: 'さっきから、誰かに見られてる気がする…', expect: { mood: ['horror'] } },
  { text: 'えっ、待って、APIの請求が来てる！？', expect: { cue: ['eee', 'gaan', 'doki'] } },
  { text: 'やったー、一時間喋ってもたったの百円以下、大成功です！', expect: { cue: ['pachi', 'don', 'mera'] } },
  { text: '…という夢を、さっき見ました', expect: { cue: ['zukoo', 'laugh'], punch: true } },
  { text: 'チャンネル登録、よろしくお願いします！', expect: {} },
]

/**
 * 日常会話の 1 分の話。1 文を 10 文字前後に短くして、反応が次々に出るようにしてある。
 * 言葉は、音声認識が聞き違えないものだけを使う（読み上げ音声を stt --file にかけて、全行が正しく認識されるのを確かめた）。
 * 表記は音声認識が実際に書く形に合わせてある（九時 → 9時、三百円 → 300円）。
 */
export const DAILY = [
  { text: '聞いてください', expect: {} },
  { text: '今朝、寝坊しました', expect: { cue: ['gaan', 'chiin', 'zukoo'] } },
  { text: '起きたら9時でした', expect: { cue: ['eee', 'don', 'gaan'] } },
  { text: '会議は9時からです', expect: { cue: ['gaan', 'zawa', 'chiin', 'don'] } },
  { text: '終わったと思いました', expect: { cue: ['chiin', 'gaan'] } },
  { text: '急いで家を出ました', expect: {} },
  { text: '駅まで全力で走りました', expect: { cue: ['mera', 'don'] } },
  { text: 'そしたら電車が止まってました', expect: { cue: ['gaan', 'zukoo', 'eee', 'shiin'] } },
  { text: 'なんでやねん', expect: { cue: ['bishi'], punch: true } },
  { text: 'もう泣きそうでした', expect: { mood: ['gloom'] } },
  { text: '本当に悲しかったです', expect: { mood: ['gloom'] } },
  { text: 'でも、ひらめきました', expect: { cue: ['pikon'] } },
  { text: 'タクシーで行けばいい', expect: { cue: ['pikon', 'kiran'] } },
  { text: '私、天才かもしれない', expect: { cue: ['kiran'] } },
  { text: '財布を見ました', expect: {} },
  { text: '300円しかありません', expect: { cue: ['gaan', 'chiin', 'zukoo', 'shiin'], punch: true } },
  { text: '嫌な予感がします', expect: { cue: ['zawa'] } },
  { text: '会社から電話が来ました', expect: { cue: ['doki', 'zawa', 'eee'] } },
  { text: '心臓が止まるかと思いました', expect: { cue: ['doki'] } },
  { text: '今日は祝日ですよと言われました', expect: { cue: ['zukoo', 'eee', 'laugh'], punch: true } },
  { text: '全部無駄でした', expect: { cue: ['chiin', 'zukoo', 'gaan'] } },
  { text: 'でも休みです。やった', expect: { cue: ['pachi', 'don'] } },
  { text: '帰って二度寝します', expect: {} },
  { text: 'おやすみなさい', expect: {} },
]

/** 何も出してほしくない、ふつうの話。none に落ちるかを確かめる。 */
export const NEUTRAL = [
  'このキーボードは、キーが全部で87個あります',
  '配列は英語配列で、接続はUSBとBluetoothの両方に対応しています',
  'まず箱から出して、ケーブルをつなぎます',
  '次に設定の画面を開いてください',
  '今日は午後から打ち合わせが2件あります',
  'そうですね、はい、なるほど',
  'えーっと、それで、あのー',
  '資料は先週のものと同じで、変更はありません',
]

/** 同じ内容を、熱量だけ変えて言ったもの。score が順に上がるかを確かめる。 */
export const HEAT_LADDER = [
  'まあ、いいんじゃない',
  'これ、けっこういいと思います',
  'これはいいね、かなり好きだよ！',
  'これめっちゃいい！すごいすごい！',
  'うおおおおやばいやばいやばい！！最高すぎる！！！',
]

export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

/** 1 文を、音声認識のように少しずつ伸ばして渡す。戻り値は最後に確定した文字列。 */
export async function speak(line, { onInterim, onFinal, stepChars = 3, stepMs = 220, tailMs = 450 }) {
  for (let n = stepChars; n < line.length; n += stepChars) {
    onInterim(line.slice(0, n))
    await sleep(stepMs)
  }
  onInterim(line)
  // 言い切ってから確定が届くまでの間。実際の音声認識でも、ここで少し待たされる
  await sleep(tailMs)
  onFinal(line)
  return line
}
