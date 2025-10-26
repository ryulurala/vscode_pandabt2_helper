const fs = require("fs");
const path = require("path");

/**
 * 주어진 경로에서 JSON 파일을 안전하게 읽어옵니다.
 * 파일이 없거나 파싱에 실패하면 fallback 값을 반환합니다.
 * @param {string} filePath - 읽을 파일 경로
 * @param {any} fallback - 파일 읽기 실패 시 반환할 값
 * @returns {any} 파싱된 JSON 객체 또는 fallback 값
 */
function safeReadJSON(filePath, fallback) {
  try {
    const exists = fs.existsSync(filePath);
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

/**
 * 기본 설정 객체 ({ version, tokens:{...} })를 내부 사용 포맷
 * ({ version, defaultTokens: Array, defaultColors: Map })으로 정규화합니다.
 * @param {object | undefined} json - 로드된 원본 JSON 객체
 * @returns {{ version: string, defaultTokens: Array<object>, defaultColors: object }} 정규화된 설정 객체
 */
function normalizeSettings(json) {
  const version = typeof json?.version === "string" ? json.version : "0.0.0";
  const tokensObj = json && typeof json.tokens === "object" ? json.tokens : {};

  /** @type {Array<object>} */
  const tokens = []; // [{ type, match, flags? }]
  /** @type {object} */
  const colors = {}; // { [type]: { foreground?, fontStyle? } }

  for (const [type, def] of Object.entries(tokensObj)) {
    if (!def || typeof def.match !== "string") continue;

    // 1. 토큰 (정규식 룰)
    const one = { type, match: def.match };
    if (typeof def.flags === "string") one.flags = def.flags;
    tokens.push(one);

    // 2. 색상 (스타일)
    const style = {};
    if (typeof def.foreground === "string") style.foreground = def.foreground;
    if (typeof def.fontStyle === "string") style.fontStyle = def.fontStyle;
    if (Object.keys(style).length) colors[type] = style;
  }

  return { version, defaultTokens: tokens, defaultColors: colors };
}

/**
 * 확장 프로그램의 기본 설정 파일(pandabt-default-tokens.json)을 로드합니다.
 * @param {string} extensionPath - 확장 프로그램의 루트 경로
 * @returns {{ version: string, defaultTokens: Array<object>, defaultColors: object }} 기본 설정 데이터
 */
function loadBaseConfiguration(extensionPath) {
  const defaultFileName = "pandabt-default-tokens.json";
  const defaultSettingsPath = path.join(
    extensionPath,
    "config",
    defaultFileName
  );
  const fallback = { version: "0.0.0", tokens: {} };

  const rawFs = safeReadJSON(defaultSettingsPath, null);

  if (rawFs) {
    console.log(`[config-loader] Successfully loaded default configuration.`);
    return normalizeSettings(rawFs);
  }

  console.warn(
    `[config-loader] FAILED to load default configuration. Using fallback. This is why the template is empty.`
  );

  return normalizeSettings(fallback);
}

module.exports = {
  loadBaseConfiguration,
};
