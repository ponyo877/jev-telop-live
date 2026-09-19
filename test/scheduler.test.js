import test from 'node:test'
import assert from 'node:assert'
import { createScheduler } from '../src/scheduler.js'

const send = (s, now) => {
  const due = s.due(now)
  if (due) s.note({ type: 'sent', source: due.source }, now)
  return due?.source ?? null
}

test('確定はすぐ聞く。飛行中の要求があっても待たない', () => {
  const s = createScheduler()
  s.note({ type: 'interim', text: 'なんでやねんと' }, 0)
  assert.strictEqual(send(s, 0), 'interim')
  s.note({ type: 'final' }, 100)
  assert.strictEqual(send(s, 100), 'final', '最短間隔も、応答待ちも無視する')
  assert.strictEqual(send(s, 101), null)
})

test('認識途中の字幕は、4 文字以上変わり、かつ 600ms たったら聞く', () => {
  const s = createScheduler()
  s.note({ type: 'interim', text: 'あいうえ' }, 0)
  assert.strictEqual(send(s, 0), 'interim')
  s.note({ type: 'done' }, 250)
  s.note({ type: 'interim', text: 'あいうえおか' }, 300)
  assert.strictEqual(s.due(600), null, '2 文字しか伸びていない')
  s.note({ type: 'interim', text: 'あいうえおかきく' }, 400)
  assert.strictEqual(s.due(500), null, 'まだ 600ms たっていない')
  assert.strictEqual(s.wakeAt(500), 600)
  assert.strictEqual(send(s, 600), 'interim')
})

test('音声認識が前のほうを書き直したら、長さが同じでも変わったとみなす', () => {
  const s = createScheduler({ pauseMs: 100000 })
  s.note({ type: 'interim', text: '橋を渡る' }, 0)
  send(s, 0)
  s.note({ type: 'done' }, 200)
  s.note({ type: 'interim', text: '箸を渡す' }, 300)
  assert.strictEqual(send(s, 700), 'interim')
})

test('字幕が 350ms 止まったら、確定を待たずに 1 回だけ聞く', () => {
  const s = createScheduler()
  s.note({ type: 'interim', text: 'えっ' }, 1000)
  assert.strictEqual(s.due(1200), null)
  assert.strictEqual(s.wakeAt(1200), 1350)
  assert.strictEqual(send(s, 1350), 'pause')
  s.note({ type: 'done' }, 1600)
  s.note({ type: 'interim', text: 'えっ' }, 1700)
  assert.strictEqual(s.due(5000), null, '同じ字幕では二度聞かない')
})

test('認識途中の字幕では 1 本しか飛ばさない。もう 1 本は確定のために空けておく', () => {
  const s = createScheduler()
  s.note({ type: 'interim', text: 'あいうえお' }, 0)
  send(s, 0)
  s.note({ type: 'interim', text: 'あいうえおかきくけこ' }, 700)
  assert.strictEqual(s.due(700), null)
  assert.strictEqual(s.wakeAt(700), null, '応答待ち')
  s.note({ type: 'done' }, 800)
  assert.strictEqual(send(s, 800), 'interim')
})

test('429 が返ったら間隔を倍にし、10 秒静かなら元に戻す', () => {
  const s = createScheduler()
  s.note({ type: 'interim', text: 'あいうえお' }, 0)
  send(s, 0)
  s.note({ type: 'done', status: 429 }, 100)
  assert.strictEqual(s.gapMs, 1000)
  s.note({ type: 'final' }, 200)
  assert.strictEqual(s.due(200), null, '間隔を広げているあいだは確定も従う')
  assert.strictEqual(send(s, 1000), 'final')
  s.note({ type: 'done', status: 429 }, 1100)
  assert.strictEqual(s.gapMs, 2000)
  s.due(11200)
  assert.strictEqual(s.gapMs, 500)
})

test('過負荷（529）でも、レート制限と同じく間隔を広げる', () => {
  const s = createScheduler()
  s.note({ type: 'final' }, 0)
  send(s, 0)
  s.note({ type: 'done', status: 529 }, 100)
  assert.strictEqual(s.gapMs, 1000)
  s.note({ type: 'done', status: 500 }, 200)
  assert.strictEqual(s.gapMs, 1000, 'ほかの失敗では広げない')
})

test('安全弁: 1 分あたりの上限を超えたら聞かない', () => {
  const s = createScheduler({ perMinute: 3 })
  for (let i = 0; i < 3; i++) {
    s.note({ type: 'final' }, i * 1000)
    assert.strictEqual(send(s, i * 1000), 'final')
    s.note({ type: 'done' }, i * 1000 + 100)
  }
  s.note({ type: 'final' }, 3000)
  assert.strictEqual(s.due(3000), null)
  assert.strictEqual(s.wakeAt(3000), 60000)
  assert.strictEqual(send(s, 60000), 'final')
  assert.strictEqual(s.callsPerMinute(60000), 3)
})
