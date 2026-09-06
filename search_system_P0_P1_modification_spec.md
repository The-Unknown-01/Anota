# Search / Verification System Architecture Modification Specification
## P0–P1: Unify Decision Authority, Add Target Compatibility Gating, Normalize Temporal Semantics, Then Strengthen Evidence & Provenance

> **Document purpose**
>
> This document is intended to be executed by an Agent that can inspect and modify the existing Chrome Extension search/verification codebase.
>
> **Core principle**
>
> Do not rebuild the search system from scratch. The current architecture already contains most required modules and scoring dimensions. The main problem is that several modules are not connected into a single decision chain.
>
> The target architecture is:
>
> **Context → Claim → Evidence Target → Search Plan → Target Compatibility → Source Analysis → Provenance → Evidence → Verification → Final Answer**
>
> The key engineering principle remains:
>
> **LLM负责理解；确定性引擎负责决策约束、排序、去重和证据绑定。**
>
> Do not solve the current problems by simply using a stronger model, adding more search engines, or globally changing scoring weights.

---

# 1. Existing Architecture Must Be Preserved

Before modifying anything, inspect the actual codebase and identify the existing implementations of:

- `query-analyzer.js`
- `evidence-target.js`
- `v25-pipeline.js`
- `datasource.js`
- `source-registry.js`
- `source-analyzer.js`
- `evidence-graph.js`
- `scoring-engine.js`
- `web-reader.js`
- `verify-engine.js`
- `provenance.js`
- `search-controller.js`
- `analyzer.js`
- `background.js`

The following existing capabilities are considered **already implemented** and must be reused rather than recreated:

### 1.1 Evidence Target

`evidence-target.js` already contains concepts including:

- `CLAIM_TYPES`
- `TARGET_TYPES`
- `STRATEGIES`
- `ruleEvidenceTarget()`
- `entityResolutionStatus`
- entity binding / ambiguity handling

Existing target types include concepts such as:

- `EXACT_ENTITY`
- `ENTITY_EVENT`
- `EXACT_PAPER`
- `ORIGINAL_REPORT`
- `OFFICIAL_DOCUMENT`
- `OFFICIAL_PRODUCT`
- `PRIMARY_DATA`
- `DATASET`
- `SECONDARY_CORROBORATION`

Existing strategies include:

- `EXACT_SOURCE`
- `PREFERRED_SOURCE`
- `IDENTIFIER_SEARCH`
- `SEMANTIC_SEARCH`
- `BROAD_CORROBORATION`
- `PROVENANCE_SEARCH`

### 1.2 Existing scoring dimensions

Do **not** invent a second set of fit dimensions.

The existing scoring system already contains dimensions corresponding to:

- authority
- relevance
- directness
- entity
- scope
- temporal
- originality
- evidence

Current approximate weights are:

```text
authority     0.25
relevance     0.20
directness    0.15
entity        0.12
scope         0.08
temporal      0.06
originality   0.08
evidence      0.06
```

These weights should **not** be globally rewritten as the solution to the current problems.

### 1.3 Existing provenance

`provenance.js` already supports:

- upstream-source pattern extraction
- provenance clues
- provenance clustering
- independence states
- confidence levels

It is therefore a **P1 enhancement target**, not a missing module that should be recreated.

---

# 2. Root Problem

The system currently contains two partially independent strategy sources.

## 2.1 Query Analyzer strategy

`query-analyzer.js` currently produces understanding / strategy fields such as:

- problem type
- Chinese keywords
- English keywords
- entities
- preferred sources
- time window
- engine selection

Some of these fields are directly used downstream.

## 2.2 Evidence Target strategy

`evidence-target.js` independently determines:

- claim type
- target type
- preferred source types
- search strategy
- entity resolution
- explicit source requirements

However, based on the current architecture audit, the Evidence Target result is not sufficiently connected to retrieval planning.

In particular:

```text
et.targetType
et.preferredSources
et.searchStrategy
```

must become actual decision inputs to the search plan.

Otherwise the system effectively has:

```text
Query Analyzer → Search
Evidence Target → mostly final binding
```

instead of:

```text
Query Analyzer
      ↓
Claim
      ↓
Evidence Target
      ↓
Search Plan
      ↓
Retrieval
```

This is the primary P0 problem.

---

# 3. Target Architecture

The intended architecture after this modification is:

```text
Current Page / Selected Text
          │
          ▼
   Query Analyzer
   ├─ claim understanding
   ├─ entities
   ├─ keywords
   ├─ keywordsEn
   └─ temporalMode
          │
          ▼
   Evidence Target
   ├─ claimType
   ├─ targetType
   ├─ preferredSources
   ├─ searchStrategy
   ├─ entity resolution
   └─ evidence requirements
          │
          ▼
      buildPlan()
          │
          ├─ explicit source / DOI / URL
          ├─ official source targeting
          ├─ Exa
          ├─ Metaso
          ├─ Zhihu low quota
          └─ provenance search
          │
          ▼
   Candidate Retrieval
          │
          ▼
 URL normalize / dedup
          │
          ▼
 Source Analyzer
          │
          ▼
 Target Compatibility Gate
          │
          ├─ entity fit
          ├─ event fit  ← NEW
          ├─ scope fit
          ├─ temporal fit
          ├─ directness fit
          └─ target/source-type compatibility
          │
          ▼
 Existing 8-Dimension Scoring
          │
          ▼
 Evidence Graph
          │
          ▼
 Web Reader
          │
          ▼
 Evidence Extraction       Provenance
          │                   │
          └────────┬──────────┘
                   ▼
              Verify Engine
                   │
                   ▼
              Final Answer
```

