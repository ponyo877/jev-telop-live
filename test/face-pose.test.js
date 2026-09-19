import test from 'node:test'
import assert from 'node:assert'
import { FACE } from '../src/effects.js'
import { createFaceTracker, createOneEuro, facePose } from '../src/stage/face-pose.js'
import { FACE_SPRITE_IDS, drawFace } from '../src/stage/face-sprites.js'
import { VENDOR_FILES, VERSION, faceUrls } from '../src/stage/face-urls.js'

const DEG = Math.PI / 180
const STAGE = { W: 1280, H: 720 }
const near = (got, want, tolerance, label = '') => assert.ok(Math.abs(got - want) <= tolerance, `${label} ${got} vs ${want}`)

/**
 * 合成ランドマーク（478 点）。使う index だけ、顔らしい位置に置く。残りは映像の中央。
 * cx, cy は両目尻の中点、d は目尻間（どちらも映像のピクセル）。deg は画面上で時計回りの傾き。
 * ミラーしていない映像なので、被写体の右目尻（33）が画面の左に来る。
 */
function makeLandmarks({ cx = 320, cy = 240, d = 100, deg = 0, vw = 640, vh = 480, mouth = 0.1 } = {}) {
  const cos = Math.cos(deg * DEG)
  const sin = Math.sin(deg * DEG)
  const put = (lx, ly) => ({ x: (cx + (lx * cos - ly * sin) * d) / vw, y: (cy + (lx * sin + ly * cos) * d) / vh, z: 0 })
  const landmarks = Array.from({ length: 478 }, () => ({ x: 0.5, y: 0.5, z: 0 }))
  const local = {
    33: [-0.5, 0], 263: [0.5, 0], 168: [0, -0.06], 10: [0, -0.8], 152: [0, 1.15], 234: [-0.78, 0.2], 454: [0.78, 0.2],
    13: [0, 0.7 - mouth / 2], 14: [0, 0.7 + mouth / 2], 50: [-0.42, 0.38], 280: [0.42, 0.38], 1: [0, 0.42],
  }
  for (const [i, [lx, ly]] of Object.entries(local)) landmarks[i] = put(lx, ly)
  return landmarks
}

const VIDEO = { ...STAGE, vw: 640, vh: 480 }
const poseOf = (options = {}, view = {}) => facePose(makeLandmarks(options), { ...VIDEO, ...view })

// ---------- facePose ----------

test('目尻が水平なら angle は 0。20° 傾けると約 20° で、逆に傾けると符号が反転する', () => {
  near(poseOf().angle, 0, 1e-9)
  near(poseOf({ deg: 20 }).angle / DEG, 20, 1e-6)
  near(poseOf({ deg: -20 }).angle / DEG, -20, 1e-6)
})

test('4:3 の映像を 16:9 のステージに cover-fit すると、2 倍に拡大されて上下が 120px ずつ切れる', () => {
  const center = poseOf()
  near(center.cx, 640, 1e-9)
  near(center.cy, 360, 1e-9)
  near(center.eyeDist, 200, 1e-9)
  // 映像の上端近く（y = 60）は、ステージでは 60 * 2 - 120 = 0
  const top = poseOf({ cx: 160, cy: 60 })
  near(top.cx, 320, 1e-9)
  near(top.cy, 0, 1e-9)
  // 額（目の線から 0.8 × 目尻間だけ上）はステージの外へ出る
  near(top.forehead.y, -160, 1e-9)
})

test('映像のほうが横長のときは、左右が切れる', () => {
  // 1920x480 を 1280x720 に: 1.5 倍で 2880x720、左右が 800px ずつ切れる
  const pose = facePose(makeLandmarks({ cx: 960, cy: 240, vw: 1920, vh: 480 }), { ...STAGE, vw: 1920, vh: 480 })
  near(pose.cx, 640, 1e-9)
  near(pose.cy, 360, 1e-9)
  near(pose.eyeDist, 150, 1e-9)
  const left = facePose(makeLandmarks({ cx: 600, cy: 240, vw: 1920, vh: 480 }), { ...STAGE, vw: 1920, vh: 480 })
  near(left.cx, 600 * 1.5 - 800, 1e-9)
})

