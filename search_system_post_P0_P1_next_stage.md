# Search / Verification System — Post-P0/P1 Next-Stage Modification Specification

> **适用前提**
>
> 上一轮 P0/P1 改造已经完成。本文件不是重复上一轮工作，而是规定下一阶段的工程改造顺序。
>
> 本阶段重点从“让已有决策链闭环”进一步进入：
>
> **可访问性 → 来源身份 → 来源溯源 → 证据质量 → 动态事实 → 最终证据呈现**
>
> 核心原则继续保持：
>
> **LLM负责理解，确定性引擎负责约束、排序、去重、来源关系和证据绑定。**
>
> 不要通过继续堆搜索引擎、继续增加评分维度或单纯增强模型来解决问题。

---

# 0. 修订说明 Rev.1（2026-09-02 · 依据代码审计修正）

> 本版在保留原文档结构的基础上，修正了经实际代码审计发现的 6 处不实/错误（改），
> 并补充了 5 项缺失内容（增）。**执行本规范时以本修订块为准，与正文冲突处以本块优先。**

## 改（R1~R6）

| # | 位置 | 原文 | 修正 |
|---|---|---|---|
| R1 | §4.2 | 记录完整 `redirectChain: [A, B]` | **废弃**。标准 `fetch()` 只提供 `resp.url`（最终 URL）+ `resp.redirected`（是否发生跳转），**拿不到中间跳转链**。改为记录 `finalUrl + redirected + status`；完整链需 `redirect:'manual'` 手动跟随，非本期范围。 |
| R2 | §3.1 / §6 | `accessStatus` 富枚举（JS_REQUIRED / LOGIN_REQUIRED / BLOCKED…）作为统一状态 | 区分两级：**硬事实**（status / finalUrl / redirected / contentLength / fetchedAt / canonicalUrl）与**启发式状态**（READABLE / REDIRECTED / NOT_FOUND / BLOCKED / LOGIN_REQUIRED / JS_REQUIRED / EMPTY_CONTENT / TIMEOUT / NETWORK_ERROR）。JS/登录/反爬只能靠启发式判断，不得当作硬事实。 |
| R3 | §33 顺序 | Phase 2「身份三层」紧接 Phase 1 | **后移**。`source-analyzer.js` 在读取正文前只基于 title/snippet 分析，无法可靠区分「平台账号 vs 转述作者 vs 声称来源(claimedOrigin)」；后者需读正文（"据央视报道"）才可靠。身份分析移到 Web Reader 读正文能力就绪之后（见修正顺序 Phase 4）。 |
| R4 | §27-28 | 「Evidence Binding 硬校验」作为新机制 | **复用并强化**。`analyzer.js` + `evidence-target.js` 的 `buildBinding/hardValidation` 已存在（E1~E5 绑定、未绑定强制降级、实体歧义处理）。本阶段只强化「用结构化证据核对数字/主体/时间/scope」，不新建绑定层。 |
| R5 | §34 | 回归测试按阶段列出场景 | 补充执行方式：URL/访问类用 **Node 单测 + fetch mock**（现有 `.e2e` 直连真实 API，无法测 404/301/超时）。见增 A3。 |
| R6 | §17 / §35 | 「来源独立性」作为阶段目标 | **已实现**。`evidence-graph.js` 与 `provenance.js buildGraph()` 已有 INDEPENDENT / SHARED_UPSTREAM / DERIVED，本阶段只需接入验证与展示，不重建。 |

## 增（A1~A5）

