# Business knowledge selection spec

## Status

Implemented / current state.

## Goal

Before the SQL agent runs, pick the handful of predefined business/database
knowledge items most relevant to the user's question and inject them into the SQL
agent's context, so the agent reasons with domain rules it would otherwise have
to infer or miss. Selection is by a small LLM "selector" agent over a predefined
catalog; the result is injected silently (no UI surface) the same way the current
date is injected today.

## Background: where knowledge lives today

There are already three distinct knowledge channels. This feature adds a fourth
and slots cleanly beside them — it does **not** replace any of them.

| Channel                                     | Source                                                                                                      | Scope                                                         | When present                       |
| ------------------------------------------- | ----------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------- | ---------------------------------- |
| Schema comments                             | DB-native `COMMENT ON` read live by `introspect-database` (seeded by `data/scripts/import-retail-data.mjs`) | Per-table / per-column descriptions                           | Whenever the agent introspects     |
| Global invariants                           | Static text in `sql-agent.ts` instructions (`## Business Knowledge`, `## SQL Guidelines`)                   | Always-true safety/craft rules                                | Every turn                         |
| Discovery queries                           | `execute-sql` run by the agent                                                                              | Concrete live values (distinct categories, matching malls, …) | When the agent chooses to discover |
| **Selected business knowledge (this spec)** | Predefined catalog, top-N picked per question                                                               | Cross-column/table reasoning, domain conventions, strategies  | Every turn (re-selected)           |

The catalog is for higher-order knowledge that a single column comment cannot
carry: disambiguation strategies, metric definitions, join recipes, value
conventions, and data gotchas.

## Design overview

```
/api/chat (per turn)
  ├─ extract latest user question text from params.messages
  ├─ business-knowledge-agent.select(question, catalog)  → up to 5 item ids
  │     └─ on error → [] (global invariants still cover safety)
  ├─ map ids → full item bodies → render markdown block
  ├─ requestContext.set("businessKnowledge", renderedBlock)   // like currentDate
  └─ handleChatStream({ agentId: "sql-agent", requestContext, … })
        └─ sql-agent.instructions(requestContext) renders, in order:
              · global invariants (static)                     ← always
              · "## 相关业务知识" + injected selected items     ← from context
```

Decisions (from design review):

- **Placement: route-level injection (C1).** The selector runs in
  `app/api/chat/route.ts`; its output reaches the agent through `RequestContext`,
  reusing the exact channel `currentDate` already uses. No workflow rewire, no
  change to the HITL clarify cycle.
- **Selector: LLM agent (A).** The catalog is small and predefined, so an agent
  that reads it and returns ids is the simplest engine. The catalog shape leaves
  room to add vector retrieval later without changing the selector's interface.
- **Visibility: hidden context.** The selection is not rendered in the UI;
  inspect it via Langfuse traces. No frontend change.
- **Migration: global vs contextual split.** Safety/correctness invariants stay
  always-on in the prompt; only entity/metric/strategy items move into the
  selectable catalog.

## Knowledge base module

Proposed location: `mastra/knowledge/` (data + types + a loader). For v1 the
catalog is a TypeScript/JSON module, version-controlled like the import script's
column specs — no new infrastructure.

Item shape:

```ts
type BusinessKnowledgeItem = {
  id: string;          // stable slug, e.g. "mall-name-disambiguation"
  title: string;       // short human label, rendered into the injected block
  type:                // category — used for selection diversity + grouping
    | "glossary"
    | "join-rule"
    | "metric-definition"
    | "data-caveat"
    | "disambiguation";
  body: string;        // the guidance handed to the SQL agent (Simplified Chinese)
  keywords: string[];  // relevance hints (商圈, 业态, 城市等级, area, …)
  tables?: string[];   // related tables/columns, for scoring + future display
};
```

The catalog holds **contextual (selectable) items only**. Global invariants stay
in the SQL agent prompt, so "the selector's catalog" equals "the knowledge base"
— one selection channel, no second always-on injection path. (Alternative
considered: keep everything in the module behind a `criticality: global |
contextual` flag and have the route always inject globals + selected contextual.
Rejected for v1 as a needless second injection channel.)

