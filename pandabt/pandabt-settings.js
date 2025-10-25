// pandabt/pandabt-settings.js
const fs = require("fs");
const path = require("path");

/**
 * 이 파일과 같은 폴더(pandabt) 안에
 *   - pandabt.default.rules.json
 * 이 반드시 존재해야 합니다.
 *
 * VSIX에 포함되지 않으면 existsSync가 false가 되니,
 * .vscodeignore / packaging 설정을 점검하세요.
 */

const defaultSettingsPath = path.join(__dirname, "pandabt.default.rules.json"); // <= 핵심: 절대경로 간단화

/** JSON 안전 로더 + 디버그 로그 */
function safeReadJSON(filePath, fallback) {
  try {
    const exists = fs.existsSync(filePath);
    console.log("[pandabt-settings] path:", filePath, "exists:", exists);
    if (!exists) return fallback;

    const raw = fs.readFileSync(filePath, "utf-8");
    // 파일 내용 길이도 찍어서 빈 파일 여부 확인
    console.log("[pandabt-settings] read bytes:", raw.length);
    const json = JSON.parse(raw);
    return json;
  } catch (e) {
    console.warn("[pandabt-settings] read fail:", filePath, e.message);
    return fallback;
  }
}

/** 정규화된 데이터 구조 생성 */
function normalizeSettings(json) {
  const version = typeof json.version === "string" ? json.version : "0.0.0";
  const defaults =
    json && json.defaults && typeof json.defaults === "object"
      ? json.defaults
      : {};

  const rules = [];
  const colors = {};

  for (const [type, def] of Object.entries(defaults)) {
    if (!def || typeof def.match !== "string") continue;

    // 정규식 규칙 등록
    rules.push({ type, match: def.match });

    // 색상 스타일 등록
    const color = {};
    if (typeof def.foreground === "string") color.foreground = def.foreground;
    if (typeof def.fontStyle === "string") color.fontStyle = def.fontStyle;
    if (Object.keys(color).length) colors[type] = color;
  }

  return { version, defaultRules: rules, defaultColors: colors };
}

/** 1차: fs로 로드, 2차: require fallback(개발 환경에서 유용) */
function loadDefaults() {
  const fallback = { version: "0.0.0", defaults: {} };

  // 1) fs로 읽기
  const rawFs = safeReadJSON(defaultSettingsPath, null);
  if (rawFs) return normalizeSettings(rawFs);

  // 2) require fallback (경로가 번들링 상황에서 달라도 시도)
  try {
    // 상대 require는 이 파일 기준
    const json = require("./pandabt.default.rules.json");
    console.log("[pandabt-settings] loaded via require() fallback");
    return normalizeSettings(json);
  } catch (e) {
    console.warn("[pandabt-settings] require fallback failed:", e.message);
  }

  // 최종 실패 → 빈 디폴트
  return normalizeSettings(fallback);
}

const { version, defaultRules, defaultColors } = loadDefaults();

module.exports = {
  version,
  defaultRules, // [{ type, match }]
  defaultColors, // { [type]: { foreground?, fontStyle? } }
};
