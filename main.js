// main.js

const vscode = require("vscode");
const { loadBaseConfiguration } = require("./src/config-loader");
const { isSettingsJson, debounce } = require("./src/utils");
const {
  CFG_CONFIG,
  autoInjectDefaultsOnSettingsOpen,
  buildAndRegisterSemanticProvider,
  createSettingsWatcher,
} = require("./src/settings-controller");
const { registerFormatter } = require("./src/formatter");

/** @type {vscode.Disposable | null} */
let semanticRegistration = null; // 등록된 SemanticTokensProvider의 Disposable
/** @type {object | null} */
let defaultCfg = null; // 기본 설정 데이터

/**
 * 확장 프로그램 활성화 시 호출됩니다.
 * @param {vscode.ExtensionContext} context - 확장 프로그램 컨텍스트
 */
async function activate(context) {
  // 1. 기본 설정 로드
  defaultCfg = loadBaseConfiguration(context.extensionPath);
  console.log(`[pandabt-helper] activate v${defaultCfg.version}`);

  // 2. Formatter 등록
  registerFormatter(context);

  // 3. 색상 미러링 및 Semantic Provider 등록 (로직은 settings-controller로 위임)
  semanticRegistration = await buildAndRegisterSemanticProvider(
    context,
    defaultCfg
  );
  context.subscriptions.push(semanticRegistration);

  // 4. 설정 변경 이벤트 리스너 등록 (로직은 settings-controller로 위임)
  const settingsWatcher = createSettingsWatcher(
    context,
    defaultCfg,
    CFG_CONFIG
  );
  context.subscriptions.push(settingsWatcher);

  // 5. 수동 주입 명령어 등록
  const injectDefaultsCommand = vscode.commands.registerCommand(
    "pandabt-helper.injectDefaultSettings",
    async () => {
      // doc을 null로 전달하여 글로벌(User) 설정을 대상으로 함
      await autoInjectDefaultsOnSettingsOpen(null, defaultCfg);

      const openSettings = "Open User settings.json";
      const result = await vscode.window.showInformationMessage(
        "PandaBT Helper: Default settings template injected into User settings.json.",
        openSettings
      );

      if (result === openSettings) {
        vscode.commands.executeCommand("workbench.action.openSettingsJson");
      }
    }
  );
  context.subscriptions.push(injectDefaultsCommand);

  // 6. settings.json 저장 시 새로고침 (설정 변경 이벤트와 동일한 기능 수행)
  context.subscriptions.push(
    vscode.workspace.onDidSaveTextDocument(
      debounce(async (doc) => {
        if (isSettingsJson(doc)) {
          // Provider를 다시 빌드하여 변경된 설정 반영
          await buildAndRegisterSemanticProvider(context, defaultCfg);
        }
      }, 50)
    )
  );
}

/**
 * 확장 프로그램 비활성화 시 호출됩니다.
 */
async function deactivate() {
  if (semanticRegistration) semanticRegistration.dispose();
  defaultCfg = null;
}

module.exports = { activate, deactivate };
