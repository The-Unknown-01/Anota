# 求真 · 深读

基于 Chrome Extension（Manifest V3）的 AI 深度阅读与信息溯源插件。

> 在你正在阅读的任何网页上，从一句话出发——**验证它、理解它，并发现你可能遗漏的观点。**
>
> **V2.9（检索算法闭环）**：检索/验证系统从「找相关网页」升级为证据闭环——
> 先定证据目标、兼容门控、递归溯源到源头、数值结构化抽取、结论数字与证据绑定；
> **V2.7** 起密钥只存于云端（Cloudflare Worker 透明代理），扩展分发包零密钥、可安全分发；
> **V2.8** 以「邀请码 + 短期 JWT」替代静态令牌——受邀用户自助开通，JWT 可过期/刷新/撤销。

```text
阅读网页 → 选中一句话 → 点击「深读」→ Side Panel 打开
                                      ├─ 求真：这句话靠谱吗？（证据定向+溯源+绑定）
                                      ├─ 求深：背后是什么？（原理与知识树）
                                      └─ 求异：还有别的看法吗？（真实不同观点）

阅读网页 → 点击右上角「求」悬浮球 → 全文声明扫描
                                      └─ 本文概览：发现每句有溯源价值的声明，Hover 即问

（代理分发版）面板右上角「登录」→ 输入邀请码 → 自动签发 JWT（24h，静默续期 30d）
```

纯静态扩展，零第三方依赖，无构建步骤。加载即用，详见 [INSTALL.md](INSTALL.md)。

## 产品原则

1. **不改造网页本身**：无操作时插件几乎不存在；打标仅包裹原文文字、不改变内容。
2. **用户主动触发**：只分析用户选中的那一句；悬浮球点击才做全文扫描，不做后台监听。
3. **不是聊天机器人**：结构化结果，围绕 Claim 展开。
4. **诚实溯源**：五态结论严格互斥（无需验证/未找到可靠来源/来源不支持/部分支持/支持）；求异只呈现真实来源的不同观点，找不到就明说，不编造。
5. **职责分离**：LLM 只负责理解信息（声明/来源），排序与结论由确定性引擎完成——拒绝"URL→LLM→可信度93"式的黑盒打分。
6. **证据绑定**：结论必须引用检索来源编号（E1~E5）；检索无来源时禁止凭训练知识输出"已核实"（自动硬降级）；歧义主体（匿名人物）不强行绑定身份。
7. **密钥不进前端（V2.7）**：第三方密钥只存 Cloudflare Worker Secrets；扩展包零密钥，仅持可撤销/轮换的访问凭证。
8. **受邀制门禁（V2.8）**：邀请码兑换短期 JWT（24h + 30d 静默续期）；身份门槛与数据凭证分离（知乎搜索 API 仍走应用级 Secret）。

## 核心能力

### 1. 选中即问（三 Tab 深读）

- **求真**：完整溯源管线——Evidence Targeting 确定目标 → 多引擎检索 → 读原文比对 → 五态结论 + 逐字引用证据（带来源编号）+ 带理由的来源列表
- **求深**：一句话背后的原理、概念与知识树
- **求异**：从真实来源挖掘不同立场（每条带 URL + 原文片段），不再由 AI 编造乐观派/谨慎派

### 2. 全文声明扫描（悬浮球）

- 右上角「求」悬浮球（84px，可拖动、记忆位置）
- 点击后对全文做一次本地结构化提取 + LLM 批量分析：
  - **信息对象识别**（11 类）：事实陈述/数据/研究报告/论文/政府文件/机构信息/媒体报道/人物事件/观点判断/修辞/普通正文
  - **验证价值过滤**：只有值得溯源的声明进入 Claim Index，修辞与情绪被过滤
  - 声明带上下文、来源需求（sourceRequirement）与网页定位偏移
- 分析完成后悬浮球变为 Ready：页面中声明句以**虚线下划线**呈现，Hover 出提示卡（徽章 + 原文 + 三问入口），点击直达深读

### 3. 本文概览态

- Ready 悬浮球再次点击 → Side Panel 打开「本文概览」：可验证声明统计（按对象类型分组）、逐条声明列表
- 点击任意声明 → 进入该声明的三 Tab 深读；「← 本文概览」返回
- 概览项点击同时**回定位网页**：滚动到该声明句并高亮闪烁

### 4. 信息溯源管线 V2.9（求真）