test('各点はステージ座標で返る。cheekL は画面の左、forehead は上、chin は下', () => {
  const pose = poseOf()
  assert.ok(pose.cheekL.x < pose.cx && pose.cheekR.x > pose.cx)
  assert.ok(pose.forehead.y < pose.brow.y && pose.brow.y < pose.cy && pose.cy < pose.nose.y && pose.nose.y < pose.chin.y)
  near(pose.faceWidth, 1.56 * 200, 1e-9)
  near(pose.mouthOpen, 0.1, 1e-9)
  near(poseOf({ mouth: 0.4 }).mouthOpen, 0.4, 1e-9)
})

test('mirror で cx が W - cx になり、angle の符号が反転する。目尻が入れ替わっても u は画面右を向く', () => {
  const plain = poseOf({ cx: 200, deg: 20 })
  const mirrored = poseOf({ cx: 200, deg: 20 }, { mirror: true })
  near(mirrored.cx, STAGE.W - plain.cx, 1e-9)
  near(mirrored.cy, plain.cy, 1e-9)
  near(mirrored.angle, -plain.angle, 1e-9)
  near(mirrored.eyeDist, plain.eyeDist, 1e-9)
  for (const pose of [plain, mirrored]) {
    assert.ok(Math.cos(pose.angle) > 0, 'u.x > 0')
    assert.ok(pose.cheekL.x < pose.cheekR.x)
    // 顔の上方向 v = (u.y, -u.x) は額を向く
    const v = { x: Math.sin(pose.angle), y: -Math.cos(pose.angle) }
    assert.ok((pose.forehead.x - pose.cx) * v.x + (pose.forehead.y - pose.cy) * v.y > 0)
  }
  near(mirrored.cheekL.x, STAGE.W - plain.cheekR.x, 1e-9)
})

test('ランドマークが無い、足りない、目尻が重なっているときは null', () => {
  assert.strictEqual(facePose(null, VIDEO), null)
  assert.strictEqual(facePose(undefined, VIDEO), null)
  assert.strictEqual(facePose([], VIDEO), null)
  assert.strictEqual(facePose(makeLandmarks().slice(0, 200), VIDEO), null)
  assert.strictEqual(facePose(makeLandmarks({ d: 0 }), VIDEO), null)
  // 映像の大きさがまだ分からない（videoWidth が 0）
  assert.strictEqual(facePose(makeLandmarks(), { ...STAGE, vw: 0, vh: 0 }), null)
  // 虹彩なしの 468 点でも足りる
  assert.ok(facePose(makeLandmarks().slice(0, 468), VIDEO))
})

// ---------- One Euro ----------

/** 再現できる乱数（mulberry32）。 */
function seeded(seed) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const variance = (values) => {
  const mean = values.reduce((sum, v) => sum + v, 0) / values.length
  return values.reduce((sum, v) => sum + (v - mean) ** 2, 0) / values.length
}
const FRAME = 1000 / 30

test('One Euro: 一定の入力はそのまま返す。reset すると次の値から始め直す', () => {
  const f = createOneEuro()
  for (let i = 0; i < 60; i++) near(f.filter(42, i * FRAME), 42, 1e-12)
  f.reset()
  assert.strictEqual(f.filter(-7, 3000), -7)
})

test('One Euro: ステップ入力に行き過ぎずに追いつく', () => {
  const f = createOneEuro()
  let t = 0
  for (; t < 1000; t += FRAME) f.filter(0, t)
  let prev = 0
  const out = []
  for (; t < 2000; t += FRAME) {
    const y = f.filter(100, t)
    assert.ok(y >= prev && y <= 100, `単調に近づく: ${prev} → ${y}`)
    out.push((prev = y))
  }
  assert.ok(out[0] > 0 && out[0] < 100, '1 サンプルめは途中')
  // 速く動いているあいだはカットオフが上がるので、0.2 秒で 9 割を超える
  assert.ok(out[5] > 90, `0.2 秒後 ${out[5]}`)
  near(out.at(-1), 100, 0.5)
})

