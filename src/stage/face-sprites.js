// 顔に貼るスプライト。画像も絵文字フォントも使わず、すべて Canvas 2D のパスで描く。ctx を受け取るだけなので DOM には触れない。
// drawFace が「両目尻の中点が原点、目尻間が 1、x が画面右、y が顎方向」の座標系を用意し、各スプライトはその中で描く。
// 線幅も半径もこの単位になる（0.02 なら目尻間の 2%）。顔が近づいても離れても、絵の比率は変わらない。

const TAU = Math.PI * 2

const clamp = (t, lo, hi) => Math.min(hi, Math.max(lo, t))
const easeOutCubic = (t) => 1 - (1 - t) ** 3
/** 行き過ぎてから戻る。ポンと出るものに使う。 */
const easeOutBack = (t) => 1 + 2.70158 * (t - 1) ** 3 + 1.70158 * (t - 1) ** 2

/** ステージ座標の点を、顔のローカル座標へ直す。 */
function toLocal(pose, p, fallback) {
  if (!p) return fallback
  const dx = p.x - pose.cx
  const dy = p.y - pose.cy
  const cos = Math.cos(pose.angle)
  const sin = Math.sin(pose.angle)
  return { x: (dx * cos + dy * sin) / pose.eyeDist, y: (dy * cos - dx * sin) / pose.eyeDist }
}

/** 角を丸めた多角形のパス。corners は [x, y, 角の丸み]。 */
function roundedPath(ctx, corners) {
  const n = corners.length
  ctx.beginPath()
  corners.forEach(([x, y, r], i) => {
    const from = corners[(i + n - 1) % n]
    const to = corners[(i + 1) % n]
    const a = Math.hypot(from[0] - x, from[1] - y)
    const b = Math.hypot(to[0] - x, to[1] - y)
    const sx = x + ((from[0] - x) / a) * r
    const sy = y + ((from[1] - y) / a) * r
    if (i === 0) ctx.moveTo(sx, sy)
    else ctx.lineTo(sx, sy)
    ctx.quadraticCurveTo(x, y, x + ((to[0] - x) / b) * r, y + ((to[1] - y) / b) * r)
  })
  ctx.closePath()
}

// ---------- サングラス ----------

// 画面右のレンズ。上辺が広い台形で、外側の上の角だけ張らせる。左のレンズは x を反転して作る。
// 全幅は 1.55（±0.775）、高さは 0.56（幅の 0.36 倍）。目の線より少し下げて、眉を半分残す。
const LENS = [[0.075, -0.235, 0.07], [0.775, -0.255, 0.1], [0.69, 0.27, 0.2], [0.2, 0.305, 0.2]]
const LENSES = [LENS, LENS.map(([x, y, r]) => [-x, y, r]).reverse()]
const LENS_MID = 0.43
const FRAME = '#0b0b10'

/**
 * レンズの色。id は src/effects.js の SHADES に合わせる。上から下へのグラデーションで、上は暗く、下は明るい。
 * どの色でも上を暗くしておくと、目が透けて見えず、サングラスのまま色だけが変わったように見える。
 * hue を持つものは、色相を時間で回す（虹色）。
 */
export const SHADE_LOOK = {
  black: { stops: ['#050508', '#191922', '#3b3547'] },
  gold: { stops: ['#2a1a00', '#b8860b', '#ffe27a'] },
  blue: { stops: ['#03102e', '#1f5fbf', '#8fd0ff'] },
  red: { stops: ['#2b0004', '#c4001a', '#ff8a70'] },
  purple: { stops: ['#12032b', '#6a2bbf', '#d6a6ff'] },
  green: { stops: ['#00210f', '#0fa958', '#a8ffcb'] },
  pink: { stops: ['#3a0420', '#ff4f9a', '#ffd1e8'] },
  sunset: { stops: ['#2b0a3d', '#ff5e62', '#ffd36b'] },
  rainbow: { hue: true },
}
export const SHADE_IDS = Object.keys(SHADE_LOOK).filter((id) => id !== 'black')

function glassOf(ctx, id, nowMs) {
  const look = SHADE_LOOK[id] ?? SHADE_LOOK.black
  const glass = ctx.createLinearGradient(0, -0.26, 0, 0.31)
  if (look.hue) {
    const h = (nowMs / 9) % 360
    glass.addColorStop(0, `hsl(${h}, 90%, 22%)`)
    glass.addColorStop(0.55, `hsl(${(h + 70) % 360}, 95%, 52%)`)
    glass.addColorStop(1, `hsl(${(h + 140) % 360}, 100%, 72%)`)
  } else {
    look.stops.forEach((color, i) => glass.addColorStop([0, 0.55, 1][i], color))
  }
  return glass
}

