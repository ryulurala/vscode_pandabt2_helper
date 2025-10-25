// main.js
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

async function activate(context) {
  console.log(`[pandabt-helper] activate v${version}`);

  // 포맷터(기존 유지)
  registerFormatter(context);

  // 설치/활성화 직후: settings.json엔 쓰지 않고 "내부" 디폴트 + 사용자 설정 병합으로 동작
  await mirrorColorsToEditorCustomizations();
  await rebuildSemanticProvider();

  // 설정 변경 감지 → settings.json 수정 시 즉시 반영
  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration(async (e) => {
      let needRebuild = false;

      if (e.affectsConfiguration(CFG_RULES)) {
        await validateNormalizeAndPersistRules(); // regex 유효화/중복 정리
        await ensureColorsForNewRules(); // 새 type에 자동 색 생성
        await mirrorColorsToEditorCustomizations();
        needRebuild = true;
      }
      if (
        e.affectsConfiguration(CFG_COLORS) ||
        e.affectsConfiguration("editor.semanticTokenColorCustomizations") ||
        e.affectsConfiguration("editor.semanticHighlighting.enabled")
      ) {
        await mirrorColorsToEditorCustomizations();
        needRebuild = true;
      }

      if (needRebuild) {
        await rebuildSemanticProvider();
        providerInstance?.refresh?.();
      }
    })
  );

  // Settings UI에서 "Edit in settings.json"을 눌러 settings.json이 열릴 때 자동 주입 (무팝업)
  const seen = new Set();
  context.subscriptions.push(
    vscode.workspace.onDidOpenTextDocument(async (doc) => {
      // 같은 문서 중복 처리 방지
      const key = doc.uri.toString();
      if (seen.has(key)) return;
      seen.add(key);

      await autoInjectDefaultsOnSettingsJsonOpen(doc);
    })
  );
}

async function deactivate() {}

/* =========================================================================
 * Settings.json 오픈 시: 해당 스코프에 값이 없을 경우 디폴트 템플릿 자동 주입 (무팝업)
 * ========================================================================= */
async function autoInjectDefaultsOnSettingsJsonOpen(doc) {
  if (!isSettingsJson(doc)) return;

  const target = detectSettingsTarget(doc); // "user" | "workspace" | "folder" | null
  if (!target) return;

  const cfg = vscode.workspace.getConfiguration();
  const rulesInfo = cfg.inspect(CFG_RULES);
  const colorsInfo = cfg.inspect(CFG_COLORS);

  const nonEmptyArr = (v) => Array.isArray(v) && v.length > 0;
  const nonEmptyObj = (v) =>
    v &&
    typeof v === "object" &&
    !Array.isArray(v) &&
    Object.keys(v).length > 0;

  const hasRulesInScope =
    (target === "user" &&
      rulesInfo?.globalValue !== undefined &&
      nonEmptyArr(rulesInfo.globalValue)) ||
    (target === "workspace" &&
      rulesInfo?.workspaceValue !== undefined &&
      nonEmptyArr(rulesInfo.workspaceValue)) ||
    (target === "folder" &&
      rulesInfo?.workspaceFolderValue !== undefined &&
      nonEmptyArr(rulesInfo.workspaceFolderValue));

  const hasColorsInScope =
    (target === "user" &&
      colorsInfo?.globalValue !== undefined &&
      nonEmptyObj(colorsInfo.globalValue)) ||
    (target === "workspace" &&
      colorsInfo?.workspaceValue !== undefined &&
      nonEmptyObj(colorsInfo.workspaceValue)) ||
    (target === "folder" &&
      colorsInfo?.workspaceFolderValue !== undefined &&
      nonEmptyObj(colorsInfo.workspaceFolderValue));

  // 이미 해당 스코프에 값이 있으면 아무것도 안 함
  if (hasRulesInScope && hasColorsInScope) return;

  // 주입 대상 스코프 결정
  const targetEnum =
    target === "user"
      ? vscode.ConfigurationTarget.Global
      : vscode.ConfigurationTarget.Workspace; // folder도 실질적으로 워크스페이스에 기록

  let wrote = false;

  if (!hasRulesInScope) {
    const payload = (defaultRules || [])
      .filter((r) => r && r.type && r.match)
      .map((r) => ({
        type: sanitizeType(r.type),
        match: r.match,
        flags: normalizeFlags(r.flags),
      }));
    if (payload.length) {
      await cfg.update(CFG_RULES, payload, targetEnum);
      wrote = true;
      await ensureColorsForNewRules(payload);
    }
  }

  if (!hasColorsInScope) {
    const payloadColors = {};
    for (const [k, v] of Object.entries(defaultColors || {})) {
      payloadColors[sanitizeType(k)] = v;
    }
    if (Object.keys(payloadColors).length) {
      await cfg.update(CFG_COLORS, payloadColors, targetEnum);
      wrote = true;
    }
  }

  if (wrote) {
    await mirrorColorsToEditorCustomizations();
    await rebuildSemanticProvider();
    providerInstance?.refresh?.();
    // 조용히 적용 (팝업 없음)
  }
}