test('One Euro: ノイズの分散を減らす。時刻が進まない呼び出しでは値を変えない', () => {
  const random = seeded(7)
  const f = createOneEuro()
  const input = Array.from({ length: 600 }, () => 500 + (random() * 2 - 1) * 2)
  const output = input.map((x, i) => f.filter(x, i * FRAME))
  assert.ok(variance(output.slice(30)) < variance(input.slice(30)) * 0.3, `${variance(output)} vs ${variance(input)}`)
  const held = f.filter(9999, 599 * FRAME)
  assert.strictEqual(held, output.at(-1))
})

// ---------- tracker ----------

test('tracker: 現れる → 追う → 保持 → フェード → null と進む', () => {
  const tracker = createFaceTracker({ holdMs: 350, fadeMs: 200, appearMs: 120 })
  assert.strictEqual(tracker.current(0), null)
  assert.strictEqual(tracker.status(0), 'lost')

  const pose = poseOf()
  tracker.update(pose, 1000)
  assert.strictEqual(tracker.current(1000).alpha, 0)
  near(tracker.current(1060).alpha, 0.5, 1e-9)
  for (let t = 1033; t <= 2000; t += 33) tracker.update(pose, t)
  assert.strictEqual(tracker.status(2000), 'tracking')
  assert.strictEqual(tracker.current(2000).alpha, 1)
  near(tracker.current(2000).cx, pose.cx, 1e-9)

  // 2013 で見失う。350ms は最後の姿勢のまま、濃さ 1
  tracker.update(null, 2013)
  tracker.update(null, 2046)
  assert.strictEqual(tracker.status(2300), 'holding')
  assert.strictEqual(tracker.current(2362).alpha, 1)
  near(tracker.current(2362).cx, pose.cx, 1e-9)
  // そこから 200ms で消える
  near(tracker.current(2463).alpha, 0.5, 1e-9)
  assert.strictEqual(tracker.status(2463), 'holding')
  assert.strictEqual(tracker.current(2563), null)
  assert.strictEqual(tracker.status(2563), 'lost')
  assert.strictEqual(tracker.current(99999), null)
})

test('tracker: alpha はいつも 0..1。時刻が前後しても外れない', () => {
  const tracker = createFaceTracker()
  const pose = poseOf()
  tracker.update(pose, 500)
  tracker.update(null, 540)
  tracker.update(pose, 900)
  tracker.update(null, 2000)
  for (let t = 0; t < 3000; t += 7) {
    const current = tracker.current(t)
    if (current) assert.ok(current.alpha >= 0 && current.alpha <= 1, `t=${t} alpha=${current.alpha}`)
  }
})

test('tracker: 消えたあとの再捕捉は、フィルタを捨てて新しい位置にフェードインする', () => {
  const tracker = createFaceTracker({ holdMs: 350, fadeMs: 200, appearMs: 120 })
  for (let t = 0; t <= 990; t += 33) tracker.update(poseOf({ cx: 100 }), t)
  tracker.update(null, 1000)
  assert.strictEqual(tracker.current(1600), null)

  const moved = poseOf({ cx: 500 })
  tracker.update(moved, 2000)
  const first = tracker.current(2000)
  // 前の位置（cx = 200）から滑ってこない
  near(first.cx, moved.cx, 1e-9)
  assert.strictEqual(first.alpha, 0)
  near(tracker.current(2030).alpha, 0.25, 1e-9)
  assert.strictEqual(tracker.current(2120).alpha, 1)
  assert.strictEqual(tracker.status(2000), 'tracking')
})

