// MediaPipe の FaceLandmarker を読み込み、映像の 1 フレームから顔のランドマーク（478 点）を取る。ブラウザ専用。
// 読み込みにも検出にも失敗しうるが、例外は外へ出さない。顔エフェクトが出ないだけで、テロップと音はそのまま動かす。

import { faceUrls } from './face-urls.js'

const OPTIONS = { runningMode: 'VIDEO', numFaces: 1, outputFaceBlendshapes: false, outputFacialTransformationMatrixes: false }
// 検出の例外がこれだけ続いたら、1 フレームの取りこぼしではなく壊れた（WebGL コンテキストの喪失など）とみなす。
const MAX_ERRORS = 30

export function createFace() {
  let status = 'idle' // idle / loading / ready / failed
  let error = null
  let landmarker = null
  let loading = null
  let lastMs = 0
  let lastStamp = -1
  let errors = 0

  /** vendorVersion は /api/status の vendor.mediapipe。あれば自分のサーバから読み、無ければ CDN から読む。失敗したらもう一度呼べる。 */
  function load({ vendorVersion = null } = {}) {
    if (status === 'ready') return Promise.resolve(true)
    loading ??= (async () => {
      status = 'loading'
      error = null
      const urls = faceUrls(vendorVersion)
      try {
        // 静的 import にはしない。CDN に届かないとき（オフラインの現場）に、このモジュールを読むアプリ全体のモジュールグラフが落ちてしまう。
        const { FaceLandmarker, FilesetResolver } = await import(urls.bundle)
        const fileset = await FilesetResolver.forVisionTasks(urls.wasm)
        const create = async (delegate) => {
          const made = await FaceLandmarker.createFromOptions(fileset, { ...OPTIONS, baseOptions: { modelAssetPath: urls.model, delegate } })
          // 最初の 1 回はシェーダのコンパイルで 0.2〜3 秒かかる。本番の 1 フレームめで画面を固めないよう、真っ黒な画像でここで済ませておく。
          // GPU の不具合が推論して初めて表に出る環境も、ここで例外になって CPU へ回せる。
          try {
            made.detectForVideo(new ImageData(64, 64), 0)
          } catch (e) {
            made.close()
            throw e
          }
          return made
        }
        // GPU（WebGL）が使えない環境では例外になる。CPU でも 1 顔なら実用の速さが出るので、作り直す。
        landmarker = await create('GPU').catch(() => create('CPU'))
        lastStamp = 0
        errors = 0
        status = 'ready'
      } catch (e) {
        error = e instanceof Error ? e : new Error(String(e))
        status = 'failed'
      }
      loading = null
      return status === 'ready'
    })()
    return loading
  }

  /** 1 顔ぶんのランドマークか null。nowMs は performance.now() の値。 */
  function detect(video, nowMs) {
    if (status !== 'ready' || !video || video.readyState < 2 || !video.videoWidth) return null
    // MediaPipe はタイムスタンプが前回より大きくないと例外を投げる。同じフレーム時刻で 2 度呼ばれても進める。
    const stamp = nowMs > lastStamp ? nowMs : lastStamp + 1
    lastStamp = stamp
    const started = performance.now()
    try {
      const result = landmarker.detectForVideo(video, stamp)
      errors = 0
      return result.faceLandmarks?.[0] ?? null
    } catch (e) {
      // 1 フレーム落ちても続ける。続けて落ちるなら failed にして、呼び出し側が load() をやり直せるようにする。
      if (++errors >= MAX_ERRORS) {
        error = e instanceof Error ? e : new Error(String(e))
        status = 'failed'
        try {
          landmarker.close()
        } catch {}
        landmarker = null
      }
      return null
    } finally {
      lastMs = performance.now() - started
    }
  }

  return {
    load,
    detect,
    get status() {
      return status
    },
    get error() {
      return error
    },
    get lastMs() {
      return lastMs
    },
  }
}
