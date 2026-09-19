// 出せる演出の閉集合。Jev は文章を作らないので、画面と音に出るものはすべてここから選ぶ。DOM に依存しない。
// id と criteria と束（どの擬音・効果・SE を一緒に出すか）はここだけに置く。見た目と音の作り方は src/stage/ と src/audio/ が同じ id で持つ。
// criteria は Jev に送る文面なので英語。「表示 (英訳): 具体例」の形にそろえる。

/** 瞬発系の画面効果。 */
export const FX = ['focus', 'flash', 'gloomlines', 'sparkle', 'spotlight', 'tilt']
/** 持続系。顔に付けるもの、画面全体にかけるもの、声にかけるもの。 */
export const FACE = ['sunglasses', 'blush', 'anger', 'sweat', 'gloom']
export const SCREEN = ['dark', 'rain', 'wave', 'glitch', 'redtint', 'scanline']
export const VOICE = ['pitch_up', 'pitch_down', 'robot', 'distortion', 'echo']
/** サングラスのレンズの色。サングラスは常に掛けていて、ふだんは黒。ムードが入ると、そのムードの色に変わる。 */
export const SHADES = ['gold', 'blue', 'red', 'purple', 'green', 'pink', 'rainbow', 'sunset']
/** 熱量の段階。score の criteria にそのまま渡す（順序つきの配列）。 */
export const HEAT_LEVELS = ['deadpan', 'calm', 'animated', 'excited', 'explosive']

/**
 * 瞬発系の演出（cue）。1 つ選ぶと、擬音・画面効果・SE が束で出る。
 * レイヤーごとに別々に選ばせると「ガーン + 笑い声 + キラキラ」のような噛み合わない組が出るので、組み合わせはこの表で決めておく。
 * giongo は熱量の弱・中・強。fx は熱量が fxMinHeat 以上のときだけ付く。
 */
export const CUES = [
  { id: 'none', giongo: null, fx: null, fxMinHeat: 0, se: null, criteria: 'No effect: ordinary talk, explanation, filler, or a sentence still building up. Nothing a TV editor would decorate.' },
  { id: 'don', giongo: ['ドン', 'ドン!', 'ドドン!!'], fx: 'focus', fxMinHeat: 0.5, se: 'don', criteria: 'ドン! (impact): a bold declaration, a big reveal, a number or fact stated with force.' },
  { id: 'gaan', giongo: ['ガーン', 'ガーン', 'ガガーン!'], fx: 'gloomlines', fxMinHeat: 0, se: 'gaan', criteria: 'ガーン (shock and dismay): bad news hits the speaker, disappointment, a plan falls apart.' },
  { id: 'zawa', giongo: ['ざわ…', 'ざわ…ざわ…', 'ざわ…ざわ…ざわ…'], fx: null, fxMinHeat: 0, se: 'zawa', criteria: 'ざわ…ざわ… (uneasy tension): something suspicious or ominous, a bad feeling, nervous suspense.' },
  { id: 'kiran', giongo: ['キラッ', 'キラーン', 'キラーン☆'], fx: 'sparkle', fxMinHeat: 0, se: 'kiran', criteria: 'キラーン (smug sparkle): showing off, a confident boast, a "nailed it" moment.' },
  { id: 'bishi', giongo: ['ビシッ', 'ビシッ!', 'ビシィッ!!'], fx: 'flash', fxMinHeat: 0.4, se: 'slap', criteria: 'ビシッ! (tsukkomi): a sharp retort pointing out how absurd something is, like "なんでやねん".' },
  { id: 'laugh', giongo: ['フフッ', 'ドッ', 'ドッ!!'], fx: null, fxMinHeat: 0, se: 'laugh', criteria: 'Audience laughter: the speaker just landed a joke, or said something silly on purpose (boke).' },
  { id: 'zukoo', giongo: ['ズコ', 'ズコー', 'ズコーッ!'], fx: 'tilt', fxMinHeat: 0, se: 'zukoo', criteria: 'ズコー (pratfall): an anticlimax, a letdown ending, "it was all a dream", a lame pun.' },
  { id: 'eee', giongo: ['えっ', 'ええっ!?', 'えええっ!?'], fx: 'focus', fxMinHeat: 0.3, se: 'eee', criteria: 'ええっ!? (surprise): the speaker is startled or amazed by something unexpected.' },
  { id: 'shiin', giongo: ['シーン…', 'シーン…', 'シーーン……'], fx: null, fxMinHeat: 0, se: 'wind', criteria: 'シーン… (awkward silence): a joke falls flat, nobody reacts, an embarrassing pause.' },
  { id: 'chiin', giongo: ['チーン', 'チーン', 'チーン…'], fx: 'spotlight', fxMinHeat: 0, se: 'chiin', criteria: 'チーン (it is over): resignation, giving up, total defeat.' },
  { id: 'pikon', giongo: ['ピコン', 'ピコーン!', 'ピコーン!!'], fx: 'flash', fxMinHeat: 0.6, se: 'pikon', criteria: 'ピコーン! (idea): a sudden idea or realization.' },
  { id: 'gogogo', giongo: ['ゴゴゴ', 'ゴゴゴゴ', 'ゴゴゴゴゴゴ'], fx: null, fxMinHeat: 0, se: 'rumble', criteria: 'ゴゴゴゴ (menace): rising anger, an intimidating threat, a showdown about to start.' },
  { id: 'doki', giongo: ['ドキ', 'ドキッ', 'ドキィッ!'], fx: null, fxMinHeat: 0, se: 'heartbeat', criteria: 'ドキッ (heart skips): flustered, embarrassed, a secret exposed.' },
  { id: 'mera', giongo: ['メラ', 'メラメラ', 'メラメラメラ!'], fx: 'focus', fxMinHeat: 0.7, se: 'fire', criteria: 'メラメラ (fired up): burning motivation, fighting spirit.' },
  { id: 'pachi', giongo: ['パチ', 'パチパチ', 'パチパチパチ!'], fx: 'sparkle', fxMinHeat: 0.5, se: 'clap', criteria: 'パチパチ (applause): a success, an achievement, good news.' },
]

