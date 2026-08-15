# dsh-mcp-json

[English](README.md) | 中文

用你的 agent 工具已有的配置文件,在 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 里挂载 MCP server。它读取 Claude Code、Kiro、OpenCode、Codex 的 `mcp.json`,合并之后让运行中的 server 集合与文件保持同步。

harness 的 MCP 客户端刻意做成一个插件实例对一台 server,并且不读任何文件。本包补上它不做的配置发现:新增一台 server 从此是改 JSON,而不是改 profile 的插件树。

## 前置条件

- 可用的 `dsh` 安装(本包是插件,不是独立工具)。
- 至少一份 MCP 配置文件。下表任意位置都算——已有的 Claude Code 或 Kiro 配置无需新建文件、也无需任何 entry 配置就能用。

## 安装

```sh
dsh plugin --profile web add github:caopu16/dsh-mcp-json
```

本包自带 patch 层,安装即挂载加载器。构建产物 `lib/` 已提交进仓库,所以 git 源安装不执行任何构建脚本。

### 没有 `dsh` 命令时

PATH 上的 `dsh` 来自已安装的 `@deepseek-ai/dsh`。如果你用的是 harness 源码 checkout,就在该 checkout 里运行 CLI:

```sh
cd /path/to/deepseek-harness
pnpm dsh plugin --profile web add github:caopu16/dsh-mcp-json
pnpm dsh --profile web
```

### 开发本插件

`lib/` 是提交进仓库的,所以改动 `src/` 之后必须重新构建并一并提交,使用者才能拿到:

```sh
npm install
npm run build
npm test
```

## 读取哪些位置

各层按"从宽泛到具体"依次应用,同一个 server 名出现在多层时,由**最后**声明它的文件定义。用户级在前、项目级在后,因此一个 checkout 可以只重定向其中一台 server,不必把其余的重写一遍。

| 顺序 | 路径 | 工具 | 方言 |
|---|---|---|---|
| 1 | `~/.claude.json` | Claude Code | `mcpServers` |
| 2 | `~/.codex/config.toml` | Codex | TOML `[mcp_servers.*]` |
| 3 | `~/.kiro/settings/mcp.json` | Kiro | `mcpServers` |
| 4 | `~/.config/opencode/opencode.json[c]` | OpenCode | `mcp` |
| 5 | `~/.dsh/mcp.json` | 本 harness | `mcpServers` |
| 6 | `<cwd>/.mcp.json` | Claude Code | `mcpServers` |
| 7 | `<cwd>/.kiro/settings/mcp.json` | Kiro | `mcpServers` |
| 8 | `<cwd>/.opencode/opencode.json[c]` | OpenCode | `mcp` |
| 9 | `<cwd>/.codex/config.toml` | Codex | TOML |
| 10 | `<cwd>/.dsh/mcp.json` | 本 harness | `mcpServers` |

harness 自己的文档位于每组末尾,所以它能覆盖借来的配置,而不必去改另一个工具的文件。文件不存在是正常状态,静默跳过;文件存在但无法解析则会报告并跳过该层,其余各层继续工作。

宽松 JSON 是被接受的——`//` 与 `/* */` 注释、尾逗号——因为表中每个工具都这么写,真实文件里确实带这些。

## 方言差异

三套词汇描述的是同一批 server,只是字段名不同。本插件负责翻译,不要求你改写任何东西:

| | Claude / Kiro | OpenCode | Codex |
|---|---|---|---|
| 容器段 | `mcpServers` | `mcp` | `mcp_servers` |
| 格式 | JSON(C) | JSON(C) | TOML |
| 命令 | `command` + `args` | `command` 为单个 argv 数组 | `command` + `args` |
| 环境变量 | `env` | `environment` | `env` |
| 传输标记 | `stdio` / `http` | `local` / `remote` | `stdio` / `http` |
| 关闭 | `disabled: true` | `enabled: false` | — |