```text
Claim + Context
  ├─ 并行：Query Analyzer（策略） / Evidence Target（找什么·唯一决策源） / 页面抓取（文章页超链接）
  │    Evidence Targeting：显式来源提取（URL/DOI/arXiv/PMID）→ Claim 11 类
  │    → Evidence Target 9 类 → Search Strategy 6 类 → Entity 解析（歧义不强行绑定）
  │    temporalMode：历史事实/当前状态/近期/动态变化/截至某时/永恒成立 → 时间匹配打分
  ↓ buildPlan（听 Evidence Target）  双核普遍召回（Exa + Metaso，硬路由已取消）
  │    显式来源步最优先 → 双核步 → 官方域定向步；精确找原文收敛、广泛印证放开、溯源加媒体
  ↓ 检索 → URL 去重 → Registry 先验（gov.uk/ac.uk/go.jp/.int 后缀规则）→ Source Analysis
  │    身份三层：platform（托管平台）≠ publisher（发布账号）≠ claimedOrigin（自称原产者）
  ↓ Academic Exact-Source  DOI/arXiv/PMID/显式URL 直中 → TARGET_PAPER；语义相似只是 RELATED_PAPER
  ↓ Evidence Clusters      转载三级分级（duplicate/likely/possible）→ 同簇不冒充独立证据
  ↓ Scoring Engine         八维 + Target Compatibility 门控（eventFit：主体对事件错 → 打折沉底）
  │                        八维：authority/relevance/directness/entity/scope/temporal/
  │                              originality/evidence + 目标论文加分 + 转载惩罚
  ↓ Provenance 递归溯源    媒体 A → 路透社 → 警方 → 官网（深度≤3、防环、命中官方即停、预算封顶）
  │                        当前页自身也进候选池参与打分/验证
  ↓ 验证池 Top-6           类型多样性 + 同溯源簇只留 1 个代表
  ↓ Web Reader（访问元数据：finalUrl/canonicalUrl/404/登录墙/JS渲染/超时）
  │    → Evidence Extraction：正则抽取 35%/3.5万亿/37人/2026年（带单位+涨跌方向）
  ↓ Verify                 逐源判定 存在≠相关≠支持；404 后试 canonical/重搜可访问版本；
  │                        打不开不降权威分 → 五态结论 + 逐字引用（带 E 编号）
  ↓ Binding + Hard Check   6 项硬校验 + 结论数字↔证据数字绑定（结论说 35% 但证据无 → supported 降 partial）
  │                        动态数据结论强制「截至[来源时间/检索时间]」表述
  → 输出 evidenceTarget/binding/provenance/stats
```

- **证据定向**：搜索前先回答"找什么"——Evidence Target 是唯一决策源；显式来源（文章里给的 DOI/论文链接）永远最先直读
- **兼容门控**：打分前先判来源是否真的在谈目标事件——主体对但事件错 → 打折沉底，不硬删除（宁漏判不错杀）
- **时间语义**：「截至2026年8月30日，死亡21人」自动记参考时间；历史政策不当旧资料惩罚，动态数据结论必须带时间限定
- **权威 ≠ 一手 ≠ 直接回答**：八维独立计分——高权威媒体转载、答非所问的官方页、错年份的报告都会被对应维度拉低
- **打不开 ≠ 没证据**：404 后试 canonical、再「标题+发布者」重搜；访问失败不影响权威分（权威分读取前已算好）
- **诚实展示**：来源卡显示类型徽章、一手性、目标论文/相关论文、共享上游标记、whyText；绑定状态与硬校验结果在元信息行明示

## 隐私

> 我们不读你的网页，只读你主动问的那一句（或你主动点击扫描的那一篇）。

- 选中深读：仅把该句文本、页面标题与 URL 提交给分析服务；为提取超链接证据会读取当前文章页 HTML（与选中句同页，仅本地解析链接，不上传全文）
- 悬浮球全文扫描：只在**用户点击后**触发；识别结果本地/会话级保存，不批量外发
- 不采集浏览历史、不后台监听、不上报整页内容
- 请求均经 Service Worker 中转（密钥不出前端）；来源分析与会话缓存在本地进行

## 权限说明

| 权限 | 用途 |
|---|---|
| `storage` | 会话级保存 Active Selection 与悬浮球位置（`chrome.storage.session`） |
| `sidePanel` | 打开深读侧栏 |
| `tabs` | 概览项点击时定位回当前标签页 |
| `<all_urls>`（host_permissions） | Web Reader 读取来源原文页面与当前文章页超链接 |
| `<all_urls>`（content_scripts） | 让「深读」按钮/悬浮球在任意网页可用 |

