const vscode = require("vscode");
const { loadComposedConfiguration } = require("./src/config-loader");
const { isSettingsJson, debounce } = require("./src/utils");
const {
  CONFIG_PROPERTY_NAME,
  autoInjectDefaultsOnSettingsOpen,
  buildAndRegisterSemanticProvider,
  createSettingsWatcher,
} = require("./src/settings-controller");

let semanticRegistration = null;
let defaultCfg = null;

async function activate(context) {
  // 1) 사용자 설정 읽기 (inspect)
  const info = vscode.workspace.getConfiguration().inspect(CONFIG_PROPERTY_NAME) || {};
  const userSettings =
    (info.globalValue && typeof info.globalValue === "object" && info.globalValue) ||
    (info.workspaceFolderValue && typeof info.workspaceFolderValue === "object" && info.workspaceFolderValue) ||
    (info.workspaceValue && typeof info.workspaceValue === "object" && info.workspaceValue) ||
    {};

  // 2) 파일 목록 읽기
  const configFilesInfo = vscode.workspace.getConfiguration().inspect("pandabt-helper.configFiles") || {};
  const configFiles =
    (Array.isArray(configFilesInfo.globalValue) && configFilesInfo.globalValue) ||
    (Array.isArray(configFilesInfo.workspaceFolderValue) && configFilesInfo.workspaceFolderValue) ||
    (Array.isArray(configFilesInfo.workspaceValue) && configFilesInfo.workspaceValue) ||
    [];

  const workspaceRoot =
    vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders.length
      ? vscode.workspace.workspaceFolders[0].uri.fsPath
      : null;

  // 3) 합성 설정 로딩
  defaultCfg = loadComposedConfiguration(context.extensionPath, userSettings, configFiles, workspaceRoot);
  console.log(`[pandabt-helper] activate v${defaultCfg.version}`);

  // 이하 동일
  const { registerFormatter } = require("./src/formatter");
  registerFormatter(context);

  semanticRegistration = await buildAndRegisterSemanticProvider(context, defaultCfg);
  context.subscriptions.push(semanticRegistration);

  const settingsWatcher = createSettingsWatcher(context, defaultCfg, CONFIG_PROPERTY_NAME);
  context.subscriptions.push(settingsWatcher);

  const injectDefaultsCommand = vscode.commands.registerCommand("pandabt-helper.injectDefaultSettings", async () => {
    await autoInjectDefaultsOnSettingsOpen(null, defaultCfg);
    const openSettings = "Open User settings.json";
    const result = await vscode.window.showInformationMessage(
      "PandaBT Helper: Default settings template injected into User settings.json.",
      openSettings
    );
    if (result === openSettings) {
      vscode.commands.executeCommand("workbench.action.openSettingsJson");
    }
  });
  context.subscriptions.push(injectDefaultsCommand);

  context.subscriptions.push(
    vscode.workspace.onDidSaveTextDocument(
      debounce(async (doc) => {
        if (isSettingsJson(doc)) {
          // settings.json 바뀌면 합성 재로딩 + 재등록
          const info = vscode.workspace.getConfiguration().inspect(CONFIG_PROPERTY_NAME) || {};
          const userSettings =
            (info.globalValue && typeof info.globalValue === "object" && info.globalValue) ||
            (info.workspaceFolderValue && typeof info.workspaceFolderValue === "object" && info.workspaceFolderValue) ||
            (info.workspaceValue && typeof info.workspaceValue === "object" && info.workspaceValue) ||
            {};

          const configFilesInfo = vscode.workspace.getConfiguration().inspect("pandabt-helper.configFiles") || {};
          const configFiles =
            (Array.isArray(configFilesInfo.globalValue) && configFilesInfo.globalValue) ||
            (Array.isArray(configFilesInfo.workspaceFolderValue) && configFilesInfo.workspaceFolderValue) ||
            (Array.isArray(configFilesInfo.workspaceValue) && configFilesInfo.workspaceValue) ||
            [];

          defaultCfg = loadComposedConfiguration(context.extensionPath, userSettings, configFiles, workspaceRoot);
          await buildAndRegisterSemanticProvider(context, defaultCfg);
        }
      }, 80)
    )
  );
}

async function deactivate() {
  if (semanticRegistration) semanticRegistration.dispose();
  defaultCfg = null;
}

module.exports = { activate, deactivate };
