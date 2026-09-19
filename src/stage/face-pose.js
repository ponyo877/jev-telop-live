// 顔のランドマークから、スプライトを貼るための姿勢（位置・傾き・大きさ）を作る。DOM に依存しない。
// 検出は 5〜30Hz で値も揺れるので、平滑化と、見失ったときの保持・フェードもここで持つ。描画側は current() を毎フレーム読むだけでよい。

// MediaPipe の顔メッシュの index。対は [被写体の右, 被写体の左]。ミラーしていない映像では、被写体の右が画面の左に写る。
const EYE_OUTER = [33, 263]
const CHEEK = [50, 280]
const SIDE = [234, 454]
const LIPS = [13, 14]
const BROW = 168
const FOREHEAD = 10
const CHIN = 152
const NOSE = 1
// 虹彩つきで 478 点。虹彩なしの 468 点でも、使う index はすべて収まる。
const MIN_POINTS = 468

const clamp01 = (t) => Math.min(1, Math.max(0, t))
/** 角度を (-π, π] に収める。 */
const wrap = (rad) => rad - Math.PI * 2 * Math.ceil((rad - Math.PI) / (Math.PI * 2))

/**
 * 1 顔ぶんのランドマーク（x, y は映像に対する 0..1）を、ステージ座標の姿勢にする。
 * 映像（vw×vh）はステージ（W×H）に cover-fit で描かれている前提。mirror は映像を左右反転して描いているとき。
 * 戻り値の座標系は「画面は y 下向き、angle は画面上で時計回りが正」で、ctx.rotate(angle) にそのまま渡せる。
 */
export function facePose(landmarks, { W, H, vw, vh, mirror = false }) {
  if (!Array.isArray(landmarks) || landmarks.length < MIN_POINTS || !(vw > 0) || !(vh > 0)) return null
  const s = Math.max(W / vw, H / vh)
  const ox = (W - vw * s) / 2
  const oy = (H - vh * s) / 2
  const at = (i) => {
    const x = landmarks[i].x * vw * s + ox
    return { x: mirror ? W - x : x, y: landmarks[i].y * vh * s + oy }
  }
  const dist = (p, q) => Math.hypot(q.x - p.x, q.y - p.y)

  // 画面上で左にある目尻を a にする。ミラーで左右が入れ替わっても u は画面右を向き、スプライトが裏返らない。
  const eyes = EYE_OUTER.map(at)
  const swapped = eyes[0].x > eyes[1].x
  const [a, b] = swapped ? [eyes[1], eyes[0]] : eyes
  const eyeDist = dist(a, b)
  if (!(eyeDist > 1e-6)) return null
  const u = { x: (b.x - a.x) / eyeDist, y: (b.y - a.y) / eyeDist }
  // 頬は目尻と同じ入れ替えに従わせる。頬どうしの x を比べると、顔を大きく傾けたときに目尻と食い違う。
  const cheeks = CHEEK.map(at)
  const [cheekL, cheekR] = swapped ? [cheeks[1], cheeks[0]] : cheeks

  return {
    cx: (a.x + b.x) / 2,
    cy: (a.y + b.y) / 2,
    angle: Math.atan2(u.y, u.x),
    eyeDist,
    faceWidth: dist(at(SIDE[0]), at(SIDE[1])),
    forehead: at(FOREHEAD),
    chin: at(CHIN),
    cheekL,
    cheekR,
    brow: at(BROW),
    nose: at(NOSE),
    mouthOpen: dist(at(LIPS[0]), at(LIPS[1])) / eyeDist,
  }
}

/**
 * One Euro フィルタ。止まっているときは強くならして震えを消し、速く動いたらカットオフを上げて遅れを減らす。
 * beta は「速さ 1 につきカットオフを何 Hz 上げるか」なので、値の単位（px か、ラジアンか）に合わせて決める。
 */
export function createOneEuro({ minCutoff = 1.5, beta = 0.01, dCutoff = 1 } = {}) {
  let x = null
  let dx = 0
  let t = 0
  const alpha = (cutoff, dt) => 1 / (1 + 1 / (2 * Math.PI * cutoff * dt))

  return {
    filter(value, tMs) {
      if (x === null) {
        x = value
        dx = 0
        t = tMs
        return x
      }
      const dt = (tMs - t) / 1000
      // 同じ時刻や巻き戻った時刻では速さが決まらない。前の値のまま返す。
      if (!(dt > 0)) return x
      const rawDx = (value - x) / dt
      dx += (rawDx - dx) * alpha(dCutoff, dt)
      x += (value - x) * alpha(minCutoff + beta * Math.abs(dx), dt)
      t = tMs
      return x
    },
    reset() {
      x = null
    },
  }
}

