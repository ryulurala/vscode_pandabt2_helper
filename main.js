// main.js
const vscode = require("vscode");
const {
  version,
  defaultTokens,
  defaultColors,
} = require("./pandabt/pandabt-settings");

// 단일 설정 키(이 이름으로 settings.json에 표시/저장됨)
const CFG_CONFIG = "pandabt-helper.configuration";

let semanticRegistration = null;
let providerInstance = null;

/* ------------------------- Utils ------------------------- */
function debounce(fn, ms = 80) {
  let t;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
}
function buildGlobalRegex(source, flags) {
  try {
    const f = new Set((flags || "").split("").filter(Boolean));
    f.add("g");
    return new RegExp(source, [...f].join(""));
  } catch {
    return null;
  }
}
function canCompileRegex(source, flags) {
  try {
    new RegExp(source, normalizeFlags(flags));
    return true;
  } catch {
    return false;
  }
}
function normalizeFlags(flags) {
  const s = (flags || "").replace(/[^gimsuy]/g, "");
  return [...new Set(s)].join("").replace(/g/g, "");
}
// 사용자 타입 키(pbt.tree 등)를 semantic token type 키로 매핑(VS Code 안전 문자만)
function mapTypeKey(type) {
  return String(type).replace(/[^A-Za-z0-9_]/g, "_");
}

function isSettingsJson(doc) {
  if (
    doc?.uri?.scheme === "vscode-userdata" &&
    /\/User\/settings\.json$/i.test(doc.uri.path)
  )
    return true;
  try {
    const p = doc?.uri?.fsPath || "";
    if (/[/\\]\.vscode[/\\]settings\.json$/i.test(p)) return true;
  } catch {}
  return false;
}
function getScopeForSettingsDoc(doc) {
  if (
    doc?.uri?.scheme === "vscode-userdata" &&
    /\/User\/settings\.json$/i.test(doc.uri.path)
  )
    return "user";
  const wf = vscode.workspace.getWorkspaceFolder(doc?.uri);
  if (wf) return "folder";
  return "workspace";
}
function scopeHasObject(val) {
  return !!(
    val &&
    typeof val === "object" &&
    !Array.isArray(val) &&
    Object.keys(val).length > 0
  );
}
function hashString(s) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return h;
}
function hslToHex(h, s, l) {
  s /= 100;
  l /= 100;
  const c = (1 - Math.abs(2 * l - 1)) * s,
    x = c * (1 - Math.abs(((h / 60) % 2) - 1)),
    m = l - c / 2;
  let r = 0,
    g = 0,
    b = 0;
  if (h < 60) {
    r = c;
    g = x;
  } else if (h < 120) {
    r = x;
    g = c;
  } else if (h < 180) {
    g = c;
    b = x;
  } else if (h < 240) {
    g = x;
    b = c;
  } else if (h < 300) {
    r = x;
    b = c;
  } else {
    r = c;
    b = x;
  }
  const toHex = (v) =>
    Math.round((v + m) * 255)
      .toString(16)
      .padStart(2, "0");
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}
function colorForType(type) {
  const h = ((hashString(type) % 360) + 360) % 360;
  return hslToHex(h, 55, 65);
}

/* ------------------------- Activation ------------------------- */
async function activate(context) {
  console.log(`[pandabt-helper] activate v${version}`);

  registerFormatter(context);

  // 내부 디폴트 + 사용자 설정 병합으로 즉시 동작
  await mirrorColorsToEditorCustomizations();
  await rebuildSemanticProvider(context);
  providerInstance?.refresh?.();

  // 설정 변경 → 즉시 반영
  const onCfgChanged = debounce(async (e) => {
    if (
      !e ||
      e.affectsConfiguration(CFG_CONFIG) ||
      e.affectsConfiguration("editor.semanticTokenColorCustomizations") ||
      e.affectsConfiguration("editor.semanticHighlighting.enabled")
    ) {
      await mirrorColorsToEditorCustomizations();
      await rebuildSemanticProvider(context);
      providerInstance?.refresh?.();
    }
  }, 60);
  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration(onCfgChanged)
  );

  // settings.json 열릴 때: 키가 비어 있으면 디폴트 템플릿 주입
  const seen = new Set();
  context.subscriptions.push(
    vscode.workspace.onDidOpenTextDocument(async (doc) => {
      const key = doc.uri.toString();
      if (seen.has(key)) return;
      seen.add(key);
      await autoInjectDefaultsOnSettingsOpen(doc);
    })
  );

  // settings.json 저장 후에도 반영
  context.subscriptions.push(
    vscode.workspace.onDidSaveTextDocument(
      debounce(async (doc) => {
        if (isSettingsJson(doc)) {
          await mirrorColorsToEditorCustomizations();
          await rebuildSemanticProvider(context);
          providerInstance?.refresh?.();
        }
      }, 50)
    )
  );

  // 에디터 전환/문서 열림도 갱신
  context.subscriptions.push(
    vscode.window.onDidChangeActiveTextEditor((ed) => {
      if (ed?.document?.languageId === "pandabt") providerInstance?.refresh?.();
    }),
    vscode.workspace.onDidOpenTextDocument((doc) => {
      if (doc?.languageId === "pandabt") providerInstance?.refresh?.();
    })
  );
}