/** バラエティ番組の「サングラスがスッとかかる」。上から滑り降りてきて、濃さは降りきる前に出きる。 */
function sunglasses({ ctx, base, level, nowMs, geo, shade }) {
  const opacity = base * clamp(level * 1.8, 0, 1)
  ctx.globalAlpha = opacity
  ctx.translate(0, -0.6 * (1 - easeOutCubic(level)))
  ctx.lineJoin = 'round'
  ctx.lineCap = 'round'

  // テンプル。耳へ向かって奥に伸びるので、正面からは顔の端までの短い棒に見える。
  const ear = Math.max(geo.half + 0.05, 0.86)
  ctx.fillStyle = FRAME
  for (const side of [-1, 1]) {
    ctx.beginPath()
    ctx.moveTo(side * 0.74, -0.215)
    ctx.lineTo(side * ear, -0.15)
    ctx.lineTo(side * ear, -0.1)
    ctx.lineTo(side * 0.74, -0.12)
    ctx.closePath()
    ctx.fill()
  }

  // ブリッジ。鼻の付け根をまたぐ弓なり。
  ctx.strokeStyle = FRAME
  ctx.lineWidth = 0.065
  ctx.beginPath()
  ctx.moveTo(-0.12, -0.15)
  ctx.quadraticCurveTo(0, -0.235, 0.12, -0.15)
  ctx.stroke()

  // 色が変わるときは、前の色の上に次の色を重ねて、混ぜる割合を上げていく。色そのものを計算で混ぜるより、虹色のような動く色でも同じ扱いにできる
  const mix = clamp(shade?.mix ?? 1, 0, 1)
  const glassFrom = glassOf(ctx, shade?.from ?? 'black', nowMs)
  const glassTo = glassOf(ctx, shade?.to ?? 'black', nowMs)
  LENSES.forEach((lens, i) => {
    // 縁は太い線で先に描き、内側の半分をレンズで塗りつぶす。残った外側の半分がフレームになる。
    roundedPath(ctx, lens)
    ctx.lineWidth = 0.075
    ctx.stroke()
    ctx.fillStyle = glassFrom
    ctx.fill()
    if (mix > 0) {
      ctx.globalAlpha = opacity * mix
      ctx.fillStyle = glassTo
      ctx.fill()
      ctx.globalAlpha = opacity
    }

    // グレア。レンズで切り抜いてから、斜めの白い帯を太・細の 2 本。左右とも同じ向きに傾ける（光源は 1 つなので反転しない）。
    ctx.save()
    ctx.clip()
    const mid = (i === 0 ? 1 : -1) * LENS_MID
    ctx.fillStyle = '#ffffff'
    for (const [offset, width, alpha] of [[-0.09, 0.13, 0.4], [0.12, 0.045, 0.26]]) {
      ctx.globalAlpha = opacity * alpha
      ctx.beginPath()
      ctx.moveTo(mid + offset + 0.13, -0.32)
      ctx.lineTo(mid + offset + 0.13 + width, -0.32)
      ctx.lineTo(mid + offset - 0.13 + width, 0.36)
      ctx.lineTo(mid + offset - 0.13, 0.36)
      ctx.closePath()
      ctx.fill()
    }
    ctx.restore()
  })
}

// ---------- 頬の赤み ----------

function blush({ ctx, base, level, geo }) {
  ctx.globalAlpha = base * level
  ctx.lineCap = 'round'
  for (const cheek of [geo.cheekL, geo.cheekR]) {
    ctx.save()
    ctx.translate(cheek.x, cheek.y + 0.05)
    const grow = 0.8 + 0.2 * easeOutCubic(level)
    ctx.scale(grow, grow)

    // 横長のぼかし。円の放射グラデを縦につぶして楕円にする。
    ctx.save()
    ctx.scale(1, 0.62)
    const pink = ctx.createRadialGradient(0, 0, 0, 0, 0, 0.27)
    pink.addColorStop(0, 'rgba(255, 72, 124, 0.8)')
    pink.addColorStop(0.55, 'rgba(255, 96, 144, 0.45)')
    pink.addColorStop(1, 'rgba(255, 120, 160, 0)')
    ctx.fillStyle = pink
    ctx.beginPath()
    ctx.arc(0, 0, 0.27, 0, TAU)
    ctx.fill()
    ctx.restore()

    // 漫画の照れの斜線 3 本。
    ctx.strokeStyle = 'rgba(224, 48, 100, 0.85)'
    ctx.lineWidth = 0.02
    for (const dx of [-0.075, 0, 0.075]) {
      ctx.beginPath()
      ctx.moveTo(dx + 0.032, -0.055)
      ctx.lineTo(dx - 0.032, 0.055)
      ctx.stroke()
    }
    ctx.restore()
  }
}

