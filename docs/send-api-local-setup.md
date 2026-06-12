# WeChat Bridge 本机发送 API 配置

这份文档只给运行 WeChat Bridge 的本机使用。完成这里的配置后，另一台电脑才能通过 HTTP API 把消息转发到你的手机微信。

## 1. 登录并完成微信握手

如果还没有登录，先运行：

```bash
npm run weixin:login
```

登录成功后，按终端提示在手机微信里给桥接账号发送任意消息。程序会保存微信上下文令牌，并初始化 Codex session。

## 2. 配置监听地址

默认情况下，本地发送 API 只监听 `127.0.0.1`，只能本机访问。如果需要让局域网内另一台电脑访问，需要把服务监听地址改成 `0.0.0.0`。

编辑：

```text
~/.config/wechat-bridge-minimal/service.env
```

推荐配置：

```env
WECHAT_SEND_API_HOST=0.0.0.0
WECHAT_SEND_API_PORT=55523
```

示例：

```env
WECHAT_SEND_API_HOST=0.0.0.0
WECHAT_SEND_API_PORT=55523
```

如果只允许本机访问，保持默认值即可：

```env
WECHAT_SEND_API_HOST=127.0.0.1
WECHAT_SEND_API_PORT=55523
```

## 3. 配置 IP 白名单

IP 白名单保存于：

```text
~/.config/wechat-bridge-minimal/state/send-api-allowed-ips.json
```

创建默认白名单：

```bash
npm run weixin:send-api-allowed-ip -- ensure-defaults
```

查看白名单：

```bash
npm run weixin:send-api-allowed-ip -- list
```

添加另一台电脑的 IP：

```bash
npm run weixin:send-api-allowed-ip -- add --ip "192.168.1.31"
```

删除 IP：

```bash
npm run weixin:send-api-allowed-ip -- remove --ip "192.168.1.31"
```

桥接服务每次收到请求都会重新读取 IP 白名单文件，所以新增或删除 IP 后不需要重启服务。

## 4. 创建或查看 token

生成默认 token：

```bash
npm run weixin:send-api-token -- ensure-defaults
```

查看已有 token：

```bash
npm run weixin:send-api-token -- list
```

为某台电脑单独添加 token：

```bash
npm run weixin:send-api-token -- add --name "PC-4070"
```

删除 token：

```bash
npm run weixin:send-api-token -- remove --token "<要删除的token>"
```

token 文件默认保存于：

```text
~/.config/wechat-bridge-minimal/state/send-api-tokens.json
```

桥接服务每次收到请求都会重新读取 token 文件，所以新增、删除或替换 token 后不需要重启服务。

## 5. 启动或重启服务

如果使用 launchd：

```bash
npm run service:restart
```

查看状态：

```bash
npm run service:status
```

查看日志：

```bash
npm run service:logs
```

如果手动启动，`npm run weixin:serve` 也会读取同一份 `service.env`：

```bash
npm run weixin:serve
```

启动成功后，终端或日志里应出现类似：

```text
Local send API listening on 0.0.0.0:55523
```

## 6. 给另一台电脑的 agent 提供这些信息

只需要把以下三项提供给另一台电脑：

```env
WECHAT_BRIDGE_SEND_API_URL=http://<本机局域网IP>:55523/send
WECHAT_BRIDGE_SEND_API_TOKEN=<分配给那台电脑的token>
WECHAT_BRIDGE_SEND_API_NAME=<token对应名称，仅供对方识别>
```

示例：

```env
WECHAT_BRIDGE_SEND_API_URL=http://192.168.1.20:55523/send
WECHAT_BRIDGE_SEND_API_TOKEN=替换为真实token
WECHAT_BRIDGE_SEND_API_NAME=PC-4070
```

`WECHAT_BRIDGE_SEND_API_NAME` 不参与鉴权，也不需要请求方发送。桥接服务会根据 token 自动识别名称，并把消息发送成：

```text
名称:
消息内容
```

## 7. 本机快速验证

健康检查：

```bash
curl http://127.0.0.1:55523/health
```

发送测试消息：

```bash
curl -X POST "http://127.0.0.1:55523/send" \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{"text":"本机 API 测试消息"}'
```

如果另一台电脑无法访问，优先检查：

- `WECHAT_SEND_API_HOST` 是否为 `0.0.0.0`
- `send-api-allowed-ips.json` 是否包含另一台电脑的真实 IP
- macOS 防火墙或局域网网络策略是否阻止了端口 `55523`
- WeChat Bridge 服务是否已经重启并加载了新的 `service.env`

如果健康检查正常但发送返回 `wechat_context_expired` 或 `send_failed`，请先在手机微信里给桥接账号发送任意一条消息刷新微信上下文，再重试发送。微信的 `context_token` 来自用户入站消息，不适合作为长期稳定的主动推送凭证。

## 8. 安全要求

- 不要把真实 token 提交到代码仓库。
- 每台电脑使用单独 token，方便撤销。
- 局域网访问时，只把必要 IP 加入 `send-api-allowed-ips.json`。
- 如果 token 泄露，立即执行 `remove` 删除旧 token，再创建新 token。
- 这个 API 只用于发送消息到微信，不支持读取微信消息，也不会把 API 请求发送给 Codex。
