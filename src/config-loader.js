// src/config-loader.js
const fs = require("fs");
const path = require("path");

/** JSON 안전 로더 */
function safeReadJSON(filePath, fallback) {
  try {
    const exists = fs.existsSync(filePath);
    // 🌟 디버깅 로그 추가
    console.log(
      `[config-loader] checking path: ${filePath}, exists: ${exists}`
    );
    if (!exists) return fallback;

    const raw = fs.readFileSync(filePath, "utf-8");
    console.log(`[config-loader] read bytes: ${raw.length}`);
    return JSON.parse(raw);
  } catch (e) {
    console.warn(`[config-loader] read fail: ${filePath}`, e.message);
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
  // 🌟 변경된 파일 이름 확인: pandabt-default-tokens.json
  const defaultFileName = "pandabt-default-tokens.json";
  const defaultSettingsPath = path.join(
    extensionPath,
    "config",
    defaultFileName
  );
  const fallback = { version: "0.0.0", tokens: {} };

  // fs로 읽기
  const rawFs = safeReadJSON(defaultSettingsPath, null);
  if (rawFs) {
    console.log(`[config-loader] Successfully loaded default configuration.`);
    return normalizeSettings(rawFs);
  }

  // 🌟 로딩 실패 시 로그
  console.warn(
    `[config-loader] FAILED to load default configuration. Using fallback. This is why the template is empty.`
  );

  // 최종 실패 → 빈 디폴트
  return normalizeSettings(fallback);
}

module.exports = {
  loadBaseConfiguration,
};
