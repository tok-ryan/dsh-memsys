/**
 * 检索词扩展（0.3.1）
 *
 * 背景：评测（docs/EVAL.md）发现检索是瓶颈——问「我挥霍 token 吗」，
 * 记忆里写的是「花钱谨慎／怕白费力气」，字面零交集，一条都捞不到；
 * 而 memsys_search 的 keywords 是**整句字符串**，检索层只做 includes(整句)，几乎永不命中。
 *
 * 做法：
 *   1. 把调用方的整句查询**切成分词**（标点/空白切分 + 汉字二元组 + 英文整词）；
 *   2. 用一张**通用域**的口语→书面语对照表做同义扩展（成本/作息/推荐/沟通……）；
 *   3. 私人实体（人名、作品名、公司名）**不进代码**：由宿主启动时注入 provider，
 *      从数据目录的 aliases.json 读取（文件不存在就当没有）。
 * 纯函数、零外部依赖、确定性；只放宽检索面，排序由调用方决定。
 *
 * 维护原则：只收真实踩过的坑（评测里的失败案例），不做模糊前缀匹配。
 */
import fs from 'node:fs';
import path from 'node:path';

/** 合并后的扩展词上限：防止把检索放宽成「什么都命中」。实测 12 最平衡。 */
const MAX_EXTRA = 12;

const HAN_OR_WORD = /[^\p{Script=Han}a-zA-Z0-9]+/gu;
const ASCII_WORD = /^[a-z0-9]+$/;

const normalize = (value) => String(value ?? '').normalize('NFKC').toLowerCase().trim();
const stripLiteral = (value) => normalize(value).replace(/[\p{P}\p{S}\s]/gu, '');

/** 通用域对照表：trigger 是口语里常见的说法，adds 是记忆正文里更可能出现的词。 */
const GENERIC_GROUPS = Object.freeze([
  {
    name: '钱/成本',
    triggers: ['挥霍', '浪费', '乱花', '烧钱', '费钱', '花钱', '花销', '开销', '钱', '费用', '贵', '投入', '成本', '预算'],
    adds: ['成本', '花费', '测算', '预算', '省钱', '白费', '力气', '效果', '零成本', '验证', '焦虑'],
  },
  {
    name: '作息/睡前',
    triggers: ['睡觉', '作息', '几点睡', '熬夜', '收工', '下班', '几点', '肩', '肩膀', '睡前'],
    adds: ['作息', '凌晨', '夜里', '下班', '一点多', '羽毛球', '肩膀', '休眠', '验收', '起床'],
  },
  {
    name: '视频/推荐',
    triggers: ['视频', '刷视频', '看视频', '抖音', '推荐', '推点', '挑视频', '唱歌', '音乐'],
    adds: ['B站', 'b站', '挑片', '音乐', '粤语', '翻唱', '跳过', '长草期', '推荐'],
  },
  {
    name: '沟通方式',
    triggers: ['帮我看看', '看看', '怎么回', '调研', '沟通', '回复', '先帮'],
    adds: ['给结果', '清单', '拍板', '结论', '简短', '别擅自', '调研', '动手'],
  },
  {
    name: '网页/页面',
    triggers: ['小网页', '网页', '页面', '前端', '网站', '配色'],
    adds: ['单文件', '配色', '圆角', '手机端', '米白'],
  },
  {
    name: '时间纪律',
    triggers: ['时间', '报点', '交接'],
    adds: ['时间敏感', '实时', '读时间'],
  },
  {
    name: '记忆/记事',
    triggers: ['记事', '记性', '记忆'],
    adds: ['记忆', '交接卡', '记事'],
  },
  {
    name: '对象/女友',
    triggers: ['对象', '女朋友', '老婆', '女友'],
    adds: ['女朋友', '女友', '异地', '属猴'],
  },
  {
    name: '八字',
    triggers: ['八字', '命理', '称呼'],
    adds: ['八字', '五行', '名字', '命理'],
  },
  {
    name: '工作',
    triggers: ['干啥活', '工作', '职业', '干啥'],
    adds: ['工程师', '上班', '创业', '项目'],
  },
  {
    name: '人格',
    triggers: ['人格', '性格', '人设'],
    adds: ['persona', '人格'],
  },
]);

/** @type {null | (() => unknown)} */
let aliasProvider = null;

/**
 * 注入私人别名来源。宿主在启动时接一次即可：
 *   setAliasProvider(() => loadAliases(config.dataDir));
 * 传 null 清除（测试用）。provider 抛错时按「没有别名」处理，绝不影响检索本身。
 */