## Selector agent (`business-knowledge-agent`)

- New agent `mastra/agents/business-knowledge-agent.ts`, registered in
  `mastra/index.ts` so its spans are exported.
- Model `openrouter/moonshotai/kimi-k2.6`, `temperature: 0`, no tools,
  `maxSteps: 1`, provider sort `throughput`. (Model choice is the main latency
  lever — see tradeoffs.)
- **Input:** the latest user question + a compact catalog (`id` + `title` +
  `type` + `keywords`, not full bodies, to keep tokens low). `type` lets the
  prompt nudge for a diverse pick rather than five near-duplicate items.
- **Output (structured):** `{ selectedIds: string[] }`, capped at 5. The route
  filters returned ids against known catalog ids and dedupes.
- **Fallback:** any failure (generation error, invalid output, timeout) →
  `selectedIds: []`. With globals always in the prompt, an empty selection is
  safe (degrades to today's behavior), so there is no generic-placeholder
  fallback like clarify has.

## Route integration (`app/api/chat/route.ts`)

1. Extract the latest user-question text from `params.messages` (AI SDK v6
   messages are parts arrays — read the last `role: "user"` message's text
   parts; ignore tool-result resume messages).
2. Call the selector; map ids → full bodies → render a markdown block.
3. `requestContext.set("businessKnowledge", renderedBlock)` alongside the
   existing `currentDate`.
4. Attach `userId`/`sessionId` to the selector call's tracing metadata, matching
   `handleChatStream`'s metadata, so the selection span nests under the request.

**Re-inject every turn (correctness, not an optimization choice).** Instructions
are recomputed per request and are _not_ part of message history, so the selected
knowledge must be re-injected on every turn — including clarify-resume and
regenerate. Skipping selection on resume would drop the knowledge mid-flow. v1
therefore runs the selector each turn; see future work for a client-cache
optimization that avoids the repeat call without dropping the injection.

## SQL agent integration (`mastra/agents/sql-agent.ts`)

- `instructions(requestContext)` reads `businessKnowledge` and, when non-empty,
  renders a `## 相关业务知识` section after the global invariants. When empty, the
  section is omitted entirely.
- The current `## Business Knowledge` bullets are split: globals stay; contextual
  bullets move to the catalog (see migration table below).
- **Fix the stale bullet:** the current prompt says _"stores currently does not
  have store area data"_ — this is wrong. `stores.area` exists (`numeric`, 门店面积，
  可能为空; see `import-retail-data.mjs`). The catalog item `area-columns` replaces
  it with the correct rule.
- The prompt gains no awareness of the `cities` table today; catalog items
  `store-mall-city-join` and `city-tier-region` close that gap.

### Migration of today's static knowledge

| Today's bullet                                      | Destination                                                  |
| --------------------------------------------------- | ------------------------------------------------------------ |
| `city` values end with "市"                         | **Global** (also already in the `malls.city` schema comment) |
| `stores` unique stores, `malls` unique malls        | **Global** (extend: `cities` unique cities)                  |
| Malls may have different names → fuzzy + clarify    | **Catalog** `mall-name-disambiguation`                       |
| Brands may have multiple product lines/SKUs → fuzzy | **Catalog** `brand-multi-sku`                                |
| Category/industry phrase ≠ stored category values   | **Catalog** `category-phrase-mapping`                        |
| Area: malls has area, stores does not               | **Catalog** `area-columns` (corrected — stores _has_ area)   |

## Edge cases and tradeoffs

- **Latency.** One serial LLM call before the stream starts (before TTFB),
  bounded by `SELECTION_TIMEOUT_MS` (8s) combined with the request's abort signal
  so a stalled call can't consume the route's time budget. The main lever is the
  selector model; passing only `id`/`title`/`keywords` (not bodies) keeps the
  prompt small.
- **Selector misses a needed item.** Mitigated by the global/contextual split:
  anything required for safety/correctness is always-on and never subject to
  selection.
