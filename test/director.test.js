import test from 'node:test'
import assert from 'node:assert'
import { createDirector, damp, dress, telopText } from '../src/director.js'
import { readAnswers } from '../src/ask.js'

/**
 * 抑制のしくみ（しきい値、間隔、1 発話 1 回…）を確かめるための director。
 * 代わりの演出が混ざると何を確かめているのか分からなくなるので切り、しきい値も数値を固定する。
 */
const strict = (options = {}) =>
  createDirector({
    everyUtterance: false,
    cueThreshold: { final: 0.5, pause: 0.6, interim: 0.7 },
    punchlineThreshold: { final: 0.5, pause: 0.55 },
    regrowChars: 20,
    rateMax: 6,
    moodMinHoldMs: 5000,
    moodMaxHoldMs: 25000,
    layerMaxHoldMs: { screen: 8000 },
    ...options,
  })

/** 答えを手短に作る。cue / mood は { id: 強さ } で、noul も同じ値にする。 */
function reading({ cue = {}, mood = {}, punchline = 0, complete = 1, thin = 0, heat = 2, style = 'plain', noul = null } = {}) {
  const dist = (picked) => ({ none: Math.max(0, 1 - Object.values(picked).reduce((a, b) => a + b, 0)), ...picked })
  const answers = {
    cue: { probabilities: dist(cue) },
    mood: { probabilities: dist(mood) },
    telop_style: { probabilities: { [style]: 1 } },
    punchline: { noul: punchline },
    complete: { noul: complete },
    too_thin: { noul: thin },
    heat: { score: heat },
  }
  for (const [id, p] of Object.entries(cue)) answers[`cue_${id}`] = { noul: noul ?? p }
  for (const [id, p] of Object.entries(mood)) answers[`mood_${id}`] = { noul: p }
  return readAnswers(answers)
}

let seq = 0
const ctx = (now, extra = {}) => ({ seq: seq++, uttId: 1, chars: 10, source: 'final', text: 'なんでやねん。', askedAt: now - 300, unchanged: true, ...extra })
/** 発話ごとに id が進む ctx。ムードは別々の発話で続いたときだけ入るので、その確認に使う。 */
const utt = (now, extra = {}) => ctx(now, { uttId: 1000 + Math.floor(now / 600), ...extra })
const oneshots = (result) => result.events.filter((e) => e.kind === 'oneshot')

test('しきい値は経路ごとに違う。早い経路ほど厳しい', () => {
  const r = reading({ cue: { don: 0.65 } })
  assert.strictEqual(strict().onAnswer(r, ctx(1000, { source: 'interim' }), 1000).verdict.cue.reason, 'weak')
  assert.strictEqual(strict().onAnswer(r, ctx(1000, { source: 'pause' }), 1000).verdict.cue.reason, 'fired')
  assert.strictEqual(strict().onAnswer(r, ctx(1000, { source: 'final' }), 1000).verdict.cue.reason, 'fired')
})

test('cue を束に展開して 1 つのイベントにする。熱量で擬音の強さと集中線の有無が変わる', () => {
  const hot = oneshots(strict().onAnswer(reading({ cue: { don: 0.9 }, heat: 4 }), ctx(1000), 1000))[0]
  assert.deepStrictEqual(hot.layers, { giongo: 'ドドン!!', fx: 'focus', se: 'don' })
  assert.strictEqual(hot.heat, 1)
  assert.strictEqual(hot.telop, null)
  const cold = oneshots(strict().onAnswer(reading({ cue: { don: 0.9 }, heat: 1 }), ctx(1000), 1000))[0]
  assert.deepStrictEqual(cold.layers, { giongo: 'ドン', fx: null, se: 'don' })
})

test('none が勝てば何も出さない', () => {
  const result = strict().onAnswer(reading({ cue: { don: 0.2 } }), ctx(1000), 1000)
  assert.strictEqual(result.verdict.cue.reason, 'none')
  assert.deepStrictEqual(oneshots(result), [])
})

