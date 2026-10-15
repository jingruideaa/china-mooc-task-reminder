# Windows 安装与更新

## 1. 准备运行环境

安装 Node.js 22 或更新版本。用 `node --version` 确认版本，使用日常登录 MOOC 的 Edge 配置。项目目录应放在长期保留的位置；登录后启动任务和解压扩展都引用这个目录。

## 2. 创建本地配置

在项目目录打开 PowerShell：

```powershell
npm run setup -- --email student@example.com
```

把示例邮箱替换为自己的邮箱。邮箱地址会写入 `.local/config.json`，只用于本机发信。重新运行 setup 会保留现有连接令牌；使用 `--email` 会更新发件账号与收件人。

SMTP 默认使用 QQ 邮箱的 `smtp.qq.com:587` 和 TLS。发件账号与收件人需要不同时，手动编辑 `.local/config.json` 的 `smtp.from`、`smtp.username` 和 `smtp.to`。其他 SMTP 服务商没有实际验证，可能需要相应修改。

## 3. 保存邮箱授权码

在 QQ 邮箱网页的设置中查找账户或安全相关的 POP3/SMTP 服务选项，按邮箱提示开通 SMTP，获取授权码。授权码用于 SMTP，不是 QQ 登录密码。

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\scripts\save-credential.ps1
```

按提示输入授权码，字符会隐藏。脚本把授权码保存到当前 Windows 用户的“Windows 凭据 → 普通凭据”，默认目标名 `ChinaMOOC-QQSMTP`。

切换邮箱或重置授权码后，更新本地配置并重新执行此脚本。同一个凭据目标由多个安装共享时，更新它也会影响其他安装；需要隔离时修改 `smtp.credentialTarget`。

## 4. 启动邮件服务

```powershell
npm start
```

出现 `listening on 127.0.0.1:8765` 后，保持窗口运行。浏览器访问本机 `/health` 只能验证服务存活，不能证明 SMTP 配置正确。用扩展的“立即检查并发邮件”或主动测试命令核对发信结果。

## 5. 加载扩展

在日常浏览器的扩展管理页启用开发人员模式，选择“加载解压缩的扩展”，加载项目内的 `extension` 文件夹。使用同一浏览器配置的现有 MOOC 登录状态。

若扩展提示缺少 `bridge_config.js`，先在项目目录执行 setup，再重新加载扩展。安装后点击“立即检查并发邮件”，核对完整报告，特别留意“需要核实”一栏。

## 6. Windows 登录后自动启动

先在前台服务窗口按 `Ctrl+C`，再运行：

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\scripts\install.ps1
```

脚本注册当前 Windows 用户的交互式登录任务 `ChinaMOOC-MailBridge`，通过隐藏窗口的脚本启动邮件服务。它不会注册每日课程检查任务；每日 20:00 的检查由浏览器扩展触发。

如果系统拒绝注册任务，在同一 Windows 账户的管理员 PowerShell 中重试。不要切换到另一个 Windows 账户，否则将读不到原用户保存的邮箱凭据。

## 更新与迁移

原目录更新代码后，重新运行 setup，在 Edge 中点击扩展的“重新加载”，并重新启动邮件服务。`.local` 目录和授权码不会被 Git 更新覆盖。

已有另一个目录安装的 `ChinaMOOC-MailBridge` 时，安装脚本默认停止并提示人工核对。确认迁移路径、重建本地设置并切换浏览器加载目录后，可以显式运行：

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\scripts\install.ps1 -ReplaceExisting
```

迁移会停止原任务并让同名任务指向新目录。迁移前保留旧目录和本地配置备份，不要同时运行两个占用 8765 端口的服务。新的扩展文件夹会有新的扩展 ID；本项目的本机连接验证不写死扩展 ID。

## 卸载

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\scripts\uninstall.ps1
```

然后在 Edge 中移除扩展。卸载脚本只移除指向当前目录的任务，保留 `.local` 中的报告和设置，以及 Windows 凭据。确认不再需要时，可自行删除本地数据，并在 Windows 凭据管理器中删除对应授权码凭据；如需吊销授权码，在邮箱服务商设置中操作。