The important ordering is:

> **Target Compatibility is a gate/penalty before ordinary ranking. It is not a replacement scoring system.**

---

# 4. P0-1 — Establish Evidence Target as the Single Strategy Authority

## Objective

Make `Evidence Target` the single authoritative source for **what evidence should be searched for**.

The Query Analyzer should remain responsible for understanding the user's claim, but it should no longer independently make downstream evidence-selection decisions that conflict with Evidence Target.

## 4.1 Query Analyzer should retain understanding fields

Keep fields such as:

```js
{
  claimType,
  keywords,
  keywordsEn,
  entities,
  region,
  temporalMode,
  claimVariables,
  explicitSources
}
```

The exact field names may be adapted to the current implementation.

The important distinction is:

### Query Analyzer answers:

> “用户这句话是什么意思？”

### Evidence Target answers:

> “为了验证这句话，什么类型的证据才有意义？”

---

## 4.2 Fields that should be downgraded from QA strategy authority

Fields such as:

```text
preferredSources
timeWindow
dualEngine
```

must no longer function as an independent strategy authority if they duplicate or conflict with Evidence Target.

### Important nuance

Do not necessarily delete these fields immediately.

For compatibility and debugging, they may remain in the QA result temporarily, but they should be treated as:

- diagnostic information
- retrieval hints
- backward-compatible metadata

rather than the final evidence strategy.

The final retrieval strategy must derive from:

```text
Claim + Evidence Target
```

not from competing QA and ET decisions.

---

# 5. P0-2 — Connect Evidence Target to buildPlan()

This is the most important “接线” task.

Inspect `buildPlan()` in `v25-pipeline.js`.

Currently the audit indicates that `buildPlan()` mainly consumes:

- `evidenceTarget.explicitSources`
- academic-specific logic

but does not fully consume:

```text
et.targetType
et.preferredSources
et.searchStrategy
```

This must change.

## 5.1 Required behavior

`buildPlan()` must derive its search plan from Evidence Target.

Conceptually:

```js
const et = evidenceTarget;

const plan = buildPlan({
  claim,
  evidenceTarget: et,
  queryAnalysis
});
```

Then:

```text
targetType
      ↓
preferred source families
      ↓
search strategy
      ↓
query construction
      ↓
engine allocation
```

---

# 6. Search Strategy Translation

Evidence Target strategies should map to concrete retrieval behavior.

## 6.1 EXACT_SOURCE

Use when:

- explicit URL exists
- DOI exists
- document identifier exists
- clearly identified original source exists

Priority:

```text
explicit source
→ direct fetch
→ canonical resolution
→ only then search fallback
```

Do not let broad semantic search outrank an explicitly identified source.

---

## 6.2 PREFERRED_SOURCE

Use when the claim requires a particular source family.

Examples:

```text
government report
→ government domain / issuing agency

academic paper
→ DOI / journal / publisher / repository

official product
→ manufacturer official domain

policy / regulation
→ issuing authority / official legal source

police statement
→ police department / public agency / official statement channel
```

Important:

> `preferredSources` is a **direction**, not an unconditional hard filter.

An official source can still be unrelated.

---

## 6.3 IDENTIFIER_SEARCH

Use for:

- DOI
- report number
- policy number
- case number
- document title
- product model
- other stable identifiers

Identifiers should receive high directness priority.

---

## 6.4 SEMANTIC_SEARCH

Use when no exact source or strong identifier exists.

Queries should still be generated from:

```text
entity
+ event / object
+ claim variable
+ time
+ scope
```

not merely from generic keywords.

---

## 6.5 BROAD_CORROBORATION

Use for claims where no single authoritative primary source is expected to exist.

Examples:

- broad market conditions
- technology adoption
- public trends
- social phenomena

The system may use multiple independent sources.

However:

> “multiple sources” must not mean “multiple reposts”.

Evidence Graph / provenance independence must remain authoritative.

---

## 6.6 PROVENANCE_SEARCH

Use when a candidate source contains an upstream citation such as:

```text
据 Reuters 报道
据警方通报
according to ...
reported by ...
转载自 ...
编译自 ...
```

This becomes especially important in P1 recursive provenance.

---

# 7. P0-3 — Target Compatibility Gate

## Objective

Solve the problem:

> “The search found a very precise official page, but it is the wrong official page.”

Do **not** solve this by hard-excluding all non-preferred source types.

Do **not** solve this by globally lowering media scores.

Do **not** solve this by increasing the authority weight.

Instead introduce a deterministic **Target Compatibility Gate** before normal ranking.

---

# 8. Critical Rule: No Hard Exclusion by Source Type

The user's project principle is:

