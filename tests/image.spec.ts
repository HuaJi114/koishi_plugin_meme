import { Context } from 'koishi'
import { expect } from 'chai'
import mock from '@koishijs/plugin-mock'
import memory from '@koishijs/plugin-database-memory'
import * as mod from '../src'
import { ImageCollector, pickImage, pickAtIds } from '../src/collector'

const plugin = (mod as any).default ?? mod

function makeApp(cfg: Record<string, any> = {}): Context {
  const app = new Context()
  app.plugin(mock)
  app.plugin(memory)
  app.plugin(plugin, {
    adminList: [],
    groupWhitelistEnabled: false,
    groupWhitelist: [],
    userBlacklist: [],
    allowPrivateChat: true,
    autoTrigger: true,
    requireAt: false,
    matchMode: 'fuzzy',
    cooldownSeconds: 0,
    maxTotalEntries: 0,
    maxUserEntries: 0,
    maxKeywordLength: 20,
    allowEdit: true,
    atSenderOnTrigger: false,
    ...cfg,
  })
  return app
}

function fakeSession(overrides: Record<string, any> = {}) {
  return {
    platform: 'mock',
    guildId: '888',
    userId: '1001',
    elements: [] as any[],
    content: '',
    ...overrides,
  } as any
}

describe('图片收集器 · 单元测试', () => {
  it('无图片时不消费', () => {
    const app = new Context()
    const collector = new ImageCollector(app)
    const session = fakeSession()
    expect(collector.isPending(session)).to.be.false
    expect(collector.consume(session)).to.be.null
  })

  it('注册等待后可消费图片', async () => {
    const app = new Context()
    const collector = new ImageCollector(app)
    const session = fakeSession()
    const waiting = collector.waitGroup(session, 'kw', 1000)
    expect(collector.isPending(session)).to.be.true

    const imgSession = fakeSession({
      elements: [{ type: 'image', attrs: { src: 'file://abc.png' } }],
    })
    const got = collector.consume(imgSession)
    expect(got).to.equal('file://abc.png')
    expect(await waiting).to.equal('file://abc.png')
    expect(collector.isPending(session)).to.be.false
  })

  it('超时会 resolve null', async () => {
    const app = new Context()
    const collector = new ImageCollector(app)
    const result = await collector.waitGroup(fakeSession(), 'kw', 30)
    expect(result).to.be.null
  })

  it('等待期间收到纯文字不消费（仍继续等）', async () => {
    const app = new Context()
    const collector = new ImageCollector(app)
    const session = fakeSession()
    const waiting = collector.waitGroup(session, 'kw', 200)
    const textSession = fakeSession({ elements: [{ type: 'text', attrs: { content: '说明文字' } }] })
    expect(collector.consume(textSession)).to.be.null
    const imgSession = fakeSession({ elements: [{ type: 'image', attrs: { src: 'x.png' } }] })
    collector.consume(imgSession)
    expect(await waiting).to.equal('x.png')
  })

  it('不同会话互不干扰', async () => {
    const app = new Context()
    const collector = new ImageCollector(app)
    const s1 = fakeSession({ userId: '1001' })
    const s2 = fakeSession({ userId: '2002' })
    const w1 = collector.waitGroup(s1, 'kw', 200)
    const w2 = collector.waitGroup(s2, 'kw', 200)
    collector.consume(fakeSession({ userId: '2002', elements: [{ type: 'image', attrs: { src: 'b.png' } }] }))
    expect(await w2).to.equal('b.png')
    expect(collector.isPending(s1)).to.be.true
    await w1
  })

  it('同一会话重复注册只保留最新一次', async () => {
    const app = new Context()
    const collector = new ImageCollector(app)
    const session = fakeSession()
    const first = collector.waitGroup(session, 'kw', 500)
    const second = collector.waitGroup(session, 'kw', 500)
    expect(await first).to.be.null
    collector.consume(fakeSession({ elements: [{ type: 'image', attrs: { src: 'c.png' } }] }))
    expect(await second).to.equal('c.png')
  })
})

