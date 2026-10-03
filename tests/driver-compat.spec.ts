import { Context } from 'koishi'
import { expect } from 'chai'
import mock from '@koishijs/plugin-mock'
import memory from '@koishijs/plugin-database-memory'
import sqlite from '@koishijs/plugin-database-sqlite'
import * as mod from '../src'

const plugin = (mod as any).default ?? mod

/**
 * 跨数据库驱动回归测试。
 *
 * 背景：0.1.0 用 `id: 'id'` 声明自增主键，只有 database-memory 驱动认识；
 * @minatojs/driver-sqlite 的类型表里没有 'id'，建表直接抛
 * "unsupported type: id" → 每条指令查询都失败 → 插件「加载了但完全无响应」。
 * 该问题在只用 memory 驱动的测试里永远测不出来，必须显式覆盖 sqlite。
 */

const CFG = {
  adminList: [], groupWhitelistEnabled: false, groupWhitelist: [],
  userBlacklist: [], allowPrivateChat: true, autoTrigger: true, requireAt: false,
  matchMode: 'fuzzy' as const, cooldownSeconds: 0, maxTotalEntries: 0,
  maxUserEntries: 0, maxKeywordLength: 20, allowEdit: true, atSenderOnTrigger: false,
}

function mk(driver: any, driverCfg: any = {}): Context {
  const app = new Context()
  app.plugin(mock)
  app.plugin(driver, driverCfg)
  app.plugin(plugin, { ...CFG })
  return app
}

async function stop(app: Context) {
  try { await app.stop() } catch { /* mock dispose 噪声 */ }
}

describe('跨数据库驱动 · database-memory', () => {
  let app: Context
  before(async () => { app = mk(memory); await app.start() })
  after(async () => { await stop(app) })

  it('建表成功且可读写', async () => {
    const r = await app.mock.client('1001', '888').receive('添加梗 233 内容A')
    expect(r.length).to.be.greaterThan(0)
    const rows = await app.database.get('huaji_meme', { guildId: '888' })
    expect(rows.length).to.be.greaterThan(0)
  })

  it('主键为自增整数', async () => {
    const rows = await app.database.get('huaji_meme', {})
    expect(typeof rows[0].id).to.be.equal('number')
  })
})

describe('跨数据库驱动 · database-sqlite（0.1.0 致命回归）', () => {
  let app: Context
  before(async () => {
    // ':memory:' 每次连接独立，不污染磁盘
    app = mk(sqlite, { path: ':memory:' })
    await app.start()
  })
  after(async () => { await stop(app) })

  it('建表不抛 unsupported type', async () => {
    // 直接读表：这是最直接的验证，建表失败时这里会抛错
    const rows = await app.database.get('huaji_meme', {})
    expect(rows).to.be.an('array')
  })

  it('指令可正常响应（建表失败的标志性症状是 0 条回复）', async () => {
    const r = await app.mock.client('1001', '888').receive('梗帮助')
    expect(r.length).to.be.greaterThan(0)
    expect(String(r[0])).to.contain('梗词玩法')
  })

  it('可写入与查询词条', async () => {
    await app.mock.client('1001', '888').receive('添加梗 sqlite键 测试内容')
    const rows = await app.database.get('huaji_meme', { guildId: '888', keyword: 'sqlite键' })
    expect(rows.length).to.equal(1)
    expect(rows[0].content).to.equal('测试内容')
    expect(rows[0].type).to.equal('text')
  })

  it('主键为自增整数', async () => {
    const rows = await app.database.get('huaji_meme', {})
    expect(typeof rows[0].id).to.be.equal('number')
  })

  it('多条同名词条可并存（随机触发的前提）', async () => {
    await app.mock.client('1001', '888').receive('添加梗 多次 多A')
    await app.mock.client('2002', '888').receive('添加梗 多次 多B')
    const rows = await app.database.get('huaji_meme', { guildId: '888', keyword: '多次' })
    expect(rows.length).to.equal(2)
  })

  it('删除词条可用', async () => {
    await app.mock.client('1001', '888').receive('删除梗 sqlite键')
    const rows = await app.database.get('huaji_meme', { guildId: '888', keyword: 'sqlite键' })
    expect(rows.length).to.equal(0)
  })

  it('触发机制在 sqlite 下正常', async () => {
    await app.mock.client('1001', '888').receive('添加梗 触发键 触发了')
    app.meme.resetCooldown()
    const r = await app.mock.client('2002', '888').receive('触发键')
    expect(String(r[0])).to.contain('触发了')
  })
})