> **宁漏判，不错杀**

Therefore:

```text
NOT ALLOWED:
if source.type !== preferredSource
    reject(source)
```

Also avoid:

```text
if source is media
    reject(source)
```

and:

```text
if source is official
    always promote(source)
```

All three are unsafe.

The system should instead calculate compatibility and apply:

- strong downgrade
- moderate downgrade
- neutral
- strong match

while retaining candidates whenever possible.

---

# 9. Target Compatibility Model

Target Compatibility should reuse existing scoring information rather than creating another giant scoring framework.

Recommended structure:

```js
targetCompatibility = {
  sourceTypeFit,
  entityFit,
  eventFit,
  scopeFit,
  temporalFit,
  directnessFit,
  overallFit,
  reasons
}
```

Of these, **eventFit is the new required dimension**.

The other dimensions should reuse or bridge to existing:

- entity
- scope
- temporal
- directness

logic.

---

# 10. Source Type Compatibility

Example:

Claim:

> “国家统计局发布 2025 年国民经济和社会发展统计公报”

Strong target:

```text
国家统计局
官方公报
stats.gov.cn
```

Weak target:

```text
地方政府统计公报
媒体转载
商业数据网站
```

But weak does not mean automatic rejection.

Apply a strong compatibility penalty.

---

# 11. Entity Fit

Reuse the existing entity resolution and entity matching logic.

Example:

Claim:

> “NASA announced ...”

Candidate:

> unrelated article about another American space organization

Even if the article contains the same keywords, entity fit should be low.

Entity fit must distinguish:

```text
same entity
related entity
same category
unrelated entity
```

Do not treat category similarity as entity identity.

---

# 12. Event Fit — NEW REQUIRED FIT

This is the major missing compatibility dimension.

The system currently has entity matching but can still retrieve:

> correct organization + correct document type + wrong event

Example:

Claim:

> “重庆市大足区人力资源和社会保障局发布关于某争议的通报”

Bad result:

> “重庆市大足区事业单位第一季度优秀人才招聘通报”

Both contain:

```text
重庆市大足区
人力资源和社会保障局
通报
```

but refer to different events.

Therefore:

```text
entity match ≠ event match
```

---

## 12.1 Event representation

Create a lightweight deterministic event representation.

Possible fields:

```js
event = {
  subject,
  action,
  object,
  location,
  date,
  involvedEntities,
  eventKeywords,
  identifiers
}
```

Do not require perfect event extraction.

It is sufficient to identify salient event anchors.

Examples:

```text
Russia + Iran + negotiations
```

or:

```text
Shenzhen + school uniforms + new scoring policy
```

or:

```text
Dazhu District + dispute + HR/social-security bureau + statement
```

---

## 12.2 Event fit calculation

Candidate should receive higher event fit when multiple event anchors match.

Possible deterministic signals:

```text
event entity overlap
event action overlap
event object overlap
location overlap
date/time overlap
unique event keyword overlap
identifier overlap
```

Do not rely on generic words such as:

```text
发布
通报
政策
表示
报道
```

as strong event evidence.

Generic document verbs should contribute very little.

---

# 13. Claim Variable Fit

This should be integrated with the existing directness/evidence logic.

This is essential for cases such as:

> “现在存储芯片价格大涨”

A candidate discussing:

> semiconductor technology development

is related.

A candidate discussing:

> semiconductor company stock prices

is also related.

But neither necessarily proves:

> chip prices increased sharply.

The system must identify the **claim variable**:

```text
subject: storage chips
variable: price
direction: increase
magnitude: sharp
time: current/recent
```

Then candidate compatibility should ask:

> Does this source actually contain evidence about the requested variable?

Examples:

| Candidate | Entity | Claim variable | Compatibility |
|---|---|---|---|
| chip technology article | yes | no | low |
| chip company stock article | partial | wrong variable | low |
| DRAM/NAND price report | yes | yes | high |
| market price index | yes | yes | high |

This does not require a new global scoring dimension if it can be integrated into the existing `directness` and `evidence` calculations plus target compatibility.

---

# 14. Scope Fit

Reuse the existing scope logic.

Examples:

```text
national claim
≠ local county evidence

global market claim
≠ single company evidence

Shenzhen policy
≠ national policy

school students
≠ all consumers
```

A local page can be highly authoritative but still have the wrong scope.

Again:

> Authority cannot compensate for scope mismatch.

---

# 15. Temporal Fit and temporalMode

This is the third P0 task.

The current system's temporal logic mainly behaves like:

```text
timeWindow
+
year difference
```

That is insufficient for dynamic claims.

---

# 16. TemporalMode as the Single Semantic Decision

Query Analyzer should determine the temporal semantics once.

Recommended:

```js
temporalMode = {
  type: "historical" | "current" | "recent" | "evolving" | "as_of" | "timeless",
  referenceTime,
  horizon,
  isDynamic
}
```

Exact representation may follow existing conventions.

The important point is:

> Do not allow QA and downstream scoring to independently invent temporal semantics.

---

# 17. Temporal Modes

## 17.1 historical

Example:

> “2019 年发生了什么？”

Older sources may be correct.

