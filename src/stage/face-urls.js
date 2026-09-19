// 顔認識（MediaPipe Tasks Vision）の版と、その取得先。ブラウザの face.js と Node の scripts/fetch-vendor.js の両方が読むので、どちらの API にも触れない。
// 版を上げるときはここだけを変える。上げたら npm run fetch:vendor を回し直すこと（vendor/ は版ごとのフォルダなので、古いものは残る）。

export const VERSION = '1.0.1'

const CDN = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${VERSION}`
const MODEL = 'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task'

/**
 * 手元に落とすファイル。path は vendor/mediapipe/<VERSION>/ からの相対で、CDN 上の並びと同じにしてある。
 * SIMD の無い環境向けの vision_wasm_nosimd_internal.* は落とさない。対象は Chrome だけで、Chrome は必ず SIMD 版を選ぶ。
 * モデルは最後に置く。server.js は face_landmarker.task があるかどうかでその版が使えると判断するので、途中で失敗したときに半端なフォルダを使わせない。
 */
export const VENDOR_FILES = [
  { path: 'vision_bundle.mjs', url: `${CDN}/vision_bundle.mjs` },
  { path: 'wasm/vision_wasm_internal.js', url: `${CDN}/wasm/vision_wasm_internal.js` },
  { path: 'wasm/vision_wasm_internal.wasm', url: `${CDN}/wasm/vision_wasm_internal.wasm` },
  { path: 'face_landmarker.task', url: MODEL },
]

/** ブラウザが読みに行く先。vendorVersion（/api/status の vendor.mediapipe）があれば自分のサーバから、無ければ CDN から。 */
export function faceUrls(vendorVersion = null) {
  if (!vendorVersion) return { bundle: `${CDN}/vision_bundle.mjs`, wasm: `${CDN}/wasm`, model: MODEL }
  const base = `/vendor/mediapipe/${vendorVersion}`
  return { bundle: `${base}/vision_bundle.mjs`, wasm: `${base}/wasm`, model: `${base}/face_landmarker.task` }
}