| # | 补充内容 |
|---|---|
| A1 | **每阶段独立验收 + 可回滚粒度**：每个 Phase 完成后必须能独立交付（语法检查 + 对应单测 + 真实浏览器一次冒烟）；失败回滚该 Phase，不回滚全局。 |
| A2 | **Phase 2（证据抽取）成本预算**：采用「正则优先、LLM 兜底」——数字/百分比/金额/日期/单位先用正则抽取（零 LLM），同比/环比/方向/主体等语义才调 LLM，避免逐候选 LLM 调用翻倍打爆延迟。 |
| A3 | **回归测试执行方式**：新增 `scripts/` 下的 Node 单测 + 全局 mock fetch（模拟 200 / 301 / 404 / canonical / 薄正文 / 超时），随对应阶段提交；真实浏览器回归另行人工。 |
| A4 | **Phase 5（当前页）隐藏前置**：当前页的 `publisher` / `publishedAt` 尚未采集（`fetchPageContext` 只拿 title/text/html/links）。Phase 5 必须先补「从当前页 HTML / `<meta>` / JSON-LD 抽取 publisher 与发布时间」，否则当前页无法作为候选参与权威与时间评分。 |
| A5 | **Phase 6（动态状态）依赖 Phase 2**：`dataPeriod`（数据所属时段）与 `eventTime` 不在搜索引擎元数据里，只能由 Evidence Extraction 从正文抽取（如"截至 X 月 X 日"）。Phase 6 必须排在 Phase 2 之后。 |

## 修正后的阶段顺序（取代 §33 旧顺序）

```text
Phase 1  Web Reader / URL 可访问性（简化版：finalUrl+redirected+status+canonical+启发式 accessStatus；不做 redirectChain）
Phase 2  Evidence Extraction（正则优先 + LLM 兜底）—— 解锁 Phase 6 / 7
Phase 3  Recursive Provenance（maxDepth≤3 + 环检测 + 复用统一 Search Plan）
Phase 4  Source Identity 三层（platform/publisher/claimedOrigin）—— 移到读正文能力之后
Phase 5  Current Page → Evidence Graph（前置：先补当前页 publisher/publishedAt 抽取）
Phase 6  Dynamic / As-of Evidence State（依赖 Phase 2 的 dataPeriod）
Phase 7  Evidence Binding 强化（复用现有 hardValidation）
Phase 8  Editorial Quality Profile —— 无限期推迟
```

---

# 1. 本阶段目标

上一轮已经解决：

```text
Claim
  ↓
Evidence Target
  ↓
Search Plan
  ↓
Target Compatibility
  ↓
Existing Scoring
```

下一阶段需要解决剩余的几个核心问题：

1. 搜索结果 URL 无法访问、404、重定向、动态页面、反爬等情况下，系统仍然能够获得可验证证据。
2. 搜索平台、实际发布者、内容原作者之间的身份关系必须明确。
3. Provenance 从“一跳”升级为受控递归来源追踪。
4. 当前页面成为完整证据链的入口，而不是只有链接提取功能。
5. Evidence Extraction 与 Verify 真正分离。
6. 对动态新闻 / 数据 / 数字状态建立稳定的“截至某时点”表达。
7. 最终答案必须能够解释“这个结论究竟由哪个来源、哪句话、哪个数据支持”。

---

# 2. 总体目标架构

```text
Current Page / Selected Text
          ↓
      Claim
          ↓
   Evidence Target
          ↓
     Search Plan
          ↓
      Retrieval
          ↓
   URL Resolution
          ↓
 Source Accessibility
          ↓
 Source Identity
          ↓
 Target Compatibility
          ↓
 Existing 8D Scoring
          ↓
 Evidence Graph
      ↙       ↘
Provenance   Current Page
      ↓
 Evidence Extraction
      ↓
   Verify Engine
      ↓
 Evidence Binding
      ↓
 Final Answer
```

重点：

> “URL存在”不等于“来源可用”。
>
> “来源可用”不等于“来源相关”。
>
> “来源相关”不等于“来源支持主张”。
>
> “多个来源”也不等于“多个独立证据”。

---

# 3. 第一阶段：Web Reader / URL 可访问性改造

## 3.1 建立统一 Source Access 状态

不要让 `web-reader.js` 只有：

```text
success / failure
```

建议统一为：

