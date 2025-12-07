#!/bin/bash

# 进入项目根目录
cd "$(dirname "$0")/.."

echo "生成简单图标..."

# 检查是否安装 ImageMagick
if ! command -v convert &> /dev/null; then
  echo "⚠️  未安装 ImageMagick"
  echo ""
  echo "安装方法:"
  echo "  brew install imagemagick"
  echo ""
  echo "或者使用在线工具:"
  echo "  https://www.favicon-generator.org/"
  exit 1
fi

# 生成 128x128 图标
convert -size 128x128 xc:'#3b82f6' \
  -pointsize 60 -fill white -font Arial-Bold \
  -gravity center -annotate +0+0 "OC" \
  icon.png

echo "✓ 图标已生成: icon.png (128x128)"
echo ""
echo "建议使用专业设计工具创建更好的图标"
