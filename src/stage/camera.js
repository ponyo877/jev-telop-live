// カメラとマイクを開く。許可のダイアログを 1 回で済ませるために、まず両方をまとめて頼む。

const VIDEO = { width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 30 }, facingMode: 'user' }
// 声を加工して出すので、ブラウザの音声処理はなるべく切る。
//   echoCancellation: 加工した声は元の声と形が違い、消しきれない。遅延も増える
//   autoGainControl: 黙っているあいだに雑音を持ち上げ、歪みやロボ声がそれを増幅する
//   noiseSuppression: 歪みが定常雑音を増幅するので、これだけは入れておく
const AUDIO = { echoCancellation: false, autoGainControl: false, noiseSuppression: true, channelCount: 1 }

/**
 * 音を出さない仮想の入力。Background Music や BlackHole のような、Mac の音を引き回すためのデバイス。
 * デバイスを指定せずにマイクを開くと、Chrome は一覧の先頭を選ぶことがあり、それが仮想の入力だと完全な無音が届く。
 * エラーにはならないので、気づかないまま声の加工も録画も無音になる。
 */
export const isVirtualMic = (label = '') => /virtual|background music|blackhole|loopback|soundflower|vb-cable|機器セット|aggregate/i.test(label)

/**
 * マイクの指定。選んだものがあればそれを、無ければ macOS の既定の入力（Chrome では 'default' という id）を名指しする。
 * 「できれば既定を」（ideal）では足りない。Chrome はそれを無視して一覧の先頭を選ぶ（実機で確かめた）。名指し（exact）なら既定が開く。
 */
const audioFor = (micId) => ({ ...AUDIO, deviceId: { exact: micId ?? 'default' } })
/** 名指しが通らないとき（マイクが外された、'default' という id が無いブラウザ）に使う、指定なしの開き方。 */
const audioAny = () => ({ ...AUDIO })

/** 使えるマイクの一覧。名前は、一度マイクを許可したあとでないと取れない。 */
export async function listMics() {
  const devices = await navigator.mediaDevices?.enumerateDevices?.().catch(() => [])
  return (devices ?? []).filter((d) => d.kind === 'audioinput').map((d) => ({ id: d.deviceId, label: d.label || d.deviceId, virtual: isVirtualMic(d.label) }))
}

/** マイクだけを開く。パネルでマイクを選び直したときに使う。 */
export async function openMicOnly(micId) {
  let { stream, error } = await request({ audio: audioFor(micId) })
  if (!stream && !micId) ({ stream, error } = await request({ audio: audioAny() }))
  stream = await avoidVirtualMic(stream, micId)
  return { stream, label: stream?.getAudioTracks()[0]?.label ?? '', error: explain(error, 'マイク') }
}

/** 仮想の入力を掴んでしまったら、実マイクに開き直す。人が自分で選んだ場合（micId あり）は、そのままにする。 */
async function avoidVirtualMic(stream, micId) {
  const track = stream?.getAudioTracks()[0]
  if (!track || micId || !isVirtualMic(track.label)) return stream
  const real = (await listMics()).find((mic) => !mic.virtual)
  if (!real) return stream
  const again = await request({ audio: audioFor(real.id) })
  if (!again.stream) return stream
  track.stop()
  return new MediaStream([...stream.getVideoTracks(), ...again.stream.getAudioTracks()])
}

async function request(constraints) {
  try {
    return { stream: await navigator.mediaDevices.getUserMedia(constraints), error: null }
  } catch (error) {
    return { stream: null, error }
  }
}

const explain = (error, what) => {
  if (!error) return ''
  if (error.name === 'NotAllowedError') return `${what}の使用が許可されていません`
  if (error.name === 'NotFoundError' || error.name === 'OverconstrainedError') return `${what}が見つかりません`
  if (error.name === 'NotReadableError') return `${what}をほかのアプリが使っています`
  return `${what}を開けません: ${error.message}`
}