// 位置と大きさは px、傾きはラジアン。速さの桁が違うので beta を分ける（首をかしげる速さはせいぜい数 rad/s）。
const POSITION = { minCutoff: 1.5, beta: 0.01 }
const SIZE = { minCutoff: 1.0, beta: 0.01 }
const ANGLE = { minCutoff: 1.5, beta: 1.5 }
const POINTS = ['forehead', 'chin', 'cheekL', 'cheekR', 'brow', 'nose']

/**
 * 検出ごとの姿勢を受け取り、描画に使う姿勢を返す。
 * 見失ったら holdMs のあいだ最後の姿勢を保ち、fadeMs で消す。戻ってきたら appearMs で現れる。
 * 時刻はすべて引数で受け取る。current() と status() は状態を変えないので、描画から何度呼んでもよい。
 */
export function createFaceTracker({ holdMs = 350, fadeMs = 200, appearMs = 120 } = {}) {
  const filters = { cx: createOneEuro(POSITION), cy: createOneEuro(POSITION), eyeDist: createOneEuro(SIZE), angle: createOneEuro(ANGLE) }
  let last = null // 平滑化した最後の姿勢
  let rawAngle = null // 直前の検出の生の傾き。null はフィルタを捨てた直後
  let unwrapped = 0 // 折り返しをほどいた傾き。フィルタにはこちらを通す
  let lostAt = null // 見失いはじめた時刻。追えているあいだは null
  let lostAlpha = 1
  let appear = { at: 0, from: 0 }

  const ramp = (elapsed, ms) => (ms > 0 ? clamp01(elapsed / ms) : elapsed >= 0 ? 1 : 0)

  function alphaAt(nowMs) {
    if (!last) return 0
    if (lostAt === null) return clamp01(appear.from + ramp(nowMs - appear.at, appearMs))
    return lostAlpha * (1 - ramp(nowMs - lostAt - holdMs, fadeMs))
  }

  function status(nowMs) {
    if (!last) return 'lost'
    if (lostAt === null) return 'tracking'
    return nowMs - lostAt < holdMs + fadeMs ? 'holding' : 'lost'
  }

  function update(pose, nowMs) {
    if (!pose) {
      if (last && lostAt === null) {
        // 現れている途中で見失ったら、その濃さから保持と消えを始める。
        lostAlpha = alphaAt(nowMs)
        lostAt = nowMs
      }
      return
    }
    if (!last || lostAt !== null) {
      const from = alphaAt(nowMs)
      // 保持のあいだに戻ってきたのは検出の取りこぼしなので、続きとして扱う（濃さは 1 のまま、フィルタもそのまま）。
      // 消えはじめてからの再捕捉は別の場所に出ることが多い。前の位置と速さを引きずると滑って見えるので、フィルタを捨てる。
      if (!last || nowMs - lostAt > holdMs) {
        for (const f of Object.values(filters)) f.reset()
        rawAngle = null
      }
      appear = { at: nowMs, from }
      lostAt = null
    }

    // 傾きは前回との差を (-π, π] に直して積む。+179° から -179° へは 2° の動きで、358° の戻りではない。
    unwrapped = rawAngle === null ? pose.angle : unwrapped + wrap(pose.angle - rawAngle)
    rawAngle = pose.angle

    const cx = filters.cx.filter(pose.cx, nowMs)
    const cy = filters.cy.filter(pose.cy, nowMs)
    const eyeDist = filters.eyeDist.filter(pose.eyeDist, nowMs)
    const angle = filters.angle.filter(unwrapped, nowMs)

    // 額や頬の点は 1 つずつならさず、ならした姿勢と同じ変位・回転・拡縮で運ぶ。点ごとに遅れが違うと、顔の上で絵がばらけて見える。
    const k = eyeDist / pose.eyeDist
    const cos = Math.cos(angle - unwrapped) * k
    const sin = Math.sin(angle - unwrapped) * k
    const carry = (p) => ({ x: cx + (p.x - pose.cx) * cos - (p.y - pose.cy) * sin, y: cy + (p.x - pose.cx) * sin + (p.y - pose.cy) * cos })

    last = { ...pose, cx, cy, eyeDist, angle: wrap(angle), faceWidth: pose.faceWidth * k }
    for (const key of POINTS) if (pose[key]) last[key] = carry(pose[key])
  }

  function current(nowMs) {
    if (status(nowMs) === 'lost') return null
    return { ...last, alpha: alphaAt(nowMs) }
  }

  return { update, current, status }
}