test('判断材料が乏しければ弱め、乏しすぎれば一切出さない', () => {
  assert.strictEqual(damp(0.5), 1)
  assert.ok(Math.abs(damp(1) - 0.2) < 1e-9)
  const d = strict()
  assert.strictEqual(d.onAnswer(reading({ cue: { don: 0.9 }, punchline: 0.9, thin: 0.8 }), ctx(1000), 1000).verdict.cue.reason, 'thin')
  assert.strictEqual(d.onAnswer(reading({ cue: { don: 0.6 }, thin: 0.65 }), ctx(2000), 2000).verdict.cue.reason, 'weak', '0.6 × 0.76 は 0.5 に届かない')
})

test('認識途中の字幕で出した演出は、同じ発話の確定では出さない。20 文字伸びていれば出してよい', () => {
  const d = strict({ cueGapMs: 0, sameCueMs: 0 })
  const r = reading({ cue: { don: 0.9 } })
  assert.strictEqual(d.onAnswer(r, ctx(1000, { source: 'interim', uttId: 5, chars: 8 }), 1000).verdict.cue.reason, 'fired')
  assert.strictEqual(d.onAnswer(r, ctx(1600, { source: 'final', uttId: 5, chars: 12 }), 1600).verdict.cue.reason, 'same-utterance')
  assert.strictEqual(d.onAnswer(r, ctx(9000, { source: 'interim', uttId: 5, chars: 30 }), 9000).verdict.cue.reason, 'fired')
  assert.strictEqual(d.onAnswer(r, ctx(9500, { uttId: 6, chars: 5 }), 9500).verdict.cue.reason, 'fired', '次の発話')
})

test('発話テロップは、前のものが消えてから出す。擬音とそのテロップは、出しすぎの勘定では 1 つの発話として数える', () => {
  const d = strict()
  const punch = (now, uttId) => d.onAnswer(reading({ cue: { bishi: 0.9 }, punchline: 0.9, heat: 0 }), ctx(now, { uttId, text: 'なんでやねん' }), now).verdict
  assert.strictEqual(punch(0, 1).telop.reason, 'fired') // 900 + 60 × 6 = 1260ms 出ている
  assert.strictEqual(punch(1300, 2).telop.reason, 'gap', '消えた直後はまだ出さない')
  assert.strictEqual(punch(1600, 3).telop.reason, 'fired')

  const dense = strict({ cueGapMs: 0, sameCueMs: 0, telopGapMs: 0, telopClearMs: -99999 })
  const reasons = []
  for (let i = 0; i < 7; i++) {
    const at = i * 1000
    reasons.push(dense.onAnswer(reading({ cue: { don: 0.9 } }), ctx(at, { uttId: 20 + i, source: 'interim' }), at).verdict.cue.reason)
    reasons.push(dense.onAnswer(reading({ cue: { don: 0.9 }, punchline: 0.9 }), ctx(at + 300, { uttId: 20 + i }), at + 300).verdict.telop.reason)
  }
  assert.deepStrictEqual(reasons.slice(0, 12), Array(12).fill('fired'), '6 つの発話までは、擬音もテロップも出る')
  assert.deepStrictEqual(reasons.slice(12), ['rate', 'rate'], '7 つ目の発話は出しすぎ')
})

test('連発を抑える。全体の間隔、同じ cue の間隔、20 秒あたりの上限', () => {
  const d = strict()
  let utt = 10
  const fire = (cue, now) => d.onAnswer(reading({ cue: { [cue]: 0.9 } }), ctx(now, { uttId: utt++ }), now).verdict.cue.reason
  assert.strictEqual(fire('don', 0), 'fired')
  assert.strictEqual(fire('gaan', 1000), 'gap')
  assert.strictEqual(fire('gaan', 2000), 'fired')
  assert.strictEqual(fire('don', 4000), 'same-cue')
  assert.strictEqual(fire('kiran', 4000), 'fired')
  assert.strictEqual(fire('bishi', 6000), 'fired')
  assert.strictEqual(fire('eee', 8000), 'fired')
  assert.strictEqual(fire('pikon', 10000), 'fired')
  assert.strictEqual(fire('mera', 12000), 'rate')
  assert.strictEqual(fire('mera', 20500), 'fired', '古い発火が窓から出た')
})

