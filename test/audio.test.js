import test from 'node:test'
import assert from 'node:assert'
import { createAudio } from '../src/audio/audio.js'
import { sampleId } from '../src/audio/se.js'

test('差し替え用のファイル名から SE の id が取れる', () => {
  assert.strictEqual(sampleId('don.wav'), 'don')
  assert.strictEqual(sampleId('laugh.mp3'), 'laugh')
  assert.strictEqual(sampleId('laugh-2.mp3'), 'laugh')
  assert.strictEqual(sampleId('laugh-12.ogg'), 'laugh')
  assert.strictEqual(sampleId('heartbeat-3.m4a'), 'heartbeat')
})

test('resume より前に何を呼んでも例外を出さず、何も鳴らさない', async () => {
  const audio = createAudio()
  assert.strictEqual(audio.playSe('don', { heat: 0.9, gain: 0.8 }), false)
  assert.strictEqual(audio.playSe('don'), false)
  assert.strictEqual(audio.playSe('don', null), false)
  assert.strictEqual(audio.playSe('nope'), false)
  audio.setVoice('robot', true, 0.7)
  audio.setVoice('echo', true)
  audio.setVoice('nope', true)
  audio.setVoice('robot', false)
  audio.setMonitor(true)
  audio.setSeVolume(0.4)
  assert.strictEqual(await audio.setSink('default'), false)
  assert.strictEqual(await audio.openMic(null), false)
  assert.strictEqual(await audio.loadSamples(['don.wav', 'laugh-2.mp3']), 0)
  assert.strictEqual(audio.level(), 0)
  assert.strictEqual(audio.speaking(), false)
  assert.deepStrictEqual(audio.state(), { running: false, mic: false, voices: [], monitor: true, latencyMs: 0, seBusyUntil: 0 })
})

test('AudioContext の無い環境では resume が false を返すだけ', () => {
  const audio = createAudio()
  assert.strictEqual(audio.resume(), false)
  assert.strictEqual(audio.state().running, false)
})
