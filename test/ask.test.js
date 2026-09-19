import test from 'node:test'
import assert from 'node:assert'
import { buildQuestions, buildState, fuse, heatOf, readAnswers } from '../src/ask.js'
import { ACTIVE_MOOD_IDS, CUE_IDS, FIREABLE_CUE_IDS, HEAT_LEVELS, MOOD_IDS, STYLE_IDS } from '../src/effects.js'

test('問いは choice 3 つと、none を除く項目ごとの noul と、オチ・言い切り・乏しさ・熱量', () => {
  const q = buildQuestions()
  assert.strictEqual(Object.keys(q).length, 3 + FIREABLE_CUE_IDS.length + ACTIVE_MOOD_IDS.length + 4)
  assert.deepStrictEqual(Object.keys(q.cue.criteria), CUE_IDS)
  assert.deepStrictEqual(Object.keys(q.mood.criteria), MOOD_IDS)
  assert.deepStrictEqual(Object.keys(q.telop_style.criteria), STYLE_IDS)
  assert.strictEqual(q.cue_none, undefined, 'none には聞かない')
  assert.strictEqual(q.mood_none, undefined)
  assert.strictEqual(q.cue_don.type, 'noul')
  assert.deepStrictEqual(Object.keys(q.punchline.criteria), ['true', 'false'])
  assert.strictEqual(q.heat.type, 'score')
  assert.deepStrictEqual(q.heat.criteria, HEAT_LEVELS, 'score の criteria は順序つきの配列')
})

test('判定の対象は 1 つ。話している途中ならその字幕で、確定した行は背景に回る', () => {
  const speaking = buildState({ earlier: '前の話', latest: 'さっきのオチ', speakingNow: '次の話を' }, { pace: 'fast', pause_before: 'none' })
  assert.deepStrictEqual(speaking.transcript, { context: '前の話 さっきのオチ', focus: '次の話を', focus_status: 'still being spoken, may be cut off' })
  assert.deepStrictEqual(speaking.delivery, { pace: 'fast', pause_before: 'none' })
  assert.strictEqual(buildState({ speakingNow: '次の話を' }, {}, { paused: true }).transcript.focus_status, 'the speaker paused here, probably finished')
  const finished = buildState({ earlier: '前の話', latest: 'さっきのオチ', speakingNow: '' })
  assert.deepStrictEqual(finished.transcript, { context: '前の話', focus: 'さっきのオチ', focus_status: 'just finished' })
  assert.deepStrictEqual(finished.delivery, { pace: 'unknown', pause_before: 'unknown' })
  assert.strictEqual(buildState({}).transcript.focus, '(nothing yet)')
})

test('choice で勝っていても、noul が低ければ強さは下がる。noul が返らなければそのまま通す', () => {
  const s = fuse({ a: 0.9, b: 0.1 }, { a: 0.15, b: 0.9 }, ['a', 'b'])
  assert.ok(Math.abs(s.a - 0.9 * 0.25) < 1e-9)
  assert.strictEqual(s.b, 0.1)
  assert.strictEqual(fuse({ a: 0.9 }, { a: null }, ['a']).a, 0.9)
})

test('答えを読む。いちばん強い cue と mood、様式、オチ、熱量', () => {
  const r = readAnswers({
    cue: { probabilities: { none: 0.1, don: 0.2, bishi: 0.7 } },
    cue_bishi: { noul: 0.9 },
    cue_don: { noul: 0.1 },
    mood: { probabilities: { none: 0.8, gloom: 0.2 } },
    telop_style: { probabilities: { tsukkomi: 0.6, plain: 0.4 } },
    punchline: { noul: 0.8 },
    complete: { noul: 0.7 },
    too_thin: { noul: 0.1 },
    heat: { score: 3, probabilities: [0, 0, 0, 1, 0] },
  })
  assert.strictEqual(r.cue.top, 'bishi')
  assert.ok(Math.abs(r.cue.strength.bishi - 0.7) < 1e-9)
  assert.strictEqual(r.mood.top, 'none')
  assert.strictEqual(r.style, 'tsukkomi')
  assert.strictEqual(r.punchline, 0.8)
  assert.strictEqual(r.heat, 0.75)
})

test('熱量は、配列の分布でも、番号キーの分布でも、点の推定値だけでも読める', () => {
  assert.strictEqual(heatOf({ probabilities: [0, 0, 0, 0, 1] }).heat, 1)
  assert.strictEqual(heatOf({ probabilities: { 0: 0.5, 4: 0.5 } }).heat, 0.5)
  assert.strictEqual(heatOf({ score: 1 }).heat, 0.25)
  assert.strictEqual(heatOf(undefined).heat, null)
})

test('答えが空でも例外にせず、何も出さない側に倒す', () => {
  const r = readAnswers({})
  assert.strictEqual(r.cue.top, 'none')
  assert.strictEqual(r.mood.top, 'none')
  assert.strictEqual(r.style, 'plain')
  assert.strictEqual(r.punchline, 0)
  assert.strictEqual(r.heat, 0.5)
  assert.doesNotThrow(() => readAnswers(undefined))
})
