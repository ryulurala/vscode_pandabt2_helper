const vscode = require("vscode");
const pandabtSettings = require("./pandabt/pandabt-settings");

/**
 * @param {vscode.ExtensionContext} context
 */
async function activate(context) {
  console.log(
    'Congratulations, your extension "pandabt-helper" is now active!'
  );

  registerFormatter(context);
  registerDefaultTextColor(context);
}

// This method is called when your extension is deactivated
async function deactivate() {}

// ### Funcs ###
async function registerFormatter(context) {
  const formatter = vscode.languages.registerDocumentFormattingEditProvider(
    "pandabt",
    {
      provideDocumentFormattingEdits(document) {
        const edits = [];
        const linesToDelete = []; // 삭제할 줄 번호를 저장하는 배열

        for (let i = 0; i < document.lineCount; i++) {
          const line = document.lineAt(i);
          const originalText = line.text;

          const isBlankLine = originalText.trim() === "";
          const isOnlyCommentMark = originalText.trim() === "//";
          if (isOnlyCommentMark || isBlankLine) {
            linesToDelete.push(i);

            continue;
          }

          // 뒤에 공백 제거
          const trimmedText = originalText.trimEnd();

          const isCommentLine =
            trimmedText.trimStart().startsWith("//") ||
            trimmedText.trimStart().startsWith("/*");

          if (isCommentLine || isBlankLine) continue;

          // 스페이스와 탭을 계산
          let leadingTabs = 0;
          let leadingSpaces = 0;
          for (let j = 0; j < trimmedText.length; j++) {
            if (trimmedText[j] === "\t") {
              leadingTabs++;
            } else if (trimmedText[j] === " ") {
              leadingSpaces++;
            } else {
              break; // 공백과 탭 외를 만나면 계산 멈추기
            }
          }

          console.log(
            `Origin: leadingSpaces: ${leadingSpaces}, leadingTabs: ${leadingTabs}`
          );

          // 스페이스 개수에 따라 탭 수 결정
          const spaceToTabCount = Math.floor((leadingSpaces + 1) / 4);

          console.log(
            `leadingSpaces: ${leadingSpaces} -> tabCount: ${spaceToTabCount}`
          );

          // 기존 탭을 유지하고 스페이스만 탭으로 변환
          const newIndent = "\t".repeat(leadingTabs + spaceToTabCount);
          const newText = newIndent + trimmedText.trimStart();

          if (newText !== originalText) {
            edits.push(vscode.TextEdit.replace(line.range, newText));
          }
        }

        // 삭제할 줄을 반영
        const sortedLinesToDelete = linesToDelete.sort((a, b) => b - a); // 역순으로 정렬하여 삭제

        sortedLinesToDelete.forEach((lineIndex) => {
          const line = document.lineAt(lineIndex);
          edits.push(vscode.TextEdit.delete(line.range)); // 해당 줄을 삭제
        });

        return edits;
      },
    }
  );

  context.subscriptions.push(formatter);
}

async function registerDefaultTextColor(context) {
  // Settings command registration
  const commandApplyDefaultColor = vscode.commands.registerCommand(
    "pandabt-helper.applyDefaultColor",
    () => {
      applyDefaultTextColors();

      vscode.window.showInformationMessage("PandaBT Default Color Applied");
    }
  );
  context.subscriptions.push(commandApplyDefaultColor);

  const config = vscode.workspace.getConfiguration();
  const currentColors = config.get("editor.tokenColorCustomizations") || {};

  const currentRules = currentColors.textMateRules || [];

  const existingScopes = new Set();
  for (const rule of currentRules) {
    if (typeof rule.scope === "string") {
      existingScopes.add(rule.scope);
    } else if (Array.isArray(rule.scope)) {
      for (const scope of rule.scope) {
        existingScopes.add(scope);
      }
    }
  }

  // 아직 없는 후보들
  const newRules = pandabtSettings.tmColor.textMateRules.filter((rule) => {
    if (typeof rule.scope === "string") {
      return !existingScopes.has(rule.scope);
    } else if (Array.isArray(rule.scope)) {
      return !rule.scope.some((scope) => existingScopes.has(scope));
    }
  });

  const updatedColors = {
    ...currentColors,
    textMateRules: [...currentRules, ...newRules],
  };

  await config.update(
    "editor.tokenColorCustomizations",
    updatedColors,
    vscode.ConfigurationTarget.Global
  );
}

async function applyDefaultTextColors() {
  const config = vscode.workspace.getConfiguration();
  const currentColors = config.get("editor.tokenColorCustomizations") || {};
  const currentRules = currentColors.textMateRules || [];

  // 현재 있는 scope를 찾아서 업데이트 or 새로 추가
  const updatedRules = [...currentRules];

  for (const newRule of pandabtSettings.tmColor.textMateRules) {
    let found = false;

    for (let i = 0; i < updatedRules.length; i++) {
      const existingRule = updatedRules[i];

      // scope가 string이든 array든 처리
      const existingScopes =
        typeof existingRule.scope === "string"
          ? [existingRule.scope]
          : Array.isArray(existingRule.scope)
          ? existingRule.scope
          : [];

      const newScopes =
        typeof newRule.scope === "string"
          ? [newRule.scope]
          : Array.isArray(newRule.scope)
          ? newRule.scope
          : [];

      if (existingScopes.some((scope) => newScopes.includes(scope))) {
        // 같은 scope가 있으면 settings만 업데이트
        updatedRules[i] = {
          ...existingRule,
          settings: {
            ...existingRule.settings,
            ...newRule.settings,
          },
        };
        found = true;
        break;
      }
    }

    if (!found) {
      updatedRules.push(newRule);
    }
  }

  const updatedColors = {
    ...currentColors,
    textMateRules: updatedRules,
  };

  await config.update(
    "editor.tokenColorCustomizations",
    updatedColors,
    vscode.ConfigurationTarget.Global
  );
}

module.exports = {
  activate,
  deactivate,
};
