"use strict";
// 词汇热读：标签、目标词矩阵、题型分配的纯逻辑模块。
// 不访问 DOM、不发请求、不读写任何存储，可在 Node 下直接 require 做断言。

(function attach(root, factory) {
  const api = factory();
  if (typeof module === "object" && module && module.exports) module.exports = api;
  if (root) root.LearningOptions = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function buildOptions() {
  // 字符数按 Unicode 码点计（Array.from），不按 UTF-16 长度、不按编码字节。
  function countChars(value) {
    return Array.from(String(value == null ? "" : value)).length;
  }

  const TAG_MAX_LENGTH = 48;
  const TAG_LIMIT = 5;
  const QUERY_MAX_LENGTH = 128;

  // 9 组 33 个预设标签；组内顺序即界面顺序，日常放第一组。
  const TAG_GROUPS = [
    { name: "日常", tags: ["local community", "commuting", "campus life", "food and cooking", "neighborhood events"] },
    { name: "科技", tags: ["artificial intelligence", "consumer electronics", "cybersecurity", "space exploration", "robotics"] },
    { name: "科学", tags: ["climate science", "biomedical research", "energy transition", "ocean research"] },
    { name: "经济", tags: ["global economy", "financial markets", "jobs and employment", "international trade"] },
    { name: "体育", tags: ["football", "basketball", "Olympics", "tennis"] },
    { name: "文化", tags: ["film festivals", "music", "literature", "museums"] },
    { name: "健康", tags: ["public health", "nutrition", "mental health"] },
    { name: "教育", tags: ["higher education", "language learning", "education technology"] },
    { name: "旅行", tags: ["sustainable travel"] },
  ];

  function normalizeTag(value) {
    return String(value == null ? "" : value)
      .replace(/[\r\n\t]+/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  // 返回 { ok, reason, tags }：reason 取 added / duplicate / too-long / limit / empty。
  // 调用方根据 reason 决定提示文案；本函数不截断任何内容。
  function addTag(list, raw) {
    const current = Array.isArray(list) ? list.slice() : [];
    const tag = normalizeTag(raw);
    if (!tag) return { ok: false, reason: "empty", tags: current };
    if (countChars(tag) > TAG_MAX_LENGTH) return { ok: false, reason: "too-long", tags: current };
    const key = tag.toLowerCase();
    if (current.some((item) => normalizeTag(item).toLowerCase() === key)) return { ok: false, reason: "duplicate", tags: current };
    if (current.length >= TAG_LIMIT) return { ok: false, reason: "limit", tags: current };
    return { ok: true, reason: "added", tags: current.concat(tag) };
  }

  function removeTag(list, tag) {
    const key = normalizeTag(tag).toLowerCase();
    return (Array.isArray(list) ? list : []).filter((item) => normalizeTag(item).toLowerCase() !== key);
  }

  // 查询拼装：标签空格连接 + 地区 + after: 时间窗 + lang:en。
  // 未确认官方布尔 OR 语法，因此不插入 OR；多个标签一起参与检索，不保证每个都有结果。
  function buildQuery(tags, regionTerm, afterDate) {
    const cleaned = (Array.isArray(tags) ? tags : []).map(normalizeTag).filter(Boolean);
    const parts = cleaned.slice();
    let region = normalizeTag(regionTerm);
    // 标签与范围词重叠时去掉重复部分，避免 "local community local community" 这类关键词堆叠。
    const tagText = cleaned.join(" ").toLowerCase();
    if (region && tagText.includes(region.toLowerCase())) region = "";
    for (const tag of cleaned) {
      const tagLower = tag.toLowerCase();
      if (region.toLowerCase().startsWith(tagLower + " ")) region = region.slice(tag.length).trim();
    }
    if (region) parts.push(region);
    parts.push(`after:${afterDate}`, "lang:en");
    const query = parts.join(" ");
    const length = countChars(query);
    return {
      query,
      tags: cleaned,
      length,
      limit: QUERY_MAX_LENGTH,
      overLimit: length > QUERY_MAX_LENGTH,
    };
  }

  const LEVELS = ["A1", "A2", "B1", "B2", "C1", "C2"];
  const LEVEL_LABELS = {
    A1: "A1 · 入门",
    A2: "A2 · 基础",
    B1: "B1 · 中级",
    B2: "B2 · 中高级",
    C1: "C1 · 高级",
    C2: "C2 · 精通",
  };
  const LEVEL_OFFSET = { A1: -2, A2: -1, B1: 0, B2: 1, C1: 2, C2: 3 };

  const LENGTH_OPTIONS = [100, 140, 180, 220, 260, 300, 340];
  const DENSITIES = ["sparse", "normal", "dense"];
  const DENSITY_LABELS = { sparse: "稀疏", normal: "正常", dense: "密集" };

  // 基础矩阵：长度 × 密度 → 基础目标词数。
  const TARGET_MATRIX = {
    100: { sparse: 3, normal: 4, dense: 6 },
    140: { sparse: 3, normal: 5, dense: 7 },
    180: { sparse: 4, normal: 6, dense: 8 },
    220: { sparse: 5, normal: 8, dense: 11 },
    260: { sparse: 6, normal: 9, dense: 12 },
    300: { sparse: 7, normal: 10, dense: 13 },
    340: { sparse: 7, normal: 11, dense: 15 },
  };

  const MIN_TARGET = 3;
  const MAX_TARGET = 15;

  // 计算顺序：矩阵基础值 + 难度修正 → 四舍五入 → 限制到 3–15 → 不超过输入词数。
  function computeTargetCount(inputCount, level, length, density) {
    const numericLength = Number(length);
    const lengthKey = Object.prototype.hasOwnProperty.call(TARGET_MATRIX, numericLength) ? numericLength : 180;
    const row = TARGET_MATRIX[lengthKey];
    const densityKey = DENSITIES.indexOf(density) >= 0 ? density : "normal";
    const base = row[densityKey];
    const offset = Object.prototype.hasOwnProperty.call(LEVEL_OFFSET, level) ? LEVEL_OFFSET[level] : 0;
    let value = Math.round(base + offset);
    value = Math.min(MAX_TARGET, Math.max(MIN_TARGET, value));
    const available = Number.isFinite(Number(inputCount)) ? Math.max(0, Math.trunc(Number(inputCount))) : 0;
    return Math.min(value, available);
  }

  // 按输入顺序取前 X 个词；输入不足时全部使用。
  function selectTargetWords(words, level, length, density) {
    const all = Array.isArray(words) ? words.filter((word) => String(word || "").trim()) : [];
    const count = computeTargetCount(all.length, level, length, density);
    return { count, words: all.slice(0, count), allUsed: count === all.length };
  }

  const QUESTION_TOTAL = 5;
  const MIN_TYPES = 2;
  const MAX_TYPES = 5;
  const QUESTION_TYPES = [
    { id: "vocabulary", name: "词义辨析", desc: "目标词在本文语境中的含义" },
    { id: "collocation", name: "固定搭配", desc: "文中的搭配或常见共现" },
    { id: "detail", name: "细节定位", desc: "文中明确写出的事实" },
    { id: "reference", name: "指代理解", desc: "代词或名词短语指代什么" },
    { id: "causal", name: "因果与顺序", desc: "原因、结果与先后关系" },
    { id: "inference", name: "推断", desc: "依据文中信息可以推出的结论" },
    { id: "main_idea", name: "主旨与标题", desc: "段落或全文主旨、合适标题" },
    { id: "paraphrase", name: "同义替换", desc: "与文中句子意思最接近的表达" },
  ];
  const QUESTION_TYPE_IDS = QUESTION_TYPES.map((item) => item.id);
  const DEFAULT_QUESTION_TYPES = ["vocabulary", "detail", "inference"];

  function questionTypeName(id) {
    const found = QUESTION_TYPES.find((item) => item.id === id);
    return found ? found.name : String(id || "");
  }

  // 先保证所选题型每种至少 1 道，剩余题目按用户勾选顺序轮流分配。
  function allocateQuestionTypes(selected, total) {
    const count = Number.isInteger(total) ? total : QUESTION_TOTAL;
    const list = (Array.isArray(selected) ? selected : []).filter((id, index, all) => (
      QUESTION_TYPE_IDS.indexOf(id) >= 0 && all.indexOf(id) === index
    ));
    if (list.length < MIN_TYPES) throw new Error(`至少选择 ${MIN_TYPES} 种题型。`);
    if (list.length > MAX_TYPES) throw new Error(`最多选择 ${MAX_TYPES} 种题型。`);
    if (count < list.length) throw new Error("题目总数不足以覆盖所选题型。");
    const allocation = [];
    for (let i = 0; i < count; i += 1) {
      allocation.push(list[i % list.length]);
    }
    return allocation;
  }

  // 结构校验：题目数量、题型范围、每种至少一道、四个选项、答案下标、解析与原文依据。
  // 返回错误信息数组；空数组代表通过。JSON 合法不等于业务字段齐全，这里做业务校验。
  function validateQuestions(questions, article, selectedTypes) {
    const errors = [];
    if (!Array.isArray(questions) || questions.length !== QUESTION_TOTAL) {
      errors.push(`题目数量不是 ${QUESTION_TOTAL} 道。`);
      return errors;
    }
    const allowed = new Set((Array.isArray(selectedTypes) ? selectedTypes : []).filter((id) => QUESTION_TYPE_IDS.indexOf(id) >= 0));
    const seen = new Set();
    questions.forEach((question, index) => {
      const label = `第 ${index + 1} 题`;
      if (!question || typeof question !== "object") {
        errors.push(`${label}结构无效。`);
        return;
      }
      if (typeof question.type !== "string" || !allowed.has(question.type)) errors.push(`${label}题型不在已选范围内。`);
      else seen.add(question.type);
      if (typeof question.prompt !== "string" || !question.prompt.trim()) errors.push(`${label}题干缺失。`);
      if (!Array.isArray(question.options) || question.options.length !== 4
        || question.options.some((option) => typeof option !== "string" || !option.trim())) {
        errors.push(`${label}选项不完整。`);
      }
      if (!Number.isInteger(question.correctOption) || question.correctOption < 0 || question.correctOption > 3) {
        errors.push(`${label}答案字段无效。`);
      }
      if (typeof question.explanation !== "string" || !question.explanation.trim()) errors.push(`${label}缺少解析。`);
      if (typeof question.evidenceSentence !== "string" || !question.evidenceSentence.trim()) errors.push(`${label}缺少原文依据。`);
      else if (typeof article === "string" && article && article.indexOf(question.evidenceSentence) === -1) {
        errors.push(`${label}原文依据不在文章中。`);
      }
    });
    allowed.forEach((type) => {
      if (!seen.has(type)) errors.push(`缺少 ${questionTypeName(type)} 题型。`);
    });
    return errors;
  }

  // 候选中文翻译的可用性统计：只统计拿到标题或摘要译文的条目。
  // 返回 { total, ok, failed, level, message }；level 为 all / partial / none。
  function summarizeCandidateTranslations(total, translations) {
    const count = Math.max(0, Math.trunc(Number(total) || 0));
    const map = translations && typeof translations === "object" ? translations : {};
    let ok = 0;
    for (let index = 0; index < count; index += 1) {
      const item = map[index];
      if (!item || typeof item !== "object") continue;
      if (String(item.titleZh || "").trim() || String(item.summaryZh || "").trim()) ok += 1;
    }
    const failed = count - ok;
    const level = count > 0 && failed === 0 ? "all" : ok > 0 ? "partial" : "none";
    let message = "候选中文翻译暂不可用（不影响选候选与生成）";
    if (level === "all") message = "候选中文已显示。";
    else if (level === "partial") message = `候选中文部分可用：${ok} 条成功，${failed} 条失败；未翻译的卡片保留英文，不影响选候选与生成。`;
    return { total: count, ok, failed, level, message };
  }

  // ---------- 来源文章原图（第 18 轮） ----------
  // 只从 Fetch 返回的 Markdown 正文里提取原始图片地址：不生成图、不用图库、不下载图片字节。
  const IMAGE_LIMIT = 2;
  const IMAGE_ALT_MAX = 120;
  const CONTENT_SCAN_MAX = 400000;

  function isLikelyTrackingPixel(href) {
    const value = String(href == null ? "" : href).toLowerCase();
    if (/[?&](?:w|width|h|height)=1(?:&|$)/.test(value)) return true;
    return /(?:1x1|spacer\.(?:gif|png)|pixel\.(?:gif|png)|px\.(?:gif|png)|stats?\.(?:gif|png)|tracking-pixel|beacon\.(?:gif|png)|transparent\.(?:gif|png))/.test(value);
  }

  function normalizeImageUrl(raw, baseUrl) {
    const value = String(raw == null ? "" : raw).trim().replace(/^<|>$/g, "");
    if (!value) return null;
    if (/^(?:data|blob|javascript|file|about):/i.test(value)) return null;
    let resolved;
    try {
      resolved = baseUrl ? new URL(value, baseUrl) : new URL(value);
    } catch {
      return null;
    }
    if (resolved.protocol !== "https:") return null;
    if (resolved.username || resolved.password) return null;
    resolved.hash = "";
    return resolved.href;
  }

  // alt 太短、只是文件名或是 image / photo 一类空词时，宁可返回空字符串，也不给读屏制造噪音。
  function cleanImageAlt(raw) {
    const value = String(raw == null ? "" : raw).replace(/\s+/g, " ").trim();
    if (!value || value.length < 4) return "";
    if (/^(?:image|photo|picture|img|pic|figure)$/i.test(value)) return "";
    if (/^[^\s]+\.(?:jpe?g|png|gif|webp|avif|svg)$/i.test(value)) return "";
    const chars = Array.from(value);
    return chars.length > IMAGE_ALT_MAX ? chars.slice(0, IMAGE_ALT_MAX - 1).join("") + "…" : value;
  }

  // 返回 [{ url, alt }]，最多 IMAGE_LIMIT 张。相对地址按文章地址补全；非 HTTPS、跨域凭据、追踪像素与重复图片都丢弃。
  function extractSourceImages(content, baseUrl, limit) {
    const max = Number.isInteger(limit) && limit > 0 ? Math.min(limit, IMAGE_LIMIT) : IMAGE_LIMIT;
    const text = String(content == null ? "" : content).slice(0, CONTENT_SCAN_MAX);
    const found = [];
    if (!text) return found;
    const seen = new Set();
    const push = (href, alt) => {
      if (found.length >= max) return false;
      const url = normalizeImageUrl(href, baseUrl);
      if (!url || isLikelyTrackingPixel(url)) return false;
      let key;
      try {
        const parsed = new URL(url);
        key = (parsed.hostname + parsed.pathname).toLowerCase();
      } catch {
        return false;
      }
      if (seen.has(key)) return false;
      seen.add(key);
      found.push({ url, alt: cleanImageAlt(alt) });
      return true;
    };
    // 正文是 Markdown，也可能夹着原始 HTML 的 img 标签：两类图片先按原文出现位置合并，
    // 再按顺序取前两张，保证顺序与正文一致，而不是某一类写法优先。
    // 注释里的内容不属于正文，先替换成等长空格（保持下标不变），避免把注释中的 img 当成图片。
    const scan = text.replace(/<!--[\s\S]*?-->/g, (chunk) => " ".repeat(chunk.length));
    const candidates = [];
    const attrValue = (tag, name) => {
      const hit = new RegExp("(?:^|[\\s\"'/<])" + name + "\\s*=\\s*(?:\"([^\"]*)\"|'([^']*)')", "i").exec(tag);
      return hit ? hit[1] || hit[2] : "";
    };
    const firstSrcsetUrl = (value) => String(value || "").split(",")[0].trim().split(/\s+/)[0];
    const markdownPattern = /!\[([^\]]*)\]\(\s*<?([^)\s>]+)>?(?:\s+(?:"[^"]*"|'[^']*'|\([^)]*\)))?\s*\)/g;
    let match;
    while ((match = markdownPattern.exec(scan)) !== null) {
      candidates.push({ index: match.index, href: match[2], alt: match[1], single: true });
    }
    // <picture> 的 <source srcset> 只在内层 img 没有可用地址时兜底：内层 img 的 src 仍然优先。
    const pictureSources = [];
    const picturePattern = /<picture\b[^>]*>([\s\S]*?)<\/picture>/gi;
    while ((match = picturePattern.exec(scan)) !== null) {
      const sourceTag = /<source\b[^>]*>/i.exec(match[1]);
      if (!sourceTag) continue;
      const href = firstSrcsetUrl(attrValue(sourceTag[0], "srcset"));
      if (href) pictureSources.push({ start: match.index, end: match.index + match[0].length, href });
    }
    // 懒加载图片常把真实地址放在 data-src 一类属性里，src 只是占位图，所以懒加载属性排在 src 前面。
    const htmlPattern = /<img\b[^>]*>/gi;
    while ((match = htmlPattern.exec(scan)) !== null) {
      const tag = match[0];
      const alt = attrValue(tag, "alt");
      const sources = [];
      for (const name of ["data-src", "data-original", "data-lazy-src", "data-actualsrc"]) {
        const value = attrValue(tag, name);
        if (value) sources.push(value);
      }
      const src = attrValue(tag, "src");
      if (src) sources.push(src);
      const srcset = firstSrcsetUrl(attrValue(tag, "srcset"));
      if (srcset) sources.push(srcset);
      const picture = pictureSources.find((item) => match.index >= item.start && match.index < item.end);
      if (picture) sources.push(picture.href);
      if (sources.length) candidates.push({ index: match.index, href: sources, alt, single: false });
    }
    candidates.sort((a, b) => a.index - b.index);
    for (const item of candidates) {
      if (found.length >= max) break;
      const sources = item.single ? [item.href] : item.href;
      for (const source of sources) {
        if (push(source, item.alt)) break;
      }
    }
    return found;
  }
  return {
    countChars,
    TAG_MAX_LENGTH,
    TAG_LIMIT,
    QUERY_MAX_LENGTH,
    TAG_GROUPS,
    normalizeTag,
    addTag,
    removeTag,
    buildQuery,
    LEVELS,
    LEVEL_LABELS,
    LEVEL_OFFSET,
    LENGTH_OPTIONS,
    DENSITIES,
    DENSITY_LABELS,
    TARGET_MATRIX,
    MIN_TARGET,
    MAX_TARGET,
    computeTargetCount,
    selectTargetWords,
    QUESTION_TOTAL,
    MIN_TYPES,
    MAX_TYPES,
    QUESTION_TYPES,
    QUESTION_TYPE_IDS,
    DEFAULT_QUESTION_TYPES,
    questionTypeName,
    allocateQuestionTypes,
    validateQuestions,
    summarizeCandidateTranslations,
    IMAGE_LIMIT,
    extractSourceImages,
  };
});