test('遅すぎた答えと、追い越された答えは、瞬発系に使わない', () => {
  const d = strict()
  const r = reading({ cue: { don: 0.9 } })
  assert.strictEqual(d.onAnswer(r, { ...ctx(5000), askedAt: 3000 }, 5000).verdict.cue.reason, 'stale')
  const newer = ctx(6000, { uttId: 2 })
  const older = { ...ctx(6000, { uttId: 3 }), seq: newer.seq - 1 }
  assert.strictEqual(d.onAnswer(r, newer, 6000).verdict.cue.reason, 'fired')
  assert.strictEqual(d.onAnswer(r, older, 9000).verdict.cue.reason, 'stale')
})

test('発話テロップはオチのときだけ。伸びている最中の字幕では出さず、止まった字幕では言い切りを確かめる', () => {
  const punch = reading({ punchline: 0.9, complete: 0.9, style: 'tsukkomi', heat: 3 })
  assert.strictEqual(strict().onAnswer(punch, ctx(1000, { source: 'interim' }), 1000).verdict.telop.reason, 'source')
  assert.strictEqual(strict().onAnswer(reading({ punchline: 0.9, complete: 0.3 }), ctx(1000, { source: 'pause' }), 1000).verdict.telop.reason, 'incomplete')
  assert.strictEqual(strict().onAnswer(punch, ctx(1000, { source: 'pause', unchanged: false }), 1000).verdict.telop.reason, 'incomplete')
  assert.strictEqual(strict().onAnswer(reading({ punchline: 0.52, complete: 0.9 }), ctx(1000, { source: 'pause' }), 1000).verdict.telop.reason, 'weak', '止まった字幕は、確定より少し厳しく見る')
  assert.strictEqual(strict().onAnswer(reading({ punchline: 0.52, complete: 0.9 }), ctx(1000, { source: 'final' }), 1000).verdict.telop.reason, 'fired')
  const [event] = oneshots(strict().onAnswer(punch, ctx(1000, { text: '箱を開けたら空だった。いやなんでやねん。' }), 1000))
  assert.deepStrictEqual(event.telop, { text: 'いやなんでやねん', style: 'tsukkomi' })
  assert.strictEqual(event.cue, null)
  assert.strictEqual(event.layers.se, 'slap', 'cue が無ければ様式の SE を鳴らす')
  assert.strictEqual(event.dress.ttlMs, 900 + 675 + 60 * 8)
})

test('cue と発話テロップが同時なら 1 つのイベントにまとめ、SE は cue のものにする', () => {
  const r = reading({ cue: { bishi: 0.9 }, punchline: 0.9, style: 'funny' })
  const events = oneshots(strict().onAnswer(r, ctx(1000), 1000))
  assert.strictEqual(events.length, 1)
  assert.strictEqual(events[0].cue, 'bishi')
  assert.strictEqual(events[0].telop.style, 'funny')
  assert.strictEqual(events[0].layers.se, 'slap')
})

test('cue を出した直後の発話テロップは、SE を重ねない', () => {
  const d = strict()
  d.onAnswer(reading({ cue: { bishi: 0.9 } }), ctx(1000, { source: 'interim', uttId: 7 }), 1000)
  const [event] = oneshots(d.onAnswer(reading({ cue: { bishi: 0.9 }, punchline: 0.9 }), ctx(1700, { uttId: 7 }), 1700))
  assert.strictEqual(event.cue, null)
  assert.ok(event.telop)
  assert.strictEqual(event.layers.se, null)
})