/**
 * 戻り値は { stream, video, audio, errors: { video, audio } }。片方だけでも開けたら、開けたほうで進める。
 * カメラが無くても演出は試せるし、マイクが無くても声の加工以外は動く。
 */
export async function openCamera(videoElement, { micId = null } = {}) {
  if (!navigator.mediaDevices?.getUserMedia) {
    return { stream: null, video: false, audio: false, errors: { video: 'このブラウザではカメラを使えません', audio: 'このブラウザではマイクを使えません' } }
  }
  let { stream, error } = await request({ video: VIDEO, audio: audioFor(micId) })
  // マイクの名指しが通らなかっただけなら、指定なしでもう一度まとめて頼む（許可のダイアログを 1 回で済ませるため）
  if (!stream && error?.name === 'OverconstrainedError') ({ stream, error } = await request({ video: VIDEO, audio: audioAny() }))
  const errors = { video: '', audio: '' }
  if (!stream) {
    // どちらが原因か分からないので、別々に頼み直す
    const v = await request({ video: VIDEO })
    // 選んであったマイクが外されていることもある。だめなら指定なしで開き直す
    let a = await request({ audio: audioFor(micId) })
    if (!a.stream) a = await request({ audio: audioAny() })
    errors.video = explain(v.error, 'カメラ')
    errors.audio = explain(a.error, 'マイク')
    const tracks = [...(v.stream?.getTracks() ?? []), ...(a.stream?.getTracks() ?? [])]
    stream = tracks.length ? new MediaStream(tracks) : null
    if (!stream && !errors.video) errors.video = explain(error, 'カメラ')
  }
  stream = await avoidVirtualMic(stream, micId)
  const video = Boolean(stream?.getVideoTracks().length)
  const audio = Boolean(stream?.getAudioTracks().length)
  if (video) {
    videoElement.srcObject = new MediaStream(stream.getVideoTracks())
    videoElement.muted = true
    videoElement.playsInline = true
    await videoElement.play().catch(() => {})
  }
  return { stream, video, audio, errors, micLabel: stream?.getAudioTracks()[0]?.label ?? '' }
}

/**
 * カメラの代わりに、静止画を映像として流す。カメラの無い環境で、顔の追跡と映像の合成を確かめるためのもの（?camera=<画像の URL>）。
 * 戻り値の形は openCamera と同じ。音は無い。
 */
export async function openStill(videoElement, url) {
  const errors = { video: '', audio: 'カメラの代わりに静止画を使っています（マイクなし）' }
  try {
    const image = new Image()
    // 別オリジンの画像をそのまま描くとキャンバスが汚染され、映像として取り出せなくなる
    image.crossOrigin = 'anonymous'
    image.src = url
    await image.decode()
    // カメラと同じ 16:9 の枠に、画像の全体が入るように収める。縦長の写真をそのまま流すと、ステージに敷いたときに頭が切れる
    const canvas = Object.assign(document.createElement('canvas'), { width: 1280, height: 720 })
    const ctx = canvas.getContext('2d')
    const fit = Math.min(canvas.width / image.naturalWidth, canvas.height / image.naturalHeight)
    const w = image.naturalWidth * fit
    const h = image.naturalHeight * fit
    const paint = () => {
      ctx.fillStyle = '#1b2027'
      ctx.fillRect(0, 0, canvas.width, canvas.height)
      ctx.drawImage(image, (canvas.width - w) / 2, (canvas.height - h) / 2, w, h)
    }
    paint()
    // キャンバスの映像は、描き直したときだけ新しいフレームが出る。顔の検出は新しいフレームを待つので、描き直し続ける
    setInterval(paint, 66)
    const stream = canvas.captureStream(15)
    videoElement.srcObject = stream
    videoElement.muted = true
    videoElement.playsInline = true
    await videoElement.play().catch(() => {})
    return { stream, video: true, audio: false, errors }
  } catch (error) {
    return { stream: null, video: false, audio: false, errors: { ...errors, video: `画像を開けません: ${error.message}` } }
  }
}
