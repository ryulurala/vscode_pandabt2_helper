const vscode = require("vscode");
const {
  version,
  defaultRules,
  defaultColors,
} = require("./pandabt/pandabt-settings");

// 설정 키
const CFG_RULES = "pandabt-helper.semanticRules"; // [{ type, match, flags? }]
const CFG_COLORS = "pandabt-helper.semanticColors"; // { [type]: { foreground?, fontStyle? } }

let semanticRegistration = null;
let providerInstance = null;

/* ------------------------- Utils: small helpers ------------------------- */
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
function sanitizeType(type) {
  // 토큰 타입/색상 키 통일: '.' 같은 문자를 '_'로 치환(일관성 유지)
  return String(type).replace(/[^A-Za-z0-9_]/g, "_");
}
function colorForType(type) {
  const h = ((hashString(type) % 360) + 360) % 360,
    s = 55,
    l = 65;
  return hslToHex(h, s, l);
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
    b = 0;
  } else if (h < 120) {
    r = x;
    g = c;
    b = 0;
  } else if (h < 180) {
    r = 0;
    g = c;
    b = x;
  } else if (h < 240) {
    r = 0;
    g = x;
    b = c;
  } else if (h < 300) {
    r = x;
    g = 0;
    b = c;
  } else {
    r = c;
    g = 0;
    b = x;
  }
  const toHex = (v) =>
    Math.round((v + m) * 255)
      .toString(16)
      .padStart(2, "0");
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
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
function scopeHasValue(val) {
  if (Array.isArray(val)) return val.length > 0;
  if (val && typeof val === "object") return Object.keys(val).length > 0;
  return !!val;
}

/* ---------------------------- Activation ---------------------------- */
async function activate(context) {
  console.log(
    `[pandabt-helper] activate v${version} rules:${
      defaultRules?.length || 0
    } colors:${Object.keys(defaultColors || {}).length}`
  );

  registerFormatter(context);

  await mirrorColorsToEditorCustomizations();
  await rebuildSemanticProvider(context);
  providerInstance?.refresh?.();

  // 설정 변경 → 즉시 반영(우선순위 병합 사용)
  const onCfgChanged = debounce(async () => {
    await mirrorColorsToEditorCustomizations();
    await rebuildSemanticProvider(context);
    providerInstance?.refresh?.();
  }, 80);
  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration(onCfgChanged)
  );

  // settings.json 저장 시에도 반영
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

  // 편집기 전환/문서 열림에도 갱신
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

/* ----------------- Read config with custom precedence ----------------- */
/** VS Code 기본: workspaceFolder > workspace > user > defaults
 *  ▶ 우리가 원하는: **user > workspaceFolder > workspace > defaults**
 *  이유: 사용자가 User에서 바꾼 값은 무조건 최우선으로 즉시 반영되길 원함.
 */
function getMergedConfigArray(key, defaultsArr) {
  const cfg = vscode.workspace.getConfiguration();
  const info = cfg.inspect(key);

  // 배열로 정규화
  const gv = Array.isArray(info?.globalValue) ? info.globalValue : undefined;
  const wfv = Array.isArray(info?.workspaceFolderValue)
    ? info.workspaceFolderValue
    : undefined;
  const wv = Array.isArray(info?.workspaceValue)
    ? info.workspaceValue
    : undefined;

  // 우리가 정한 우선순위: user(gv) > workspaceFolder(wfv) > workspace(wv) > defaults
  const picked = gv ?? wfv ?? wv ?? defaultsArr ?? [];
  return picked;
}
function getMergedConfigObject(key, defaultsObj) {
  const cfg = vscode.workspace.getConfiguration();
  const info = cfg.inspect(key);

  const gv =
    info?.globalValue &&
    typeof info.globalValue === "object" &&
    !Array.isArray(info.globalValue)
      ? info.globalValue
      : undefined;
  const wfv =
    info?.workspaceFolderValue &&
    typeof info.workspaceFolderValue === "object" &&
    !Array.isArray(info.workspaceFolderValue)
      ? info.workspaceFolderValue
      : undefined;
  const wv =
    info?.workspaceValue &&
    typeof info.workspaceValue === "object" &&
    !Array.isArray(info.workspaceValue)
      ? info.workspaceValue
      : undefined;

  // user > workspaceFolder > workspace > defaults
  const picked = gv ?? wfv ?? wv ?? defaultsObj ?? {};
  return picked;
}