```js
{
  accessStatus:
    "READABLE" |
    "REDIRECTED" |
    "NOT_FOUND" |
    "BLOCKED" |
    "LOGIN_REQUIRED" |
    "JS_REQUIRED" |
    "TIMEOUT" |
    "NETWORK_ERROR" |
    "EMPTY_CONTENT",

  requestedUrl,
  finalUrl,
  canonicalUrl,
  redirectChain,

  title,
  content,
  contentLength,

  fetchedAt,
  accessMethod
}
```

实际字段名可根据现有代码调整。

---

# 4. URL Resolution 与 Content Identity

## 4.1 必须区分四个 URL

```text
requestedUrl
finalUrl
canonicalUrl
sourceUrl
```

其中：

- `requestedUrl`：搜索引擎返回的 URL
- `finalUrl`：实际访问后的最终 URL
- `canonicalUrl`：页面声明的 canonical URL
- `sourceUrl`：系统最终认为代表该内容的 URL

不要默认：

```text
requestedUrl === sourceUrl
```

---

## 4.2 Redirect 不应静默处理

例如：

```text
A
↓
301
↓
B
```

必须记录：

```js
redirectChain: [A, B]
```

然后比较：

```text
A title
B title
A publisher
B publisher
A content identity
B content identity
```

如果 B 与 A 明显不是同一内容：

```text
sourceIntegrity = LOW
```

而不是直接把 B 当成 A。

---

# 5. URL 失效后的自动恢复

如果：

```text
404
```

不要立即：

```text
evidence = none
```

而应该执行有限恢复流程：

```text
原 URL
 ↓
访问失败
 ↓
检查 canonical / redirect
 ↓
根据 title + publisher + 日期重搜
 ↓
寻找同一内容的可访问版本
 ↓
寻找官方原始来源
 ↓
寻找上游来源
```

恢复搜索应该尽量使用：

```text
精确标题
+
publisher
+
关键句
+
日期
+
实体
```

而不是重新执行一次泛搜索。

---

# 6. 页面存在但正文无法读取

必须区别：

```text
NOT_FOUND
```

与：

```text
BLOCKED
JS_REQUIRED
LOGIN_REQUIRED
```

因为：

```text
无法读取
≠
不存在
```

例如：

```text
Reuters 页面无法读取
```

不能得出：

```text
Reuters 没有报道
```

---

# 7. Web Reader Fallback Chain

推荐：

```text
Level 1
直接读取页面
        ↓
Level 2
最终重定向 URL / canonical URL
        ↓
Level 3
搜索结果 snippet
        ↓
Level 4
同标题 / 同内容的可访问版本
        ↓
Level 5
官方来源搜索
        ↓
Level 6
Provenance 上游来源
```

注意：

> Fallback 的目的不是找“相似文章”，而是恢复同一证据或更上游证据。

---

# 8. Access Failure 不应降低 Source Authority

例如：

```text
Reuters
读取失败
```

不能变成：

```text
authority = low
```

应该：

```text
authority = unchanged
accessStatus = BLOCKED
```

然后影响：

```text
evidence usability
```

而不是：

```text
source credibility
```

这是非常重要的概念分离。

---

# 9. 第二阶段：Platform / Publisher / Origin 身份体系

## 9.1 建立三层身份

每个来源尽量记录：

```js
{
  platform,
  publisher,
  contentOwner,
  claimedOrigin,
  identityType
}
```

必须区分：

```text
页面托管平台
≠
实际发布者
≠
内容原作者
```

---

# 10. 典型案例

### 情况 A

```text
Platform: Tencent
Publisher: CCTV
ContentOwner: CCTV
```

这是：

```text
CCTV 在腾讯平台发布
```

---

### 情况 B

```text
Platform: Tencent
Publisher: Media B
ContentOwner: Media B
claimedOrigin: CCTV
```

这是：

```text
Media B 转述 CCTV
```

不能当成：