test('tracker: フェードの途中で再捕捉したら、そのときの濃さから戻る（0 に落ちて瞬かない）', () => {
  const tracker = createFaceTracker({ holdMs: 350, fadeMs: 200, appearMs: 120 })
  for (let t = 0; t <= 990; t += 33) tracker.update(poseOf(), t)
  tracker.update(null, 1000)
  near(tracker.current(1450).alpha, 0.5, 1e-9)
  tracker.update(poseOf({ cx: 400 }), 1450)
  near(tracker.current(1450).alpha, 0.5, 1e-9)
  near(tracker.current(1450).cx, poseOf({ cx: 400 }).cx, 1e-9)
  near(tracker.current(1480).alpha, 0.75, 1e-9)
  assert.strictEqual(tracker.current(1600).alpha, 1)
})

test('tracker: 保持のあいだに戻ってきた取りこぼしは、濃さ 1 のまま続きとして追う', () => {
  const tracker = createFaceTracker()
  for (let t = 0; t <= 990; t += 33) tracker.update(poseOf({ cx: 100 }), t)
  tracker.update(null, 1023)
  tracker.update(poseOf({ cx: 110 }), 1056)
  const current = tracker.current(1056)
  assert.strictEqual(current.alpha, 1)
  assert.strictEqual(tracker.status(1056), 'tracking')
  // フィルタを捨てていないので、新しい位置（220）へ一気には飛ばない
  assert.ok(current.cx > 200 && current.cx < 220, `${current.cx}`)
})

test('tracker: 検出の揺れをならし、額や頬の点は顔からずれない', () => {
  const random = seeded(11)
  const tracker = createFaceTracker()
  const raw = []
  const smooth = []
  for (let i = 0; i < 300; i++) {
    const jitter = () => (random() * 2 - 1) * 1.5
    const pose = poseOf({ cx: 320 + jitter(), cy: 240 + jitter(), d: 100 + jitter(), deg: 10 + jitter() })
    tracker.update(pose, i * FRAME)
    const current = tracker.current(i * FRAME)
    raw.push(pose.cx)
    smooth.push(current.cx)

    // ならした姿勢のローカル座標で見ると、各点は合成ランドマークで置いた場所のまま
    const toLocal = (p) => {
      const [dx, dy] = [p.x - current.cx, p.y - current.cy]
      const [cos, sin] = [Math.cos(current.angle), Math.sin(current.angle)]
      return [(dx * cos + dy * sin) / current.eyeDist, (dy * cos - dx * sin) / current.eyeDist]
    }
    for (const [key, want] of Object.entries({ forehead: [0, -0.8], chin: [0, 1.15], cheekL: [-0.42, 0.38], cheekR: [0.42, 0.38], brow: [0, -0.06] })) {
      const got = toLocal(current[key])
      near(got[0], want[0], 1e-9, key)
      near(got[1], want[1], 1e-9, key)
    }
    near(current.faceWidth / current.eyeDist, 1.56, 1e-9)
  }
  assert.ok(variance(smooth.slice(30)) < variance(raw.slice(30)) * 0.4)
})

test('tracker: 角度が ±π をまたいでも、0 を通って逆回りに飛ばない', () => {
  const tracker = createFaceTracker()
  const base = poseOf()
  // +175° から -175° へ、±180° をまたいで 1 回につき 1° ずつ回す
  for (let i = 0; i <= 10; i++) {
    const deg = 175 + i
    const angle = Math.atan2(Math.sin(deg * DEG), Math.cos(deg * DEG))
    tracker.update({ ...base, angle }, i * FRAME)
    const current = tracker.current(i * FRAME)
    assert.ok(current.angle > -Math.PI - 1e-9 && current.angle <= Math.PI + 1e-9, '(-π, π] に収まる')
    // ならした角度は入力より少し遅れるだけで、いつも ±180° の近くにいる
    const behind = Math.atan2(Math.sin(angle - current.angle), Math.cos(angle - current.angle)) / DEG
    assert.ok(behind >= -1e-9 && behind < 10, `i=${i} 遅れ ${behind}°`)
    assert.ok(Math.cos(current.angle) < -0.98, `i=${i} angle=${current.angle / DEG}°`)
  }
})

// ---------- スプライトと取得先 ----------

