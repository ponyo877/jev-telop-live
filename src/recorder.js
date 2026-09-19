// 録画。映像（ウィンドウ、このタブ、ステージだけ）と、アプリの中で混ぜた音（SE と声）を 1 本の動画にして保存する。
// ウィンドウやタブの映像は、ブラウザの画面共有（getDisplayMedia）で取る。macOS の Chrome はウィンドウの共有では音を渡してくれないので、音は自前で混ぜたものを使う。
// ファイル名や形式を決める部分は DOM に依存しない。

/** 保存する形式の候補。YouTube や編集ソフトで扱いやすい mp4 を先に試し、だめなら webm。 */
export const MIME_CANDIDATES = [
  'video/mp4;codecs=avc1.64003E,mp4a.40.2',
  'video/mp4;codecs=avc1.42E01E,mp4a.40.2',
  'video/mp4',
  'video/webm;codecs=vp9,opus',
  'video/webm;codecs=vp8,opus',
  'video/webm',
]

/** isSupported(mime) が true を返す最初の候補。どれも無ければ空文字（ブラウザの既定に任せる）。 */
export const pickMimeType = (isSupported) => MIME_CANDIDATES.find((mime) => isSupported(mime)) ?? ''

const two = (n) => String(n).padStart(2, '0')

/** jev-live-20260919-101530.mp4 */
export function recordingName(date, mimeType) {
  const stamp = `${date.getFullYear()}${two(date.getMonth() + 1)}${two(date.getDate())}-${two(date.getHours())}${two(date.getMinutes())}${two(date.getSeconds())}`
  return `jev-live-${stamp}.${mimeType.startsWith('video/mp4') ? 'mp4' : 'webm'}`
}

/** 65000 → 1:05 */
export function formatElapsed(ms) {
  const sec = Math.max(0, Math.floor(ms / 1000))
  return `${Math.floor(sec / 60)}:${two(sec % 60)}`
}

/** 映す範囲。window はブラウザの枠とパネルも入る。tab はページだけ。stage はステージのキャンバスだけ。 */
export const SURFACES = ['window', 'tab', 'stage']

/** 画面共有に渡す指定。どの範囲を選ぶかは最後はブラウザの選択画面で人が決めるので、これは初期表示の希望にすぎない。 */
export function displayOptions(surface) {
  if (surface === 'tab') return { video: { frameRate: 30 }, audio: false, preferCurrentTab: true }
  return { video: { displaySurface: 'window', frameRate: 30 }, audio: false, selfBrowserSurface: 'include' }
}

const explain = (error) => {
  if (error?.name === 'NotAllowedError') return '画面の共有が許可されませんでした。選択画面でキャンセルしたか、macOS の「画面収録」で Chrome が許可されていません'
  if (error?.name === 'NotFoundError') return '共有できる画面が見つかりません'
  return `録画を始められません: ${error?.message ?? error}`
}

/**
 * canvas: ステージ（surface が stage のときに録る）。audioStream(): 録画に入れる音の MediaStream を返す関数（無ければ映像だけ）。
 * 通知: onState({ recording, startedAt }), onSaved({ name, bytes }), onError(message)
 */
export function createRecorder({ canvas, audioStream, onState = () => {}, onSaved = () => {}, onError = () => {} }) {
  let recorder = null
  let tracks = []
  let chunks = []
  let startedAt = 0

  function save(mimeType) {
    const blob = new Blob(chunks, { type: mimeType || chunks[0]?.type || 'video/webm' })
    chunks = []
    if (!blob.size) return onError('録画が空でした')
    const name = recordingName(new Date(), blob.type)
    const url = URL.createObjectURL(blob)
    const link = Object.assign(document.createElement('a'), { href: url, download: name })
    document.body.append(link)
    link.click()
    link.remove()
    // すぐ破棄すると、ダウンロードが始まる前に消えることがある
    setTimeout(() => URL.revokeObjectURL(url), 60000)
    onSaved({ name, bytes: blob.size })
  }

  function stop() {
    if (recorder?.state === 'recording') recorder.stop()
  }

  return {
    get recording() {
      return recorder?.state === 'recording'
    },

    /** ユーザー操作のハンドラから呼ぶ。画面共有の選択画面は、操作の文脈が無いと開けない。 */
    async start(surface = 'window') {
      if (recorder?.state === 'recording') return
      let video
      try {
        video = surface === 'stage' ? canvas.captureStream(30).getVideoTracks()[0] : (await navigator.mediaDevices.getDisplayMedia(displayOptions(surface))).getVideoTracks()[0]
      } catch (error) {
        return onError(explain(error))
      }
      const audio = audioStream?.()?.getAudioTracks() ?? []
      tracks = [video]
      const mimeType = pickMimeType((mime) => MediaRecorder.isTypeSupported(mime))
      try {
        recorder = new MediaRecorder(new MediaStream([video, ...audio]), { ...(mimeType ? { mimeType } : {}), videoBitsPerSecond: 12_000_000, audioBitsPerSecond: 192_000 })
      } catch (error) {
        video.stop()
        return onError(explain(error))
      }
      chunks = []
      recorder.ondataavailable = (e) => e.data.size && chunks.push(e.data)
      recorder.onerror = (e) => onError(explain(e.error))
      recorder.onstop = () => {
        // 音の出口はアプリが使い続けるので止めない。止めるのは映像（画面共有）だけ
        for (const track of tracks) track.stop()
        tracks = []
        onState({ recording: false, startedAt: 0 })
        save(recorder.mimeType)
      }
      // ブラウザの「共有を停止」で映像が終わったら、そこまでを保存する
      video.addEventListener('ended', stop)
      // 途中でタブが落ちても、そこまでのかたまりは手元に残るように、1 秒ごとに受け取る
      recorder.start(1000)
      startedAt = performance.now()
      onState({ recording: true, startedAt })
    },

    stop,
  }
}
