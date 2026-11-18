#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")"
if ! command -v node >/dev/null 2>&1; then
  echo "请先安装 Node.js 24，再重新运行本脚本。https://nodejs.org/"
  exit 1
fi
if ! xcodebuild -version >/dev/null 2>&1; then
  echo "请先安装并打开 Xcode 26 或更新版本，完成初始设置。"
  exit 1
fi
node -e 'if(Number(process.versions.node.split(".")[0])<22)throw new Error("需要 Node.js 22 或更新版本，推荐24")'
npm ci
npm run build
npx cap sync ios
open ios/App/App.xcodeproj
echo "已打开 iPhone 工程。选择 App → Signing & Capabilities → Team，选自己的 Personal Team，再选择连接的 iPhone 并点击运行。"
