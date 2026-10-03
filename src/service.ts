import { Context, Service } from 'koishi'
import { Config as MemeConfig, MemeEntry } from './config'
import { isPrivate, normalizeId, normalizeIdList } from './helpers'

declare module 'koishi' {
  interface Context {
    meme: MemeService
  }
  // 关键：注册表结构，否则 ctx.database.get('huaji_meme') 无类型
  interface Tables {
    huaji_meme: MemeEntry
  }
}

export class MemeService extends Service {
  static inject = ['database']

  public config: MemeConfig

  /** guildId + '|' + keyword -> 上次触发时间戳（毫秒），内存态，重启清零 */
  private cooldowns = new Map<string, number>()

  constructor(ctx: Context, config: MemeConfig) {
    super(ctx, 'meme', true)
    this.config = config
    this.extendModels()
  }

  /**
   * 建表。关键：字段必须全部在此注册，否则后续 set/create 会报 unknown field。
   * （本项目反复踩过的坑，新增字段务必同步这里）
   */
  private extendModels() {
    this.ctx.model.extend('huaji_meme', {
      // minato 用 'id' 声明自增整数主键（TS 类型未覆盖，故 as any）
      id: 'id' as any,
      userId: 'string',
      guildId: 'string',
      keyword: 'string',
      type: 'string',
      content: 'string',
      createdAt: 'timestamp',
    }, {
      primary: 'id',
      // id 为自增整数主键：必须显式声明 autoInc，否则 create 时会抛 missing primary key
      autoInc: true,
    })
  }

  // ───────────── 权限判定 ─────────────

  /** 是否为管理员：配置列表 或 Koishi 权限等级 ≥3 */
  isAdmin(session: any): boolean {
    if (session?.authority >= 3) return true
    const uid = normalizeId(session?.userId || '')
    if (!uid) return false
    return normalizeIdList(this.config.adminList).includes(uid)
  }

  /** 是否在用户黑名单中 */
  isBlacklisted(session: any): boolean {
    const uid = normalizeId(session?.userId || '')
    if (!uid) return false
    return normalizeIdList(this.config.userBlacklist).includes(uid)
  }

  /** 会话是否被群白名单拦截 */
  isGuildAllowed(session: any): boolean {
    if (isPrivate(session)) return this.config.allowPrivateChat
    const gid = normalizeId(session.guildId || '')
    if (!gid) return false
    if (this.config.groupWhitelistEnabled) {
      const allow = normalizeIdList(this.config.groupWhitelist)
      if (!allow.includes(gid)) return false
    }
    return true
  }

  /** 统一的前置拦截：无权访问时返回提示文本，null 表示放行 */
  checkAccess(session: any): string | null {
    if (!this.isGuildAllowed(session)) return '本群未开放梗词功能～'
    if (this.isBlacklisted(session)) return '你已被列入黑名单，无法使用本功能'
    return null
  }

  // ───────────── 配额 ─────────────

  /** 统计条数（minato 无 count()，用 get().length） */
  async countEntries(query: Record<string, any> = {}): Promise<number> {
    const list = await this.ctx.database.get('huaji_meme', query as any)
    return list.length
  }

  async getUserEntryCount(userId: string): Promise<number> {
    return this.countEntries({ userId })
  }

  /** 校验配额，返回错误文本或 null */
  async checkQuota(session: any): Promise<string | null> {
    const { maxUserEntries, maxTotalEntries } = this.config
    if (maxUserEntries > 0) {
      const userId = this.resolveUserId(session)
      const count = await this.getUserEntryCount(userId)
      if (count >= maxUserEntries) {
        return `你已创建 ${count} 条梗词，达到上限（${maxUserEntries} 条）`
      }
    }
    if (maxTotalEntries > 0) {
      const total = await this.countEntries()
      if (total >= maxTotalEntries) {
        return `全平台梗词总数已达上限（${maxTotalEntries} 条），请联系管理员清理`
      }
    }
    return null
  }

  /** 取得用于存储的 userId（带 platform 前缀，适配器无关） */
  resolveUserId(session: any): string {
    return session?.userId || ''
  }

  /** 校验关键词合法性 */
  validateKeyword(keyword: string): string | null {
    const key = (keyword || '').trim()
    if (!key) return '关键词不能为空'
    if (/\s/.test(key)) return '关键词不能包含空格'
    if (key.length > this.config.maxKeywordLength) {
      return `关键词过长（最多 ${this.config.maxKeywordLength} 个字符）`
    }
    return null
  }

  // ───────────── 冷却 ─────────────

  /** 冷却中返回 true；否则记录时间戳并返回 false */
  hitCooldown(guildId: string, keyword: string): boolean {
    const sec = this.config.cooldownSeconds
    if (sec <= 0) return false
    const key = `${guildId}|${keyword}`
    const now = Date.now()
    const last = this.cooldowns.get(key)
    if (last && now - last < sec * 1000) return true
    this.cooldowns.set(key, now)
    // 顺手清理过期项，防止长期运行内存膨胀
    if (this.cooldowns.size > 4096) {
      for (const [k, t] of this.cooldowns) {
        if (now - t > sec * 1000) this.cooldowns.delete(k)
      }
    }
    return false
  }

  /** 清空冷却（供测试与指令使用） */
  resetCooldown(): void {
    this.cooldowns.clear()
  }

  // ───────────── 查询 ─────────────

  /** 取本群某关键词的全部词条 */
  getEntries(guildId: string, keyword: string): Promise<MemeEntry[]> {
    return this.ctx.database.get('huaji_meme', { guildId, keyword })
  }

  /** 取出触发用的有效词条（过滤空内容） */
  async getUsableEntries(guildId: string, keyword: string): Promise<MemeEntry[]> {
    const all = await this.getEntries(guildId, keyword)
    return all.filter((e) => !!e.content)
  }
}