test('発話テロップの文字列は最後の文。長ければ最後の読点より後ろ、それでも長ければ末尾', () => {
  assert.strictEqual(telopText('今日はいい天気ですね。でも財布を忘れました。'), 'でも財布を忘れました')
  assert.strictEqual(telopText('えっ!?'), 'えっ!?')
  assert.strictEqual(telopText('問い合わせたら仕様ですって言われてしまって本当にびっくりしたんですけど、もう何も言えなかった'), 'もう何も言えなかった')
  assert.strictEqual(telopText('あ'.repeat(40)).length, 28)
  assert.strictEqual(telopText(''), '')
})

test('熱量の写し方は単調で、端の値が決まっている', () => {
  assert.deepStrictEqual(dress(0), { scale: 0.8, shake: 0, gain: 0.35, density: 24, ttlMs: 900 })
  assert.deepStrictEqual(dress(1), { scale: 1.8, shake: 12, gain: 1, density: 96, ttlMs: 1800 })
  for (const key of ['scale', 'shake', 'gain', 'density', 'ttlMs']) {
    for (let h = 0; h < 1; h += 0.1) assert.ok(dress(h + 0.1)[key] >= dress(h)[key], key)
  }
  assert.deepStrictEqual(dress(7), dress(1))
})

// ---------- 持続系 ----------

const ambient = (events) => events.filter((e) => e.kind === 'ambient').map((e) => `${e.on ? '+' : '-'}${e.layer}/${e.id}`).sort()
const gloomy = reading({ mood: { gloom: 0.9 } })
const neutral = reading()

test('ムードは 1 回の高い答えでは入らず、2 回続くと入る', () => {
  const d = strict()
  assert.deepStrictEqual(ambient(d.onAnswer(gloomy, utt(0), 0).events), [])
  assert.deepStrictEqual(ambient(d.onAnswer(gloomy, utt(600), 600).events), ['+face/gloom', '+screen/dark', '+screen/rain', '+shades/blue'])
  assert.strictEqual(d.snapshot().mood.active, 'gloom')
  assert.deepStrictEqual(ambient(d.onAnswer(gloomy, utt(1200), 1200).events), ['+face/gloom', '+screen/dark', '+screen/rain', '+shades/blue'], '強さが大きく変わったら送り直す')
  assert.deepStrictEqual(ambient(d.onAnswer(gloomy, utt(1800), 1800).events), [], '変わらなければ送らない')
})

test('ムードは、1 つの発話の中で答えが続いただけでは入らない。別々の発話で続いたら入る', () => {
  const d = strict()
  for (let t = 0; t < 3000; t += 600) assert.deepStrictEqual(ambient(d.onAnswer(gloomy, ctx(t, { uttId: 50 }), t).events), [], '同じ発話')
  assert.deepStrictEqual(ambient(d.onAnswer(gloomy, ctx(3000, { uttId: 51 }), 3000).events), ['+face/gloom', '+screen/dark', '+screen/rain', '+shades/blue'])
})

test('最短保持のあいだは抜けない。そのあと抜けのしきい値を割ったら抜ける', () => {
  const d = strict()
  d.onAnswer(gloomy, utt(0), 0)
  d.onAnswer(gloomy, utt(600), 600)
  for (let t = 1200; t < 5000; t += 600) assert.deepStrictEqual(ambient(d.onAnswer(neutral, utt(t), t).events).filter((e) => e.startsWith('-')), [])
  assert.deepStrictEqual(ambient(d.onAnswer(neutral, utt(6000), 6000).events), ['-face/gloom', '-screen/dark', '-screen/rain', '-shades/blue'])
})

test('ムードを乗り換えるとき、共通のレイヤーは触らない', () => {
  const d = strict({ moodMinHoldMs: 0, intensityStep: 2 })
  d.onAnswer(gloomy, utt(0), 0)
  d.onAnswer(gloomy, utt(600), 600)
  const horror = reading({ mood: { horror: 0.95 } })
  let events = []
  for (let t = 1200; t < 4000 && !events.length; t += 600) events = ambient(d.onAnswer(horror, utt(t), t).events)
  assert.deepStrictEqual(events, ['+screen/wave', '+shades/purple', '+voice/echo', '+voice/pitch_down', '-face/gloom', '-screen/rain', '-shades/blue'], 'dark は出したまま。レンズは青から紫へ')
})

