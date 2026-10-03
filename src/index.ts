import { Context } from 'koishi'
import { Config as MemeConfig } from './config'
import { MemeService } from './service'
import { ImageCollector, pickImage } from './collector'
import { applyUserCommands } from './modules/user'
import { applyAdminCommands } from './modules/admin'
import { applyTrigger } from './modules/trigger'
import { makeAccessFilter, makeUserFilter } from './access'
import { slashAliases, renderCommandList } from './slash'

export * from './config'
export * from './service'
export * from './helpers'
export * from './access'
export { ImageCollector, pickImage, pickAtIds } from './collector'
export * from './slash'
export { renderEntries, findTriggers } from './modules/user'

export const name = 'huaji-meme'
// 只声明外部依赖；本插件的 Service 由 apply() 内部注册，写进 inject 会形成循环等待
export const inject = ['database']

export const Config = MemeConfig

export function apply(ctx: Context, config: MemeConfig) {
  const collector = new ImageCollector(ctx)

  // Service 通过 ctx.plugin 注册，activate 之后才会挂到根上下文。
  // 中间件与指令一律用闭包里的 srv 引用：命令执行时的作用域与插件根作用域不同，
  // 那里读 ctx.meme 会抛 "property meme is not registered"。
  ctx.plugin(MemeService, config)
  ctx.inject(['meme'], (root) => {
    const srv = root.meme
    const logger = root.logger('huaji-meme')

    // ── 启动自检 ──
    // 把「插件装了却毫无反应」这类静默故障变成显式日志。
    // 缺 database → Service 根本不创建（inject 永不触发）；
    // 建表失败（主键类型不被驱动支持等）→ 每条指令查询都抛错。两者都不报错到用户可见处。
    Promise.resolve()
      .then(async () => {
        const rows = await root.database.get('huaji_meme', {})
        logger.info('数据库表 huaji_meme 就绪（当前 %d 条词条）', rows.length)
      })
      .catch((err: Error) => {
        logger.error(
          '数据库表 huaji_meme 不可用：%s\n' +
          '插件将无法响应。请检查数据库插件是否已启用；若刚升级过插件版本，可能需要检查表结构是否与版本匹配。',
          err.message,
        )
      })

    // 配置体检：这些组合会让插件在所有会话里静默，必须提前警告
    if (config.groupWhitelistEnabled && !config.groupWhitelist.length) {
      logger.warn('已启用群/频道白名单但列表为空 —— 所有群都无法使用本插件。请填入群号，或关闭该开关。')
    } else if (config.groupWhitelistEnabled) {
      logger.info('群/频道白名单已启用，允许 %d 个会话', config.groupWhitelist.length)
    }
    if (!config.allowPrivateChat) logger.info('私聊已关闭，只能在群聊中使用')

    // ── 被拦截时的原因说明 ──
    // 群里保持静默（不泄漏白名单/黑名单配置），但同一用户私聊时告诉他原因，
    // 否则用户只能看到「插件没反应」而无处排查。
    const reasonOf = (session: any): string | null => {
      if (srv.isBlacklisted(session)) {
        return '你已被管理员列入梗词功能黑名单。如果你认为这是误操作，请联系管理员。'
      }
      if (srv.isGuildAllowed(session)) return null
      if (!session.guildId) {
        return '本插件已关闭私聊使用，请在群聊中发送指令。'
      }
      if (!config.groupWhitelistEnabled) return null
      if (!config.groupWhitelist.length) {
        return '本群未开放梗词功能：管理员启用了白名单但尚未添加任何群号。'
      }
      return '本群未开放梗词功能：该群不在管理员设置的白名单中。'
    }

    // 拦在所有插件中间件最前面：命中拦截则静默丢弃群消息，但记下原因供私聊查询
    const blocked = new Map<string, string>()
    root.middleware(async (session: any, next: any) => {
      const reason = reasonOf(session)
      if (!reason) return next()
      blocked.set(session.userId || '', reason)
      return
    })

    // 用户在私聊里发任意消息时，若之前被拦过，给出一次说明
    root.middleware(async (session: any, next: any) => {
      const uid = session.userId || ''
      if (session.guildId || !uid) return next()
      const reason = blocked.get(uid)
      if (!reason) return next()
      blocked.delete(uid)
      await session.send(`【梗词功能】${reason}`)
      return
    })

    // 访问范围：用 Context 过滤器在「注册指令」层面收口，
    // 而非中间件里 return —— 中间件拦截后命令已注册，mock 仍会留下一条空回复。
    let access: Context = root.guild()
    if (config.allowPrivateChat) access = access.union(root.private())
    if (config.groupWhitelistEnabled) {
      access = config.groupWhitelist.length
        ? access.intersect(makeAccessFilter(config.groupWhitelist))
        : root.never()
    }
    if (config.userBlacklist.length) {
      access = access.exclude(root.intersect(makeUserFilter(config.userBlacklist)))
    }

    // 图片收集中间件（prepend=true 插到最前）。
    // 说明：群内收图的落库在 ImageCollector.consume 内部完成；
    // 这里额外处理**私聊收图**——私聊消息不受「必须 @机器人」限制，
    // 是官方 QQ 机器人上唯一可靠的收图方式。
    const imageMiddleware = async (session: any, next: any) => {
      // 群内收图（imageCollectMode=group）：消费掉图片消息，避免被误当关键词触发
      if (session.guildId) {
        const src = collector.consume(session)
        if (src) return
        return next()
      }

      const uid = session.userId || ''
      if (!uid) return next()

      const pendingPrivate = collector.hasPendingPrivate(uid)
      if (!pendingPrivate) return next()

      // 用户私聊发「取消」等 → 放弃绑定
      const text = (session.content || '').trim()
      if (/^(取消|算了|不加了|退出|\/取消)$/.test(text)) {
        collector.cancelPrivate(uid)
        return '已取消图片绑定。'
      }

      // 私聊发文字（非取消）→ 提示用法，不消费队列
      if (!pickImage(session)) {
        return '请直接发送图片（不带其他文字）即可绑定。若想放弃，回复「取消」。'
      }

      // 有图片：从队列取出关键词与群号后落库
      const keyword = collector.pendingKeywordOf(uid)
      const guildId = collector.pendingGuildOf(uid)
      const src = pickImage(session)
      collector.cancelPrivate(uid)
      if (!keyword || !guildId || !src) return next()

      const quota = await srv.checkQuota({ userId: session.userId, guildId })
      if (quota) return `图片收到，但${quota}，关键词「${keyword}」未绑定。`
      await root.database.create('huaji_meme', {
        userId: session.userId,
        guildId,
        keyword,
        type: 'image',
        content: src,
        createdAt: new Date(),
      })
      return `✅ 已绑定图片梗「${keyword}」，已保存到该群。群里有人说 ${keyword} 时我就会发这张图。`
    }
    // 标记并注册，供集成测试直接取用（mock 的消息队列串行，无法模拟并发场景）
    ;// 挂到 Service 上供集成测试取用（fork 后入口 ctx 的属性在根上下文读不到）
    ;(srv as any)._collector = collector
    ;(srv as any)._imageMiddleware = imageMiddleware
    root.middleware(imageMiddleware as any, true)

    // 超时释放由 ImageCollector 内部定时器负责（waitPrivate 到点自动 resolve(null)），
    // 群内发指令的那一侧会收到「未收到图片（已超时或取消）」的提示。

    applyTrigger(access, srv, collector)
    slashAliases(access, (c) => {
      applyUserCommands(c, srv, collector)
      applyAdminCommands(c, srv)
      // 指令清单：便于管理员复制到 QQ 开放平台「指令配置」
      // ⚠️ 必须放在 slashAliases 回调内，否则拿不到 / 斜杠别名
      c.command('梗指令清单')
        .action(() => renderCommandList())
    })

    // 私聊收图需要私聊通道可用，这里做一次提示
    if (config.imageCollectMode === 'private' && !config.allowPrivateChat) {
      logger.warn('图片采集模式为「私聊发图」，但【是否允许私聊使用】已关闭 —— 添加梗图将无法完成，请调整其中一项。')
    }
    if (config.imageCollectMode === 'group') {
      logger.info('图片采集模式为「群内发图」，请确保各群已给机器人开通「获取群内全部消息」权限。')
    }

    logger.info('huaji-meme 已加载，发送【梗帮助】查看用法')
  })

  return { collector }
}
