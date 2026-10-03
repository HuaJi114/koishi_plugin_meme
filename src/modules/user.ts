import { Context } from 'koishi'
import { MemeEntry } from '../config'
import { MemeService } from '../service'
 import { ImageCollector, pickImage } from '../collector'
import { parseKeywordContent } from '../helpers'

const PROMPT_MS = 120_000

/** 展示词条列表（按关键词分组，同名多条内容缩进列出） */
export function renderEntries(entries: MemeEntry[], showOwner = false, showId = false): string {
  const groups = new Map<string, MemeEntry[]>()
  for (const e of entries) {
    if (!groups.has(e.keyword)) groups.set(e.keyword, [])
    groups.get(e.keyword)!.push(e)
  }
  const lines: string[] = []
  let idx = 0
  for (const [keyword, list] of groups) {
    idx += 1
    lines.push(`${idx}. 【${keyword}】（${list.length} 条）`)
    for (const e of list) {
      const body = e.type === 'image' ? '[图片]' : e.content
      const tags: string[] = []
      if (showId) tags.push(`#${e.id}`)
      if (showOwner) tags.push(e.userId)
      const suffix = tags.length ? `（${tags.join(' / ')}）` : ''
      lines.push(`   - ${body}${suffix}`)
    }
  }
  return lines.join('\n')
}

/**
 * 找出消息命中的关键词列表。
 * fuzzy 模式下按长度倒序，并剔除被更长命中包含的短词，避免「哈」与「哈哈」同时命中导致刷屏。
 */
export async function findTriggers(
  db: any,
  guildId: string,
  content: string,
  mode: 'fuzzy' | 'exact',
): Promise<string[]> {
  const all: MemeEntry[] = await db.get('huaji_meme', { guildId })
  const keywords = [...new Set(all.map((e) => e.keyword).filter(Boolean))]
  const text = (content || '').trim()
  const hit = keywords.filter((k) => (mode === 'exact' ? text === k.trim() : text.includes(k)))
  hit.sort((a, b) => b.length - a.length)
  const result: string[] = []
  for (const k of hit) {
    if (result.some((r) => r.includes(k))) continue
    result.push(k)
  }
  return result
}

/** 判断内容是否像图片链接（编辑梗时用于推断类型） */
function looksLikeImage(src: string): boolean {
  return /\.(png|jpe?g|gif|webp|bmp)(\?|$)/i.test(src)
}

