import { Context, h } from 'koishi'
import { MemeService } from '../service'
import { ImageCollector, pickAtIds } from '../collector'
import { findTriggers } from './user'
import { getAtIds, isPrivate } from '../helpers'

/**
 * 触发中间件：早于指令解析（priority 1），消息命中关键词即发送对应文字/图片。
 *
 * 适配器差异（重要）：
 * - napcat / onebot 等能收到全部群消息 → 任意消息命中即触发，体验完整
 * - 官方 QQ 机器人群聊只推送 @机器人的消息（GROUP_AT_MESSAGE_CREATE），
 *   平台层面就收不到非 @ 消息，因此本中间件在官方 QQ 上天然退化为「@ 才触发」。
 *   另注意官方 QQ 群聊主动消息每月每群仅 4 条，被动回复限 5 分钟 5 次。
 */
export function applyTrigger(ctx: Context, srv: MemeService, collector: ImageCollector) {
  ctx.middleware(async (session, next) => {
        const content = (session.content || '').trim()
    const guildId = session.guildId

    // 私聊不触发（避免自问自答刷屏）
    if (isPrivate(session) || !guildId || !content) return next()
    if (!srv.config.autoTrigger) return next()
    if (srv.checkAccess(session)) return next()

    // 等待用户发图中：该消息不参与触发（否则「发送图片」可能被当关键词命中）
    if (collector.isPending(session)) return next()

    // 要求 @机器人 时校验 at 目标
    if (srv.config.requireAt && !hasAtSelf(ctx, session)) return next()

    const hits = await findTriggers(ctx.database, guildId, content, srv.config.matchMode)
    if (!hits.length) return next()

    // 只取最长命中的关键词，避免一句话多个词条刷屏
    const keyword = hits[0]
    if (srv.hitCooldown(guildId, keyword)) return next()

    const entries = await srv.getUsableEntries(guildId, keyword)
    if (!entries.length) return next()

    // 多条同名词条 → 完全随机抽一条
    const picked = entries[Math.floor(Math.random() * entries.length)]

    const atPayload = srv.config.atSenderOnTrigger ? atSelf(ctx, session) : ''
    if (picked.type === 'image') {
      await session.send([atPayload, h.image(picked.content)])
    } else {
      await session.send([atPayload, picked.content])
    }
    return next()
  })
}

/** 取得机器人自身 ID（不同适配器字段位置不同） */
function selfId(ctx: Context): string {
  const self = (ctx as any).self ?? (ctx as any).bot?.selfId
  if (!self) return ''
  if (typeof self === 'string') return self
  return String(self.id ?? self.userId ?? '')
}

/** at 目标元素 */
function atSelf(ctx: Context, session: any) {
  const id = selfId(ctx)
  return id ? h('at', id) : ''
}

/** 判断消息是否 @ 了机器人 */
function hasAtSelf(ctx: Context, session: any): boolean {
  const self = selfId(ctx)
  if (!self) return false
  const ids = [...getAtIds(session), ...pickAtIds(session)]
  if (ids.includes(self)) return true
  // 部分适配器（官方 QQ）userId 带 platform: 前缀，需同时比对原始值
  const raw = (session.elements || [])
    .filter((e: any) => e.type === 'at')
    .map((e: any) => String(e.attrs?.id ?? e.attrs?.target ?? ''))
  return raw.some((id: string) => id === self || id.endsWith(`:${self}`))
}