---

## 17.2 current

Example:

> “现在存储芯片价格大涨吗？”

Prefer the latest available evidence.

Old articles should receive a strong temporal downgrade even if otherwise relevant.

---

## 17.3 recent

Example:

> “最近发生了什么？”

Use a recent time horizon.

---

## 17.4 evolving

Use for changing facts:

- death toll
- injury count
- election counts
- market prices
- exchange rates
- ongoing military/political events
- active disasters
- changing policy implementation

The result should not simply be:

```text
true / false
```

It should represent a time state.

Example conceptual result:

```text
截至 2026-09-02 14:00，
最新可核实数字为 X。
```

The exact timestamp should come from available source metadata / retrieval time.

---

## 17.5 as_of

Example:

> “截至 8 月 30 日，死亡人数是多少？”

The system must respect the requested cutoff.

A source published after the cutoff should not silently replace the requested historical state.

---

## 17.6 timeless

Examples:

- mathematical facts
- stable definitions
- basic concepts

Temporal matching should have little influence.

---

# 18. Derive Existing Temporal Scoring from temporalMode

Do not create a second temporal ranking system.

Instead:

```text
temporalMode
     ↓
referenceTime / horizon / dynamic behavior
     ↓
existing temporalMatchScore
```

Thus the existing temporal dimension remains the final scoring dimension.

The new semantic layer determines **what “temporal relevance” means**.

---

# 19. Dynamic Claim Handling

For:

> “现在存储芯片价格大涨”

the system should prioritize:

1. current price data
2. recent market reports
3. industry pricing data
4. authoritative datasets
5. first-party market information
6. reputable analytical sources

and should strongly downgrade:

```text
10 years ago
5 years ago
generic technology background
unrelated stock price discussion
```

The system should preserve the distinction:

```text
article date
event date
data reference date
retrieval time
```

These are not necessarily the same.

---

# 20. Target Compatibility Scoring

Do not replace the existing 8-dimension score.

Instead use a compatibility layer before or alongside ranking.

Conceptually:

```js
candidate.targetCompatibility = evaluateTargetCompatibility(
  candidate,
  evidenceTarget,
  claim
);
```

Example output:

```js
{
  overallFit: 0.91,
  sourceTypeFit: 1.0,
  entityFit: 1.0,
  eventFit: 0.95,
  scopeFit: 1.0,
  temporalFit: 0.85,
  directnessFit: 0.90,
  reasons: [
    "official issuing agency",
    "same event",
    "same geographic scope",
    "current reporting period"
  ]
}
```

---

# 21. Compatibility Should Be a Strong Penalty / Gate, Not a Hard Filter

Recommended conceptual tiers:

```text
HIGH COMPATIBILITY
→ normal / positive treatment

MEDIUM COMPATIBILITY
→ moderate downgrade

LOW COMPATIBILITY
→ strong downgrade

VERY LOW COMPATIBILITY
→ near-bottom ranking
```

Only candidates that are fundamentally unusable for technical reasons may be removed, such as:

- malformed URL
- inaccessible candidate after repeated resolution
- exact duplicate
- explicit safety / system restriction
- impossible source identity

Do not remove candidates merely because they are not from the preferred source family.

---

# 22. Why This Solves the “Official but Wrong” Problem

Consider:

> “深圳市中小学启用新的校服评分政策”

Candidate A:

```text
Shenzhen official education bureau
old uniform policy from 20 years ago
```

Candidate B:

```text
media article from last week
describes the new policy
```

A simple authority-first system may rank A too highly.

A simple relevance-first system may rank B.

The new system evaluates:

```text
A:
sourceTypeFit = high
entityFit = high
eventFit = low
temporalFit = very low
→ strong downgrade

B:
sourceTypeFit = medium
entityFit = high
eventFit = high
temporalFit = high
→ remains competitive
```

If provenance tracing later finds the official policy behind B:

```text
B media
   ↓
official education bureau policy
```

then the official source becomes the preferred root evidence.

This is the desired behavior.

---

# 23. P0-4 — Preserve Existing 8-Dimension Scoring

Do not globally modify:

```text
authority
relevance
directness
entity
scope
temporal
originality
evidence
```

unless testing demonstrates a concrete regression.

The current problems are primarily caused by:

```text
wrong evidence target
+
weak event matching
+
weak temporal semantics
+
strategy conflicts
```

not by the fact that the weights are numerically wrong.

---

# 24. Preferred Source Bonus Must Be Unified

There are currently two concepts resembling `preferredSources`:

1. Query Analyzer strategy preferred sources
2. Evidence Target preferred sources

This is dangerous because they can diverge.

The system should eventually have one authoritative field:

```js
evidenceTarget.preferredSources
```

The scoring bonus should be derived from that.

For backward compatibility, if the old QA field remains:

```js
qa.strategy.preferredSources
```

it must not independently add a competing bonus.

Recommended transition:

```js
effectivePreferredSources =
    evidenceTarget.preferredSources
```

and only use QA's value as fallback / diagnostics during migration.

---

# 25. Current Page Should Become a Candidate — P1

After P0 is stable, make the current page itself a first-class evidence candidate.

