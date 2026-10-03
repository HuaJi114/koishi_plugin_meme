import { Context } from 'koishi'
import { expect } from 'chai'
import mock from '@koishijs/plugin-mock'
import memory from '@koishijs/plugin-database-memory'
import * as mod from '../src'

const plugin = (mod as any).default ?? mod

const BASE = {
  adminList: [], groupWhitelistEnabled: false, groupWhitelist: [],
  userBlacklist: [], allowPrivateChat: true, autoTrigger: true, requireAt: false,
  matchMode: 'fuzzy' as const, cooldownSeconds: 0, maxTotalEntries: 0,
  maxUserEntries: 0, maxKeywordLength: 20, allowEdit: true, atSenderOnTrigger: false,
  imageCollectMode: 'private' as const, imageCollectTimeout: 120,
}

function mk(cfg: Record<string, any> = {}): Context {
  const app = new Context()
  app.plugin(mock)
  app.plugin(memory)
  app.plugin(plugin, { ...BASE, ...cfg })
  return app
}

/** 发一条消息并返回文本回复数组；guild 传 null 表示私聊 */
async function send(app: Context, content: string, uid = '1001', guild: string | null = '888') {
  const client = guild ? app.mock.client(uid, guild) : app.mock.client(uid)
  const r = await client.receive(content)
  return r.map((x: any) => String(x))
}

/** 等待异步收尾 */
const tick = (ms = 100) => new Promise((r) => setTimeout(r, ms))

/** 构造一个最小可用的 session（绕过 mock 的串行队列，直接喂中间件） */
function fakeSession(over: Record<string, any> = {}): any {
  return {
    platform: 'mock',
    guildId: '888',
    userId: '1001',
    content: '',
    elements: [] as any[],
    authority: 0,
    send: async () => ({}),
    prompt: async () => undefined,
    ...over,
  }
}

/** 取插件内部的 ImageCollector（由 apply() 返回并挂到 ctx 上） */
function getCollector(app: Context): any {
  return (app as any).meme._collector
}

/**
 * 直接驱动插件的图片收集中间件。
 * mock 的消息队列是串行的，无法模拟「群内挂起等待 + 私聊发图」这类并发场景，
 * 因此绕过队列、构造 session 直接调用中间件。
 */
async function runImageMiddleware(app: Context, session: any): Promise<string> {
  const mw = (app as any).meme._imageMiddleware
  if (!mw) throw new Error('未找到图片收集中间件')
  const r = await mw(session, async () => undefined)
  return typeof r === 'string' ? r : ''
}

describe('QQ 斜杠指令菜单适配', () => {
  it('带斜杠的 /梗帮助 可用（QQ 命令菜单点击后发送的形式）', async () => {
    const app = mk()
    await app.start()
    const r = await send(app, '/梗帮助')
    expect(r.length).to.be.greaterThan(0)
    expect(r[0]).to.contain('梗词玩法')
    try { await app.stop() } catch { /* noise */ }
  })

  it('不带斜杠的 梗帮助 仍然可用（手动 @ 机器人时）', async () => {
    const app = mk()
    await app.start()
    const r = await send(app, '梗帮助')
    expect(r.length).to.be.greaterThan(0)
    expect(r[0]).to.contain('梗词玩法')
    try { await app.stop() } catch { /* noise */ }
  })

  it('斜杠 + 参数：/添加梗 233 内容', async () => {
    const app = mk()
    await app.start()
    const r = await send(app, '/添加梗 233 你干嘛哎哟')
    expect(r[0]).to.contain('已绑定文字梗')
    const rows = await app.database.get('huaji_meme', { guildId: '888', keyword: '233' })
    expect(rows.length).to.equal(1)
    try { await app.stop() } catch { /* noise */ }
  })

  it('斜杠 + 参数：/删除梗 233', async () => {
    const app = mk()
    await app.start()
    await send(app, '添加梗 tmp 内容')
    const r = await send(app, '/删除梗 tmp')
    expect(r[0]).to.contain('已删除')
    try { await app.stop() } catch { /* noise */ }
  })

  it('管理员命令也支持斜杠：/管理梗列表', async () => {
    const app = mk()
    await app.start()
    await send(app, '添加梗 abc 内容')
    const r = await send(app, '/管理梗列表')
    expect(r[0]).to.contain('仅限管理员')
    try { await app.stop() } catch { /* noise */ }
  })

  it('斜杠 + 空格参数：/添加梗图 猫猫（发图前不入库）', async () => {
    const app = mk()
    await app.start()
    void send(app, '/添加梗图 猫猫')
    await tick()
    const rows = await app.database.get('huaji_meme', { guildId: '888' })
    expect(rows.length).to.equal(0)   // 还没发图，不该入库
    try { await app.stop() } catch { /* noise */ }
  })

  it('梗指令清单可查看（便于复制到 QQ 后台配置）', async () => {
    const app = mk()
    await app.start()
    const r = await send(app, '梗指令清单')
    expect(r[0]).to.contain('/梗帮助')
    expect(r[0]).to.contain('/添加梗')
    try { await app.stop() } catch { /* noise */ }
  })

  it('梗指令清单也支持斜杠形式（回归：曾漏在 slashAliases 之外）', async () => {
    const app = mk()
    await app.start()
    const r = await send(app, '/梗指令清单')
    expect(r.length).to.be.greaterThan(0)
    expect(r[0]).to.contain('/梗帮助')
    try { await app.stop() } catch { /* noise */ }
  })

  it('连续发送多条指令后斜杠形式仍可用', async () => {
    const app = mk()
    await app.start()
    // 先发几条普通指令制造状态，再试斜杠形式
    await send(app, '/添加梗 aaa 内容')
    await send(app, '添加梗 bbb 内容')
    const r = await send(app, '/梗指令清单')
    expect(r.length).to.be.greaterThan(0)
    expect(r[0]).to.contain('/添加梗')
    try { await app.stop() } catch { /* noise */ }
  })
})