function isSettingsJson(doc) {
  // User settings.json
  if (
    doc.uri.scheme === "vscode-userdata" &&
    /\/User\/settings\.json$/i.test(doc.uri.path)
  )
    return true;
  // Workspace/Folder settings.json
  try {
    const fsPath = doc.uri.fsPath || "";
    if (/[/\\]\.vscode[/\\]settings\.json$/i.test(fsPath)) return true;
  } catch {}
  return false;
}
function detectSettingsTarget(doc) {
  if (
    doc.uri.scheme === "vscode-userdata" &&
    /\/User\/settings\.json$/i.test(doc.uri.path)
  )
    return "user";
  const wf = vscode.workspace.getWorkspaceFolder(doc.uri);
  if (wf) return "folder";
  return "workspace";
}

/* =========================================================================
 * Semantic Tokens Provider (디폴트 + 사용자 설정 병합, 사용자 우선)
 * ========================================================================= */
async function rebuildSemanticProvider() {
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
}

async function getEffectiveRules() {
  const cfg = vscode.workspace.getConfiguration();
  const userRules = cfg.get(CFG_RULES) || [];
  const out = new Map();

  // 1) 디폴트
  for (const r of defaultRules) {
    if (!r || !r.type || !r.match) continue;
    const t = sanitizeType(r.type);
    out.set(t, { type: t, match: r.match, flags: normalizeFlags(r.flags) });
  }

  // 2) 사용자 (덮어쓰기)
  for (const r of userRules) {
    if (!r || !r.type || !r.match) continue;
    const t = sanitizeType(r.type);
    const flags = normalizeFlags(r.flags);
    if (!canCompileRegex(r.match, flags)) continue;
    out.set(t, { type: t, match: r.match, flags });
  }

  return [...out.values()];
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

/* =========================================================================
 * Colors / Defaults
 * ========================================================================= */
async function mirrorColorsToEditorCustomizations() {
  const cfg = vscode.workspace.getConfiguration();

  // 세만틱 하이라이트 강제 활성화
  if (cfg.get("editor.semanticHighlighting.enabled") !== true) {
    await cfg.update(
      "editor.semanticHighlighting.enabled",
      true,
      vscode.ConfigurationTarget.Workspace
    );
  }

  // 기본색 + 사용자색 병합(사용자 우선), key sanitize
  const userColorsRaw = cfg.get(CFG_COLORS) || {};
  const userColors = {};
  for (const [k, v] of Object.entries(userColorsRaw))
    userColors[sanitizeType(k)] = v;

  const baseColors = {};
  for (const [k, v] of Object.entries(defaultColors))
    baseColors[sanitizeType(k)] = v;

  const merged = { ...baseColors, ...userColors };

  // editor.semanticTokenColorCustomizations.rules 로 미러링
  const all = cfg.get("editor.semanticTokenColorCustomizations") || {};
  const currRules = all.rules || {};
  let changed = false;
  const next = { ...currRules };

  for (const [typeRaw, style] of Object.entries(merged)) {
    const type = sanitizeType(typeRaw);
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
    await cfg.update(
      "editor.semanticTokenColorCustomizations",
      wantAll,
      vscode.ConfigurationTarget.Workspace
    );
  }
}

async function ensureColorsForNewRules(effectiveRulesMaybe) {
  const cfg = vscode.workspace.getConfiguration();
  const effective = effectiveRulesMaybe || (await getEffectiveRules());

  const userColorsRaw = cfg.get(CFG_COLORS) || {};
  const userColors = {};
  for (const [k, v] of Object.entries(userColorsRaw))
    userColors[sanitizeType(k)] = v;

  const baseColors = {};
  for (const [k, v] of Object.entries(defaultColors))
    baseColors[sanitizeType(k)] = v;

  const mergedColors = { ...baseColors, ...userColors };

  const toAdd = {};
  for (const r of effective) {
    const t = r.type;
    if (!mergedColors[t]) {
      toAdd[t] = { foreground: colorForType(t), fontStyle: "" };
    }
  }
  if (Object.keys(toAdd).length === 0) return;

  const nextUserColors = { ...userColors, ...toAdd };
  await cfg.update(
    CFG_COLORS,
    nextUserColors,
    vscode.ConfigurationTarget.Workspace
  );
}

/* =========================================================================
 * 설정 정규화(유효성) — 잘못된 regex/중복 type 정리
 * ========================================================================= */
async function validateNormalizeAndPersistRules() {
  const cfg = vscode.workspace.getConfiguration();
  const userRules = cfg.get(CFG_RULES) || [];
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

  const changed =
    normalized.length !== userRules.length ||
    userRules.some((r) => r && r.type && r.type !== sanitizeType(r.type));

  if (changed) {
    await cfg.update(
      CFG_RULES,
      normalized,
      vscode.ConfigurationTarget.Workspace
    );
  }
}

/* =========================================================================
 * Formatter (그대로 유지)
 * ========================================================================= */
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

/* =========================================================================
 * Utils
 * ========================================================================= */
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
  // VS Code에서 문제될 수 있는 문자는 안전하게 '_'로 치환
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

module.exports = { activate, deactivate };
