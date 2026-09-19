import test from 'node:test'
import assert from 'node:assert'
import { createPipeline } from '../src/pipeline.js'

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
// 代わりの演出が混ざらないようにして、経路そのものを確かめる
const STRICT = { director: { everyUtterance: false } }

/** focus を見て答える偽の Jev。「なんでやねん」で言い切っていればツッコミとオチ、それ以外は何も無し。 */
function fakeJev({ delayMs = 20 } = {}) {
  const seen = []
  const ask = async ({ state, questions }) => {
    seen.push({ state, questions })
    await sleep(delayMs)
    const hit = state.transcript.focus.endsWith('なんでやねん')
    return {
      answers: {
        cue: { probabilities: hit ? { none: 0.05, bishi: 0.95 } : { none: 1 } },
        cue_bishi: { noul: hit ? 0.95 : 0.05 },
        mood: { probabilities: { none: 1 } },
        telop_style: { probabilities: { tsukkomi: 1 } },
        punchline: { noul: hit ? 0.9 : 0.1 },
        complete: { noul: hit ? 0.9 : 0.2 },
        too_thin: { noul: 0.1 },
        heat: { score: 3 },
      },
      usage: { cost: 0.0001 },
      latencyMs: delayMs,
      hedged: false,
    }
  }
  return { ask, seen }
}

test('確定した字幕を Jev に聞き、答えを演出イベントにして流す', async () => {
  const jev = fakeJev()
  const events = []
  const answers = []
  const p = createPipeline({ ask: jev.ask, onEvents: (e) => events.push(...e), onAnswer: (a) => answers.push(a), options: STRICT })
  p.final('今日はキーボードの話をします')
  await sleep(80)
  assert.strictEqual(jev.seen.length, 1)
  assert.strictEqual(jev.seen[0].state.transcript.focus, '今日はキーボードの話をします')
  assert.strictEqual(jev.seen[0].state.transcript.focus_status, 'just finished')
  assert.strictEqual(Object.keys(jev.seen[0].questions).length, Object.keys(p.questions).length)
  assert.deepStrictEqual(events, [])
  assert.strictEqual(answers[0].verdict.cue.reason, 'none')

  await sleep(250) // 確定が立て続けに来たときは、間隔を空けて聞く
  p.final('いやなんでやねん')
  await sleep(80)
  assert.strictEqual(events.length, 1)
  assert.strictEqual(events[0].cue, 'bishi')
  assert.deepStrictEqual(events[0].telop, { text: 'いやなんでやねん', style: 'tsukkomi' })
  assert.strictEqual(events[0].layers.se, 'slap')
  assert.strictEqual(jev.seen[1].state.transcript.context, '今日はキーボードの話をします')
  p.stop()
})

test('字幕が伸びた時点で擬音を出し、止まったら確定を待たずに発話テロップを出す。確定では何も出さない', async () => {
  const jev = fakeJev()
  const events = []
  const answers = []
  const p = createPipeline({ ask: jev.ask, onEvents: (e) => events.push(...e), onAnswer: (a) => answers.push(a), options: STRICT })
  p.interim('いやなんでやねん')
  await sleep(100)
  assert.deepStrictEqual(events.map((e) => [e.source, e.cue, e.telop?.text ?? null]), [['interim', 'bishi', null]], '伸びている最中の字幕ではテロップは出さない')
  assert.strictEqual(jev.seen[0].state.transcript.focus_status, 'still being spoken, may be cut off')
  await sleep(600)
  assert.deepStrictEqual(events.slice(1).map((e) => [e.source, e.cue, e.telop?.text ?? null, e.layers.se]), [['pause', null, 'いやなんでやねん', null]], 'SE は擬音で鳴らしたばかりなので重ねない')
  assert.strictEqual(jev.seen[1].state.transcript.focus_status, 'the speaker paused here, probably finished')
  p.final('いやなんでやねん')
  await sleep(80)
  assert.strictEqual(events.length, 2, '確定では出さない')
  assert.strictEqual(answers.at(-1).verdict.cue.reason, 'same-utterance')
  assert.strictEqual(answers.at(-1).verdict.telop.reason, 'same-utterance')
  p.stop()
})

test('確定を聞くときは、もう次の発話が始まっていても、確定した行を判定の対象にする', async () => {
  const jev = fakeJev()
  const p = createPipeline({ ask: jev.ask })
  p.final('いやなんでやねん')
  p.interim('それでですね')
  await sleep(60)
  const finals = jev.seen.filter((s) => s.state.transcript.focus_status === 'just finished')
  assert.strictEqual(finals[0].state.transcript.focus, 'いやなんでやねん')
  p.stop()
})

test('消したあとに届いた答えは捨てる。キーの問題が起きたら聞くのをやめる', async () => {
  const jev = fakeJev({ delayMs: 60 })
  const events = []
  const p = createPipeline({ ask: jev.ask, onEvents: (e) => events.push(...e) })
  p.final('いやなんでやねん')
  await sleep(10)
  p.reset()
  await sleep(120)
  assert.deepStrictEqual(events, [])
  p.stop()

  let calls = 0
  const errors = []
  const broken = createPipeline({
    ask: async () => {
      calls++
      throw Object.assign(new Error('The API key did not work.'), { status: 401, fatal: true })
    },
    onError: (err) => errors.push(err.message),
  })
  broken.final('一つ目')
  await sleep(30)
  broken.final('二つ目')
  await sleep(30)
  assert.strictEqual(calls, 1)
  assert.deepStrictEqual(errors, ['The API key did not work.'])
  broken.stop()
})

test('手動発火は、Jev に聞かずにそのまま流す', () => {
  const events = []
  const p = createPipeline({ ask: async () => assert.fail('聞いてはいけない'), onEvents: (e) => events.push(...e) })
  p.force('don', 0.9)
  p.force(null, 0.5, { text: 'テスト', style: 'impact' })
  assert.deepStrictEqual(events.map((e) => [e.cue, e.telop?.text ?? null, e.source]), [['don', null, 'manual'], [null, 'テスト', 'manual']])
  p.stop()
})

test('既定では、ふつうの話にも何か出す。確定した発話を、そのままテロップにする', async () => {
  const jev = fakeJev()
  const events = []
  const p = createPipeline({ ask: jev.ask, onEvents: (e) => events.push(...e) })
  p.final('今日はキーボードの話をします')
  await sleep(80)
  assert.deepStrictEqual(events.map((e) => [e.cue, e.telop?.text]), [[null, '今日はキーボードの話をします']])
  p.stop()
})
