# 开发者文档 · 秘密调查档案馆

> 面向**开发与运维**：系统架构、目录结构、数据模型、接口规格、规则引擎、安全设计、
> 部署与运维、测试门禁、开发约定与踩坑、已知限制。
> 只想把站点跑起来用起来，请回到 [README](../README.md)。

---

## 目录

- [一、系统架构](#一系统架构)
- [二、目录结构](#二目录结构)
- [三、数据模型](#三数据模型)
- [四、接口一览](#四接口一览)
- [五、COC 7e 规则引擎](#五coc-7e-规则引擎)
- [六、安全设计](#六安全设计)
- [七、生产部署与运维](#七生产部署与运维)
- [八、测试与质量门禁](#八测试与质量门禁)
- [九、演示数据与截图脚本](#九演示数据与截图脚本)
- [十、开发约定与踩坑记录](#十开发约定与踩坑记录)
- [十一、已知限制与路线图](#十一已知限制与路线图)

---

## 一、系统架构


```
                      浏览器（访客 / 调查员 / 守秘人）
                                  │ HTTPS
                                  ▼
                 ┌────────────────────────────────────┐
                 │  Nginx（deploy/nginx.conf.sample） │
                 │  ├── /            → dist/ 静态文件  │
                 │  ├── /assets/*    → 长缓存(1y)      │
                 │  └── /api/*       → 127.0.0.1:3000  │
                 └────────────────┬───────────────────┘
                                  ▼
                 ┌────────────────────────────────────┐
                 │  Express 5  @ 127.0.0.1:3000       │
                 │  ├── securityHeaders / 全局限流      │
                 │  ├── express.json({ limit: 256kb })│
                 │  ├── requireAuth / requireAdmin    │
                 │  ├── validate.js 白名单重建对象      │
                 │  └── shared/coc7e.js 派生值权威重算  │
                 └────────────────┬───────────────────┘
                                  ▼
        backend/data/database.json            原子写 + 每日备份（保留 14 份）
        backend/data/audit/audit-YYYY-MM-DD.jsonl   审计日志（按天切分）
```

一次写请求的完整生命周期：

```
1. 前端 api() 附加 Authorization: Bearer <token>
2. securityHeaders → 全局限流 → express.json（256KB 上限）
3. requireAuth（摘要查表 + 过期判定）→ requireAdmin（如需）
4. validate.js 用显式白名单重建对象 —— 未知字段一律丢弃
5. 资源归属校验（本人 / KP），越权记审计并返回 403
6. 改内存 → save()（临时文件 → fsync → rename 原子替换）
7. 派生值由 shared/coc7e.js 重算后随响应下发
8. audit() 追加一条 JSONL；错误统一走 errorHandler（对外脱敏）
```

### 六个关键设计决策

| # | 决策 | 为什么 |
| --- | --- | --- |
| 1 | **规则引擎放 `shared/coc7e.js`，前后端共用** | 前端实时算、后端存盘时重算，算法只有一份，永远不会前后端不一致 |
| 2 | **存档只存"玩家输入"** | HP/MP/理智/技能成功率/资产等派生值一律不落库，客户端无法伪造数值 |
| 3 | **批复存独立的 `reviews` 集合** | 角色卡本体只有 `reviewStatus`，打印组件只读本体 → 审核信息在数据结构上就不可能被打印 |
| 4 | **访客路径完全不经过服务端** | 访客车卡存 localStorage，因此不存在匿名写接口，也就没有匿名越权面 |
| 5 | **单文件 JSON + 内存常驻** | 数据量极小（几十用户 / 几十张卡），运维成本为零；但必须原子写 + 备份 |
| 6 | **令牌登录即轮换** | 单点登录语义：新设备登录会让旧设备失效，符合"一个人一张卡"的跑团场景 |

---

---

## 二、目录结构


```
.
├── index.html                    站点入口（含 CSP meta 兜底）
├── vite.config.js                dev(5173)/preview(4173) 都把 /api 代理到 127.0.0.1:3000
├── eslint.config.js              前后端分区 lint
├── run-local.sh                  本地一键启停 ★常用
├── deploy.sh                     构建 → lint → rsync --delete 部署
├── deploy/nginx.conf.sample      生产反代 + 安全响应头 + 缓存策略
│
├── shared/                       ★前后端共用，改规则先看这里
│   ├── coc7e.js                  COC 7e 规则引擎（纯函数）
│   └── coc7e-reference.js        生成物，勿手改：54 技能 / 229 职业 / 105 武器
│
├── src/
│   ├── App.jsx                   壳层：导航、视图路由 go(view,arg)、全局 toast/confirm
│   ├── index.css                 Tailwind 入口 + 动画工具类 + 打印样式 + 原生控件暗色化
│   ├── lib/
│   │   ├── api.js                统一请求客户端（令牌、超时、401 广播登出）
│   │   ├── dice.js               Web Crypto 骰子
│   │   └── guestStore.js         访客角色卡的 localStorage 存储
│   ├── components/
│   │   ├── ui.jsx                UI 原语：Button/Field/Modal/Toast/Combobox…
│   │   ├── ModuleCover.jsx       模组封面装饰层「档案封印」
│   │   ├── CertificatePreview.jsx 三套长图版面 + 本地导出
│   │   ├── KpDashboardPanel.jsx  守秘人控制台
│   │   ├── AdminUsersPanel.jsx   账号管理
│   │   ├── CharacterPrintView.jsx 打印预览壳
│   │   └── characters/
│   │       ├── CharacterList.jsx    列表（mine / guest / kp 三模式）
│   │       ├── CharacterEditor.jsx  ★半自动车卡编辑器（最大文件）
│   │       ├── CharacterDetail.jsx  详情 + 模组经历 + 送审/批复
│   │       ├── CharacterPrint.jsx   A4 双页打印版面
│   │       └── KpReviewCenter.jsx   ★审卡中心
│   └── views/                    页面级组件：Auth / Home / ModuleDetail / ModuleForm / Profile
│
├── backend/
│   ├── server.js                 启动、中间件编排、路由挂载、优雅退出
│   ├── lib/
│   │   ├── db.js                 JSON 数据层：原子写、备份轮转、schema 迁移
│   │   ├── security.js           scrypt 口令、令牌摘要、限流器、安全响应头
│   │   ├── auth.js               requireAuth / requireAdmin / optionalAuth
│   │   ├── validate.js           全部入参白名单与校验 ★加字段先改这里
│   │   ├── audit.js              审计日志（JSONL 按天切分，保留 30 天）
│   │   └── errors.js             HttpError + 集中错误出口
│   ├── routes/                   auth / users / modules / characters
│   ├── tools/
│   │   ├── smoke-test.mjs        后端冒烟测试（159 项断言，无框架）
│   │   └── fixtures/             冒烟测试用的合成旧库夹具
│   └── data/                     运行期数据（database.json / backups / audit）—— 已 gitignore
│
├── tools/
│   ├── gen-coc7e-data.py         ★从官方 Excel 生成 shared/coc7e-reference.js
│   ├── ui-check.mjs              无头 Chrome 界面冒烟测试（54 项断言）
│   ├── seed-demo.mjs             演示数据生成器（截图 / 试玩用）
│   └── screenshots.mjs           README 配图采集脚本
│
└── docs/images/                  README 截图
```

---

---

## 三、数据模型


存储在 `backend/data/database.json`（`schemaVersion: 6`），顶层是 8 个集合：

| 集合 | 说明 |
| --- | --- |
| `users` | 账号：scrypt 口令（**无明文**）、角色、头衔、令牌摘要与过期时间 |
| `modules` | 模组档案：标题/合集/地区/时代/人数/时长/背景/车卡要求/推荐职业与技能/KP 备注/置顶/主题色 |
| `played_records` | `{ userId, moduleId, at }` —— 「已调查」标记，toggle 语义 |
| `sessions` | 带团记录：`{ id, moduleId, date, duration, playerCount, investigators }` |
| `characters` | 角色卡：**只存玩家输入**（见下） |
| `customOccupations` | KP 自定义职业模板 |
| `reviews` | 审核记录与批复（**批复只存在这里**） |
| `settings.auditRules` | 10 条审卡规则（混点规则内含 3 条判定） |

### 角色卡：存什么，不存什么

```jsonc
{
  "id": "c_xxx", "ownerId": "u_xxx",
  "name": "伊莱亚斯", "playerName": "林晚照", "gender": "男",
  "residence": "美国 · 波士顿", "birthplace": "荷兰 · 鹿特丹", "era": "1920s",
  "occupationId": "220",           // 229 条职业表里的 id，或 KP 自定义模板 id
  "age": 34, "eduBonus": 3,        // 年龄决定补正池点数与教育增强次数
  "applyAgeAdjust": true, "armorPenalty": 0,
  "ageAlloc": { "STR": 2, "CON": 2, "DEX": 1 },   // 年龄补正分配；空对象 = 默认平均分配
  "eduGrowth": { "settled": true, "gain": 8, "attempts": [], "granted": 0 },  // 教育成长流水 + KP 授权次数（结算后锁定）
  "legendary": { "enabled": false },              // KP 专属：传奇标记（允许突破 99）
  "legendaryBonus": { "STR": 0 },                 // KP 专属：传奇额外调整值（单独一栏）
  "agePenaltyWaived": false,                      // KP 专属：豁免年龄减益
  "notes": "",                                     // 玩家备注（不打印）
  "chars": { "STR": 50, "CON": 55, "SIZ": 60, "DEX": 65,
             "APP": 60, "INT": 70, "POW": 55, "EDU": 75, "Luck": 60 },
  "occPicks": { "free": [], "social": ["fastTalk", "charm"], "choices": [] },
  "skills":   [ { "id": "library", "key": "library", "custom": "",
                  "occ": 45, "interest": 0, "growth": 0 } ],   // 只存投入，不存结果
  "customSkills": [], "skillMarks": { "library": true },
  "weapons": [], "equipment": "", "extraAssets": "", "currency": "USD",
  "background": { "appearance": "…", "traits": "…", /* 共 10 栏 */ },
  "moduleLinks": [ { "moduleId": "m_xxx", "role": "PC", "date": "2026-05-01", "note": "…" } ],
  "experience": "", "status": "active", "isPublic": true,
  "reviewStatus": "approved",      // 唯一的流程状态字段
  "createdAt": 0, "updatedAt": 0
}
```

**存档里没有** `hp / mp / san / mov / db / build / 信用评级 / 技能成功率 / 消费水平 / 现金 / 资产 / 点数余额`。
它们每次都由 `shared/coc7e.js` 依据「玩家输入 + 参考表」重算后下发。其中资产由
`wealthOf(信用评级, 时代, 货币)` 按官方《资产及物价参考》表实时推导——**客户端提交的 `assets` 会被服务端直接忽略**，
想提高资产只能提升信用评级。

---

---

## 四、接口一览


共 **47 个端点**，统一约定：成功返回实体或 `{ success: true }`；失败返回 `{ error: '中文提示' }`；
鉴权失败 `401`、越权 `403`、参数非法 `400`、不存在 `404`、限流 `429`。

<details>
<summary><b>认证与账号</b>（点击展开）</summary>

| 方法 | 路径 | 权限 | 说明 |
| --- | --- | --- | --- |
| GET | `/api/health` | 公开 | 健康检查 |
| GET | `/api/kp-name` | 公开 | 证书上的 KP 署名 |
| POST | `/api/register` | 公开 | **仅当库中无任何账号**；首个账号即管理员 |
| POST | `/api/login` | 公开 | 登录（失败限流；令牌轮换） |
| POST | `/api/logout` | 登录 | 服务端吊销当前令牌 |
| GET | `/api/user/me` | 登录 | 当前用户（含头衔、是否需改密） |
| PUT | `/api/user/password` | 登录 | 改密（改后吊销全部会话） |
| PUT | `/api/user/username` | 登录 | 本人改名 |
| GET/POST | `/api/admin/users` | KP | 账号列表（含角色卡数量）/ 发放账号 |
| PUT | `/api/admin/users/:id/password` | KP | 重置为**随机强口令**，仅回显一次 |
| PUT | `/api/admin/users/:id/title` | KP | 授予荣誉头衔 |
| PUT | `/api/admin/users/:id/username` | KP | KP 代改用户名 |
| DELETE | `/api/admin/users/:id` | KP | 删除账号（级联清理；不能删自己/最后一名管理员） |
| GET | `/api/admin/audit` | KP | 审计日志（`?date=&limit=`） |
| GET/PUT | `/api/admin/audit-rules` | KP | 读取 / 保存审卡规则 |
| GET/POST/PUT/DELETE | `/api/admin/occupations[/:id]` | KP | 职业模板 CRUD |

</details>

<details>
<summary><b>模组、已跑、带团</b>（点击展开）</summary>

| 方法 | 路径 | 权限 | 说明 |
| --- | --- | --- | --- |
| GET | `/api/modules` | 公开 | 置顶优先 + 创建时间倒序 |
| POST | `/api/modules` | KP | 新建（id / 主题色 / 时间戳服务端生成） |
| PUT | `/api/modules/:id` | KP | 局部更新 |
| DELETE | `/api/modules/:id` | KP | 级联清理带团记录、已跑标记与角色卡经历关联 |
| GET | `/api/played` | 登录 | 本人已跑记录 |
| POST | `/api/played` | 登录 | 切换已跑标记 |
| GET/POST/DELETE | `/api/sessions[/:id]` | KP | 带团记录列表 / 新增 / 删除 |

</details>

<details>
<summary><b>角色卡</b>（点击展开）</summary>

| 方法 | 路径 | 权限 | 说明 |
| --- | --- | --- | --- |
| GET | `/api/characters/meta` | **可选登录** | 车卡元数据（访客也要拿职业模板与模组列表） |
| GET | `/api/characters` | 登录 | 列表；玩家恒为本人，KP 可 `scope=all` 并按 ownerId/status/moduleId/q 筛选 |
| POST | `/api/characters` | 登录 | 新建；KP 可传 `ownerId` 代玩家建卡 |
| GET | `/api/characters/:id` | 本人 / KP / 已公开 | 详情（含派生数据与规则提示） |
| PUT / PATCH / DELETE | `/api/characters/:id` | 本人 / KP | 全量替换 / 局部更新 / 删除 |
| POST | `/api/characters/:id/duplicate` | 本人 / KP | 复制角色卡 |
| POST / DELETE | `/api/characters/:id/modules[/:moduleId]` | 本人 / KP | 关联 / 解除模组经历 |
| POST | `/api/characters/:id/submit`、`/withdraw` | 本人 / KP | 提交审核 / 撤回 |
| POST | `/api/characters/:id/review` | KP | 通过或驳回（驳回必须写批复） |
| GET | `/api/admin/reviews` | KP | 审核记录 |
| POST | `/api/admin/reviews/batch` | KP | 批量打「已通过」标签 |
| POST | `/api/admin/audit/:id`、`/api/admin/audit/batch` | KP | 规则辅助审卡（含 `scope=manual` 手动勾选） |

</details>

> 所有写接口都走 `backend/lib/validate.js` 的**显式白名单**重建对象；`ownerId` 只在「KP 建卡」与「KP 转移归属」两种显式场景下被接受。

---

---

## 五、COC 7e 规则引擎


`shared/coc7e.js` 是一个**纯函数**规则引擎，前端与后端 import 同一份文件。

### 已实现的规则

- **教育增强**：`eduGrowth.attempts` 是累计流水（次数/骰点/提升/操作人/来源），`settled` 决定是否还提示「需要做 N 次检定」；
  **首次结算后锁定**（`locked`）——玩家不能自助重掷或清零，只能由 KP「授权重掷一次」（消耗 `granted`）或「重置教育增强」；
  服务端 `guardEduGrowth()` 兜底，玩家绕过界面发请求也会被还原成存档值。
- **传奇 / 豁免（KP 专属）**：`legendary` 允许突破属性 99（额外调整值单独一栏），`agePenaltyWaived` 只去掉年龄减益。
- **属性与年龄补正**：**外貌是固定减值**，力量/体型/体质/敏捷是「合计减 N 点、由玩家自行分配」（存档字段 `ageAlloc`）。
  15-19 岁：力量/体型合计 −5、教育 −5、幸运掷两次取高；40 岁起每 10 岁一档，
  力量/体质/敏捷合计 −5 / −10 / −20 / −40 / −80，外貌固定 −5 / −10 / −15 / −20 / −25，
  并需要 2 / 3 / 4 / 4 / 4 次教育增强检定（20-39 岁为 1 次）。
- **派生值**：HP = ⌊(体质+体型)/10⌋；重伤值 = ⌈HP/2⌉；MP = ⌊意志/5⌋；理智初始 = 意志；
  移动力 = 8 +（力量与敏捷均 > 体型则 +1；均 < 体型则 −1）− 年龄减值 − 护甲减值；
  伤害加值/体格按 力量+体型 查表（≤64 → −2 / −2 …… ≤284 → +2D6 / 3，之后每 80 点 +1D6 / +1）。
- **技能点**：职业点按职业公式（教育×4、教育×2＋敏捷×2、MAX(...) 等形式）；兴趣点 = 智力×2；
  单技能上限 99（克苏鲁神话不受限）；信用评级必须落在职业区间内，且始终可用职业点提升。
- **专攻组**：技艺 3 / 格斗 3 / 射击 3 / 外语 3 / 科学 3 / 驾驶 1 / 生存 1 / 学识 1 个槽位，与官方纸质卡版面一致。
- **资产推导**：`wealthOf(信用评级, 时代, 货币)` 按官方《资产及物价参考》表推导消费水平 / 现金 / 资产。

### 参考数据从哪来

```
官方空白卡 Excel（COC七版规则空白卡CY21.1.xlsx）
        │  tools/gen-coc7e-data.py
        │  ├─ 技能主表（人工核对过的基础值）
        │  ├─ 职业表 229 条（含「，、（）或」括号感知解析 + 技能名同义词归一）
        │  └─ 专攻预设
        ▼
shared/coc7e-reference.js  ──►  前端（实时计算与展示）
                           └──►  后端（保存时权威重算与校验）
```

**`shared/coc7e-reference.js` 是生成物，不要手改。** 要改规则数据就改 Python 生成器后重新生成：

```bash
python tools/gen-coc7e-data.py "<xlsx路径>"
```

---

---

## 六、安全设计


这个项目在安全上做了一轮系统性加固，值得单独说明：

| 措施 | 实现 |
| --- | --- |
| 口令存储 | scrypt 加盐哈希（N=16384, r=8, p=1），明文永不落库；旧库的明文口令在首次载入时自动迁移 |
| 会话令牌 | 客户端持有原始值，库中只存 SHA-256 摘要 + 过期时间（30 天）；登录即轮换；改密吊销全部会话 |
| 输入校验 | `validate.js` 用**显式白名单**重建对象，未知字段一律丢弃 |
| 越权防护 | 每个角色卡接口都做资源归属判定（本人 / KP / 已公开只读），越权记审计 |
| 限流 | 全局 600 req/min；登录失败按 IP 与「IP+用户名」双维度限流，成功后清零 |
| 数据安全 | 原子写（临时文件 → fsync → rename）+ 每日备份（保留 14 份）+ 迁移前快照 |
| 审计日志 | JSONL 按天切分，保留 30 天；删除、越权、改密、发号等敏感操作全部留痕 |
| 响应头 | `nosniff` / `X-Frame-Options: DENY` / `Referrer-Policy` / `Permissions-Policy` / CSP |
| CSP | `default-src 'self'`，无任何第三方 CDN；截图库已改为本地依赖 |
| 供应链 | 后端**只有 express 一个依赖**，其余能力用 Node 内置模块自实现 |
| 部署约束 | 后端只监听回环地址，杜绝绕过 Nginx 伪造 `X-Forwarded-For` 绕过限流 |

---

---

## 七、生产部署与运维


### 部署拓扑

```
Nginx（443/80） ──┬── /            → <站点静态根>（dist/ 静态产物）
                  ├── /assets/*    → 长缓存 1 年（文件名带内容哈希）
                  └── /api/*       → 127.0.0.1:3000（Express）
```

### 步骤

```bash
# 1) 拉代码、装依赖、构建
npm install && npm --prefix backend install
npm run lint && npm run build

# 2) 同步静态产物（rsync --delete，先删后传，杜绝新旧 hash 产物混堆）
bash deploy.sh <站点静态根>

# 3) 启动后端（建议交给 systemd）
COCOC_HOST=127.0.0.1 PORT=3000 npm --prefix backend start

# 4) 配置 Nginx 并重载
sudo cp deploy/nginx.conf.sample /etc/nginx/conf.d/coc.conf   # 按需修改 server_name 与 root
sudo nginx -t && sudo systemctl reload nginx
```

### 三条硬约束

1. **站点必须挂在域名根路径** —— `vite.config.js` 未设置 `base`，产物引用 `/assets/...` 绝对路径。
2. **后端必须只监听回环地址** —— 否则攻击者可以直连 3000 端口伪造 `X-Forwarded-For` 绕过限流。
3. **`index.html` 不可缓存** —— 否则发版后用户仍拿旧页面；`/assets/*` 可放心长缓存。

### 部署到服务器（静态站 + Node 服务）

本项目的线上形态很朴素，**任何**能满足下面两条的部署方式都可以：

1. 一个能放静态文件的站点根目录（放 `index/` 的内容，也就是构建产物 `dist/`）；
2. 一个常驻的 Node 进程（`cd backend && npm ci --omit=dev && npm run start`），
   前端站点的 `/api/*` 反向代理到它的 `127.0.0.1:3000`。

> 反向代理的样例配置见 `deploy/nginx.conf.sample`，把它改成你自己的域名与目录即可。
> 目录名只是示例，用你的面板/系统习惯的路径就行。

**如果后端跑在容器里**（Docker / 面板的 Node 运行环境等），只有一个坑要注意：
容器通常只把「代码目录」（`backend/`）挂进去，而后端要引用仓库根目录的 `shared/`
（`backend/lib/validate.js` 等 3 处 `import '../../shared/coc7e.js'`）。
这时**额外挂一条**：宿主机的 `<仓库根>/shared` → 容器**根目录下的 `/shared`**。
（不要挂到容器里放后端代码的那个目录，会把 `server.js`、`package.json` 整个盖掉。）

其余通用注意点：

1. **站点挂在域名根路径** —— `vite.config.js` 未设置 `base`，产物引用 `/assets/...` 绝对路径；
2. **后端只监听回环地址** —— 否则别人可以直连端口伪造 `X-Forwarded-For` 绕过限流；
   若确实跑在容器里，容器内保持监听 `0.0.0.0`（默认值），由宿主机端口映射收口；
3. **`index.html` 不要缓存** —— 否则发版后用户仍拿旧页面；`/assets/*` 可以长缓存；
4. **端口独占** —— 同一端口只能有一个后端进程，两个一起跑会表现为 502；
5. **文件属主** —— 用哪个用户跑，就用哪个用户拥有 `backend/` 与 `shared/`，否则会报 `EACCES`。

**更新线上（推荐用发布包，历史数据一个字节都不动）**

```bash
# 本地出包（产物在 ../_release/，VERSION 里记着源码提交号）
bash tools/make-release.sh ../_release v1.7.4

# 服务器上执行（路径换成你自己的站点根与后端目录）
tar -xzf coc-archive-update-v1.7.4-<日期>.tar.gz && cd coc-archive-update-v1.7.4-<日期>
sudo bash apply-update.sh   --web <站点根>/index   --app <后端目录>   --service <服务名> --port 3000
# 面板/容器方式部署的话，跑完记得把服务重启一次
```

脚本会先备份数据与旧代码到 `<站点>/.backups/`，结束时复核 `database.json` 校验和，不一致会提示回滚。
更新包里的前端产物目录就叫 **`index/`**（与站点静态根同名，直接覆盖即可）。

### 环境变量

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| `PORT` | `3000` | 后端监听端口 |
| `COCOC_HOST` | `0.0.0.0` | 监听地址，**生产建议 `127.0.0.1`** |
| `COCOC_DATA_DIR` | `backend/data` | 数据目录 |
| `COCOC_DB_FILE` | `<DATA_DIR>/database.json` | 数据文件路径 |
| `COCOC_TRUST_PROXY` | 开启 | 设为 `0` 则忽略反向代理传来的客户端 IP |
| `COCOC_ORIGIN_ALLOW` | 空 | 允许的跨域来源（逗号分隔），默认关闭 CORS |

### 备份与恢复

```bash
# 备份 = 拷一个文件
cp backend/data/database.json /path/to/backup/database-$(date +%F).json

# 恢复 = 覆盖回去再重启（每日快照在 backend/data/backups/，保留最近 14 份）
```

> `backend/data/` 含用户数据与审计日志，**不要**纳入版本控制或对外暴露。仓库的 `.gitignore` 已经拦住它。

---

---

## 八、测试与质量门禁


改完代码，这三条命令必须全绿：

```bash
npm run lint                                   # 0 error（12 条 warning 是 React Compiler 建议项）
node backend/tools/smoke-test.mjs              # 后端 159 项断言
npm run build                                  # 产物 dist/
node tools/ui-check.mjs http://localhost:4173  # 界面 54 项断言（需 Chrome + 已启动服务）
```

界面测试需要账号：`UI_USER=xxx UI_PASS=yyy node tools/ui-check.mjs …`

**当前状态**

| 项目 | 结果 |
| --- | --- |
| `npm run lint` | ✅ 0 error / 12 warning |
| 后端冒烟 | ✅ 159 / 159 |
| 界面冒烟（真实 Chrome，跑生产产物） | ✅ 54 / 54 |
| `npm run build` | ✅ JS 536 KB / gzip 149 KB；CSS 78 KB / gzip 12 KB |
| 打印版面 | ✅ 一页 A4 容纳 57 行技能表，无溢出 |

后端冒烟测试默认使用仓库内的**合成旧库夹具**（`backend/tools/fixtures/legacy-v1-database.json`，
一份 v1.0 形态、含明文口令与明文令牌的假库），因此「旧库迁移」这一段在没有真实历史数据的机器上也能照跑：

```bash
node backend/tools/smoke-test.mjs /path/to/real-database.json   # 也可以用真实旧库跑
```

---

---

## 九、演示数据与截图脚本


仓库自带两个工具，README 里的所有截图都由它们产出，可以随时复现：

```bash
# 1) 造一份虚构演示库（只在空库上工作，绝不会覆盖真实数据）
node tools/seed-demo.mjs .demo-data

# 2) 启动演示环境
COCOC_DATA_DIR=.demo-data npm --prefix backend start   # 127.0.0.1:3000
npm run build && npm run preview                       # 127.0.0.1:4173

# 3) 采集配图到 docs/images/
node tools/screenshots.mjs http://127.0.0.1:4173 http://127.0.0.1:3000 docs/images
```

演示库里的"剧情"是刻意安排的，覆盖了审卡中心的四种状态：

| 角色卡 | 职业 | 审核状态 | 规则判定 |
| --- | --- | --- | --- |
| 伊莱亚斯·凡·德·梅尔 | 记者 | `approved` | 全部通过 |
| 白鸦 | 私家侦探 | `pending` | ❌ 职业技能「侦查 90%」超过上限 80% |
| 周砚 | 医生 | `pending` | ⚠️ 背景故事仅填写 4 / 10 栏 |
| 林晚照 | 古董商 | `rejected` | ❌ 职业点投入了非本职技能（神秘学、侦查）+ KP 批复 |

---

---

## 十、开发约定与踩坑记录


### 加新功能的固定流程

```
1. 规则/公式      → 加进 shared/coc7e.js（前后端自动共享，不要散落在组件里）
2. 参考数据       → 改 tools/gen-coc7e-data.py 后重新生成，勿手改 coc7e-reference.js
3. 数据结构       → backend/lib/db.js 的 ensureShape/migrate 补默认值与迁移分支，SCHEMA_VERSION +1
4. 入参校验       → backend/lib/validate.js 加白名单解析函数
5. 接口           → backend/routes/*.js 挂路由（注意具体路径写在参数路径之前）+ audit()
6. 前端           → src/views 放页面级组件，src/components 放可复用面板，请求统一走 src/lib/api.js
7. 测试           → backend/tools/smoke-test.mjs 加断言；tools/ui-check.mjs 加断言
8. 文档           → 更新 README 与更新日志
```

### 项目内的既有约定

- 文案全中文；KP 相关用 `amber`，玩家用 `emerald`，暗底 `slate-950`；打印版面反转为白底黑字。
- 删除类操作必须想清楚级联关系（删模组会摘除角色卡经历关联、带团记录、已跑标记）。
- 任何"派生出来的东西"都不要落库——一律实时算，这样才能保证客户端伪造无效。
- 破坏性变更要在文档里标 ⚠️ 并写清迁移与运维待办。

### 踩过的坑（避免重蹈覆辙）

| 现象 | 根因 | 正确做法 |
| --- | --- | --- |
| 编辑器里属性/表单突然被清空 | `useEffect` 把每次渲染都会新建的函数放进了依赖数组，父组件一重渲染就重置表单 | 用 `useRef` 持有回调；依赖只放 `[characterId, guest]`；新建路径**绝不在 effect 里重置表单** |
| 批量审卡接口 404「角色卡不存在」 | `/admin/audit/:id` 注册在 `/admin/audit/batch` **之前**，`batch` 被当成 id | Express 按注册顺序匹配：**具体路径必须写在参数路径前面**（`/characters/meta` 同理） |
| 全量 PUT 报「自定义技能格式不正确」 | 解析函数在 `partial=false` 时收到 `undefined` 就抛错 | 解析函数对 `undefined` 返回**空值**，只在显式提交非法值时抛错 |
| 暗色站点弹出**白色下拉菜单** | `<datalist>` / `<select>` 的下拉由浏览器**原生渲染**，Tailwind 改不动 | ① `color-scheme: dark` + `option` 显式配色 + autofill 覆盖；② `<datalist>` 全部换成自绘的 `Combobox` |
| Tailwind v4 颜色断言失败 | v4 用 **oklch** 表示颜色，`getComputedStyle` 返回 `oklch(...)` 而非 `rgb(...)` | 测试里判断"不是透明、不是白色"，不要写死 rgb 值 |
| 界面测试中途登录态丢失 | 访客模式测试段清了 token 后没恢复 | 分段测试时在需要权限的段落**开头重新写入 token 并刷新页面** |
| 「改名不影响原令牌」断言偶发失败 | 登录会**轮换令牌**（单点登录语义） | 涉及令牌的断言要放在重新登录**之前**；改测试而不是改业务 |

---

---

## 十一、已知限制与路线图


| 优先级 | 事项 | 说明 |
| --- | --- | --- |
| 中 | 无前端路由 | 刷新回首页、无法分享"某张角色卡"的链接。建议引入路由或至少把 `view` 同步到 URL hash |
| 中 | 单文件 JSON 存储 | 已原子写 + 每日备份，但并发与容量有上限。数据量增长后建议迁 SQLite（保留现有表结构） |
| 中 | 角色卡导入导出 | 目前只有打印/PDF；没有 JSON 导出、没有 Excel 互转 |
| 中 | 密码策略只校验长度 | 6–128 位，不做强度强制（可按需在 `backend/lib/security.js` 收紧） |
| 低 | 多 KP 场景 | 当前 KP 可读写全部角色卡，可增加卡主授权与更细的权限矩阵 |
| 低 | `App.jsx` 仍有约 580 行 | 可把模组筛选/列表状态下沉为自定义 hook |
| 低 | 无 CI | 建议接 GitHub Actions：lint + smoke + ui-check |
| 低 | 模组封面只有一种风格 | 备选方案（星图 / 打字机卷宗 / 极简题铭）未实现；可按 `variant` 扩展 `ModuleCover.jsx` |
| 低 | 页面标题仍是历史遗留的 `coc模组列表` | 与站点名不一致，属于早期版本残留 |

---

---
