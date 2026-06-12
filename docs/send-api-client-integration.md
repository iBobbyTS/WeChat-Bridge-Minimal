# 消息发送 API 文档

本文档说明如何调用一个 HTTP 接口发送消息。调用方只需要知道接口地址和访问令牌。

## 接口信息

请从服务提供方获取：

```text
接口地址: http://<服务IP>:<端口>/send
访问令牌: <token>
```

示例：

```text
接口地址: http://192.168.1.20:55523/send
访问令牌: 0123456789abcdef
```

## 健康检查

```http
GET /health
```

示例：

```bash
curl "http://192.168.1.20:55523/health"
```

成功响应：

```json
{ "success": true }
```

健康检查不需要访问令牌。如果返回 `forbidden_ip`，说明当前调用方 IP 不在服务白名单内。

## 发送消息

```http
POST /send
Authorization: Bearer <token>
Content-Type: application/json

{ "text": "要发送的消息" }
```

请求要求：

- `text` 必须是非空字符串。
- 请求体最大 64 KiB。
- 访问令牌必须放在 `Authorization` 请求头中。
- `Authorization` 格式必须是 `Bearer <token>`。

成功响应：

```json
{
  "success": true,
  "target": "目标标识",
  "sender": "调用方名称",
  "result": {
    "delivered": true
  }
}
```

## curl 示例

```bash
curl -X POST "http://192.168.1.20:55523/send" \
  -H "Authorization: Bearer 0123456789abcdef" \
  -H "Content-Type: application/json" \
  -d '{"text":"这是一条测试消息"}'
```

## Python 示例

```python
import requests

API_URL = "http://192.168.1.20:55523/send"
TOKEN = "0123456789abcdef"

def send_message(text: str) -> dict:
    response = requests.post(
        API_URL,
        headers={
            "Authorization": f"Bearer {TOKEN}",
            "Content-Type": "application/json",
        },
        json={"text": text},
        timeout=30,
    )

    try:
        body = response.json()
    except ValueError as exc:
        raise RuntimeError(f"接口返回了非 JSON 响应：HTTP {response.status_code}") from exc

    if not response.ok or not body.get("success"):
        raise RuntimeError(f"消息发送失败：{body.get('error', response.status_code)}")

    return body

if __name__ == "__main__":
    result = send_message("这是一条测试消息")
    print(result)
```

## 错误码

| HTTP 状态码 | error | 含义 | 建议处理 |
| --- | --- | --- | --- |
| 403 | `forbidden_ip` | 当前调用方 IP 不在服务白名单 | 联系服务提供方加入白名单 |
| 401 | `unauthorized` | 访问令牌缺失、格式错误或不匹配 | 检查 `Authorization: Bearer <token>` |
| 400 | `invalid_json` | 请求体不是合法 JSON | 修正 JSON 序列化 |
| 400 | `request_body_too_large` | 请求体超过限制 | 缩短消息，当前限制 64 KiB |
| 400 | `text_required` | `text` 缺失、不是字符串或为空 | 传入非空字符串 |
| 502 | `wechat_context_expired` | 服务端发送上下文已失效，暂时无法发送 | 联系服务提供方刷新上下文 |
| 502 | `send_failed` | 服务端发送失败 | 稍后重试，或联系服务提供方查看日志 |
| 404 | `not_found` | 请求路径或方法不是支持的接口 | 使用 `GET /health` 或 `POST /send` |

## 安全要求

- 不要把真实访问令牌提交到代码仓库。
- 不要在日志里打印完整访问令牌。
- 如果怀疑访问令牌泄露，提醒用户更换令牌。
