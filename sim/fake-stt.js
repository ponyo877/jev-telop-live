// 偽の音声認識。stt/ の Swift CLI と同じ形の JSONL を、台本どおりに stdout へ出す。マイクなしで画面を確かめるためのもの。
//   STT_CMD="node sim/fake-stt.js" node server.js          検証用の台本を早口で
//   STT_CMD="node sim/fake-stt.js promo" node server.js    宣伝用の 1 分の話を、人が喋る速さで
// 1 文ごとに、認識途中（interim）を少しずつ伸ばしてから確定（final）を出す。

import { PROMO, SCRIPT, sleep, speak } from './script.js'

const promo = process.argv[2] === 'promo'
// 人の話速では 1 文字ずつ出す。3 文字ずつだと字幕の間隔が空きすぎて、文の途中が「字幕が止まった」扱いになる
const pace = promo ? { stepChars: 1, stepMs: 154 } : {}

const emit = (event) => process.stdout.write(`${JSON.stringify(event)}\n`)

emit({ type: 'status', text: 'fake' })
await sleep(1500)
emit({ type: 'ready' })
// 「開始」を押してカメラが映るまで待てるように、宣伝用は少し間を置いてから始める
if (promo) await sleep(8000)
for (const { text } of promo ? PROMO : SCRIPT) {
  await sleep(promo ? 600 : 1800)
  await speak(text, { ...pace, onInterim: (t) => emit({ type: 'interim', text: t }), onFinal: (t) => emit({ type: 'final', text: t }) })
}
// 黙ったままにする。終了すると server.js が起動し直してしまう
setInterval(() => {}, 1 << 30)
