// AudioParam を「今の値」から動かし直すための小道具。ブラウザ専用。

const FADE_STEPS = 8

/**
 * 予約済みの変化を捨て、時刻 t に今の値を置く。ここから新しいランプを書ける。
 * ランプは「前のイベント」から始まる。前のランプが何秒も前に終わっていると、そこを起点に引かれて t の時点でほぼ終点まで跳ぶので、必ず t に点を打つ。
 * value は直近の描画ブロックの値なので、ランプの途中で呼んでもほぼ今の値が取れる。
 */
export function hold(param, t) {
  const value = param.value
  // cancelAndHoldAtTime は Firefox に無い
  if (param.cancelAndHoldAtTime) param.cancelAndHoldAtTime(t)
  else param.cancelScheduledValues(t)
  param.setValueAtTime(value, t)
}

/** 今の値から target まで直線で動かす。 */
export function rampTo(param, target, t, seconds) {
  hold(param, t)
  param.linearRampToValueAtTime(target, t + seconds)
}

/**
 * 等パワーのフェード。0..1 のゲインを sin の四半周に沿って動かす。入る側と出る側を同時にかけると、二乗和が 1 のまま入れ替わる。
 * setValueCurveAtTime は他のイベントと重なると例外を投げ、切替の連打に弱いので、短い直線をつないで近似する。
 */
export function fadeTo(param, on, t, seconds) {
  const from = Math.asin(Math.min(1, Math.max(0, param.value)))
  const to = on ? Math.PI / 2 : 0
  hold(param, t)
  for (let k = 1; k <= FADE_STEPS; k++) param.linearRampToValueAtTime(Math.sin(from + ((to - from) * k) / FADE_STEPS), t + (seconds * k) / FADE_STEPS)
}
