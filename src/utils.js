// src/utils.js
const vscode = require("vscode");

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
  // g를 제외한 유효한 플래그만 추출 (g는 buildGlobalRegex에서 추가)
  const s = (flags || "").replace(/[^imsuy]/g, "");
  return [...new Set(s)].join("");
}

// 사용자 타입 키(pbt.tree 등)를 semantic token type(문자/숫자/_)로 매핑
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

/**
 * 한 줄을 스캔해 “주석이 아닌 코드 구간” 스팬 계산.
 * @param {string} text
 * @param {boolean} inBlockComment
 * @returns {{spans: Array<[number,number]>, inBlockComment: boolean}}
 */
function computeCodeSpansForLine(text, inBlockComment) {
  const spans = [];
  let i = 0;
  let inString = false; // " ... "
  let escape = false;
  let spanStart = null;

  const pushSpan = (start, end) => {
    if (start != null && end != null && end > start) spans.push([start, end]);
  };

  while (i < text.length) {
    const ch = text[i];
    const next = i + 1 < text.length ? text[i + 1] : "";

    if (inString) {
      // 문자열 내부
      if (escape) {
        escape = false;
        i++;
        continue;
      }
      if (ch === "\\") {
        escape = true;
        i++;
        continue;
      }
      if (ch === '"') {
        inString = false;
        i++;
        continue;
      }
      // 코드 스팬 중이 아니면 시작
      if (spanStart == null) spanStart = i;
      i++;
      continue;
    }

    if (inBlockComment) {
      // 블록 주석 끝 찾기
      if (ch === "*" && next === "/") {
        inBlockComment = false;
        i += 2;
      } else {
        i++;
      }
      // 주석 구간은 스팬으로 잡지 않음
      continue;
    }

    // 주석/문자열 시작 토큰 검사 (inString false, inBlock false인 경우만)
    if (ch === "/" && next === "/") {
      // 라인 주석 시작: 지금까지의 코드 스팬 마감
      pushSpan(spanStart, i);
      spanStart = null;
      // 이후 전부 주석 → 라인 종료
      break;
    }
    if (ch === "/" && next === "*") {
      // 블록 주석 시작: 지금까지의 코드 스팬 마감
      pushSpan(spanStart, i);
      spanStart = null;
      inBlockComment = true;
      i += 2;
      continue;
    }
    if (ch === '"') {
      // 문자열 시작: 코드 스팬 중이 아니면 시작
      if (spanStart == null) spanStart = i;
      inString = true;
      i++;
      continue;
    }

    // 일반 코드 문자
    if (spanStart == null) spanStart = i;
    i++;
  }

  // 줄 끝 처리: 블록 주석이 아닐 때만 스팬 마감
  if (!inBlockComment) {
    pushSpan(spanStart, text.length);
  }
  return { spans: spans.filter(([, e]) => e > 0), inBlockComment };
}

/** 매치가 codeSpans 중 하나에 완전히 포함되는지 검사 */
function matchInsideSpans(start, end, spans) {
  for (const [s, e] of spans) {
    if (start >= s && end <= e) return true;
  }
  return false;
}

module.exports = {
  debounce,
  buildGlobalRegex,
  canCompileRegex,
  normalizeFlags,
  mapTypeKey,
  isSettingsJson,
  getScopeForSettingsDoc,
  scopeHasObject,
  colorForType,
  computeCodeSpansForLine,
  matchInsideSpans,
};
