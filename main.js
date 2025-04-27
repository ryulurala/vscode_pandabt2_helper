const vscode = require("vscode");
const pandabtSettings = require("./pandabt/pandabt-settings");

/**
 * @param {vscode.ExtensionContext} context
 */
async function activate(context) {
  console.log(
    'Congratulations, your extension "pandabt-helper" is now active!'
  );

  const commandApplyDefaultColor = vscode.commands.registerCommand(
    "pandabt-helper.applyDefaultColor",
    () => {
      applyDefaultTextColors();

      vscode.window.showInformationMessage("PandaBT Default Color Applied");
    }
  );
  context.subscriptions.push(commandApplyDefaultColor);

  initTextColors();
}

// This method is called when your extension is deactivated
async function deactivate() {}

async function initTextColors() {
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