```text
CCTV 原始发布
```

---

### 情况 C

```text
Platform: Tencent
Publisher: Media B
claimedOrigin: Reuters
```

应进入：

```text
Provenance
```

而不是直接作为 Reuters 来源。

---

# 11. Source Identity Confidence

身份识别也应有置信度：

```js
identityConfidence:
  HIGH | MEDIUM | LOW
```

例如：

```text
官方域名 + 官方页面结构
→ HIGH

平台账号名称与机构一致
→ MEDIUM/HIGH

文章自称“据某机构”
→ MEDIUM

第三方转载且无法确认原作者
→ LOW
```

不要仅凭：

```text
标题
账号昵称
URL路径
```

就认定官方身份。

---

# 12. 第三阶段：Provenance 递归化

现有：

```text
Media A
 ↓
Reuters
```

升级为：

```text
Media A
 ↓
Reuters
 ↓
Official Agency
 ↓
Original Statement
```

---

# 13. Recursive Provenance Contract

建议：

```js
trace(source, {
  depth,
  maxDepth: 3,
  visited,
  claim,
  evidenceTarget
})
```

必须：

- 最大深度有限
- sourceId / URL 去重
- 防止循环
- 找到高置信 primary source 后提前停止
- provenance confidence 逐层传播

---

# 14. Provenance 停止条件

满足以下任意条件可以停止：

```text
1. 找到明确一手来源
2. 找到明确官方文件
3. 找到原始论文
4. 找到原始数据集
5. 已经连续两层没有新的上游线索
6. provenance confidence 低于阈值
7. 达到 maxDepth
8. 检测到循环
```

---

# 15. Provenance 不应盲目向上追

例如：

```text
媒体 A
 ↓
Reuters
```

如果 Reuters 本身已经是该新闻的原始新闻报道：

```text
停止
```

不要为了“继续递归”而寻找无意义的来源。

目标不是：

> 找最底层网页。

而是：

> 找到足以支持当前主张的最上游可信来源。

---

# 16. Provenance 搜索必须复用统一 Search Plan

不要再建立：

```text
normal search
```

和：

```text
provenance search
```

两套完全不同的搜索逻辑。

Provenance 搜索应继承：

```text
Evidence Target
+
official domain targeting
+
Exa
+
Metaso
+
existing compatibility
```

---

# 17. Provenance 来源关系

Evidence Graph 中继续区分：

```text
INDEPENDENT
SHARED_UPSTREAM
DERIVED
```

例如：

```text
Reuters
 ↑
Media A
 ↑
Media B
 ↑
Media C
```

不能算：

```text
4 independent sources
```

而应表示：

```text
1 upstream evidence
+
3 derived reports
```

---

# 18. 第四阶段：Current Page 正式进入 Evidence Graph

当前用户所在页面不是普通搜索结果。

它具有：

```text
context value
+
possible evidence value
+
provenance value
```

建议建立：

```js
{
  sourceKind: "CURRENT_PAGE",
  url,
  title,
  publisher,
  publishedAt,
  selectedText,
  surroundingText,
  pageContent
}
```

---

# 19. Current Page 的三种角色

同一页面可以同时是：

```text
Context Source
Evidence Candidate
Provenance Root
```

但不能自动视为：

```text
Authoritative Source
```

---

# 20. 第五阶段：Evidence Extraction

建立明确的中间层：

```text
Web Reader
    ↓
Evidence Extraction
    ↓
Verify
```

而不是：

```text
Web Reader
    ↓
Verify（重新自己找证据）
```

---

# 21. Evidence Object

推荐结构：

```js
{
  evidenceId,
  sourceId,

  subject,
  predicate,
  object,

  value,
  unit,
  direction,
  magnitude,

  event,
  time,
  scope,

  quote,
  location,

  extractionConfidence
}
```

---

# 22. Evidence Extraction 必须保留原文位置

不要只返回：

```text
value = 35%
```

