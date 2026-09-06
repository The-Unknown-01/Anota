# 分支演进与代码改动说明（algorizm_fix vs 历史分支）

> 面向人群：任何需要理解「求真 · 深读」插件检索系统最近发生了什么改动的人。
> 生成时间：2026-09-02 · 依据 `git diff feature-cfworker...algorizm_fix` / `master...algorizm_fix` 及代码审计整理。

---

## 1. 分支关系速览

```text
master（V2.6 及之前：密钥硬编码在前端）
   │  ← V2.7/V2.8 安全改造
   ▼
feature-cfworker（V2.7+V2.8：密钥上云 + 邀请码登录门禁）
   │  ← 检索算法闭环改造（本分支的独有工作，5 个提交）
   ▼
algorizm_fix（当前分支 ★HEAD）
   │  ← 3 个未提交文件
   ▼
工作区（工作树）
```

- `algorizm_fix` 领先 `feature-cfworker` **5 个提交**（`algotizm newly fixed` / `fixes based on gpt` / `fixes` / `fixes again` / `fiiiixes`）。
- `algorizm_fix` 领先 `master` **18 个提交**（= feature-cfworker 的 13 个 + 上述 5 个）。

---

## 2. 一句话总览

| 对比 | 差异规模 | 一句话含义 |
|---|---|---|
| master → feature-cfworker | 31 个文件，+3619 / -4208 | 第三方 API 密钥从前端「明文硬编码」搬进 Cloudflare Worker；扩展加「邀请码 → JWT」登录门禁（详见各自分支的 v2.7/v2.8 升级文档） |
| feature-cfworker → algorizm_fix | **10 个源码文件，+515 / -82** | **检索/验证系统从「找相关网页」升级为「先定证据目标 → 兼容门控 → 溯源 → 证据抽取 → 绑定」的闭环** |
| 工作区（未提交） | 3 个新文件 | 两份改造 spec + 新建的 evidence-extractor.js（**尚未 git add**） |

---

## 3. 本分支（algorizm_fix）独有改动 —— 逐条人话版

> 说明：下面每一项都是「让系统从『相关网页搜索器』变成『证据溯源系统』」的一步。
> 数字编号对应项目根目录两份 spec 文档（`search_system_P0_P1_modification_spec.md`、`search_system_post_P0_P1_next_stage.md`）里的 P0/Phase。

### 3.1 P0 组：先把"决策权"理顺（提交 f7c5732 / 70769c5）

| 改动 | 文件 | 人话解释 |
|---|---|---|
| 官方/高校域名后缀规则补全 | `source-registry.js` | 之前只认 `*.gov.cn` 和 `*.gov`；现在 `gov.uk`、`ac.uk`、`go.jp`、任意 `.int` 国际组织等都能被当成"可信来源"，不用一个个列国家 |
| Evidence Target 成为唯一"找什么证据"决策源 | `v25-pipeline.js` | 以前 Query Analyzer 和 Evidence Target **两套系统各说各话**（都输出 preferredSources，只有一套生效）；现在检索与排序统一听 Evidence Target 的 |
| Target Compatibility 门控 | `scoring-engine.js` | 打分前先判"这个来源是不是**真的**在谈我们要验证的那件事"：**主体对但事件错**（如找"大足区纠纷通报"却搜到"大足区招聘通报"）→ 总分打折沉底；**不硬删除**（宁漏判不错杀）。补上了原来八维里缺的 **event fit** |
| 时间语义 `temporalMode` | `query-analyzer.js` | claim 现在分：历史事实 / 当前状态 / 近期 / **动态变化**（价格、伤亡数）/ **截至某时** / 永恒成立。`temporalMatchScore` 据此打分——**"深圳2006年校服政策"不该被当成旧资料惩罚** |
| buildPlan 听 Evidence Target 的检索策略 | `v25-pipeline.js` | "精确找原文/查标识符"时收敛搜索、压社区噪声；"广泛印证"时放开知乎；"溯源"时加媒体召回 |

### 3.2 Phase 1：URL 可访问性（提交 47aeb36）

| 改动 | 文件 | 人话解释 |
|---|---|---|
| Web Reader 返回访问元数据 | `web-reader.js` | 读网页不再只回"成功/失败"：现在回 `finalUrl`（是否跳转）、`canonicalUrl`、`accessStatus`（**404=不存在、登录墙、JS 渲染、超时**分得开） |
| 打不开 ≠ 没证据 | `verify-engine.js` | 来源 404 后：先试 canonical 地址，再用「标题+发布者」重搜同一内容的可访问版本；都失败才降级。**"路透社页面我读不到"≠"路透社没报道"** |
| 访问失败不降权威分 | `verify-engine.js` | 打不开只影响"这条证据能不能用"，不影响"这个来源可不可信"（权威分是读之前就算好的） |

### 3.3 Phase 2：Evidence Extraction（在 47aeb36 / 0d7117e 中落地）

