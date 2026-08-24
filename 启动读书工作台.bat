@echo off
chcp 65001 >nul
cd /d %~dp0

rem ---- 新设备自愈：缺什么补什么 ----
if not exist config.json (
  if exist config.example.json (
    copy config.example.json config.json >nul
    echo [初始化] 已从模板生成 config.json（默认约定：Obsidian 库克隆在本项目旁边）
  )
)
if not exist node_modules (
  echo [初始化] 正在安装后端依赖...
  call npm install
  if errorlevel 1 goto :err
)
if not exist web\dist (
  echo [初始化] 正在构建前端界面，需要几分钟...
  call npm --prefix web install
  if errorlevel 1 goto :err
  call npm --prefix web run build
  if errorlevel 1 goto :err
)

echo 正在启动微信读书笔记工作台（关闭弹出的窗口即退出）...
start "weread-workbench" /min cmd /c "node server\index.js"
timeout /t 2 /nobreak >nul
start "" http://localhost:5175
exit /b 0
:err
echo.
echo 初始化失败：请确认已安装 Node.js ^>= 20（https://nodejs.org）
pause
