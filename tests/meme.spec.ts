import { Context } from 'koishi'
import { expect } from 'chai'
import mock from '@koishijs/plugin-mock'
import memory from '@koishijs/plugin-database-memory'
import * as mod from '../src'

const plugin = (mod as any).default ?? mod

const ADMIN = '9999' // 配置为管理员
const USER_A = '1001'
const USER_B = '2002'
const GUILD = '888'

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

async function start(app: Context) {
  await app.start()
}
async function stop(app: Context) {
  try {
    await app.stop()
  } catch {
    /* mock 清理副作用，忽略 */
  }
}

/** 从 mock 回复中提取文本 */
function textOf(reply: any): string {
  return String(reply?.message ?? reply ?? '')
}

describe('梗词插件 · 纯逻辑单元测试', () => {
  const helpers = (mod as any).helpers ?? require('../src/helpers')

  describe('ID 规范化', () => {
    it('去掉 platform 前缀', () => {
      expect(helpers.normalizeId('onebot:123')).to.equal('123')
      expect(helpers.normalizeId('qq:456')).to.equal('456')
      expect(helpers.normalizeId('789')).to.equal('789')
    })

    it('空值安全', () => {
      expect(helpers.normalizeId('')).to.equal('')
      expect(helpers.normalizeIdList([])).to.deep.equal([])
      expect(helpers.normalizeIdList([' a ', '', 'onebot:b'])).to.deep.equal(['a', 'b'])
    })
  })

  describe('关键词匹配', () => {
    it('fuzzy：子串命中', () => {
      expect(helpers.matchKeyword('今天的233太离谱了', '233', 'fuzzy')).to.be.true
      expect(helpers.matchKeyword('233', '233', 'fuzzy')).to.be.true
    })

    it('fuzzy：不命中', () => {
      expect(helpers.matchKeyword('今天很开心', '233', 'fuzzy')).to.be.false
    })

    it('exact：必须整条相等', () => {
      expect(helpers.matchKeyword('233', '233', 'exact')).to.be.true
      expect(helpers.matchKeyword('今天的233太离谱了', '233', 'exact')).to.be.false
    })

    it('空关键词永不命中', () => {
      expect(helpers.matchKeyword('任意内容', '', 'fuzzy')).to.be.false
      expect(helpers.matchKeyword('', '233', 'fuzzy')).to.be.false
    })
  })

  describe('指令参数解析', () => {
    it('拆分关键词与内容', () => {
      expect(helpers.parseKeywordContent('233 你干嘛哎哟')).to.deep.equal({ keyword: '233', content: '你干嘛哎哟' })
    })

    it('内容含空格时只取首词为关键词', () => {
      expect(helpers.parseKeywordContent('233 你 干 嘛')).to.deep.equal({ keyword: '233', content: '你' })
    })

    it('缺内容或全空返回 null', () => {
      expect(helpers.parseKeywordContent('233')).to.be.null
      expect(helpers.parseKeywordContent('')).to.be.null
    })
  })
})

describe('梗词插件 · 权限判定', () => {
  let app: Context
  before(async () => {
    app = makeApp({ adminList: [ADMIN], userBlacklist: ['6666'] })
    await start(app)
  })
  after(async () => { await stop(app) })

  it('配置列表内用户是管理员', () => {
    expect(app.meme.isAdmin({ userId: ADMIN })).to.be.true
  })

  it('非列表普通用户不是管理员', () => {
    expect(app.meme.isAdmin({ userId: USER_A })).to.be.false
  })

  it('Koishi authority>=3 也是管理员', () => {
    expect(app.meme.isAdmin({ userId: 'whatever', authority: 3 })).to.be.true
  })

  it('authority<3 不是管理员', () => {
    expect(app.meme.isAdmin({ userId: 'whatever', authority: 2 })).to.be.false
  })

  it('黑名单命中被拒绝', () => {
    expect(app.meme.checkAccess({ userId: '6666', guildId: GUILD })).to.be.ok
  })

  it('正常人放行（返回 null）', () => {
    expect(app.meme.checkAccess({ userId: USER_A, guildId: GUILD })).to.be.null
  })
})

describe('梗词插件 · 群白名单', () => {
  let app: Context
  before(async () => {
    app = makeApp({ groupWhitelistEnabled: true, groupWhitelist: [GUILD] })
    await start(app)
  })
  after(async () => { await stop(app) })

  it('白名单内群放行', async () => {
    const r = await app.mock.client(USER_A, GUILD).receive('梗帮助')
    expect(r.length).to.be.greaterThan(0)
  })

  it('非白名单群静默拦截', async () => {
    const r = await app.mock.client(USER_A, '777').receive('梗帮助')
    expect(r.length).to.equal(0)
  })
})