// ---------- 怒りマーク ----------

/** 4 つの弧が十字の隙間をはさんで向き合う形。弧は中心に向かって張り出す。 */
function anger({ ctx, base, level, nowMs, geo }) {
  ctx.globalAlpha = base * clamp(level * 2, 0, 1)
  // 額の斜め上（画面右のこめかみ寄り）。髪の生え際にかかるくらいが漫画らしい。
  ctx.translate(0.5, geo.top + 0.04)
  ctx.rotate(-0.2)
  // 血管が脈打つ感じ。1 秒に 2.4 回、大きさを ±8% 揺らす。
  const beat = 1 + 0.08 * Math.sin((nowMs / 1000) * TAU * 2.4)
  const size = 0.21 * beat * Math.max(0.001, easeOutBack(level))
  ctx.scale(size, size)
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'

  const GAP = 0.2
  ctx.beginPath()
  for (const [sx, sy] of [[1, 1], [-1, 1], [-1, -1], [1, -1]]) {
    ctx.moveTo(sx * GAP, sy)
    ctx.quadraticCurveTo(sx * GAP, sy * GAP, sx, sy * GAP)
  }
  // 白フチを先に太く引き、その上に赤を重ねる。
  ctx.strokeStyle = '#ffffff'
  ctx.lineWidth = 0.46
  ctx.stroke()
  ctx.strokeStyle = '#e8222e'
  ctx.lineWidth = 0.26
  ctx.stroke()
}

// ---------- 汗 ----------

const SWEAT_MS = 1200

/** しずく。原点は丸い部分の中心、半径 1。上がとがる。 */
function dropPath(ctx) {
  ctx.beginPath()
  ctx.moveTo(0, -1.75)
  ctx.bezierCurveTo(0.12, -1.05, 1, -0.6, 1, 0)
  ctx.arc(0, 0, 1, 0, Math.PI)
  ctx.bezierCurveTo(-1, -0.6, -0.12, -1.05, 0, -1.75)
  ctx.closePath()
}

/** こめかみから頬へ滑り落ちては消える、の繰り返し。小さい 2 粒めを半周期ずらして、途切れて見えないようにする。 */
function sweat({ ctx, base, level, nowMs, geo }) {
  const x = geo.half - 0.13
  const from = geo.top * 0.5
  for (const [phase, dx, r] of [[0, 0, 0.09], [0.55, -0.12, 0.06]]) {
    const t = (nowMs / SWEAT_MS + phase) % 1
    // 出だしはゆっくり、だんだん速く。終わりの 35% で消える。
    const y = from + (0.5 - from) * t ** 1.7
    ctx.save()
    ctx.globalAlpha = base * level * clamp(t / 0.1, 0, 1) * clamp((1 - t) / 0.35, 0, 1)
    ctx.translate(x + dx, y)
    ctx.scale(r, r)
    const water = ctx.createLinearGradient(-1, -1.5, 1, 1)
    water.addColorStop(0, '#e2f6ff')
    water.addColorStop(1, '#4fb3ee')
    dropPath(ctx)
    ctx.fillStyle = water
    ctx.fill()
    ctx.strokeStyle = '#2b8ad2'
    ctx.lineWidth = 0.14
    ctx.lineJoin = 'round'
    ctx.stroke()
    // ハイライト。左上に細長い白。
    ctx.fillStyle = 'rgba(255, 255, 255, 0.92)'
    ctx.beginPath()
    ctx.ellipse(-0.4, -0.12, 0.17, 0.4, 0.4, 0, TAU)
    ctx.fill()
    ctx.restore()
  }
}

// ---------- 青ざめ ----------

