// src/semantic-provider.js
const vscode = require("vscode");
const {
  buildGlobalRegex,
  computeCodeSpansForLine,
  matchInsideSpans,
} = require("./utils");

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

    let inBlockComment = false; // 멀티라인 블록 주석 상태 유지

    for (let line = 0; line < doc.lineCount; line++) {
      const text = doc.lineAt(line).text;

      // 라인별로 “주석이 아닌 코드 구간” 계산
      const r = computeCodeSpansForLine(text, inBlockComment);
      inBlockComment = r.inBlockComment;
      const codeSpans = r.spans; // Array<[start,end)>

      if (codeSpans.length === 0) continue;

      for (const { re, idx } of this.compiled) {
        re.lastIndex = 0;
        let m;
        while ((m = re.exec(text)) !== null) {
          const start = m.index,
            len = m[0].length,
            end = start + len;
          // 매치가 코드 스팬 내부에 완전히 포함될 때만 토큰 푸시
          if (matchInsideSpans(start, end, codeSpans)) {
            if (len > 0) b.push(line, start, len, idx, 0);
          }
          if (m.index === re.lastIndex) re.lastIndex++; // 무한루프 방지
        }
      }
    }
    return b.build();
  }
}

module.exports = { RegexSemanticProvider };