- **Multi-turn relevance.** Select on the latest user question for v1; the prior
  turns remain in the agent's own message history.
- **No UI transparency.** Hidden context by choice — the only way to see what was
  selected is Langfuse. Acceptable for v1.

## Observability

The selector runs in the route before streaming, so it emits its own root
`agent_run` trace rather than nesting under the SQL agent run. It carries the
same `userId`/`sessionId` metadata, so the two traces are correlated by metadata
(question → selected ids, then the SQL agent run). (Contrast: the clarify
fallback sub-agent loses explicit metadata because it runs in a display transform
without `requestContext`; the selector runs in the route, which has it.)

## Requirements

- Selection runs before the SQL agent and never blocks the turn: it is bounded by
  a timeout combined with the request's abort signal, and yields an empty
  selection on any error, timeout, or abort.
- Global safety/correctness invariants are never subject to selection.
- The injected block is re-applied every turn (resume and regenerate included).
- No selector-specific storage is introduced; Convex chat persistence is independent, and the HITL clarify cycle is untouched.
- The selector's catalog is the single source of contextual business knowledge
  (no duplication with the always-on prompt invariants).

## Non-goals / future work

- **Vector retrieval / hybrid rerank** for large catalogs (B/C from review).
- **UI surface** showing which knowledge was used (would touch
  `chain-of-thought.tsx` / `sql-tools.tsx` / `tool-fallback.tsx`).
- **Cached selection:** Convex already persists threads/messages and could cache
  selected ids per thread, passing them in `params` so
  the route reuses them on resume/regenerate and only re-runs the selector when
  the latest user question changes.
- **Selection eval set** (question → expected ids) to track selection quality.
- **Folding schema comments into the catalog** (kept separate for v1).

## Related specs

Kept in sync with this feature:

- `README.md` — indexes this spec.
- `app-architecture.md` — primary flow + components table (selector agent/module).
- `sql-agent-tools.md` — `requestContext.businessKnowledge` injection + two-layer knowledge.
- `api-streaming-observability.md` — pre-stream selector call + its tracing.

## Implemented files

- `mastra/knowledge/business-knowledge.ts` — catalog + `renderCatalogForSelector` / `renderBusinessKnowledge`.
- `mastra/agents/business-knowledge-agent.ts` — selector agent + `knowledgeSelectionSchema`.
- `mastra/knowledge/select-business-knowledge.ts` — `selectBusinessKnowledge` orchestrator (best-effort; "" on failure/timeout/abort; bounded by `SELECTION_TIMEOUT_MS` + request signal).
- `mastra/index.ts` — registers `businessKnowledgeAgent`.
- `app/api/chat/route.ts` — `getLatestUserQuestion` + pre-stream selection into `requestContext`.
- `mastra/agents/sql-agent.ts` — renders `## 相关业务知识` from `requestContext`; globals trimmed; stale `stores.area` rule removed.

---

## Appendix: knowledge base catalog

Contextual catalog the selector picks from (implemented in
`mastra/knowledge/business-knowledge.ts`). Globals (kept in the SQL agent prompt)
are listed first, then the selectable items.

### Global invariants (stay in the SQL agent prompt — not selectable)

- Generate only `SELECT` queries (already in `## SQL Guidelines`).
- `malls`, `stores`, `cities` each contain one row per mall / store / city.
- `city` values are formal names ending in "市".
- Use `ILIKE` + `%` for case-insensitive fuzzy text matching (already present).
- `id`/`sku` are internal identifiers, not customer-facing.
- Unless asked otherwise, exclude closed malls/stores (`close_date IS NULL`).
- `营业状态` (on both `malls` and `stores`) is raw, uncleaned data — discover its distinct values before filtering on it. (Folded in from the catalog because it applied to nearly every query.)

### Selectable catalog

15 items. The injected block renders each as `title` + `body`; the selector sees
`id` / `title` / `type` / `keywords` (+ `tables`) to choose. Bodies below are the
intended production text (Simplified Chinese).

