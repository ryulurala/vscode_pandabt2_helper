const vscode = require("vscode");

/**
 * 디바운스 래퍼 함수를 생성합니다.
 * @param {function} fn - 디바운스할 함수
 * @param {number} [ms=80] - 대기 시간 (밀리초)
 * @returns {function(...any): void} 디바운스된 함수
 */
function debounce(fn, ms = 80) {
  let t;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
}

/**
 * 정규식 소스와 플래그를 사용하여 전역(g) 플래그가 포함된 RegExp 객체를 생성합니다.
 * 컴파일에 실패하면 null을 반환합니다.
 * @param {string} source - 정규식 소스 문자열
 * @param {string} [flags] - 추가 플래그 문자열
 * @returns {RegExp | null} 전역 플래그가 추가된 RegExp 객체
 */
function buildGlobalRegex(source, flags) {
  try {
    const f = new Set((flags || "").split("").filter(Boolean));
    f.add("g");
    return new RegExp(source, [...f].join(""));
  } catch {
    return null;
  }
}

/**
 * 주어진 소스와 플래그로 정규식을 컴파일할 수 있는지 확인합니다.
 * @param {string} source - 정규식 소스 문자열
 * @param {string} [flags] - 플래그 문자열
 * @returns {boolean} 컴파일 가능 여부
 */
function canCompileRegex(source, flags) {
  try {
    new RegExp(source, normalizeFlags(flags));
    return true;
  } catch {
    return false;
  }
}

/**
 * 정규식 플래그 문자열에서 유효한 플래그만 추출하고 중복을 제거합니다.
 * 'g' 플래그는 여기서 제외됩니다.
 * @param {string} [flags] - 원본 플래그 문자열
 * @returns {string} 정규화된 플래그 문자열
 */
function normalizeFlags(flags) {
  // 'g'를 제외한 유효한 플래그(i, m, s, u, y)만 추출
  const s = (flags || "").replace(/[^imsuy]/g, "");
  return [...new Set(s)].join("");
}

/**
 * 사용자 정의 토큰 타입 키(예: pbt.tree)를 VS Code Semantic Token 타입(알파벳/숫자/_)으로 매핑합니다.
 * @param {string} type - 원본 타입 키
 * @returns {string} 정규화된 Semantic Token 타입
 */
function mapTypeKey(type) {
  // 영문, 숫자, _ 만 남기고 모두 제거
  return String(type).replace(/[^A-Za-z0-9_]/g, "_");
}

/**
 * 문서가 settings.json 파일인지 확인합니다.
 * @param {vscode.TextDocument | undefined} doc - 확인할 문서
 * @returns {boolean} settings.json 파일 여부
 */
function isSettingsJson(doc) {
  if (
    doc?.uri?.scheme === "vscode-userdata" &&
    /\/User\/settings\.json$/i.test(doc.uri.path)
  )
    return true;
  try {
    const p = doc?.uri?.fsPath || "";
    // .vscode/settings.json 확인 (워크스페이스/폴더 설정)
    if (/[/\\]\.vscode[/\\]settings\.json$/i.test(p)) return true;
  } catch {}
  return false;
}

/**
 * settings.json 문서의 범위(scope)를 결정합니다.
 * @param {vscode.TextDocument | undefined} doc - settings.json 문서
 * @returns {'user' | 'workspace' | 'folder'} 설정 범위
 */
function getScopeForSettingsDoc(doc) {
  // 1. User/settings.json (Global)
  if (
    doc?.uri?.scheme === "vscode-userdata" &&
    /\/User\/settings\.json$/i.test(doc.uri.path)
  )
    return "user";

  // 2. WorkspaceFolder/.vscode/settings.json (Folder)
  const wf = vscode.workspace.getWorkspaceFolder(doc?.uri);
  if (wf) return "folder";

  // 3. Workspace/.vscode/settings.json (Workspace) - 폴더가 없는 경우
  return "workspace";
}

/**
 * 설정 값에 유효한 템플릿 구조('version' 키)가 포함되어 있는지 확인합니다.
 * @param {any} val - 검사할 설정 값 (globalValue, workspaceValue 등)
 * @returns {boolean} 유효한 템플릿 존재 여부
 */
function configHasValidTemplate(val) {
  return !!(
    val &&
    typeof val === "object" &&
    !Array.isArray(val) &&
    typeof val.version === "string" && // 'version' 키 존재 및 타입 확인
    val.version.length > 0
  );
}

/**
 * 문자열의 간단한 해시 값을 계산합니다.
 * @param {string} s - 해시할 문자열
 * @returns {number} 32비트 정수 해시 값
 */
function hashString(s) {
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = (h * 31 + s.charCodeAt(i)) | 0; // 31을 곱하고 32비트 정수로 변환
  }
  return h;
}

/**
 * HSL 색상 값을 16진수 HEX 문자열로 변환합니다.
 * @param {number} h - Hue (색상, 0-360)
 * @param {number} s - Saturation (채도, 0-100)
 * @param {number} l - Lightness (명도, 0-100)
 * @returns {string} #RRGGBB 형식의 16진수 색상 코드
 */