/** 呼び出しを記録するだけの ctx。実際には描かないが、パスに NaN が混じる、save と restore が合わない、といった壊れ方は拾える。 */
function fakeCtx() {
  const calls = []
  const gradient = { addColorStop: (offset, color) => calls.push(['addColorStop', offset, color]) }
  return new Proxy({ calls, globalAlpha: 1 }, {
    get(target, key) {
      if (key in target || typeof key !== 'string') return target[key]
      return (...args) => {
        calls.push([key, ...args])
        return key.startsWith('create') ? gradient : undefined
      }
    },
    set(target, key, value) {
      calls.push([`set ${key}`, value])
      target[key] = value
      return true
    },
  })
}

test('FACE の id すべてにスプライトがある', () => {
  assert.deepStrictEqual([...FACE_SPRITE_IDS].sort(), [...FACE].sort())
})

test('スプライトは有限の数値だけで描き、ctx の状態を元に戻す', () => {
  const tracker = createFaceTracker()
  tracker.update(poseOf({ deg: 12 }, { mirror: true }), 0)
  const pose = tracker.current(500)
  for (const id of FACE) {
    for (const level of [0.01, 0.3, 1]) {
      for (const nowMs of [0, 777, 123456.7]) {
        const ctx = fakeCtx()
        drawFace(ctx, id, pose, level, nowMs)
        const names = ctx.calls.map((call) => call[0])
        assert.strictEqual(names.filter((n) => n === 'save').length, names.filter((n) => n === 'restore').length, `${id}: save と restore の数`)
        assert.strictEqual(names[0], 'save')
        assert.strictEqual(names.at(-1), 'restore')
        assert.ok(names.includes('fill') || names.includes('stroke'), `${id}: 何か描く`)
        for (const [name, ...args] of ctx.calls) {
          for (const arg of args) if (typeof arg === 'number') assert.ok(Number.isFinite(arg), `${id} level=${level}: ${name}(${args})`)
        }
        for (const [name, value] of ctx.calls) if (name === 'set globalAlpha') assert.ok(value >= 0 && value <= 1, `${id}: globalAlpha ${value}`)
      }
    }
  }
})

test('pose が無い、消えきっている、level が 0、知らない id のときは何も描かない', () => {
  const tracker = createFaceTracker()
  tracker.update(poseOf(), 0)
  const pose = tracker.current(500)
  for (const args of [['sunglasses', null, 1], ['sunglasses', { ...pose, alpha: 0 }, 1], ['sunglasses', pose, 0], ['monocle', pose, 1]]) {
    const ctx = fakeCtx()
    drawFace(ctx, args[0], args[1], args[2], 0)
    assert.deepStrictEqual(ctx.calls, [])
  }
})

test('取得先: vendorVersion があれば自分のサーバ、無ければ版を固定した CDN', () => {
  assert.match(VERSION, /^\d+\.\d+\.\d+$/)
  const cdn = faceUrls()
  assert.strictEqual(cdn.bundle, `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${VERSION}/vision_bundle.mjs`)
  assert.strictEqual(cdn.wasm, `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${VERSION}/wasm`)
  assert.ok(cdn.model.endsWith('/face_landmarker.task'))
  assert.deepStrictEqual(faceUrls(null), cdn)
  assert.deepStrictEqual(faceUrls('0.10.21'), {
    bundle: '/vendor/mediapipe/0.10.21/vision_bundle.mjs',
    wasm: '/vendor/mediapipe/0.10.21/wasm',
    model: '/vendor/mediapipe/0.10.21/face_landmarker.task',
  })
  // 落とすファイルの並びは、ブラウザが vendor から読むときの URL と合っている
  const local = faceUrls(VERSION)
  const paths = VENDOR_FILES.map((f) => `/vendor/mediapipe/${VERSION}/${f.path}`)
  for (const url of [local.bundle, local.model, `${local.wasm}/vision_wasm_internal.js`, `${local.wasm}/vision_wasm_internal.wasm`]) assert.ok(paths.includes(url), url)
  // モデルが最後。server.js はモデルの有無でその版が使えると判断するので、途中で失敗した半端なフォルダを使わせない
  assert.strictEqual(VENDOR_FILES.at(-1).path, 'face_landmarker.task')
})
