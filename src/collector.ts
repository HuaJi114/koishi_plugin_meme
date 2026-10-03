import { Context } from 'koishi'
import { MemeService } from './service'

interface PendingImage {
  resolve: (src: string | null) => void
  timer: ReturnType<typeof setTimeout>
}

/**
 * 图片收集器：等待用户在当前会话的下一条消息中发送图片。
 * 与 prompt 不同，prompt 只拿文本；图片必须靠监听下一条消息的元素。
 */
export class ImageCollector {
  private pending = new Map<string, PendingImage>()

  constructor(private ctx: Context) {}

  private key(session: any): string {
    return `${session.platform || ''}:${session.guildId || ''}:${session.userId || ''}`
  }

  /** 注册监听，等待下一条消息中的图片 */
  wait(session: any, timeout = 120_000): Promise<string | null> {
    const key = this.key(session)
    const existed = this.pending.get(key)
    if (existed) {
      // 同一会话只保留最新一次请求
      clearTimeout(existed.timer)
      existed.resolve(null)
      this.pending.delete(key)
    }
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.pending.delete(key)
        resolve(null)
      }, timeout)
      this.pending.set(key, { resolve, timer })
    })
  }

  /** 由中间件调用：若该会话正在等待图片且消息中含图片，则消费之 */
  consume(session: any): string | null {
    const key = this.key(session)
    const item = this.pending.get(key)
    if (!item) return null
    const images = (session.elements || []).filter((e: any) => e.type === 'image')
    if (!images.length) return null
    const src = images[0].attrs?.src || ''
    clearTimeout(item.timer)
    this.pending.delete(key)
    item.resolve(src || null)
    return src || null
  }

  /** 该会话是否有正在等待的图片 */
  isPending(session: any): boolean {
    return this.pending.has(this.key(session))
  }

  /** 中间件：命中等待中的图片请求则拦截该消息 */
  middleware = async (session: any, next: any) => {
    const consumed = this.consume(session)
    if (consumed) return
    return next()
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

export type { MemeService }