/* -------------------- Effective rules & provider -------------------- */
async function rebuildSemanticProvider(context) {
  const rules = await getEffectiveRules();
  const tokenTypes = rules.map((r) => r.type);
  const legend = new vscode.SemanticTokensLegend(tokenTypes, []);

  providerInstance = new RegexSemanticProvider(legend, rules);

  if (semanticRegistration) semanticRegistration.dispose();
  semanticRegistration =
    vscode.languages.registerDocumentSemanticTokensProvider(
      { language: "pandabt" },
      providerInstance,
      legend
    );
  if (context) context.subscriptions.push(semanticRegistration);
}

async function getEffectiveRules() {
  // 1) 디폴트를 map으로 구축
  const map = new Map();
  for (const r of defaultRules || []) {
    if (!r || !r.type || !r.match) continue;
    const t = sanitizeType(r.type);
    map.set(t, { type: t, match: r.match, flags: normalizeFlags(r.flags) });
  }

  // 2) 사용자 설정(배열)을 우리가 정한 우선순위로 pick
  const userRulesPicked = getMergedConfigArray(CFG_RULES, []);
  for (const r of userRulesPicked) {
    if (!r || !r.type || !r.match) continue;
    const t = sanitizeType(r.type);
    const flags = normalizeFlags(r.flags);
    if (!canCompileRegex(r.match, flags)) continue;
    map.set(t, { type: t, match: r.match, flags });
  }

  return [...map.values()];
}

class RegexSemanticProvider {
  constructor(legend, rules) {
    this.legend = legend;
    this._em = new vscode.EventEmitter();
    this.onDidChangeSemanticTokens = this._em.event;

    const typeToIndex = new Map();
    legend.tokenTypes.forEach((t, i) => typeToIndex.set(t, i));

    this.compiled = rules
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

/* ---------------------- Colors: mirror to editor ---------------------- */
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

  // 기본색 + 사용자색(우선순위 병합: user > wsf > ws > defaults)
  const userColorsPicked = getMergedConfigObject(CFG_COLORS, {});
  const baseColors = {};
  for (const [k, v] of Object.entries(defaultColors || {}))
    baseColors[sanitizeType(k)] = v;
  const merged = { ...baseColors };
  for (const [k, v] of Object.entries(userColorsPicked || {}))
    merged[sanitizeType(k)] = v;

  // editor.semanticTokenColorCustomizations.rules 로 미러링
  const key = "editor.semanticTokenColorCustomizations";
  const all = cfg.get(key) || {};
  const currRules = all.rules || {};
  let changed = false;
  const next = { ...currRules };

  for (const [type, style] of Object.entries(merged)) {
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

/* ------------------------- Optional sanitizer ------------------------- */
/** 사용자가 settings.json에서 중복/오류 플래그를 넣었을 수 있으니 정리 */
async function validateNormalizeAndPersistRules() {
  const cfg = vscode.workspace.getConfiguration();
  const userRules = getMergedConfigArray(CFG_RULES, []); // 병합된 관점으로 가져오되…
  // 실제 쓰기는 "사용자가 편집한 스코프"에 해야 하지만, 여기선 보수적으로 workspace에 씁니다.
  const normalized = [];
  const seen = new Set();

  for (const r of userRules) {
    if (!r || !r.type || !r.match) continue;
    const t = sanitizeType(r.type);
    const flags = normalizeFlags(r.flags);
    if (!canCompileRegex(r.match, flags)) continue;
    if (seen.has(t)) {
      const idx = normalized.findIndex((n) => n.type === t);
      if (idx >= 0) normalized.splice(idx, 1);
    }
    seen.add(t);
    normalized.push({ type: t, match: r.match, flags });
  }

  await cfg.update(CFG_RULES, normalized, vscode.ConfigurationTarget.Workspace);
}

/* ------------------------------ Formatter ------------------------------ */
function registerFormatter(context) {
  const formatter = vscode.languages.registerDocumentFormattingEditProvider(
    "pandabt",
    {
      provideDocumentFormattingEdits(document) {
        const edits = [];
        const linesToDelete = [];
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

          if (newText !== originalText) {
            edits.push(vscode.TextEdit.replace(line.range, newText));
          }
        }
        linesToDelete
          .sort((a, b) => b - a)
          .forEach((idx) => {
            edits.push(vscode.TextEdit.delete(document.lineAt(idx).range));
          });
        return edits;
      },
    }
  );
  context.subscriptions.push(formatter);
}

module.exports = { activate, deactivate };
