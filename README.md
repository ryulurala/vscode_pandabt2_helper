![GitHub package.json version](https://img.shields.io/github/package-json/v/ryulurala/vscode-pandabt2-helper?style=for-the-badge)
![GitHub License](https://img.shields.io/github/license/ryulurala/vscode-pandabt2-helper?style=for-the-badge)

[![Visual Studio Marketplace Link](https://img.shields.io/badge/Visual%20Studio%20Marketplace-black?style=for-the-badge&logo=visualstudiocode)](https://marketplace.visualstudio.com/items?itemName=ryulurala.pandabt-helper)
![Visual Studio Marketplace Downloads](https://img.shields.io/visual-studio-marketplace/d/ryulurala.pandabt-helper?style=for-the-badge)
![Visual Studio Marketplace Installs](https://img.shields.io/visual-studio-marketplace/i/ryulurala.pandabt-helper?style=for-the-badge)

# 🐼 Panda BT 2.0 Helper

**Panda BT 2.0 Helper**는 Behavior Tree 기반 작업을 위한 **텍스트 하이라이팅 + 포맷팅 지원 VS Code 확장 프로그램**입니다.  
설치만 하면 자동으로 색상과 포맷팅이 적용되어, 개발자가 작성한 BT 노드를 더 쉽게 구분하고 읽을 수 있습니다.

## ✨ Features

- 🟡 **TextMate 기반 텍스트 하이라이팅**
- 🟣 **자동 포맷팅 (Format on Save)**
- 🔁 **기본 색상 규칙 자동 적용**
- 🎨 **개별 스코프 색상 사용자 정의 가능**

---

## 📋 Requirements

- **VS Code** version `1.99` or higher
- Built with **Node.js** `v22.14.0`

---

## ⚙ Commands

| Command                 | Description                                                        | Shortcut |
| ----------------------- | ------------------------------------------------------------------ | -------- |
| **Apply Default Color** | 개발자가 사전에 지정한 TextMate 색상 규칙으로 설정을 재적용합니다. | 없음     |

---

## 🔧 Configuration

설치하면 `settings.json`에 자동으로 아래 설정이 반영됩니다:

```json
"editor.tokenColorCustomizations": {
  "textMateRules": [
    {
      "scope": "pandabt.tree",
      "settings": {
        "foreground": "#E06C75",
        "fontStyle": "bold"
      }
    },
    ...
  ]
}
```
