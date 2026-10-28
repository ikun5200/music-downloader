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

const BRACKET_RE = /[\(\[【（]([^\)\]】）]*)[\)\]】）]/g
const QUERY_SPLIT_RE = /[\s,，、/&]+/

// 歌名本身可能包含“演唱会/现场”等词，例如《她来听我的演唱会》。
// 因此查询意图只认括号里的版本标记，或独立的版本词，不扫描整句。
const QUERY_VERSION_RULES: Array<[VersionTag, RegExp]> = [
  ['live', /^(?:live|现场|现场版|演唱会|演唱会版|音乐会|音乐节|unplugged|拉阔)(?:版|版本)?$/i],
  ['instrumental', /^(?:伴奏|伴奏版|纯音乐|纯音乐版|instrumental|karaoke|ktv|消音|钢琴|钢琴版|吉他|吉他版)(?:版|版本)?$/i],
  ['piano', /^(?:钢琴|钢琴版|piano)(?:版|版本)?$/i],
  ['guitar', /^(?:吉他|吉他版|guitar)(?:版|版本)?$/i],
  ['remix', /^(?:remix|混音|dj|加速版|慢速版|降调|升调|0\.8x)(?:版|版本)?$/i],
  ['cover', /^(?:翻唱|cover)(?:版|版本)?$/i],
  ['acoustic', /^(?:acoustic|不插电)(?:版|版本)?$/i],
  ['demo', /^(?:demo|小样)(?:版|版本)?$/i],
  ['alternate', /^(?:version|重制|重录|新版|新编)(?:版|版本)?$/i],
]

const QUERY_LANGUAGE_RULES: Array<[LanguageTag, RegExp]> = [
  ['cantonese', /^(?:粤语|粤语版|广东话)(?:版|版本)?$/i],
  ['mandarin', /^(?:国语|国语版|普通话)(?:版|版本)?$/i],
  ['english', /^(?:英文|英文版|英语)(?:版|版本)?$/i],
  ['japanese', /^(?:日语|日语版)(?:版|版本)?$/i],
  ['korean', /^(?:韩语|韩语版)(?:版|版本)?$/i],
]

function bracketTexts(query: string): string[] {
  const texts: string[] = []
  for (const match of query.matchAll(BRACKET_RE)) {
    if (match[1]) texts.push(match[1])
  }
  return texts
}

function queryTokens(query: string): string[] {
  return query.split(QUERY_SPLIT_RE).filter(Boolean)
}

export function detectQueryVersionTags(query: string): VersionTag[] {
  const tags = new Set<VersionTag>()
  for (const text of bracketTexts(query)) {
    for (const tag of detectVersionTags(text)) tags.add(tag)
  }
  for (const token of queryTokens(query)) {
    for (const [tag, re] of QUERY_VERSION_RULES) {
      if (re.test(token)) tags.add(tag)
    }
  }
  return [...tags]
}

export function detectQueryLanguageTags(query: string): LanguageTag[] {
  const tags = new Set<LanguageTag>()
  for (const text of bracketTexts(query)) {
    for (const tag of detectLanguageTags(text)) tags.add(tag)
  }
  for (const token of queryTokens(query)) {
    for (const [tag, re] of QUERY_LANGUAGE_RULES) {
      if (re.test(token)) tags.add(tag)
    }
  }
  return [...tags]
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
