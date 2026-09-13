# 秘密调查档案馆 · 服务器更新包

> 这个包里**只有代码和前端产物**，没有任何用户数据。
> 更新脚本会先备份服务器上的历史数据，再覆盖代码，最后复核数据文件与更新前是否一致。

---

## 一、这个包里有什么

```
coc-archive-update-<版本>-<日期>/
├── index/     ← 前端静态产物（目录名与站点静态根一致，直接覆盖 index/）
├── backend/   ← 后端源码（server.js / lib / routes / tools / package*.json）
├── shared/    ← COC 7e 规则引擎（后端运行时需要）
└── deploy/    ← 本说明、一键更新脚本 apply-update.sh、Nginx 配置样例
```

> 更新包**只发布 zip**，且只有上面这四个目录。

**不含**：`backend/data/`（历史数据）、`backend/node_modules/`（依赖）、任何审计日志。
包生成时脚本会显式检查这一点，发现数据文件会直接报错终止。

---

## 本包改动（v1.7.5，简版）

- 教育成长记录 + 结算后锁定（重掷需 KP 授权）、传奇标记、年龄豁免、角色卡备注。
- 角色卡编码导入导出、骰娘导入指令（同官方 Excel 格式）。
- 审卡混点规则严格化；打印版面每项技能固定一行。
- 更新包只发 zip，包内只有 `index/ backend/ deploy/ shared/` 四个目录。

--- | --- |
| 数据结构 | 自动从 v4 升到 **v5**：给老角色卡补一个 `ageAlloc`（年龄补正分配）字段，其它字段不动；空分配 = 按规则默认平均分配结算 |
| ⚠️ 数据影响 | **年龄 40 岁及以上、且开着「自动套用年龄补正」的老角色卡，有效属性会按规则书重新计算** —— 旧版把「力量/体质/敏捷合计减 N 点」错算成了「三项各减 N 点」，60/70/80 岁档的外貌也多扣了 5/20/55 点。这是修 bug 的预期结果，不需要手工改卡；有疑问就打开那张卡看「属性明细与年龄补正」里的分配面板 |
| 前端 | 编辑器新增「年龄补正分配」面板（可平均分配/清零）；年龄可以正常键盘输入；战斗栏武器可以连续输入、可用中文输入法；「任选 N 项特长」带搜索框；职业卡显示官方本职技能原文与指定专攻方向（如 牧师 → 拉丁语） |
| 更新后自检 | 打开一张 40+ 的角色卡 → 看「属性明细与年龄补正」；进 KP 审卡中心 → 规则页会多一条「核对职业的官方指定专攻方向」 |
| 🐞 v1.6.1 修复 | **「编辑角色卡保存后关联模组消失」**：编辑器全量保存时不再清空「模组经历」（只有显式提交空列表才清空） |
| 🛠 找回已丢的关联 | 如果之前已经丢过关联：**先停掉后端服务**，然后 `node backend/tools/restore-module-links.mjs`（预演，不改数据）→ 确认后加 `--apply`。它从 `backend/data/backups/database-<日期>.json` 里把丢失的关联补回去，写入前会自动再留一份快照；服务还在跑时脚本会拒绝执行 |

---

## 二、更新前请确认

| 项目 | 要求 |
| --- | --- |
| Node.js | ≥ 20（脚本会检查） |
| 后端目录 | 放着 `backend/server.js` 的那个目录（自己定，例如 `/srv/coc-archive`） |
| 前端目录 | 站点静态根（自己定，例如 `/srv/www/coc`） |
| 服务 | systemd 单元名为 `coc-archive`；若不是，用 `--service` 指定 |
| 磁盘 | 至少留出「当前数据大小 × 2」的备份空间 |

先看一眼要更新的目标对不对（不会做任何改动）：

```bash
unzip coc-archive-update-*.zip
cd coc-archive-update-*
sudo bash deploy/apply-update.sh --web <站点根> --app <后端目录> --dry-run
```

---

