const vscode = require("vscode");
const {
  normalizeFlags,
  mapTypeKey,
  colorForType,
  canCompileRegex,
  getScopeForSettingsDoc,
  configHasValidTemplate,
  debounce,
} = require("./utils");
const { RegexSemanticProvider } = require("./semantic-provider");

// settings.json에서 편집되는 단일 설정 키
const CFG_CONFIG = "pandabt-helper.configuration";

/** @type {RegexSemanticProvider | null} */
let currentProviderInstance = null; // 현재 활성화된 프로바이더 인스턴스 저장

/* --------------- 설정 파일 열 때 기본 템플릿 자동 주입 --------------- */

/**
 * settings.json이 열렸을 때 (또는 명령어로 호출될 때)
 * 유효한 템플릿이 없는 경우 기본 설정 템플릿을 주입합니다.
 * @param {vscode.TextDocument | null} doc - 현재 열린 문서 (null이면 명령어로 호출된 것으로 간주)
 * @param {object} defaultCfg - config-loader.js가 제공하는 기본 설정 데이터
 */
async function autoInjectDefaultsOnSettingsOpen(doc, defaultCfg) {
  const { version, defaultTokens, defaultColors } = defaultCfg;
  const cfg = vscode.workspace.getConfiguration();
  const info = cfg.inspect(CFG_CONFIG);

  // 1. 대상 범위 결정 ('user' | 'workspace' | 'folder')
  const scope = doc ? getScopeForSettingsDoc(doc) : "user";

  // 2. 현재 대상 범위에 유효한 템플릿 구조가 이미 있는지 확인하여 주입 중단
  const hasInScope =
    (scope === "user" && configHasValidTemplate(info?.globalValue)) ||
    (scope === "workspace" && configHasValidTemplate(info?.workspaceValue)) ||
    (scope === "folder" && configHasValidTemplate(info?.workspaceFolderValue));

  if (hasInScope) {
    console.log(
      `[settings-controller] Configuration already has a valid template in ${scope} scope. Skip injection.`
    );
    return;
  }

  // 3. 주입할 페이로드 생성
  const payload = {
    version: version || "1.0.0",
    tokens: {},
  };

  // defaultTokens + defaultColors → tokens로 직렬화 (사용자 설정 구조)
  for (const t of defaultTokens || []) {
    if (!t || !t.type || !t.match) continue;

    const k = t.type;
    payload.tokens[k] = { match: t.match };

    if (typeof t.flags === "string" && t.flags) {
      payload.tokens[k].flags = normalizeFlags(t.flags);
    }

    const c = defaultColors?.[k] || {};
    if (typeof c.foreground === "string")
      payload.tokens[k].foreground = c.foreground;
    if (typeof c.fontStyle === "string")
      payload.tokens[k].fontStyle = c.fontStyle;
  }

  // defaultColors에만 있는 경우도 tokens에 추가
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

/* --------------- 기본값 + 사용자 설정 병합 후 유효 설정 빌드 --------------- */

/**
 * 현재 활성화된 사용자 설정 객체를 찾습니다.
 * 우선순위: Global(User) > WorkspaceFolder > Workspace
 * @returns {object | undefined} 활성화된 설정 객체 또는 undefined
 */
function inspectConfigurationObject() {
  const info = vscode.workspace.getConfiguration().inspect(CFG_CONFIG) || {};

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

  return picked;
}

/**
 * 내부 기본 설정과 사용자 설정을 병합하여 실제로 사용할 토큰 및 색상 구성을 빌드합니다.
 * 사용자 설정이 우선권을 가집니다.
 * @param {object} defaultCfg - config-loader.js가 제공하는 기본 설정 데이터
 * @returns {{ effectiveTokens: Array<object>, effectiveColors: object }} 병합된 유효 토큰 및 색상
 */
function buildMergedTokensAndColors(defaultCfg) {
  const { defaultTokens, defaultColors } = defaultCfg;

  // 1. 내부 디폴트(파일)
  const baseTokens = new Map(); // typeKey → { match, flags? }
  for (const t of defaultTokens || []) {
    if (t?.type && t?.match) {
      baseTokens.set(t.type, {
        match: t.match,
        flags: normalizeFlags(t.flags),
      });
    }
  }
  const baseColors = { ...(defaultColors || {}) };

  // 2. 사용자 설정 로드
  const userObj = inspectConfigurationObject(); // { version, tokens:{ typeKey: {...} } }
  const userTokensObj =
    userObj?.tokens && typeof userObj.tokens === "object" ? userObj.tokens : {};

  // 3. 병합: 사용자 설정 적용 (사용자 우선)
  for (const [typeKey, def] of Object.entries(userTokensObj)) {
    if (!def || typeof def !== "object") continue;

    // 토큰 (정규식 룰) 병합
    if (typeof def.match === "string" && def.match.length > 0) {
      baseTokens.set(typeKey, {
        match: def.match,
        flags: normalizeFlags(def.flags),
      });
    }

    // 색상 (스타일) 병합
    const c = {};
    if (typeof def.foreground === "string") c.foreground = def.foreground;
    if (typeof def.fontStyle === "string") c.fontStyle = def.fontStyle;

    if (Object.keys(c).length) {
      baseColors[typeKey] = { ...(baseColors[typeKey] || {}), ...c };
    }
  }

  // 4. 산출
  const effectiveTokens = [];
  for (const [typeKey, r] of baseTokens) {
    if (!r?.match || !canCompileRegex(r.match, r.flags)) continue;

    const t = mapTypeKey(typeKey);
    effectiveTokens.push({ type: t, match: r.match, flags: r.flags });
  }

  const effectiveColors = {};
  for (const [typeKey, style] of Object.entries(baseColors)) {
    const t = mapTypeKey(typeKey);
    effectiveColors[t] = { ...style };

    // foreground가 없으면 타입 해시 기반 기본 색상 할당
    if (!effectiveColors[t].foreground) {
      effectiveColors[t].foreground = colorForType(t);
    }
    // fontStyle이 없으면 빈 문자열로 설정
    if (typeof effectiveColors[t].fontStyle !== "string") {
      effectiveColors[t].fontStyle = "";
    }
  }

  return { effectiveTokens, effectiveColors };
}

/* ====================== 색상을 VS Code 에디터 설정에 반영 ====================== */

/**
 * 빌드된 유효 색상 구성을 VS Code의 `editor.semanticTokenColorCustomizations`에 미러링합니다.
 * @param {object} defaultCfg - config-loader.js가 제공하는 기본 설정 데이터
 */
async function mirrorColorsToEditorCustomizations(defaultCfg) {
  const cfg = vscode.workspace.getConfiguration();
  const { effectiveColors } = buildMergedTokensAndColors(defaultCfg);

  // semantic highlighting 활성화 확인 및 업데이트
  if (cfg.get("editor.semanticHighlighting.enabled") !== true) {
    await cfg.update(
      "editor.semanticHighlighting.enabled",
      true,
      vscode.ConfigurationTarget.Workspace // 워크스페이스 설정으로 저장
    );
  }

  const key = "editor.semanticTokenColorCustomizations";
  const all = cfg.get(key) || {};
  const currRules = all.rules || {};
  let changed = false;
  const next = { ...currRules };

  // 유효 색상들을 Semantic Token Customizations 규칙에 맞게 반영
  for (const [type, style] of Object.entries(effectiveColors)) {
    const want = {};
    if (style.foreground) want.foreground = style.foreground;
    if (style.fontStyle) want.fontStyle = style.fontStyle;

    const now = currRules[type];
    // 현재 설정과 원하는 설정이 동일한지 비교
    const same =
      now &&
      (now.foreground || "") === (want.foreground || "") &&
      (now.fontStyle || "") === (want.fontStyle || "");

    if (!same) {
      next[type] = want;
      changed = true;
    }
  }

  // 변경 사항이 있거나, enabled/rules 키가 누락된 경우에만 업데이트
  const wantAll = { ...all, enabled: true, rules: next };
  if (changed || all.enabled !== true || all.rules === undefined) {
    await cfg.update(key, wantAll, vscode.ConfigurationTarget.Workspace);
  }
}

/* ====================== Semantic Provider 재구성 및 등록 로직 (main.js에서 이동) ====================== */

/**
 * 현재 병합된 설정을 기반으로 Semantic Token Provider를 재구성하고 등록합니다.
 * 이 함수는 모든 로직을 캡슐화하며, main.js에서 호출됩니다.
 * @param {vscode.ExtensionContext} context - 확장 프로그램 컨텍스트
 * @param {object} defaultCfg - config-loader.js가 제공하는 기본 설정 데이터
 * @returns {Promise<vscode.Disposable>} 등록된 SemanticTokensProvider의 Disposable
 */
async function buildAndRegisterSemanticProvider(context, defaultCfg) {
  // 1. 색상 설정 반영 (기존 mirrorColorsToEditorCustomizations 호출)
  await mirrorColorsToEditorCustomizations(defaultCfg);

  // 2. 유효 토큰 빌드 및 Legend 생성
  const { effectiveTokens } = buildMergedTokensAndColors(defaultCfg);
  const tokenTypes = effectiveTokens.map((r) => r.type);
  const legend = new vscode.SemanticTokensLegend(tokenTypes, []);

  // 3. 새로운 Provider 인스턴스 생성 및 교체
  const newProvider = new RegexSemanticProvider(legend, effectiveTokens);
  currentProviderInstance = newProvider;

  // 4. 새로운 Provider 등록 및 Disposable 반환
  const registration = vscode.languages.registerDocumentSemanticTokensProvider(
    { language: "pandabt" },
    newProvider,
    legend
  );

  // 5. 편집기 전환/문서 열림 이벤트에서 Semantic Token 새로고침 리스너 등록
  const refreshOnEvent = (target) => {
    if (
      target?.document?.languageId === "pandabt" ||
      target?.languageId === "pandabt"
    ) {
      currentProviderInstance?.refresh?.();
    }
  };

  // 최초 한 번만 등록하도록 ID를 사용하여 구분
  if (!context.subscriptions.some((d) => d.ID_IS_REFRESH_LISTENER)) {
    const editorChangeListener =
      vscode.window.onDidChangeActiveTextEditor(refreshOnEvent);
    editorChangeListener.ID_IS_REFRESH_LISTENER = true;
    context.subscriptions.push(editorChangeListener);

    const docOpenListener =
      vscode.workspace.onDidOpenTextDocument(refreshOnEvent);
    docOpenListener.ID_IS_REFRESH_LISTENER = true;
    context.subscriptions.push(docOpenListener);
  }

  // 6. 새로고침 요청
  newProvider?.refresh?.();
  return registration;
}

/* ====================== 설정 변경 감시 리스너 생성 (main.js에서 이동) ====================== */

/**
 * 설정 변경 이벤트를 감시하고, 변경 시 Provider 재구축을 트리거하는 리스너를 생성합니다.
 * @param {vscode.ExtensionContext} context - 확장 프로그램 컨텍스트
 * @param {object} defaultCfg - 기본 설정 데이터
 * @param {string} configKey - 감시할 사용자 설정 키
 * @returns {vscode.Disposable} 설정 변경 리스너 Disposable
 */
function createSettingsWatcher(context, defaultCfg, configKey) {
  const onCfgChanged = debounce(async (e) => {
    // 관련 설정이 변경되었을 때만 재구성
    if (
      !e ||
      e.affectsConfiguration(configKey) ||
      e.affectsConfiguration("editor.semanticTokenColorCustomizations") ||
      e.affectsConfiguration("editor.semanticHighlighting.enabled")
    ) {
      // 재구축 및 등록 (새 registration은 main.js에서 dispose 처리)
      await buildAndRegisterSemanticProvider(context, defaultCfg);
    }
  }, 60);

  return vscode.workspace.onDidChangeConfiguration(onCfgChanged);
}

module.exports = {
  CFG_CONFIG,
  buildMergedTokensAndColors,
  mirrorColorsToEditorCustomizations,
  autoInjectDefaultsOnSettingsOpen,
  buildAndRegisterSemanticProvider,
  createSettingsWatcher,
};
