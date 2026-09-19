// 画面の制御。字幕を pipeline に渡し、出てきた演出を画面と音へ流し、パネルを描き直す。
// 判断の中身はここに置かない。字幕から演出までの経路は src/pipeline.js にあり、sim/live.js と共有している。

import { top } from './ask.js'
import { createAudio } from './audio/audio.js'
import { createBus } from './bus.js'
import { CUES, CUE_BY_ID, FIREABLE_CUE_IDS, LAYERS, STYLE_IDS } from './effects.js'
import { askJev } from './jev.js'
import { createMedia } from './media.js'
import { createPipeline } from './pipeline.js'
import { SURFACES, createRecorder, formatElapsed } from './recorder.js'
import { listMics, openCamera, openMicOnly, openStill } from './stage/camera.js'
import { createStage } from './stage/stage.js'

const $ = (id) => document.getElementById(id)
const params = new URLSearchParams(location.search)

const SHOWN_LINES = 5
const CUE_ROWS = 5
const MOOD_ROWS = 3
const TICK_MS = 100 // ムードを切る時刻の粒度。効果を 3 秒に収めるので、細かく見回る
const HEDGE_AFTER_MS = 600
const TIMEOUT_MS = 2500

const store = {
  get(key) {
    try {
      return localStorage.getItem(key)
    } catch {
      return null
    }
  },
  set(key, value) {
    try {
      localStorage.setItem(key, value)
    } catch {
      // 保存できなくても動作に支障はない
    }
  },
}

const bus = createBus()
const audio = createAudio()
const mirrored = params.has('mirror') ? params.get('mirror') !== '0' : store.get('jev-telop:mirror') !== '0'
const stage = createStage($('stage'), $('camera'), {
  scale: Math.min(2, Math.max(1, Number(params.get('scale')) || 1)),
  mirror: mirrored,
  still: params.get('still') === '1' ? true : null,
  pinned: params.get('shades') === '0' ? [] : ['sunglasses'],
})
const media = createMedia({ stage, audio })
const pipeline = createPipeline({
  // キーは server.js の中継が付ける
  ask: ({ state, questions }) =>
    askJev({ apiKey: '', url: '/api/decisions', state, questions, hedgeAfterMs: HEDGE_AFTER_MS, timeoutMs: TIMEOUT_MS, onLateUsage: addUsage }).then((res) => {
      addUsage(res.usage)
      return res
    }),
  onEvents: (events) => events.forEach((event) => bus.emit(event)),
  onAnswer: adopt,
  onError: (err) => ($('alert').textContent = err.message),
  onCaptions: renderCaptions,
})

let adopted = null // いまの判断のもとになった要求: { uttId, interim }
let started = false
const totals = { calls: 0, cost: 0, recent: [] }

bus.on((event) => {
  const refused = media.handle(event)
  if (refused) return
  if (event.kind === 'oneshot') $('announce').textContent = [event.layers.giongo, event.telop?.text].filter(Boolean).join(' ')
  renderChips()
})

// ---------- 開始 ----------

/** 状態は見出しの横に短く出す。詳しい理由（エラーの中身など）は title に入れ、マウスを載せると読めるようにする。 */
const setStatus = (id, text, state = '', detail = '') => {
  $(id).textContent = text
  $(id).dataset.state = state
  $(id).title = detail
}