## 数据源（可插拔，密钥在云端）

| 数据源 | 角色 | 凭证位置 |
|---|---|---|
| DeepSeek（LLM） | 三 Tab 分析、Claim 识别、Query 策略、Evidence Target 分类、来源理解、证据判定 | Worker Secret（PROXY）/ `deepseek_api.key`（DIRECT 开发） |
| Exa | 语义召回引擎（所有问题类型的双核之一） | Worker Secret / `exa_api.key` |
| metaso | 广泛召回引擎（双核之一；上游追踪定向搜索） | Worker Secret / `metaso_api.key`（端点可经 `metaso_endpoint.txt` 覆盖） |
| 知乎开放平台 | 站内讨论通道（低配额补充） | Worker Secret / `zhihu_api.key` |

- **代理模式（分发版，V2.7）**：存在 `proxy_base.txt` → gen-config 产出零密钥配置（仅代理地址 + 访问令牌/登录 JWT）；第三方密钥全部在 Cloudflare Worker Secrets
- **直连模式（开发版）**：无 `proxy_base.txt` → gen-config 读取项目根 `*_api.key`；DeepSeek 必需，检索源可选，缺席引擎自动降级（知乎通道兜底或纯模型知识分析），UI 明示
- **登录门禁（V2.8）**：代理模式下面板右上角输入邀请码 → `/auth/redeem` 签发 JWT（24h）→ 过期静默 `/auth/refresh`（30d）；未登录回落静态令牌（v2.7 行为）

## 目录结构

```
project_hackathon/
├── manifest.json            # MV3 manifest（位于扩展根 = 仓库根，Chrome 要求）
├── src/core/
│   ├── content-script/      # 页面注入：extractor(结构化提取) / orb(悬浮球) / hover(打标+提示卡) / content(选区+深读按钮)
│   ├── background/          # Service Worker：消息路由、Active Selection 持久化、Side Panel 控制、AUTH 消息
│   ├── auth/                # ★V2.8 登录门禁：invite-jwt.js（邀请码兑换/JWT 存取/静默刷新）
|   ├── ai/                  # 分析链路：
│   │                        #   analyzer(三模式+证据绑定+数字绑定) / claim-detector(v2 对象识别)
│   │                        #   evidence-target(唯一「找什么证据」决策源) ★V2.6
│   │                        #   evidence-extractor(正则数值/页面元数据抽取) ★V2.9
│   │                        #   academic(论文精确验证:DOI/arXiv/PMID/显式URL) ★V2.6
│   │                        #   provenance(递归溯源到源头/官方域定向) ★V2.6/V2.9
│   │                        #   query-analyzer(策略+temporalMode+跨语言Query) / url-utils(URL规范化去重)
│   │                        #   source-registry(可信先验+gov.uk/ac.uk/.int 后缀) ★V2.9
│   │                        #   source-analyzer(platform/publisher/claimedOrigin 身份三层) ★V2.9
│   │                        #   evidence-graph(转载三级分级聚簇) / scoring-engine(八维+eventFit 门控) ★V2.9
│   │                        #   v25-pipeline(溯源编排+当前页候选) / web-reader(访问元数据+超链接) ★V2.9
│   │                        #   verify-engine(五态验证+URL 失效恢复+数值注入判定) ★V2.9
│   │                        #   search-controller(V2.0选源,兼容路径) / datasource(多引擎可插拔)
│   └── utils/               # 消息类型常量
├── src/sidepanel/           # 深读工作台（三 Tab + 本文概览态 + V2.6 绑定/溯源展示 + V2.8 登录区）
├── .e2e/                    # 浏览器端到端脚手架（开发用）
├── scripts/
│   ├── gen-config.js        # 凭证 → generated-config.js 生成器（PROXY/DIRECT 双模式）
│   └── smoke-search-advise.js  # V2.6 回归冒烟：15 组 45 项断言（node 直接运行）
├── qiuzhen-proxy/           # ★V2.7/★V2.8 CF Worker 代理（独立目录，非扩展包）：
│   │                        #   worker.js（透明代理 + /auth/redeem + /auth/refresh + JWT 鉴权 + sub 限流）
│   │                        #   wrangler.toml / DEPLOY.md（Secrets 清单与上线步骤）
├── .env/                    # 本地敏感/环境文件（gitignored）：metaso_endpoint.txt 覆盖文件等
├── docs/                    # 升级要求与分支说明：v1.5~v2.7_UPGRADE.md / branch_evolution_guide.md / INSTALL.md
├── search_system_P0_P1_modification_spec.md        # ★V2.9 spec：P0-P1 决策权统一（已入库）
├── search_system_post_P0_P1_next_stage.md          # ★V2.9 spec：可访问性/身份/溯源/绑定（已入库）
└── WORKPLAN.md              # 迭代计划与交付记录（git tag 对应各里程碑）
```