Current behavior mainly uses page context to extract explicit links.

That is insufficient.

The current page should be represented in the Evidence Graph as something like:

```js
{
  sourceKind: "CURRENT_PAGE",
  url,
  title,
  publisher,
  publishedAt,
  capturedText,
  relation: "USER_CONTEXT"
}
```

It should be allowed to participate in:

- source tracing
- evidence extraction
- provenance
- final evidence binding

---

# 26. Current Page Is Not Automatically Truth

Important:

```text
current page ≠ authoritative source
```

It should be treated as:

```text
context source
+
candidate evidence
+
provenance entry point
```

Its authority still comes from Source Analyzer / Registry.

---

# 27. P1 — Separate Evidence Extraction from Verification

Current problem:

> A source contains explicit numbers, but Verify says there is no relevant data.

This indicates that:

```text
reading
+
evidence extraction
+
truth judgment
```

are too tightly coupled.

Introduce an intermediate structured representation.

---

# 28. Evidence Extraction

Before Verify, extract concrete evidence.

Recommended structure:

```js
{
  subject,
  predicate,
  value,
  unit,
  direction,
  magnitude,
  time,
  scope,
  sentence,
  locationInSource,
  sourceId
}
```

Example:

```js
{
  subject: "storage chip",
  predicate: "price",
  value: 35,
  unit: "%",
  direction: "increase",
  magnitude: "sharp",
  time: "2026-Q3",
  sentence: "...",
  sourceId: "E3"
}
```

The exact schema can be adapted to existing implementation.

---

# 29. Verify Engine Should Judge Evidence, Not Rediscover It

Verify should receive structured evidence and answer:

```text
Does this evidence support the claim?
Does it contradict the claim?
Is it insufficient?
Is the evidence about the same entity?
Is it about the same event?
Is it about the requested time?
Is it about the requested variable?
```

This avoids the situation where the model reads a long page and fails to notice an explicit numerical statement.

---

# 30. Distinguish Three Failures

The system must distinguish:

### A. No evidence found

```text
source does not contain relevant evidence
```

### B. Evidence extracted but insufficient

```text
evidence exists
but cannot establish the claim
```

### C. Evidence contradicts claim

```text
evidence directly conflicts with claim
```

These should not collapse into the same result.

---

# 31. P1 — Recursive Provenance

The existing provenance module is useful but currently behaves mainly as:

```text
Media A
  ↓
Reuters
  ↓
stop
```

The target behavior is:

```text
Media A
  ↓
Reuters
  ↓
Police statement
  ↓
Police official website
```

or:

```text
Media A
  ↓
Official X post
  ↓
Agency official page
```

---

# 32. Bounded Recursive Provenance

Do not implement unlimited recursion.

Recommended:

```js
maxDepth = 3
```

Possibly configurable later.

Example:

```text
depth 0 = current candidate
depth 1 = cited upstream source
depth 2 = upstream of upstream
depth 3 = root candidate
```

Stop when:

- authoritative primary source found
- no new upstream clue
- same source already visited
- confidence becomes too low
- depth limit reached

---

# 33. Provenance Search Should Use the Full Retrieval Architecture

Current provenance search reportedly relies heavily on Metaso.

It should eventually be able to use:

```text
Exa
+
Metaso
+
official-domain targeting
```

The exact engine allocation should come from the same Evidence Target / Search Plan system.

Do not create a separate provenance search architecture.

---

# 34. Provenance Extraction: Regex + LLM Fallback

Keep deterministic patterns for obvious cases:

```text
据 Reuters 报道
据警方通报
援引……
转载自……
编译自……
according to ...
reported by ...
```

Then add LLM fallback for less explicit formulations:

```text
消息人士称
知情人士透露
一名官员表示
根据此前发布的信息
```

The LLM should extract a **provenance clue**, not decide truth.

Example:

```js
{
  sourceName: "Reuters",
  sourceTypeHint: "media",
  citationText: "...",
  confidence: 0.92
}
```

Then deterministic search/verification resolves it.

---

# 35. Provenance Must Affect Evidence Independence

The existing Evidence Graph already has concepts such as:

```text
INDEPENDENT
SHARED_UPSTREAM
DERIVED
```

Preserve these.

Example:

```text
Reuters
   ↑
Media A
Media B
Media C
```

A, B and C are not three independent confirmations.

They may all derive from Reuters.

The final system should avoid presenting them as independent evidence.

---

# 36. Source Monoculture Problem

The system should explicitly distinguish:

```text
platform
publisher
content owner / claimed origin
```

Example:

```text
Platform: Tencent
Publisher: CCTV
Origin: CCTV
```

versus:

```text
Platform: Tencent
Publisher: another media account
Origin: CCTV repost
```

The second is not equivalent to retrieving CCTV's own original publication.

This should be strengthened in P2 after P0/P1.

---

# 37. P2 — Platform / Publisher / Origin Identity

Eventually extend Source Analyzer with explicit fields:

```js
{
  platform,
  publisher,
  contentOwner,
  claimedOrigin,
  identityType
}
```

The key distinction is:

```text
where the page is hosted
≠
who published it
≠
who originally created the content
```