async function start() {
  if (started) return
  started = true
  $('start-overlay').hidden = true
  // AudioContext はユーザー操作の中でしか始められない。await より前に呼ぶ
  audio.resume()
  setStatus('st-camera', '開いています…')
  setStatus('st-mic', '開いています…')
  setStatus('st-face', '待機中')
  const camera = params.get('camera') ? await openStill($('camera'), params.get('camera')) : await openCamera($('camera'), { micId: store.get('jev-telop:mic') || null })
  setStatus('st-camera', camera.video ? '映像あり' : 'なし', camera.video ? 'ok' : 'error', camera.errors.video)

  const status = await fetch('/api/status').then((res) => res.json()).catch(() => null)
  setStatus('st-face', '読み込み中…')
  const [mic, face] = await Promise.allSettled([
    camera.audio ? audio.openMic(camera.stream) : Promise.resolve(false),
    camera.video ? stage.loadFace(status?.vendor?.mediapipe ?? null) : Promise.resolve(false),
    audio.loadSamples(status?.assets?.se ?? []),
    stage.preloadFonts(CUES.flatMap((cue) => cue.giongo ?? [])),
  ])
  micLabel = mic.value ? (camera.micLabel ?? '') : ''
  setStatus('st-mic', mic.value ? '入力あり' : 'なし', mic.value ? 'ok' : 'error', mic.value ? micLabel : `${camera.errors.audio || 'マイクを開けません'}。声の加工は無効`)
  fillMics()
  if (!camera.video) setStatus('st-face', '無効', '', 'カメラが無いので、顔の効果は出ません')
  else if (!face.value) setStatus('st-face', '無効', 'error', '顔認識を読み込めません。顔の効果は出ません')
  if (params.get('voice') === '1') setMonitor(true)
  listSinks()
}
$('start-overlay').addEventListener('click', start)

// ---------- 字幕 ----------

function renderCaptions() {
  const list = $('caption-lines')
  list.replaceChildren()
  for (const line of pipeline.transcript.lines.slice(-SHOWN_LINES)) {
    const li = document.createElement('li')
    if (adopted && !adopted.interim && line.id === adopted.uttId) {
      li.className = 'used'
      const span = document.createElement('span')
      span.className = 'mark'
      span.textContent = line.text
      li.append(span)
    } else {
      li.textContent = line.text
    }
    list.append(li)
  }
  const interim = pipeline.transcript.interim
  if (interim) {
    const li = document.createElement('li')
    li.className = 'interim'
    // 認識途中の字幕は伸びていくので、聞いた時点で渡した部分だけに印を付ける
    const asked = adopted?.interim ?? ''
    if (asked && interim.startsWith(asked)) {
      const span = document.createElement('span')
      span.className = 'mark'
      span.textContent = asked
      li.append(span, interim.slice(asked.length))
    } else {
      li.textContent = interim
    }
    list.append(li)
  }
  if (!list.children.length) {
    const li = document.createElement('li')
    li.className = 'empty'
    li.textContent = '話しかけると、ここに字幕が出ます'
    list.append(li)
  }
}

const STT_TEXT = {
  off: ['なし', '音声認識を起動していません。入力欄から文字で試せます'],
  missing: ['未ビルド', 'npm run build:stt を実行してください'],
  starting: ['準備中…', ''],
  listening: ['● 聞いています', ''],
  error: ['停止', '音声認識が止まっています'],
}

function renderStt({ state, detail }) {
  const [text, note] = STT_TEXT[state] ?? [state, '']
  setStatus('stt-status', text, state, [note, detail].filter(Boolean).join(': '))
}

// ---------- Jev に聞く ----------

function addUsage(usage) {
  const now = performance.now()
  totals.calls++
  totals.cost += usage?.cost ?? 0
  totals.recent = [...totals.recent, { at: now, cost: usage?.cost ?? 0 }].filter((u) => now - u.at < 60000)
  $('fact-calls').textContent = `${totals.calls} 回（直近 1 分 ${pipeline.scheduler.callsPerMinute(now)} 回）`
  $('fact-cost').textContent = `$${totals.cost.toFixed(5)}`
  $('fact-hourly').textContent = `$${(totals.recent.reduce((sum, u) => sum + u.cost, 0) * 60).toFixed(2)}`
}

function adopt({ res, reading, verdict, ctx, state }) {
  // 出した理由、出さなかった理由。画面には出さないが、「判断されたのに出ない」を追えるようにコンソールには残す
  console.debug(`[telop] ${ctx.source} ${res.latencyMs}ms  cue ${verdict.cue.id} ${fmt(verdict.cue.strength)} → ${verdict.cue.reason}  telop ${fmt(verdict.telop.punchline)} → ${verdict.telop.reason}  「${ctx.text.slice(-20)}」`)
  adopted = { uttId: ctx.uttId, interim: ctx.interim }
  renderBars(cueRows, reading.cue, (id) => CUE_BY_ID[id].giongo?.[1] ?? 'なし')
  renderBars(moodRows, reading.mood, (id) => id)
  $('alert').textContent = ''
  $('moment').textContent = `オチ ${fmt(reading.punchline)} ／ 熱量 ${fmt(reading.heat)} ／ 材料の乏しさ ${fmt(reading.thin)}`
  $('fact-latency').textContent = `${res.latencyMs} ms${res.hedged ? '（2 本目を投げた）' : ''}`
  $('fact-source').textContent = { final: '確定', pause: '字幕が止まった', interim: '字幕が伸びた' }[ctx.source]
  $('fact-questions').textContent = `${Object.keys(pipeline.questions).length} 問`
  $('seen').textContent = JSON.stringify(state, null, 2)
  renderCaptions()
}

