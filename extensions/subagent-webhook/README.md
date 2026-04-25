# Subagent Outbound Webhook

Push subagent lifecycle events to external HTTP endpoints.

## Events

### `subagent_spawned`

```json
{
  "type": "subagent_spawned",
  "timestamp": 1714041600000,
  "runId": "uuid",
  "childSessionKey": "agent:main:subagent:uuid",
  "task": "分析代码依赖关系",
  "label": "code-analysis",
  "agentId": "main",
  "parentSessionKey": "agent:main"
}
```

### `subagent_ended`

```json
{
  "type": "subagent_ended",
  "timestamp": 1714041700000,
  "runId": "uuid",
  "childSessionKey": "agent:main:subagent:uuid",
  "parentSessionKey": "agent:main",
  "reason": "complete",
  "outcome": "ok"
}
```

### 字段详解

**`subagent_spawned`**：

| 字段               | 类型      | 说明                                              |
| ------------------ | --------- | ------------------------------------------------- |
| `type`             | `string`  | `subagent_spawned`                                |
| `timestamp`        | `number`  | 事件触发时间（毫秒）                              |
| `runId`            | `string`  | 子代理运行 ID                                     |
| `childSessionKey`  | `string`  | 子会话 key                                        |
| `task`             | `string`  | 子代理任务描述（从会话消息历史提取，best-effort） |
| `label`            | `string?` | 可选标签                                          |
| `agentId`          | `string?` | 子代理目标 agent ID                               |
| `parentSessionKey` | `string?` | 父会话 key，如 `agent:main`                       |

**`subagent_ended`**：

| 字段               | 类型      | 说明                                                                  |
| ------------------ | --------- | --------------------------------------------------------------------- |
| `type`             | `string`  | `subagent_ended`                                                      |
| `timestamp`        | `number`  | 事件触发时间（毫秒）                                                  |
| `runId`            | `string?` | 子代理运行 ID                                                         |
| `childSessionKey`  | `string`  | 子会话 key                                                            |
| `parentSessionKey` | `string?` | 父会话 key                                                            |
| `reason`           | `string`  | 结束原因：`complete` / `error` / `killed` / `swept` 等                |
| `outcome`          | `string?` | 运行结果：`ok` / `error` / `timeout` / `killed` / `reset` / `deleted` |
| `error`            | `string?` | 当 outcome 为 `error` 时的错误信息                                    |

---

## How to Register Webhook Targets

OpenClaw 使用 **`~/.openclaw/openclaw.json`**（JSON5 格式，支持注释）作为默认配置文件。环境变量 `OPENCLAW_CONFIG_PATH` 可覆盖该路径。

插件配置通过 **`plugins.entries.<plugin-id>`** 注册，这是 OpenClaw 插件系统原生支持的机制——**无需修改任何核心代码**。

### 配置注册步骤

1. 打开 `~/.openclaw/openclaw.json`
2. 在 `plugins.entries` 下添加 `subagent-webhook` 键
3. 配置 `targets` 对象：键为自定义目标 ID，值为 `{ url, secret?, events? }`
4. 保存文件后重启 OpenClaw gateway（`openclaw gateway restart`）或使用配置热重载

### 配置示例

```json5
{
  // ... 其他 OpenClaw 配置 ...
  plugins: {
    entries: {
      "subagent-webhook": {
        enabled: true,
        targets: {
          // 目标 ID 自定义，如 "mySystem"
          mySystem: {
            url: "https://my-system.com/openclaw-webhook",
            secret: { source: "env", provider: "webhook", id: "MY_SYSTEM_SECRET" },
            events: ["spawned", "ended"],
          },
          // 可注册多个目标
          backup: {
            url: "https://backup.example.com/hook",
            events: ["ended"], // 只接收 ended 事件
          },
        },
        queryEndpoint: {
          enabled: true,
          auth: "plugin",
        },
      },
    },
  },
}
```

### 配置字段说明

| 字段                    | 类型                    | 必填 | 说明                                         |
| ----------------------- | ----------------------- | ---- | -------------------------------------------- |
| `enabled`               | `boolean`               | 否   | 是否启用该插件配置，默认 `true`              |
| `targets`               | `object`                | 是   | 目标 webhook 字典，键为目标 ID，值为目标配置 |
| `targets.<id>.url`      | `string`                | 是   | Webhook 接收地址                             |
| `targets.<id>.secret`   | `string \| SecretRef`   | 否   | HMAC-SHA256 签名密钥                         |
| `targets.<id>.events`   | `string[]`              | 否   | 订阅的事件，`["spawned", "ended"]` 为默认    |
| `queryEndpoint.enabled` | `boolean`               | 否   | 是否启用 HTTP 查询端点，默认 `true`          |
| `queryEndpoint.auth`    | `"plugin" \| "gateway"` | 否   | 查询端点认证方式，默认 `"plugin"`            |

### Secret 配置方式

`secret` 支持两种形式：

**直接字符串**（仅测试使用，不推荐）：

```json5
secret: "my-webhook-secret"
```

**SecretRef**（推荐，从环境变量读取）：

```json5
secret: { source: "env", provider: "default", id: "MY_SYSTEM_SECRET" }
```

对应环境变量：`export MY_SYSTEM_SECRET="my-webhook-secret"`

---

## Verification

Webhook payloads are signed with HMAC-SHA256 when a secret is configured.
Verify the `X-Webhook-Signature` header:

```python
import hmac, hashlib
expected = hmac.new(secret, body, hashlib.sha256).hexdigest()
assert hmac.compare_digest(expected, signature)
```

## Query Endpoint

```bash
curl -H "Authorization: Bearer $OPENCLAW_TOKEN" \
  http://localhost:8080/plugins/subagent-webhook/runs?sessionKey=agent:main
```

Response:

```json
{
  "ok": true,
  "total": 2,
  "runs": [
    {
      "runId": "uuid",
      "childSessionKey": "agent:main:subagent:uuid",
      "task": "分析代码依赖关系",
      "label": "code-analysis",
      "status": "running",
      "spawnedAt": 1714041600000
    }
  ]
}
```
