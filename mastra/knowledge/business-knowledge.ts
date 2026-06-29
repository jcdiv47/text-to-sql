// Predefined business/database knowledge the selector agent picks from before the
// SQL agent runs. This catalog holds *contextual* (selectable) knowledge only —
// always-on safety/correctness invariants stay in the SQL agent prompt. See
// docs/specs/business-knowledge-selection.md.

export type BusinessKnowledgeType =
  | "glossary"
  | "join-rule"
  | "metric-definition"
  | "data-caveat"
  | "disambiguation";

export type BusinessKnowledgeItem = {
  /** Stable slug. */
  id: string;
  /** Short human label, rendered into the injected block. */
  title: string;
  /** Category — used for selection diversity and grouping. */
  type: BusinessKnowledgeType;
  /** The guidance handed to the SQL agent (Simplified Chinese). */
  body: string;
  /** Relevance hints the selector matches against. */
  keywords: string[];
  /** Related tables/columns, for scoring and future display. */
  tables?: string[];
};

export const businessKnowledgeCatalog: BusinessKnowledgeItem[] = [
  {
    id: "mall-name-disambiguation",
    title: "商场名称重名与澄清",
    type: "disambiguation",
    keywords: [
      "商场",
      "名称",
      "重名",
      "简称",
      "哪个商场",
      "嘉里中心",
      "万达广场",
      "万象城",
      "大悦城",
      "印象城",
    ],
    tables: ["malls(name, city, district)"],
    body: "商场名称常在不同城市重复或有简称（“嘉里中心”“万达广场”“万象城”都是多地连锁）。先用 `name ILIKE '%关键词%'` 查候选并带出 `city`、`district` 区分，再向用户澄清指的是哪个/哪些商场，确认后才用其 `id`/`name` 过滤；不要默认取第一个匹配。",
  },
  {
    id: "brand-multi-sku",
    title: "品牌的多 SKU / 多产品线",
    type: "disambiguation",
    keywords: ["品牌", "SKU", "产品线", "子品牌", "门店", "brand"],
    tables: ["stores(brand_name, brand_name_cn, sku)"],
    body: "一个品牌可能有多条产品线，在 `stores` 中是多行（`brand_name`/`brand_name_cn` 重复、`sku` 不同）。用 `ILIKE` 同时模糊匹配中、英文品牌名以免遗漏；“某品牌有多少门店/在哪些商场”通常要跨该品牌所有 SKU 聚合，而非只看单行。",
  },
  {
    id: "category-phrase-mapping",
    title: "业态/类别词到库值映射",
    type: "disambiguation",
    keywords: ["类别", "业态", "品类", "时尚", "餐饮", "零售", "服饰", "化妆品", "奢侈品", "餐厅"],
    tables: ["stores(category, category_cn)"],
    body: "用户口中的业态/品类词（“时尚”“餐饮”“轻奢”）很少正好等于库里的 `category_cn`/`category` 取值。先 `SELECT DISTINCT category_cn, category`（可带门店计数）发现真实取值，再向用户澄清要纳入哪些类别，避免漏选或错选。",
  },
  {
    id: "bilingual-name-columns",
    title: "品牌与类别的中英文双列",
    type: "glossary",
    keywords: ["中英文", "英文名", "中文名", "品牌名", "类别"],
    tables: ["stores(brand_name, brand_name_cn, category, category_cn)"],
    body: "品牌名和类别都各有中文列（`brand_name_cn`/`category_cn`）和英文列（`brand_name`/`category`）。中文提问优先匹配 `_cn` 列，但为完整起见两列都用 `ILIKE`；展示给用户时用中文列。",
  },
  {
    id: "store-mall-city-join",
    title: "门店→商场→城市连接路径",
    type: "join-rule",
    keywords: ["关联", "连接", "join", "城市", "省份", "城市等级", "大区", "地区", "区域"],
    tables: ["stores.mall_id→malls.id", "malls.city→cities.city"],
    body: "`stores` 表本身没有地理列；地理维度都在 `malls`/`cities`。连接路径：`stores.mall_id → malls.id → malls.city → cities.city`。按城市/省份/城市等级/大区分析门店时，先连 `malls` 再连 `cities`。",
  },
  {
    id: "city-tier-region",
    title: "城市等级与大区",
    type: "glossary",
    keywords: [
      "城市等级",
      "一线",
      "新一线",
      "二线",
      "三线",
      "大区",
      "华东",
      "华南",
      "华北",
      "区域",
      "地区",
    ],
    tables: ["cities(城市等级, 大区)"],
    body: "`cities` 有 `城市等级`（一线/新一线/二线…）和 `大区`（华东地区/华南地区…）两个分级维度。“一线城市的门店”“华东地区的商场”需连到 `cities` 并按相应列过滤；过滤前先 `SELECT DISTINCT` 查看真实取值与写法。",
  },
  {
    id: "lifecycle-dates",
    title: "开业/闭店日期与“目前在营”判断",
    type: "data-caveat",
    keywords: [
      "开业",
      "闭店",
      "停业",
      "新开",
      "关闭",
      "现存",
      "仍在营业",
      "时间范围",
      "open_date",
      "close_date",
    ],
    tables: ["malls/stores.open_date", "*.close_date"],
    body: "`open_date`/`close_date` 为 DATE、可能为空（记录不全）。`close_date IS NULL` 表示未知或尚未停业/闭店。判断“目前仍在营业”优先用 `close_date IS NULL`（可再结合 `营业状态`）。“近一年开业”“X 年新开”等相对时间用注入的当前日期解析。",
  },
  {
    id: "area-columns",
    title: "商场与门店面积列",
    type: "metric-definition",
    keywords: ["面积", "area", "平米", "平方米", "体量", "大小"],
    tables: ["malls.area", "stores.area"],
    body: "`malls.area`（商场面积）和 `stores.area`（门店面积）都存在，均为 `numeric`、单位来自原始数据、可能为空。求和/平均/排序时排除空值（`area IS NOT NULL`）；单位未知，避免跨表或跨来源盲目比较。",
  },
  {
    id: "mall-rating-metrics",
    title: "商场/商圈的算法评价标签",
    type: "metric-definition",
    keywords: ["商场定位", "商场评级", "商圈评级", "评级", "定位", "档次", "高端", "等级"],
    tables: ["malls(商场定位, 商场评级, 商圈评级)"],
    body: "`商场定位`、`商场评级`、`商圈评级` 都是算法得出的评价标签（文本、非原始事实、可能为空）。按分类处理，过滤前先 `SELECT DISTINCT` 看取值；它们是评价指标，不要当作可加总的数值。",
  },
  {
    id: "trade-area-grouping",
    title: "商圈作为分组维度",
    type: "glossary",
    keywords: ["商圈", "商圈内", "同商圈", "区域商业", "trade area"],
    tables: ["malls(商圈, 商圈评级)"],
    body: "`malls.商圈` 是商场所属商圈名称，可作分组/过滤维度（“某商圈有哪些商场/门店”“各商圈商场数”），可能为空。门店所属商圈需经 `stores → malls` 取得；`商圈评级` 是对该商圈的算法评级（见 mall-rating-metrics）。",
  },
  {
    id: "developer-group",
    title: "开发商集团",
    type: "glossary",
    keywords: ["开发商", "集团", "运营商", "华润", "万达", "凯德", "龙湖", "系"],
    tables: ["malls(开发商集团)"],
    body: "`malls.开发商集团` 是商场开发商所属集团名称（如华润、万达、凯德、龙湖等），可能为空、命名可能不统一。“某集团/某系有多少商场”按此列分组或 `ILIKE` 过滤；注意空值与同一集团的不同写法。",
  },
  {
    id: "floor-uncleaned",
    title: "楼层数据未清洗",
    type: "data-caveat",
    keywords: ["楼层", "floor", "几层", "几楼", "B1", "F1", "负一层", "地下"],
    tables: ["stores.floor"],
    body: "`stores.floor` 未完全清洗，格式不一（B1、F1、1层、L1 等混用）。避免精确等值过滤，用 `ILIKE`/模式匹配并预期噪声；若楼层是查询核心条件，先向用户澄清口径。",
  },
  {
    id: "store-vs-brand-count",
    title: "门店数 vs 品牌数",
    type: "metric-definition",
    keywords: ["数量", "多少", "几个", "门店数", "品牌数", "多少品牌", "统计", "count", "去重"],
    tables: ["stores(brand_name_cn, sku)"],
    body: "`COUNT(*)` 数的是门店数（每行一个门店），不是品牌数。“有多少品牌”用 `COUNT(DISTINCT brand_name_cn)`；数产品线用 `COUNT(DISTINCT sku)`。“几个店”还是“几个品牌”不明确时先澄清。",
  },
  {
    id: "mall-store-aggregation",
    title: "按商场聚合门店",
    type: "join-rule",
    keywords: ["每个商场", "各商场", "门店数", "业态分布", "占比", "分组", "排名", "top", "平均"],
    tables: ["stores.mall_id", "malls.id"],
    body: "“每个商场的门店数/业态分布/品牌数”按 `stores.mall_id` 分组聚合，连 `malls` 取商场名展示。若结果需要包含 0 门店的商场（如“门店最少的商场”），用 `LEFT JOIN malls` 而非内连接，否则空商场会被过滤掉。",
  },
  {
    id: "province-vs-city",
    title: "省份与城市口径",
    type: "glossary",
    keywords: ["省份", "城市", "province", "省", "直辖市"],
    tables: ["malls.province", "malls.city", "cities"],
    body: "`malls` 和 `cities` 都带 `province`，但 `city` 才是规范连接键（FK `malls.city → cities.city`）。需要城市等级/大区时经 `cities`；仅做省份/城市层面的商场统计可直接用 `malls.province`/`malls.city`。城市为以“市”结尾的正式名。",
  },
];

const MAX_SELECTED = 5;

const catalogById = new Map(businessKnowledgeCatalog.map((item) => [item.id, item]));

/**
 * Compact catalog handed to the selector: id/title/type/keywords only (no bodies)
 * to keep the selector prompt small while still letting it match on intent.
 */
export const renderCatalogForSelector = (): string =>
  businessKnowledgeCatalog
    .map((item) => `- ${item.id} — ${item.title} [${item.type}] — ${item.keywords.join("、")}`)
    .join("\n");

/**
 * Turns the selector's chosen ids into the markdown block injected into the SQL
 * agent context. Unknown ids are dropped, duplicates removed, and at most
 * MAX_SELECTED items are kept (in the selector's order, most relevant first).
 * Returns "" when nothing usable was selected.
 */
export const renderBusinessKnowledge = (ids: readonly string[]): string => {
  const seen = new Set<string>();
  const items: BusinessKnowledgeItem[] = [];

  for (const id of ids) {
    const item = catalogById.get(id);
    if (!item || seen.has(item.id)) continue;
    seen.add(item.id);
    items.push(item);
    if (items.length >= MAX_SELECTED) break;
  }

  return items.map((item) => `- **${item.title}**：${item.body}`).join("\n");
};
