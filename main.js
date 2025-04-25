const vscode = require("vscode");
const pandabtSettings = require("./pandabt/pandabt-settings");

/**
 * @param {vscode.ExtensionContext} context
 */
function activate(context) {
  console.log(
    'Congratulations, your extension "pandabt-helper" is now active!'
  );

  const disposableTest = vscode.commands.registerCommand(
    "pandabt-helper.test",
    () => {
      vscode.window.showInformationMessage("Test Button Clicked!");
    }
  );
  context.subscriptions.push(disposableTest);

  // "pandabt.applyDefaultColor" 값이 true일 때만 색상 규칙을 적용
  const applyColor = vscode.workspace
    .getConfiguration()
    .get("pandabt.applyDefaultColor", true);

  if (applyColor) {
    // 기본 색상 규칙 적용 (예시)
    vscode.workspace.getConfiguration().update(
      "editor.tokenColorCustomizations",
      {
        ...pandabtSettings.tmColor,
      },
      vscode.ConfigurationTarget.Global
    ); // 전역 설정으로 업데이트
  } else {
    // 색상 규칙 비활성화 (옵션에 따라 변경 가능)
    vscode.workspace
      .getConfiguration()
      .update(
        "editor.tokenColorCustomizations",
        {},
        vscode.ConfigurationTarget.Global
      );
  }
}

// This method is called when your extension is deactivated
function deactivate() {}

module.exports = {
  activate,
  deactivate,
};