// ---------- 内訳 ----------

function makeRows(parent, count) {
  return Array.from({ length: count }, () => {
    const row = document.createElement('div')
    row.className = 'bar idle'
    row.innerHTML = '<span class="name"></span><span class="track"><i></i></span><span class="pct"></span><span class="raw"></span>'
    $(parent).append(row)
    return row
  })
}
const cueRows = makeRows('cue-bars', CUE_ROWS)
const moodRows = makeRows('mood-bars', MOOD_ROWS)
const fmt = (v) => (typeof v === 'number' ? v.toFixed(2).replace(/^0/, '') : '–')

function renderBars(rows, group, label) {
  const best = group ? top(group.strength, rows.length) : []
  rows.forEach((row, i) => {
    const entry = best[i]
    row.classList.toggle('idle', !entry)
    if (!entry) return
    const [id, strength] = entry
    row.querySelector('.name').textContent = label(id)
    row.querySelector('i').style.width = `${(strength * 100).toFixed(1)}%`
    row.querySelector('.pct').textContent = `${Math.round(strength * 100)}%`
    row.querySelector('.raw').textContent = `c ${fmt(group.choice?.[id])} n ${fmt(group.nouls[id])}`
  })
}

// ---------- 持続する効果 ----------

const LAYER_LABEL = { shades: 'レンズ', face: '顔', screen: '画面', voice: '声' }
const chips = new Map()
for (const [layer, ids] of Object.entries(LAYERS)) {
  const row = document.createElement('div')
  row.className = 'chip-row'
  const label = document.createElement('span')
  label.textContent = LAYER_LABEL[layer]
  row.append(label)
  for (const id of ids) {
    const chip = document.createElement('button')
    chip.type = 'button'
    chip.className = 'chip'
    chip.textContent = id
    chip.setAttribute('aria-pressed', 'false')
    chip.addEventListener('click', () => {
      const on = chip.getAttribute('aria-pressed') !== 'true'
      bus.emit({ kind: 'ambient', at: performance.now(), layer, id, on, intensity: Number($('heat').value), mood: 'manual' })
    })
    chips.set(`${layer}/${id}`, chip)
    row.append(chip)
  }
  $('chips').append(row)
}

function renderChips() {
  const active = media.active()
  for (const [key, chip] of chips) {
    const [layer, id] = key.split('/')
    chip.setAttribute('aria-pressed', String(active[layer]?.includes(id) ?? false))
  }
}

// ---------- 手動で出す ----------

const heat = () => Number($('heat').value)
$('heat').addEventListener('input', () => ($('heat-out').textContent = heat().toFixed(2)))

function fireCue(id) {
  audio.resume()
  pipeline.force(id, heat())
}

FIREABLE_CUE_IDS.forEach((id, i) => {
  const button = document.createElement('button')
  button.type = 'button'
  button.textContent = `${i < 9 ? `${i + 1} ` : ''}${CUE_BY_ID[id].giongo[1]}`
  button.title = id
  button.addEventListener('click', () => fireCue(id))
  $('cue-buttons').append(button)
})

for (const id of STYLE_IDS) $('telop-style').append(new Option(id, id))
$('telop-form').addEventListener('submit', (e) => {
  e.preventDefault()
  const text = $('telop-text').value.trim()
  if (!text) return
  audio.resume()
  pipeline.force(null, heat(), { text, style: $('telop-style').value })
})

