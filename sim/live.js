// 実 API での通し検証。台本を音声認識のように少しずつ流し、画面と同じ経路（src/pipeline.js）で演出イベントまで通す。
//   TYPESAFE_API_KEY=... node sim/live.js [--save logs/live.jsonl] [--script promo] [--pace 6.5] [--gap 600]
//   --script promo | daily  宣伝用の 1 分の話 / 短い文の日常会話を流す
//   --pace          1 秒あたりの文字数。既定は 13.6（検証を早く回すための早口）。人が喋る速さは 6〜7
//   --gap           行と行のあいだの ms。既定は 1800
// 見るもの: 期待した演出が出たか、ふつうの話で誤って出ていないか、言い切ってから演出までの遅れ、費用。
// 生の答えを --save で残しておくと、sim/sweep.js が API を呼ばずに director のしきい値を試せる。

import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { askJev } from '../src/jev.js'
import { createPipeline } from '../src/pipeline.js'
import { DAILY, PROMO, SCRIPT, sleep, speak } from './script.js'

const apiKey = process.env.TYPESAFE_API_KEY
if (!apiKey) {
  console.error('TYPESAFE_API_KEY を設定してください')
  process.exit(1)
}
const option = (name, fallback = null) => (process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : fallback)
const savePath = option('--save')
const script = { promo: PROMO, daily: DAILY }[option('--script')] ?? SCRIPT
// 速さを指定したときは 1 文字ずつ出す。3 文字ずつだと、人の話速では字幕の間隔が 350ms を超え、文の途中がすべて「字幕が止まった」扱いになる
const stepChars = option('--pace') ? 1 : 3
const stepMs = Math.round((stepChars * 1000) / Number(option('--pace', 13.6)))
const gapMs = Number(option('--gap', 1800))

const t0 = performance.now()
const clock = () => `${((performance.now() - t0) / 1000).toFixed(1).padStart(5)}s`
const usage = { calls: 0, cost: 0, latencies: [] }
const records = []
let line = null // いま流している台本の行: { index, text, expect, spokenAt, events }

const pipeline = createPipeline({
  ask: async ({ state, questions }) => {
    const res = await askJev({ apiKey, state, questions, hedgeAfterMs: 600, timeoutMs: 2500, onLateUsage: (u) => (usage.cost += u?.cost ?? 0) })
    usage.calls++
    usage.cost += res.usage?.cost ?? 0
    usage.latencies.push(res.latencyMs)
    return res
  },
  onAnswer: ({ res, reading, verdict, ctx }) => {
    records.push({ at: performance.now() - t0, line: line?.index ?? null, ctx, answers: res.answers, latencyMs: res.latencyMs })
    const cue = `${verdict.cue.id}:${verdict.cue.strength.toFixed(2)}(${verdict.cue.reason})`
    console.log(`${clock()}   ${ctx.source.padEnd(7)} ${String(res.latencyMs).padStart(4)}ms  cue ${cue.padEnd(28)} オチ ${reading.punchline.toFixed(2)}(${verdict.telop.reason})  熱 ${reading.heat.toFixed(2)}  乏 ${reading.thin.toFixed(2)}  mood ${reading.mood.top}`)
  },
  onEvents: (events) => {
    for (const e of events) {
      if (e.kind === 'oneshot') {
        line?.events.push({ ...e, delayMs: line.spokenAt == null ? null : performance.now() - line.spokenAt })
        console.log(`${clock()} ★ ${[e.layers.giongo, e.layers.fx, e.layers.se && `♪${e.layers.se}`, e.telop && `「${e.telop.text}」(${e.telop.style})`].filter(Boolean).join('  ')}`)
      } else {
        line?.moods.add(e.mood)
        console.log(`${clock()} ${e.on ? '＋' : '－'} ${e.layer}/${e.id}${e.on ? ` ${e.intensity.toFixed(2)}` : ''}  [${e.mood}]`)
      }
    }
  },
  onError: (err) => console.log(`${clock()} ! ${err.message}`),
})

const ticker = setInterval(() => pipeline.tick(), 250)
const lines = []
for (const [index, { text, expect }] of script.entries()) {
  await sleep(gapMs)
  line = { index, text, expect, spokenAt: null, events: [], moods: new Set() }
  lines.push(line)
  console.log(`\n${clock()} 「${text}」`)
  await speak(text, {
    stepChars,
    stepMs,
    onInterim: (t) => {
      // 最後まで言い切った時刻。ここから演出までが、見ている人が感じる遅れ
      if (t === text) line.spokenAt = performance.now()
      pipeline.interim(t)
    },
    onFinal: (t) => pipeline.final(t),
  })
}
await sleep(3000)
clearInterval(ticker)
pipeline.stop()

// ---------- まとめ ----------

const median = (values) => [...values].sort((a, b) => a - b)[values.length >> 1]
let hits = 0
let expected = 0
let falseFires = 0
console.log('\n---------- まとめ ----------')
for (const l of lines) {
  const cues = l.events.map((e) => e.cue).filter(Boolean)
  const wantsNone = l.expect.cue?.includes('none')
  let mark = '  '
  if (wantsNone) {
    if (l.events.length) falseFires++
    mark = l.events.length ? '✗ ' : '○ '
  } else if (l.expect.cue) {
    expected++
    const hit = cues.some((c) => l.expect.cue.includes(c))
    if (hit) hits++
    mark = hit ? '○ ' : '✗ '
  }
  const telop = l.events.find((e) => e.telop)
  console.log(`${mark}${l.text.slice(0, 22).padEnd(24, '　')} 出た: ${cues.join(',') || '-'}${telop ? ' +テロップ' : ''}  期待: ${(l.expect.cue ?? []).join('/') || '-'}${l.expect.punch ? ' オチ' : ''}${l.expect.mood ? ` mood ${l.expect.mood.join('/')}→${[...l.moods].join(',') || '-'}` : ''}`)
}
const delays = lines.flatMap((l) => l.events.map((e) => e.delayMs)).filter((d) => d != null)
console.log(`\n期待した演出: ${hits}/${expected}    何も出してほしくない行での誤発火: ${falseFires}`)
if (delays.length) console.log(`言い切ってから演出まで: 中央値 ${Math.round(median(delays))} ms（負の値は、言い切る前に出たもの）  最小 ${Math.round(Math.min(...delays))}  最大 ${Math.round(Math.max(...delays))}`)
console.log(`応答時間: 中央値 ${median(usage.latencies)} ms  最大 ${Math.max(...usage.latencies)} ms`)
console.log(`呼び出し ${usage.calls} 回  費用 $${usage.cost.toFixed(5)}  （${((performance.now() - t0) / 1000).toFixed(0)} 秒。この調子で 1 時間なら $${((usage.cost / (performance.now() - t0)) * 3600000).toFixed(2)}）`)

if (savePath) {
  mkdirSync(dirname(savePath), { recursive: true })
  writeFileSync(savePath, records.map((r) => JSON.stringify(r)).join('\n') + '\n')
  console.log(`生の答えを保存: ${savePath}（${records.length} 件）`)
}