test('レイヤーごとに最長を決められる。画面の効果だけ 8 秒で切り上げ、レンズの色と顔の効果は残す', () => {
  const d = strict()
  const seen = []
  for (let t = 0; t <= 12000; t += 600) seen.push(...ambient(d.onAnswer(gloomy, utt(t), t).events).filter((e) => e.startsWith('-')).map((e) => `${t} ${e}`))
  assert.deepStrictEqual(seen, ['9000 -screen/dark', '9000 -screen/rain'], '600ms に入って、8 秒後の最初の答えで抜ける')
  assert.strictEqual(d.snapshot().mood.active, 'gloom')
  assert.deepStrictEqual(d.snapshot().layers.map((l) => `${l.layer}/${l.id}`).sort(), ['face/gloom', 'shades/blue'])

  // 答えが来なくても、定期の見回りで抜ける
  const quiet = strict()
  quiet.onAnswer(gloomy, utt(0), 0)
  quiet.onAnswer(gloomy, utt(600), 600)
  assert.deepStrictEqual(ambient(quiet.tick({ speaking: true, lastSpeechAt: 8000 }, 8500)), [])
  assert.deepStrictEqual(ambient(quiet.tick({ speaking: true, lastSpeechAt: 8600 }, 8700)), ['-screen/dark', '-screen/rain'])
})

test('長く続いたムードは切り、しばらく入れない', () => {
  const d = strict()
  let off = null
  for (let t = 0; t <= 42000; t += 600) {
    const events = ambient(d.onAnswer(gloomy, utt(t), t).events)
    if (events.includes('-shades/blue') && off == null) off = t
    if (off != null && t > off && t < off + 15000) assert.deepStrictEqual(events, [], '不応期')
  }
  assert.ok(off >= 25600 && off <= 26400, `25 秒保持して切る: ${off}`)
  assert.strictEqual(d.snapshot().mood.active, 'gloom', '不応期が明けたら入り直す')
})

test('黙っているあいだはムードが薄れて抜ける', () => {
  const d = strict()
  d.onAnswer(gloomy, utt(0), 0)
  d.onAnswer(gloomy, utt(600), 600)
  let off = null
  for (let t = 1000; t < 30000 && off == null; t += 500) {
    if (ambient(d.tick({ speaking: false, lastSpeechAt: 600 }, t)).includes('-shades/blue')) off = t
  }
  assert.ok(off > 6600 && off < 12000, `無音 6 秒のあと減衰して抜ける: ${off}`)
})

test('声の切替は発話の切れ目まで待つ。喋り続けていたら 3 秒で切り替える', () => {
  const cool = reading({ mood: { cool: 0.9 } })
  const d = strict()
  d.onAnswer(cool, utt(0, { speaking: true }), 0)
  assert.deepStrictEqual(ambient(d.onAnswer(cool, utt(600, { speaking: true }), 600).events), ['+shades/gold'])
  assert.deepStrictEqual(ambient(d.tick({ speaking: true, lastSpeechAt: 1000 }, 1000)), [])
  assert.deepStrictEqual(ambient(d.tick({ speaking: false, lastSpeechAt: 1400 }, 1500)), ['+voice/pitch_down'])

  const d2 = strict()
  d2.onAnswer(cool, utt(0, { speaking: true }), 0)
  d2.onAnswer(cool, utt(600, { speaking: true }), 600)
  assert.deepStrictEqual(ambient(d2.tick({ speaking: true, lastSpeechAt: 3000 }, 3000)), [])
  assert.deepStrictEqual(ambient(d2.tick({ speaking: true, lastSpeechAt: 3700 }, 3700)), ['+voice/pitch_down'])
})

test('追い越された答えはムードにも入れない', () => {
  const d = strict()
  const first = utt(0)
  const second = utt(100)
  d.onAnswer(neutral, second, 400)
  d.onAnswer(gloomy, first, 500)
  assert.strictEqual(d.snapshot().mood.ema.gloom, 0)
})

