import test from 'node:test'
import assert from 'node:assert'
import { isVirtualMic } from '../src/stage/camera.js'

test('音を出さない仮想の入力を、名前で見分ける', () => {
  for (const label of ['Background Music (Virtual)', 'Background Music (UI Sounds) (Virtual)', 'BlackHole 2ch', 'Loopback Audio', 'Soundflower (2ch)']) assert.ok(isVirtualMic(label), label)
  for (const label of ['MacBook Airのマイク (Built-in)', '既定 - MacBook Airのマイク (Built-in)', 'AirPods Pro', 'USB Audio Device', '']) assert.ok(!isVirtualMic(label), label)
})
