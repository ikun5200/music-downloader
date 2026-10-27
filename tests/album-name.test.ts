import { describe, expect, it } from 'vitest'
import { cleanAlbumName, isCompilationAlbum } from '../lib/metadata/normalize'

describe('album name normalization', () => {
  it('去掉 Single/EP 和主题曲说明', () => {
    expect(cleanAlbumName('交换余生 - Single')).toBe('交换余生')
    expect(cleanAlbumName('幸存者 - EP')).toBe('幸存者')
    expect(cleanAlbumName('7千3百多天 (JJ林俊杰《JJ20世界巡回演唱会》主题曲) - Single')).toBe(
      '7千3百多天'
    )
    expect(cleanAlbumName('明日座标 (王者荣耀十周年版本主题曲)')).toBe('明日座标')
    expect(cleanAlbumName('我对缘分小心翼翼 (剧集《逐玉》主题曲)')).toBe('我对缘分小心翼翼')
  })

  it('保留正式专辑名和概念专辑', () => {
    expect(cleanAlbumName('她说 概念自选辑')).toBe('她说 概念自选辑')
    expect(cleanAlbumName('西界')).toBe('西界')
    expect(cleanAlbumName('JJ的咖啡调调, Vol. 2 - EP')).toBe('JJ的咖啡调调, Vol.2')
  })

  it('仍能识别精选集合集', () => {
    expect(isCompilationAlbum('他是…JJ林俊杰')).toBe(true)
    expect(isCompilationAlbum('林俊杰2003年-2010年作品精选集')).toBe(true)
    expect(isCompilationAlbum('西界')).toBe(false)
  })
})
