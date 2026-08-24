#!/usr/bin/env bash
# 微信读书笔记工作台 · Mac/Linux 启动器（与 Windows 的 bat 同一套自愈逻辑）
cd "$(dirname "$0")"

if [ ! -f config.json ] && [ -f config.example.json ]; then
  cp config.example.json config.json
  echo "[初始化] 已从模板生成 config.json（默认约定：Obsidian 库放在本项目旁边）"
fi
if [ ! -d node_modules ]; then
  echo "[初始化] 正在安装后端依赖..."
  npm install || { echo "安装失败：请确认已安装 Node.js >= 20（https://nodejs.org）"; exit 1; }
fi
if [ ! -d web/dist ]; then
  echo "[初始化] 正在构建前端界面（几分钟）..."
  (cd web && npm install && npm run build) || exit 1
fi

echo "正在启动微信读书笔记工作台（Ctrl+C 退出）..."
node server/index.js &
SERVER_PID=$!
sleep 2
( xdg-open http://localhost:5175 2>/dev/null || open http://localhost:5175 2>/dev/null ) &
wait $SERVER_PID
