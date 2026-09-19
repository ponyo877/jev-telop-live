import test from 'node:test'
import assert from 'node:assert'
import { MIME_CANDIDATES, displayOptions, formatElapsed, pickMimeType, recordingName } from '../src/recorder.js'

test('保存する形式は、対応していれば mp4、だめなら webm。どれも無ければブラウザに任せる', () => {
  assert.match(pickMimeType(() => true), /^video\/mp4/)
  assert.strictEqual(pickMimeType((mime) => mime.startsWith('video/webm')), 'video/webm;codecs=vp9,opus')
  assert.strictEqual(pickMimeType((mime) => mime === 'video/webm'), 'video/webm')
  assert.strictEqual(pickMimeType(() => false), '')
  assert.ok(MIME_CANDIDATES.every((mime) => /^video\/(mp4|webm)/.test(mime)))
})

test('ファイル名は日時つきで、拡張子は形式に合わせる', () => {
  const at = new Date(2026, 8, 19, 10, 5, 3)
  assert.strictEqual(recordingName(at, 'video/mp4;codecs=avc1.42E01E,mp4a.40.2'), 'jev-live-20260919-100503.mp4')
  assert.strictEqual(recordingName(at, 'video/webm;codecs=vp9,opus'), 'jev-live-20260919-100503.webm')
  assert.strictEqual(recordingName(at, ''), 'jev-live-20260919-100503.webm')
})

test('経過時間は 分:秒', () => {
  assert.deepStrictEqual([0, 999, 1000, 65000, 600000, -5].map(formatElapsed), ['0:00', '0:00', '0:01', '1:05', '10:00', '0:00'])
})

test('画面共有の指定。ウィンドウは自分のブラウザも選べるようにし、タブは今のタブを優先する。音は頼まない（自前で混ぜる）', () => {
  const win = displayOptions('window')
  assert.strictEqual(win.video.displaySurface, 'window')
  assert.strictEqual(win.selfBrowserSurface, 'include')
  assert.strictEqual(win.audio, false)
  const tab = displayOptions('tab')
  assert.strictEqual(tab.preferCurrentTab, true)
  assert.strictEqual(tab.audio, false)
})
