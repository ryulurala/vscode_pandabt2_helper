const vscode = require("vscode");
const {
  normalizeFlags,
  mapTypeKey,
  colorForType,
  canCompileRegex,
  getScopeForSettingsDoc,
  configHasValidTemplate, // 🌟 수정됨: configHasValidTemplate 가져오기
} = require("./utils");

// 단일 설정 키 (settings.json에서 편집되는 키)
const CFG_CONFIG = "pandabt-helper.configuration";

/* --------------- Auto inject defaults when opening settings --------------- */
// doc이 null이면 (명령어로 호출되면) Global/User 설정을 대상으로 함
async function autoInjectDefaultsOnSettingsOpen(doc, defaultCfg) {
  // defaultCfg에서 필요한 데이터와 유틸리티 함수를 추출 (config-loader.js가 제공)
  const { version, defaultTokens, defaultColors } = defaultCfg;

  // 1. 대상 범위 결정
  let scope;
  if (doc) {
    // 1-1. 문서가 제공된 경우 (settings.json이 열렸는지 확인)
    // 이 로직은 현재 main.js에서 사용되지 않지만, 만약을 위해 남겨둡니다.
    scope = getScopeForSettingsDoc(doc); // 'user' | 'workspace' | 'folder'
  } else {
    // 1-2. 문서가 없는 경우 (명령어로 호출된 경우): Global/User 설정을 대상으로 간주
    scope = "user";
  }

  // 2. 현재 대상 범위에 이미 설정이 있는지 확인 (템플릿 구조가 존재하는지 확인하도록 변경)
  const cfg = vscode.workspace.getConfiguration();
  const info = cfg.inspect(CFG_CONFIG);

  // 🌟 [수정] 주입 중단 조건: configHasValidTemplate 사용
  const hasInScope =
    (scope === "user" && configHasValidTemplate(info?.globalValue)) ||
    (scope === "workspace" && configHasValidTemplate(info?.workspaceValue)) ||
    (scope === "folder" && configHasValidTemplate(info?.workspaceFolderValue));

  if (hasInScope) {
    console.log(
      `[settings-controller] Configuration already has a valid template in ${scope} scope. Skip injection.`
    );
    return; // 템플릿이 유효하게 존재하면 주입하지 않음
  }

  // 3. 주입할 페이로드 생성
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
      payload.tokens[k].flags = normalizeFlags(t.flags); // utils에서 가져온 함수 사용
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

  // 4. 설정 업데이트
  const targetEnum =
    scope === "user"
      ? vscode.ConfigurationTarget.Global // Global (User) settings
      : vscode.ConfigurationTarget.Workspace; // Workspace/Folder settings

  console.log(
    `[settings-controller] Injecting default configuration into ${scope} scope.`
  );
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

function buildMergedTokensAndColors(defaultCfg) {
  // defaultCfg에서 필요한 데이터와 유틸리티 함수를 추출
  const { defaultTokens, defaultColors } = defaultCfg;

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
async function mirrorColorsToEditorCustomizations(defaultCfg) {
  const cfg = vscode.workspace.getConfiguration();
  const { effectiveColors } = buildMergedTokensAndColors(defaultCfg);

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
};
