import { Context } from 'koishi'
import { MemeService } from '../service'
import { renderEntries } from './user'

/** 管理员指令集：需 adminList 或 Koishi authority>=3 */
export function applyAdminCommands(ctx: Context, srv: MemeService) {

  const guardAdmin = (session: any): string | null => {
    const denied = srv.checkAccess(session)
    if (denied) return denied
    if (!srv.isAdmin(session)) return '该指令仅限管理员使用'
    return null
  }

  // ── 管理梗列表 ──
  ctx.command('管理梗列表')
    .alias('管理列表')
    .action(async ({ session }: any) => {
      const denied = guardAdmin(session)
      if (denied) return denied
      const list = session.guildId
        ? await ctx.database.get('huaji_meme', { guildId: session.guildId })
        : await ctx.database.get('huaji_meme', {})
      if (!list.length) return '暂无梗词记录。'
      return `梗词（${list.length} 条，格式：内容（id / 创建者））：\n${renderEntries(list, true, true)}`
    })

  // ── 管理删除 <关键词> [序号] ──
  ctx.command('管理删除 <keyword: string> [index: string]')
    .alias('管理删 <keyword: string> [index: string]')
    .action(async ({ session }: any, ...argv: string[]) => {
      const denied = guardAdmin(session)
      if (denied) return denied
      const keyword = (argv[0] || '').trim()
      if (!keyword) return '用法：管理删除 <关键词> [序号]（不带序号则删除该关键词全部内容）'
      const idx = argv[1] ? Number(argv[1]) : 0

      const all = await srv.getEntries(session.guildId, keyword)
      if (!all.length) return `本群没有关键词「${keyword}」`

      if (!idx) {
        await ctx.database.remove('huaji_meme', all.map((e) => e.id))
        return `已删除关键词「${keyword}」的全部 ${all.length} 条内容。`
      }
      if (!Number.isInteger(idx) || idx < 1 || idx > all.length) {
        const list = all
          .map((e, i) => `${i + 1}. ${e.type === 'image' ? '[图片]' : e.content}（创建者 ${e.userId}）`)
          .join('\n')
        return `序号无效。可选内容：\n${list}`
      }
      const target = all[idx - 1]
      await ctx.database.remove('huaji_meme', [target.id])
      return `已删除关键词「${keyword}」的第 ${idx} 条内容（创建者 ${target.userId}）。`
    })

  // ── 管理清空 ──
  ctx.command('管理清空')
    .alias('清空梗词')
    .action(async ({ session }: any) => {
      const denied = guardAdmin(session)
      if (denied) return denied
      const list = await ctx.database.get('huaji_meme', { guildId: session.guildId })
      if (!list.length) return '本群暂无梗词，无需清空。'
      await ctx.database.remove('huaji_meme', list.map((e) => e.id))
      return `已清空本群 ${list.length} 条梗词。`
    })

  // ── 管理设置 <项> <值> ──
  ctx.command('管理设置 <key: string> <value: string>')
    .action(async ({ session }: any, ...argv: string[]) => {
      const denied = guardAdmin(session)
      if (denied) return denied
      const key = (argv[0] || '').trim()
      const value = (argv[1] || '').trim()
      const s = srv
      if (key === '匹配模式') {
        if (value !== 'fuzzy' && value !== 'exact') return '匹配模式只能是 fuzzy 或 exact'
        s.config.matchMode = value
        return `匹配模式已改为 ${value === 'fuzzy' ? '模糊包含' : '精确匹配'}。`
      }
      if (key === '自动触发' || key === '必须@') {
        if (value !== '开' && value !== '关') return '值只能是 开 或 关'
        if (key === '自动触发') s.config.autoTrigger = value === '开'
        else s.config.requireAt = value === '开'
        return `【${key}】已${value === '开' ? '开启' : '关闭'}。`
      }
      return '可改项：自动触发（开/关）、必须@（开/关）、匹配模式（fuzzy/exact）'
    })
}
