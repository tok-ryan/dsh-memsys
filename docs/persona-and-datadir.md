# 人格版本化 + 数据目录统一（0.3.0）

0.3.0 把两件宿主侧的事收口：**人格成为可版本化的独立注入段**，**所有落盘收敛到 `~/.dsh/memsys`**。

## 一、人格（`memsys:persona`）

### 文件与解析

| 位置 | 作用 |
|---|---|
| `<包>/persona/vN.md` | 出厂种子（只读，随 npm 包发布） |
| `<数据目录>/persona/vN.md` | 主人保存的版本（可写，追加式） |

- 文件名必须是 `v<数字>.md`；其它文件（`README.md`）忽略。
- 当前版本 = **合并两处后数字最大**的那个（`v10 > v2`，按数字不按修改时间）；同名版本主人目录优先。
- 保存不覆盖旧文件：新版本永远写 `v(max+1).md`，所以目录本身就是版本历史。

### 注入

- 独立 section `memsys:persona`，`order = 400`；记忆段 `memsys:context` 是 `order = 500`。**人格段恒在记忆段之前**。
- 段文本按 mtime+size 缓存，保存后立即失效（下一次 `assemble()` 就是新人格）。
- 长度上限 `PERSONA_MAX_CHARS`（默认 3000 字），超长截断并标注「完整版 vN」。
- 闸门：`modules.context: false` 时两段都不注册；`persona_section: false` 只关闭人格段（patch 里有默认值 `true`）。

### 谁能改

- 只有主人通道：设置页 `POST /dsh-memsys/api/persona`（loopback + 同源，caller 由服务端构造，请求体不能带 role）或 CLI/维护通道。
- 判据是 `src/write/authority.mjs` 的 `assertOwnerRuntime`：`role` 必须是 `owner`/`master`；`daily`/`dream`/模型一律 `invalid_role` → HTTP 403。
- 模型工具与跨插件 service 接口**不暴露**人格写入口。

### HTTP 接口

| 方法 | 用途 | 返回 |
|---|---|---|
| `GET /dsh-memsys/api/persona` | 当前人格 + 版本历史 | `{version, text, source, versions:[{version,bytes,at,source}]}` |
| `GET /dsh-memsys/api/persona?version=N` | 只读某一版 | `{version, text, source}` |
| `POST /dsh-memsys/api/persona` | 保存为新版本 | `{ok:true, version, at}` |

设置页第三块「人格」：编辑框 + 保存为新版本 + 版本历史（点开只读查看，保存时不会被覆盖）。

## 二、数据目录统一

### 唯一解析器

`src/config.mjs` 的 `resolveDataDir()` 是全仓唯一决定数据目录的地方；`index.mjs` 与 `src/runtime/ui-config.mjs` 都从它取，不再各自拼 `config.data_dir ?? env ?? null`。

优先级：**受信显式覆盖**（测试 / CLI）> `MEMSYS_DATA_DIR`（探针/过渡）> 默认 `~/.dsh/memsys`。

`resolveConfig()` 额外派生：`personaDir = <dataDir>/persona`、`personaInjectionSection`、`personaMaxChars`、`personaSection`。

### 旧 → 新映射

| 旧位置 | 处理 |
|---|---|
| profile patch 里的 `data_dir: .../memsys-gui-data` | 仍接受一个版本（打 deprecated 警告），推荐 `migrate-datadir.mjs --from` 搬到 `~/.dsh/memsys` |
| `.../memsys-whalesoul-data`（换血真数据） | **唯一要搬的生产目录**：`--from` 到 `~/.dsh/memsys` |
| `.../memsys-verify-data`（空） | 不动、不删 |
| `MEMSYS_DATA_DIR` | 仅测试/探针覆盖，不写进生产文档 |
| `<旧目录>/ui-config.json、backup/、cutover.json` 等 | 随目录整搬，字节不变 |
| `~/.dsh/whale-soul/memory`（echo 格式） | 不是 memsys 数据，走 `scripts/import-legacy.mjs` 导入通道 |

`config.data_dir` 标记为 **0.4.0 移除**；0.3.x 内保留是为了不打断现有 profile 与测试。

### 迁移脚本

```bash
# 1) 先看有哪些旧 data_dir（只读）
node scripts/migrate-datadir.mjs --detect

# 2) 预演（不改任何文件）
node scripts/migrate-datadir.mjs --from C:/Users/15728/Desktop/ai/memsys-whalesoul-data --dry-run

# 3) 关掉所有 dsh 进程后真搬（默认目标 ~/.dsh/memsys）
node scripts/migrate-datadir.mjs --from C:/Users/15728/Desktop/ai/memsys-whalesoul-data
```

保证：

- **WAL 锁检测**：搬前对每个 `*.db` 用 `BEGIN IMMEDIATE`（`busy_timeout=0`）探活，命中 SQLITE_BUSY（errcode 5）即 `DATADIR_FAIL datadir_locked` 退出 1；读连接挡住 checkpoint、或关闭探针后 `-shm` 仍在，同样报锁。**不静默失败、不半边搬走**。
- **幂等**：成功后写 `<目标>/.migrated.json`（含每个文件 sha256 与三库内容摘要）。重跑返回 `already_migrated`，一个字节都不动。
- **可验证**：搬后逐文件 sha256、逐库 `PRAGMA integrity_check` + 表内容摘要，和搬前指纹比对；不一致则尽力搬回并 `verify_failed`。
- **目标保护**：目标非空且没有 marker 时 `target_not_empty` 拒绝，避免覆盖另一个 profile 的数据。

## 测试

- `node --test test/persona.test.mjs`：版本解析、owner 保存追加、非 owner 拒绝、截断、HTTP、section 顺序（persona 400 在 context 500 前）、出厂种子不含私人人格。
- `node --test test/datadir.test.mjs`：唯一解析器、搬迁逐字节一致、重跑无副作用、WAL 锁拒绝、目标保护、dry-run、旧 data_dir 探测。
