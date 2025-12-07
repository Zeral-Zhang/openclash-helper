#!/bin/bash

# 进入项目根目录
cd "$(dirname "$0")/.."

# 清理旧的打包文件
rm -f openclash-helper.zip

# 创建 ZIP 包(排除不需要的文件)
zip -r openclash-helper.zip . \
  -x "*.git*" \
  -x "*.DS_Store" \
  -x "node_modules/*" \
  -x "scripts/*" \
  -x "*.md"

echo "✓ 打包完成: openclash-helper.zip"
echo "文件大小: $(du -h openclash-helper.zip | cut -f1)"
echo ""
echo "可以上传到 Chrome Web Store 了!"
