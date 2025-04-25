const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const settingsDir = path.join(root, "pandabt-settings");

const tmColorPath = path.join(settingsDir, "pandabt.default.tmColor.json");

// 파일 읽기
const tmColor = JSON.parse(fs.readFileSync(tmColorPath, "utf-8"));

// export
module.exports = {
  tmColor,
};