必须同时保留：

```text
source
+
sentence
+
paragraph
+
location
```

这样最终才能生成：

```text
E1 → source → sentence
```

的完整证据绑定。

---

# 23. Evidence Extraction 与 Verify 的职责

### Evidence Extraction

回答：

> 来源中到底写了什么？

### Verify

回答：

> 这些内容能不能支持用户的主张？

例如：

```text
文章写：
“价格较去年同期上涨35%”
```

Extraction：

```text
subject = price
value = 35
direction = increase
time = year-over-year
```

Verify 再判断：

```text
用户说“现在价格大涨”
```

是否可以由这个证据支持。

---

# 24. 第六阶段：动态事实状态

对：

```text
价格
死亡人数
伤亡人数
选举结果
汇率
股价
市场份额
实时事件
```

不要只输出：

```text
TRUE / FALSE
```

而应该建立：

```js
{
  claimState,
  observedValue,
  observedAt,
  sourcePublishedAt,
  dataPeriod,
  confidence
}
```

---

# 25. “截至”语义

最终答案应明确：

```text
截至 [时间]
```

尤其对于：

```text
current
recent
evolving
as_of
```

例如：

```text
截至 2026-09-02，
目前能够核实的公开数据为……
```

---

# 26. 动态事实不能混淆四种时间

系统应尽可能区分：

```text
eventTime
sourcePublishedAt
dataPeriod
retrievedAt
```

例如：

```text
事件发生：9月1日
媒体报道：9月1日 20:00
数据统计：截至9月1日 18:00
系统检索：9月2日 14:00
```

它们不是同一个时间。

---

# 27. 第七阶段：Evidence Binding 强化

最终答案中的：

```text
E1
E2
E3
...
```

必须真正绑定到结构化证据。

推荐：

```js
{
  evidenceId: "E1",
  sourceId,
  claimId,
  supports: true,
  evidenceType,
  sentence,
  value,
  time,
  scope
}
```

---

# 28. Evidence Binding 的硬校验

最终答案如果声称：

```text
某数字为 X
```

系统必须检查：

```text
E1 是否包含 X？
E1 的 subject 是否正确？
E1 的时间是否正确？
E1 的 scope 是否正确？
```

如果不能通过：

```text
不得让最终答案以确定语气输出 X。
```

---

# 29. 第八阶段：Source Quality Profile

在前面所有机制稳定后，再考虑建立：

```js
sourceQuality = {
  editorialTransparency,
  bylinePresent,
  publicationDatePresent,
  updateTimePresent,
  correctionPolicy,
  primarySourceCapability,
  platformType
}
```

这不是当前最高优先级。

原因：

> Source Quality 是“来源质量”的进一步描述，而不是解决“是否找到正确证据”的核心机制。

---

# 30. 推荐最终 Pipeline

改造完成后：

```text
1. JWT Gate
2. Cache
3. Query Analyzer
4. Evidence Target
5. buildPlan
6. Multi-engine Retrieval
7. URL Normalize / Dedup
8. URL Resolution
9. Source Accessibility
10. Source Identity
11. Target Compatibility
12. Existing 8D Scoring
13. Evidence Graph
14. Provenance Recursion
15. Web Reader
16. Evidence Extraction
17. Verify Engine
18. Evidence Binding
19. Final Draft
20. Hard Validation
```

---

# 31. 失败恢复路径

必须形成以下闭环：

```text
Search
 ↓
URL inaccessible
 ↓
Resolve
 ↓
Retry / Canonical
 ↓
Same-content search
 ↓
Official-domain search
 ↓
Provenance search
 ↓
Upstream source
 ↓
Evidence extraction
 ↓
Verify
```

而不是：

```text
URL inaccessible
 ↓
No evidence
```

---

# 32. 下一阶段禁止事项

不要：

### 1. 再增加大量搜索引擎

先把已有来源真正利用起来。

### 2. 再增加评分维度

