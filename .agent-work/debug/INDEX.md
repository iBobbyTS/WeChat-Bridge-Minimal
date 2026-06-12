## Active

| file | summary |
| --- | --- |

## Unresolved

| file | summary |
| --- | --- |
| unresolved/weixin-sendmessage-ret-2.md | 已定位几小时后 test-message/sendmessage ret=-2 与微信 context token 失效相关；代码已补官方 start/stop/base_info 和明确错误，等待手机发消息刷新上下文后验证。 |

## Resolved

| file | summary |
| --- | --- |
| resolved/login-handshake-context-token.md | 已验证：登录后先通过用户入站消息获取 context token，再发送回执并保存微信轮询游标。 |
