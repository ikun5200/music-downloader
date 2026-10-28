import { describe, expect, it } from 'vitest'
import { cleanLyrics } from '../lib/metadata/lyrics'

describe('cleanLyrics', () => {
  it('去掉开头的作词/作曲/制作人和歌名，直接进入第一句歌词', () => {
    const raw = [
      '[00:00.00] 作词 : 林秋离',
      '[00:00.42] 作曲 : 林俊杰',
      '[00:00.84] 编曲 : 林俊杰',
      '[00:01.26] 制作人 : 林俊杰',
      '[00:01.68]杀手',
      '[00:05.98]作词：林秋离 作曲：林俊杰',
      '[00:10.89]演唱：林俊杰',
      '[00:15.63]',
      '[00:39.21]绝对的完美一双手',
    ].join('\n')
    const cleaned = cleanLyrics(raw, { title: '杀手', artist: '林俊杰' })
    expect(cleaned).toBe('[00:39.21]绝对的完美一双手')
  })

  it('处理“词 LYRICS：”“曲 COMPOSER :”，保留演唱者标签', () => {
    const raw = [
      '[00:00.00]为你揭晓 - 张艺兴/林俊杰',
      '[00:00.92]词 LYRICS：林怡凤',
      '[00:01.62]曲 COMPOSER：林俊杰',
      '[00:02.32]制作人 PRODUCER：林俊杰',
      '[00:18.10][01:07.01]LAY：',
      '[00:18.26]早已 不可考',
      '[00:37.49][01:31.59]JJ：',
      '[00:37.81]真不少',
      '[01:12.56]合：',
      '[01:12.81]不想说的你懂就好了',
    ].join('\n')
    const cleaned = cleanLyrics(raw, { title: '为你揭晓', artist: '张艺兴' })
    expect(cleaned).toContain('[00:18.26]早已 不可考')
    expect(cleaned).toContain('[00:37.81]真不少')
    expect(cleaned).toContain('[01:12.81]不想说的你懂就好了')
    expect(cleaned).toContain('LAY：')
    expect(cleaned).toContain('JJ：')
    expect(cleaned).toContain('合：')
    expect(cleaned).not.toContain('LYRICS')
    expect(cleaned).not.toContain('PRODUCER')
  })

  it('把中文歌词转成简体', () => {
    const raw = [
      '[00:29.36] 故事的小黃花',
      '[00:32.77] 從出生那年就飄著',
      '[00:56.57] 為妳翹課的那一天',
    ].join('\n')
    const cleaned = cleanLyrics(raw, { title: '晴天', artist: '周杰伦' })
    expect(cleaned).toBe(
      '[00:29.36]故事的小黄花\n[00:32.77]从出生那年就飘着\n[00:56.57]为你翘课的那一天'
    )
  })

  it('清理尾部的制作人员和分隔线', () => {
    const raw = [
      '[04:07.015]爱是时间的古董',
      '[04:17.022]-------------',
      '[04:31.926]弦乐编写 : 王韵筑',
      '[04:32.808]低音吉他 : 寗子达',
      '[04:36.042]鼓组音频编辑 : Buckley Buckley',
    ].join('\n')
    const cleaned = cleanLyrics(raw, { title: '交换余生', artist: '林俊杰' })
    expect(cleaned).toBe('[04:07.015]爱是时间的古董')
  })

  it('清理人声录音/封面设计，保留歌词行里的演唱者前缀', () => {
    const raw = [
      '[00:04.00]人声录音 : 林俊杰/瞿然',
      '[00:06.00]封面设计 : 方亮',
      '[00:17.74]封面企划：ABY',
      '[00:08.51]',
      '[00:20.51]韩红：风 让云长出花 漫天的花',
      '[00:27.10]无声开在乌云之下',
      '[00:37.98]林俊杰：漫步在人海的人 你过得好吗',
      '[00:52.74]合：它多久没说话',
    ].join('\n')
    const cleaned = cleanLyrics(raw, { title: '飞云之下', artist: '韩红/林俊杰' })
    expect(cleaned).toBe(
      [
        '[00:20.51]韩红：风 让云长出花 漫天的花',
        '[00:27.10]无声开在乌云之下',
        '[00:37.98]林俊杰：漫步在人海的人 你过得好吗',
        '[00:52.74]合：它多久没说话',
      ].join('\n')
    )
  })

  it('去掉开头的“歌名 - 歌手”标题行，但保留男/女/合前缀', () => {
    const raw = [
      '[00:00.00]珊瑚海 - 周杰伦 (Jay Chou)/Lara梁心颐 (lara Liang)',
      '[00:13.12]男：',
      '[00:15.16]海平面远方开始阴霾',
      '[00:41.24]女：',
      '[00:41.63]你用唇语说你要离开',
    ].join('\n')
    const cleaned = cleanLyrics(raw, { title: '珊瑚海', artist: '周杰伦/Lara梁心颐' })
    expect(cleaned).toBe(
      [
        '[00:13.12]男：',
        '[00:15.16]海平面远方开始阴霾',
        '[00:41.24]女：',
        '[00:41.63]你用唇语说你要离开',
      ].join('\n')
    )
  })

  it('第一句歌词恰好等于歌名时保留，不把它当标题行', () => {
    const raw = [
      '[00:02.44]我很想爱他',
      '[00:11.48]',
      '[00:32.48]天空 下起雨了',
      '[00:39.12]他撑的伞 在你身边陪着',
    ].join('\n')
    const cleaned = cleanLyrics(raw, { title: '我很想爱他', artist: '林俊杰' })
    expect(cleaned).toBe(
      [
        '[00:02.44]我很想爱他',
        '[00:11.48]',
        '[00:32.48]天空 下起雨了',
        '[00:39.12]他撑的伞 在你身边陪着',
      ].join('\n')
    )
  })

  it('标题行后面紧跟制作信息时仍然删除', () => {
    const raw = [
      '[00:00.00]杀手',
      '[00:00.42]作词 : 林秋离',
      '[00:00.84]作曲 : 林俊杰',
      '[00:39.21]绝对的完美一双手',
    ].join('\n')
    const cleaned = cleanLyrics(raw, { title: '杀手', artist: '林俊杰' })
    expect(cleaned).toBe('[00:39.21]绝对的完美一双手')
  })

  it('同一行多个时间戳按时间升序排列', () => {
    const raw = '[01:53.21][00:17.23]泪 有点咸 有点甜'
    const cleaned = cleanLyrics(raw, { title: '一眼万年', artist: '林俊杰' })
    expect(cleaned).toBe('[00:17.23][01:53.21]泪 有点咸 有点甜')
  })

  it('去掉无意义的 offset:0 标签', () => {
    const raw = ['[offset:0]', '[00:01.00] 作词 : 某人', '[00:10.00]第一句'].join('\n')
    const cleaned = cleanLyrics(raw, { title: '测试', artist: '歌手' })
    expect(cleaned).toBe('[00:10.00]第一句')
  })

  it('保留 offset 标签，避免时间轴偏移', () => {
    const raw = ['[offset:-500]', '[00:01.00] 作词 : 某人', '[00:10.00]第一句'].join('\n')
    const cleaned = cleanLyrics(raw, { title: '测试', artist: '歌手' })
    expect(cleaned).toBe('[offset:-500]\n[00:10.00]第一句')
  })

  it('关闭清理时只做简繁转换', () => {
    const raw = '[00:00.00] 作詞 : 某人\n[00:10.00] 故事的小黃花'
    const cleaned = cleanLyrics(raw, {
      title: '晴天',
      artist: '周杰伦',
      cleanCredits: false,
      simplify: true,
    })
    expect(cleaned).toContain('[00:00.00] 作词 : 某人')
    expect(cleaned).toContain('故事的小黄花')
  })
})
