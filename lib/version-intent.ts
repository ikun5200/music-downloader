export type VersionTag =
  | 'live'
  | 'instrumental'
  | 'piano'
  | 'guitar'
  | 'remix'
  | 'cover'
  | 'acoustic'
  | 'demo'
  | 'alternate'

export type LanguageTag = 'cantonese' | 'mandarin' | 'english' | 'japanese' | 'korean'

// 用户明确写了这些版本/语言词时，选版目标就变成对应版本，而不是默认录音室原版。
export const VERSION_TAG_RULES: Array<[VersionTag, RegExp]> = [
  ['live', /live|现场|演唱会|音乐会|音乐节|unplugged|拉阔/i],
  ['instrumental', /伴奏|纯音乐|instrumental|karaoke|ktv|消音|钢琴|吉他/i],
  ['piano', /钢琴|piano/i],
  ['guitar', /吉他|guitar/i],
  ['remix', /remix|混音|\bdj\b|加速版|慢速版|降调|升调|0\.8x/i],
  ['cover', /翻唱|cover/i],
  ['acoustic', /acoustic|不插电/i],
  ['demo', /demo|小样/i],
  ['alternate', /重制|重录|新版|新编|\bversion\b/i],
]

export const LANGUAGE_TAG_RULES: Array<[LanguageTag, RegExp]> = [
  ['cantonese', /粤语|广东话/i],
  ['mandarin', /国语|普通话/i],
  ['english', /英文|英语/i],
  ['japanese', /日语/i],
  ['korean', /韩语/i],
]

function detectTags<T extends string>(text: string, rules: Array<[T, RegExp]>): T[] {
  return rules.filter(([, re]) => re.test(text)).map(([tag]) => tag)
}

export function detectVersionTags(text: string): VersionTag[] {
  return detectTags(text, VERSION_TAG_RULES)
}

export function detectLanguageTags(text: string): LanguageTag[] {
  return detectTags(text, LANGUAGE_TAG_RULES)
}

export function isVersionCompatible(
  tags: VersionTag[],
  requested: VersionTag[]
): boolean {
  if (!requested.length) return tags.length === 0
  const allowed = new Set<VersionTag>(requested)
  // 钢琴/吉他也属于器乐版；用户说“纯音乐/伴奏”时允许这两种细分。
  if (allowed.has('instrumental')) {
    allowed.add('piano')
    allowed.add('guitar')
  }
  return (
    requested.every((tag) => tags.includes(tag)) &&
    tags.every((tag) => allowed.has(tag))
  )
}

export function matchesVersionIntent(
  tags: { versionTags: VersionTag[]; languageTags: LanguageTag[] },
  requestedVersion: VersionTag[],
  requestedLanguage: LanguageTag[]
): boolean {
  return (
    isVersionCompatible(tags.versionTags, requestedVersion) &&
    requestedLanguage.every((tag) => tags.languageTags.includes(tag))
  )
}