describe('帮助文本 · 尖括号占位符不得污染输出', () => {
  let app: Context
  before(async () => { app = mk(memory); await app.start() })
  after(async () => { await stop(app) })

  it('梗帮助输出不含 Argv 回填的闭合标签', async () => {
    const r = await app.mock.client('1001', '888').receive('梗帮助')
    const text = String(r[0])
    // 0.1.0 的 bug：文本末尾多出 </keyword></keyword></文字内容></keyword>
    expect(text).to.not.match(/<\/[^>]*关键词[^>]*>/)
    expect(text).to.not.match(/<\/[^>]*文字内容[^>]*>/)
    expect(text).to.not.match(/<\/[^>]*内容[^>]*>/)
  })

  it('帮助文本使用全角尖括号展示参数', async () => {
    const r = await app.mock.client('1001', '888').receive('梗帮助')
    expect(String(r[0])).to.contain('〈关键词〉')
  })

  it('帮助文本不含半角尖括号占位符', async () => {
    const r = await app.mock.client('1001', '888').receive('梗帮助')
    // 只允许出现「 〈...〉 」这种全角形式
    expect(String(r[0])).to.not.match(/添加梗 </)
  })

  it('用法提示同样不含半角占位符', async () => {
    await app.mock.client('1001', '888').receive('添加梗 只有一个词')
    const r = await app.mock.client('1001', '888').receive('添加梗 只有一个词')
    expect(String(r[0])).to.contain('〈关键词〉')
    expect(String(r[0])).to.not.match(/<\/[^>]*关键词[^>]*>/)
  })

  it('两次执行文本稳定（无累积污染）', async () => {
    const a = String(await app.mock.client('1001', '888').receive('梗帮助')[0])
    const b = String(await app.mock.client('1001', '888').receive('梗帮助')[0])
    expect(a).to.equal(b)
  })
})

describe('启动自检 · 静默场景可被察觉', () => {
  it('白名单开启但为空时，指令静默（设计如此）', async () => {
    const app = mk(memory, {})
    app.unload?.('huaji-meme')
    await stop(app)
    // 单独构造该配置
    const app2 = new Context()
    app2.plugin(mock); app2.plugin(memory)
    app2.plugin(plugin, { ...CFG, groupWhitelistEnabled: true, groupWhitelist: [] })
    await app2.start()
    const r = await app2.mock.client('1001', '888').receive('梗帮助')
    expect(r.length).to.equal(0)   // 群里静默，不泄漏配置
    await stop(app2)
  })

  it('白名单不包含当前群时静默', async () => {
    const app = new Context()
    app.plugin(mock); app.plugin(memory)
    app.plugin(plugin, { ...CFG, groupWhitelistEnabled: true, groupWhitelist: ['999'] })
    await app.start()
    const r = await app.mock.client('1001', '888').receive('梗帮助')
    expect(r.length).to.equal(0)
    await stop(app)
  })

  it('黑名单用户静默', async () => {
    const app = new Context()
    app.plugin(mock); app.plugin(memory)
    app.plugin(plugin, { ...CFG, userBlacklist: ['1001'] })
    await app.start()
    const r = await app.mock.client('1001', '888').receive('梗帮助')
    expect(r.length).to.equal(0)
    await stop(app)
  })

  it('正常配置下不受影响', async () => {
    const app = new Context()
    app.plugin(mock); app.plugin(memory)
    app.plugin(plugin, { ...CFG })
    await app.start()
    const r = await app.mock.client('1001', '888').receive('梗帮助')
    expect(r.length).to.be.greaterThan(0)
    await stop(app)
  })
})