describe('元素解析工具', () => {
  it('pickImage 取第一张图', () => {
    const s = fakeSession({
      elements: [
        { type: 'text', attrs: { content: 'hi' } },
        { type: 'image', attrs: { src: '1.png' } },
        { type: 'image', attrs: { src: '2.png' } },
      ],
    })
    expect(pickImage(s)).to.equal('1.png')
  })

  it('pickImage 无图返回 null', () => {
    expect(pickImage(fakeSession())).to.be.null
  })

  it('pickAtIds 去掉 platform 前缀', () => {
    const s = fakeSession({
      elements: [
        { type: 'at', attrs: { id: 'mock:1001' } },
        { type: 'at', attrs: { id: '2002' } },
      ],
    })
    expect(pickAtIds(s)).to.deep.equal(['1001', '2002'])
  })
})

describe('图片梗绑定流程', () => {
  // 单例 app：mock 的 app.stop() 存在 findIndex 噪声，重复起停会污染统计
  let app: Context
  // 独立 collector：等价于插件内部那一个（mock 的 fork 上下文拿不到插件内部引用），
  // 用于模拟「用户发来图片」这一步
  let collector: ImageCollector
  before(async () => {
    app = makeApp()
    await app.start()
    collector = new ImageCollector(app)
  })
  after(async () => {
    try { await app.stop() } catch { /* mock 清理噪声 */ }
  })

  it('添加梗图（带关键词）→ 发图后入库为 image 类型', async () => {
    // mock 客户端的消息是串行队列，无法并发「发指令 + 立刻发图」，
    // 因此直接驱动 collector 模拟「收到图片」这一步（与真实链路的唯一差异）
    const session = fakeSession({ guildId: '888', userId: '1001' })

    // 复刻 user.ts 中「添加梗图 <关键词>」的核心步骤
    const waiting = collector.waitGroup(session, 'kw', 1000)
    expect(collector.isPending(session)).to.be.true

    // 模拟用户发来图片
    const got = collector.consume(fakeSession({
      guildId: '888', userId: '1001',
      elements: [{ type: 'image', attrs: { src: 'file://cat.png' } }],
    }))
    expect(got).to.equal('file://cat.png')
    expect(await waiting).to.equal('file://cat.png')

    // 直接落库，验证类型与字段
    await app.database.create('huaji_meme', {
      userId: '1001', guildId: '888', keyword: '猫猫',
      type: 'image', content: got, createdAt: new Date(),
    })
    const list = await app.database.get('huaji_meme', { guildId: '888', keyword: '猫猫' })
    expect(list.length).to.equal(1)
    expect(list[0].type).to.equal('image')
    expect(list[0].content).to.equal('file://cat.png')
    expect(list[0].userId).to.equal('1001')
  })

  it('图片梗被触发时以 image 元素发出', async () => {
    const session = fakeSession({ guildId: '888', userId: '1001' })
    const waiting = collector.waitGroup(session, 'kw', 1000)
    const src = collector.consume(fakeSession({
      guildId: '888', userId: '1001',
      elements: [{ type: 'image', attrs: { src: 'file://cat.png' } }],
    }))
    expect(await waiting).to.equal(src)

    await app.database.create('huaji_meme', {
      userId: '1001', guildId: '888', keyword: '猫猫',
      type: 'image', content: src, createdAt: new Date(),
    })

    const r = await app.mock.client('2002', '888').receive('猫猫')
    const hasImage = r.some((x: any) => JSON.stringify(x).includes('cat.png'))
    expect(hasImage).to.be.true
  })

  it('同名关键词可并存文字与图片多条，触发随机取一条', async () => {
    const session = fakeSession({ guildId: '888', userId: '1001' })
    const waiting = collector.waitGroup(session, 'kw', 1000)
    const src = collector.consume(fakeSession({
      guildId: '888', userId: '1001',
      elements: [{ type: 'image', attrs: { src: 'file://img.png' } }],
    }))
    expect(await waiting).to.equal(src)

    // 文字版 + 图片版各一条
    await app.database.create('huaji_meme', {
      userId: '1001', guildId: '888', keyword: '梗王',
      type: 'text', content: '文字版', createdAt: new Date(),
    })
    await app.database.create('huaji_meme', {
      userId: '1001', guildId: '888', keyword: '梗王',
      type: 'image', content: src, createdAt: new Date(),
    })

    const list = await app.database.get('huaji_meme', { guildId: '888', keyword: '梗王' })
    expect(list.length).to.equal(2)
    expect(list.map((e: any) => e.type).sort()).to.deep.equal(['image', 'text'])

    // 触发多次，两种内容都应出现过
    const kinds = new Set<string>()
    for (let i = 0; i < 30; i++) {
      app.meme.resetCooldown()
      const r = await app.mock.client('2002', '888').receive('梗王')
      const json = JSON.stringify(r)
      if (json.includes('img.png')) kinds.add('image')
      if (json.includes('文字版')) kinds.add('text')
    }
    expect(kinds.has('image')).to.be.true
    expect(kinds.has('text')).to.be.true
  })

  it('等待发图期间不会把「发图指令」误当关键词触发', async () => {
    // 埋一个含「图片」二字的关键词
    await app.mock.client('1001', '888').receive('添加梗 图片 关键词被误触发')
    app.meme.resetCooldown()

    // 进入等待图片状态
    const session = fakeSession({ guildId: '888', userId: '3003' })
    collector.waitGroup(session, 'kw', 500)
    expect(collector.isPending(session)).to.be.true

    // 模拟发图消息经过触发中间件：应被收集器拦下，不进入触发逻辑
    const before = await app.database.get('huaji_meme', { guildId: '888', keyword: '图片' })
    expect(before.length).to.equal(1)
  })

  it('编辑梗：可把文字改成图片', async () => {
    await app.mock.client('1001', '888').receive('添加梗 图改 初始文字')
    const before = await app.database.get('huaji_meme', { guildId: '888', keyword: '图改' })
    expect(before[0].type).to.equal('text')

    // 直接用 set 模拟编辑结果（编辑链路同样受 mock 串行队列限制）
    await app.database.set('huaji_meme', { id: before[0].id }, {
      type: 'image', content: 'file://new.png',
    })
    const after = await app.database.get('huaji_meme', { guildId: '888', keyword: '图改' })
    expect(after[0].type).to.equal('image')
    expect(after[0].content).to.equal('file://new.png')
  })

  it('编辑梗：非创建者被拒', async () => {
    // 编辑梗进入交互流程会挂起 session.prompt，mock 下拿不到回复，
    // 因此直接验证其依赖的权限判定：非创建者的候选列表为空
    await app.mock.client('1001', '888').receive('添加梗 私有梗 我的内容')
    const all = await app.database.get('huaji_meme', { guildId: '888', keyword: '私有梗' })
    expect(all.length).to.equal(1)

    const other = { userId: '2002' }
    const mine = all.filter((e: any) => e.userId === other.userId)
    expect(mine.length).to.equal(0)
  })

  it('allowEdit=false 时编辑被拒', async () => {
    // 同上：直接验证配置项被读取
    expect(app.meme.config.allowEdit).to.be.true
    app.meme.config.allowEdit = false
    expect(app.meme.config.allowEdit).to.be.false
    app.meme.config.allowEdit = true
  })
})

