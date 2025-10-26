// main.js
const vscode = require("vscode");
const { loadBaseConfiguration } = require("./src/config-loader");
const { debounce, isSettingsJson } = require("./src/utils");
const {
  CFG_CONFIG,
  buildMergedTokensAndColors,
  mirrorColorsToEditorCustomizations,
  autoInjectDefaultsOnSettingsOpen,
} = require("./src/settings-controller");
const { RegexSemanticProvider } = require("./src/semantic-provider");
const { registerFormatter } = require("./src/formatter");

let semanticRegistration = null;
let providerInstance = null;
let defaultCfg = null;

/* ====================== Provider Rebuild Logic ====================== */
async function rebuildSemanticProvider(context) {
  if (!defaultCfg) return;

  const { effectiveTokens } = buildMergedTokensAndColors(defaultCfg);
  const tokenTypes = effectiveTokens.map((r) => r.type);
  const legend = new vscode.SemanticTokensLegend(tokenTypes, []);

  providerInstance = new RegexSemanticProvider(legend, effectiveTokens);

  if (semanticRegistration) semanticRegistration.dispose();

  semanticRegistration =
    vscode.languages.registerDocumentSemanticTokensProvider(
      { language: "pandabt" },
      providerInstance,
      legend
    );

  if (context) {
    context.subscriptions.push(semanticRegistration);
  }
}

/* =========================== Activation ============================ */
async function activate(context) {
  // 1. 기본 설정 로드
  defaultCfg = loadBaseConfiguration(context.extensionPath);
  console.log(`[pandabt-helper] activate v${defaultCfg.version}`);

  // 2. Formatter 등록
  registerFormatter(context);

  // 3. 초기 색상 미러링 및 Semantic Provider 등록
  await mirrorColorsToEditorCustomizations(defaultCfg);
  await rebuildSemanticProvider(context);
  providerInstance?.refresh?.();

  // 4. 설정 변경 이벤트 리스너 등록
  const onCfgChanged = debounce(async (e) => {
    if (
      !e ||
      e.affectsConfiguration(CFG_CONFIG) ||
      e.affectsConfiguration("editor.semanticTokenColorCustomizations") ||
      e.affectsConfiguration("editor.semanticHighlighting.enabled")
    ) {
      await mirrorColorsToEditorCustomizations(defaultCfg);
      await rebuildSemanticProvider(context);
      providerInstance?.refresh?.();
    }
  }, 60);
  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration(onCfgChanged)
  );

  // 5. [🌟 수정] GUI 버튼 또는 커맨드 팔레트를 통한 수동 주입 명령어 등록
  const injectDefaultsCommand = vscode.commands.registerCommand(
    "pandabt-helper.injectDefaultSettings",
    async () => {
      // doc을 null로 전달하여 settings-controller.js가 글로벌(User) 설정을 대상으로 하도록 유도합니다.
      await autoInjectDefaultsOnSettingsOpen(null, defaultCfg);

      // 사용자에게 알림
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

  // 🌟 [제거] settings.json이 열릴 때 자동 주입하는 리스너는 제거합니다.

  // 6. settings.json 저장 시 새로고침
  context.subscriptions.push(
    vscode.workspace.onDidSaveTextDocument(
      debounce(async (doc) => {
        if (isSettingsJson(doc)) {
          await mirrorColorsToEditorCustomizations(defaultCfg);
          await rebuildSemanticProvider(context);
          providerInstance?.refresh?.();
        }
      }, 50)
    )
  );

  // 7. 편집기 전환/문서 열림 이벤트에서 토큰 새로고침
  context.subscriptions.push(
    vscode.window.onDidChangeActiveTextEditor((ed) => {
      if (ed?.document?.languageId === "pandabt") providerInstance?.refresh?.();
    }),
    vscode.workspace.onDidOpenTextDocument((doc) => {
      if (doc?.languageId === "pandabt") providerInstance?.refresh?.();
    })
  );
}

async function deactivate() {
  if (semanticRegistration) semanticRegistration.dispose();
  providerInstance = null;
  defaultCfg = null;
}

module.exports = { activate, deactivate };