addEventListener('keydown', (e) => {
  if (e.target.matches('input, select, textarea') || e.metaKey || e.ctrlKey || e.altKey) return
  if (e.key === 'p' || e.key === 'P') document.body.classList.toggle('stage-only')
  else if (e.key === 'r' || e.key === 'R') toggleRecording()
  else if (/^[1-9]$/.test(e.key)) fireCue(FIREABLE_CUE_IDS[Number(e.key) - 1])
})
if (params.get('stage') === '1') document.body.classList.add('stage-only')

// ---------- 録画 ----------

let recStartedAt = 0
const setRecNote = (text, state = '') => {
  $('rec-note').textContent = text
  $('rec-note').dataset.state = state
}
const recorder = createRecorder({
  canvas: $('stage'),
  audioStream: () => audio.recordingStream(),
  onState: ({ recording, startedAt }) => {
    recStartedAt = startedAt
    $('rec').setAttribute('aria-pressed', String(recording))
    $('rec').textContent = recording ? '■ 停止 0:00' : '● 録画'
    $('rec-dot').hidden = !recording
    $('rec-surface').disabled = recording
  },
  onSaved: ({ name, bytes }) => setRecNote(`保存しました: ${name}（${(bytes / 1e6).toFixed(1)} MB）`),
  onError: (message) => setRecNote(message, 'error'),
})

function toggleRecording() {
  if (recorder.recording) return recorder.stop()
  // 音の出口は AudioContext が要る。録画のボタンを先に押されても、SE が入るようにここで始めておく
  audio.resume()
  setRecNote('')
  recorder.start($('rec-surface').value)
}
$('rec').addEventListener('click', toggleRecording)

const savedSurface = store.get('jev-telop:rec-surface')
if (SURFACES.includes(savedSurface)) $('rec-surface').value = savedSurface
$('rec-surface').addEventListener('change', () => store.set('jev-telop:rec-surface', $('rec-surface').value))
$('rec-voice').value = store.get('jev-telop:rec-voice') ?? 'processed'
const applyRecVoice = () => {
  audio.setRecordingVoice($('rec-voice').value)
  store.set('jev-telop:rec-voice', $('rec-voice').value)
}
$('rec-voice').addEventListener('change', applyRecVoice)
applyRecVoice()

// ---------- マイク ----------

let micLabel = ''
let micZeroSince = null

/** マイクの一覧を作る。名前は、一度マイクを許可したあとでないと取れないので、開始のあとに呼ぶ。 */
async function fillMics() {
  const mics = await listMics()
  if (!mics.length) return
  $('mic').replaceChildren(...mics.map((mic) => new Option(mic.virtual ? `${mic.label}（仮想。音は入りません）` : mic.label, mic.id)))
  const current = mics.find((mic) => mic.label === micLabel)
  if (current) $('mic').value = current.id
}

$('mic').addEventListener('change', async () => {
  const id = $('mic').value
  if (!id) return
  const { stream, label, error } = await openMicOnly(id)
  if (!stream || !(await audio.openMic(stream))) return setStatus('st-mic', 'なし', 'error', error || 'このマイクを開けません')
  store.set('jev-telop:mic', id)
  micLabel = label
  micZeroSince = null
  setStatus('st-mic', '入力あり', 'ok', micLabel)
})

/**
 * マイクから完全な無音（値がちょうど 0）が続いていないかを見る。本物のマイクなら、黙っていても環境音で 0 にはならない。
 * 0 が続くのは、音を出さない仮想の入力を掴んでいるとき。エラーにならず、声の加工も録画も黙って無音になるので、状態に出す。
 */
function watchMic(now) {
  if (!audio.state().mic) return
  if (audio.level() > 0) {
    if (micZeroSince != null && now - micZeroSince >= 3000) setStatus('st-mic', '入力あり', 'ok', micLabel)
    micZeroSince = null
  } else {
    micZeroSince ??= now
    if (now - micZeroSince >= 3000) setStatus('st-mic', '無音', 'error', `${micLabel || 'このマイク'} から音が来ていません。パネルの「音」でマイクを選び直してください`)
  }
}

// ---------- 音 ----------

