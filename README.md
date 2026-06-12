# WeChat Bridge Minimal

> 项目状态：已停止开发，准备归档。

这是一个最小化的个人微信桥接实验项目，用 TypeScript/Node.js 实现微信 QR 登录、运行期消息轮询、单 Codex CLI 会话转发，以及本地 send-only HTTP API。

本项目不再继续开发。原因是当前基于个人微信连接器/iLink 的方式无法稳定做到长期主动向手机微信推送消息：发送所需的微信上下文令牌来自用户入站消息，可能在数小时后失效。即使服务保持在线，也不能保证后续单向推送一直可用。因此本项目不适合作为长期通知通道或生产服务。

## 已实现功能

- 微信 QR 登录。
- 登录凭证保存到 `~/.config/wechat-bridge-minimal/state/auth/`。
- `serve` 期间轮询微信新消息，只处理运行期间收到的目标用户文本消息。
- 单 Codex CLI thread 对话：
  - 登录后初始化一个 Codex session。
  - 后续消息复用已保存 session。
  - 当 session 缺失或 Codex 返回错误时，用初始化流程重新保存可用 session。
- 微信输入状态提示：
  - 收到用户消息后尽早发送 typing 状态。
  - Codex 回复完成或失败后停止 typing 状态。
- 本地 send-only HTTP API：
  - `GET /health`
  - `POST /send`
  - token 鉴权。
  - IP 白名单。
  - token 和白名单均支持热加载。
- Token 管理命令。
- IP 白名单管理命令。
- macOS launchd 用户服务安装、重启、状态和日志脚本。
- 简单消息日志：`~/.config/wechat-bridge-minimal/state/messages.jsonl`，每行保存时间、发送方和消息内容。

## 不支持

- 不保证长期稳定主动推送到个人微信。
- 不支持群聊。
- 不支持媒体消息。
- 不支持多 thread 路由。
- 不支持 `/` 命令。
- 不支持 Codex 审批转发。
- 不支持生产级可用性保证。

## 常用命令

```bash
npm run build
npm run typecheck
npm run test

npm run weixin:login
npm run weixin:serve
npm run weixin:test-message

npm run weixin:send-api-token -- ensure-defaults
npm run weixin:send-api-token -- list
npm run weixin:send-api-token -- add --name "PC-4070"
npm run weixin:send-api-token -- remove --token "<token>"

npm run weixin:send-api-allowed-ip -- ensure-defaults
npm run weixin:send-api-allowed-ip -- list
npm run weixin:send-api-allowed-ip -- add --ip "192.168.1.31"
npm run weixin:send-api-allowed-ip -- remove --ip "192.168.1.31"

npm run service:install
npm run service:status
npm run service:restart
npm run service:logs
```

## HTTP API

健康检查：

```http
GET /health
```

发送消息：

```http
POST /send
Authorization: Bearer <token>
Content-Type: application/json

{ "text": "要发送的消息" }
```

更多 API 调用说明见：

- `docs/send-api-local-setup.md`
- `docs/send-api-client-integration.md`

## 主要配置路径

- 服务环境文件：`~/.config/wechat-bridge-minimal/service.env`
- 状态目录：`~/.config/wechat-bridge-minimal/state/`
- 登录凭证：`~/.config/wechat-bridge-minimal/state/auth/`
- API token：`~/.config/wechat-bridge-minimal/state/send-api-tokens.json`
- API IP 白名单：`~/.config/wechat-bridge-minimal/state/send-api-allowed-ips.json`
- 消息日志：`~/.config/wechat-bridge-minimal/state/messages.jsonl`

## 最终结论

这个项目验证了“个人微信 + 本地桥接 + Codex CLI”的最小闭环，但也确认了关键限制：个人微信连接方式无法提供可靠长期单向推送能力。

如果目标是稳定通知，建议改用飞书自定义机器人、企业微信机器人、ntfy、PushPlus、邮件、Telegram Bot 或其他明确支持服务端主动推送的通道。
