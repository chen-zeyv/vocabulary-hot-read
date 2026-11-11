(() => {
  "use strict";

  // 轻量 Porter 词干器（Porter 1980 英文算法，内联实现，不引入依赖）。
  // 只用于“目标词是否在文章中出现”的比较，不追求语言学完备。
  function isConsonant(word, index) {
    const ch = word[index];
    if (ch === "a" || ch === "e" || ch === "i" || ch === "o" || ch === "u") return false;
    if (ch === "y") return index === 0 ? true : !isConsonant(word, index - 1);
    return true;
  }

  // measure：计算 [C](VC)^m[V] 中的 m。
  function measure(word) {
    let m = 0;
    let i = 0;
    const length = word.length;
    while (i < length && isConsonant(word, i)) i += 1;
    while (i < length) {
      while (i < length && !isConsonant(word, i)) i += 1;
      if (i >= length) break;
      while (i < length && isConsonant(word, i)) i += 1;
      m += 1;
    }
    return m;
  }

  function hasVowel(word) {
    for (let i = 0; i < word.length; i += 1) if (!isConsonant(word, i)) return true;
    return false;
  }

  function endsWithDoubleConsonant(word) {
    const length = word.length;
    return length >= 2 && word[length - 1] === word[length - 2] && isConsonant(word, length - 1);
  }

  function endsWithCvc(word) {
    const length = word.length;
    if (length < 3) return false;
    const last = word[length - 1];
    return isConsonant(word, length - 3)
      && !isConsonant(word, length - 2)
      && isConsonant(word, length - 1)
      && last !== "w" && last !== "x" && last !== "y";
  }

  const STEP2 = [
    ["ational", "ate"], ["tional", "tion"], ["enci", "ence"], ["anci", "ance"],
    ["izer", "ize"], ["bli", "ble"], ["alli", "al"], ["entli", "ent"], ["eli", "e"],
    ["ousli", "ous"], ["ization", "ize"], ["ation", "ate"], ["ator", "ate"],
    ["alism", "al"], ["iveness", "ive"], ["fulness", "ful"], ["ousness", "ous"],
    ["aliti", "al"], ["iviti", "ive"], ["biliti", "ble"], ["logi", "log"],
  ];
  const STEP3 = [
    ["icate", "ic"], ["ative", ""], ["alize", "al"], ["iciti", "ic"],
    ["ical", "ic"], ["ful", ""], ["ness", ""],
  ];
  // 长后缀在前，避免 "al" 抢先匹配 "ement" 之类的组合。
  const STEP4 = [
    "ement", "ance", "ence", "able", "ible", "ment", "ant", "ent", "ion", "ism",
    "iti", "ous", "ive", "ize", "ate", "al", "er", "ic", "ou",
  ];

  function replaceSuffix(word, rules, requiredMeasure) {
    for (const [suffix, replacement] of rules) {
      if (!word.endsWith(suffix)) continue;
      const stem = word.slice(0, word.length - suffix.length);
      return measure(stem) > requiredMeasure ? stem + replacement : word;
    }
    return word;
  }

  function porterStem(input) {
    let word = String(input).toLowerCase();
    if (word.length <= 2) return word;

    // Step 1a：复数
    if (word.endsWith("sses")) word = word.slice(0, -2);
    else if (word.endsWith("ies")) word = word.slice(0, -2);
    else if (word.endsWith("ss")) { /* 保持原样 */ }
    else if (word.endsWith("s")) word = word.slice(0, -1);

    // Step 1b：-ed / -ing
    let step1bApplied = false;
    if (word.endsWith("eed")) {
      const stem = word.slice(0, -3);
      if (measure(stem) > 0) word = `${stem}ee`;
    } else if (word.endsWith("ed") && hasVowel(word.slice(0, -2))) {
      word = word.slice(0, -2);
      step1bApplied = true;
    } else if (word.endsWith("ing") && hasVowel(word.slice(0, -3))) {
      word = word.slice(0, -3);
      step1bApplied = true;
    }
    if (step1bApplied) {
      if (word.endsWith("at") || word.endsWith("bl") || word.endsWith("iz")) {
        word += "e";
      } else if (endsWithDoubleConsonant(word) && !["l", "s", "z"].includes(word[word.length - 1])) {
        word = word.slice(0, -1);
      } else if (measure(word) === 1 && endsWithCvc(word)) {
        word += "e";
      }
    }

    // Step 1c：y -> i
    if (word.endsWith("y") && hasVowel(word.slice(0, -1))) word = `${word.slice(0, -1)}i`;

    word = replaceSuffix(word, STEP2, 0);
    word = replaceSuffix(word, STEP3, 0);

    // Step 4：去掉派生后缀（要求 m > 1）
    for (const suffix of STEP4) {
      if (!word.endsWith(suffix)) continue;
      const stem = word.slice(0, word.length - suffix.length);
      if (measure(stem) > 1) {
        if (suffix === "ion" && !["s", "t"].includes(stem[stem.length - 1])) break;
        word = stem;
      }
      break;
    }

    // Step 5a：去掉词尾 e
    if (word.endsWith("e")) {
      const stem = word.slice(0, -1);
      const stemMeasure = measure(stem);
      if (stemMeasure > 1 || (stemMeasure === 1 && !endsWithCvc(stem))) word = stem;
    }
    // Step 5b：去掉重复的 l
    if (word.endsWith("ll") && measure(word) > 1) word = word.slice(0, -1);

    return word;
  }

  // 只把明确的派生后缀归一，不在这里做屈折变化。
  // 归一后字面相等才在第 2 级命中，例如 resilience -> resilient。
  function normalizeDerivation(word) {
    // 词干不足 6 个字母时不归一，避免 currency/current、emergency/emergent 这类含义碰撞。
    // 复数形式必须先归一，否则 -ences / -encies 会在 Porter Step 1a 之后与单数落到不同词干。
    if (word.endsWith("ences") && word.length >= 11) return `${word.slice(0, -5)}ent`;
    if (word.endsWith("encies") && word.length >= 12) return `${word.slice(0, -6)}ent`;
    if (word.endsWith("ation") && word.length > 7) return `${word.slice(0, -5)}ate`;
    if (word.endsWith("ence") && word.length >= 10) return `${word.slice(0, -4)}ent`;
    if (word.endsWith("ency") && word.length >= 10) return `${word.slice(0, -4)}ent`;
    return word;
  }

  // 词形归一键：派生归一 + Porter 词干，再去掉残留的 -ate。
  function formKey(input) {
    let key = porterStem(normalizeDerivation(String(input).toLowerCase()));
    if (key.endsWith("ate") && key.length - 3 >= 4) key = key.slice(0, -3);
    return key;
  }

  // 第 4 级允许的“残留串”组合。残留串 = normalizeDerivation 后的小写词去掉词干后剩下的尾部。
  // 这张表故意很窄：只保留能由测试正例证明、且不会让任何反例通过的组合。
  // 表项超过 15 条时必须停下来复核，不能继续堆规则。
  const ALLOWED_RESIDUALS = [
    ["", "ed"],   // adapt / adapted：基形动词与过去式
    ["ate", ""],  // adaptation / adapt：-ation 名词与裸动词
    ["ate", "ed"],// adaptation / adapted（验收正例）
    ["ate", "ing"],// adaptation / adapting（验收正例）
    ["ate", "er"],// adaptation / adapter：-ation 名词与施事名词
    ["ate", "s"], // adaptation / adapts：-ation 名词与第三人称单数
  ];
  function residualKey(a, b) {
    return a <= b ? `${a}\u0000${b}` : `${b}\u0000${a}`;
  }
  const ALLOWED_RESIDUAL_KEYS = new Set(ALLOWED_RESIDUALS.map(([a, b]) => residualKey(a, b)));

  // 第 3 级：只认规则英语复数，且只允许“目标是单数、文章中是复数”这一方向。
  // -ed/-d、-ing、-er/-est、-ly 已全部移除：拼写层面无法区分
  // faster = fast + -er 与 brother = broth + -er，保留会制造大量假阳性。
  // 复数最小基形长度为 4；news -> new 只有 3 个字母，因此 news 不会被 new 满足。
  function pluralBasesOf(word) {
    const bases = new Set();

    // -ies -> -y，例如 energies -> energy。基形至少 4 个字母。
    if (word.endsWith("ies") && word.length >= 6) {
      const base = `${word.slice(0, -3)}y`;
      if (base.length >= 4) bases.add(base);
    }

    // 规则复数 -s，例如 climates -> climate；movies -> movie 也由这一支覆盖。
    // -ss 结尾保持原样；去掉 -s 后不足 4 个字母的基形不参与比较。
    if (word.endsWith("s") && !word.endsWith("ss") && word.length >= 5) {
      const base = word.slice(0, -1);
      if (base.length >= 4) bases.add(base);
    }

    return bases;
  }

  // 残留串必须能由“归一后字符串去掉词干前缀”得到；词干不是前缀时返回 null。
  // 例如 energy 的词干是 energi，不是 energy 的前缀，因此第 4 级直接不命中。
  function residualOf(word, stem) {
    const normalized = normalizeDerivation(word);
    return normalized.startsWith(stem) ? normalized.slice(stem.length) : null;
  }

  // 按词边界切分，保留文章中的原始大小写，用于回显实际词形。
  function tokenize(article) {
    return String(article == null ? "" : article)
      .split(/[^\p{L}\p{N}]+/u)
      .filter((token) => token.length > 0);
  }

  // 多词或含符号的目标词只做字面短语匹配（仍按词边界，不做子串或词形推理）。
  function isPhrasePresent(article, target) {
    const escaped = target.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s+/g, "\\s+");
    return new RegExp(`(^|[^\\p{L}\\p{N}_])${escaped}([^\\p{L}\\p{N}_]|$)`, "iu").test(String(article == null ? "" : article));
  }

  // 分级匹配，命中即停：1 精确 -> 2 派生等价 -> 3 规则复数 -> 4 受限词干残留。
  // 返回 tier 0 表示未命中；surface 是文章里的实际写法。
  function matchWord(article, word) {
    const target = String(word == null ? "" : word).trim();
    if (!target) return { matched: false, tier: 0, surface: "" };

    if (!/^[\p{L}\p{N}]+$/u.test(target)) {
      const matched = isPhrasePresent(article, target);
      return { matched, tier: matched ? 1 : 0, surface: matched ? target : "" };
    }

    const targetLower = target.toLocaleLowerCase();
    const tokens = tokenize(article);
    const lowered = tokens.map((token) => token.toLocaleLowerCase());

    // 第 1 级：整词完全相等（大小写不敏感）。
    const exactIndex = lowered.indexOf(targetLower);
    if (exactIndex >= 0) return { matched: true, tier: 1, surface: tokens[exactIndex] };

    // 目标词少于 4 个字母时只认第 1 级精确匹配：短词最容易被词干规则牵连（art/start、ice/notice）。
    if (targetLower.length < 4) return { matched: false, tier: 0, surface: "" };
    const targetNormalized = normalizeDerivation(targetLower);

    // 第 2 级：派生归一等价。
    for (let index = 0; index < lowered.length; index += 1) {
      if (normalizeDerivation(lowered[index]) === targetNormalized) {
        return { matched: true, tier: 2, surface: tokens[index] };
      }
    }

    // 第 3 级：文章中的规则复数还原后等于目标词。
    // 方向固定为目标单数 -> 文章复数，避免用复数目标反推一个独立短词。
    for (let index = 0; index < lowered.length; index += 1) {
      if (!/^\p{L}+$/u.test(lowered[index])) continue;
      if (pluralBasesOf(normalizeDerivation(lowered[index])).has(targetNormalized)) {
        return { matched: true, tier: 3, surface: tokens[index] };
      }
    }

    // 第 4 级：词干相同，且两侧残留串都在窄允许表内。
    const targetKey = formKey(targetLower);
    if (targetKey) {
      const targetResidual = residualOf(targetLower, targetKey);
      if (targetResidual !== null) {
        for (let index = 0; index < lowered.length; index += 1) {
          if (!/^\p{L}+$/u.test(lowered[index])) continue;
          if (formKey(lowered[index]) !== targetKey) continue;
          const tokenResidual = residualOf(lowered[index], targetKey);
          if (tokenResidual === null) continue;
          if (ALLOWED_RESIDUAL_KEYS.has(residualKey(targetResidual, tokenResidual))) {
            return { matched: true, tier: 4, surface: tokens[index] };
          }
        }
      }
    }

    return { matched: false, tier: 0, surface: "" };
  }

  // 保留原有导出签名：isWordPresent 只是 matchWord 的薄包装。
  function isWordPresent(article, word) {
    return matchWord(article, word).matched;
  }

  function reconcile(lesson, requestedWords) {
    const article = lesson && typeof lesson.article === "string" ? lesson.article : "";
    const results = requestedWords.map((word) => matchWord(article, word));
    const missing = requestedWords.filter((_, index) => !results[index].matched);
    lesson.uncoveredWords = missing;
    const details = new Map((lesson.targetWords || []).map((item) => [String(item.word).toLocaleLowerCase(), item]));
    lesson.targetWords = requestedWords.map((word, index) => {
      const old = details.get(word.toLocaleLowerCase()) || { word, glossZh: "模型未提供词义" };
      const result = results[index];
      return {
        ...old,
        word,
        used: result.matched,
        matchTier: result.tier,
        matchSurface: result.surface,
      };
    });
    return missing;
  }

  globalThis.LessonCoverage = Object.freeze({ isWordPresent, reconcile });
})();