## 消息流（简化）

```text
[Web Page]
  选区 → content.js ──CAPTURE_SELECTION──▶ background ──storage.session──▶ side panel
  悬浮球点击 → orb.js ──DETECT_CLAIMS────▶ background ──LLM+缓存───────▶ Ready
  声明句 Hover → hover.js 提示卡 ──点击──▶ CAPTURE_SELECTION（复用深读链路）
  概览项点击 → panel.js ──QIUZHEN_LOCATE_CLAIM──▶ hover.js 滚动+高亮
  求真 Tab → panel.js ──ANALYZE(truth)───▶ analyzer ──verifyClaimV25──▶
        Evidence Target(显式来源/目标/策略) ＋ Query Analyzer(策略) ＋ 页面抓取(并行)
        → buildPlan(显式步→双核→官方域定向) → URL去重 → Registry → 来源分析
        → Academic验证 → 证据聚簇 → 八维评分 → Provenance追踪 → 多样性验证池
        → Web Reader → verify-engine ──▶ 五态结论 + Binding硬校验 + 排序来源
  求异 Tab → panel.js ──DISCOVER_DIFFER─▶ background ──真实对立观点(URL+引用)
```

## 版本历史

| 版本 | 里程碑（git tag） | 内容 |
|---|---|---|
| v1.0 | `m0`~`m4` | 选区捕获 + Side Panel 三 Tab 深读 |
| v1.5 | `u0`~`u4`, `v1.5` | 悬浮球全文扫描、Claim 识别定位、Hover 交互、本文概览 |
| v1.6 | `v1.6` | 交互细节：hover 延迟隐藏+淡入淡出、悬浮球 84px 右上角 |
| v2.0 | `v2.0`（含 hover 修复 `47a6ef9`） | 信息溯源系统：对象识别、智能选源、读原文比对、五态结论、求异真实来源化 |
| v2.5 | `v2.5`（含枚举混用修复 `86f37bf`） | 来源评价系统：Query Analyzer、metaso/Exa 双引擎、Trusted Source Registry、来源分析与一手性识别、证据独立性、六维评分排序 |
| v2.6 | `v2.6`（合并 PR #2，`b578762`） | 证据定向与溯源：Evidence Targeting 前置层、双核普遍召回（取消硬路由）、八维评分、Academic Exact-Source（TARGET_PAPER/RELATED_PAPER）、Provenance Tracing 共同上游检测、Evidence Binding 六项硬校验、知乎超链接论文引用修复 |
| v2.7 | `v2.7`（人工改造 `55613f0`+`b49a72b`） | 安全代理：CF Workers 透明代理（qiuzhen-proxy/）、gen-config 双模式（PROXY 零密钥/DIRECT）、7 模块三件套适配、可安全分发 |
| v2.8 | `v2.8` | 登录门禁：邀请码 + JWT（/auth/redeem + /auth/refresh）、JWT 鉴权（静态表 fallback）、扩展登录 UI（storage.local 持久化 + 静默刷新）、sub 限流 |
| v2.9 | algorizm_fix 分支（未打 tag，HEAD=`32565e8`） | 检索算法闭环：Evidence Target 唯一决策源 + eventFit 兼容门控、temporalMode 时间语义、URL 可访问性元数据、数值结构化抽取（evidence-extractor）、递归溯源（深度≤3+官方域定向）、platform/publisher/claimedOrigin 身份三层、当前页进候选池、动态事实「截至」参考时间、结论数字↔证据数字绑定 |

## 开发

- 无构建、无依赖；改代码后在 `chrome://extensions` 点扩展刷新 + 刷新测试页即可
- 回归冒烟：`node scripts/smoke-search-advise.js`（15 组 45 项断言，覆盖实体识别/跨语言/八维排序/转载分级/论文验证/溯源追踪/绑定硬校验）
- 浏览器端到端脚手架见 `.e2e/`；各里程碑行为级验证用 `hermes-verify-*` 脚本（Temp 目录，可复跑）
- 里程碑规划与决策记录见 `WORKPLAN.md`
