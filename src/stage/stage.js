// ステージ。カメラの映像を下地に、顔の効果・歪み・画面の効果・擬音・テロップを毎フレーム重ねる。
// 描画は素の Canvas 2D。必要なのが映像の切り出し、合成モード、多重の縁取りで、どれも ctx を直に叩くことになるので p5 は挟まない。
// 重ねる順（下から）:
//   1. 映像を scene（別のキャンバス）へ。左右反転はここだけで行う
//   2. 顔の効果を scene へ。映像と一緒に歪むように
//   3. scene を画面へ写す。歪み（波、グリッチ）があれば、ここで短冊ごとにずらす
//   4. 画面の効果（暗転、雨、集中線…）
//   5. 擬音とテロップ。読めなくなるので、歪みも揺れもかけない

import { FACE, FX, SCREEN, SHADES } from '../effects.js'
import { createFace } from './face.js'
import { createFaceTracker, facePose } from './face-pose.js'
import { drawFace } from './face-sprites.js'
import { AMBIENTS } from './fx/ambient.js'
import { BURSTS } from './fx/burst.js'
import { createGiongo, createTelop } from './fx/text.js'
import { coverRect } from './geometry.js'
import { ensureFont } from './telop-draw.js'
import { GIONGO_LOOK, STYLE_LOOK } from './telop-styles.js'
import { approach, shake } from './timeline.js'

export const W = 1280
export const H = 720
const MAX_ONESHOTS = 8
const FRAME_MIN_MS = 15 // 120Hz の画面でも 60fps で足りる
const FACE_IDLE_MS = 200 // 顔の効果が出ていないあいだの検出間隔。出した瞬間に正しい位置へ置くために、追い続けはする
// 検出は M5 の GPU で中央値 12ms ほど。姿勢は検出の合間を補間しないので、間引くとそのぶん顔の効果がカクつく。
// ふだんは映像の毎フレーム（30Hz）で調べ、検出が 1 フレームぶんを食うほど重い機械でだけ 1 つおきに落とす
const FACE_SLOW_MS = 60
const FACE_SLOW_OVER_MS = 25
const SHADE_FADE_MS = 350 // レンズの色が変わるのにかける時間