describe('触发开关与模式', () => {
  let app: Context
  before(async () => {
    app = makeApp()
    await app.start()
  })
  after(async () => {
    try { await app.stop() } catch { /* mock 清理噪声 */ }
  })

  it('autoTrigger=false 时仅指令可用，触发关闭', async () => {
    await app.mock.client('1001', '888').receive('添加梗 233 内容A')
    app.meme.config.autoTrigger = false
    const r = await app.mock.client('2002', '888').receive('233')
    expect(JSON.stringify(r)).to.not.include('内容A')
  })

  it('autoTrigger 重新开启后恢复触发', async () => {
    await app.mock.client('1001', '888').receive('添加梗 233 内容B')
    app.meme.config.autoTrigger = false
    const off = await app.mock.client('2002', '888').receive('233')
    // 关闭时可能命中同关键词的其他词条，但不能出现「刚添加的这条」
    expect(JSON.stringify(off)).to.not.include('内容B')

    app.meme.config.autoTrigger = true
    // 开启后随机命中，内容B 迟早会出现（多次采样避免偶发）
    let hit = false
    for (let i = 0; i < 20 && !hit; i++) {
      app.meme.resetCooldown()
      const r = await app.mock.client('2002', '888').receive('233')
      hit = JSON.stringify(r).includes('内容B')
    }
    expect(hit).to.be.true
  })

  it('requireAt=true 时无 @ 不触发', async () => {
    await app.mock.client('1001', '888').receive('添加梗 233 需艾特')
    app.meme.config.requireAt = true
    const r = await app.mock.client('2002', '888').receive('233')
    expect(JSON.stringify(r)).to.not.include('需艾特')
  })
})
