import test from 'node:test'
import assert from 'node:assert'
import { VOICE } from '../src/effects.js'
import * as params from '../src/audio/voice-params.js'

const { VOICE_FX, distortionDrive, distortionPostGain, echoFeedback, makeDistortionCurve, makeImpulse, ratioFor, robotCarrierHz } = params

const STEPS = [0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1]
const rms = (x) => Math.sqrt(x.reduce((s, v) => s + v * v, 0) / x.length)

test('閉集合の声エフェクトはすべて表にあり、表に余計な id は無い', () => {
  assert.deepStrictEqual(Object.keys(VOICE_FX).sort(), [...VOICE].sort())
  for (const id of VOICE) assert.ok(['timbre', 'space'].includes(VOICE_FX[id].stage), id)
  assert.strictEqual(VOICE_FX.echo.stage, 'space', 'echo は声色に重ねられる')
})

test('歪みカーブは奇対称で、単調に増え、±1 に収まる', () => {
  for (const amount of [0, 0.5, 3, 12, 50]) {
    for (const n of [2048, 257]) {
      const curve = makeDistortionCurve(amount, n)
      assert.strictEqual(curve.length, n)
      for (let i = 0; i < n; i++) {
        assert.ok(curve[i] === -curve[n - 1 - i], `amount ${amount} の ${i} 番目が対称でない`)
        assert.ok(Math.abs(curve[i]) <= 1)
        if (i > 0) assert.ok(curve[i] >= curve[i - 1], `amount ${amount} の ${i} 番目で下がった`)
      }
      assert.strictEqual(curve[n - 1], 1, '端まで振ったら 1 に届く')
      const mid = Math.floor(n / 2)
      assert.ok(curve[mid + 8] > curve[mid - 8], '中央では平らにならない')
    }
  }
})

test('膝が硬いほど、小さい入力を大きく持ち上げる', () => {
  const at = (amount) => makeDistortionCurve(amount)[1024 + 205] // x ≈ 0.2
  assert.ok(Math.abs(at(0) - 0.2) < 0.01, 'amount 0 はほぼ直線')
  assert.ok(at(3) > at(0.5) && at(12) > at(3))
})

test('インパルスは減衰し、同じ種なら同じ結果になる', () => {
  const impulse = makeImpulse(48000, 1.5, 3, 7)
  assert.strictEqual(impulse.length, 72000)
  assert.ok(impulse.every((v) => Number.isFinite(v) && Math.abs(v) <= 1))
  const quarter = impulse.length / 4
  const parts = [0, 1, 2, 3].map((i) => rms(impulse.subarray(i * quarter, (i + 1) * quarter)))
  assert.ok(parts[0] > parts[1] && parts[1] > parts[2] && parts[2] > parts[3], parts.map((v) => v.toFixed(3)).join(' > '))
  assert.deepStrictEqual(makeImpulse(48000, 1.5, 3, 7), impulse)
  assert.notDeepStrictEqual(makeImpulse(48000, 1.5, 3, 8), impulse)
})

test('ratioFor は決めた範囲の中を単調に動く。pitch 系でなければ 1', () => {
  const up = STEPS.map((i) => ratioFor('pitch_up', i))
  const down = STEPS.map((i) => ratioFor('pitch_down', i))
  assert.ok(Math.abs(up[0] - 1.35) < 1e-9 && Math.abs(up.at(-1) - 1.7) < 1e-9)
  assert.ok(Math.abs(down[0] - 0.8) < 1e-9 && Math.abs(down.at(-1) - 0.62) < 1e-9)
  for (let i = 1; i < STEPS.length; i++) {
    assert.ok(up[i] > up[i - 1], '強いほど高く')
    assert.ok(down[i] < down[i - 1], '強いほど低く')
  }
  for (const id of ['robot', 'distortion', 'echo', 'nope']) assert.strictEqual(ratioFor(id, 0.8), 1)
})

test('範囲の外や数でない intensity でも、ワークレットの受け付ける 0.5〜2 からはみ出さない', () => {
  for (const intensity of [-5, 9, NaN, undefined, Infinity]) {
    for (const id of ['pitch_up', 'pitch_down']) {
      const ratio = ratioFor(id, intensity)
      assert.ok(ratio >= 0.5 && ratio <= 2, `${id} ${intensity}: ${ratio}`)
    }
  }
  assert.strictEqual(ratioFor('pitch_up', 9), ratioFor('pitch_up', 1))
})

test('ロボット・歪み・エコーの強さも範囲の中を単調に動く', () => {
  assert.deepStrictEqual([robotCarrierHz(0), robotCarrierHz(1)], [45, 90])
  assert.deepStrictEqual([distortionDrive(0), distortionDrive(1)], [4, 30])
  assert.ok(Math.abs(echoFeedback(0) - 0.3) < 1e-9 && Math.abs(echoFeedback(1) - 0.6) < 1e-9)
  assert.ok(echoFeedback(99) < 1, 'フィードバックが 1 に届くと発振する')
  assert.ok(distortionPostGain(30) < distortionPostGain(4), '強く歪ませるほど出口で絞る')
})
