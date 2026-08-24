# AGENTS.md — 给 AI 编码代理的项目上下文

给接手本项目的 AI 代理（Claude Code / Codex / ZCode 等）的冷启动说明。人类向文档见 [README](./README.md) 与 [项目说明](./项目说明.md)（更全）；本文件只讲**必须知道的事实、命令和红线**。

## 项目是什么

本地 Web 应用：微信读书官方 Agent 网关 → 幂等同步为 **Obsidian 原生 Markdown** → Express + React 的书架/笔记/编辑/AI 工作台。单用户、无数据库、`.md` 文件是唯一数据源。Node.js ≥ 20，零框架（后端原生 fetch + Express，前端 Vite+React+TS）。

## 常用命令

```bash
npm test                # 50 个单元测试（node --test）——任何改动后必须全过
npm start               # 启动（需先构建前端）；端口 5175
npm run build           # 构建 web/dist（生产托管 dist，前端改动必须重建才生效）
npm run dev / dev:web   # 开发热重载
npm run sync            # CLI 全量同步；--dry-run 预览；--book 书名 单本
npm run package         # 打免构建发布 zip
```

真实网关调用需要环境变量 `WEREAD_API_KEY`（`wrk-` 开头）。**key 永远不进代码、日志、git。**

## 架构速览（server/）

| 模块 | 职责 | 关键点 |
|---|---|---|
| config.js | 配置加载/保存 | 相对 vaultRoot 按项目根解析；saveConfig 原子写+缓存重置；key 优先级 env > config.apiKey > ~/.bashrc |
| weread.js | 网关客户端 | 所有分页/容错踩坑适配都在这 |
| naming.js | 命名/归一化 | quoteKey=去空白取前80字，跨接口匹配的唯一正道 |
| merger.js | 解析旧笔记提取用户批注 | 内容保全的锚点 |
| template.js | 笔记渲染 | 确定性排序、全局去重、隐藏清单过滤；**改它必须验证幂等** |
| sync.js | 同步编排 | bookId 锚点、字节级比较、原子写（tmp+rename） |
| notes.js | 书架/结构化解析 | callout 分类只看首行 |
| writer.js | 块级编辑引擎 | 每操作重读磁盘+内容锚点重定位，锚点丢失报 409 不盲写 |
| agent.js | AI Adapter（claude/codex） | prompt 走 stdin；上下文=书/章/条目±1 |
| chats.js | AI 对话持久化 | 按 bookId+itemKey 存 .cache/chats/，成功才追加 |
| import.js | 旧笔记导入 | 只读旧文件；划线式/随笔式两模式 |
| stats.js | 热力图 | 逐月拉 /readdata/detail 合并；UTC+8 |
| social.js | 同段共鸣 | 文本指纹匹配热门划线；公众内容只展示不落盘 |
| setup.js | 首次向导/设置 | key 测试连接、库路径检测、claude 检测降级 |

## 铁律（违反 = 破坏用户数据）

1. **只读写** `{vault}/微信读书笔记/`（含 attachments）；库内其它文件一概不碰；导入旧笔记对源文件只读
2. `.md` 必须是 Obsidian 原生语法：不埋 HTML 注释标记、不整文件重排版、callout 用 `> [!type]`
3. 同步幂等：渲染前显式排序（API 返回顺序不稳定），写盘前字节级比较，不变不写
4. 用户内容（💭思考 / AI callout / 引入的读者共鸣 / 导入内容）重同步**永不丢失**——merger 按 quoteKey 提取回放，有专门测试守着
5. 公众内容（同段共鸣的热门划线/他人想法）只在 UI 展示，**绝不自动写入 .md**；唯一落盘路径是用户显式点「引入」
6. 不进 git：`config.json`、`.cache/`、`node_modules/`、`web/dist/`（.gitignore 已配）
7. 时间戳→日期一律按 **UTC+8**（stats.tsToUTC8Date）

## weread 网关契约（实测硬知识，官方文档有误处）

- `POST https://i.weread.qq.com/api/agent/gateway`，`Authorization: Bearer <key>`，**业务参数平铺 body 顶层** + `skill_version`；包在 `params` 里后端收不到
- `/user/notebooks`：`count`+`lastSort` 游标分页；禁 offset/limit
- `/review/list/mine`：参数名是**小写** `bookid`；`hasMore` 不可靠（=0 可能还有）→ `count:50` 单页拉全 + reviewId 去重
- `markedStatus==4` 才是读完（官方文档写 1 是错的）
- **range 跨接口漂移**（同一段在不同接口 range 值不同）→ 一切匹配走 quoteKey 文本指纹；±2 容差仅限想法挂划线场景
- `/readdata/detail`：monthly=日桶 / annually=月桶 / overall=年桶，逐日明细只有 monthly；`readTimes` 的 key 是当天**任意**时间戳
- `/book/readreviews` 的 chapterUid 参数宽松（传错也能跨章返回），但按章分组调用最稳；`CB_` 开头的 bookId 无热门划线数据属正常，需静默降级

## Windows/本环境注意

- Git Bash 的 curl 发中文 JSON 是 GBK 编码 → **测 API 一律写 node 脚本用 fetch**
- node 看不见 Git Bash 的 `/tmp` → 临时文件用 Windows 路径
- 嵌入式浏览器不弹 `window.confirm`、Enter 键可能不触发 → UI 交互确认用两步按钮 + 显式提交按钮；自动化测试用坐标点击兜底

## 改动守则

- 改 `template.js`：连跑两次同步确认幂等（第二次应「无变化」）+ `npm test`
- 改前端：`npm run build` 后浏览器实测（端口 5175 起着）
- 任何写 .md 的新路径：走 writer.js 的锚点模式，禁止盲写；新增测试进 `test/*.test.js`（每文件独立进程，用 `WEREAD_VAULT_ROOT` / `WEREAD_CONFIG` / `WEREAD_CHATS_DIR` 环境变量做沙盒，勿碰真实库）
- UI 新功能默认中文文案；确认类交互用内联两步按钮

## 数据流（一图）

```
weread 网关 ──► weread.js ──► sync.js ──► {vault}/微信读书笔记/*.md ◄── writer.js（编辑）
                                  │                ▲                    ▲
                                  │                └── merger.js（用户批注回放保全）
                                  ▼
浏览器(React) ◄── index.js(Express) ── agent.js+chats.js（AI） · social.js（共鸣，只读UI）
```