未声明传输方式的条目会被推断:有 `url` 即 HTTP,否则为 stdio。

`disabled: true`(以及 OpenCode 的 `enabled: false`)使该 server 不被挂载。`autoApprove` 会被识别但忽略——工具审批属于 harness 的 approval 能力,本插件不代其发言。

## 配置

所有字段都是可选的,默认值无需任何配置。

要改其中某项,写 `~/.dsh/settings.yaml` 的 `mcp-json` 段:

```yaml
mcp-json:
  borrow: false
```

推荐写在这里。该 section 会叠加在 profile 组装出的配置之上,所以只写一个字段不会影响其余字段,而且改完无需重启即刻生效。

也可以走 patch 层,在 `~/.dsh/profiles/<名称>/cordis.patch.yml` 里按 id 命中这一行:

```yaml
- id: mcp-json
  config:
    borrow: false
```

走 patch 有两点要注意。patch 是整体替换该行的 `config`,不是合并进去,所以只写一个字段会让其余字段全部退回 schema 默认值。另外**不要**把它包在 `insert:` 列表里——本包自带的 patch 层已经 insert 了 `mcp-json`,同一个 id 再 insert 一次会让整个 profile 启动失败,报 `duplicate loader entry id: mcp-json`。

| 字段 | 默认值 | 含义 |
|---|---|---|
| `userPath` | `~/.dsh/mcp.json` | 本 harness 自己的用户级文档。 |
| `cwd` | 进程工作目录 | 项目级各层解析时的基准目录。 |
| `borrow` | `true` | 是否读取其他工具的文件。设为 `false` 时只读 `userPath` 与 `<cwd>/.dsh/mcp.json`。 |
| `createUserPath` | `true` | `userPath` 不存在时创建一份 `mcpServers` 为空的文档，保证有文件可编辑。已存在的文件绝不会被改写。 |
| `watch` | `true` | 任意层变化时重新加载。 |
| `debounceMs` | `150` | 文件事件后再次读取前的静默期。 |

## 实时重载

文件变化是**按 server 逐台**调和的,不是整体重挂:解析后配置未变的 server 会保住自己的连接和已注册工具,而邻居照常变更。新增一个条目只挂一台,删除或禁用一个只卸一台,修改一个只替换那一台。

编辑器写文件是多次操作,所以事件会在 `debounceMs` 内合并后才重新读取。

改 `mcp-json` settings 段走的是同一套调和:配置按它解析出的路径与开关来比较,所以挪动 `cwd` 或关掉 `borrow` 会重读新的层集合,而只是把默认值重写一遍的 section 不会惊动任何东西。

## 工具名

每台 server 的工具以 `mcp__<serverName>__<toolName>` 的形式呈现给模型,这是 harness MCP 客户端自己的约定。因此 server 名就是命名空间,客户端要求它匹配 `[A-Za-z0-9_-]{1,32}`。不符合的名字会连同提供它的文件一起被报告并跳过,而不是让整次加载失败。

## 已知限制与待办

- **不支持 Trae。** 没有找到可验证的 MCP 配置路径;凭猜测加一个路径等于交付一个永不命中的位置。
- **不读 Cursor 和 VS Code。** 同样的原因——未在真实安装上验证过它们的位置。
- **不读源文件里的超时设置。** OpenCode 的 per-server `timeout` 以及其他工具特有的调优项都被忽略;每台 server 使用 harness 客户端的 60 秒工具调用超时。
- **`autoApprove` 不生效。** 工具审批是 approval 能力的决定,所以另一个工具文件里的预批准列表不会带过来。
- **从未存在过的被监听文件只在整体调和时才被注意到。** chokidar 监听的是这些路径,所以创建一个此前缺失的层确实会触发;但若其父目录同样缺失,可能要等到另一层变化时才被观察到。
- **每个插件实例只有一个 `cwd`。** 项目级各层基于配置的目录解析,而非各会话各自的工作目录。

## 许可

MIT
