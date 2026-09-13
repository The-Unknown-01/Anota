# 「求真」交付工作计划（WORKPLAN）

> 项目：知乎黑客松 2026「求真 · 深读」Chrome Extension（MV3）。
> 本文件是全部版本的**计划与交付总账**：每个版本一节（计划 → 决策点 → 执行记录），按时间正序排列。
> 版本升级要求的原文见 `docs/` 下 `v1.5_UPGRADE.md` ~ `v2.7_UPGRADE.md`；V2.9 依据
> `docs/branch_evolution_guide.md` 与仓库根两份 spec（`search_system_P0_P1_modification_spec.md`、
> `search_system_post_P0_P1_next_stage.md`）。
> 回退锚点：git tag 与里程碑一一对应（m0~m4 / u0~u4 / v1.5 / v1.6 / v2.0 / v2.5 / v2.6 / v2.7 / v2.8）；
> algorizm_fix 分支（V2.9）尚未打 tag（HEAD=32565e8）；V3.0 自 `v3.0-start` 起执行。

---

## 目录

- [V1 · 交付记录（M0-M4）](#v1--交付记录)
- [V1.5 · 全文声明扫描（计划 + 交付记录）](#v15--全文声明扫描)
- [知乎接入与全网搜索修复（插记录）](#知乎接入与全网搜索修复)
- [V2.0 · 信息溯源系统（计划 + 交付记录）](#v20--信息溯源系统)
- [V2.5 · 来源评价系统（计划 + 交付记录）](#v25--来源评价系统)
- [V2.6 · 证据定向与溯源追踪（交付记录）](#v26--证据定向与溯源追踪)
- [V2.7 · 安全代理（交付记录）](#v27--安全代理)
- [V2.8 · 登录门禁（升级计划 + 执行记录）](#v28--登录门禁邀请码--jwt)
- [V2.9 · 检索算法闭环（algorizm_fix 分支）](#v29--检索算法闭环algorizm_fix-分支)
- [V3.0 · 可视化动态交互（规划 + 执行记录）](#v30--可视化动态交互规划--执行记录)
- [V3.1 · 知乎官方 OAuth 登录迁移（升级计划 · 执行中）](#v31--知乎官方-oauth-登录迁移升级计划--执行中)
- [已知环境问题](#已知环境问题)
- [遗留事项](#遗留事项)

---

# V1 · 交付记录

> 依据 `D:\Project\知乎黑客松2026\PRD` 全部 10 份文档。2026-08-25 批准并执行完毕。

## 决策记录

| 决策点 | 结论 |
|---|---|
| D1 整页静默采集模块处置 | 方案 A：删除，仓库彻底转向「用户主动选一句」（git 历史可找回） |
| D2 后端形态 | **方案 B：SW 直连**（无独立后端；Key 放 gitignored 本地配置） |
| D3 权限模型 | 方案 A：保留 `<all_urls>` content script，主动触发原则即隐私答案 |
| D4 AI 能力 | 方案 A：DeepSeek 承担三模式分析；知乎直答仅在需要时作证据源 |

## 交付内容（全部 ✅）

| 里程碑 | tag | 内容 | 验证 |
|---|---|---|---|
| M0 选区捕获重构 | `m0-selection-sidepanel` | 选区≥2字符→「深读」按钮；CAPTURE_SELECTION→storage.session→Side Panel | E2E PASS |
| M1 AI 分析链路 | `m1-ai-analyzer` | ANALYZE 三模式（truth/deep/differ）+ DeepSeek 结构化输出 + 内存缓存 | 真实 API PASS |
| M2 三 Tab 工作台 | `m2-workbench` | 求真（徽章+证据卡+原文↔来源对照）/求深（原理+知识树）/求异（立场卡）；Liquid Glass 视觉 + 深色模式 | 人工+自动 |
| M3 知乎开放能力 | `m3-zhihu-pluggable` | datasource 可插拔设计；无凭证降级明示（凭证 08-26 到位即启用，零代码改动） | 降级态 PASS |
| M4 打磨验收 | `m4-acceptance` | PRD 全流程自测 6/6；seq 丢弃过期响应；Error 态映射 | 6/6 PASS |
| M5 加分项 | — | 声明分类路由 / 知识树继续探索 / 免责说明展示 | — |

---

# V1.5 · 全文声明扫描

> 依据 `v1.5_UPGRADE.md`。核心变化：**从"用户指定 Claim"升级为"系统主动发现 Claim"**。
> 原则：保留「选中一句 → 深读 → 三 Tab」闭环不推翻，新增全文理解→声明识别→声明级交互。
> 2026-08-25 批准（VD1-VD3 按建议），已全部交付。

## 计划要点

| 维度 | V1（已有） | V1.5（新增） |
|---|---|---|
| Claim 来源 | 用户选中一句 | 系统全文分析主动发现 + 用户选中（并存） |
| 触发方式 | 选区「深读」按钮 | 新增「求真」悬浮球（Idle→Analyzing→Ready） |
| AI 调用时机 | 查看即分析 | 全文阶段只做发现+分类+定位；查看某 Claim 时才走三模式链路 |
| Side Panel | 三 Tab | 新增「本文概览」态 → 点击 Claim 进入现有三 Tab |

技术判断：analyzer 三模式、缓存、datasource、面板状态机全部复用；新增正文提取→结构化→Claim 识别→Claim Index→Hover 交互的独立管线；红线：全文阶段不验证任何 Claim、不调搜索。

## 决策记录

| 决策点 | 结论 |
|---|---|
| VD1 LLM 用量与截断 | 正文截断前 ~120 句 + 单次调用 |
| VD2 Hover 高亮视觉 | 虚线下划线 + Hover 浅色底（不做色块） |
| VD3 概览入口优先级 | 有 Claim Index 时默认概览态 |

## 交付内容（全部 ✅，tags u0~u4、v1.5）

| 里程碑 | tag | 内容 | 验证 |
|---|---|---|---|
| U0 正文提取结构化 | `u0-extractor` | extractor.js：章节/段落/句子+offset，nav/footer 过滤 | 7/7 |
| U1 Claim Detection | `u1-claim-detector` | claim-detector.js：三分类+类型子类，storage.session 缓存（秒回 329ms） | 双层 PASS |
| U2 悬浮球状态机 | `u2-orb` | orb.js：Idle→Analyzing→Ready/Error，点击才读正文 | — |
| U3 Hover 声明交互 | `u3-hover` | hover.js：打标+Shadow DOM 提示卡+复用 CAPTURE_SELECTION | 5/5 |
| U4 本文概览态 | `u4-overview` | panel.js：声明/观点统计+列表+已核实徽章+返回入口 | 7/7 |
| U5 回归验收 | `v1.5` | V1 全链路 8 项 + V1.5 链路 5 项 = 13/13 PASS；文档更新 | 13/13 |

---

# 知乎接入与全网搜索修复

## 知乎接入 · 凭证到位正式启用（2026-08-26）✅

- `zhihu_api.key`（40 chars）配置并生成 generated-config；gen-config 兼容新文件名
- Node 层真实 API 冒烟 7/7：鉴权通过、归一化完整、坏凭证 20001 正确拒绝
- SW 运行时 E2E 4/4：求真「已核验」徽章 + 来源链接；datasource 零改动（M3 可插拔设计直接生效）

## 全网搜索接入修复（2026-08-26 用户反馈）✅

- 诊断：global_search 接口层本已接通，但 ContentType 只是内容形态枚举（全网结果也是 Answer），
  UI 按 ContentType 标注导致全网条目全部被误标「知乎回答」
- 修复：datasource 归一化加 `origin` 字段（zhihu/global）；panel 来源卡按 origin 标注与分组计数
- 验证：mock 12/12 + 真实 E2E 7/7（「知乎站内 5 · 全网 5」）；期间遭遇 30001 限流窗口（用户换 key 后恢复）

---

# V2.0 · 信息溯源系统

> 依据 `v2.0_UPGRADE.md`。核心变化：**从「AI 判断真假」升级为「信息对象识别 → 信源发现 → 证据验证」的溯源系统**。
> 产品定位：不是"AI 帮你判断真假"，而是"AI 帮你从信息中找到可追溯的证据"。
> 2026-08-26 批准（TD1-TD4 按建议；TD5=悬浮球保持 84px 下移一点），已全部交付。

## 计划要点

| 维度 | V1.6（已有） | V2.0（新增） |
|---|---|---|
| 分析起点 | 主观/客观二分 | 信息对象识别（11 类）决定处理方式 |
| Claim | 单句孤立判断 | 句子+上下文联合判断；数据模型加 context/objectType/sourceRequirement |
| 搜索 | query 直接丢给 searchBoth | Search Controller：来源类型→关键词→白名单→优先级 |
| 验证 | AI 单次生成 | Web Reader 读原文 → 逐源判定；存在≠相关≠支持 |
| 结论 | 模糊分级 | **五态严格互斥**；求异禁止编造立场 |

架构判断：extractor/datasource/三 Tab/Hover/缓存全部复用；新增 claim-detector v2、search-controller、web-reader、验证引擎四块；求真从"一次生成"变为"检索→排序→读原文→逐源判定"多步管线。

## 决策记录

| 决策点 | 结论 |
|---|---|
| TD1 正文抽取 | 自研轻量抽取（零依赖） |
| TD2 来源分类 | 域名规则优先 + LLM 兜底 |
| TD3 白名单形态 | 内置默认四级表，不做设置 UI |
| TD4 扫描是否自动溯源 | 扫描=发现+分类+定位，溯源由点击触发 |
| TD5 悬浮球尺寸 | 保持 84px，位置下移一点 |

## 交付内容（全部 ✅，tag v2.0 含 hover 修复 47a6ef9）

| 里程碑 | 提交 | 内容 | 验证 |
|---|---|---|---|
| N0 Claim Detection v2 | `1847d8f` | 11 类对象识别+验证价值过滤+上下文 Claim | 10/10 |
| N1 Search Controller | `fd894ed` | Source Type 分类器+四级白名单+评分排序 | 12/12 |
| N2 Web Reader | `6375242` | 原文抓取+轻量正文抽取+失败降级 | 9/9 |
| N3 验证引擎 | `8da0d29` | 逐源判定（存在≠相关≠支持）+五态结论 | 8/8 |
| N4 求异真实来源化 | `4061860` | 挖掘真实对立观点（逐字引用+URL），禁止编造 | 6/6 |
| N5 双模式分离 | `da7f19c` | differ 注入真实对立观点 | 4/4 |
| N6 UI 改造 | `7e79259` | 悬浮球拖动/位置记忆/下移 + Claim 定位回网页 | 注入链模拟通过 |
| N7 回归验收 | `75b46e2` | 回归+文档+tag v2.0 | §13 全对照 |
| 修复 hover 失效 | `47a6ef9` | **wrapClaim 的 var span 声明被 N6 patch 误删** → 首条 Claim 抛 ReferenceError 中断全部打标；恢复声明 + activate 单条 try/catch 防御 | 行为级 6/6+7/7 |

> 教训：patch 后必须跑**行为级**验证（激活打标循环），只测文件加载会漏掉此类回归。
> 执行记录时期的 ad-hoc 验证脚本在 Temp `hermes-verify-n0/n6/hoverfix/hover-span-fix`，可复跑。

---

# V2.5 · 来源评价系统

> 依据 `v2.5_UPGRADE.md`。核心目标：**从"找到可靠来源"升级为"系统地发现、识别、比较可靠来源"**——
> 不仅告诉用户"找到了什么"，还告诉用户"为什么这个来源值得相信，以及它是不是原始证据"。
> 2026-08-27 批准（TQ1-TQ5 全部按建议），已全部交付。

## 计划要点

| 维度 | V2.0（已有） | V2.5（新增） |
|---|---|---|
| 搜索入口 | search-controller 直接生成关键词 | **Query Analyzer** 判问题类型→定策略（关键词/来源类型/时间窗/预算/单双引擎） |
| 引擎 | 知乎双通道 | 知乎 + **metaso（广泛召回）+ Exa（语义召回）**，按预算选择性调用 |
| 结果处理 | origin 标注直接进列表 | **URL 规范化+去重管道** |
| 来源评价 | 四级白名单 + 单一 authority 分 | **Trusted Source Registry** 三层先验 + 多维分离评分 |
| 职责边界 | 白名单+线性公式 | **LLM 只负责理解来源；Scoring Engine 负责稳定排序** |
| 证据独立性 | 每条 URL 都算独立证据 | 识别转载关系，重复转载不冒充独立证据 |

新增模块：query-analyzer / url-utils / source-registry / source-analyzer / evidence-graph。

## 决策记录

| 决策点 | 结论 |
|---|---|
| TQ1 Query Analyzer 实现 | 一次轻量 LLM 调用输出策略 JSON + 规则兜底 |
| TQ2 metaso endpoint 不确定 | 实现为可配置端点（metaso_endpoint.txt 覆盖），不阻塞其他里程碑 |
| TQ3 双引擎缺席时行为 | 知乎双通道兜底，明示降级 |
| TQ4 一手性判定信号 | 启发式优先 + LLM 辅助，只标"疑似" |
| TQ5 缓存粒度 | session 级按 Query/Domain 双键缓存 |

## 交付内容（全部 ✅，tag v2.5 含枚举混用修复 86f37bf）

| 里程碑 | 提交 | 内容 | 验证 |
|---|---|---|---|
| M0 Query Analyzer | `db0f30a` | 六类问题类型→策略 JSON（LLM+规则兜底） | 真实 11/11 |
| M1 URL/多引擎 | `d801fdb` | url-utils 规范化去重 + datasource 多引擎化 | 真实 12/12 |
| M2 Source Registry | `2267b68` | verified/candidate/restricted 三层先验表 | smoke 9/9 |
| M3 来源分析 | `9fa5be7` | LLM 来源理解（类型/一手性/机构，domain 缓存） | 真实 8/8 |
| M4 证据聚簇 | `c2d3bb8` | 转载识别（Dice 双阈值，保守标疑似） | smoke PASS |
| M5 评分+管线 | `31bb6aa` | 六维评分 + v25-pipeline 全链路编排 | 真实 13/13 |
| M6 面板升级 | `433b03e` | 溯源展示 + truth 模式接入 V2.5 管线 | 真实端到端 6/6 |
| M7 回归验收 | `da293b0` | 回归+文档+tag v2.5 | 回归全过 |
| 修复枚举混用 | `86f37bf` | **truth 模式来源全误判知乎**：__sourceRequirement（claim-detector 枚举）被误当 objectType 传管线 → media 查表失败回落 fact → 单路知乎；新增 REQUIREMENT_TO_TYPE 独立映射 + fact 策略放宽多引擎 | 修复验证 10/10+13/13 |

> 关键实现事实：metaso 真实 API 探明为 `https://metaso.cn/api/v1/search`（文档中 playground 地址实为 HTML 页面）；
> 执行记录时期的 ad-hoc 验证脚本在 Temp `hermes-verify-v25m0/m1/m3/m5/m6/v25final`，可复跑。

---

# V2.6 · 证据定向与溯源追踪

> 依据 `search_advise.md` 与 `upgrade.md`（人工三轮改造，2026-08-27 单日完成，合并 PR #2 `b578762`，tag v2.6）。
> 核心目标：**先确定找什么证据再搜索（Evidence Targeting）、追到证据真正来自哪里（Provenance Tracing）、结论必须被证据绑定（Evidence Binding）**。

## 交付内容（三轮全部落地）

### 轮次 A：检索系统改造（search_advise.md）

- **取消硬路由**：所有问题类型 = Exa + Metaso 双核普遍召回 + 知乎低配额补充；questionType 只影响各引擎预算配额（ENGINE_BUDGET 表，如 fact: Exa4/Metaso4/Zhihu1）
- query-analyzer：ENTITY_OFFICIAL_DOMAINS 表（约 36 实体，模型不猜域名）、detectEntities/detectScopeLevel、keywordsEn 跨语言 Query、buildQueries 三路输出（zh/en/official）
- datasource：metaso 支持 site:域、Exa 走原生 includeDomains、buildEngineQuery 引擎各自处理约束
- source-analyzer：新增 publisher/identityType（14 类发布主体身份）——**按"谁发布的"判类型，不按内容**；微信公众号守卫（学会/协会不得判 government）
- source-registry：verified 扩充（stats/npc/court/nih/nasa/fda 等）；微信公众号与微博降为 candidate
- scoring-engine：六维 → **八维**（+directness 0.15 直答度 / +entity 0.12 主体匹配 / +scope 0.08 地域 / +temporal 0.06 时间；authority 降至 0.25、relevance 0.20）；preferredSources 真正生效 +8、目标论文 +6、转载 -6
- evidence-graph：转载检测三级分级（duplicate/likely_syndication/possible_syndication），防改标题转载漏判
- verify-engine：selectDiverseTopN 多样性验证池（同来源类型最多占一半）
- analyzer：truth 提示词强制证据绑定（evidenceId 引用 E1~E5）+ 硬降级校验（无来源→insufficient；未绑定编号→partial）

### 轮次 B：Evidence Targeting & Provenance Tracing（upgrade.md）

- **evidence-target.js**（新增，搜索前决策 P0）：显式来源提取（URL/DOI/arXiv/PMID，纯规则）→ Claim 11 类 → Evidence Target 9 类 → Search Strategy 6 类 → Entity 解析（匿名人物 AMBIGUOUS 禁止强行绑定）+ buildBinding 6 项硬校验
- **academic.js**（新增，P0/P2）：论文目标验证——DOI 精确 > arXiv/PMID > 显式 URL 直中 > 标题精确 > 近似(dice≥0.85) → TARGET_PAPER；语义相似只能 RELATED_PAPER（禁止冒充）
- **provenance.js**（新增，P1）：「据X报道/转载自/according to」上游线索提取 → 共同上游检测（SHARED_UPSTREAM/INDEPENDENT/DERIVED）→ 受控上游检索（3+3+3 预算）→ 置信分级（LOW 不得称首发）
- v25-pipeline：新主流程（并行 策略/目标/页面抓取 → buildPlan 显式步最优先 → … → Binding）；verify-engine 同 provenance 簇只留 1 代表、复用已读正文；panel 元信息行展示 绑定:BOUND/UNBOUND、主体歧义、硬校验、独立来源数

### 轮次 C：知乎超链接论文引用修复（实测问题）

- 问题：知乎文章里 `<a href>` 形式的论文引用无法被提取（htmlToText 丢弃 href），模型返回"其它论文"
- 修复：web-reader 新增 extractLinks（剥离标签前提取锚点）+ wantHtml 选项；evidence-target 新增 classifyLink/extractExplicitSourcesFromHtml（锚文本即标题线索，过滤导航噪声）/mergeExplicitSources；v25-pipeline 新增 fetchPageContext（与 LLM 并行抓取当前文章页，10 条/10 分钟缓存）；academic 新增 EXPLICIT_URL 直中判定
- 修复后链路：页面 `<a href="doi.org/…">论文标题</a>` → 显式步最先直读 → DOI 命中 → TARGET_PAPER 徽章+评分加分 → 硬校验通过

## 验证

- 回归冒烟：`node scripts/smoke-search-advise.js` → **15 组 45 项断言全部通过**（覆盖实体识别/地域/跨语言/双核计划/八维排序/转载分级/多样性池/匿名人物/论文验证/共同上游/显式 DOI 步/超链接回归）
- 语法校验：node --check 全部通过（16 文件）
- 浏览器端到端与真实 API 联调：待人工实测（见遗留）

## 行为变化示例

| 场景 | V2.5 | V2.6 |
|---|---|---|
| NASA 类问题 | fact 排除 Exa，官方源召回不到 | 双核+英文 Query+site:nasa.gov 定向 |
| 全国人口 vs 县级 | 县级报告可能顶替 | scope 维度重罚 |
| 公众号"健康管理学会" | 可能误判为政府 | 按发布主体判 → org |
| 匿名人物"朱女士" | 只搜名字、可能强行绑定 | PERSON_EVENT+AMBIGUOUS，禁止断言 |
| 论文引用 | 语义搜索可能把"相关论文"当目标 | 超链接/DOI 直读，TARGET/RELATED 严格区分 |
| 多家媒体转同一通讯社 | 按独立证据计数 | 共同上游检测 → 同簇只留代表 |

---

# V2.7 · 安全代理

> 依据 `docs/v2.7_UPGRADE.md`（人工改造，2026-08-29~30 两天，提交 `55613f0` + `b49a72b`）。
> 核心目标：**密钥仅存于云端、扩展零密钥**的安全可移植形态——引入 Cloudflare Workers 透明代理，
> 分发包不含任何第三方 API 密钥，扩展仅持一个可随时撤销/轮换的访问令牌。
> 代理源码独立于扩展仓库，非 git 仓库。

## 计划要点（架构变化）

```text
改造前（V2.6）：扩展 SW ──直连──▶ DeepSeek/知乎/metaso/Exa
               generated-config.js 硬编码全部密钥（解压即读走，无法撤销/限流）
改造后（V2.7）：扩展 SW ──HTTPS──▶ CF Worker (api.anota.best) ──▶ 各第三方
               仅持访问令牌          真实密钥存 Worker Secrets（永不下发前端）
```

| 维度 | V2.6（已有） | V2.7（新增） |
|---|---|---|
| 密钥位置 | generated-config.js 明文硬编码，随扩展包分发 | 仅存于 Cloudflare Worker Secrets |
| 请求路径 | 扩展 → 直连第三方 | 扩展 → CF Worker（认证+注入密钥）→ 第三方 |
| 响应结构 | 第三方原始响应 | **不变**（透明代理）——下游归一化/评分/验证零改动 |
| 可用性判断 | 检查本地密钥 | `isProxy() \|\| 本地密钥存在` |
| 分发可行性 | 不可分发 | 可安全分发（零密钥 + 令牌可撤销） |
| 回退 | — | 删除 proxy_base.txt → 重跑 gen-config → DIRECT 模式 |

## 决策记录

| 决策点 | 结论 |
|---|---|
| 代理形态 | **透明代理**（响应结构与原样一致）——smoke 45 项断言直接当回归网 |
| 认证机制 | 阶段 A 静态 `ACCESS_TOKEN`；阶段 3 换知乎 OAuth JWT（→ v2.8） |
| 密钥存储 | Cloudflare Workers Secrets（wrangler secret put，共 5 个：DEEPSEEK/ZHIHU/METASO/EXA/ACCESS_TOKENS） |
| 域名 | `anota.best`，子域 `api.anota.best`（TLS + OAuth redirect_uri 前提） |
| 回退机制 | 保留 DIRECT 模式（本地密钥，开发后门） |

## 交付内容（三阶段全部落地）

### 阶段 A：CF Workers 透明代理（新增 2 文件，部署于 Cloudflare 非扩展包内）

- `qiuzhen-proxy/worker.js`（88 行）：CORS/透明转发/令牌校验；路由表：
  `POST /v1/chat/completions`（DeepSeek 透传）/ `GET /api/v1/content/{zhihu_search,global_search}`（知乎，Worker 重新生成 X-Request-Timestamp）/ `POST /metaso/search` / `POST /exa/search` / `GET /health`
- `qiuzhen-proxy/wrangler.toml`：部署配置（routes = api.anota.best/*）

### 阶段 B：配置生成器双模式（`55613f0`）

- `scripts/gen-config.js` 重写：**PROXY**（存在 proxy_base.txt → 密钥全置 null，仅含 PROXY_ENABLED/BASE_URL/ACCESS_TOKEN）vs **DIRECT**（原逻辑）
- 新增输入文件（gitignored）：`proxy_base.txt`（https://api.anota.best）、`proxy_token.txt`（openssl rand -hex 32）

### 阶段 C：扩展端全模块代理适配（`b49a72b`）

- 7 个直连模块统一"三件套"（isProxy / isLlmAvailable / llmRequestParts），每文件固定 3 处改动（辅助函数 + fetch 地址/认证头 + 可用性校验）：
  `datasource.js`（知乎/metaso/Exa 三数据源分别处理）、`analyzer.js`、`claim-detector.js`、`query-analyzer.js`、`source-analyzer.js`、`verify-engine.js`、`evidence-target.js`
- 零改动确认（架构判断不调 DeepSeek）：v25-pipeline / provenance / academic / search-controller / web-reader / background / url-utils / source-registry / evidence-graph / scoring-engine / manifest / sidepanel / content-script

## 验证

- 回归冒烟：`node scripts/smoke-search-advise.js` → **45/45 PASS**
- 语法校验：7 个改动文件 node --check 全过
- 零密钥确认：敏感凭证前缀扫描 → **0 命中**（具体值不记录于 WORKPLAN）
- 当前环境：generated-config.js 为 PROXY 模式（https://api.anota.best，零密钥）
- 浏览器端到端与 Worker 联调：待人工实测（见遗留）

---

# V2.8 · 登录门禁（邀请码 + JWT）

> 依据 `docs/v2.7_UPGRADE.md` §7 阶段 3（未实施）与知乎官方文档结论（2026-08-31 复核）。
> 核心目标：**用「邀请码 + 短期 JWT」替代静态 `ACCESS_TOKEN`**——分发后任何受邀用户凭邀请码自助接入，
> 不再需要运营者手工发放令牌；JWT 可过期/刷新/按用户撤销。
> **方向调整记录**：原方案为知乎 OAuth 登录；阅读知乎官方文档（`docs/zhihu_OAuth_OFFICAL.md`，gitignored 不入库）确认——
> 知乎 OAuth 面向「三方登录 + 获取授权用户个人信息」，与"仅作为登录门槛"的需求不匹配（申请需人工邮件审批、
> 授权范围是邮箱/手机/公开内容、access_token 仅 1h 有效且无 refresh_token），故改用邀请码 + JWT。
> **（本计划待审批）**
>
> **后续演进说明（2026-09-06）**：本节保留为 V2.8 已交付历史，不回写或抹除。根据更新后的
> `zhihu-skill` OAuth 联调基线，邀请码入口拟由 V3.1 的「知乎官方 OAuth → 应用会话 JWT」替代。
> V3.1 已获批准并在 `v3.1-oauth-only` 分支执行；在 OAuth-only 收口完成前，线上邀请码能力仍暂时保留。

## O-0 · 架构解读

### 现状 vs 目标

| 维度 | V2.7（已有） | V2.8（新增） |
|---|---|---|
| 认证 | 静态 ACCESS_TOKEN（运营者手工发放，泄露难察觉） | 邀请码兑换 → Worker 签发短期 JWT（可过期/刷新/按用户撤销） |
| 用户门槛 | 谁拿到令牌谁用 | 受邀用户凭邀请码自助接入（邀请码一次性、可批量生成/吊销） |
| Worker 鉴权 | `isValidUserToken` 查逗号分隔表 | JWT 校验（签名 + exp + sub 用户维度）；静态表保留为 fallback（开发期） |
| 扩展体验 | 无登录概念，配置文件中放 token | 面板登录输入框 + 登录态展示 + 过期自动引导重登 |

### 复用 vs 新增

- **完全复用**：透明代理路由、7 模块三件套、gen-config PROXY 模式、整个溯源管线
- **改造**：worker.js（新增 `/auth/redeem` 邀请码兑换 + JWT 签发/校验）、panel（登录 UI）、datasource 可用性判断（代理模式下需有效 JWT）
- **新增**：`src/core/auth/invite-jwt.js`（扩展端兑换+存储封装）、Worker 端 JWT 工具（HS256，`JWT_SECRET` 走 Secrets）

## O-1 · 里程碑

| # | 内容 | 要点 |
|---|---|---|
| O0 | 门禁方案确认 | 确定邀请码+JWT（本文档已按此方向）；生成/吊销邀请码的运营端方式（wrangler secret 或 KV 存 active codes） |
| O1 | Worker 兑换+签发 | `POST /auth/redeem`（邀请码 → 校验 → 签发 JWT{sub:邀请码别名, exp}）；`JWT_SECRET` 入 Secrets；静态 ACCESS_TOKENS 保留为 fallback |
| O2 | Worker JWT 鉴权 | `isValidUserToken` 优先 JWT（HS256 签名 + exp + iss/aud），其次静态表 |
| O3 | 扩展登录流 | panel 登录区（输入邀请码 → POST /auth/redeem → JWT 存 `storage.local`）；未登录/过期态 → 引导登录（仅代理功能需登录，DIRECT 模式不受影响） |
| O4 | 用户维度落地 | 请求带 JWT；Worker 按 sub 做基础限流/用量（可选）；知乎搜索 API 仍用应用级 Access Secret（身份门槛与数据凭证分离） |
| O5 | 回归 + 验收 + tag v2.8 | smoke 45/45 + 邀请码流程人工实测 + 文档更新 |

## O-2 · 技术决策点（需要你确认）

### OQ1. 门禁方案（已按方向调整）
建议：**邀请码 + JWT**（本次已选定）。理由：知乎 OAuth 面向三方登录与用户个人信息获取，与"仅作登录门槛"不匹配（详见方向调整记录）。若未来需要"知乎账号直接登录"或"读取用户知乎数据"，再回到 OAuth 申请流程。
### OQ2. JWT 有效期与刷新
建议：**短期 JWT（24h）+ refresh token（30d）**，过期静默刷新，失败才引导重新输入邀请码。备选：长效 JWT（实现最简单，但泄露风险窗口大）。
### OQ3. 登录 UI 形态
建议：panel 顶部状态条（未登录 → 「输入邀请码」入口；已登录 → 用户别名 + 退出）。备选：首次使用自动弹窗强制登录（体验重）。
### OQ4. token 存储位置
建议：`chrome.storage.local`（持久，重启免重登）。备选：storage.session（更安全但每次启动重登，体验差）。
### OQ5. 邀请码管理/限流
建议：V2.8 用 `INVITE_CODES`（Secrets 逗号分隔或 KV）一次性兑换；Worker 按 sub 做基础请求计数（免费计划内存计数即可）。备选：KV 持久化限流（需另开 KV 绑定）。

## O-3 · 风险与应对

| 风险 | 应对 |
|---|---|
| 邀请码泄露 | 一次性兑换（兑换后作废）+ 运营者可随时轮换 `INVITE_CODES`；JWT 24h 过期限制泄露影响面 |
| 无 refresh_token 机制（知乎 OAuth 无此字段，自研 refresh 需自建） | refresh token 由 Worker 自签发（不依赖第三方）；refresh 仅能在兑换后获得 |
| JWT_SECRET 泄露 | Secrets 管理 + 定期轮换；签发时带 iss/aud 防跨域使用 |
| token 过期导致用户困惑 | 静默刷新 + 明确「登录已过期，请重新登录」引导 |
| 登录态丢失（storage.local 被清） | 401 时自动转引导登录，不影响 DIRECT 模式（开发） |

## O-4 · 工作量与顺序

O0 → O1 → O2 → O3 → O4 → O5，总计约 **1.5～2 天**（无需等待外部批复；O1+O2 半天，O3 半天，O4/O5 半天）。
若时间紧：O4 可砍（仅保留 JWT 鉴权不做用户维度），O3 的 UI 可先只做输入框不做别名展示。

## O-5 · 需要你提供的输入

1. 邀请码策略：初始邀请码数量（默认 1 个测试码，`openssl rand -hex 16`）
2. 五个决策点（OQ1-OQ5）的选择（或"按建议"）

**请审批：**
- [x] O-0 架构解读（邀请码+JWT 门禁、复用现有代理）
- [x] O-1 里程碑拆分与顺序
- [x] O-2 五个决策点（OQ1-OQ5 全部按建议）
- [x] O-3 风险应对
- [x] O-4 工作量预期

V2.8 批准记录：已批准（2026-08-31，按建议），开始执行 O0。

## V2.8 执行记录 ✅ 全部完成

| 里程碑 | 提交/位置 | 内容 | 验证 |
|---|---|---|---|
| O0 门禁方案确认 | `invite_code.txt`（gitignored） | 测试邀请码生成；运营端=Worker Secrets（INVITE_CODES/JWT_SECRET） | openssl 生成 OK |
| O1 Worker 兑换+签发 | qiuzhen-proxy/worker.js | POST /auth/redeem（校验→JWT{sub,iss,aud,exp}+refresh）；POST /auth/refresh | 17/17 |
| O2 Worker JWT 鉴权 | 同上 | isValidUserToken：JWT 优先（HS256+exp+iss/aud），静态 ACCESS_TOKENS fallback | 同上 |
| O3 扩展登录流 | `fede10a` | invite-jwt.js（兑换/存储/静默刷新/needs_login）+ background 三 AUTH case + panel 登录 UI | 15/15 |
| O4 用户维度 | qiuzhen-proxy/worker.js | JWT sub 内存限流 2000/天（宽松防滥用，重启归零） | 计数放行 PASS |
| O5 回归+验收 | 本提交 | smoke 45/45 + V2.5 final 17/17 + 零密钥 0 + 语法全过 + tag v2.8 | 全绿 |

### 关键实现事实
- **JWT 自研最小实现**（HS256 via crypto.subtle，无外部依赖）：iss=qiuzhen-proxy / aud=qiuzhen-extension；
  签名/过期/iss-aud 任一不符即拒（篡改/过期/伪造 iss 三个 401 断言全过）
- **refresh token 自签发**（`rt.<alias>.<exp>.<sig>` 同密钥）——不依赖第三方（对比：知乎 OAuth access_token 仅 1h 且无 refresh）
- **未登录不致全盲**：llmRequestParts 优先 JWT、回落静态 PROXY_ACCESS_TOKEN（v2.7 行为保持）
- **DIRECT 模式零影响**：auth 区整区隐藏；独立沙箱验证 direct 双分支（有/无本地密钥）
- **部署文档**：qiuzhen-proxy/DEPLOY.md（Secrets 清单 + V2.8 认证流 + 上线步骤）
- 浏览器端 UI 人工验收待做（Chrome 151 自动化环境限制，同 v2.0 起）

### 已知限制（如实记录）
- 邀请码为 Secrets 逗号分隔表，兑换不销毁（自用规模可接受）；一次性兑换/别名注册需 KV 或 D1，列入 V3 备选
- 限流计数器 SW 重启归零，非精确配额
- 同秒重签的 JWT 字面相同（exp 秒级精度）——仅影响测试断言写法，不影响安全

---

# V2.9 · 检索算法闭环（algorizm_fix 分支）

> 依据：`docs/branch_evolution_guide.md`（2026-09-02）+ 仓库根两份 spec
> （`search_system_P0_P1_modification_spec.md`、`search_system_post_P0_P1_next_stage.md`）。
> 分支关系：master（≤V2.6）→ feature-cfworker（V2.7+V2.8）→ **algorizm_fix（本分支 ★HEAD）**。
> 定位：检索/验证系统从「找相关网页」升级为「**先定证据目标 → 兼容门控 → 溯源 → 证据抽取 → 绑定**」的闭环；
> 原则不变——LLM 负责理解，确定性引擎负责决策约束、排序、去重与证据绑定。
> 规模：11 个源码文件 +634/−82（含新文件 evidence-extractor.js），6 个提交，**未打 tag、未浏览器回归**。

## V2.9 交付内容（P0–P7 全部落地，提交 f7c5732 → 32565e8）

### P0 组 · 决策权理顺（f7c5732 / 70769c5）

| 改动 | 文件 | 要点 |
|---|---|---|
| 官方/高校域名后缀规则补全 | `source-registry.js` | `gov.uk`、`ac.uk`、`go.jp`、任意 `.int` 国际组织等均按后缀识别可信来源（不再逐国枚举） |
| Evidence Target 成为唯一「找什么证据」决策源 | `v25-pipeline.js` | 消除 Query Analyzer 与 Evidence Target 双决策源冲突；检索与排序统一听 ET |
| Target Compatibility 门控（**eventFit**） | `scoring-engine.js` | 打分前先判「是否真的在谈目标事件」：主体对但事件错（大足区纠纷 vs 招聘通报）→ 打折沉底；不硬删除（宁漏判不错杀）；补上八维缺的 event fit |
| 时间语义 `temporalMode` | `query-analyzer.js` | claim 分历史事实/当前状态/近期/动态变化/截至某时/永恒成立六类；`temporalMatchScore` 据此打分（「深圳 2006 年校服政策」不当旧资料惩罚） |
| buildPlan 听 ET 检索策略 | `v25-pipeline.js` | 精确找原文→收敛搜索压社区噪声；广泛印证→放开知乎；溯源→加媒体召回 |

### Phase 1 · URL 可访问性（47aeb36）

| 改动 | 文件 | 要点 |
|---|---|---|
| Web Reader 返回访问元数据 | `web-reader.js` | `finalUrl`（跳转）/`canonicalUrl`/`accessStatus`（404、登录墙、JS 渲染、超时细分） |
| 打不开 ≠ 没证据 | `verify-engine.js` | 404 后先试 canonical，再用「标题+发布者」重搜可访问版本；都失败才降级 |
| 访问失败不降权威分 | `verify-engine.js` | 权威分在读取前已算好；打不开只影响该证据能否用 |

### Phase 2 · Evidence Extraction（47aeb36 / 0d7117e）

| 改动 | 文件 | 要点 |
|---|---|---|
| 数值结构化抽取 | `evidence-extractor.js` ★新 | 判定前正则抽取 `35%`/`3.5万亿`/`37人`/`2026年`（带单位+涨跌方向），格式化注入判定 prompt——解决「AI 读到了整段话却说没看到数字」 |
| 判定引擎读数值 | `verify-engine.js` | 每来源判定可见「本页检测到的数值」清单，数值挂到证据供最终绑定 |

### Phase 3 · 递归溯源（0d7117e）

| 改动 | 文件 | 要点 |
|---|---|---|
| Provenance 从一跳变递归 | `provenance.js` | 媒体 A → 路透社 → 警方 → 警方官网 → 追到源头为止 |
| 受控停止 | `provenance.js` | 深度 ≤3、同 URL 不再追（防环）、命中政府/论文域名即停、预算封顶 |
| 官方域定向检索 | `provenance.js` | 线索「国家统计局」→ 带 `site:stats.gov.cn` 搜上游 |

### Phase 4 · 来源身份三层（6bcef68）

| 改动 | 文件 | 要点 |
|---|---|---|
| platform / publisher / claimedOrigin | `source-analyzer.js` | 区分「托管平台」（公众号/微博/头条）≠「发布账号」≠「内容原产者」（正文自称据央视/路透社）——第三方平台转载央视 ≠ 央视原发 |
| 身份置信度 | `source-analyzer.js` | 官方域名=HIGH、仅名称一致=MEDIUM、第三方转载无法确认=LOW |

### Phase 5 · 当前页进证据图（6bcef68）

| 改动 | 文件 | 要点 |
|---|---|---|
| 当前页元数据抽取 | `evidence-extractor.js` | 从 `<meta>`/JSON-LD 抽发布者、发布时间、作者 |
| 当前页作为候选 | `v25-pipeline.js` | 正在读的文章也进候选池参与打分/验证——能回答「我正看的这篇是不是最新的/转载的」；权威仍按正常规则判定 |

### Phase 6+7 · 动态事实与数字绑定（6bcef68）

| 改动 | 文件 | 要点 |
|---|---|---|
| 「截至」参考时间 | `query-analyzer.js` | 「截至2026年8月30日，死亡21人」→ 自动记 `截至 2026年8月30日` |
| 成稿时间限定 | `analyzer.js` | 动态数据结论要求 LLM 用「截至[来源发布时间/检索时间]」表述，不许输出无时间限定的绝对断言 |
| 结论数字 ↔ 证据数字绑定 | `analyzer.js` | 结论说「涨了35%」但证据原文找不到 35% → 自动保守处理（supported 降级 partial + 加注） |

## 文件级改动（vs feature-cfworker）

```text
 analyzer.js           +52   （Phase 6 时间限定 + Phase 7 数字绑定）
 provenance.js         +131  （Phase 3 递归溯源）
 query-analyzer.js     +30   （temporalMode + referenceTime）
 scoring-engine.js     +75   （Target Compatibility 门控 + eventFit）
 source-analyzer.js    +32   （Phase 4 身份三层）
 source-registry.js    +9    （国别政府/高校/国际组织后缀）
 v25-pipeline.js       +51   （ET 单一决策源 + buildPlan 接线 + 当前页候选）
 verify-engine.js      +153  （URL 失效恢复 + 访问状态 + 数值注入判定）
 web-reader.js         +62   （Phase 1 访问元数据）
 evidence-extractor.js +119  ★新文件（Phase 2/5 数值+页面元数据抽取）
 background.js          2 行 （importScripts 注册 evidence-extractor）
```

## 验证与状态

- 各阶段仅做 Node 语法检查 + mock 单测；**尚未真实浏览器端到端回归**（guide §5）
- 待办：加载扩展 → 分别跑「含数字声明求真 / 媒体→上游溯源 / as_of 声明」各一次
- 分支未打 tag（HEAD=32565e8）；工作区另有整理：`.env/` 入 gitignore（含 metaso_endpoint.txt 移入）、guide 移入 docs/

---

# V3.0 · 可视化动态交互（规划 + 执行记录）

> 依据 `docs/v3.0_UPGRADE.md`（2026-09-06 规划稿）。
> 定位：**不新增分析能力，新增"被看见的分析过程"**——把 V2.9 已做到的深度用动态可视化讲给用户听。
> 三条体验线：① 实时工作流剧场（loading 从假进度变真直播）② 渐进式产出（边跑边出）
> ③ 证据网络（结论 → 可检查的证据地图）。
> **（本计划待审批）**

## V3.0 计划要点

### 现状问题（v3.0_UPGRADE §1）

| # | 问题 | 根因 |
|---|---|---|
| P1 | 算法黑箱：loading 是定时器伪造节奏（panel.js showLoading 内 setTimeout 假推进 3 步），与真实管线脱节 | 管线无阶段上报通道 |
| P2 | 单次等待 10~30s 画面静止，中间结果不上屏 | 全链路跑完才一次性返回 |
| P3 | V2.9 深度（递归溯源/八维/数字绑定）只在文字里，用户感知不到 | UI 只渲染最终文本列表 |

### MVP 里程碑

| # | 内容 | 解决 |
|---|---|---|
| M0 | 真实管线阶段上报（后台给信号，UI 不再演戏）+ 直播剧场（6 主阶段 + 细节可折叠 + 引擎级细节 + 完成/失败/缓存状态）+ 渐进式产出（候选来源先上屏 → 逐条点亮） | P1+P2 |
| M1 | 证据网络图：结论绑定线 + 一手/转载分层 + 溯源树展开 + 矛盾并排 + 数字绑定✓/✗可视化 | P3 + 黑客松记忆点 |
| M2 | 引擎级动画细化（检索光点流动）+ 阶段超时干预（继续/先出结论/取消）+ 求深/求异轻量适配 | 体验加分 |

### 明确不做（V3.0 边界）

- 不重做算法、不改结论逻辑——只把已有过程/结果"翻译"成视觉
- 不做 3D/炫技动效；不做独立"分析回放"页面（先做面板内嵌）

## V3.0 决策记录（2026-09-06 用户拍板）

| # | 问题 | 决策 |
|---|---|---|
| V1 | 直播剧场细节展开策略 | **细节默认展开「当前进行中的主阶段」**（主阶段列表常显；当前阶段细节自动展开，完成后收起、下一个展开） |
| V2 | 证据网络图主视图 | 按建议：结果页顶部「结论卡 + 关系图」并排，来源卡列表保留下方可切换；窄栏图自动变纵向 |
| V3 | 渐进式产出深度 | 按建议：先做"候选清单先上屏 + 逐条判定点亮"，全文流式另一工程量级 |
| V4 | 求深/求异同步改造 | 按建议：仅 M2 轻量适配 |
| V5 | 降级/无凭证可视提示 | 按建议：检索节点直接显示降级徽标 |

## V3.0 执行记录 ✅（进行中）

| 里程碑 | 提交 | 内容 | 验证 |
|---|---|---|---|
| M0a 阶段直播 | `a34e2e2`（+tag `v3.0-m0`） | v25-pipeline 6 主阶段事件（understand→bind，start/done/error）+ search 引擎级子事件；analyzer 透传 onStage；background ANALYZE_STAGE 广播（requestId）；panel 直播剧场（呼吸光点+展开细节，V1 决策） | hermes-verify-v30m0 12/12 + v30m0chain 6/6 + smoke 45/45 |
| M0b 渐进产出 | `9b48771` | search done 携带 preview（原始候选≤6）；filter done 携带 sortedPreview（类型/一手性徽章）；panel「已找到的来源」候选先上屏 → 逐条点亮（url 去重） | hermes-verify-v30m0b 7/7 + v30m0 回归 + smoke 45/45 |
| M0c filter 子流水线 | `8cf4562` | filter 拆 7 子步骤事件（dedupe/page_candidate/registry/source_analysis/academic/clusters/score，逐级真实聚合数据）；panel filter 行内纵向子流水线（序号节点+数值行默认展开，连接线图形化数据流） | hermes-verify-v30filterflow 11/11 + v30m0/v30m0b 回归 + smoke 45/45 |
| M1 证据网络图 | `0bb6d6f` | 新模块 evidence-network.js（buildEvidenceNetwork 纯函数模型：judgment 分组支持/矛盾/未判定 + 类型/一手富化 + 数字绑定 token 匹配 + 溯源链）；panel 结论卡下「证据网络」卡（结论节点 + 连接线动画 + 证据分组并排/窄栏纵向 + 判定徽章/引用/数字✓ chips + 溯源链区） | hermes-verify-v30m1model 14/14 + v30m1verify 7/7 + 全回归 + smoke 45/45 |
| M2 | 待执行 | 动效细化 + 超时干预 + 求深求异适配 | — |

> 浏览器端 UI 人工验收待做（同 v2.0 起 Chrome 151 限制）：加载扩展 → 求真一次，确认剧场动效流畅、候选渐进点亮、细节展开符合 V1 决策。

---

# V3.1 · 知乎官方 OAuth 登录迁移（升级计划 · 执行中）

> 依据：仓库内更新后的 `zhihu-skill/SKILL.md`、`zhihu-skill/references/oauth-introduction.md`、
> `zhihu-skill/references/oauth-boundary.md` 及 OAuth Hello World 参考实现。
> 目标：将 V2.8 的「输入邀请码 → Worker 自签 JWT」改为「用户亲自完成知乎官方授权 → Worker 建立应用会话」，
> 同时保持 V2.7 已有的 API 密钥隔离与 V2.8 的强制门禁语义。
> **本节已获批准；按 A0→A7 顺序执行。OAuth 配置密钥仍只在需要时安全读取，不打印、不入库。**

## 3.1.1 · 方案结论与边界

### 为什么现在可以重启 OAuth 方案

2026-08-31 放弃 OAuth，是因为当时只掌握「OAuth 用于三方登录/用户数据」这一产品定位，且协议资料不完整。
本次 `zhihu-skill` 更新给出了可执行的黑客松联调基线：授权地址、code 交换 Token、双凭证用户 API 调用方式、
公网 HTTPS 回调要求与五项用户接口验收。因此，若产品目标从「匿名门槛」升级为「知乎账号登录」，OAuth 与需求重新匹配。

### 必须保留的协议边界

- OAuth 仅能在部署后的**公网 HTTPS 回调**完成；`localhost` / `127.0.0.1` 只能预览 UI。
- 用户必须亲自点击知乎授权页的最终确认按钮；扩展或 Agent 不代点。
- 回调参数优先读取 `authorization_code`，兼容 `code`；换 Token 表单字段仍为 `code`。
- 实测回调可能不返回 `state`：有 state 时必须 timing-safe 校验；没有 state 时只能标记「黑客松临时联调」，不得宣称生产安全。
- 当前协议没有 PKCE、scope、refresh token、撤销、解绑或拒绝授权流程；OAuth Token 过期后只能重新授权。
- `/user` 没有正式响应 schema：昵称/头像获取失败不得伪造，也不得阻断登录门禁或正式用户接口。
- 用户 API 需要同时发送：`Authorization: Bearer <开放平台 Access Secret>` 与
  `X-OAuth-Token: <用户 OAuth access_token>`；`app_key` 不是 Access Secret，也不是 X-OAuth-Token。

## 3.1.2 · 推荐架构

```text
扩展 Side Panel
  │ ① 点击「使用知乎账号登录」
  ▼
Cloudflare Worker /auth/zhihu/start
  │ ② 生成随机 state + 一次性 flow_id，写入短期服务端状态
  │ ③ 302 → https://openapi.zhihu.com/authorize
  ▼
知乎官方授权页（用户本人确认）
  │ ④ callback?authorization_code=...&state=...
  ▼
Worker /auth/zhihu/callback
  │ ⑤ 用 app_id + app_key 在后端换 OAuth access_token
  │ ⑥ OAuth Token 仅保存在服务端会话；可选尝试 /user 获取展示资料
  │ ⑦ 向扩展签发「应用会话 JWT」（不把 OAuth Token 下发给扩展）
  ▼
扩展 chrome.storage.local：仅保存应用会话 JWT + 展示态
  │ ⑧ 业务请求 Authorization: Bearer <应用会话 JWT>
  ▼
Worker 校验会话 → 代理 DeepSeek / Exa / Metaso / 知乎通用搜索
```

关键决策：**知乎 OAuth Token 与应用会话 JWT 分层**。OAuth Token 代表知乎用户，只留服务端；扩展只持本项目的
短期会话 JWT。这样现有 `guardApi()`、`isApiAllowed()`、`proxyAuthHeader()` 和业务代理路由可以最小改动复用，
也避免把具有用户数据权限的 OAuth Token 暴露给前端。

### OAuth 回调如何回到扩展

推荐使用**短时一次性 flow_id 轮询**，而不是让知乎直接回调 `chrome-extension://`：

1. 扩展调用 `/auth/zhihu/start` 获得 `authorize_url + flow_id`，新标签打开授权页；
2. 知乎回调固定公网地址 `https://api.anota.best/auth/zhihu/callback`；
3. Worker 完成换 Token 后，把 flow 标为 authorized；回调页只显示「授权成功，可返回扩展」；
4. 扩展轮询 `/auth/zhihu/status?flow_id=...`，以一次性 code 领取应用会话 JWT；领取后 flow 立即失效。

该方案不依赖 `chrome.identity.launchWebAuthFlow`，也不要求把扩展动态 ID 登记为回调地址；代价是 Worker 必须有
短期状态存储。**不能继续使用内存 Map**：Cloudflare Worker 实例不稳定、会冷启动，应使用 KV 或 Durable Object，
并为 state/flow 设置 5～10 分钟 TTL 与一次性领取语义。

## 3.1.3 · 凭证、Token 与存储矩阵

| 对象 | 作用 | 推荐存储 | 是否下发扩展 |
|---|---|---|---|
| `app_id` | 标识知乎第三方应用 | Worker 普通配置/vars | 可公开，但无需下发 |
| `app_key` | 后端交换 OAuth Token | Worker Secret `ZHIHU_OAUTH_APP_KEY` | **否** |
| 开放平台 Access Secret | 调知乎通用 API/用户 API 的调用方鉴权 | Worker Secret `ZHIHU_ACCESS_SECRET` | **否** |
| OAuth 会话 Cookie | 绑定浏览器与服务端会话；HttpOnly/SameSite | 浏览器 Cookie（仅服务端读取） | **否（不转给扩展 JS）** |
| `authorization_code` | 一次性换 Token | callback 请求内存，用后丢弃 | **否** |
| 知乎 OAuth access_token | 代表已授权用户；无 refresh token | KV/DO 服务端会话，加密或最小暴露，按 expires_in 过期 | **否** |
| 应用会话 JWT | 证明该扩展用户已完成知乎授权 | 扩展 `chrome.storage.local` + Worker 验签 | **是** |
| flow_id/state | 绑定授权发起与回调、抵抗串号 | KV/DO，5～10 分钟 TTL，一次性 | flow_id 是，state 否 |

安全红线：OAuth 配置文件 `zhihu-skill/OAuth配置.key` 与所有 key/token 一律不读入文档、不打印、不提交；
正式部署只通过 `wrangler secret put` 或 Cloudflare 控制台注入。

## 3.1.4 · 迁移策略（邀请码 → OAuth）

采用**OAuth-only 一次性切换**，不保留邀请码兼容路径、管理员回退或双登录入口：

1. 先新增 OAuth 后端路由、flow 状态存储与扩展 OAuth 登录 UI；
2. 同一迁移分支内彻底删除 `/auth/redeem`、`/auth/refresh`、`INVITE_CODES`、邀请码输入 UI、批量邀请码文件与相关文档/验证脚本引用；
3. 保留应用会话 JWT 鉴权层，但 JWT 的唯一签发依据改为「OAuth 会话授权成功」；
4. 轮换 `JWT_SECRET`，清理 Worker 中静态令牌 fallback 与邀请码 Secrets，使旧邀请码签发的 JWT 立即失效；
5. OAuth 未完成、取消、拒绝、过期或服务异常时，一律拒绝业务 API，不得回落到邀请码、静态令牌或匿名模式（DIRECT 开发模式除外）。

不建议让业务 API 直接接受知乎 OAuth Token：这会把用户 Token 暴露到扩展，并把业务门禁与知乎用户接口鉴权耦合。

## 3.1.5 · 里程碑与验收

| # | 内容 | 交付效果 | 验收重点 |
|---|---|---|---|
| A0 | 凭证与回调前置检查 | 用户确认回调已登记；复用现有 Cloudflare KV 绑定为 `OAUTH_KV`；确认 app_id/app_key 由后续安全配置提供 | 回调地址完全一致；KV 绑定存在；Secrets 不进入源码/git/日志 |
| A1 | Worker OAuth 起点 | `/auth/zhihu/start` 创建 flow_id/state，返回 authorize_url；KV/DO TTL | state 随机、单次 flow、过期 flow 拒绝、无 app_key 明文响应 |
| A2 | Worker callback + 换 Token | callback 兼容 `authorization_code`/`code`；后端请求 `/access_token`；OAuth Token 服务端保存 | 错 state 拒绝；无 state 明示临时联调；code/token 不进日志 |
| A3 | 应用会话签发 | `/auth/zhihu/status` 一次性领取应用 JWT；业务路由继续校验 JWT | flow 不可重复领取；JWT 带 exp/iss/aud/sub；OAuth Token 从不下发 |
| A4 | 扩展登录体验 | 邀请码弹层彻底替换为知乎登录引导；打开授权页、轮询状态、成功后显示昵称或「已授权知乎账号」 | 只有 OAuth 成功后 API 放行；取消/拒绝/过期/网络错误均拒绝 API 并有明确反馈；`/user` 失败不阻断 |
| A5 | 业务与用户接口联调 | 通用搜索仍使用应用级 Access Secret；按产品需要最小调用用户接口 | 双 Header 正确；用户接口默认不采集，只有明确产品用途才调用 |
| A6 | OAuth-only 收口 | 删除邀请码全链路与 Worker fallback；轮换 JWT_SECRET；清理 INVITE_CODES | 旧邀请码 JWT 立即失效；不存在邀请码入口/路由/Secret；DIRECT 开发模式不受影响；文档同步 |
| A7 | 回归与发布 | 登录门禁 + 搜索/深读 + V3.0 可视化完整回归，打版本 tag | 未登录零 API、授权后放行、退出/过期重新授权、smoke 45/45、浏览器无 runtime error |

## 3.1.6 · 产品范围建议

本次首要目的只是**用知乎账号完成身份门禁**。虽然 `zhihu-skill` 提供创作、关注、收藏夹、收藏夹内容、近期收藏
五项用户接口的验收基线，但这些数据与「求真·深读」核心闭环并非必需。建议 V3.1：

- 默认只建立登录身份；`/user` 仅用于昵称/头像展示，失败则显示「已授权知乎账号」。
- 暂不读取创作/关注/收藏数据，避免为了技术展示扩大数据权限与隐私说明负担。
- 若后续要做「基于收藏的个性化深读」，另写产品目标、最小数据范围、用户可见用途与删除机制后再审批。

## 3.1.7 · 风险与降级

| 风险 | 影响 | 计划应对 |
|---|---|---|
| 回调无 `state` | 无法宣称完整 OAuth CSRF 防护 | UI/日志标为临时联调；不作为生产安全完成项；等待平台补齐 |
| 无 PKCE | authorization_code 被截获的风险更高 | HTTPS + 极短 flow TTL + code 后端立即交换 + 一次性领取应用 JWT |
| 无 refresh token | OAuth Token 到期后无法静默续期 | 到期清会话并明确引导重新授权；不伪造刷新能力 |
| Worker 无稳定内存会话 | 冷启动导致 flow/token 丢失 | KV/DO 持久化短期 flow 与 OAuth 会话；不使用 Map 作为正式实现 |
| `/user` schema 不稳定 | 昵称/头像展示失败 | 个人资料作为 optional；失败不阻断登录与深读 |
| 用户 API 权限扩大 | 隐私与信任成本增加 | V3.1 默认不调用五项用户数据接口；确有功能需求再单独审批 |
| OAuth 平台能力仍属联调基线 | 不能声称生产完备 | 发布说明明确「黑客松联调」，在 state/PKCE/撤销能力补齐前不标 production-ready |

## 3.1.8 · 待审批决策点

| 编号 | 决策 | 建议 |
|---|---|---|
| AQ1 | OAuth 回调与扩展会话衔接 | **采用 Worker 公网 callback + flow_id 轮询 + 一次性应用 JWT** |
| AQ2 | Worker 状态存储 | **KV（MVP）**；若需要强一致一次性领取再升级 Durable Object |
| AQ3 | OAuth Token 是否下发扩展 | **绝不下发**，只留服务端；扩展仅持应用会话 JWT |
| AQ4 | 登录方式 | **OAuth-only：彻底删除邀请码机制；只有完成知乎官方 OAuth 授权才能使用功能** |
| AQ5 | 用户数据范围 | **只做登录身份；/user optional；五项用户接口暂不进入产品功能** |
| AQ6 | 无 state 时是否允许联调 | **允许黑客松临时联调，但醒目标注非生产安全；正式发布门槛仍不通过** |
| AQ7 | DIRECT 开发模式 | **保留**，本地开发无需 OAuth；分发的 PROXY 模式强制 OAuth |

**审批门槛（全部满足后才开始 A0）：**

- [x] AQ1～AQ7 已确认（AQ1～AQ3、AQ5～AQ7 按建议；AQ4 已明确改为 OAuth-only）
- [x] 已确认知乎开发平台回调地址已登记：`https://api.anota.best/auth/zhihu/callback`
- [x] 接受当前 OAuth 缺少 state（可能）、PKCE、refresh token、撤销/解绑协议，只作为黑客松联调基线
- [x] 接受新增 Cloudflare KV/DO 作为短期状态与 OAuth 会话存储（A0 复用现有 KV，绑定名 `OAUTH_KV`）
- [x] 确认 V3.1 不读取创作/关注/收藏等用户数据，只做登录门禁（除非另行审批）

### A0 执行记录（2026-09-13）

- 用户已确认知乎开发平台完成回调登记：`https://api.anota.best/auth/zhihu/callback`。
- `api.anota.best/health` 线上返回 200，确认当前 Worker 与域名正常；OAuth callback 尚未实现，不能据此声称 OAuth 已打通。
- Cloudflare 账号已有 KV namespace；`qiuzhen-proxy/wrangler.toml` 已绑定为 `OAUTH_KV`，供 flow/state 与服务端会话使用。
- 当前 Worker Secret 名称基线已核对（仅名称，不读取值）；仍为 V2.8 旧认证集合，OAuth Secret 尚未写入。
- A0 已完成：回调已登记；进入 A1。
- OAuth 应用配置文件已确认存在（仅确认存在性，不读取/输出值）；后续按安全方式将 `app_id` 配置为 Worker 普通变量，`app_key` 配置为 Worker Secret。
- 现有 Worker Secret 名称基线仍为 V2.8 集合；A1 只需要 `OAUTH_KV` 与公开 `app_id`，不读取 OAuth Secret 值。

### A1 执行记录（进行中）

- 目标：实现 `/auth/zhihu/start`，生成一次性 `flow_id`/`state`，写入 `OAUTH_KV`（TTL 10 分钟），返回知乎授权地址。
- 暂不部署，先完成本地结构验证与 dry-run；A1 部署前必须确认 `ZHIHU_OAUTH_APP_ID` 已配置且不包含任何 Secret。

---

# 已知环境问题

- **Chrome 151 + --load-extension 的 content script 注入失效**（自动化测试环境）：开发者模式扩展的 content script 不再注入（含最小 hello-world 复现；site access"所有网站"后仅首次导航偶发注入）。注入链模拟证明 5 个 content script 无运行时错误。**影响**：E2E 自动化暂不可用。**缓解**：人工加载扩展正常使用，或降级 Chrome for Testing 跑 E2E。
- 知乎平台 30001 频率限制窗口（无 Retry-After）：串行+缓存已缓解。

# 遗留事项

V2.6 已知遗留（详见 `docs/v2.6_UPGRADE.md` §6）：

1. Entity–Event Resolution 完整版（多候选事件逐一检索比对）未实现——当前为单次决策状态机
2. Provenance 未纳入八维权重（仅独立性标记/统计呈现）
3. preferredSources 未完全路由化（无每种 claimType 的专属检索步）
4. trace() 上游定向搜索走 metaso；Exa includeDomains 上游追踪未启用
5. LLM 版 Evidence Target 分析未在真实 API 下联调（冒烟只覆盖规则兜底路径）
6. 页面被反爬拦截时超链接提取静默回退语义搜索——可加 content-script 侧兜底上报段落 `<a>` 链接

V2.7 已知遗留（详见 `docs/v2.7_UPGRADE.md` §7）：

1. **阶段 3 登录门禁（→ v2.8 计划，见上节）**：原「知乎 OAuth」经官方文档复核调整为「邀请码 + JWT」（2026-08-31 方向调整）
2. **阶段 4 分发打包 + 密钥轮换（未实施）**：确认 PROXY 零密钥后打包；分发前必须到各平台**撤销旧密钥、生成新密钥**并 `wrangler secret put` 更新（安全警示：改造过程中密钥曾以明文出现在对话/文件中）
3. 辅助函数重复：7 文件各自定义 isProxy/isLlmAvailable/llmRequestParts，未来可抽共享 `llm-client.js`（需改 background importScripts）
4. Worker 限流：免费计划无内置 Rate Limiting，当前靠静态令牌 + JWT 过期；规模化需 KV 计数器或 Durable Objects
5. Worker 流式：passthrough 支持流式，但扩展端 analyzer 为非流式调用
6. 隐私声明：分发后需诚实说明"查询语句经运营者代理服务器转发"（与诚实溯源原则一致）
