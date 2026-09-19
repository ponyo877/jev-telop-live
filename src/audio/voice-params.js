// 声エフェクトのパラメータ表と、そこから値を引く関数。DOM にも WebAudio にも依存しない。
//   timbre は声色そのものを差し替えるので同時に 1 つだけ。space は声色の後ろに足すので重ねられる。
//   [弱, 強] の組は intensity 0..1 で線形に引く。

import { mulberry32 } from './rng.js'

export const VOICE_FX = {
  // pitch_up と pitch_down は同じワークレットを ratio だけ変えて使う
  pitch_up: { stage: 'timbre', path: 'pitch', ratio: [1.35, 1.7] },
  pitch_down: { stage: 'timbre', path: 'pitch', ratio: [0.8, 0.62] },
  // リング変調だけだと声が震えるだけなので、8ms の櫛形フィルタで金属的な響きを足す
  robot: { stage: 'timbre', path: 'robot', carrierHz: [45, 90], combSec: 0.008, combFeedback: 0.45, highpassHz: 150, level: 0.9 },
  distortion: { stage: 'timbre', path: 'distortion', drive: [4, 30], curve: 3, highpassHz: 120, lowpassHz: 3800, presenceHz: 1600, presenceDb: 4, level: 1.4 },
  echo: { stage: 'space', delaySec: 0.26, feedback: [0.3, 0.6], dampHz: 2800, wet: 0.55 },
}

const unit = (v) => (Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 0.5)
const span = ([weak, strong], intensity) => weak + (strong - weak) * unit(intensity)

/** ピッチシフタに渡す倍率。pitch 系でない id は 1（素通し）。 */
export const ratioFor = (id, intensity = 0.5) => (VOICE_FX[id]?.ratio ? span(VOICE_FX[id].ratio, intensity) : 1)
export const robotCarrierHz = (intensity = 0.5) => span(VOICE_FX.robot.carrierHz, intensity)
export const distortionDrive = (intensity = 0.5) => span(VOICE_FX.distortion.drive, intensity)
export const echoFeedback = (intensity = 0.5) => span(VOICE_FX.echo.feedback, intensity)
/** 強く歪ませるほど波形が四角くなって音量が上がるので、そのぶん出口で絞る。 */
export const distortionPostGain = (drive) => VOICE_FX.distortion.level / Math.sqrt(drive)

/**
 * WaveShaper 用のソフトクリップ曲線（tanh）。amount は膝の硬さで、0 に近いほど直線。
 * 歪みの深さは手前のゲイン（drive）で変える。曲線を鳴らしながら差し替えるとプチッと鳴るので、曲線は固定にしておく。
 * 丸めで対称が崩れないように、正の側だけ計算して負の側は符号を返して写す。
 */
export function makeDistortionCurve(amount, n = 2048) {
  const k = Math.max(Number.isFinite(amount) ? amount : 0, 0.001)
  const curve = new Float32Array(n)
  const norm = Math.tanh(k)
  for (let i = Math.floor(n / 2); i < n; i++) {
    const v = Math.tanh(k * ((2 * i) / (n - 1) - 1)) / norm
    curve[n - 1 - i] = -v
    curve[i] = v
  }
  return curve
}

/** 残響のインパルス応答（将来の reverb 用）。ノイズに (1 - t)^decay の包絡を掛ける。decay が大きいほど早く消える。 */
export function makeImpulse(sampleRate, seconds, decay, seed = 1) {
  const n = Math.max(1, Math.round(sampleRate * seconds))
  const rng = mulberry32(seed)
  const impulse = new Float32Array(n)
  for (let i = 0; i < n; i++) impulse[i] = (rng() * 2 - 1) * (1 - i / n) ** decay
  return impulse
}
