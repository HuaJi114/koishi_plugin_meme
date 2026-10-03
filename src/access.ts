import { normalizeId, normalizeIdList } from './helpers'

/**
 * 群/频道访问过滤器：仅放行白名单内的会话。
 * 用 Context 过滤器（intersect）在指令注册层收口，比中间件 return 彻底。
 */
export function makeAccessFilter(ids: string[]) {
  const set = new Set(normalizeIdList(ids))
  return (session: any) => {
    const gid = normalizeId(session?.guildId || '')
    return !!gid && set.has(gid)
  }
}

/** 用户黑名单过滤器：命中即排除 */
export function makeUserFilter(ids: string[]) {
  const set = new Set(normalizeIdList(ids))
  return (session: any) => {
    const uid = normalizeId(session?.userId || '')
    return !!uid && set.has(uid)
  }
}
