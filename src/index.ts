import { Context } from 'koishi'
import { Config as MemeConfig } from './config'
import { MemeService } from './service'
import { ImageCollector } from './collector'
import { applyUserCommands } from './modules/user'
import { applyAdminCommands } from './modules/admin'
import { applyTrigger } from './modules/trigger'
import { makeAccessFilter, makeUserFilter } from './access'

export * from './config'
export * from './service'
export * from './helpers'
export * from './access'
export { ImageCollector, pickImage, pickAtIds } from './collector'
export { renderEntries, findTriggers } from './modules/user'

export const name = 'huaji-meme'
// 只声明外部依赖；本插件的 Service 由 apply() 内部注册，写进 inject 会形成循环等待
export const inject = ['database']

export const Config = MemeConfig

export function apply(ctx: Context, config: MemeConfig) {
  const collector = new ImageCollector(ctx)
  // 挂到插件入口 ctx，供调试与集成测试访问（fork 后仍可从根上下文读到）
  Object.defineProperty(ctx, '_memeCollector', { value: collector, configurable: true })

  // Service 通过 ctx.plugin 注册，activate 之后才会挂到根上下文。
  // 中间件与指令一律用闭包里的 srv 引用：命令执行时的作用域与插件根作用域不同，
  // 那里读 ctx.meme 会抛 "property meme is not registered"。
  ctx.plugin(MemeService, config)
  ctx.inject(['meme'], (root) => {
    const srv = root.meme

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

    // 图片收集中间件必须早于触发中间件，否则等待中的图片消息会被误当关键词命中
    // prepend=true 插到最前，保证先消费掉等待中的图片消息
    root.middleware(collector.middleware as any, true)

    applyTrigger(access, srv, collector)
    applyUserCommands(access, srv, collector)
    applyAdminCommands(access, srv)
  })

  return { collector }
}
