# 中国大学 MOOC 任务提醒

在平时使用的 Edge 中检查中国大学 MOOC 的在学课程，每天北京时间 **20:00** 发送任务日报。

报告覆盖作业、测验、自评、互评，以及期中、期末和新版考试。扩展沿用当前浏览器的登录状态，在独立后台标签页读取页面，检查后关闭该标签页。

## 功能

- 自动发现全部在学 MOOC 与学校云 SPOC 课程，并处理课程列表分页。
- 分别记录作业提交、自评和互评状态。证据不足时标注“需要核实”。
- 根据可核实的源课程任务编号合并同源记录。
- 列出未完成任务、未来 7 天内到期任务和已逾期项目。
- 每门课程都检查旧版与新版考试区域，列出考试完成状态、开放时间、截止时间和页面提供的答题时长。
- 单列未来 7 天内开放或截止的考试；已交卷但未出分的考试按已提交处理。
- 浏览器通知、中文邮件、邮件发送失败重试和同一报告防重复发送。
- 登录过期或页面读取失败时发送状态提示，避免生成虚假的“全部完成”结论。

## 运行要求

邮件桥接服务当前支持 **Windows 10/11**，需要 **Node.js 22 或更新版本**、PowerShell，以及 Edge 或兼容的 Chromium 浏览器。日常浏览器需已登录中国大学 MOOC，邮箱需开通 SMTP 并取得邮箱服务商提供的授权码。

每天 20:00 检查时，电脑、浏览器和邮件桥接服务需保持运行并联网。关机、睡眠或完全关闭浏览器可能延迟检查；下次启动浏览器时会补查最近一次错过的检查。每天一次的检查无法保证及时捕获两次检查之间临时发布并结束的短时考试。

## 快速安装

在解压或克隆后的项目目录中打开 PowerShell。下列邮箱为虚构示例，请替换为自己的邮箱。

```powershell
npm run setup -- --email student@example.com
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\scripts\save-credential.ps1
npm start
```

第一条命令生成 `.local/config.json` 和 `extension/bridge_config.js`。第二条命令通过隐藏输入将 SMTP 授权码保存在当前 Windows 用户的凭据管理器中。`npm start` 在前台启动仅监听本机的邮件服务，便于首次检查。

接着在平时使用 MOOC 的 Edge 中：

1. 打开 `edge://extensions/`，开启“开发人员模式”。
2. 点击“加载解压缩的扩展”，选择本项目的 **`extension` 文件夹**。
3. 打开“中国大学 MOOC 任务提醒”，点击“立即检查并发邮件”。
4. 核对扩展中的状态、报告和邮箱中的邮件。

配置成功后，在运行 `npm start` 的窗口按 `Ctrl+C`，再安装 Windows 登录后启动的隐藏邮件服务：

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\scripts\install.ps1
```

计划任务名称为 `ChinaMOOC-MailBridge`。遇到“拒绝访问”时，按 [Windows 安装说明](docs/INSTALL_WINDOWS.md) 在当前 Windows 账户的管理员 PowerShell 中重试。

项目没有第三方运行依赖，首次配置无需执行 `npm install`。完整步骤、QQ 邮箱授权码配置及更新方法见 [Windows 安装说明](docs/INSTALL_WINDOWS.md)。

## 配置与隐私

| 文件或位置 | 作用 | 是否应提交 Git |
| --- | --- | --- |
| `config.example.json` | 使用虚构邮箱的配置模板 | 是 |
| `.local/config.json` | 个人邮箱设置和本机连接令牌 | 否 |
| `extension/bridge_config.js` | 本机扩展连接令牌 | 否 |
| Windows 凭据管理器 | SMTP 授权码 | 不在项目文件中 |
| `.local/reports/` | 实际课程报告与发信回执 | 否 |
| 浏览器自身资料目录 | MOOC 登录状态 | 不复制到项目 |

`.gitignore` 已排除本地配置、报告、日志和浏览器资料。提交前运行 `npm run privacy`，并人工检查暂存区。此检查是辅助工具，不能发现全部形式的个人信息。

项目通过浏览器读取课程页面，只查看任务、评价状态及考试列表。SMTP 授权码由本机 PowerShell 从 Windows 凭据管理器读取；邮件内容发送到用户在本地配置的邮箱。项目不包含遥测或第三方任务服务器。

当前版本固定使用 `127.0.0.1:8765`，每日检查时间固定为 `Asia/Shanghai` 时区的 20:00。配置模板中的 SMTP 字段可以修改，桥接端口与检查时间目前没有设置界面。

## 报告示例

以下为虚构内容，完整示例见 [examples/report.txt](examples/report.txt)。

```text
确认未完成：
- 示例课程 A｜第三章作业｜作业提交｜2027/04/05 23:00

考试提醒：
- 示例课程 B｜期中考试｜尚未开放｜开放：2027/04/03 09:00｜截止：2027/04/04 21:00｜时长：90分钟
```

## 测试

```powershell
npm test
npm run check
npm run privacy
```

自动测试使用虚构课程、临时目录和模拟邮件发送，不登录真实账号、不发送真实邮件。测试覆盖任务判定、同源合并、北京时间调度、考试状态、错误处理、本机接口验证和重复发送保护。

浏览器内的考试页面解析测试：加载扩展后，在扩展管理页查看扩展 ID，打开 `chrome-extension://扩展ID/exam_parser_checks.html`。该页只解析本地虚构页面。

需要主动发送邮件测试时，在本机服务运行期间执行 `npm run mail:test`。此操作会向本地配置中的收件人发送一封明确标注为通道测试的邮件。

## 项目结构

```text
extension/   浏览器扩展、页面读取和报告生成
bridge/      本机 HTTP 服务、SMTP 调用和 Windows 凭据封装
scripts/     配置、安装、卸载、检查和主动邮件测试
tests/       使用虚构数据的自动测试
docs/        安装、排错和开发说明
examples/    虚构日报示例
```

## 限制与维护

这是非官方个人学习提醒工具，与中国大学 MOOC 或网易没有隶属关系。网站更新、不同课程的页面格式及网络异常可能使某些状态无法读取；这类情况会尽可能列为“需要核实”，请以网站当前记录为准。

目前实际页面验证覆盖无已发布考试的场景；有考试时的多种状态已用虚构页面与自动测试验证。遇到新的考试页面格式时，需核对并更新读取逻辑。

更多内容见 [故障排查](docs/TROUBLESHOOTING.md)、[开发说明](docs/ARCHITECTURE.md)、[安全与隐私](SECURITY.md) 和 [贡献说明](CONTRIBUTING.md)。

## 许可证

本项目使用 [MIT License](LICENSE)。