describe('梗词插件 · 私聊开关', () => {
  let app: Context
  before(async () => {
    app = makeApp({ allowPrivateChat: false })
    await start(app)
  })
  after(async () => { await stop(app) })

  it('私聊被拒绝', async () => {
    const r = await app.mock.client(USER_A).receive('梗帮助')
    expect(r.length).to.equal(0)
  })
})

describe('梗词插件 · 绑定与查询', () => {
  let app: Context
  before(async () => {
    app = makeApp()
    await start(app)
  })
  after(async () => { await stop(app) })

  it('添加梗（文字）成功入库', async () => {
    const r = await app.mock.client(USER_A, GUILD).receive('添加梗 233 你干嘛哎哟')
    expect(textOf(r[0])).to.contain('已绑定文字梗')
    const list = await app.database.get('huaji_meme', { guildId: GUILD, keyword: '233' })
    expect(list.length).to.equal(1)
    expect(list[0].content).to.equal('你干嘛哎哟')
    expect(list[0].type).to.equal('text')
  })

  it('重复添加同名关键词 → 允许多条并存', async () => {
    await app.mock.client(USER_B, GUILD).receive('添加梗 233 我是你爸爸')
    const list = await app.database.get('huaji_meme', { guildId: GUILD, keyword: '233' })
    expect(list.length).to.equal(2)
  })

  it('关键词与内容以首个空格分隔（内容可含空格）', async () => {
    const r = await app.mock.client(USER_A, GUILD).receive('添加梗 你 干嘛哎哟')
    expect(textOf(r[0])).to.contain('已绑定文字梗')
    expect(textOf(r[0])).to.contain('干嘛哎哟')
  })

  it('只有一个词、缺内容时被拒', async () => {
    const r = await app.mock.client(USER_A, GUILD).receive('添加梗 光秃秃')
    expect(textOf(r[0])).to.contain('用法：添加梗')
  })

  it('关键词超长被拒', async () => {
    const long = 'x'.repeat(30)
    const r = await app.mock.client(USER_A, GUILD).receive(`添加梗 ${long} 内容`)
    expect(textOf(r[0])).to.contain('关键词过长')
  })

  it('梗列表列出本群全部词条', async () => {
    const r = await app.mock.client(USER_A, GUILD).receive('梗列表')
    expect(textOf(r[0])).to.contain('233')
  })

  it('我的梗只显示自己的', async () => {
    const r = await app.mock.client(USER_A, GUILD).receive('我的梗')
    expect(textOf(r[0])).to.contain('你创建的梗词')
    const list = await app.database.get('huaji_meme', { userId: USER_A })
    expect(list.every((e: any) => e.userId === USER_A)).to.be.true
  })

  it('词条按群隔离：另一群不可见', async () => {
    const r = await app.mock.client(USER_A, '999').receive('梗列表')
    expect(textOf(r[0])).to.contain('还没有人创建')
  })
})

describe('梗词插件 · 删除权限', () => {
  let app: Context
  before(async () => {
    app = makeApp()
    await start(app)
    await app.mock.client(USER_A, GUILD).receive('添加梗 哈哈 笑死')
  })
  after(async () => { await stop(app) })

  it('非创建者删除被拒', async () => {
    const r = await app.mock.client(USER_B, GUILD).receive('删除梗 哈哈')
    expect(textOf(r[0])).to.contain('无权删除')
    const list = await app.database.get('huaji_meme', { guildId: GUILD, keyword: '哈哈' })
    expect(list.length).to.equal(1)
  })

  it('创建者可删除自己的', async () => {
    const r = await app.mock.client(USER_A, GUILD).receive('删除梗 哈哈')
    expect(textOf(r[0])).to.contain('已删除')
    const list = await app.database.get('huaji_meme', { guildId: GUILD, keyword: '哈哈' })
    expect(list.length).to.equal(0)
  })

  it('删除不存在的关键词给出提示', async () => {
    const r = await app.mock.client(USER_A, GUILD).receive('删除梗 不存在的词')
    expect(textOf(r[0])).to.contain('本群没有关键词')
  })
})

