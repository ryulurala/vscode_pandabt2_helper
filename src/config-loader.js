const fs = require("fs");
const path = require("path");
const os = require("os");

/** 안전 JSON 로드 */
function safeReadJSON(filePath, fallback = null) {
  try {
    if (!filePath) return fallback;
    if (!fs.existsSync(filePath)) return fallback;
    const raw = fs.readFileSync(filePath, "utf8");
    return JSON.parse(raw);
  } catch (e) {
    console.warn(`[config-loader] JSON read fail: ${filePath}: ${e.message}`);
    return fallback;
  }
}

/** ~, ${workspaceFolder} 치환 + 절대경로 변환 */
function resolvePathLike(p, workspaceRoot) {
  if (!p || typeof p !== "string") return null;
  let q = p.replace(/^~(?=($|\/|\\))/, os.homedir());
  if (workspaceRoot) {
    q = q.replace(/\$\{workspaceFolder\}/g, workspaceRoot);
  }
  if (!path.isAbsolute(q)) {
    q = workspaceRoot ? path.join(workspaceRoot, q) : q;
  }
  return q;
}

/** default.json 형태 → 내부 포맷으로 정규화 */
function normalizeSettings(json) {
  const version = typeof json?.version === "string" ? json.version : "0.0.0";
  const tokensObj = json && typeof json.tokens === "object" ? json.tokens : {};

  const tokens = []; // [{ type, match, flags? }]
  const colors = {}; // { [type]: { foreground?, fontStyle? } }

  for (const [type, def] of Object.entries(tokensObj)) {
    if (!def || typeof def.match !== "string") continue;
    const one = { type, match: def.match };
    if (typeof def.flags === "string") one.flags = def.flags;
    tokens.push(one);

    const style = {};
    if (typeof def.foreground === "string") style.foreground = def.foreground;
    if (typeof def.fontStyle === "string") style.fontStyle = def.fontStyle;
    if (Object.keys(style).length) colors[type] = style;
  }
  return { version, defaultTokens: tokens, defaultColors: colors };
}

/** 내부 머지 유틸: later가 stronger */
function mergeNormalized(base, later) {
  const out = {
    version: later.version || base.version,
    defaultTokens: [...base.defaultTokens],
    defaultColors: { ...base.defaultColors },
  };

  // tokens: type키 기준으로 덮어쓰기
  const tokMap = new Map(out.defaultTokens.map((t) => [t.type, { ...t }]));
  for (const t of later.defaultTokens || []) {
    if (t?.type && typeof t.match === "string") {
      tokMap.set(t.type, { type: t.type, match: t.match, flags: t.flags });
    }
  }
  out.defaultTokens = Array.from(tokMap.values());

  // colors: type별 병합(덮어쓰기)
  for (const [k, v] of Object.entries(later.defaultColors || {})) {
    out.defaultColors[k] = { ...(out.defaultColors[k] || {}), ...v };
  }
  return out;
}

/**
 * 기본 설정(내장 파일) + settings.json이 가리키는 외부 파일들을 모두 로드·정규화·병합해서 반환
 * @param {string} extensionPath
 * @param {object} userSettings  // pandabt-helper.configuration 전체 객체 (옵션)
 * @param {string[]} configFiles // pandabt-helper.configFiles (옵션)
 * @param {string | null} workspaceRoot
 */
function loadComposedConfiguration(extensionPath, userSettings, configFiles, workspaceRoot) {
  // 1) 내장 기본 파일 (기존 파일명 유지)
  const builtInPathA = path.join(extensionPath, "config", "pandabt-default-tokens.json");
  const builtInPathB = path.join(extensionPath, "config", "pandabt.default.tokens.json"); // 호환
  const builtInRaw = safeReadJSON(builtInPathA, null) ?? safeReadJSON(builtInPathB, { version: "0.0.0", tokens: {} });
  let acc = normalizeSettings(builtInRaw); // 시작점
  // 참고: 기존 코드는 단일 파일만 로드함. :contentReference[oaicite:2]{index=2}

  // 2) settings.json > pandabt-helper.configFiles 배열의 파일들을 순차 머지(앞이 약, 뒤가 강)
  const files = Array.isArray(configFiles) ? configFiles : [];
  for (const p of files) {
    const abs = resolvePathLike(p, workspaceRoot);
    const raw = safeReadJSON(abs, null);
    if (!raw) continue;
    acc = mergeNormalized(acc, normalizeSettings(raw));
  }

  // 3) settings.json > pandabt-helper.configuration.extends 배열도 동일 처리
  const extendsArr = Array.isArray(userSettings?.extends) ? userSettings.extends : [];
  for (const p of extendsArr) {
    const abs = resolvePathLike(p, workspaceRoot);
    const raw = safeReadJSON(abs, null);
    if (!raw) continue;
    acc = mergeNormalized(acc, normalizeSettings(raw));
  }

  // 4) 마지막으로 settings.json > pandabt-helper.configuration.tokens(인라인) 덮어쓰기
  if (userSettings && typeof userSettings === "object") {
    acc = mergeNormalized(acc, normalizeSettings(userSettings));
  }

  return acc;
}

module.exports = {
  loadComposedConfiguration,
  normalizeSettings, // (테스트나 다른 유틸에서 쓸 수 있게 export)
};
