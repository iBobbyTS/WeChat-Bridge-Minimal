# 登录握手 context token 调试

## 已确认现象

- 用户运行 `npm run weixin:login` 后，终端显示微信登录成功，但手机没有收到登录回执。
- 旧登录流程在 QR 登录成功后立刻主动 `sendmessage`，依赖 `ContextTokenStore.get(userId)` 读已有 token。
- 首次登录时没有入站微信消息，因此本地尚未保存 `context_token`。

## 当前假设

根因是主动发微信消息需要目标会话的 `context_token`，而 QR 登录确认只提供账号凭证，不提供会话 token。需要在登录成功后短期轮询一次用户入站消息，从这条消息保存 `context_token`，再用它发送连接成功回执。

## 修复方向

- 新增一次性登录握手模块。
- 登录成功后提示用户从手机给桥接账号发送任意文本。
- 忽略非目标用户、群聊、空文本和机器人消息。
- 收到目标用户文本后保存 `context_token`，不转发 Codex。
- 发送中文连接成功回执并退出。

## 待验证

- 自动测试覆盖握手文本、过滤、保存 token、发送 payload 和超时。
- 运行 `npm run typecheck`、`npm run test`、`npm run build`。
