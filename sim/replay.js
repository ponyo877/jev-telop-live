// 録った答えの流し直し。sim/live.js が --save で残した生の答えを、いまの director に流して、行ごとに何が出るかを見る。
//   node sim/replay.js logs/daily-1.jsonl [--script promo | daily]
// director の決まりを変えたときに、API を呼ばずに結果を見比べられる。

import { readFileSync } from 'node:fs'
import { readAnswers } from '../src/ask.js'
import { createDirector } from '../src/director.js'
import { DAILY, PROMO, SCRIPT } from './script.js'

const path = process.argv[2]
if (!path) {
  console.error('使い方: node sim/replay.js <sim/live.js が保存した jsonl> [--script promo | daily]')
  process.exit(1)
}
const name = process.argv.includes('--script') ? process.argv[process.argv.indexOf('--script') + 1] : null
const script = { promo: PROMO, daily: DAILY }[name] ?? SCRIPT
const records = readFileSync(path, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l))

const director = createDirector()
const lines = new Map()
const moods = []
for (const r of records) {
  const { events, verdict } = director.onAnswer(readAnswers(r.answers), { ...r.ctx, askedAt: r.at - r.latencyMs, unchanged: true }, r.at)
  const entry = lines.get(r.line) ?? { shown: [], reasons: [] }
  lines.set(r.line, entry)
  entry.reasons.push(`${r.ctx.source[0]}:${verdict.cue.reason}/${verdict.telop.reason}`)
  // 見回り（ムードを切る）も、答えの直後に 1 回入れる
  for (const e of [...events, ...director.tick({ speaking: true, lastSpeechAt: r.at }, r.at + 50)]) {
    if (e.kind === 'oneshot') entry.shown.push([e.layers.giongo, e.layers.fx, e.telop && `「${e.telop.text}」(${e.telop.style})`].filter(Boolean).join(' '))
    else if (e.layer === 'shades') moods.push(`${(r.at / 1000).toFixed(1)}s ${e.on ? '+' : '-'}${e.id}`)
  }
}

let quiet = 0
script.forEach((line, i) => {
  const entry = lines.get(i) ?? { shown: [], reasons: [] }
  if (!entry.shown.length) quiet++
  console.log(`${entry.shown.length ? '○' : '✗'} ${line.text.slice(0, 18).padEnd(19, '　')} ${entry.shown.join('  /  ') || `（何も出ない: ${entry.reasons.slice(-3).join(' ')}）`}`)
})
console.log(`\n何か出た行 ${script.length - quiet}/${script.length}    レンズの色: ${moods.join('  ') || '-'}`)