已有八维已经足够作为候选排序基础。

### 3. 把“官方”当成绝对正确

官方来源也可能：

```text
wrong event
wrong scope
old document
wrong variable
```

### 4. 把“打不开”当成“没有证据”

必须区分：

```text
source credibility
```

和：

```text
source accessibility
```

### 5. 把转载当独立来源

必须由 Evidence Graph / Provenance 判断独立性。

### 6. 让 LLM 自己决定最终来源排名

LLM负责：

```text
claim understanding
event understanding
evidence extraction
provenance clue extraction
verification reasoning
```

确定性系统负责：

```text
search plan execution
compatibility
ranking
dedup
provenance graph
evidence binding
hard validation
```

---

# 33. 实施顺序

> ⚠️ **本节旧顺序已被文档顶部「§0 修订说明」中的『修正后的阶段顺序』取代。** 执行时以修订块为准。主要变更：Phase 2 身份识别后移（原 §9-11）、Evidence Extraction 提前、§4.2 redirectChain 废弃、Phase 7 改为复用现有 hardValidation。

严格建议（旧版，保留供对照）：

```text
Phase 1
Web Reader / URL Integrity / Access Recovery
        ↓
Phase 2
Platform / Publisher / Origin
        ↓
Phase 3
Recursive Provenance
        ↓
Phase 4
Current Page → Evidence Graph
        ↓
Phase 5
Evidence Extraction → Verify
        ↓
Phase 6
Dynamic / As-of Evidence State
        ↓
Phase 7
Evidence Binding Hard Validation
        ↓
Phase 8
Editorial Quality Profile
```

---

# 34. 每阶段必须有回归测试

## URL

测试：

```text
200
301/302
404
canonical
blocked
JS-only
timeout
```

---

## Identity

测试：

```text
官方站
官方账号
第三方平台官方账号
第三方转载
媒体转述
```

---

## Provenance

测试：

```text
Media → Reuters
Media → Reuters → Official
Media → Police Statement
Media → Social Post → Official
```

---

## Dynamic

测试：

```text
旧数据
最新数据
截至某日数据
不断变化的数据
```

---

## Evidence Extraction

测试：

```text
数字
百分比
金额
日期
同比
环比
数量变化
明确否定
```

---

# 35. 最终成功标准

系统最终应从：

> “找到几个看起来相关的网站，然后让 AI 判断。”

升级为：

> “先确定需要什么证据；找到候选来源后确认它是否属于正确实体、事件、变量、范围和时间；如果来源是转载，则继续追踪上游；如果原始 URL 无法访问，则恢复同一证据或寻找更上游来源；最后提取具体证据并绑定到最终结论。”

最终核心链条：

```text
Claim
 ↓
Evidence Target
 ↓
Search Plan
 ↓
Target Compatibility
 ↓
Source Identity
 ↓
Source Accessibility
 ↓
Provenance
 ↓
Evidence
 ↓
Verification
 ↓
Answer
```

这才是完整的 **Information Provenance / Evidence Verification System**，而不是普通的相关网页搜索系统。

---

# 36. Agent 执行要求

开始修改前：

1. 读取当前仓库实际代码。
2. 确认上一轮 P0/P1 已经实际落地。
3. 列出已经存在的相关函数，避免重复实现。
4. 先修改 Web Reader / URL Access，再进行后续模块。
5. 每完成一个 Phase 都执行对应回归测试。
6. 保留 debug 信息，尤其是：
   - accessStatus
   - redirectChain
   - source identity
   - provenance depth
   - target compatibility
   - evidence extraction
   - evidence binding
7. 不要一次性重构整个 pipeline。
8. 优先通过模块接口连接现有能力。
9. 如果现有实现与本文字段命名不同，优先适配现有架构，不强制照搬字段名。
10. 如果发现上一轮实现已经覆盖本文某项功能，不要重复实现，而是检查是否真正接入最终 pipeline。