#### `mall-name-disambiguation` — 商场名称重名与澄清

- **type** disambiguation · **tables** `malls(name, city, district)`
- **keywords** 商场, 名称, 重名, 简称, 哪个商场, 嘉里中心, 万达广场, 万象城, 大悦城, 印象城
- 商场名称常在不同城市重复或有简称（"嘉里中心""万达广场""万象城"都是多地连锁）。先用 `name ILIKE '%关键词%'` 查候选并带出 `city`、`district` 区分，再向用户澄清指的是哪个/哪些商场，确认后才用其 `id`/`name` 过滤；不要默认取第一个匹配。

#### `brand-multi-sku` — 品牌的多 SKU / 多产品线

- **type** disambiguation · **tables** `stores(brand_name, brand_name_cn, sku)`
- **keywords** 品牌, SKU, 产品线, 子品牌, 门店, brand
- 一个品牌可能有多条产品线，在 `stores` 中是多行（`brand_name`/`brand_name_cn` 重复、`sku` 不同）。用 `ILIKE` 同时模糊匹配中、英文品牌名以免遗漏；"某品牌有多少门店/在哪些商场"通常要跨该品牌所有 SKU 聚合，而非只看单行。

#### `category-phrase-mapping` — 业态/类别词到库值映射

- **type** disambiguation · **tables** `stores(category, category_cn)`
- **keywords** 类别, 业态, 品类, 时尚, 餐饮, 零售, 服饰, 化妆品, 奢侈品, 餐厅
- 用户口中的业态/品类词（"时尚""餐饮""轻奢"）很少正好等于库里的 `category_cn`/`category` 取值。先 `SELECT DISTINCT category_cn, category`（可带门店计数）发现真实取值，再向用户澄清要纳入哪些类别，避免漏选或错选。

#### `bilingual-name-columns` — 品牌与类别的中英文双列

- **type** glossary · **tables** `stores(brand_name, brand_name_cn, category, category_cn)`
- **keywords** 中英文, 英文名, 中文名, 品牌名, 类别
- 品牌名和类别都各有中文列（`brand_name_cn`/`category_cn`）和英文列（`brand_name`/`category`）。中文提问优先匹配 `_cn` 列，但为完整起见两列都用 `ILIKE`；展示给用户时用中文列。

#### `store-mall-city-join` — 门店→商场→城市连接路径

- **type** join-rule · **tables** `stores.mall_id→malls.id`, `malls.city→cities.city`
- **keywords** 关联, 连接, join, 城市, 省份, 城市等级, 大区, 地区, 区域
- `stores` 表本身没有地理列；地理维度都在 `malls`/`cities`。连接路径：`stores.mall_id → malls.id → malls.city → cities.city`。按城市/省份/城市等级/大区分析门店时，先连 `malls` 再连 `cities`。

#### `city-tier-region` — 城市等级与大区

- **type** glossary · **tables** `cities(城市等级, 大区)`
- **keywords** 城市等级, 一线, 新一线, 二线, 三线, 大区, 华东, 华南, 华北, 区域, 地区
- `cities` 有 `城市等级`（一线/新一线/二线…）和 `大区`（华东地区/华南地区…）两个分级维度。"一线城市的门店""华东地区的商场"需连到 `cities` 并按相应列过滤；过滤前先 `SELECT DISTINCT` 查看真实取值与写法。

#### `lifecycle-dates` — 开业/闭店日期与"目前在营"判断

- **type** data-caveat · **tables** `malls/stores.open_date`, `*.close_date`
- **keywords** 开业, 闭店, 停业, 新开, 关闭, 现存, 仍在营业, 时间范围, open_date, close_date
- `open_date`/`close_date` 为 DATE、可能为空（记录不全）。`close_date IS NULL` 表示未知或尚未停业/闭店。判断"目前仍在营业"优先用 `close_date IS NULL`（可再结合 `营业状态`）。"近一年开业""X 年新开"等相对时间用注入的当前日期解析。

#### `area-columns` — 商场与门店面积列

