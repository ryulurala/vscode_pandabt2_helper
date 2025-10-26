// pandabt/pandabt-settings.js
const fs = require("fs");
const path = require("path");

/**
 * 이 파일과 같은 폴더(pandabt)에
 *   - pandabt.default.tokens.json
 * 이 반드시 포함되어야 합니다.
 * VSIX 패키징 시 .vscodeignore에 빠지지 않도록 확인하세요.
 */

const defaultSettingsPath = path.join(__dirname, "pandabt.default.tokens.json");

/** JSON 안전 로더 + 디버그 로그 */
function safeReadJSON(filePath, fallback) {
  try {
    const exists = fs.existsSync(filePath);
    console.log("[pandabt-settings] path:", filePath, "exists:", exists);
    if (!exists) return fallback;

    const raw = fs.readFileSync(filePath, "utf-8");
    console.log("[pandabt-settings] read bytes:", raw.length);
    return JSON.parse(raw);
  } catch (e) {
    console.warn("[pandabt-settings] read fail:", filePath, e.message);
    return fallback;
  }
}

/** { version, tokens:{...} } → { version, defaultTokens: Array, defaultColors: Map } 로 정규화 */
function normalizeSettings(json) {
  const version = typeof json?.version === "string" ? json.version : "0.0.0";
  const tokensObj = json && typeof json.tokens === "object" ? json.tokens : {};

  const tokens = []; // [{ type, match, flags? }]
  const colors = {}; // { [type]: { foreground?, fontStyle? } }

  for (const [type, def] of Object.entries(tokensObj)) {
    if (!def || typeof def.match !== "string") continue;

    // 토큰(정규식 룰)
    const one = { type, match: def.match };
    if (typeof def.flags === "string") one.flags = def.flags;
    tokens.push(one);

    // 색상
    const style = {};
    if (typeof def.foreground === "string") style.foreground = def.foreground;
    if (typeof def.fontStyle === "string") style.fontStyle = def.fontStyle;
    if (Object.keys(style).length) colors[type] = style;
  }

  return { version, defaultTokens: tokens, defaultColors: colors };
}

/** 1차 fs, 2차 require fallback */
function loadDefaults() {
  const fallback = { version: "0.0.0", tokens: {} };

  // 1) fs로 읽기
  const rawFs = safeReadJSON(defaultSettingsPath, null);
  if (rawFs) return normalizeSettings(rawFs);

  // 2) require fallback
  try {
    const json = require("./pandabt.default.tokens.json");
    console.log("[pandabt-settings] loaded via require() fallback");
    return normalizeSettings(json);
  } catch (e) {
    console.warn("[pandabt-settings] require fallback failed:", e.message);
  }

  // 실패 → 빈 디폴트
  return normalizeSettings(fallback);
}

const { version, defaultTokens, defaultColors } = loadDefaults();

module.exports = {
  version,
  defaultTokens, // [{ type, match, flags? }]
  defaultColors, // { [type]: { foreground?, fontStyle? } }
};