This directly addresses:

> CCTV original content being returned through another media's third-party-platform repost.

---

# 38. URL Integrity — P2

Add stronger handling for:

```text
search URL
→ redirect URL
→ canonical URL
→ final content
```

Store:

```js
{
  requestedUrl,
  finalUrl,
  canonicalUrl,
  redirectChain,
  contentIdentity
}
```

If A redirects to B:

- do not silently claim A and B are the same source
- compare title / publisher / content identity
- mark the redirect relationship

If the final page is unrelated:

```text
sourceIntegrity = LOW
```

and downgrade it.

---

# 39. Retrieval Strategy for Social / Police / Court Statements

Do not assume the original source is always an ordinary webpage.

The search plan should recognize possible first-party channels:

```text
official website
press release
public information office
official social account
official statement
public records portal
court filing / docket
agency notice
```

For inaccessible social-media content:

1. search the named institution's official domain
2. search exact statement wording
3. search the statement date + institution
4. search official press-release pages
5. search reputable reports that explicitly cite the institution
6. trace those reports upstream

The objective is:

```text
social-media-originated claim
→ institutional identity
→ original statement if accessible
→ otherwise strongest upstream evidence
```

Do not treat social-media inaccessibility as proof that no primary evidence exists.

---

# 40. Academic Claims

Preserve the existing academic-specific behavior:

```text
original paper first
→ DOI / journal / publisher
→ repository
→ related academic discussion
```

If the current page contains an explicit original-paper link:

```text
extract it
→ normalize it
→ add as explicit source
→ prioritize direct retrieval
```

Do not allow generic academic commentary to outrank an identified original paper merely because it contains more matching keywords.

---

# 41. Example: Russia–Iran Negotiation Claim

For a claim such as:

> Russian president and Iranian president negotiated...

The search target should be:

```text
entities:
- Russian president
- Iranian president

event:
- negotiation / discussion

event context:
- diplomatic interaction

preferred source:
- official presidential / government source
```

A selected sentence mentioning only the Russian president should not cause the system to forget the Iran entity and event.

The claim representation must preserve surrounding context.

Target:

```text
PERSON_EVENT
```

rather than merely:

```text
PERSON
```

when the statement is about an interaction/event.

---

# 42. Context Package Improvements — P2

Current context is approximately:

```text
title
url
paragraph
surroundingText
```

The surrounding context is reportedly weak / empty in parts of the current implementation.

Improve it to include, where available:

```js
{
  title,
  url,
  paragraph,
  surroundingText,
  pagePublisher,
  publishedAt,
  pageDomain,
  selectionText,
  precedingParagraph,
  followingParagraph
}
```

Do not over-expand context unnecessarily.

The goal is to stabilize claim understanding, especially when a selected sentence contains only one side of a multi-entity event.

---

# 43. Final Decision Flow

After modifications, the intended logic should be:

```text
1. Capture user text / page context
2. Query Analyzer understands claim
3. Resolve entities
4. Determine temporalMode
5. Evidence Target determines evidence target
6. buildPlan translates target into search plan
7. Retrieve from Exa / Metaso / Zhihu / official domains
8. Normalize and deduplicate URLs
9. Source Analyzer identifies publisher / source type
10. Target Compatibility evaluates:
      - source type
      - entity
      - event
      - claim variable
      - scope
      - temporal
      - directness
11. Existing 8-dimension scoring ranks compatible candidates
12. Evidence Graph clusters reposts / provenance
13. Read Top candidates
14. Extract structured evidence
15. Recursively trace upstream sources where needed
16. Verify evidence against claim
17. Bind E1–E5
18. Final answer
19. If no sufficient evidence:
      force downgrade / uncertainty
```

---

# 44. What Must NOT Be Done

The Agent must not implement the following as shortcuts.

## 44.1 Do not simply lower media weight

Bad:

```text
media authority: 70 → 40
```

This may cause unrelated official pages to outrank highly relevant journalism.

---

## 44.2 Do not hard-exclude media

Some claims genuinely originate from media.

---

## 44.3 Do not hard-exclude non-preferred source types

A non-preferred source may contain the only useful evidence.

---

## 44.4 Do not simply increase temporal weight

The problem is not only weight.

The system needs to know whether the claim is:

```text
historical
current
recent
evolving
as-of
timeless
```

---

## 44.5 Do not add more search engines as the primary fix

More engines will mainly create:

```text
more related results
+
more reposts
+
more ranking noise
```

unless evidence targeting is fixed first.

---

## 44.6 Do not rebuild Evidence Target

It already exists.

Wire it into the pipeline.

---

## 44.7 Do not rebuild Provenance

It already exists.

Make it recursive and integrate it with the unified search plan.

---

## 44.8 Do not create another independent scoring system

Reuse existing:

```text
entity
scope
temporal
directness
evidence
originality
```

and add only the genuinely missing concept:

```text
event fit
```

Target Compatibility is a gating / penalty layer, not a replacement for the eight-dimensional scorer.

---

# 45. Implementation Order

## P0-A — Single Decision Authority

### Modify

- `query-analyzer.js`
- `evidence-target.js`
- `v25-pipeline.js`