// 縦線の長さ（帯の高さに対する比）。そろえると柵に見えるので、ばらつかせる。
const GLOOM_LINES = [0.5, 0.82, 0.66, 0.97, 0.74, 1, 0.62, 0.88, 0.55]

/** 額から目の線まで。青い影を multiply で肌に重ね、その上に縦線を垂らす。 */
function gloom({ ctx, base, level, nowMs, geo }) {
  const w = geo.half
  // ランドマークの「額の上端」は実際の生え際よりだいぶ下に出る。線は生え際のあたりから垂らす。
  const y0 = geo.top - 0.22
  const y1 = 0.1
  const cap = 0.3 // 線の上端は頭の丸みに沿わせる
  const grow = easeOutCubic(level)

  // 影。円の放射グラデを楕円につぶして額に置き、どの向きにもぼかして消す。帯の形に切ると、額に板を貼ったように見える。
  ctx.save()
  ctx.globalAlpha = base * level
  ctx.globalCompositeOperation = 'multiply'
  const yc = geo.top * 0.8
  ctx.translate(0, yc)
  ctx.scale(w * 1.12, y1 - yc)
  const shade = ctx.createRadialGradient(0, 0, 0, 0, 0, 1)
  shade.addColorStop(0, 'rgba(40, 58, 136, 0.9)')
  shade.addColorStop(0.55, 'rgba(58, 80, 158, 0.66)')
  shade.addColorStop(1, 'rgba(90, 110, 190, 0)')
  ctx.fillStyle = shade
  ctx.beginPath()
  ctx.arc(0, 0, 1, 0, TAU)
  ctx.fill()
  ctx.restore()

  // 縦線は下へ行くほど薄く。入りでは上から伸びてくる。
  ctx.globalAlpha = base * level
  const ink = ctx.createLinearGradient(0, y0, 0, y1)
  ink.addColorStop(0, 'rgba(24, 32, 104, 0.9)')
  ink.addColorStop(1, 'rgba(24, 32, 104, 0.1)')
  ctx.strokeStyle = ink
  ctx.lineWidth = 0.022
  ctx.lineCap = 'round'
  const span = w * 0.8
  ctx.beginPath()
  GLOOM_LINES.forEach((length, i) => {
    const x = -span + (2 * span * i) / (GLOOM_LINES.length - 1)
    const top = y0 + cap - cap * Math.sqrt(1 - (x / w) ** 2)
    // ゆっくり伸び縮みさせて、止め絵に見せない。
    const sway = 1 + 0.05 * Math.sin(nowMs / 520 + i * 1.9)
    ctx.moveTo(x, top)
    ctx.lineTo(x, top + (y1 - 0.1 - top) * length * grow * sway)
  })
  ctx.stroke()
}

const SPRITES = { sunglasses, blush, anger, sweat, gloom }

/** 描けるスプライトの id。src/effects.js の FACE と同じ集合（テストで突き合わせる）。 */
export const FACE_SPRITE_IDS = Object.keys(SPRITES)

/**
 * @param pose  tracker の current()（alpha つき）。null なら何も描かない。
 * @param level 持続エフェクトの入り抜けの包絡（0..1）。不透明度は pose.alpha * level が基本で、入りの動きもこれで決まる。
 */
export function drawFace(ctx, id, pose, level, nowMs, options = {}) {
  const sprite = SPRITES[id]
  if (!sprite || !pose || !(pose.alpha > 0) || !(level > 0) || !(pose.eyeDist > 0)) return
  // 顔の実測（ローカル座標）。横を向いたときなどの外れ値で絵が飛ばないよう、人の顔としてありうる範囲に収める。
  const geo = {
    half: clamp((pose.faceWidth ?? 1.56 * pose.eyeDist) / pose.eyeDist / 2, 0.65, 1),
    top: clamp(toLocal(pose, pose.forehead, { x: 0, y: -0.8 }).y, -1.15, -0.5),
    cheekL: toLocal(pose, pose.cheekL, { x: -0.42, y: 0.38 }),
    cheekR: toLocal(pose, pose.cheekR, { x: 0.42, y: 0.38 }),
  }
  ctx.save()
  ctx.translate(pose.cx, pose.cy)
  ctx.rotate(pose.angle)
  ctx.scale(pose.eyeDist, pose.eyeDist)
  sprite({ ctx, base: pose.alpha, level: Math.min(1, level), nowMs, geo, shade: options.shade })
  ctx.restore()
}