/** pinned は、常に出しておく顔の効果。「消す」を押しても戻る。 */
export function createStage(canvas, video, { scale = 1, mirror = true, still = null, pinned = ['sunglasses'] } = {}) {
  canvas.width = W * scale
  canvas.height = H * scale
  const ctx = canvas.getContext('2d')
  const scene = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(W, H) : Object.assign(document.createElement('canvas'), { width: W, height: H })
  const sctx = scene.getContext('2d')
  const reduced = typeof matchMedia === 'function' ? matchMedia('(prefers-reduced-motion: reduce)') : { matches: false }

  const face = createFace()
  const tracker = createFaceTracker()
  let oneshots = []
  const ambients = new Map() // SCREEN の id → 効果
  const faces = new Map(pinned.filter((id) => FACE.includes(id)).map((id) => [id, { on: true, level: 0, pinned: true }])) // FACE の id → { on, level, pinned }
  let shade = { from: 'black', to: 'black', changedAt: -Infinity } // サングラスのレンズの色
  let shakes = [] // { at, amp }
  let newFrame = false
  let lastDetectAt = -Infinity
  let last = null
  const stats = { fps: 0, frameMs: 0 }

  // 映像の新しいフレームが来たときだけ顔を検出する。同じフレームを二度調べても無駄なので
  const watchFrames = () => {
    if (!video.requestVideoFrameCallback) return
    const tick = () => {
      newFrame = true
      video.requestVideoFrameCallback(tick)
    }
    video.requestVideoFrameCallback(tick)
  }

  const world = { W, H, now: 0, dt: 0, face: null, still: false }

  function detectFace(now) {
    if (face.status !== 'ready' || video.readyState < 2) return
    if (video.requestVideoFrameCallback && !newFrame) return
    const active = [...faces.values()].some((f) => f.on || f.level > 0.01)
    const every = !active ? FACE_IDLE_MS : face.lastMs > FACE_SLOW_OVER_MS ? FACE_SLOW_MS : 0
    if (now - lastDetectAt < every) return
    newFrame = false
    lastDetectAt = now
    const landmarks = face.detect(video, now)
    tracker.update(landmarks ? facePose(landmarks, { W, H, vw: video.videoWidth, vh: video.videoHeight, mirror }) : null, now)
  }

  function drawScene() {
    if (video.readyState >= 2 && video.videoWidth) {
      const r = coverRect(video.videoWidth, video.videoHeight, W, H)
      sctx.save()
      if (mirror) {
        sctx.translate(W, 0)
        sctx.scale(-1, 1)
      }
      sctx.drawImage(video, r.x, r.y, r.w, r.h)
      sctx.restore()
    } else {
      // カメラが無くても演出は試せるように、下地だけ敷く
      const g = sctx.createLinearGradient(0, 0, W, H)
      g.addColorStop(0, '#2b3440')
      g.addColorStop(1, '#151a21')
      sctx.fillStyle = g
      sctx.fillRect(0, 0, W, H)
      sctx.fillStyle = 'rgba(255, 255, 255, 0.35)'
      sctx.font = '600 28px "Hiragino Sans", sans-serif'
      sctx.textAlign = 'center'
      sctx.fillText('カメラなし（演出はこのまま試せます）', W / 2, H / 2)
    }
    if (world.face) {
      const mix = world.still ? 1 : Math.min(1, (world.now - shade.changedAt) / SHADE_FADE_MS)
      for (const [id, f] of faces) if (f.level > 0.01) drawFace(sctx, id, world.face, f.level, world.now, { shade: { ...shade, mix } })
    }
  }

  function frame(now) {
    requestAnimationFrame(frame)
    if (last != null && now - last < FRAME_MIN_MS) return
    // タブを離れて戻ったときなど、長く空いたぶんは無かったことにする。一気に進めると効果が飛ぶ
    const dt = last == null ? 16 : Math.min(now - last, 250)
    last = now
    const started = performance.now()
    world.now = now
    world.dt = dt
    world.still = still ?? reduced.matches

    detectFace(now)
    world.face = tracker.current(now)
    for (const [id, f] of faces) {
      f.level = approach(f.level, f.on ? 1 : 0, dt, f.on ? 250 : 160)
      if (!f.on && !f.pinned && f.level < 0.002) faces.delete(id)
    }
    oneshots = oneshots.filter((e) => e.update(now, dt, world))
    for (const [id, e] of ambients) if (!e.update(now, dt, world)) ambients.delete(id)
    shakes = shakes.filter((s) => now - s.at < 450)

    drawScene()

    ctx.setTransform(scale, 0, 0, scale, 0, 0)
    ctx.fillStyle = '#000000'
    ctx.fillRect(0, 0, W, H)
    ctx.save()
    let sx = 0
    let sy = 0
    let amp = 0
    if (!world.still) {
      for (const s of shakes) {
        const o = shake(now - s.at, s.amp)
        sx += o.x
        sy += o.y
        amp = Math.max(amp, s.amp)
      }
    }
    const angle = oneshots.reduce((sum, e) => sum + (e.angle?.(now, world.still) ?? 0), 0)
    if (amp || angle) {
      // 揺らしたり傾けたりすると端に黒が見えるので、そのぶん少し拡大する
      const grow = 1 + (2 * amp) / W + Math.abs(angle) * 1.2
      ctx.translate(W / 2 + sx, H / 2 + sy)
      ctx.rotate(angle)
      ctx.scale(grow, grow)
      ctx.translate(-W / 2, -H / 2)
    }
    // 歪みは 1 つだけかける。グリッチのほうが目立つので優先する
    const distort = ambients.get('glitch') ?? ambients.get('wave')
    if (distort?.transfer) distort.transfer(ctx, scene, world)
    else ctx.drawImage(scene, 0, 0, W, H)

    const overlays = [...ambients.values(), ...oneshots.filter((e) => e.z < 70)].sort((a, b) => a.z - b.z)
    for (const e of overlays) e.draw(ctx, world)
    ctx.restore()

    for (const e of oneshots.filter((e) => e.z >= 70).sort((a, b) => a.z - b.z)) e.draw(ctx, world)

    stats.frameMs = approach(stats.frameMs, performance.now() - started, dt, 500)
    stats.fps = approach(stats.fps, 1000 / dt, dt, 500)
  }

  function push(effect) {
    if (!effect) return
    oneshots.push(effect)
    // 出しすぎたら古いものから下ろす。director が間隔を空けるので、ふだんはここに来ない
    if (oneshots.length > MAX_ONESHOTS) oneshots = oneshots.slice(-MAX_ONESHOTS)
  }

  return {
    start() {
      watchFrames()
      requestAnimationFrame(frame)
    },

    /** 顔認識を読み込む。失敗しても例外にしない。顔の効果が出ないだけ。 */
    async loadFace(vendorVersion) {
      await face.load({ vendorVersion })
      return face.status === 'ready'
    },

    /** 擬音は文字が決まっているので、起動時にフォントをまとめて読んでおく。 */
    async preloadFonts(texts) {
      const all = texts.join('')
      await Promise.all(Object.values(GIONGO_LOOK).map((look) => ensureFont(look, all, 4000)))
    },

    /** 瞬発イベント。 */
    async fire(event) {
      const at = performance.now()
      const base = { heat: event.heat, dress: event.dress, at, world }
      if (event.layers?.fx && FX.includes(event.layers.fx)) push(BURSTS[event.layers.fx](base))
      if (event.dress.shake > 0) shakes.push({ at, amp: event.dress.shake })
      if (event.layers?.giongo && GIONGO_LOOK[event.cue]) push(createGiongo({ ...base, cue: event.cue, text: event.layers.giongo }))
      if (event.telop) {
        // 発話の文字は毎回違うので、その字が入ったフォントを読んでから焼く。待ちすぎないよう上限つき
        await ensureFont(STYLE_LOOK[event.telop.style] ?? STYLE_LOOK.plain, event.telop.text)
        push(createTelop({ ...base, at: performance.now(), text: event.telop.text, style: event.telop.style }))
      }
    },

    /** 持続イベント（layer が face か screen のもの）。 */
    setAmbient(event) {
      const now = performance.now()
      if (event.layer === 'face' && FACE.includes(event.id)) {
        const f = faces.get(event.id) ?? { on: false, level: 0 }
        f.on = event.on
        faces.set(event.id, f)
      } else if (event.layer === 'shades' && SHADES.includes(event.id)) {
        // off は、その色が出ているときだけ黒へ戻す。ムードの乗り換えでは off のあとに次の色の on が続くので、別の色の off で消さない
        const to = event.on ? event.id : shade.to === event.id ? 'black' : shade.to
        if (to !== shade.to) {
          // 変わっている途中でさらに変わったら、出発点は変えない（青 → 黒 → 紫 と続いても、青から紫へ移る）
          const settled = now - shade.changedAt >= SHADE_FADE_MS
          shade = { from: settled ? shade.to : shade.from, to, changedAt: now }
        }
      } else if (event.layer === 'screen' && SCREEN.includes(event.id)) {
        let e = ambients.get(event.id)
        if (!e && event.on) ambients.set(event.id, (e = AMBIENTS[event.id]()))
        e?.set(event.on, event.intensity ?? 0.5, now)
      }
    },

    clear() {
      const now = performance.now()
      oneshots = []
      shakes = []
      for (const e of ambients.values()) e.release(now)
      for (const f of faces.values()) f.on = Boolean(f.pinned)
      shade = { from: shade.to, to: 'black', changedAt: now }
    },

    setMirror(value) {
      mirror = value
    },

    setStill(value) {
      still = value
    },

    active() {
      return { shades: shade.to === 'black' ? [] : [shade.to], screen: [...ambients.values()].filter((e) => e.on).map((e) => e.id), face: [...faces].filter(([, f]) => f.on).map(([id]) => id) }
    },

    stats() {
      return { fps: stats.fps, frameMs: stats.frameMs, face: { status: face.status, error: face.error, ms: face.lastMs, tracking: tracker.status(performance.now()) } }
    },
  }
}
