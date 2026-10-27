/**
 * 酷我搜索接口返回的是 Python dict 风格的单引号字典。
 * 这里实现一个容错的 Python 字面量解析器，避免 Docker 镜像依赖 python3。
 */

class PythonLiteralParser {
  private i = 0
  private readonly s: string

  constructor(input: string) {
    this.s = input
  }

  parse(): unknown {
    const value = this.parseValue()
    this.skipWs()
    return value
  }

  private skipWs() {
    while (this.i < this.s.length && /\s/.test(this.s[this.i])) this.i++
  }

  private parseValue(): unknown {
    this.skipWs()
    const c = this.s[this.i]
    if (c === '{') return this.parseDict()
    if (c === '[') return this.parseList(']')
    if (c === '(') return this.parseList(')')
    if (c === "'" || c === '"') return this.parseString(c)
    if (c === '-' || c === '+' || /[0-9]/.test(c)) return this.parseNumber()
    return this.parseIdentifier()
  }

  private parseDict(): Record<string, unknown> {
    const out: Record<string, unknown> = {}
    this.i++ // {
    while (this.i < this.s.length) {
      this.skipWs()
      if (this.s[this.i] === '}') {
        this.i++
        return out
      }
      let key: string
      const c = this.s[this.i]
      if (c === "'" || c === '"') {
        key = this.parseString(c)
      } else {
        key = String(this.parseIdentifier())
      }
      this.skipWs()
      if (this.s[this.i] !== ':') throw new Error('Python dict: 缺少冒号')
      this.i++
      out[key] = this.parseValue()
      this.skipWs()
      if (this.s[this.i] === ',') {
        this.i++
        continue
      }
      if (this.s[this.i] === '}') {
        this.i++
        return out
      }
      throw new Error('Python dict: 缺少逗号或右括号')
    }
    throw new Error('Python dict: 未闭合')
  }

  private parseList(end: ']' | ')'): unknown[] {
    const out: unknown[] = []
    this.i++
    while (this.i < this.s.length) {
      this.skipWs()
      if (this.s[this.i] === end) {
        this.i++
        return out
      }
      out.push(this.parseValue())
      this.skipWs()
      if (this.s[this.i] === ',') {
        this.i++
        continue
      }
      if (this.s[this.i] === end) {
        this.i++
        return out
      }
      throw new Error('Python list: 缺少逗号或右括号')
    }
    throw new Error('Python list: 未闭合')
  }

  private parseString(quote: string): string {
    this.i++
    let out = ''
    while (this.i < this.s.length) {
      const c = this.s[this.i++]
      if (c === quote) return out
      if (c !== '\\') {
        out += c
        continue
      }
      const e = this.s[this.i++]
      switch (e) {
        case 'n':
          out += '\n'
          break
        case 'r':
          out += '\r'
          break
        case 't':
          out += '\t'
          break
        case 'b':
          out += '\b'
          break
        case 'f':
          out += '\f'
          break
        case 'v':
          out += '\v'
          break
        case '0':
          out += '\0'
          break
        case '\\':
        case "'":
        case '"':
          out += e
          break
        case 'x': {
          const hex = this.s.slice(this.i, this.i + 2)
          this.i += 2
          out += String.fromCharCode(parseInt(hex, 16))
          break
        }
        case 'u': {
          const hex = this.s.slice(this.i, this.i + 4)
          this.i += 4
          out += String.fromCharCode(parseInt(hex, 16))
          break
        }
        default:
          out += e
      }
    }
    throw new Error('Python string: 未闭合')
  }

  private parseNumber(): number {
    const start = this.i
    if (this.s[this.i] === '-' || this.s[this.i] === '+') this.i++
    while (/[0-9]/.test(this.s[this.i] || '')) this.i++
    if (this.s[this.i] === '.') {
      this.i++
      while (/[0-9]/.test(this.s[this.i] || '')) this.i++
    }
    if (this.s[this.i] === 'e' || this.s[this.i] === 'E') {
      this.i++
      if (this.s[this.i] === '-' || this.s[this.i] === '+') this.i++
      while (/[0-9]/.test(this.s[this.i] || '')) this.i++
    }
    const num = Number(this.s.slice(start, this.i))
    if (Number.isNaN(num)) throw new Error('Python number: 非法')
    return num
  }

  private parseIdentifier(): unknown {
    const start = this.i
    while (/[A-Za-z0-9_]/.test(this.s[this.i] || '')) this.i++
    const word = this.s.slice(start, this.i)
    if (word === 'True' || word === 'true') return true
    if (word === 'False' || word === 'false') return false
    if (word === 'None' || word === 'null') return null
    if (!word) throw new Error(`Python literal: 无法解析字符 ${this.s[this.i]}`)
    return word
  }
}

export function parsePythonLiteral(input: string): unknown {
  return new PythonLiteralParser(input).parse()
}

export function parseKuwoResponse(text: string): any {
  const trimmed = text.trim()
  try {
    return JSON.parse(trimmed)
  } catch {
    // fall through
  }
  try {
    return JSON.parse(trimmed.replace(/'/g, '"'))
  } catch {
    // fall through
  }
  return parsePythonLiteral(trimmed)
}