describe('图片采集模式 · 私聊收图（默认）', () => {
  let app: Context
  before(async () => { app = mk(); await app.start() })
  after(async () => { try { await app.stop() } catch { /* noise */ } })

  it('群内发指令 → 私聊发图 → 绑定回原群', async () => {
    // mock 的 receive 会等整条链返回，而 collectAndBind 挂起等私聊图；
    // 且同 client 消息串行，群里那条未结束时私聊消息发不出去。
    // 因此这里直接构造 session 走中间件链，避开 mock 的串行队列限制。
    const collector = getCollector(app)
    const groupSession = fakeSession({ guildId: '888', userId: '1001' })
    collector.waitPrivate(groupSession, '猫猫', 2000)
    expect(collector.pendingKeywordOf('1001')).to.equal('猫猫')
    expect(collector.pendingGuildOf('1001')).to.equal('888')

    // 未入库
    let rows = await app.database.get('huaji_meme', { keyword: '猫猫' })
    expect(rows.length).to.equal(0)

    // 私聊发图 → 走中间件链落库
    const privSession = fakeSession({ guildId: '', userId: '1001', content: '' })
    privSession.elements = [{ type: 'image', attrs: { src: 'file://cat.png' } }]
    const replied = await runImageMiddleware(app, privSession)

    rows = await app.database.get('huaji_meme', { guildId: '888', keyword: '猫猫' })
    expect(rows.length).to.equal(1)
    expect(rows[0].type).to.equal('image')
    expect(rows[0].content).to.equal('file://cat.png')
    expect(rows[0].guildId).to.equal('888')
    expect(replied).to.contain('已绑定图片梗')
  })

  it('未发指令时私聊发图不会误绑定', async () => {
    const before = await app.database.get('huaji_meme', {})
    const s = fakeSession({ guildId: '', userId: '2002' })
    s.elements = [{ type: 'image', attrs: { src: 'file://none.png' } }]
    await runImageMiddleware(app, s)
    const after = await app.database.get('huaji_meme', {})
    expect(after.length).to.equal(before.length)
  })

  it('私聊发「取消」可放弃绑定', async () => {
    const collector = getCollector(app)
    collector.waitPrivate(fakeSession({ guildId: '888', userId: '1003' }), '放弃猫', 2000)
    const r = await runImageMiddleware(app, fakeSession({ guildId: '', userId: '1003', content: '取消' }))
    expect(r).to.contain('已取消')
    const rows = await app.database.get('huaji_meme', { keyword: '放弃猫' })
    expect(rows.length).to.equal(0)
  })

  it('超时会自动释放队列（不长期占用）', async () => {
    const app2 = mk({ imageCollectTimeout: 10 })
    await app2.start()
    const collector2 = getCollector(app2)
    collector2.waitPrivate(fakeSession({ guildId: '888', userId: '1004' }), '超时词', 10)
    expect(collector2.hasPendingPrivate('1004')).to.be.true
    await new Promise((r) => setTimeout(r, 120))
    expect(collector2.hasPendingPrivate('1004')).to.be.false

    const s = fakeSession({ guildId: '', userId: '1004' })
    s.elements = [{ type: 'image', attrs: { src: 'file://late.png' } }]
    await runImageMiddleware(app2, s)
    const rows = await app2.database.get('huaji_meme', { keyword: '超时词' })
    expect(rows.length).to.equal(0)
    try { await app2.stop() } catch { /* noise */ }
  })
})

describe('图片采集模式 · 群内发图（imageCollectMode=group）', () => {
  let app: Context
  before(async () => { app = mk({ imageCollectMode: 'group' }); await app.start() })
  after(async () => { try { await app.stop() } catch { /* noise */ } })

  it('群内发图可正常绑定（走真实指令链路）', async () => {
    // 群内模式下两条消息都在同一会话，mock 串行队列不会卡住，可用真实链路
    const pending = send(app, '添加梗图 兔子')
    await tick()
    await send(app, '<image src="file://rabbit.png"/>')
    await Promise.race([pending, new Promise((r) => setTimeout(r, 2000))])
    await tick()

    const rows = await app.database.get('huaji_meme', { guildId: '888', keyword: '兔子' })
    expect(rows.length).to.equal(1)
    expect(rows[0].content).to.equal('file://rabbit.png')
  })
})

describe('配置组合异常时的表现', () => {
  it('私聊收图 + 私聊关闭 → 群内指令仍可用', async () => {
    const app = mk({ allowPrivateChat: false, imageCollectMode: 'private' })
    await app.start()
    const r = await send(app, '梗帮助')
    expect(r.length).to.be.greaterThan(0)
    try { await app.stop() } catch { /* noise */ }
  })
})