## 三、正式更新

```bash
sudo bash deploy/apply-update.sh \
  --web <站点根> \
  --app <后端目录> \
  --service coc-archive \
  --user www-data
```

`--web` / `--app` 换成你自己的目录即可；用 systemd 时再用 `--service <服务名>` 指定单元名。

### 脚本的九个步骤

| # | 动作 | 说明 |
| --- | --- | --- |
| 1 | 预检 | 确认包完整、Node ≥ 20、目标目录可写；打印一份"将要做什么"让人确认 |
| 2 | 记录校验和 | 记下 `database.json` 的 sha256 与各集合条数 |
| 3 | **备份** | 数据 → `$APP/.backups/data-<时间戳>`；旧代码 → `$APP/.backups/code-<时间戳>` |
| 4 | 停服务 | 优先 `systemctl stop`，没有 systemd 就按进程名结束 |
| 5 | 覆盖前端 | `rsync -a --delete index/ → 站点根`，清掉上一版遗留的 hash 文件（兼容旧包的 dist/） |
| 6 | 覆盖后端 | `rsync -a --delete`，显式 `--exclude backend/data/` —— **历史数据一个字节都不动** |
| 7 | 装依赖 | `npm ci --omit=dev` |
| 8 | 起服务 + 健康检查 | 轮询 `http://127.0.0.1:3000/api/health`，最多等 20 秒 |
| 9 | 复核数据 | 再算一次 sha256 与条数，和步骤 2 比对并打印结论 |

> 步骤 9 里如果校验和变了，脚本会明确提示——正常情况下只有后端在启动时做了 schema 迁移才会变，
> 此时会打印更新前后的集合条数，方便你确认"人没少、卡没少"。

---

## 四、回滚

代码和数据都有备份，回滚是两条 `cp`：

```bash
APP=<后端目录>
STAMP=<脚本输出里的时间戳>

# 回滚代码
sudo cp -r $APP/.backups/code-$STAMP/. $APP/backend/
# 回滚数据（只在数据真的出问题时才做）
sudo cp $APP/.backups/data-$STAMP/database.json $APP/backend/data/database.json
sudo systemctl restart coc-archive
```

---

## 五、更新后建议做的事

```bash
curl -s http://127.0.0.1:3000/api/health          # 应为 {"ok":true,...}
sudo nginx -t && sudo systemctl reload nginx      # 若动过 Nginx 配置
```

浏览器打开站点后用 KP 账号登录，确认：

- [ ] 模组数量、账号数量与更新前一致
- [ ] 打开任意一张角色卡，派生值（HP / 理智 / 移动力）正常显示
- [ ] 首页能加载出模组卡片（说明前端产物已替换成功）

> **用户端缓存提示**：`/assets/*` 文件名带内容哈希，可以放心长缓存；
> `index.html` 必须是 `no-store`。若用户看到的是旧页面，先确认 Nginx 的 `location = /index.html` 配置还在。

---

## 六、常见问题

**Q：脚本报「未找到 rsync」？**
会退化成整目录覆盖。建议先 `apt install rsync`，因为 `rsync --delete` 才能真正清掉上一版的旧产物。

**Q：我用的是 pm2 / supervisor，不是 systemd？**
加 `--service` 指到你的单元名；若脚本没检测到 systemd 单元，它会按进程名结束旧进程，
然后用 `nohup` 起一个——这时建议你事后改回自己的进程管理器接管。

**Q：换了服务器，数据怎么搬？**
数据就是一个文件：把老机器的 `backend/data/`（含 `backups/`）整个拷到新机器的同一位置即可。

**Q：后端启动后用户被登出了？**
不会。令牌是存在数据文件里的摘要，与代码版本无关。只有用户自己改密码才会吊销会话。

---

## 七、这个版本包含什么

参见仓库根目录的 `README.md` 与 `更新日志.md`。当前版本：**v1.5**
（在原有功能之上新增了「修改用户名」与模组封面「档案封印」装饰层）。