test('手動発火は、しきい値も間隔も見ない。消すと、出ている持続系をすべて下ろす', () => {
  const d = strict()
  assert.strictEqual(d.force('don', 0, 0.9)[0].layers.giongo, 'ドドン!!')
  assert.strictEqual(d.force('don', 10, 0.9).length, 1)
  assert.deepStrictEqual(d.force('nope', 0), [])
  assert.deepStrictEqual(d.force('none', 0), [])
  assert.strictEqual(d.force(null, 0, 0.5, { text: 'テスト', style: 'impact' })[0].layers.se, 'don')
  d.onAnswer(gloomy, utt(0), 0)
  d.onAnswer(gloomy, utt(600), 600)
  assert.deepStrictEqual(ambient(d.reset(700)), ['-face/gloom', '-screen/dark', '-screen/rain', '-shades/blue'])
  assert.strictEqual(d.snapshot().mood.active, 'none')
})

// ---------- 既定の感度と、確定時の代わりの演出 ----------

test('既定のしきい値。Jev の票が割れて 0.4 前後になった擬音も、確定では拾う', () => {
  const split = reading({ cue: { don: 0.42, kiran: 0.3 }, noul: 0.9 })
  const loose = (source) => createDirector({ everyUtterance: false }).onAnswer(split, ctx(1000, { source }), 1000).verdict.cue
  assert.deepStrictEqual([loose('final').reason, loose('pause').reason, loose('interim').reason], ['fired', 'weak', 'weak'])
  assert.strictEqual(loose('final').id, 'don')
  const punch = (source, punchline) => createDirector({ everyUtterance: false }).onAnswer(reading({ punchline }), ctx(1000, { source }), 1000).verdict.telop.reason
  assert.deepStrictEqual([punch('final', 0.42), punch('pause', 0.42), punch('pause', 0.46), punch('final', 0.38)], ['fired', 'weak', 'fired', 'weak'])
})

test('確定しても何も出していなければ、その発話をテロップにする。ふつうの話は Jev の選んだ様式（plain）で、熱量なりの大きさ', () => {
  const d = createDirector()
  const neutral = reading({ heat: 1, style: 'plain', complete: 0.2 })
  const text = 'このキーボードは、キーが全部で87個あります'
  assert.deepStrictEqual(oneshots(d.onAnswer(neutral, ctx(1000, { source: 'interim', text }), 1000)), [], '伸びている最中には出さない')
  const result = d.onAnswer(neutral, ctx(1800, { source: 'final', text }), 1800)
  const [event] = oneshots(result)
  assert.deepStrictEqual(event.telop, { text: 'このキーボードは、キーが全部で87個あります', style: 'plain' })
  assert.strictEqual(event.cue, null)
  assert.strictEqual(event.layers.se, null, 'plain は SE を鳴らさない')
  assert.strictEqual(event.heat, 0.25)
  assert.strictEqual(result.verdict.telop.reason, 'fallback')
  assert.strictEqual(result.verdict.cue.reason, 'none')
})

test('none を除いていちばんの擬音に根拠があれば、テロップではなくその擬音を出す', () => {
  // none 0.71 / don 0.29。ふだんは none が勝って何も出ない行
  const faint = reading({ cue: { don: 0.29 }, noul: 0.4, heat: 1 })
  const result = createDirector().onAnswer(faint, ctx(1000), 1000)
  assert.strictEqual(result.verdict.cue.reason, 'fallback')
  assert.deepStrictEqual(oneshots(result)[0].layers, { giongo: 'ドン', fx: null, se: 'don' }, '熱量が低いので、弱い擬音で、集中線は付かない')
  assert.strictEqual(oneshots(result)[0].telop, null)
  // noul（絶対評価）が低すぎれば、擬音には根拠が無いとみてテロップにする
  const baseless = reading({ cue: { don: 0.29 }, noul: 0.1 })
  assert.strictEqual(createDirector().onAnswer(baseless, ctx(1000), 1000).verdict.telop.reason, 'fallback')
})

