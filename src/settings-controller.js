// src/settings-controller.js
const vscode = require("vscode");
const {
  normalizeFlags,
  mapTypeKey,
  colorForType,
  canCompileRegex,
  isSettingsJson,
  getScopeForSettingsDoc,
  scopeHasObject,
} = require("./utils");

// 단일 설정 키 (settings.json에서 편집되는 키)
const CFG_CONFIG = "pandabt-helper.configuration";

/* --------------- Auto inject defaults when opening settings --------------- */
async function autoInjectDefaultsOnSettingsOpen(
  doc,
  { version, defaultTokens, defaultColors }
) {
  if (!isSettingsJson(doc)) return;

  const scope = getScopeForSettingsDoc(doc); // "user" | "workspace" | "folder"
  const cfg = vscode.workspace.getConfiguration();
  const info = cfg.inspect(CFG_CONFIG);

  const hasInScope =
    (scope === "user" && scopeHasObject(info?.globalValue)) ||
    (scope === "workspace" && scopeHasObject(info?.workspaceValue)) ||
    (scope === "folder" && scopeHasObject(info?.workspaceFolderValue));

  if (hasInScope) return; // 이미 값이 있으면 주입하지 않음

  // 디폴트 템플릿으로 구성(버전 + tokens)
  const payload = {
    version: version || "1.0.0",
    tokens: {},
  };

  // defaultTokens + defaultColors → tokens로 직렬화
  for (const t of defaultTokens || []) {
    if (!t || !t.type || !t.match) continue;
    const k = t.type;
    payload.tokens[k] = { match: t.match };
    if (typeof t.flags === "string" && t.flags)
      payload.tokens[k].flags = normalizeFlags(t.flags);
    const c = defaultColors?.[k] || {};
    if (typeof c.foreground === "string")
      payload.tokens[k].foreground = c.foreground;
    if (typeof c.fontStyle === "string")
      payload.tokens[k].fontStyle = c.fontStyle;
  }
  for (const [k, c] of Object.entries(defaultColors || {})) {
    if (!payload.tokens[k]) payload.tokens[k] = { match: "" };
    if (c.foreground && !payload.tokens[k].foreground)
      payload.tokens[k].foreground = c.foreground;
    if (c.fontStyle && !payload.tokens[k].fontStyle)
      payload.tokens[k].fontStyle = c.fontStyle;
  }

  const targetEnum =
    scope === "user"
      ? vscode.ConfigurationTarget.Global
      : vscode.ConfigurationTarget.Workspace;

  await cfg.update(CFG_CONFIG, payload, targetEnum);
}

/* --------------- Build effective (defaults + user merged) --------------- */
function inspectConfigurationObject() {
  const cfg = vscode.workspace.getConfiguration();
  const info = cfg.inspect(CFG_CONFIG) || {};
  // 우선순위: user > workspaceFolder > workspace
  const picked =
    info.globalValue && typeof info.globalValue === "object"
      ? info.globalValue
      : info.workspaceFolderValue &&
        typeof info.workspaceFolderValue === "object"
      ? info.workspaceFolderValue
      : info.workspaceValue && typeof info.workspaceValue === "object"
      ? info.workspaceValue
      : undefined;
  return picked; // 없으면 undefined
}

function buildMergedTokensAndColors({ defaultTokens, defaultColors }) {
  // 1) 내부 디폴트(파일)
  const baseTokens = new Map(); // typeKey → { match, flags? }
  for (const t of defaultTokens || []) {
    if (!t || !t.type || !t.match) continue;
    baseTokens.set(t.type, { match: t.match, flags: normalizeFlags(t.flags) });
  }
  const baseColors = { ...(defaultColors || {}) };

  // 2) 사용자 설정(단일 키: pandabt-helper.configuration)
  const userObj = inspectConfigurationObject(); // { version, tokens:{ typeKey: {...} } }
  const userTokensObj =
    userObj?.tokens && typeof userObj.tokens === "object" ? userObj.tokens : {};

  // 3) 병합: 사용자 우선
  for (const [typeKey, def] of Object.entries(userTokensObj)) {
    if (!def || typeof def !== "object") continue;

    if (typeof def.match === "string" && def.match.length > 0) {
      baseTokens.set(typeKey, {
        match: def.match,
        flags: normalizeFlags(def.flags),
      });
    }
    const c = {};
    if (typeof def.foreground === "string") c.foreground = def.foreground;
    if (typeof def.fontStyle === "string") c.fontStyle = def.fontStyle;
    if (Object.keys(c).length) {
      baseColors[typeKey] = { ...(baseColors[typeKey] || {}), ...c };
    }
  }

  // 4) 산출
  const effectiveTokens = [];
  for (const [typeKey, r] of baseTokens) {
    if (!r || !r.match) continue;
    if (!canCompileRegex(r.match, r.flags)) continue;
    const t = mapTypeKey(typeKey);
    effectiveTokens.push({ type: t, match: r.match, flags: r.flags });
  }

  const effectiveColors = {};
  for (const [typeKey, style] of Object.entries(baseColors)) {
    const t = mapTypeKey(typeKey);
    effectiveColors[t] = { ...style };
    if (!effectiveColors[t].foreground)
      effectiveColors[t].foreground = colorForType(t);
    if (typeof effectiveColors[t].fontStyle !== "string")
      effectiveColors[t].fontStyle = "";
  }

  return { effectiveTokens, effectiveColors };
}

/* ====================== Mirror Colors to Editor Customizations ====================== */
async function mirrorColorsToEditorCustomizations({
  version,
  defaultTokens,
  defaultColors,
}) {
  const cfg = vscode.workspace.getConfiguration();
  const { effectiveColors } = buildMergedTokensAndColors({
    version,
    defaultTokens,
    defaultColors,
  });

  // semantic highlighting 켜기
  if (cfg.get("editor.semanticHighlighting.enabled") !== true) {
    await cfg.update(
      "editor.semanticHighlighting.enabled",
      true,
      vscode.ConfigurationTarget.Workspace
    );
  }

  const key = "editor.semanticTokenColorCustomizations";
  const all = cfg.get(key) || {};
  const currRules = all.rules || {};
  let changed = false;
  const next = { ...currRules };

  for (const [type, style] of Object.entries(effectiveColors)) {
    const want = {};
    if (style.foreground) want.foreground = style.foreground;
    if (style.fontStyle) want.fontStyle = style.fontStyle;

    const now = currRules[type];
    const same =
      now &&
      (now.foreground || "") === (want.foreground || "") &&
      (now.fontStyle || "") === (want.fontStyle || "");

    if (!same) {
      next[type] = want;
      changed = true;
    }
  }

  const wantAll = { ...all, enabled: true, rules: next };
  if (changed || all.enabled !== true || all.rules === undefined) {
    await cfg.update(key, wantAll, vscode.ConfigurationTarget.Workspace);
  }
}

module.exports = {
  CFG_CONFIG,
  buildMergedTokensAndColors,
  mirrorColorsToEditorCustomizations,
  autoInjectDefaultsOnSettingsOpen,
  isSettingsJson,
};
