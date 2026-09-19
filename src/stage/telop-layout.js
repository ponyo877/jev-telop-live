// 発話テロップの折り返しと大きさを決める。音声認識の字幕は長さが読めないので、収まるまで割り、縮め、最後は切る。DOM に依存しない。
// 文字幅の測り方は measure(text, px) でもらう。ブラウザでは measureText、テストでは全角 1em・半角 0.5em の偽物を渡す。

const NO_HEAD = new Set([...'、。，．！？!?…ー～〜っゃゅょぁぃぅぇぉッャュョァィゥェォ」』）)】'])
const NO_TAIL = new Set([...'「『（(【'])
const ELLIPSIS = '…'
// 行頭に来ると不自然な語。Intl.Segmenter は助詞や助動詞を独立した語として返すので、語の境界をそのまま使うと
// 「中身 / が空っぽ」のように助詞の前で割れてしまう。テロップは文節の切れ目で折りたい。
const CLINGS = new Set([
  ...['が', 'を', 'に', 'は', 'で', 'と', 'も', 'へ', 'の', 'や', 'か', 'ね', 'よ', 'な', 'さ', 'ぞ', 'わ'],
  ...['から', 'まで', 'より', 'けど', 'って', 'たら', 'なら', 'ので', 'のに', 'だけ', 'ほど', 'など', 'しか', 'かも'],
  ...['です', 'ます', 'ない', 'たい', 'だっ', 'でし', 'まし', 'ませ', 'した', 'なか', 'われ', 'られ', 'れる', 'られる', 'せる', 'てる', 'てた'],
])
// 助動詞は「泣き|ま|した」「言|え|なか|っ|た」のように細切れで返るので、ひらがな 1 文字の語はすべて前の語に付ける
const clings = (segment) => CLINGS.has(segment) || /^\p{Script=Hiragana}$/u.test(segment)

const graphemes = (text) => [...new Intl.Segmenter('ja', { granularity: 'grapheme' }).segment(text)].map((s) => s.segment)

/** 割ってよい位置（書記素の番号）。語の境界のうち、行頭・行末の禁則に触れないもの。 */
function breakpoints(text) {
  const chars = graphemes(text)
  const points = []
  let at = 0
  for (const { segment } of new Intl.Segmenter('ja', { granularity: 'word' }).segment(text)) {
    // この語の手前が、割ってよい位置かどうか。漢字の直後のひらがなは送り仮名や活用語尾のことが多いので、そこでも割らない（言 / われて）
    const okurigana = at > 0 && /\p{Script=Han}/u.test(chars[at - 1]) && /\p{Script=Hiragana}/u.test(chars[at])
    if (at > 0 && !clings(segment) && !okurigana && !NO_HEAD.has(chars[at]) && !NO_TAIL.has(chars[at - 1])) points.push(at)
    at += graphemes(segment).length
  }
  return { chars, points }
}

/** n 行に、できるだけ同じ長さで割る。割れる位置が足りなければ null。 */
function split(chars, points, n) {
  if (n === 1) return [chars.join('')]
  const lines = []
  let from = 0
  for (let k = 1; k < n; k++) {
    const ideal = (chars.length * k) / n
    const candidates = points.filter((p) => p > from)
    if (!candidates.length) return null
    const cut = candidates.reduce((best, p) => (Math.abs(p - ideal) < Math.abs(best - ideal) ? p : best))
    lines.push(chars.slice(from, cut).join(''))
    from = cut
  }
  lines.push(chars.slice(from).join(''))
  return lines.every(Boolean) ? lines : null
}

/** 行の高さ（文字の大きさに対する比）。telop-draw.js の焼き込みと合わせる。 */
export const LINE_HEIGHT = 1.18

/**
 * text を maxWidth × maxHeight に収める。戻り値は { px, lines, truncated }。
 * 1 行で入ればそのまま。入らなければ行を増やし、それでも入らなければ minPx まで縮め、最後は末尾を「…」で切る。
 * 行を増やすほど、高さの上限から文字は小さくなる。熱量の高い長い発話が、画面を埋めてしまわないように。
 */
export function layoutTelop(text, { maxWidth, maxHeight = Infinity, maxLines = 3, basePx, minPx = Math.round(basePx * 0.55), measure }) {
  const clean = (text ?? '').trim()
  if (!clean) return { px: basePx, lines: [], truncated: false }
  const { chars, points } = breakpoints(clean)
  const fits = (lines, px) => lines.every((line) => measure(line, px) <= maxWidth)

  for (let n = 1; n <= maxLines; n++) {
    const lines = split(chars, points, n)
    if (!lines) continue
    const startPx = Math.max(minPx, Math.min(basePx, Math.floor(maxHeight / (n * LINE_HEIGHT))))
    // 行を増やす前に、少しだけなら縮めて収める。2 行で読めるものを 3 行にしない
    const floor = n < maxLines ? Math.max(minPx, startPx * 0.75) : minPx
    for (let px = startPx; px >= floor; px = Math.floor(px * 0.92)) {
      if (fits(lines, px)) return { px, lines, truncated: false }
    }
  }

  // 割れる位置が無い、または縮めても入らない。最小の大きさで、入るだけ詰めて切る
  const lines = []
  let rest = chars
  for (let n = 0; n < maxLines && rest.length; n++) {
    let take = rest.length
    while (take > 1 && measure(rest.slice(0, take).join(''), minPx) > maxWidth) take--
    lines.push(rest.slice(0, take).join(''))
    rest = rest.slice(take)
  }
  if (rest.length) {
    let last = graphemes(lines.at(-1))
    while (last.length > 1 && measure(last.join('') + ELLIPSIS, minPx) > maxWidth) last = last.slice(0, -1)
    lines[lines.length - 1] = last.join('') + ELLIPSIS
  }
  return { px: minPx, lines, truncated: rest.length > 0 }
}
