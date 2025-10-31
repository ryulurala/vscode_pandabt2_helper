const vscode = require("vscode");

/**
 * 문서 포맷터를 등록합니다.
 * @param {vscode.ExtensionContext} context - 확장 프로그램 컨텍스트
 */
function registerFormatter(context) {
  const formatter = vscode.languages.registerDocumentFormattingEditProvider("pandabt", {
    /**
     * 문서 전체 포맷팅을 위한 TextEdit 배열을 제공합니다.
     * 탭/스페이스를 탭으로 변환하고, 불필요한 공백/주석 줄을 삭제합니다.
     * @param {vscode.TextDocument} document - 포맷팅할 문서
     * @returns {vscode.TextEdit[]} 적용할 편집 목록
     */
    provideDocumentFormattingEdits(document) {
      const edits = [];
      const linesToDelete = [];

      for (let i = 0; i < document.lineCount; i++) {
        const line = document.lineAt(i);
        const { text: originalText, range } = line;
        const trimmedText = originalText.trimEnd();

        // 1. 삭제 대상 줄 처리 (빈 줄 또는 "//"만 있는 줄)
        const isBlankOrOnlyCommentMark = trimmedText.trim() === "" || trimmedText.trim() === "//";
        if (isBlankOrOnlyCommentMark) {
          linesToDelete.push(i);
          continue;
        }

        const trimmedStartText = trimmedText.trimStart();
        // 2. 주석 줄 처리 (라인 주석 또는 블록 주석 시작)
        const isCommentLine = trimmedStartText.startsWith("//") || trimmedStartText.startsWith("/*");
        if (isCommentLine) continue;

        // 3. 인덴트 계산 및 탭 변환
        let leadingTabs = 0;
        let leadingSpaces = 0;
        for (let j = 0; j < trimmedText.length; j++) {
          if (trimmedText[j] === "\t") {
            leadingTabs++;
          } else if (trimmedText[j] === " ") {
            leadingSpaces++;
          } else {
            break; // 코드가 시작되면 인덴트 계산 종료
          }
        }

        // 4칸 스페이스를 1탭으로 변환 로직
        const spaceToTabCount = Math.floor((leadingSpaces + 1) / 4);
        const newIndent = "\t".repeat(leadingTabs + spaceToTabCount);
        const newText = newIndent + trimmedStartText;

        // 5. 변경 사항 적용
        if (newText !== originalText) {
          edits.push(vscode.TextEdit.replace(range, newText));
        }
      }

      // 6. 삭제할 줄 적용 (역순으로 처리하여 인덱스 문제 방지)
      linesToDelete.sort((a, b) => b - a).forEach((idx) => edits.push(vscode.TextEdit.delete(document.lineAt(idx).range)));

      return edits;
    },
  });
  context.subscriptions.push(formatter);
}

module.exports = { registerFormatter };