- **type** metric-definition · **tables** `malls.area`, `stores.area`
- **keywords** 面积, area, 平米, 平方米, 体量, 大小
- `malls.area`（商场面积）和 `stores.area`（门店面积）**都存在**，均为 `numeric`、单位来自原始数据、可能为空。求和/平均/排序时排除空值（`area IS NOT NULL`）；单位未知，避免跨表或跨来源盲目比较。（这取代了旧提示里"门店没有面积数据"的错误说法。）

#### `mall-rating-metrics` — 商场/商圈的算法评价标签

- **type** metric-definition · **tables** `malls(商场定位, 商场评级, 商圈评级)`
- **keywords** 商场定位, 商场评级, 商圈评级, 评级, 定位, 档次, 高端, 等级
- `商场定位`、`商场评级`、`商圈评级` 都是算法得出的评价标签（文本、非原始事实、可能为空）。按分类处理，过滤前先 `SELECT DISTINCT` 看取值；它们是评价指标，不要当作可加总的数值。

#### `trade-area-grouping` — 商圈作为分组维度

- **type** glossary · **tables** `malls(商圈, 商圈评级)`
- **keywords** 商圈, 商圈内, 同商圈, 区域商业, trade area
- `malls.商圈` 是商场所属商圈名称，可作分组/过滤维度（"某商圈有哪些商场/门店""各商圈商场数"），可能为空。门店所属商圈需经 `stores → malls` 取得；`商圈评级` 是对该商圈的算法评级（见 `mall-rating-metrics`）。

#### `developer-group` — 开发商集团

- **type** glossary · **tables** `malls(开发商集团)`
- **keywords** 开发商, 集团, 运营商, 华润, 万达, 凯德, 龙湖, 系
- `malls.开发商集团` 是商场开发商所属集团名称（如华润、万达、凯德、龙湖等），可能为空、命名可能不统一。"某集团/某系有多少商场"按此列分组或 `ILIKE` 过滤；注意空值与同一集团的不同写法。

#### `floor-uncleaned` — 楼层数据未清洗

- **type** data-caveat · **tables** `stores.floor`
- **keywords** 楼层, floor, 几层, 几楼, B1, F1, 负一层, 地下
- `stores.floor` 未完全清洗，格式不一（B1、F1、1层、L1 等混用）。避免精确等值过滤，用 `ILIKE`/模式匹配并预期噪声；若楼层是查询核心条件，先向用户澄清口径。

#### `store-vs-brand-count` — 门店数 vs 品牌数

- **type** metric-definition · **tables** `stores(brand_name_cn, sku)`
- **keywords** 数量, 多少, 几个, 门店数, 品牌数, 多少品牌, 统计, count, 去重
- `COUNT(*)` 数的是门店数（每行一个门店），不是品牌数。"有多少品牌"用 `COUNT(DISTINCT brand_name_cn)`；数产品线用 `COUNT(DISTINCT sku)`。"几个店"还是"几个品牌"不明确时先澄清。

#### `mall-store-aggregation` — 按商场聚合门店

- **type** join-rule · **tables** `stores.mall_id`, `malls.id`
- **keywords** 每个商场, 各商场, 门店数, 业态分布, 占比, 分组, 排名, top, 平均
- "每个商场的门店数/业态分布/品牌数"按 `stores.mall_id` 分组聚合，连 `malls` 取商场名展示。若结果需要包含 0 门店的商场（如"门店最少的商场"），用 `LEFT JOIN malls` 而非内连接，否则空商场会被过滤掉。

#### `province-vs-city` — 省份与城市口径

- **type** glossary · **tables** `malls.province`, `malls.city`, `cities`
- **keywords** 省份, 城市, province, 省, 直辖市
- `malls` 和 `cities` 都带 `province`，但 `city` 才是规范连接键（FK `malls.city → cities.city`）。需要城市等级/大区时经 `cities`；仅做省份/城市层面的商场统计可直接用 `malls.province`/`malls.city`。城市为以"市"结尾的正式名（全局规则）。
