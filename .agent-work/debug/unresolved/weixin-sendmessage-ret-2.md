# 微信 sendmessage ret=-2 调试

## 已确认现象

- 用户重新授权后，几小时内 `npm run weixin:test-message` 再次失败。
- 本地复现：`sendMessage 返回失败：ret=-2 errcode= errmsg=`。
- 服务日志曾出现 `getUpdates 返回失败：errcode=-14 errmsg=session timeout`。
- 重新登录后，`getupdates/getconfig/notifystart` 都可成功，但 `sendmessage` 仍返回 `{"ret":-2}`。
- 手工按官方 `openclaw-weixin` 的 text send payload 构造 `sendmessage` 仍返回 `{"ret":-2}`。
- 当前机器还运行着旧 `/Users/ibobby/Documents/WeChat-Bridge` 的 `weixin serve` 进程，可能干扰微信侧会话判断，后续验证建议先停用。

## 官方连接器对照

- `Tencent/openclaw-weixin` 启动账号时调用 `ilink/bot/msg/notifystart`，停止时调用 `ilink/bot/msg/notifystop`。
- 官方 API 实现给 `getupdates/sendmessage/getconfig/sendtyping` 等请求都附带 `base_info`。
- 官方注释说明 `context_token` 来自 `getupdates` 入站消息，发送时回传；旧 `context_token` 过期时 `sendmessage` 可能返回 `ret=-2`。

## 已实施修复

- 补齐 `notifyStart` / `notifyStop`。
- 给 `getconfig` / `sendtyping` 补 `base_info`。
- 识别 `ret=-2` 为上下文失效。
- 主动发送时先用已保存 context token，若 `ret=-2` 则删除旧 token 并无 token 重试一次。
- 入站消息回复改用当前消息携带的 `context_token`，避免被旧存储 token 拖累。
- `test-message` 和 HTTP API 返回更明确的中文上下文失效提示。

## 已验证

- `npm run typecheck` 通过。
- `npm run test` 通过，54 个测试。
- `npm run build` 通过。
- 当前真实环境运行 `npm run weixin:test-message` 会输出明确错误：请先从手机微信发送任意消息刷新上下文。

## 待验证

- 用户从手机微信给桥接账号发送任意消息后，再运行 `npm run weixin:test-message`。
- 建议验证前停掉旧 `/Users/ibobby/Documents/WeChat-Bridge` 的运行进程，避免两个桥接客户端同时连接微信侧会话。
