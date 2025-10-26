# 🐼 Panda BT 2.0 Helper

![GitHub package.json version](https://img.shields.io/github/package-json/v/ryulurala/vscode-pandabt2-helper?style=for-the-badge)
![GitHub License](https://img.shields.io/github/license/ryulurala/vscode-pandabt2-helper?style=for-the-badge)

[![Visual Studio Marketplace Link](https://img.shields.io/badge/Visual%20Studio%20Marketplace-black?style=for-the-badge&logo=visualstudiocode)](https://marketplace.visualstudio.com/items?itemName=ryulurala.pandabt-helper)
![Visual Studio Marketplace Downloads](https://img.shields.io/visual-studio-marketplace/d/ryulurala.pandabt-helper?style=for-the-badge)
![Visual Studio Marketplace Installs](https://img.shields.io/visual-studio-marketplace/i/ryulurala.pandabt-helper?style=for-the-badge)

## Overview

**Panda BT 2.0 Helper**는 [Panda BT 2 (Unity Asset)](https://assetstore.unity.com/packages/tools/behavior-ai/panda-bt-2-274073)를 사용하는 개발자가 Visual Studio Code에서 `.pbt` 파일을 더 편리하게 편집할 수 있도록 만든 확장입니다.

이 확장은 Panda BT 2.0 사용자 경험을 개선하기 위해 직접 개발되었으며, **텍스트 하이라이팅**과 **자동 포맷팅**을 통해 보다 빠르고 일관된 BT 스크립팅 작업을 지원합니다.

## ✨ Features

### ✅ 텍스트 하이라이팅

|            Text Highlighting            |
| :-------------------------------------: |
| ![highlighing](img/ex-highlighting.gif) |

- `.pbt` 확장자를 위한 Panda BT 2 전용 하이라이팅 규칙을 제공합니다.
- 커맨드, 태스크, 주석 등의 가독성을 향상시킵니다.

### ✅ 포맷팅 (Format on Save)

|           Text Formatting            |
| :----------------------------------: |
| ![formatting](img/ex-formatting.gif) |

- VS Code에서 저장 시 자동으로 문서를 포맷합니다.
- 코드 스타일을 일관되게 유지할 수 있습니다.

## 🖥 Requirements

- Visual Studio Code **v1.99.0 이상**
- Node.js **v22.14.0** (Extension 빌드 기준)

## ⚙ Commands

| Command Name                                            | Description                                                                                                                                                                                  |
| ------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `PandaBT Helper: Add Default Template to settings.json` | 개발자가 지정한 기본 색상 설정을 `settings.json`에 추가합니다. 추가된 설정을 수정하여 텍스트 컬러를 수정할 수 있습니다. 또는 해당 규격으로 토큰을 추가해 텍스트의 색상을 추가할 수 있습니다. |

## 🔧 Configuration

설치하면 `settings.json`에 자동으로 아래 설정이 반영됩니다:

```json
"pandabt-helper.configuration": {
    "version": "0.1.0",
    "tokens": {
      "pbt.tree": {
        "match": "(\\b(tree)\\b|^\\s*#\\w+)",
        "foreground": "#E06C75",
        "fontStyle": "bold"
      },
      "pbt.composite": {
        "match": "\\b(sequence|fallback|parallel|race)\\b",
        "foreground": "#E5C07B"
      },
      ...
    }
}
```

## 🏗 Project Structure

이 확장 프로그램의 주요 구성 요소와 역할은 다음과 같습니다:

```txt
pandabt-helper/
├── main.js
├── config/
│ ├── language-configuration.json
│ ├── pandabt.default.tokens.json
│ └── pandabt.tmLanguage.json
└── src/
    ├── config-loader.js
    ├── utils.js
    ├── settings-controller.js
    ├── semantic-provider.js
    └── formatter.js
```

| 파일/경로                                             | 역할                                                                                                                                                                                                           |
| :---------------------------------------------------- | :------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **`main.js`**                                         | **진입점 및 확장 프로그램 생명주기 관리:** VS Code가 확장을 로드할 때 실행되는 메인 파일입니다. 모든 기능을 통합하고, 활성화(`activate`) 및 비활성화(`deactivate`) 시점에 필요한 리소스를 등록하고 해제합니다. |
| **`config/`**                                         | **언어 정의 파일:** Panda BT 언어 정의를 위한 정적 설정 파일이 포함되어 있습니다.                                                                                                                              |
| &nbsp;&nbsp;&nbsp;&nbsp;`language-configuration.json` | 언어의 주석, 괄호 쌍, 자동 들여쓰기 규칙 등을 정의합니다.                                                                                                                                                      |
| &nbsp;&nbsp;&nbsp;&nbsp;`pandabt.default.tokens.json` | VS Code `settings.json`에 추가할 기본 텍스트 하이라이팅 토큰 및 스타일 정의를 포함합니다.                                                                                                                      |
| &nbsp;&nbsp;&nbsp;&nbsp;`pandabt.tmLanguage.json`     | TextMate 문법 규칙을 정의하여 기본적인 구문 하이라이팅을 구현합니다.                                                                                                                                           |
| **`src/`**                                            | **핵심 로직 구현:** 확장 프로그램의 주요 기능을 담당하는 모듈들이 포함되어 있습니다.                                                                                                                           |
| &nbsp;&nbsp;&nbsp;&nbsp;`config-loader.js`            | **설정 로더:** `config/` 디렉토리의 정적 파일들을 읽고 애플리케이션에서 사용하기 쉬운 형태로 정규화합니다.                                                                                                     |
| &nbsp;&nbsp;&nbsp;&nbsp;`utils.js`                    | **범용 유틸리티:** 확장 프로그램 전반에 걸쳐 사용되는 재사용 가능한 헬퍼 함수(예: 문자열 처리, 정규식 관련)를 모아놓습니다.                                                                                    |
| &nbsp;&nbsp;&nbsp;&nbsp;`settings-controller.js`      | **설정 관리:** VS Code의 사용자/작업 공간 설정을 읽고, 기본 설정과 병합하며, 커맨드를 통해 `settings.json`에 기본 템플릿을 쓰는 로직을 담당합니다.                                                             |
| &nbsp;&nbsp;&nbsp;&nbsp;`semantic-provider.js`        | **Semantic Token Provider 구현:** 정적 구문 분석을 넘어 의미론적인 분석을 통해 텍스트 하이라이팅을 제공하는 로직을 구현합니다.                                                                                 |
| &nbsp;&nbsp;&nbsp;&nbsp;`formatter.js`                | **Document Formatter 구현:** `.pbt` 파일의 내용을 분석하여 일관된 들여쓰기 및 스타일 규칙에 따라 코드를 재정렬하는 자동 포맷팅 로직을 담당합니다.                                                              |
