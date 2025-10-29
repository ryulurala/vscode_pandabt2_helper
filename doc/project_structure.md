# 🐼 Panda BT 2.0 Helper

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
