import { Context } from 'koishi'

interface PendingItem {
  resolve: (src: string | null) => void
  timer: ReturnType<typeof setTimeout>
  /** 绑定的关键词（私聊收图模式下用于回溯） */
  keyword: string
  /** 发起指令时所在的群（私聊收图时用） */
  guildId: string
  /** 原始会话，用于私聊侧提示 */
  origin: any
}

/**
 * 图片收集器：等待用户发送图片。
 *
 * 两种采集模式（config.imageCollectMode）：
 * - `private`（默认）：在群里发指令后，引导用户**私聊机器人**发图。私聊不受「必须 @机器人」
 *   的限制，官方 QQ 机器人上唯一可靠的收图方式。
 * - `group`：在群里直接发图。要求该群已给机器人开通「获取群内全部消息」权限
 *   （QQ 群设置 → 机器人 → 机器人可获取的群聊消息范围），否则平台不上报纯图片消息。
 *
 * 两种模式都带超时（默认 2 分钟），超时自动清理，防止用户不发图导致队列被长期占用。
 */
export class ImageCollector {
  /** 私聊收图用：userId -> 待绑定项 */
  private pendingPrivate = new Map<string, PendingItem>()
  /** 群内收图用：platform:guildId:userId -> 待绑定项 */
  private pendingGroup = new Map<string, PendingItem>()

  constructor(private ctx: Context) {}

  private groupKey(session: any): string {
    return `${session.platform || ''}:${session.guildId || ''}:${session.userId || ''}`
  }

  private arm(
    map: Map<string, PendingItem>,
    key: string,
    session: any,
    keyword: string,
    timeout: number,
  ): Promise<string | null> {
    const existed = map.get(key)
    if (existed) {
      // 同一会话只保留最新一次请求，并让旧的立即失败返回
      clearTimeout(existed.timer)
      existed.resolve(null)
      map.delete(key)
    }
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        map.delete(key)
        resolve(null)
      }, timeout)
      map.set(key, { resolve, timer, keyword, guildId: session.guildId || '', origin: session })
    })
  }

  /** 私聊收图：等待该用户在私聊中发图 */
  waitPrivate(session: any, keyword: string, timeout: number): Promise<string | null> {
    return this.arm(this.pendingPrivate, session.userId || '', session, keyword, timeout)
  }

  /** 群内收图：等待该用户在当前群里发图 */
  waitGroup(session: any, keyword: string, timeout: number): Promise<string | null> {
    return this.arm(this.pendingGroup, this.groupKey(session), session, keyword, timeout)
  }

  /** 由中间件调用：若消息中含图片且有对应待绑定项，则消费之 */
  consume(session: any): string | null {
    // 私聊优先匹配（私聊是默认模式）
    const privKey = session.userId || ''
    const priv = session.guildId ? null : this.pendingPrivate.get(privKey)
    const grpKey = this.groupKey(session)
    const grp = session.guildId ? this.pendingGroup.get(grpKey) : null
    const item = priv || grp
    if (!item) return null

    const images = (session.elements || []).filter((e: any) => e.type === 'image')
    if (!images.length) return null

    const src = images[0].attrs?.src || ''
    clearTimeout(item.timer)
    if (priv) this.pendingPrivate.delete(privKey)
    if (grp) this.pendingGroup.delete(grpKey)
    item.resolve(src || null)
    return src || null
  }

  /** 取该用户待绑定项的关键词（供私聊收图时回填） */
  pendingKeywordOf(userId: string): string | null {
    return this.pendingPrivate.get(userId)?.keyword ?? null
  }

  /** 该用户是否有待绑定的私聊图片请求 */
  hasPendingPrivate(userId: string): boolean {
    return this.pendingPrivate.has(userId)
  }

  /** 该会话（群内）是否有待绑定的图片请求 */
  isPending(session: any): boolean {
    if (session.guildId) return this.pendingGroup.has(this.groupKey(session))
    return this.pendingPrivate.has(session.userId || '')
  }

  /** 取待绑定项的群号（私聊收图时用） */
  pendingGuildOf(userId: string): string {
    return this.pendingPrivate.get(userId)?.guildId || ''
  }

  /** 取消某用户的私聊待绑定（超时/取消时用） */
  cancelPrivate(userId: string): boolean {
    const item = this.pendingPrivate.get(userId)
    if (!item) return false
    clearTimeout(item.timer)
    this.pendingPrivate.delete(userId)
    item.resolve(null)
    return true
  }

  /** 清空所有待绑定（测试与重载用） */
  reset(): void {
    for (const map of [this.pendingPrivate, this.pendingGroup]) {
      for (const item of map.values()) {
        clearTimeout(item.timer)
        item.resolve(null)
      }
      map.clear()
    }
  }

}

/** 提取消息中第一张图片的 src */
export function pickImage(session: any): string | null {
  const images = (session.elements || []).filter((e: any) => e.type === 'image')
  if (!images.length) return null
  return images[0].attrs?.src || null
}

/** 提取消息中 @ 元素的纯 ID 列表 */
export function pickAtIds(session: any): string[] {
  const ats = (session.elements || []).filter((e: any) => e.type === 'at')
  return ats.map((e: any) => {
    const raw = e.attrs?.id ?? e.attrs?.target ?? ''
    const idx = String(raw).indexOf(':')
    return idx >= 0 ? String(raw).slice(idx + 1) : String(raw)
  }).filter(Boolean)
}