function hslToHex(h, s, l) {
  s /= 100;
  l /= 100;
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  let r = 0,
    g = 0,
    b = 0;

  if (h < 60) [r, g, b] = [c, x, 0];
  else if (h < 120) [r, g, b] = [x, c, 0];
  else if (h < 180) [r, g, b] = [0, c, x];
  else if (h < 240) [r, g, b] = [0, x, c];
  else if (h < 300) [r, g, b] = [x, 0, c];
  else [r, g, b] = [c, 0, x];

  const toHex = (v) =>
    Math.round((v + m) * 255)
      .toString(16)
      .padStart(2, "0");

  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

/**
 * 토큰 타입 문자열을 기반으로 고유한 기본 색상을 생성합니다.
 * @param {string} type - 토큰 타입 문자열
 * @returns {string} 생성된 HEX 색상 코드
 */
function colorForType(type) {
  // 해시 값을 0~359 범위의 Hue로 변환
  const h = ((hashString(type) % 360) + 360) % 360;
  return hslToHex(h, 55, 65); // 고정된 채도(55)와 명도(65) 사용
}

/**
 * 한 줄을 스캔하여 “주석이 아닌 코드 구간” 스팬을 계산하고,
 * 멀티라인 블록 주석의 상태를 갱신합니다.
 * @param {string} text - 분석할 라인 텍스트
 * @param {boolean} inBlockComment - 이전 라인에서 블록 주석 중이었는지 여부
 * @returns {{spans: Array<[number,number]>, inBlockComment: boolean}} 코드 스팬 배열 및 갱신된 블록 주석 상태
 */
function computeCodeSpansForLine(text, inBlockComment) {
  /** @type {Array<[number, number]>} */
  const spans = [];
  let i = 0;
  let inString = false; // " ... "
  let escape = false; // 이스케이프 문자(\)
  let spanStart = null; // 현재 코드 스팬의 시작 인덱스

  /**
   * 유효한 코드 스팬을 spans 배열에 추가합니다.
   * @param {number | null} start
   * @param {number | null} end
   */
  const pushSpan = (start, end) => {
    if (start != null && end != null && end > start) {
      spans.push([start, end]);
    }
  };

  while (i < text.length) {
    const ch = text[i];
    const next = i + 1 < text.length ? text[i + 1] : "";

    if (inString) {
      // 1. 문자열 내부 처리
      if (escape) {
        escape = false;
        i++;
      } else if (ch === "\\") {
        escape = true;
        i++;
      } else if (ch === '"') {
        inString = false;
        i++;
      } else {
        // 일반 문자: 코드 스팬이 시작되지 않았으면 시작
        if (spanStart == null) spanStart = i;
        i++;
      }
    } else if (inBlockComment) {
      // 2. 블록 주석 내부 처리
      if (ch === "*" && next === "/") {
        inBlockComment = false;
        i += 2;
      } else {
        i++;
      }
      // 주석 구간은 spanStart에 영향을 주지 않음
    } else {
      // 3. 코드 구간 처리 (주석/문자열 외부)

      if (ch === "/" && next === "/") {
        // 라인 주석 시작: 현재 코드 스팬 마감 후 라인 종료
        pushSpan(spanStart, i);
        spanStart = null;
        break; // 이후는 모두 주석
      } else if (ch === "/" && next === "*") {
        // 블록 주석 시작: 현재 코드 스팬 마감 및 블록 주석 시작 상태 설정
        pushSpan(spanStart, i);
        spanStart = null;
        inBlockComment = true;
        i += 2;
      } else if (ch === '"') {
        // 문자열 시작: 코드 스팬이 시작되지 않았으면 시작하고 문자열 내부 상태로 전환
        if (spanStart == null) spanStart = i;
        inString = true;
        i++;
      } else {
        // 일반 코드 문자: 코드 스팬이 시작되지 않았으면 시작
        if (spanStart == null) spanStart = i;
        i++;
      }
    }
  }

  // 줄 끝 처리: 블록 주석이 아닐 때만 스팬 마감
  if (!inBlockComment) {
    pushSpan(spanStart, text.length);
  }

  // 길이가 0인 스팬 제거
  return { spans: spans.filter(([, e]) => e > 0), inBlockComment };
}

/**
 * 주어진 매치 범위(start, end)가 'codeSpans' 중 하나에 완전히 포함되는지 확인합니다.
 * @param {number} start - 매치 시작 인덱스
 * @param {number} end - 매치 끝 인덱스 (exclusive)
 * @param {Array<[number, number]>} spans - 코드 스팬 배열 Array<[start, end)>
 * @returns {boolean} 포함 여부
 */
function matchInsideSpans(start, end, spans) {
  return spans.some(([s, e]) => start >= s && end <= e);
}

module.exports = {
  debounce,
  buildGlobalRegex,
  canCompileRegex,
  normalizeFlags,
  mapTypeKey,
  isSettingsJson,
  getScopeForSettingsDoc,
  configHasValidTemplate,
  colorForType,
  computeCodeSpansForLine,
  matchInsideSpans,
};
