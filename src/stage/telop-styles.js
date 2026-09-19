// 擬音と発話テロップの見た目。id は src/effects.js の CUES と STYLES に合わせる。DOM に依存しない。
// 色はここにデータで持つ。ステージは配信に載る絵なので、ページの配色（style.css）とは切り離す。
//   fill    上から下へのグラデーション
//   strokes 縁取り。外側から順に重ねる。width は文字の大きさに対する比
//   motion  src/stage/timeline.js の motionPose の名前

export const FONTS = {
  // システムのフォント。読み込みを待たずに使える
  gothic: { family: '"Hiragino Sans", "Hiragino Kaku Gothic ProN", "Noto Sans JP", sans-serif', weight: 900, web: false },
  mincho: { family: '"Hiragino Mincho ProN", "Yu Mincho", serif', weight: 600, web: false },
  maru: { family: '"Hiragino Maru Gothic ProN", "Hiragino Sans", sans-serif', weight: 400, web: false },
  // Google Fonts。400 しか無いので、太さを上げると合成の太字になって滲む
  dela: { family: '"Dela Gothic One", "Hiragino Sans", sans-serif', weight: 400, web: true },
  potta: { family: '"Potta One", "Hiragino Maru Gothic ProN", sans-serif', weight: 400, web: true },
  reggae: { family: '"Reggae One", "Hiragino Mincho ProN", serif', weight: 400, web: true },
}

export const fontOf = (look, px) => `${FONTS[look.font].weight} ${Math.round(px)}px ${FONTS[look.font].family}`

const BLACK = '#111111'
const WHITE = '#ffffff'
const ring = (...pairs) => pairs.map(([color, width]) => ({ color, width }))

/** 発話テロップの様式。 */
export const STYLE_LOOK = {
  impact: { font: 'dela', fill: ['#fff35a', '#ff8a00'], strokes: ring([BLACK, 0.3], [WHITE, 0.2], ['#c4001a', 0.1]), tilt: -3, motion: 'slam' },
  tsukkomi: { font: 'gothic', fill: ['#fff35a', '#ffd000'], strokes: ring([BLACK, 0.26], ['#e60033', 0.14]), tilt: -5, skew: -0.18, motion: 'slam' },
  funny: { font: 'potta', fill: ['#ffb02e', '#ff6a3d'], strokes: ring(['#7a2e00', 0.26], [WHITE, 0.16]), tilt: 2, motion: 'pop' },
  sad: { font: 'mincho', fill: ['#d9f0ff', '#7fb6e6'], strokes: ring(['#0b2545', 0.24], ['#1d4e89', 0.1]), tilt: 0, motion: 'fade' },
  horror: { font: 'reggae', fill: ['#ffffff', '#ffd0d0'], strokes: ring(['#2a0000', 0.3], ['#b00020', 0.14]), tilt: 0, motion: 'shiver' },
  cool: { font: 'mincho', fill: ['#fff3b0', '#c9971c'], strokes: ring([BLACK, 0.26], ['#5a4300', 0.1]), tilt: 0, motion: 'fade' },
  cute: { font: 'potta', fill: ['#ffd1e8', '#ff8fc7'], strokes: ring(['#7a1f4d', 0.24], [WHITE, 0.16]), tilt: 3, motion: 'pop' },
  plain: { font: 'gothic', fill: [WHITE, '#eeeeee'], strokes: ring([BLACK, 0.24]), tilt: 0, motion: 'default' },
}

/** 擬音。 */
export const GIONGO_LOOK = {
  don: { font: 'dela', fill: ['#ffe14d', '#ff5a00'], strokes: ring([BLACK, 0.26], [WHITE, 0.14]), motion: 'slam' },
  gaan: { font: 'dela', fill: ['#b8c6ff', '#4b3fa8'], strokes: ring(['#0d0a2e', 0.26], [WHITE, 0.12]), motion: 'drop' },
  zawa: { font: 'reggae', fill: [WHITE, '#d8d8d8'], strokes: ring([BLACK, 0.22]), motion: 'drift' },
  kiran: { font: 'potta', fill: ['#fffbd1', '#ffd23f'], strokes: ring(['#7a5a00', 0.24], [WHITE, 0.14]), motion: 'pop' },
  bishi: { font: 'dela', fill: [WHITE, '#ffe14d'], strokes: ring(['#c4001a', 0.28], [BLACK, 0.12]), motion: 'slam' },
  laugh: { font: 'potta', fill: ['#fff35a', '#ff9f1c'], strokes: ring(['#7a2e00', 0.24], [WHITE, 0.14]), motion: 'pop' },
  zukoo: { font: 'potta', fill: ['#d7f9ff', '#5cc8e6'], strokes: ring(['#083d4a', 0.24], [WHITE, 0.14]), motion: 'drop' },
  eee: { font: 'dela', fill: ['#ffffff', '#9be7ff'], strokes: ring(['#003a66', 0.26], [WHITE, 0.12]), motion: 'pop' },
  shiin: { font: 'mincho', fill: ['#f0f0f0', '#bdbdbd'], strokes: ring(['#222222', 0.2]), motion: 'fade' },
  chiin: { font: 'mincho', fill: ['#e8e2ff', '#9b8fd6'], strokes: ring(['#1d1640', 0.22]), motion: 'fade' },
  pikon: { font: 'potta', fill: ['#fffde0', '#ffe14d'], strokes: ring(['#5a4300', 0.24], [WHITE, 0.14]), motion: 'pop' },
  gogogo: { font: 'reggae', fill: ['#ff6a6a', '#7a0000'], strokes: ring([BLACK, 0.28], ['#ffb3b3', 0.1]), motion: 'rumble' },
  doki: { font: 'potta', fill: ['#ffd1dc', '#ff4f81'], strokes: ring(['#6b0f2a', 0.24], [WHITE, 0.14]), motion: 'pop' },
  mera: { font: 'reggae', fill: ['#ffe14d', '#ff2d00'], strokes: ring(['#3d0a00', 0.28], ['#ffb347', 0.1]), motion: 'rumble' },
  pachi: { font: 'potta', fill: ['#fff7b0', '#ffc93c'], strokes: ring(['#6b4a00', 0.24], [WHITE, 0.14]), motion: 'pop' },
}

/** 読み込みを待つ必要があるフォント。擬音は文字が決まっているので、起動時にまとめて読む。 */
export const webFontsOf = (looks) => [...new Set(Object.values(looks).map((look) => look.font))].filter((key) => FONTS[key].web)
