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

const CONFIG_PROPERTY_NAME = "pandabt-helper.configuration";

/** @type {RegexSemanticProvider | null} */
let currentProviderInstance = null;

// ---------------- settings.json 템플릿 자동 주입 ----------------

async function autoInjectDefaultsOnSettingsOpen(doc, defaultCfg) {
  const { version, defaultTokens, defaultColors } = defaultCfg;
  const cfg = vscode.workspace.getConfiguration();
  const info = cfg.inspect(CONFIG_PROPERTY_NAME);

  const scope = doc ? getScopeForSettingsDoc(doc) : "user";

  const hasInScope =
    (scope === "user" && configHasValidTemplate(info?.globalValue)) ||
    (scope === "workspace" && configHasValidTemplate(info?.workspaceValue)) ||
    (scope === "folder" && configHasValidTemplate(info?.workspaceFolderValue));

  if (hasInScope) return;

  const payload = {
    version: version || "1.0.0",
    tokens: {},
  };

  // defaultTokens + defaultColors → 사용자 설정 구조로 직렬화
  for (const t of defaultTokens || []) {
    if (!t || !t.type || !t.match) continue;

    const k = t.type;
    payload.tokens[k] = { match: t.match };
    if (typeof t.flags === "string" && t.flags) {
      payload.tokens[k].flags = normalizeFlags(t.flags);
    }

    const c = defaultColors?.[k];
    if (c && typeof c === "object") {
      if (typeof c.foreground === "string")
        payload.tokens[k].foreground = c.foreground;
      if (typeof c.fontStyle === "string")
        payload.tokens[k].fontStyle = c.fontStyle;
    }
  }

  const target =
    scope === "workspace"
      ? vscode.ConfigurationTarget.Workspace
      : scope === "folder"
      ? vscode.ConfigurationTarget.WorkspaceFolder
      : vscode.ConfigurationTarget.Global;

  await cfg.update(CONFIG_PROPERTY_NAME, payload, target);
}

// ---------------- 병합 & 색상 미러링 ----------------

function buildMergedTokensAndColors(defaultCfg) {
  const { defaultTokens, defaultColors } = defaultCfg;

  // 1) 내부 기본
  const baseTokens = new Map();
  for (const t of defaultTokens || []) {
    if (t?.type && t?.match) {
      baseTokens.set(t.type, {
        match: t.match,
        flags: normalizeFlags(t.flags),
      });
    }
  }
  const baseColors = { ...(defaultColors || {}) };

  // 2) 사용자 설정
  const cfg = vscode.workspace.getConfiguration();
  const userObj = cfg.get(CONFIG_PROPERTY_NAME);
  const userTokensObj =
    userObj?.tokens && typeof userObj.tokens === "object" ? userObj.tokens : {};

  // 3) 사용자 우선 병합
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
    if (Object.keys(c).length)
      baseColors[typeKey] = { ...(baseColors[typeKey] || {}), ...c };
  }

  // 4) 산출
  const effectiveTokens = [];
  for (const [typeKey, r] of baseTokens) {
    if (!r?.match || !canCompileRegex(r.match, r.flags)) continue;
    const t = mapTypeKey(typeKey);
    effectiveTokens.push({ type: t, match: r.match, flags: r.flags });
  }

  const effectiveColors = {};
  for (const [typeKey, style] of Object.entries(baseColors)) {
    const t = mapTypeKey(typeKey);
    const s = { ...(style || {}) };
    if (!s.foreground) s.foreground = colorForType(t);
    if (typeof s.fontStyle !== "string") s.fontStyle = "";
    effectiveColors[t] = s;
  }

  return { effectiveTokens, effectiveColors };
}

async function mirrorColorsToEditorCustomizations(defaultCfg) {
  const cfg = vscode.workspace.getConfiguration();
  const { effectiveColors } = buildMergedTokensAndColors(defaultCfg);

  const hasWorkspace =
    Array.isArray(vscode.workspace.workspaceFolders) &&
    vscode.workspace.workspaceFolders.length > 0;
  const target = hasWorkspace
    ? vscode.ConfigurationTarget.Workspace
    : vscode.ConfigurationTarget.Global;

  if (cfg.get("editor.semanticHighlighting.enabled") !== true) {
    await cfg.update("editor.semanticHighlighting.enabled", true, target);
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
    await cfg.update(key, wantAll, target);
  }
}

// ---------------- Provider 등록/재빌드 ----------------

async function buildAndRegisterSemanticProvider(context, defaultCfg) {
  await mirrorColorsToEditorCustomizations(defaultCfg);

  const { effectiveTokens } = buildMergedTokensAndColors(defaultCfg);
  const tokenTypes = effectiveTokens.map((r) => r.type);

  if (!tokenTypes.length) {
    console.warn("[pandabt-helper] No token types found. Did defaults load?");
  }

  const legend = new vscode.SemanticTokensLegend(tokenTypes, []);
  const newProvider = new RegexSemanticProvider(legend, effectiveTokens);
  currentProviderInstance = newProvider;

  const selector = [
    { language: "pandabt", scheme: "file" },
    { language: "pandabt", scheme: "untitled" },
    { language: "pandabt", scheme: "vscode-notebook-cell" },
  ];

  const registration = vscode.languages.registerDocumentSemanticTokensProvider(
    selector,
    newProvider,
    legend
  );

  const refreshIfPandabt = (target) => {
    const doc = target?.document ?? target;
    if (doc?.languageId === "pandabt") currentProviderInstance?.refresh?.();
  };

  if (!context.subscriptions.some((d) => d && d.__PANDABT_REFRESH__)) {
    const a = vscode.window.onDidChangeActiveTextEditor(refreshIfPandabt);
    a.__PANDABT_REFRESH__ = true;
    const b = vscode.workspace.onDidOpenTextDocument(refreshIfPandabt);
    b.__PANDABT_REFRESH__ = true;
    context.subscriptions.push(a, b);
  }

  newProvider?.refresh?.();
  return registration;
}

function createSettingsWatcher(context, defaultCfg, configKey) {
  const onCfgChanged = debounce(async (e) => {
    if (
      !e ||
      e.affectsConfiguration(configKey) ||
      e.affectsConfiguration("editor.semanticTokenColorCustomizations") ||
      e.affectsConfiguration("editor.semanticHighlighting.enabled")
    ) {
      await buildAndRegisterSemanticProvider(context, defaultCfg);
    }
  }, 80);
  return vscode.workspace.onDidChangeConfiguration(onCfgChanged);
}

async function onSettingsOpened(context, defaultCfg, doc) {
  await autoInjectDefaultsOnSettingsOpen(doc ?? null, defaultCfg);
  currentProviderInstance?.refresh?.();
}

async function onExtensionActivated(context, defaultCfg) {
  const reg = await buildAndRegisterSemanticProvider(context, defaultCfg);
  context.subscriptions.push(reg);

  if (!context.subscriptions.some((d) => d && d.__PANDABT_WATCHER__)) {
    const watcher = createSettingsWatcher(
      context,
      defaultCfg,
      CONFIG_PROPERTY_NAME
    );
    watcher.__PANDABT_WATCHER__ = true;
    context.subscriptions.push(watcher);
  }
}

module.exports = {
  CFG_CONFIG: CONFIG_PROPERTY_NAME,
  buildMergedTokensAndColors,
  mirrorColorsToEditorCustomizations,
  autoInjectDefaultsOnSettingsOpen,
  buildAndRegisterSemanticProvider,
  createSettingsWatcher,
  onSettingsOpened,
  onExtensionActivated,
};