test('代わりの演出は、その発話でもう何か出していれば出さない。短い相づちにも出さない', () => {
  const d = createDirector()
  d.onAnswer(reading({ cue: { bishi: 0.9 } }), ctx(1000, { source: 'interim', uttId: 3 }), 1000)
  assert.deepStrictEqual(oneshots(d.onAnswer(reading(), ctx(1600, { uttId: 3 }), 1600)), [], '字幕が伸びた時点でビシッ! を出している')
  assert.deepStrictEqual(oneshots(createDirector().onAnswer(reading(), ctx(1000, { text: 'はい' }), 1000)), [])
  assert.deepStrictEqual(oneshots(createDirector().onAnswer(reading(), ctx(1000, { text: 'えーっと、まあ、その' }), 1000)).length, 1, '4 文字あれば出す')
  assert.deepStrictEqual(oneshots(createDirector({ everyUtterance: false }).onAnswer(reading(), ctx(1000), 1000)), [], '切ることもできる')
})

test('代わりの演出も、連発の抑制は守る。同じ擬音を出したばかりならテロップに回し、前のテロップが出ているあいだは出さない', () => {
  const d = createDirector()
  const faint = reading({ cue: { don: 0.29 }, noul: 0.4, heat: 0 })
  assert.strictEqual(d.onAnswer(faint, ctx(0, { uttId: 1 }), 0).verdict.cue.reason, 'fallback')
  const second = d.onAnswer(faint, ctx(3000, { uttId: 2, text: 'ドンは出したばかり' }), 3000)
  assert.strictEqual(second.verdict.cue.fired, false)
  assert.strictEqual(second.verdict.telop.reason, 'fallback')
  const third = d.onAnswer(reading(), ctx(3500, { uttId: 3, text: '前のテロップがまだ出ている' }), 3500)
  assert.deepStrictEqual(oneshots(third), [])
})

test('既定では、どの効果も 3 秒まで。擬音とテロップは表示時間に上限があり、ムードは 2.4 秒で切って 15 秒は入れない', () => {
  assert.strictEqual(dress(1, 100).ttlMs, 3000)
  assert.strictEqual(dress(0.5, 5).ttlMs, 1650, '上限に届かなければそのまま')
  const d = createDirector()
  const log = []
  for (let t = 0; t <= 20000; t += 300) {
    const events = ambient([...d.onAnswer(gloomy, utt(t), t).events, ...d.tick({ speaking: true, lastSpeechAt: t }, t + 100)])
    for (const e of events.filter((e) => e.includes('shades'))) log.push(`${t} ${e}`)
  }
  assert.deepStrictEqual(log.slice(0, 2), ['600 +shades/blue', '3000 -shades/blue'], '2.4 秒で切る')
  assert.match(log[2], /^18\d\d\d \+shades\/blue$/, '15 秒は入れない')
})

test('確定を待たなくても、字幕が止まって言い切っていれば、代わりの演出を出す。確定は 3 秒ほど遅れて届くので', () => {
  const neutral = reading({ complete: 0.9 })
  const d = createDirector()
  const paused = d.onAnswer(neutral, ctx(1000, { source: 'pause', text: 'まず箱から出して、ケーブルをつなぎます' }), 1000)
  assert.strictEqual(paused.verdict.telop.reason, 'fallback')
  assert.deepStrictEqual(oneshots(d.onAnswer(neutral, ctx(4000, { source: 'final', text: 'まず箱から出して、ケーブルをつなぎます' }), 4000)), [], '遅れて届いた確定では出さない')
  const cut = createDirector().onAnswer(reading({ complete: 0.3 }), ctx(1000, { source: 'pause' }), 1000)
  assert.deepStrictEqual(oneshots(cut), [], '言い切っていなければ待つ')
  const grown = createDirector().onAnswer(neutral, ctx(1000, { source: 'pause', unchanged: false }), 1000)
  assert.deepStrictEqual(oneshots(grown), [], '答えを待つあいだに字幕が伸びていたら待つ')
})