async function deactivate() {}

/* ---------------------- Auto inject on settings open ---------------------- */
async function autoInjectDefaultsOnSettingsOpen(doc) {
  if (!isSettingsJson(doc)) return;

  const scope = getScopeForSettingsDoc(doc); // "user" | "workspace" | "folder"
  const cfg = vscode.workspace.getConfiguration();
  const info = cfg.inspect(CFG_CONFIG);

  const hasInScope =
    (scope === "user" && scopeHasObject(info?.globalValue)) ||
    (scope === "workspace" && scopeHasObject(info?.workspaceValue)) ||
    (scope === "folder" && scopeHasObject(info?.workspaceFolderValue));

  if (hasInScope) return; // 이미 값이 있으면 주입하지 않음

  // 디폴트 템플릿: { version, tokens: { typeKey: { match, flags?, foreground?, fontStyle? } } }
  const payload = {
    version: version || "1.0.0",
    tokens: {},
  };

  // defaultTokens + defaultColors를 합쳐 tokens로 직렬화
  for (const t of defaultTokens || []) {
    if (!t || !t.type || !t.match) continue;
    const k = t.type; // settings에는 원본 키(pbt.tree 등)로 노출
    payload.tokens[k] = { match: t.match };
    if (typeof t.flags === "string" && t.flags)
      payload.tokens[k].flags = normalizeFlags(t.flags);
    const c = defaultColors?.[k] || {};
    if (typeof c.foreground === "string")
      payload.tokens[k].foreground = c.foreground;
    if (typeof c.fontStyle === "string")
      payload.tokens[k].fontStyle = c.fontStyle;
  }

  // defaultColors에만 있고 defaultTokens엔 없는 타입도 보강
  for (const [k, c] of Object.entries(defaultColors || {})) {
    if (!payload.tokens[k]) payload.tokens[k] = { match: "" }; // match가 비면 사용자가 채울 수도 있음
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

  // 즉시 반영
  await mirrorColorsToEditorCustomizations();
  await rebuildSemanticProvider();
  providerInstance?.refresh?.();
}

/* ---------------------- Build effective (defaults + user) ---------------------- */
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

function buildMergedTokensAndColors() {
  // 1) 내부 디폴트(파일)
  const baseTokens = new Map(); // typeKey → { match, flags? }
  for (const t of defaultTokens || []) {
    if (!t || !t.type || !t.match) continue;
    baseTokens.set(t.type, { match: t.match, flags: normalizeFlags(t.flags) });
  }
  const baseColors = { ...(defaultColors || {}) }; // typeKey → { foreground?, fontStyle? }

  // 2) 사용자 설정(단일 키: pandabt-helper.configuration)
  const userObj = inspectConfigurationObject(); // { version, tokens:{ typeKey: {...} } }
  const userTokensObj =
    userObj?.tokens && typeof userObj.tokens === "object" ? userObj.tokens : {};

  // 3) 병합: 사용자 우선(토큰/색 모두 덮어씀)
  for (const [typeKey, def] of Object.entries(userTokensObj)) {
    if (!def || typeof def !== "object") continue;

    // 토큰(정규식)
    if (typeof def.match === "string" && def.match.length > 0) {
      baseTokens.set(typeKey, {
        match: def.match,
        flags: normalizeFlags(def.flags),
      });
    }

    // 색
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

/* ---------------------- Provider & Colors ---------------------- */
async function rebuildSemanticProvider(context) {
  const { effectiveTokens } = buildMergedTokensAndColors();
  const tokenTypes = effectiveTokens.map((r) => r.type);
  const legend = new vscode.SemanticTokensLegend(tokenTypes, []);
  providerInstance = new RegexSemanticProvider(legend, effectiveTokens);

  if (semanticRegistration) semanticRegistration.dispose();
  semanticRegistration =
    vscode.languages.registerDocumentSemanticTokensProvider(
      { language: "pandabt" },
      providerInstance,
      legend
    );
  if (context) context.subscriptions.push(semanticRegistration);
}

class RegexSemanticProvider {
  constructor(legend, tokens) {
    this.legend = legend;
    this._em = new vscode.EventEmitter();
    this.onDidChangeSemanticTokens = this._em.event;

    const typeToIndex = new Map();
    legend.tokenTypes.forEach((t, i) => typeToIndex.set(t, i));

    this.compiled = tokens
      .map((r) => {
        const re = buildGlobalRegex(r.match, r.flags);
        const idx = typeToIndex.get(r.type);
        return re && idx != null ? { re, idx } : null;
      })
      .filter(Boolean);
  }
  refresh() {
    this._em.fire();
  }

  async provideDocumentSemanticTokens(doc) {
    const b = new vscode.SemanticTokensBuilder(this.legend);
    if (!this.compiled.length) return b.build();

    for (let line = 0; line < doc.lineCount; line++) {
      const text = doc.lineAt(line).text;
      for (const { re, idx } of this.compiled) {
        re.lastIndex = 0;
        let m;
        while ((m = re.exec(text)) !== null) {
          const start = m.index,
            len = m[0].length;
          if (len > 0) b.push(line, start, len, idx, 0);
          if (m.index === re.lastIndex) re.lastIndex++;
        }
      }
    }
    return b.build();
  }
}

async function mirrorColorsToEditorCustomizations() {
  const cfg = vscode.workspace.getConfiguration();

  // semantic highlighting 켜기
  if (cfg.get("editor.semanticHighlighting.enabled") !== true) {
    await cfg.update(
      "editor.semanticHighlighting.enabled",
      true,
      vscode.ConfigurationTarget.Workspace
    );
  }

  const { effectiveColors } = buildMergedTokensAndColors();

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

/* ------------------------------ Formatter ------------------------------ */
function registerFormatter(context) {
  const formatter = vscode.languages.registerDocumentFormattingEditProvider(
    "pandabt",
    {
      provideDocumentFormattingEdits(document) {
        const edits = [],
          linesToDelete = [];
        for (let i = 0; i < document.lineCount; i++) {
          const line = document.lineAt(i);
          const originalText = line.text;
          const isBlankLine = originalText.trim() === "";
          const isOnlyCommentMark = originalText.trim() === "//";
          if (isOnlyCommentMark || isBlankLine) {
            linesToDelete.push(i);
            continue;
          }
          const trimmedText = originalText.trimEnd();
          const isCommentLine =
            trimmedText.trimStart().startsWith("//") ||
            trimmedText.trimStart().startsWith("/*");
          if (isCommentLine || isBlankLine) continue;

          let leadingTabs = 0,
            leadingSpaces = 0;
          for (let j = 0; j < trimmedText.length; j++) {
            if (trimmedText[j] === "\t") leadingTabs++;
            else if (trimmedText[j] === " ") leadingSpaces++;
            else break;
          }
          const spaceToTabCount = Math.floor((leadingSpaces + 1) / 4);
          const newIndent = "\t".repeat(leadingTabs + spaceToTabCount);
          const newText = newIndent + trimmedText.trimStart();
          if (newText !== originalText)
            edits.push(vscode.TextEdit.replace(line.range, newText));
        }
        linesToDelete
          .sort((a, b) => b - a)
          .forEach((idx) =>
            edits.push(vscode.TextEdit.delete(document.lineAt(idx).range))
          );
        return edits;
      },
    }
  );
  context.subscriptions.push(formatter);
}

module.exports = { activate, deactivate };
