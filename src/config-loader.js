// src/config-loader.js
const fs = require("fs");
const path = require("path");

/** JSON 안전 로더 */
function safeReadJSON(filePath, fallback) {
  try {
    const exists = fs.existsSync(filePath);
    console.log("[config-loader] path:", filePath, "exists:", exists);
    if (!exists) return fallback;

    const raw = fs.readFileSync(filePath, "utf-8");
    console.log("[config-loader] read bytes:", raw.length);
    return JSON.parse(raw);
  } catch (e) {
    console.warn("[config-loader] read fail:", filePath, e.message);
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

/** 기본 설정 파일 로드 */
function loadBaseConfiguration(extensionPath) {
  const defaultSettingsPath = path.join(
    extensionPath,
    "config",
    "pandabt-default-tokens.json"
  );
  const fallback = { version: "0.0.0", tokens: {} };

  // fs로 읽기
  const rawFs = safeReadJSON(defaultSettingsPath, null);
  if (rawFs) return normalizeSettings(rawFs);

  // 실패 → 빈 디폴트
  return normalizeSettings(fallback);
}

module.exports = {
  loadBaseConfiguration,
};