| 改动 | 文件 | 人话解释 |
|---|---|---|
| 数值结构化抽取 | `evidence-extractor.js`（**新文件，未跟踪**） | 判定前先用正则抽出正文里的 `35%`、`3.5万亿`、`37人`、`2026年`，带单位与涨跌方向，格式化注入判定 prompt——**解决"AI 读到了整段话却说没看到数字"** |
| 判定引擎读数值 | `verify-engine.js` | 每个来源判定时都会看到"本页检测到的数值"清单，且这些数值挂到该证据上供最终绑定 |

### 3.4 Phase 3：递归溯源（提交 0d7117e）

| 改动 | 文件 | 人话解释 |
|---|---|---|
| Provenance 从"一跳"变"递归" | `provenance.js` | 以前：媒体 A → 提到路透社 → 搜一下 → **停**。现在：媒体 A → 路透社 → 路透社又引用警方 → 警方官网 → **追到源头为止** |
| 受控停止 | `provenance.js` | 深度 ≤3、同一 URL 不再追（防环）、命中政府/论文域名即停、预算封顶 |
| 官方域定向检索 | `provenance.js` | 线索是"国家统计局"→ 直接带 `site:stats.gov.cn` 去搜上游 |

### 3.5 Phase 4：来源身份三层（提交 6bcef68）

| 改动 | 文件 | 人话解释 |
|---|---|---|
| platform / publisher / claimedOrigin | `source-analyzer.js` | 区分「页面托管在哪（公众号/微博/头条）」≠「谁发的（某账号）」≠「内容原产者（正文说"据央视/据路透社"）」——**第三方平台转载央视 ≠ 央视原发** |
| 身份置信度 | `source-analyzer.js` | 官方域名=HIGH，仅名称一致=MEDIUM，第三方转载无法确认=LOW |

### 3.6 Phase 5：当前页面进证据图（提交 6bcef68）

| 改动 | 文件 | 人话解释 |
|---|---|---|
| 当前页元数据抽取 | `evidence-extractor.js` | 从当前页 HTML 的 `<meta>`/JSON-LD 抽发布者、发布时间、作者 |
| 当前页作为候选 | `v25-pipeline.js` | 正在读的那篇文章现在**也进候选池参与打分/验证**，能回答"我正看的这篇是不是最新的/是不是转载的"；权威仍按正常规则判定（不是当前页=对） |

### 3.7 Phase 6 + 7：动态事实与数字绑定（提交 6bcef68）

| 改动 | 文件 | 人话解释 |
|---|---|---|
| "截至"参考时间 | `query-analyzer.js` | "截至2026年8月30日，死亡21人" → 自动记下 `截至 2026年8月30日` |
| 成稿时间限定 | `analyzer.js` | 涉及动态数据的结论，系统要求 LLM 用"截至[来源发布时间/检索时间]"表述，不许输出无时间限定的"就是涨了/就是21人" |
| 结论数字 ↔ 证据数字绑定 | `analyzer.js` | 结论说"涨了35%"但任何证据原文里都找不到 35% → **自动保守处理**（supported 降级 partial 并加注） |

---

## 4. 文件级改动清单（vs feature-cfworker，即本分支核心）

```text
 src/core/ai/analyzer.js           +52    （Phase 6 时间限定 + Phase 7 数字绑定）
 src/core/ai/provenance.js         +131   （Phase 3 递归溯源）
 src/core/ai/query-analyzer.js     +30    （temporalMode + referenceTime）
 src/core/ai/scoring-engine.js     +75    （Target Compatibility 门控 + eventFit）
 src/core/ai/source-analyzer.js    +32    （Phase 4 身份三层）
 src/core/ai/source-registry.js    +9     （国别政府/高校/国际组织后缀）
 src/core/ai/v25-pipeline.js       +51    （ET 单一决策源 + buildPlan 接线 + 当前页候选）
 src/core/ai/verify-engine.js      +153   （URL 失效恢复 + 访问状态 + 数值注入判定）
 src/core/ai/web-reader.js         +62    （Phase 1 访问元数据）
 src/core/background/background.js 2 行   （importScripts 注册 evidence-extractor）
 10 files changed, 515 insertions(+), 82 deletions(-)
```

> 注：`evidence-extractor.js`（Phase 2/5 的核心新文件）尚未 git 跟踪，故不在上表，见 §5 风险。

---

## 5. ⚠️ 风险与待办（重要）

1. 以上算法改动**尚未经过真实浏览器端到端回归**（各阶段只做了 Node 语法检查 + mock 单测），建议：加载扩展 → 分别跑"含数字声明求真 / 媒体→上游溯源 / as_of 声明"各一次。

---

## 6. 如何读这份文档

- 想快速了解"这分支到底牛在哪" → 读 §2 + §3 表格。
- 想核对某次提交 → §3 每节标注了提交号（`git show <提交号>`）。
- 想定位改动在哪个文件 → §4。
- 想接手继续开发 → §5 待办优先处理。