### Goal

```text
QA = understand claim
ET = decide evidence target
buildPlan = translate ET into retrieval
```

### Acceptance criteria

- `et.targetType` affects plan
- `et.preferredSources` affects plan
- `et.searchStrategy` affects plan
- QA and ET cannot silently issue conflicting source strategies
- existing explicit URL / DOI behavior remains intact

---

# 46. P0-B — Target Compatibility

### Modify

- likely `scoring-engine.js`
- likely `source-analyzer.js`
- possibly `evidence-target.js`
- `v25-pipeline.js`

### Add

```text
evaluateTargetCompatibility()
```

### Required fits

```text
sourceTypeFit
entityFit
eventFit       ← new
scopeFit
temporalFit
directnessFit
claimVariableFit
```

`claimVariableFit` may be implemented as part of directness/evidence compatibility rather than becoming a permanent ninth scoring dimension.

### Acceptance criteria

The system must be able to distinguish:

```text
same institution + same document type + wrong event
```

from:

```text
same institution + same document type + same event
```

It must also distinguish:

```text
same entity + wrong variable
```

from:

```text
same entity + requested variable
```

---

# 47. P0-C — TemporalMode

### Modify

- `query-analyzer.js`
- temporal matching logic in `scoring-engine.js`
- any plan-building code that currently consumes `timeWindow`

### Acceptance criteria

The system can distinguish at least:

```text
historical
current
recent
evolving
as_of
timeless
```

For dynamic claims, final conclusions include a meaningful temporal state.

Example:

```text
截至 2026-09-02，最新可核实数据为……
```

rather than a timeless:

```text
是真的 / 是假的
```

---

# 48. P0-D — Regression Tests

Before P1, test at least these scenarios:

### Test 1 — Government report

Claim:

```text
2025年国民经济和社会发展统计公报
```

Expected:

```text
National Bureau of Statistics official report
```

must outrank:

```text
local county report
media summaries
```

when the national scope is explicit.

---

### Test 2 — Local official statement

Claim:

```text
Dazhu District Human Resources and Social Security Bureau issued a statement about event X
```

Expected:

```text
correct event statement
```

must outrank:

```text
same bureau + same document type + unrelated event
```

---

### Test 3 — Dynamic chip prices

Claim:

```text
现在存储芯片价格大涨
```

Expected:

```text
current price evidence
```

must outrank:

```text
generic semiconductor technology articles
stock-price articles
old market reports
```

---

### Test 4 — New school uniform policy

Expected:

```text
latest policy
```

must outrank:

```text
20-year-old official uniform document
```

even though the old document is highly authoritative.

---

### Test 5 — Russia–Iran negotiation

Different selections from the same article should produce substantially consistent:

```text
Russian president
Iranian president
negotiation event
```

rather than switching between:

```text
PERSON
```

and:

```text
PERSON_EVENT
```

based solely on which sentence was selected.

---

### Test 6 — Explicit academic source

If the page contains an original paper DOI/link:

```text
original paper
```

must be directly retrieved and prioritized.

---

### Test 7 — Repost monoculture

If five media pages all reproduce the same upstream report:

```text
they must not count as five independent confirmations
```

---

# 49. P1-A — Current Page as Evidence Graph Node

After P0 passes regression tests:

Modify:

- `v25-pipeline.js`
- `evidence-graph.js`
- `web-reader.js`
- possibly `analyzer.js`

Acceptance criteria:

- current page can be represented as a candidate source
- current page can participate in provenance tracing
- current page can provide evidence
- current page's authority is still independently analyzed

---

# 50. P1-B — Evidence Extraction

Add an intermediate structured evidence layer.

Likely module:

```text
evidence-extractor.js
```

or integrate into an existing module if architecture favors that.

Do not duplicate Verify logic.

Acceptance criteria:

- explicit numbers are extracted
- units are preserved
- subject is preserved
- date is preserved
- scope is preserved
- original sentence is preserved
- source location is preserved
- Verify receives structured evidence

---

# 51. P1-C — Recursive Provenance

Modify:

- `provenance.js`
- `v25-pipeline.js`
- search plan integration

Acceptance criteria:

```text
candidate
→ upstream clue
→ search
→ read upstream
→ extract next upstream clue
→ search again
```

with:

```text
maxDepth <= 3
```

and cycle detection.

---

# 52. P1-D — Provenance + Search Engine Integration

Do not let provenance use a completely separate search architecture.

It should inherit:

```text
Evidence Target
→ Search Plan
→ Exa / Metaso / official domain targeting
```

This ensures provenance follows the same source-quality principles as normal retrieval.

---

# 53. P2 — Identity and URL Integrity

Later improve:

```text
platform
publisher
contentOwner
claimedOrigin
canonicalUrl
redirectChain
contentIdentity
```

This directly addresses third-party-platform reposts and broken/redirected URLs.

---

# 54. Debugging / Observability Requirements

For every candidate, expose enough internal metadata to answer:

> Why did this source rank here?

Recommended debug object:

```js
{
  sourceId,
  targetType,
  targetCompatibility: {
    sourceTypeFit,
    entityFit,
    eventFit,
    claimVariableFit,
    scopeFit,
    temporalFit,
    directnessFit,
    overallFit
  },
  score: {
    authority,
    relevance,
    directness,
    entity,
    scope,
    temporal,
    originality,
    evidence
  },
  provenance: {
    depth,
    upstreamSource,
    independence,
    confidence
  },
  finalScoreReason
}
```

This is essential for diagnosing future regressions.

---

# 55. Decision Hierarchy

The final architecture should have an explicit hierarchy:

```text
Level 1 — Claim Understanding
    Query Analyzer

Level 2 — Evidence Target
    Evidence Target

Level 3 — Retrieval Planning
    buildPlan

Level 4 — Candidate Compatibility
    Target Compatibility

Level 5 — Candidate Ranking
    Existing 8-Dimension Scoring

Level 6 — Source Relationship
    Evidence Graph + Provenance

Level 7 — Concrete Evidence
    Evidence Extraction

Level 8 — Claim Judgment
    Verify Engine

Level 9 — Answer
    Final Drafting + Hard Validation
```

No lower layer should silently override a higher-level semantic decision.

For example:

```text
Scoring Engine
```

must not decide that a source is suitable merely because it has many keyword hits if:

```text
Evidence Target
```

says the candidate is for the wrong event.

Likewise:

```text
Source Analyzer
```

must not decide that “official” automatically means “correct evidence.”

---

# 56. Core Design Principle

The most important change is not a new model.

It is this:

```text
Before:

Query → Search → Rank → Verify

with several modules making partially independent decisions

After:

Query
  ↓
Claim
  ↓
Evidence Target
  ↓
Search Plan
  ↓
Target Compatibility
  ↓
Existing Ranking
  ↓
Evidence / Provenance
  ↓
Verify
```

The system should evolve from:

> **“找和问题有关的网页”**

to:

> **“先确定什么证据能够回答这个问题，再在候选来源中寻找最合适的证据，并沿来源关系追溯到上游。”**

---

# 57. Final Priority

Implement in exactly this order unless code inspection reveals a concrete dependency requiring adjustment:

```text
P0-1  Evidence Target becomes single strategy authority
      ↓
P0-2  Wire targetType / preferredSources / searchStrategy into buildPlan
      ↓
P0-3  Target Compatibility
      ├─ reuse entity
      ├─ reuse scope
      ├─ reuse temporal
      ├─ reuse directness
      └─ add eventFit
      ↓
P0-4  temporalMode
      ├─ historical
      ├─ current
      ├─ recent
      ├─ evolving
      ├─ as_of
      └─ timeless
      ↓
P0-5  Regression tests
      ↓
P1-1  Current page → Evidence Graph
      ↓
P1-2  Evidence Extraction → Verify
      ↓
P1-3  Recursive Provenance
      ↓
P1-4  Provenance uses unified retrieval architecture
      ↓
P2    Platform / Publisher / Origin + URL integrity
```

---

# 58. Success Criteria

After the modification, the system should demonstrate the following behavior:

### It should no longer behave like:

```text
“Search for related articles,
pick authoritative-looking pages,
then ask the model whether they seem relevant.”
```

### It should behave like:

```text
“Understand the claim,
determine the required evidence,
search for that evidence,
reject/downgrade wrong-event and wrong-variable matches,
identify the original/upstream source,
extract concrete evidence,
then verify the claim.”
```

The system's quality should therefore improve primarily through **decision consistency and evidence alignment**, not through:

- more model capability
- more engines
- more scoring dimensions
- aggressive source exclusion
- arbitrary weight tuning

---

# 59. Agent Execution Instructions

When implementing:

1. **Inspect the actual current code first.**
2. Do not assume the audit is perfectly synchronized with the repository.
3. Preserve existing public interfaces unless modification is necessary.
4. Prefer small, composable changes.
5. Do not duplicate existing functions.
6. Reuse existing entity/scope/temporal/directness logic wherever possible.
7. Add `eventFit` only where genuinely missing.
8. Do not hard-filter candidates by preferred source type.
9. Keep detailed debug information for every new compatibility decision.
10. Run the P0 regression cases before implementing P1.
11. If a change causes unrelated regressions, revert the global behavior and narrow the change to the relevant target type / claim mode.
12. Do not change the eight scoring weights merely to compensate for missing target compatibility.
13. Do not implement recursive provenance without depth/cycle controls.
14. Do not allow the LLM to directly decide final source ranking.
15. The final deterministic pipeline must remain responsible for candidate filtering/downgrading, ranking, deduplication, provenance relationships, and evidence binding.

---

## Final Architectural Principle

> **已有模块不是越多越好；关键是让它们形成闭环。**
>
> `Query Analyzer` 理解问题，
> `Evidence Target` 决定需要什么证据，
> `buildPlan` 决定去哪里找，
> `Target Compatibility` 判断找到的东西是否真的是目标，
> `Scoring Engine` 在合格候选中排序，
> `Provenance` 追溯来源，
> `Evidence Extraction` 提取事实，
> `Verify Engine` 判断证据是否支持主张。
>
> **不要继续堆功能。先把这条链真正接通。**
