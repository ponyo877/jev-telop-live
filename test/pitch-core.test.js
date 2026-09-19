import test from 'node:test'
import assert from 'node:assert'
import { createShifter } from '../src/audio/pitch-core.js'

const SR = 48000
const WINDOW_SEC = 0.045
/** 窓 1 周ぶんは立ち上がり（リングがまだ空）なので、測るときは飛ばす。 */
const SKIP = Math.round(SR * 0.1)

function sine(hz, seconds, amp = 0.5) {
  const out = new Float32Array(Math.round(SR * seconds))
  for (let i = 0; i < out.length; i++) out[i] = amp * Math.sin((2 * Math.PI * hz * i) / SR)
  return out
}

function shift(input, ratio, block = input.length) {
  const shifter = createShifter(SR, WINDOW_SEC)
  const output = new Float32Array(input.length)
  for (let i = 0; i < input.length; i += block) shifter.process(input.subarray(i, i + block), output.subarray(i, i + block), ratio)
  return output
}

const rms = (x, from = 0) => Math.sqrt(x.subarray(from).reduce((s, v) => s + v * v, 0) / (x.length - from))

/** 負から正への零交差を数えて周波数にする。 */
function frequency(x, from = SKIP) {
  let crossings = 0
  for (let i = from + 1; i < x.length; i++) if (x[i - 1] < 0 && x[i] >= 0) crossings++
  return (crossings * SR) / (x.length - from)
}

test('ratio 1 なら、窓の半分だけ遅れて振幅はそのまま出てくる', () => {
  const input = sine(220, 1)
  const output = shift(input, 1)
  assert.ok(Math.abs(rms(output, SKIP) / rms(input, SKIP) - 1) < 0.01)
  const delay = (WINDOW_SEC * SR) / 2
  for (let i = SKIP; i < input.length; i += 97) assert.ok(Math.abs(output[i] - input[i - delay]) < 1e-6, `${i} サンプル目`)
})

test('220Hz を ratio 1.5 にかけると 330Hz になる', () => {
  const output = shift(sine(220, 2), 1.5)
  const hz = frequency(output)
  assert.ok(Math.abs(hz / 330 - 1) < 0.04, `${hz.toFixed(1)} Hz`)
})

test('220Hz を ratio 0.7 にかけると 154Hz に下がる', () => {
  const output = shift(sine(220, 2), 0.7)
  const hz = frequency(output)
  assert.ok(Math.abs(hz / 154 - 1) < 0.04, `${hz.toFixed(1)} Hz`)
})

test('音程を動かしても音量は大きく変わらない', () => {
  const input = sine(220, 2)
  for (const ratio of [0.62, 0.8, 1.35, 1.7]) {
    const gain = rms(shift(input, ratio), SKIP) / rms(input, SKIP)
    assert.ok(gain > 0.6 && gain < 1.1, `ratio ${ratio}: ${gain.toFixed(2)} 倍`)
  }
})

test('おかしな ratio や入力でも NaN を出さない', () => {
  const input = sine(220, 0.5)
  for (const ratio of [0.5, 1, 2, 0, -3, 100, NaN, Infinity, undefined]) {
    assert.ok(shift(input, ratio).every(Number.isFinite), `ratio ${ratio}`)
  }
  const broken = sine(220, 0.5)
  broken[1000] = NaN
  broken[2000] = Infinity
  assert.ok(shift(broken, 1.5).every(Number.isFinite), '入力に NaN が混じっても広げない')
})

test('128 サンプル刻みで呼んでも、一括で呼んでも結果は同じ', () => {
  const input = sine(220, 0.5)
  for (const ratio of [0.7, 1.5]) {
    const whole = shift(input, ratio)
    const blocks = shift(input, ratio, 128)
    let differ = 0
    for (let i = 0; i < whole.length; i++) if (whole[i] !== blocks[i]) differ++
    assert.strictEqual(differ, 0, `ratio ${ratio}`)
  }
})
