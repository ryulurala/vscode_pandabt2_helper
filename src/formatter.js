// src/formatter.js
const vscode = require("vscode");

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

          // 주석 줄은 인덴트 변경을 건너김 (isBlankLine은 위에서 처리됨)
          if (isCommentLine) continue;

          // 인덴트 계산 및 탭 변환
          let leadingTabs = 0,
            leadingSpaces = 0;
          for (let j = 0; j < trimmedText.length; j++) {
            if (trimmedText[j] === "\t") leadingTabs++;
            else if (trimmedText[j] === " ") leadingSpaces++;
            else break;
          }

          // 원본 main.js의 로직: (leadingSpaces + 1) / 4 를 사용하여 1~4칸 스페이스를 1탭으로 변환하는 방식
          const spaceToTabCount = Math.floor((leadingSpaces + 1) / 4);
          const newIndent = "\t".repeat(leadingTabs + spaceToTabCount);
          const newText = newIndent + trimmedText.trimStart();

          if (newText !== originalText)
            edits.push(vscode.TextEdit.replace(line.range, newText));
        }

        // 삭제할 줄 역순 처리 (원래 main.js는 line.range를 사용했으므로, 그대로 유지)
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

module.exports = { registerFormatter };