export function setAliasProvider(fn) {
  aliasProvider = typeof fn === 'function' ? fn : null;
}

function sanitizeGroups(raw) {
  if (!Array.isArray(raw)) return [];
  const groups = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== 'object') continue;
    const triggers = Array.isArray(entry.triggers) ? entry.triggers.filter((v) => typeof v === 'string' && v.trim()) : [];
    const adds = Array.isArray(entry.adds) ? entry.adds.filter((v) => typeof v === 'string' && v.trim()) : [];
    if (triggers.length === 0 || adds.length === 0) continue;
    groups.push({ triggers, adds });
  }
  return groups;
}

/**
 * 读取 `<dataDir>/aliases.json` 里的私人别名组。
 * 文件不存在、JSON 损坏、结构不对 → 空数组（不影响功能）。
 * 期望结构：数组，每项 `{ "triggers": ["..."], "adds": ["..."] }`；也接受 `{ "groups": [...] }`。
 */
export function loadAliases(dataDir) {
  if (typeof dataDir !== 'string' || dataDir.length === 0) return [];
  try {
    const file = path.join(dataDir, 'aliases.json');
    if (!fs.existsSync(file)) return [];
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
    return sanitizeGroups(Array.isArray(parsed) ? parsed : parsed?.groups);
  } catch {
    return [];
  }
}

function activeAliasGroups() {
  if (typeof aliasProvider !== 'function') return [];
  try {
    const raw = aliasProvider();
    return sanitizeGroups(Array.isArray(raw) ? raw : raw?.groups);
  } catch {
    return [];
  }
}

/**
 * 把整句查询切成检索词：标点/空白切分；汉字取二元组（单字保留），ASCII 整词保留。
 * @param {string} input
 * @returns {string[]}
 */
export function tokenizeQuery(input) {
  const clean = normalize(input).replace(HAN_OR_WORD, ' ');
  const terms = [];
  const seen = new Set();
  const push = (term) => {
    if (!term || seen.has(term)) return;
    seen.add(term);
    terms.push(term);
  };
  for (const chunk of clean.split(/\s+/)) {
    if (!chunk) continue;
    if (ASCII_WORD.test(chunk)) {
      push(chunk);
      continue;
    }
    // 短块（≤5 字）多半就是一个词/短语，整块当检索词，别拆成二元组——
    // 拆了会让「点事件」这种词被「事件」误命中；长句才需要二元组保召回。
    if (chunk.length < 6) {
      push(chunk);
      continue;
    }
    for (let index = 0; index < chunk.length - 1; index += 1) {
      push(chunk.slice(index, index + 2));
    }
  }
  return terms;
}

function toQueryText(input) {
  if (Array.isArray(input)) return input.map((entry) => String(entry ?? '')).join(' ');
  return String(input ?? '');
}

/**
 * @param {string|string[]} input 用户原查询（整句或关键词数组）
 * @returns {{ terms: string[], added: string[] }} terms=切词结果，added=同义扩展词（去重保序、封顶）
 */
export function expandTerms(input) {
  const rawQuery = toQueryText(input);
  const terms = tokenizeQuery(rawQuery);
  const queryText = stripLiteral(rawQuery);
  const added = [];
  const seen = new Set(terms);

  const pushAdd = (value) => {
    const term = normalize(value);
    if (!term || seen.has(term)) return false;
    seen.add(term);
    added.push(term);
    return true;
  };

  const groups = [...GENERIC_GROUPS, ...activeAliasGroups()];
  for (const group of groups) {
    // 只做「原查询包含 trigger」这一向：反向会把「怎么」命中「怎么回」这类长 trigger。
    // 拿整句（去标点）判断，多字 trigger 也能命中，不依赖分词粒度。
    const hit = group.triggers.some((trigger) => {
      const needle = stripLiteral(trigger);
      return needle.length > 0 && queryText.includes(needle);
    });
    if (!hit) continue;
    for (const add of group.adds) {
      if (added.length >= MAX_EXTRA) return { terms, added };
      pushAdd(add);
    }
  }
  return { terms, added };
}

/** 给测试/调试看的通用组只读副本（不含私人别名）。 */
export function synonymGroups() {
  return GENERIC_GROUPS.map((group) => ({ name: group.name, triggers: [...group.triggers], adds: [...group.adds] }));
}
