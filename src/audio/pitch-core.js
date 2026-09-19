// 2 タップのディレイラインによるピッチシフタ。DOM にも WebAudio にも依存しないので、ワークレットからも Node のテストからも使える。
//   入力をリングバッファに書き、書き込み位置からの遅延を一定の速さで伸び縮みさせながら読む。遅延が縮んでいく間は速く再生されるので音が上がる。
//   遅延は 0..Wn を鋸波で回るので、半周ずらした 2 本を sin² で掛け合わせ、折り返しの段差を隠す。

const RING = 16384
const MASK = RING - 1
/** ratio の受け付ける範囲。これより外は窓 1 周が短すぎて、声として聞けない。 */
const MIN_RATIO = 0.25
const MAX_RATIO = 4

export function createShifter(sampleRate, windowSec = 0.045) {
  const ring = new Float32Array(RING)
  // 窓がリングより長いと、読み出しが 1 周前の音を拾う
  const wn = Math.min(Math.max(windowSec * sampleRate, 2), RING - 2)
  let write = 0
  let phase = 0

  /** 書き込み位置から delay サンプル前を線形補間で読む。負の添字は & で畳まれる。 */
  const tap = (delay) => {
    const pos = write - delay
    const i = Math.floor(pos)
    const a = ring[i & MASK]
    return a + (ring[(i + 1) & MASK] - a) * (pos - i)
  }

  return {
    /** 状態（リングと位相）を持ち越すので、何サンプル刻みで呼んでも結果は同じになる。input と output は同じ配列でもよい。 */
    process(input, output, ratio) {
      const r = Number.isFinite(ratio) ? Math.min(MAX_RATIO, Math.max(MIN_RATIO, ratio)) : 1
      const step = (1 - r) / wn
      const n = Math.min(input.length, output.length)
      for (let k = 0; k < n; k++) {
        const x = input[k]
        // NaN を 1 つでもリングに入れると、窓 1 周ぶんの出力が壊れる
        ring[write] = Number.isFinite(x) ? x : 0
        const other = phase < 0.5 ? phase + 0.5 : phase - 0.5
        const g = Math.sin(Math.PI * phase) ** 2
        output[k] = g * tap(phase * wn) + (1 - g) * tap(other * wn)
        write = (write + 1) & MASK
        phase += step
        phase -= Math.floor(phase)
      }
    },
  }
}
