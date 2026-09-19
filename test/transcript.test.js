import test from 'node:test'
import assert from 'node:assert'
import { createTranscript } from '../src/transcript.js'

test('確定した字幕を積み、認識途中の字幕は上書きする。確定したら途中のものは消える', () => {
  const t = createTranscript()
  t.setInterim('お腹')
  t.setInterim('お腹すい')
  assert.strictEqual(t.interim, 'お腹すい')
  const line = t.addFinal(' お腹すいた ', 1000)
  assert.deepStrictEqual(line, { id: 1, text: 'お腹すいた', t: 1000 })
  assert.strictEqual(t.interim, '')
  assert.strictEqual(t.addFinal('   ', 1100), null)
  assert.strictEqual(t.lines.length, 1)
})

test('窓には新しい行から、時間と文字数の範囲で入る', () => {
  const t = createTranscript({ maxAgeMs: 10000, maxChars: 12 })
  t.addFinal('あいうえお', 0)
  t.addFinal('かきくけこ', 8000)
  t.addFinal('さしすせそ', 9000)
  t.setInterim('たち')
  assert.deepStrictEqual(t.window(9500), { earlier: 'かきくけこ', latest: 'さしすせそ', speakingNow: 'たち', usedIds: [2, 3], uttId: 4, focusChars: 2 })
  assert.deepStrictEqual(t.window(19500).usedIds, [3], '古くなっても最新の 1 行は残す')
})

test('最新の 1 行や認識途中の字幕が長すぎれば末尾だけを渡す', () => {
  const t = createTranscript({ maxChars: 5 })
  t.addFinal('あいうえおかきくけこ', 0)
  t.setInterim('さしすせそたちつてと')
  assert.strictEqual(t.window(0).latest, 'かきくけこ')
  assert.strictEqual(t.window(0).speakingNow, 'たちつてと')
  assert.strictEqual(t.interim, 'さしすせそたちつてと', '画面に出す字幕は切らない')
})

test('何も話していなければ空', () => {
  assert.deepStrictEqual(createTranscript().window(0), { earlier: '', latest: '', speakingNow: '', usedIds: [], uttId: 0, focusChars: 0 })
})

test('認識途中の字幕の発話 id は、その確定が取る id と同じになる', () => {
  const t = createTranscript()
  t.addFinal('一つ目', 0)
  assert.strictEqual(t.window(0).uttId, 1)
  t.setInterim('二つ', 500)
  assert.strictEqual(t.window(500).uttId, 2)
  t.addFinal('   ', 600)
  t.setInterim('二つ目', 700)
  assert.strictEqual(t.window(700).uttId, 2, '空の確定は id を使わない')
  assert.strictEqual(t.addFinal('二つ目', 900).id, 2)
  assert.strictEqual(t.window(900).uttId, 2)
})

test('認識途中の字幕が止まってからの時間を数える。同じ字幕が届いても止まったままとみなす', () => {
  const t = createTranscript()
  assert.strictEqual(t.interimStableMs(100), 0)
  t.setInterim('なんで', 1000)
  t.setInterim('なんでやねん', 1200)
  t.setInterim('なんでやねん', 1400)
  assert.strictEqual(t.interimStableMs(1600), 400)
  t.addFinal('なんでやねん', 1700)
  assert.strictEqual(t.interimStableMs(1800), 0)
})

test('話す速さは、発話が 5 回たまるまで unknown。その後は本人の中央値と比べる', () => {
  const t = createTranscript()
  let now = 0
  const say = (text, ms, gap = 1000) => {
    now += gap
    t.setInterim(text.slice(0, 1), now)
    now += ms
    return t.addFinal(text, now)
  }
  for (let i = 0; i < 5; i++) {
    say('あいうえおかきくけこ', 2000) // 5 文字/秒
    assert.strictEqual(t.delivery(now).pace, 'unknown')
  }
  say('あいうえおかきくけこ', 1000) // 10 文字/秒
  assert.deepStrictEqual(t.delivery(now), { pace: 'fast', pause_before: 'short' })
  say('あいうえおかきくけこ', 4000, 3000)
  assert.deepStrictEqual(t.delivery(now), { pace: 'slow', pause_before: 'long' })
  t.setInterim('あ', now + 100)
  assert.strictEqual(t.delivery(now + 150).pause_before, 'none')
})

test('文字で打ち込んだ発話（途中の字幕なし）では、話し方は unknown のまま', () => {
  const t = createTranscript()
  t.addFinal('こんにちは', 1000)
  assert.deepStrictEqual(t.delivery(1000), { pace: 'unknown', pause_before: 'unknown' })
})
