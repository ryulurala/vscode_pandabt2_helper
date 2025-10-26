const vscode = require("vscode");
const {
  buildGlobalRegex,
  computeCodeSpansForLine,
  matchInsideSpans,
} = require("./utils");

/**
 * 정규식을 기반으로 문서에 Semantic Tokens을 제공하는 클래스입니다.
 */
class RegexSemanticProvider {
  /**
   * @param {vscode.SemanticTokensLegend} legend - 토큰 타입 및 수정자 정의
   * @param {Array<object>} tokens - { type, match, flags? } 형태의 토큰 규칙 배열
   */
  constructor(legend, tokens) {
    this.legend = legend;
    this._em = new vscode.EventEmitter();
    this.onDidChangeSemanticTokens = this._em.event;

    // 토큰 타입 문자열 → 인덱스 맵 생성
    const typeToIndex = new Map(legend.tokenTypes.map((t, i) => [t, i]));

    // 정규식 컴파일 및 인덱스 매핑
    this.compiled = tokens
      .map((r) => {
        const re = buildGlobalRegex(r.match, r.flags);
        const idx = typeToIndex.get(r.type);
        return re && idx != null ? { re, idx } : null;
      })
      .filter(Boolean); // 유효한 정규식만 필터링
  }

  /**
   * Semantic Token 이벤트를 발생시켜 토큰 재계산을 트리거합니다.
   */
  refresh() {
    this._em.fire();
  }

  /**
   * 현재 문서에 대한 Semantic Tokens을 제공합니다.
   * @param {vscode.TextDocument} doc - 분석할 문서
   * @returns {Promise<vscode.SemanticTokens>}
   */
  async provideDocumentSemanticTokens(doc) {
    const b = new vscode.SemanticTokensBuilder(this.legend);
    if (!this.compiled.length) return b.build();

    let inBlockComment = false; // 멀티라인 블록 주석 상태

    for (let line = 0; line < doc.lineCount; line++) {
      const text = doc.lineAt(line).text;

      // 1. 라인별로 “주석이 아닌 코드 구간” 계산
      const r = computeCodeSpansForLine(text, inBlockComment);
      inBlockComment = r.inBlockComment; // 상태 업데이트
      const codeSpans = r.spans; // Array<[start,end)>

      if (codeSpans.length === 0) continue;

      // 2. 각 컴파일된 정규식을 실행하여 토큰 매칭
      for (const { re, idx } of this.compiled) {
        re.lastIndex = 0;
        let m;
        while ((m = re.exec(text)) !== null) {
          const start = m.index;
          const len = m[0].length;
          const end = start + len;

          // 3. 매치가 코드 스팬 내부에 완전히 포함될 때만 토큰 푸시
          if (len > 0 && matchInsideSpans(start, end, codeSpans)) {
            b.push(line, start, len, idx, 0); // modifier는 0 (사용 안 함)
          }

          // 무한루프 방지: 매치 길이가 0일 경우 (주로 lookahead/lookbehind에서 발생)
          if (m.index === re.lastIndex) re.lastIndex++;
        }
      }
    }
    return b.build();
  }
}

module.exports = { RegexSemanticProvider };
