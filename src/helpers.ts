/** 去掉 platform: 前缀，取纯数字 ID */
export function normalizeId(id: string): string {
  if (!id) return ''
  const idx = id.indexOf(':')
  return idx >= 0 ? id.slice(idx + 1) : id
}

/** 规范化配置里的 ID 列表：去空白、去前缀、去空 */
export function normalizeIdList(list: string[] | undefined): string[] {
  if (!list?.length) return []
  return list
    .map((x) => normalizeId(String(x).trim()))
    .filter((x) => x.length > 0)
}

/** 从 session 中取出被 @ 用户的纯 ID 集合 */
export function getAtIds(session: any): string[] {
  const ats = session.elements?.filter((e: any) => e.type === 'at') || []
  return ats
    .map((e: any) => normalizeId(e.attrs?.id ?? e.attrs?.target ?? ''))
    .filter((x: string) => x.length > 0)
}

/** 是否为私聊会话 */
export function isPrivate(session: any): boolean {
  return !session.guildId
}

/**
 * 关键词匹配
 * - fuzzy：content 去掉首尾空白后包含 keyword
 * - exact：content 去掉首尾空白后与 keyword 完全相等
 */
export function matchKeyword(content: string, keyword: string, mode: 'fuzzy' | 'exact'): boolean {
  if (!keyword) return false
  const text = (content || '').trim()
  const key = keyword.trim()
  if (!key) return false
  return mode === 'exact' ? text === key : text.includes(key)
}

/** 解析「关键词 内容」形式的指令参数 */
export function parseKeywordContent(input: string): { keyword: string; content: string } | null {
  const raw = (input || '').trim()
  if (!raw) return null
  const parts = raw.split(/\s+/, 2)
  const keyword = parts[0]
  const content = (parts[1] || '').trim()
  if (!keyword || !content) return null
  return { keyword, content }
}

/** 从文本中提取所有候选项，用于指令兜底（供测试复用） */
export function listMemeText(entries: { type: string; content: string }[]): string {
  return entries
    .map((e) => (e.type === 'image' ? '[图片]' : e.content))
    .join('\n')
}
