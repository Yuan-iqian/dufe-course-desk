#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")"
npm ci
npm run build
npx cap sync ios
mkdir -p Mac验证
xcodebuild -project ios/App/App.xcodeproj -scheme App -destination 'generic/platform=iOS Simulator' -derivedDataPath Mac验证/DerivedData CODE_SIGNING_ALLOWED=NO build 2>&1 | tee Mac验证/编译日志.txt
echo "模拟器编译通过。实际安装仍需在 Xcode 中选择个人签名和 iPhone。"
