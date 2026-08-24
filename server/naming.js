// 命名规则（PRD §5.2）与文本清洗
const ZERO_WIDTH = /[\u200B\u200C\u200D\uFEFF]/g;

/** 清洗 weread 文本：去零宽字符、规范空白（不改语义，只去不可见噪音） */
export function cleanText(s) {
  return String(s || "")
    .replace(ZERO_WIDTH, "")
    .replace(/\u00A0/g, " ")
    .trimEnd();
}

/** 文件名安全化：去掉 Windows 非法字符与乱码/控制字符，压缩空白，去首尾点和空格 */
export function sanitizeFilename(s) {
  const cleaned = cleanText(s)
    .replace(/[\u0000-\u001f\uFFFD]/g, "")
    .replace(/[\\/:*?"<>|]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[. ]+$/, "");
  // 清洗后若中文全部丢失（说明入参编码已损坏），拒绝而不是生成乱码文件名
  if (/[\u4e00-\u9fff]/.test(String(s)) && !/[\u4e00-\u9fff]/.test(cleaned)) {
    throw new Error("名称编码异常（中文全部丢失），已拒绝");
  }
  return cleaned;
}

/** 杂志紧凑式：《财经（2026年第18期）》→ 财经2026第18期 */
export function compactTitle(title) {
  return sanitizeFilename(
    String(title || "").replace(
      /[（(]\s*(\d{4})\s*年\s*第\s*(\d+)\s*期\s*[）)]/g,
      "$1第$2期"
    )
  );
}

/** 笔记主名：杂志用紧凑式，普通书用完整书名；超 80 字截断（PRD §5.2） */
export function noteStem(title) {
  const compact = compactTitle(title);
  const base = compact || sanitizeFilename(title);
  return base.length > 80 ? base.slice(0, 80) : base;
}

/** 笔记文件名 */
export function noteFilename(title) {
  return `${noteStem(title)}_读书笔记.md`;
}

/** 图片文件名：{书名主名}_{YYYYMMDD_HHmm}.png（PRD §5.2） */
export function imageFilename(title, ext = "png", date = new Date()) {
  const p = (n) => String(n).padStart(2, "0");
  const stamp = `${date.getFullYear()}${p(date.getMonth() + 1)}${p(date.getDate())}_${p(date.getHours())}${p(date.getMinutes())}`;
  return `${noteStem(title)}_${stamp}.${ext}`;
}

/** 手写笔记图片：确定性命名（同一 reviewId 恒同名，保证重同步幂等不重复下载） */
export function pencilImageName(title, reviewId, ext = "png") {
  const tail = String(reviewId || "").replace(/[^A-Za-z0-9]/g, "").slice(-6) || Date.now().toString(36);
  return `${noteStem(title)}_手写_${tail}.${ext}`;
}

/** 划线内容归一化键：去空白/零宽后取前 80 字，用于重同步时把用户批注挂回原划线 */
export function quoteKey(text) {
  return cleanText(text).replace(/\s+/g, "").slice(0, 80);
}

/** 中文数字（章节序号用，1→一，支持到 99） */
export function chineseNumeral(n) {
  const digits = ["零", "一", "二", "三", "四", "五", "六", "七", "八", "九"];
  if (n < 0 || !Number.isInteger(n)) return String(n);
  if (n < 10) return digits[n];
  if (n === 10) return "十";
  if (n < 20) return "十" + digits[n % 10];
  if (n < 100) {
    const t = digits[Math.floor(n / 10)] + "十";
    return n % 10 === 0 ? t : t + digits[n % 10];
  }
  return String(n);
}
