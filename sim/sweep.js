// director のしきい値の試し直し。sim/live.js が --save で残した生の答えを、API を呼ばずに director へ流し直す。
//   node sim/sweep.js logs/live.jsonl
// 1 回録っておけば、しきい値を変えたときに何が出て何が出なくなるかを、費用をかけずに何度でも見られる。

import { readFileSync } from 'node:fs'
import { readAnswers } from '../src/ask.js'
import { DEFAULTS, createDirector } from '../src/director.js'
import { SCRIPT } from './script.js'

const path = process.argv[2]
if (!path) {
  console.error('使い方: node sim/sweep.js <sim/live.js が保存した jsonl>')
  process.exit(1)
}
const records = readFileSync(path, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l))

/** 録った答えを、録ったときの時刻どおりに director へ流す。 */
function replay(options) {
  const director = createDirector(options)
  const fired = new Map() // 台本の行 → 出た cue
  let telops = 0
  for (const r of records) {
    const { events } = director.onAnswer(readAnswers(r.answers), { ...r.ctx, askedAt: r.at - r.latencyMs, unchanged: true }, r.at)
    for (const e of events.filter((e) => e.kind === 'oneshot')) {
      if (e.cue) fired.set(r.line, [...(fired.get(r.line) ?? []), e.cue])
      if (e.telop) telops++
    }
  }
  let hits = 0
  let expected = 0
  let falseFires = 0
  SCRIPT.forEach(({ expect }, i) => {
    const cues = fired.get(i) ?? []
    if (expect.cue?.includes('none')) falseFires += cues.length ? 1 : 0
    else if (expect.cue) {
      expected++
      if (cues.some((c) => expect.cue.includes(c))) hits++
    }
  })
  return { hits, expected, falseFires, telops, total: [...fired.values()].flat().length }
}

const show = (label, r) => console.log(`${label.padEnd(44)} 期待どおり ${r.hits}/${r.expected}  誤発火 ${r.falseFires}  擬音 ${r.total}  テロップ ${r.telops}`)

console.log(`${records.length} 件の答えを流し直す\n`)
show('いまの設定', replay({}))
console.log('\n擬音のしきい値（final / pause / interim）')
for (const shift of [-0.2, -0.1, 0.1, 0.2]) {
  const t = Object.fromEntries(Object.entries(DEFAULTS.cueThreshold).map(([k, v]) => [k, Math.round((v + shift) * 100) / 100]))
  show(`  ${t.final} / ${t.pause} / ${t.interim}`, replay({ cueThreshold: t }))
}
console.log('\n確定を待たずに出すのをやめる（interim と pause では出さない）')
show('  final のみ', replay({ cueThreshold: { final: DEFAULTS.cueThreshold.final, pause: 2, interim: 2 }, punchlineThreshold: { final: DEFAULTS.punchlineThreshold.final, pause: 2 } }))
console.log('\nオチのしきい値（final / pause）')
for (const shift of [-0.2, -0.1, 0.1, 0.2]) {
  const t = Object.fromEntries(Object.entries(DEFAULTS.punchlineThreshold).map(([k, v]) => [k, Math.round((v + shift) * 100) / 100]))
  show(`  ${t.final} / ${t.pause}`, replay({ punchlineThreshold: t }))
}
console.log('\n判断材料が乏しいときに止めるしきい値')
for (const thinBlock of [0.5, 0.6, 0.8, 0.9]) show(`  ${thinBlock}`, replay({ thinBlock }))