function setMonitor(on) {
  $('monitor').checked = on
  audio.setMonitor(on)
}
// 声の出力は、開いたまま保存しない。次に開いたとき、スピーカーのままいきなり鳴ってハウリングするのを防ぐ
$('monitor').addEventListener('change', () => setMonitor($('monitor').checked))
$('se-volume').value = store.get('jev-telop:se-volume') ?? '0.8'
const applySeVolume = () => {
  audio.setSeVolume(Number($('se-volume').value))
  store.set('jev-telop:se-volume', $('se-volume').value)
}
$('se-volume').addEventListener('input', applySeVolume)

async function listSinks() {
  applySeVolume()
  const devices = await navigator.mediaDevices?.enumerateDevices?.().catch(() => [])
  for (const d of (devices ?? []).filter((d) => d.kind === 'audiooutput' && d.deviceId !== 'default')) $('sink').append(new Option(d.label || d.deviceId, d.deviceId))
}
$('sink').addEventListener('change', async () => {
  await audio.setSink($('sink').value)
  const label = $('sink').selectedOptions[0]?.textContent ?? ''
  $('monitor-note').textContent = /speaker|スピーカー/i.test(label)
    ? '出力先がスピーカーです。声を出力するとハウリングします。'
    : 'スピーカーで出すと、マイクに回り込んでハウリングします。'
})

$('mirror').checked = mirrored
$('mirror').addEventListener('change', () => {
  stage.setMirror($('mirror').checked)
  store.set('jev-telop:mirror', $('mirror').checked ? '1' : '0')
})

// ---------- 入力 ----------

$('say-form').addEventListener('submit', (e) => {
  e.preventDefault()
  pipeline.final($('say').value)
  $('say').value = ''
})

$('reset').addEventListener('click', () => {
  adopted = null
  pipeline.reset()
  media.clear()
  renderBars(cueRows, null)
  renderBars(moodRows, null)
  renderChips()
  $('seen').textContent = '(まだ何も送っていません)'
  $('moment').textContent = 'オチ – ／ 熱量 – ／ 材料の乏しさ –'
  $('alert').textContent = ''
  $('announce').textContent = ''
})

// 定期の見回り。黙っているあいだのムードの減衰と、待たせていた声の切替と、パネルの数字
setInterval(() => {
  pipeline.tick(audio.speaking())
  watchMic(performance.now())
  if (recorder.recording) $('rec').textContent = `■ 停止 ${formatElapsed(performance.now() - recStartedAt)}`
  const s = stage.stats()
  setStatus('st-render', s.fps ? `${Math.round(s.fps)} fps` : '–', '', s.fps ? `1 フレームの処理に ${s.frameMs.toFixed(1)} ms` : '')
  if (s.face.status === 'loading') setStatus('st-face', '読み込み中…')
  else if (s.face.status === 'ready') setStatus('st-face', s.face.tracking === 'tracking' ? '追跡中' : '見えない', s.face.tracking === 'tracking' ? 'ok' : '', `検出 1 回に ${s.face.ms.toFixed(1)} ms`)
  $('mic-meter').firstElementChild.style.width = `${Math.min(100, audio.level() * 400)}%`
  const a = audio.state()
  $('voice-active').textContent = a.voices.length ? `${a.voices.join(' + ')}${a.monitor ? '' : '（出力は閉じています）'}` : '加工なし'
  const held = pipeline.director.snapshot().heldVoice
  for (const [key, chip] of chips) chip.classList.toggle('held', held && key.startsWith('voice/'))
}, TICK_MS)

async function connect() {
  try {
    const status = await (await fetch('/api/status')).json()
    if (!status.hasKey) $('alert').textContent = '環境変数 TYPESAFE_API_KEY が未設定です。演出は手動でしか出ません'
    renderStt(status.stt)
  } catch {
    $('alert').textContent = 'node server.js で起動してください'
    renderStt({ state: 'off', detail: '' })
    return
  }
  const source = new EventSource('/api/captions')
  source.onmessage = (e) => {
    const event = JSON.parse(e.data)
    if (event.type === 'stt') renderStt(event)
    else if (event.type === 'interim') pipeline.interim(event.text)
    else if (event.type === 'final') pipeline.final(event.text)
  }
}

stage.start()
renderCaptions()
renderChips()
connect()