export function applyUserCommands(ctx: Context, srv: MemeService, collector: ImageCollector) {

  // ── 梗帮助 ──
  ctx.command('梗帮助')
    .alias('meme帮助')
    .action(async ({ session }: any) => {
      const s = srv
      const denied = s.checkAccess(session)
      if (denied) return denied
      const c = s.config
      return [
        '【梗词玩法】',
        '· 添加梗 <关键词> <文字内容>  —— 绑定一段文字',
        '· 添加梗图                    —— 按提示依次发送图片、回复关键词',
        '· 添加梗图 <关键词>            —— 直接带关键词，随后发图',
        '· 编辑梗 <关键词>             —— 修改自己绑定的内容（文字/图片均可）',
        '· 删除梗 <关键词>             —— 删除自己绑定的全部同名词条',
        '· 我的梗                      —— 查看自己创建的词条',
        '· 梗列表                      —— 查看本群全部词条',
        '· 梗帮助                      —— 本帮助',
        '',
        `触发方式：${c.matchMode === 'exact' ? '整条消息完全等于关键词' : '消息中出现关键词即触发'}${c.requireAt ? '（需 @机器人）' : ''}`,
        '同一关键词可绑定多条内容，触发时随机发送其中一条。',
        '管理员可使用【管理梗列表】/【管理删除】/【管理清空】/【管理设置】。',
      ].join('\n')
    })

  // ── 添加梗 <关键词> <内容> ──
  // 用 <rest: string> 吞掉剩余全部文本（内容里的空格必须保留）
  ctx.command('添加梗 <rest: string>')
    .action(async ({ session }: any, ...argv: string[]) => {
      const s = srv
      const denied = s.checkAccess(session)
      if (denied) return denied
      const parsed = parseKeywordContent(argv.join(' '))
      if (!parsed) return '用法：添加梗 <关键词> <文字内容>，例如「添加梗 233 你干嘛哎哟」'
      const { keyword, content } = parsed
      const bad = s.validateKeyword(keyword)
      if (bad) return bad
      const quota = await s.checkQuota(session)
      if (quota) return quota

      await ctx.database.create('huaji_meme', {
        userId: s.resolveUserId(session),
        guildId: session.guildId,
        keyword,
        type: 'text',
        content,
        createdAt: new Date(),
      })
      return `已绑定文字梗：说到「${keyword}」时我会回：${content}`
    })

  // ── 添加梗图（无参：交互式） ──
  ctx.command('添加梗图')
    .alias('加图')
    .action(async ({ session }: any) => {
      const s = srv
      const denied = s.checkAccess(session)
      if (denied) return denied
      const quota = await s.checkQuota(session)
      if (quota) return quota

      await session.send('请在 2 分钟内直接发送图片（可附带任意说明文字）。')
      const src = await collector.wait(session, PROMPT_MS)
      if (!src) return '未收到图片，已取消。可重新发送【添加梗图】再试。'

      await session.send('图片已收到！请回复这个梗的关键词（不含空格）。')
      const keyword = (await session.prompt(PROMPT_MS))?.trim() ?? ''
      if (!keyword) return '关键词输入超时，已取消。'
      const bad = s.validateKeyword(keyword)
      if (bad) return `${bad}，已取消。`

      const quota2 = await s.checkQuota(session)
      if (quota2) return quota2

      await ctx.database.create('huaji_meme', {
        userId: s.resolveUserId(session),
        guildId: session.guildId,
        keyword,
        type: 'image',
        content: src,
        createdAt: new Date(),
      })
      return `已绑定图片梗：说到「${keyword}」时我会发这张图`
    })

  // ── 添加梗图 <关键词> ──
  ctx.command('添加梗图 <keyword: string>')
    .action(async ({ session }: any, ...argv: string[]) => {
      const s = srv
      const denied = s.checkAccess(session)
      if (denied) return denied
      const keyword = (argv[0] || '').trim()
      const bad = s.validateKeyword(keyword)
      if (bad) return bad
      const quota = await s.checkQuota(session)
      if (quota) return quota

      await session.send(`请在 2 分钟内直接发送图片，绑定到关键词「${keyword}」。`)
      const src = await collector.wait(session, PROMPT_MS)
      if (!src) return '未收到图片，已取消。'

      await ctx.database.create('huaji_meme', {
        userId: s.resolveUserId(session),
        guildId: session.guildId,
        keyword,
        type: 'image',
        content: src,
        createdAt: new Date(),
      })
      return `已绑定图片梗：说到「${keyword}」时我会发这张图`
    })

  // ── 编辑梗 <关键词> ──
  ctx.command('编辑梗 <keyword: string>')
    .action(async ({ session }: any, ...argv: string[]) => {
      const s = srv
      const denied = s.checkAccess(session)
      if (denied) return denied
      if (!s.config.allowEdit) return '本群已关闭【编辑梗】功能，请删除后重新添加。'
      const keyword = (argv[0] || '').trim()
      if (!keyword) return '用法：编辑梗 <关键词>'

      const isAdmin = s.isAdmin(session)
      const all = await s.getEntries(session.guildId, keyword)
      const mine = all.filter((e) => e.userId === s.resolveUserId(session))
      const target = isAdmin && all.length ? all : mine
      if (!target.length) {
        return isAdmin ? `本群没有关键词「${keyword}」` : `你还没有创建过关键词「${keyword}」`
      }

      let entry = target[0]
      if (target.length > 1) {
        const list = target
          .map((e, i) => `${i + 1}. ${e.type === 'image' ? '[图片]' : e.content}`)
          .join('\n')
        await session.send(`关键词「${keyword}」共有 ${target.length} 条内容：\n${list}\n请回复要修改的序号。`)
        const choice = (await session.prompt(PROMPT_MS))?.trim() ?? ''
        const n = Number(choice)
        if (!Number.isInteger(n) || n < 1 || n > target.length) return '序号无效，已取消。'
        entry = target[n - 1]
      }

      await session.send('请发送新的内容：发文字直接输入，发图片直接发图。')
      const directImage = pickImage(session)
      const src = directImage ?? (await session.prompt(PROMPT_MS))?.trim() ?? ''
      if (!src) return '未提供新内容，已取消。'

      await ctx.database.set('huaji_meme', { id: entry.id }, {
        type: (directImage || looksLikeImage(src)) ? 'image' : 'text',
        content: src,
      })
      return `已更新关键词「${keyword}」的内容。`
    })

  // ── 删除梗 <关键词> ──
  ctx.command('删除梗 <keyword: string>')
    .alias('删梗 <keyword: string>')
    .action(async ({ session }: any, ...argv: string[]) => {
      const s = srv
      const denied = s.checkAccess(session)
      if (denied) return denied
      const keyword = (argv[0] || '').trim()
      if (!keyword) return '用法：删除梗 <关键词>'

      const all = await s.getEntries(session.guildId, keyword)
      if (!all.length) return `本群没有关键词「${keyword}」`
      const mine = all.filter((e) => e.userId === s.resolveUserId(session))
      if (!mine.length) return `关键词「${keyword}」不是你创建的，无权删除`
      await ctx.database.remove('huaji_meme', mine.map((e) => e.id))
      return `已删除你创建的关键词「${keyword}」（${mine.length} 条）。`
    })

  // ── 我的梗 ──
  ctx.command('我的梗')
    .alias('我的梗词')
    .action(async ({ session }: any) => {
      const s = srv
      const denied = s.checkAccess(session)
      if (denied) return denied
      const list = await ctx.database.get('huaji_meme', { userId: s.resolveUserId(session) })
      if (!list.length) return '你还没有创建过梗词。发送【添加梗 <关键词> <内容>】试试。'
      return `你创建的梗词（${list.length} 条）：\n${renderEntries(list, false, true)}`
    })

  // ── 梗列表 ──
  ctx.command('梗列表')
    .alias('梗词列表')
    .action(async ({ session }: any) => {
      const s = srv
      const denied = s.checkAccess(session)
      if (denied) return denied
      const list = await ctx.database.get('huaji_meme', { guildId: session.guildId })
      if (!list.length) return '本群还没有人创建梗词。'
      const isAdmin = s.isAdmin(session)
      return `本群梗词（${list.length} 条）：\n${renderEntries(list, isAdmin, isAdmin)}`
    })
}
