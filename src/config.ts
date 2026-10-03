import { Context, Schema } from 'koishi'

/** 词条内容类型 */
export type MemeType = 'text' | 'image'

/** 梗词记录 */
export interface MemeEntry {
  id: number
  /** 创建者 userId（platform:uid，适配器无关） */
  userId: string
  /** 群/频道号（按群隔离） */
  guildId: string
  /** 关键词 */
  keyword: string
  /** 内容类型 */
  type: MemeType
  /** 文本内容或图片 fileId / URL */
  content: string
  /** 创建时间 */
  createdAt: Date
}

export interface Config {
  /** 管理员 QQ 号列表（与 Koishi authority>=3 合并判定） */
  adminList: string[]
  /** 群/频道白名单开关 */
  groupWhitelistEnabled: boolean
  /** 群/频道白名单（纯数字群号/频道号，留空表示不启用） */
  groupWhitelist: string[]
  /** 用户黑名单（纯数字 QQ 号，命中直接无视） */
  userBlacklist: string[]
  /** 私聊是否启用（私聊只能管理自己的词条，不能触发） */
  allowPrivateChat: boolean
  /** 自动触发总开关：关闭后仅指令可用 */
  autoTrigger: boolean
  /** 是否必须 @机器人 才触发 */
  requireAt: boolean
  /** 匹配模式：fuzzy=子串包含，exact=整条文本相等 */
  matchMode: 'fuzzy' | 'exact'
  /** 冷却秒数：同群同词条触发间隔，0=不限制 */
  cooldownSeconds: number
  /** 全局词条总数上限，0=不限制 */
  maxTotalEntries: number
  /** 单用户词条数上限，0=不限制 */
  maxUserEntries: number
  /** 关键词最大长度 */
  maxKeywordLength: number
  /** 是否允许创建者编辑已绑定的词条内容 */
  allowEdit: boolean
  /** 触发时是否 @ 触发者 */
  atSenderOnTrigger: boolean
  /**
   * 图片采集方式：
   * - private（默认）：群里发指令后引导用户私聊机器人发图。私聊不受「必须 @机器人」限制，
   *   官方 QQ 机器人上唯一可靠的收图方式。
   * - group：仍在群里直接发图。要求该群已给机器人开通「获取群内全部消息」权限。
   */
  imageCollectMode: 'private' | 'group'
  /** 添加梗图后等待用户发图的超时秒数（超时自动释放队列） */
  imageCollectTimeout: number
}

export const Config: Schema<Config> = Schema.object({
  adminList: Schema.array(Schema.string())
    .default([])
    .description('管理员 QQ 号列表（留空则仅 Koishi 权限等级 ≥3 的用户为管理员）'),
  groupWhitelistEnabled: Schema.boolean()
    .default(false)
    .description('是否启用群/频道白名单'),
  groupWhitelist: Schema.array(Schema.string())
    .default([])
    .description('群/频道白名单（纯数字群号/频道号，仅白名单内的会话可用）'),
  userBlacklist: Schema.array(Schema.string())
    .default([])
    .description('用户黑名单（纯数字 QQ 号，命中用户的所有指令与词条操作均被拒绝）'),
  allowPrivateChat: Schema.boolean()
    .default(true)
    .description('是否允许私聊使用（私聊下仅能管理自己创建的词条，且不会触发）'),
  autoTrigger: Schema.boolean()
    .default(true)
    .description('自动触发总开关。关闭后仅指令可用；使用官方 QQ 机器人时建议保持开启（其群聊本就只能收到 @ 消息）'),
  requireAt: Schema.boolean()
    .default(false)
    .description('是否必须 @机器人 才触发。官方 QQ 机器人受平台限制，本就只会收到 @ 消息，此项对它无影响'),
  matchMode: Schema.union([
    Schema.const('fuzzy').description('模糊包含：消息中出现关键词即触发（默认）'),
    Schema.const('exact').description('精确匹配：整条消息与关键词完全相同才触发'),
  ] as const)
    .default('fuzzy')
    .description('关键词匹配模式'),
  cooldownSeconds: Schema.natural()
    .default(10)
    .min(0)
    .max(3600)
    .description('冷却秒数：同一群内相同词条的重复触发间隔，0 表示不限制'),
  maxTotalEntries: Schema.natural()
    .default(0)
    .description('全平台词条总数上限，0 表示不限制（用于防止数据库膨胀）'),
  maxUserEntries: Schema.natural()
    .default(20)
    .description('单个用户可创建的词条数量上限，0 表示不限制'),
  maxKeywordLength: Schema.natural()
    .default(20)
    .min(1)
    .max(100)
    .description('关键词最大长度（字符数）'),
  allowEdit: Schema.boolean()
    .default(true)
    .description('是否允许用户编辑自己创建的词条内容（编辑梗）'),
  atSenderOnTrigger: Schema.boolean()
    .default(false)
    .description('触发梗词时是否 @ 触发者（部分连接器不支持回复内的 @）'),
  imageCollectMode: Schema.union([
    Schema.const('private').description('私聊发图（默认，推荐）：群里发指令后引导用户私聊机器人发图。官方 QQ 机器人上唯一可靠的方式'),
    Schema.const('group').description('群内直接发图：需群主在 QQ 群设置里给机器人开通「获取群内全部消息」权限，否则收不到纯图片消息'),
  ] as const)
    .default('private')
    .description('添加梗图时图片的采集方式'),
  imageCollectTimeout: Schema.natural()
    .default(120)
    .min(10)
    .max(600)
    .description('添加梗图后等待用户发图的秒数，超时自动释放队列（防止用户不发图长期占用）'),
})
