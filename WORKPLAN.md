# 「求真」交付工作计划（WORKPLAN）

> 项目：知乎黑客松 2026「求真 · 深读」Chrome Extension（MV3）。
> 本文件是全部版本的**计划与交付总账**：每个版本一节（计划 → 决策点 → 执行记录），按时间正序排列。
> 版本升级要求的原文见 `docs/` 下 `v1.5_UPGRADE.md` ~ `v2.7_UPGRADE.md`；V2.9 依据
> `docs/branch_evolution_guide.md` 与仓库根两份 spec（`search_system_P0_P1_modification_spec.md`、
> `search_system_post_P0_P1_next_stage.md`）。
> 回退锚点：git tag 与里程碑一一对应（m0~m4 / u0~u4 / v1.5 / v1.6 / v2.0 / v2.5 / v2.6 / v2.7 / v2.8）；
> algorizm_fix 分支（V2.9）尚未打 tag（HEAD=32565e8）。

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
> 代理源码独立于扩展仓库：`D:\code\2026zhihu_hackathon\qiuzhen-proxy\`（worker.js + wrangler.toml，非 git 仓库）。

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
- 零密钥确认：`grep -cE "sk-ca0c|mk-6DCB|e673c367|64e12d23" src/core/generated-config.js` → **0**
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
