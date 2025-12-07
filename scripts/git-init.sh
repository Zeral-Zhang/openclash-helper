#!/bin/bash

# 进入项目根目录
cd "$(dirname "$0")/.."

echo "OpenClash Helper - Git 初始化脚本"
echo "=================================="
echo ""

# 检查是否已初始化
if [ -d .git ]; then
  echo "⚠️  Git 已初始化"
  git status
  exit 0
fi

# 初始化
echo "1. 初始化 Git 仓库..."
git init

# 添加文件
echo "2. 添加所有文件..."
git add .

# 提交
echo "3. 提交..."
git commit -m "Initial commit: OpenClash Helper Extension

Features:
- Remote sync via LuCI RPC API
- Local storage mode
- Multiple match types (DOMAIN, DOMAIN-SUFFIX, DOMAIN-KEYWORD)
- Smart domain extraction
- Context menu integration
- Initialization wizard
- Visual rule management
- Clash dashboard integration"

echo ""
echo "✓ Git 初始化完成!"
echo ""
echo "下一步:"
echo "1. 在 GitHub 创建新仓库: https://github.com/new"
echo "2. 仓库名: openclash-helper"
echo "3. 执行以下命令关联远程仓库:"
echo ""
echo "   git remote add origin https://github.com/YOUR_USERNAME/openclash-helper.git"
echo "   git branch -M main"
echo "   git push -u origin main"
echo ""