describe('梗词插件 · 管理员指令', () => {
  let app: Context
  before(async () => {
    app = makeApp({ adminList: [ADMIN] })
    await start(app)
    await app.mock.client(USER_A, GUILD).receive('添加梗 233 AAA')
  })
  after(async () => { await stop(app) })

  it('普通用户用管理指令被拒', async () => {
    const r = await app.mock.client(USER_A, GUILD).receive('管理梗列表')
    expect(textOf(r[0])).to.contain('仅限管理员')
  })

  it('管理员可查看管理列表（含创建者）', async () => {
    const r = await app.mock.client(ADMIN, GUILD).receive('管理梗列表')
    expect(textOf(r[0])).to.contain('梗词')
    expect(textOf(r[0])).to.contain(USER_A)
  })

  it('管理员可强制删除他人词条', async () => {
    const r = await app.mock.client(ADMIN, GUILD).receive('管理删除 233')
    expect(textOf(r[0])).to.contain('已删除')
    const list = await app.database.get('huaji_meme', { guildId: GUILD, keyword: '233' })
    expect(list.length).to.equal(0)
  })

  it('管理清空清空本群', async () => {
    await app.mock.client(USER_A, GUILD).receive('添加梗 666 运气不错')
    const r = await app.mock.client(ADMIN, GUILD).receive('管理清空')
    expect(textOf(r[0])).to.contain('已清空')
    const list = await app.database.get('huaji_meme', { guildId: GUILD })
    expect(list.length).to.equal(0)
  })

  it('管理设置可切匹配模式', async () => {
    const r = await app.mock.client(ADMIN, GUILD).receive('管理设置 匹配模式 exact')
    expect(textOf(r[0])).to.contain('精确匹配')
    expect(app.meme.config.matchMode).to.equal('exact')
  })

  it('管理设置可关自动触发', async () => {
    const r = await app.mock.client(ADMIN, GUILD).receive('管理设置 自动触发 关')
    expect(textOf(r[0])).to.contain('已关闭')
    expect(app.meme.config.autoTrigger).to.be.false
  })

  it('管理设置非法值被拒', async () => {
    const r = await app.mock.client(ADMIN, GUILD).receive('管理设置 匹配模式 xxx')
    expect(textOf(r[0])).to.contain('只能是 fuzzy 或 exact')
  })
})

describe('梗词插件 · 触发机制', () => {
  let app: Context
  beforeEach(async () => {
    app = makeApp()
    await start(app)
  })
  afterEach(async () => { await stop(app) })

  it('提到关键词自动回复对应文字', async () => {
    await app.mock.client(USER_A, GUILD).receive('添加梗 233 你干嘛哎哟')
    const r = await app.mock.client(USER_B, GUILD).receive('今天的233太离谱了')
    const texts = r.map((x: any) => textOf(x))
    expect(texts.some((t: string) => t.includes('你干嘛哎哟'))).to.be.true
  })

  it('未提到关键词不触发', async () => {
    await app.mock.client(USER_A, GUILD).receive('添加梗 233 你干嘛哎哟')
    const r = await app.mock.client(USER_B, GUILD).receive('今天天气不错')
    const texts = r.map((x: any) => textOf(x))
    expect(texts.some((t: string) => t.includes('你干嘛哎哟'))).to.be.false
  })

  it('私聊不触发', async () => {
    await app.mock.client(USER_A, GUILD).receive('添加梗 233 你干嘛哎哟')
    const r = await app.mock.client(USER_B).receive('233')
    const texts = r.map((x: any) => textOf(x))
    expect(texts.some((t: string) => t.includes('你干嘛哎哟'))).to.be.false
  })

  it('autoTrigger=false 时不自动触发', async () => {
    await app.mock.client(USER_A, GUILD).receive('添加梗 233 你干嘛哎哟')
    app.meme.config.autoTrigger = false
    const r = await app.mock.client(USER_B, GUILD).receive('233')
    const texts = r.map((x: any) => textOf(x))
    expect(texts.some((t: string) => t.includes('你干嘛哎哟'))).to.be.false
  })

  it('exact 模式下整条相等才触发', async () => {
    await app.mock.client(USER_A, GUILD).receive('添加梗 233 精准')
    app.meme.config.matchMode = 'exact'
    let r = await app.mock.client(USER_B, GUILD).receive('233')
    let texts = r.map((x: any) => textOf(x))
    expect(texts.some((t: string) => t.includes('精准'))).to.be.true

    r = await app.mock.client(USER_B, GUILD).receive('233 哈哈哈')
    texts = r.map((x: any) => textOf(x))
    expect(texts.some((t: string) => t.includes('精准'))).to.be.false
  })

  it('冷却期内同词不重复触发', async () => {
    app.meme.config.cooldownSeconds = 30
    await app.mock.client(USER_A, GUILD).receive('添加梗 233 冷却测试')
    const r1 = await app.mock.client(USER_B, GUILD).receive('233')
    expect(r1.map((x: any) => textOf(x)).some((t: string) => t.includes('冷却测试'))).to.be.true

    const r2 = await app.mock.client(USER_B, GUILD).receive('233')
    expect(r2.map((x: any) => textOf(x)).some((t: string) => t.includes('冷却测试'))).to.be.false
  })

  it('多条同名词条随机取一条（都在候选内）', async () => {
    await app.mock.client(USER_A, GUILD).receive('添加梗 233 AAA')
    await app.mock.client(USER_B, GUILD).receive('添加梗 233 BBB')
    const seen = new Set<string>()
    for (let i = 0; i < 30; i++) {
      app.meme.resetCooldown()
      const r = await app.mock.client(USER_A, GUILD).receive('233')
      const hit = r.map((x: any) => textOf(x)).find((t: string) => t === 'AAA' || t === 'BBB')
      if (hit) seen.add(hit)
    }
    expect(seen.has('AAA')).to.be.true
    expect(seen.has('BBB')).to.be.true
  })

  it('长短关键词同时命中时只取最长', async () => {
    await app.mock.client(USER_A, GUILD).receive('添加梗 233 短词')
    await app.mock.client(USER_A, GUILD).receive('添加梗 23333 长词')
    app.meme.config.cooldownSeconds = 0
    const r = await app.mock.client(USER_B, GUILD).receive('23333')
    const texts = r.map((x: any) => textOf(x))
    expect(texts.some((t: string) => t === '长词')).to.be.true
    expect(texts.filter((t: string) => t === '短词').length).to.equal(0)
  })
})