/** 発話テロップの様式。オチを言ったときだけ使うので none は無い。 */
export const STYLES = [
  { id: 'impact', se: 'don', criteria: 'A forceful statement, a reveal or a loud exclamation.' },
  { id: 'tsukkomi', se: 'slap', criteria: 'A sharp retort or complaint pointing out absurdity.' },
  { id: 'funny', se: 'laugh', criteria: 'A silly, playful or goofy line.' },
  { id: 'sad', se: 'chiin', criteria: 'A sad, pitiful or self-deprecating line.' },
  { id: 'horror', se: 'zawa', criteria: 'A creepy, ominous or threatening line.' },
  { id: 'cool', se: 'kiran', criteria: 'A smug, cool, dramatic one-liner.' },
  { id: 'cute', se: 'pikon', criteria: 'A cute, sweet or affectionate line.' },
  { id: 'plain', se: null, criteria: 'A neutral line worth showing as it is.' },
]

/**
 * 持続系のムード。1 つ選ぶと、サングラスの色・顔・画面・声の効果が束でかかる。同時に有効なのは 1 つだけ。
 * サングラスそのものは常に掛けているので、束には入れない。ムードが決めるのはレンズの色だけ。
 */
export const MOODS = [
  { id: 'none', layers: {}, criteria: 'Neutral: ordinary talk with no sustained mood.' },
  { id: 'gloom', layers: { shades: ['blue'], face: ['gloom'], screen: ['dark', 'rain'] }, criteria: 'Gloom: the speaker keeps talking about sad, depressing or hopeless things.' },
  { id: 'cool', layers: { shades: ['gold'], voice: ['pitch_down'] }, criteria: 'Swagger: the speaker keeps bragging, acting cool or tough.' },
  { id: 'horror', layers: { shades: ['purple'], screen: ['dark', 'wave'], voice: ['pitch_down', 'echo'] }, criteria: 'Horror: a scary story, ghost talk, an eerie atmosphere.' },
  { id: 'panic', layers: { shades: ['rainbow'], face: ['sweat'], screen: ['glitch'], voice: ['distortion'] }, criteria: 'Panic: flustered, confused, things keep going wrong or breaking.' },
  { id: 'rage', layers: { shades: ['red'], face: ['anger'], screen: ['redtint'], voice: ['distortion'] }, criteria: 'Rage: sustained anger, ranting.' },
  { id: 'robot', layers: { shades: ['green'], screen: ['scanline'], voice: ['robot'] }, criteria: 'Robotic: imitating a robot, or flat mechanical talk about AI and machines.' },
  { id: 'cute', layers: { shades: ['pink'], face: ['blush'], voice: ['pitch_up'] }, criteria: 'Cutesy: acting cute, baby talk.' },
  { id: 'dreamy', layers: { shades: ['sunset'], screen: ['wave'], voice: ['echo'] }, criteria: 'Daydream: fantasies, nostalgic memories, "imagine if".' },
]

const index = (rows) => Object.fromEntries(rows.map((row) => [row.id, row]))

export const CUE_BY_ID = index(CUES)
export const STYLE_BY_ID = index(STYLES)
export const MOOD_BY_ID = index(MOODS)
export const CUE_IDS = CUES.map((c) => c.id)
export const STYLE_IDS = STYLES.map((s) => s.id)
export const MOOD_IDS = MOODS.map((m) => m.id)
/** none を除いた id。noul はこれらにだけ聞く。 */
export const FIREABLE_CUE_IDS = CUE_IDS.filter((id) => id !== 'none')
export const ACTIVE_MOOD_IDS = MOOD_IDS.filter((id) => id !== 'none')
/** 使う SE の一覧。assets/se/<id>.mp3 のファイル名と 1 対 1。 */
export const SE_IDS = [...new Set([...CUES, ...STYLES].map((row) => row.se).filter(Boolean))]
export const LAYERS = { shades: SHADES, face: FACE, screen: SCREEN, voice: VOICE }

/** 熱量（0..1）を擬音の弱・中・強に分ける。 */
export const giongoLevel = (heat) => (heat < 0.35 ? 0 : heat < 0.7 ? 1 : 2)

/** cue を、その熱量で実際に出す束に展開する。none と未知の id は空の束。 */
export function expandCue(id, heat = 0.5) {
  const cue = CUE_BY_ID[id]
  if (!cue || !cue.giongo) return { giongo: null, fx: null, se: null }
  return {
    giongo: cue.giongo[giongoLevel(heat)],
    fx: cue.fx && heat >= cue.fxMinHeat ? cue.fx : null,
    se: cue.se,
  }
}

/** mood を [{ layer, id }] に展開する。none と未知の id は空。 */
export function expandMood(id) {
  const layers = MOOD_BY_ID[id]?.layers ?? {}
  return Object.entries(layers).flatMap(([layer, ids]) => ids.map((effect) => ({ layer, id: effect })))
}
