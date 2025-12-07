# 构建脚本

## 可用脚本

### 1. Git 初始化
```bash
./scripts/git-init.sh
```
初始化 Git 仓库并提交所有文件。

### 2. 打包发布
```bash
./scripts/build.sh
```
创建用于上传到 Chrome Web Store 的 ZIP 包。

### 3. 生成图标
```bash
./scripts/generate-icon.sh
```
生成简单的应用图标(需要 ImageMagick)。

## 注意事项

- 所有脚本都会自动切换到项目根目录执行
- 打包时会排除 `scripts` 目录和 `.md` 文件
- 建议在项目根目录执行脚本