describe('梗词插件 · 配额限制', () => {
  let app: Context
  beforeEach(async () => {
    app = makeApp({ maxUserEntries: 2 })
    await start(app)
  })
  afterEach(async () => { await stop(app) })

  it('达到单用户上限后拒绝继续创建', async () => {
    await app.mock.client(USER_A, GUILD).receive('添加梗 a1 内容1')
    await app.mock.client(USER_A, GUILD).receive('添加梗 a2 内容2')
    const r = await app.mock.client(USER_A, GUILD).receive('添加梗 a3 内容3')
    expect(textOf(r[0])).to.contain('达到上限')
    const list = await app.database.get('huaji_meme', { userId: USER_A })
    expect(list.length).to.equal(2)
  })

  it('配额按用户独立计算', async () => {
    await app.mock.client(USER_A, GUILD).receive('添加梗 a1 内容1')
    await app.mock.client(USER_A, GUILD).receive('添加梗 a2 内容2')
    const r = await app.mock.client(USER_B, GUILD).receive('添加梗 b1 内容1')
    expect(textOf(r[0])).to.contain('已绑定文字梗')
  })

  it('全局上限生效', async () => {
    app.meme.config.maxUserEntries = 0
    app.meme.config.maxTotalEntries = 1
    await app.mock.client(USER_A, GUILD).receive('添加梗 g1 内容1')
    const r = await app.mock.client(USER_B, GUILD).receive('添加梗 g2 内容2')
    expect(textOf(r[0])).to.contain('全平台梗词总数已达上限')
  })
})

describe('梗词插件 · 用户黑名单', () => {
  let app: Context
  before(async () => {
    app = makeApp({ userBlacklist: ['6666'] })
    await start(app)
  })
  after(async () => { await stop(app) })

  it('黑名单用户无法创建词条（静默，无任何回复）', async () => {
    const r = await app.mock.client('6666', GUILD).receive('添加梗 233 内容')
    expect(r.length).to.equal(0)
    const list = await app.database.get('huaji_meme', { guildId: GUILD })
    expect(list.length).to.equal(0)
  })

  it('黑名单用户无法查看列表（静默）', async () => {
    const r = await app.mock.client('6666', GUILD).receive('梗列表')
    expect(r.length).to.equal(0)
  })

  it('黑名单用户在非群聊同样被拦', () => {
    expect(app.meme.isBlacklisted({ userId: '6666' })).to.be.true
    expect(app.meme.isBlacklisted({ userId: '1001' })).to.be.false
  })
})
