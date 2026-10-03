import { Context, Command } from 'koishi'

/**
 * 斜杠指令适配。
 *
 * QQ 官方机器人的「命令菜单」在用户点击后会填入 `/命令名`（例如 `/梗帮助`），
 * 但**不会**给机器人追加 @，也不会把 `/` 从内容里去掉。若 Koishi 全局
 * `prefix` 没配 `/`，这些消息会因为命令名不匹配而**完全无响应**。
 *
 * 这里给每条命令批量注册 `/命令名` 形式的别名，使得：
 * - 用户从 QQ 命令菜单点选 → 命中 `/梗帮助`
 * - 用户手动 @机器人 + 梗帮助 → 命中 `梗帮助`
 * - 其他连接器（NapCat/OneBot）行为不变
 *
 * 前提：全局 `prefix` 需包含空串（默认 `['']`），即「无前缀也能匹配」，
 * 否则 `/xxx` 会被当作 prefix 剥离，命令名仍能匹配，也没问题。
 */
/**
 * 批量给一批命令挂上 `/命令名` 别名。
 *
 * 做法：临时替换 `ctx.command`，注册完立刻还原。命令的 def 形如
 * `'添加梗 <rest: string>'`，斜杠别名为 `'添加梗'`（去掉参数占位符）。
 */
export function slashAliases(ctx: Context, register: (c: Context) => void): void {
  const raw = ctx.command.bind(ctx)
  const patched = (def: any, ...rest: any[]) => {
    const cmd = raw(def, ...rest) as any
    // 从 def 里取出裸命令名（去掉参数占位符与描述文本）
    const name = String(def).split(/\s+/)[0].replace(/[<[].*$/, '').trim()
    if (name && !name.includes('.') && !name.startsWith('/')) {
      try {
        cmd.alias(`/${name}`)
      } catch {
        // 斜杠在个别上下文可能被判为非法别名，忽略（全局 prefix 仍可兜底）
      }
    }
    return cmd
  }
  ;(ctx as any).command = patched
  try {
    register(ctx)
  } finally {
    ;(ctx as any).command = raw
  }
}

/** 本插件支持的全部指令名（用于生成可复制到 QQ 后台的指令清单） */
export const COMMAND_NAMES = [
  { name: '梗帮助', desc: '查看玩法与全部指令' },
  { name: '添加梗', desc: '绑定文字梗：添加梗 关键词 内容' },
  { name: '添加梗图', desc: '绑定图片梗：先发指令再按提示发图' },
  { name: '编辑梗', desc: '修改自己绑定的内容：编辑梗 关键词' },
  { name: '删除梗', desc: '删除自己绑定的内容：删除梗 关键词' },
  { name: '我的梗', desc: '查看自己创建的词条' },
  { name: '梗列表', desc: '查看本群全部词条' },
  { name: '管理梗列表', desc: '【管理】查看本群所有词条含创建者' },
  { name: '管理删除', desc: '【管理】删除任意关键词：管理删除 关键词' },
  { name: '管理清空', desc: '【管理】清空本群所有梗词' },
  { name: '管理设置', desc: '【管理】运行时改配置' },
]

/** 生成可直接复制到 QQ 开放平台「指令配置」的清单 */
export function renderCommandList(): string {
  const lines = ['本插件可注册到 QQ 开放平台「指令配置」的指令（上限 24 个）：', '']
  COMMAND_NAMES.forEach((c, i) => {
    lines.push(`${String(i + 1).padStart(2, ' ')}. /${c.name}  —— ${c.desc}`)
  })
  lines.push('')
  lines.push('说明：')
  lines.push('· 指令名填「/梗帮助」这样的带斜杠形式，用户点击后即可发送')
  lines.push('· 群聊内需 @机器人 + 指令，或直接用 /指令，两者皆可')
  return lines.join('\n')
}
