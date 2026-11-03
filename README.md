# dsh-memsys

**给 DeepSeek Harness 用的长期记忆插件。** 事实只追加、候选可审、判断与裁决分开、做梦独立成库、上下文按预算注入。零依赖，只用 Node 内置的 `node:sqlite`。

```bash
node scripts/migrate.mjs --data-dir ./data     # 建库（三库：main / control / dream）
npm test                                        # 324 项测试
node scripts/live-check.mjs --case tools        # 真机：插件能否装进宿主、工具能否注册
```

已实测（隔离 profile，带 key）：插件加载 → 10 个 `memsys_*` 工具注册进宿主 → 模型调用 `memsys_search` 返回真实命中 → 模型调用 `memsys_record` 写入候选与记忆，`origin.author_kind=model`、会话与调用 ID 与宿主记录一致。

## 模块与分层

| 目录 | 职责 |
|---|---|
| `src/storage/` | 三库连接、迁移（SQL）、只追加触发器、repo |
| `src/control/` | 控制账：reserve / attempt / 精确读回 / 三败冻结 / 恢复 / 容量账 |
| `src/write/` | 观察 → 候选 → 提升六步、裁决与回执、项目、惦记、自述 |
| `src/context/` | 选择、排序、预算、编译（full/compressed/grouped）、快照、交付回执 |
| `src/read/` | 取回：get / search / review / self / project / dream / activity |
| `src/tools/` | 工具 schema 与 handler；`src/runtime/` 负责宿主注册与身份 |
| `src/dream/` | 梦库：命题、确认链、浮现、整理 |
| `src/import/` | 旧内容导入、门牌回填、回退核验 |
| `src/feed/` | 三闸筛选（相关 → 细节 → 时间） |
| `src/gates/` | 验收边界，可失败 |

**设计原则**：事实只追加；当前状态是可重建投影；模型只能提交候选，不能直接落事实；一切写后读回按固化预期比对，不是"行还在就算成功"。

## 状态

已实现并在真机验证**读**与**写**；仍有 6 条设计条款未达标（合并时 due 语义、回退证明深度、门牌与骨架核验、混版分页测试等）。逐条列在本文件末尾"已知边界"一节，不粉饰。

MIT License。

---

_以下为原始施工期文档（安装、默认行为、边界），保留以便对照：_

# dsh-memsys · 第一批（存储 / 写入 / 可靠提交 / 注入 / 取回）

本包是 DSH 的长期记忆器官第一批实现。行为规范只有一份：`whale-unify/memsys-design-v0.38.md`；本文件只讲**怎么装、怎么跑、默认行为是什么、哪些边界还没闭合**。

## 一、这一批做了什么

- 三库底座：主库（事实/候选/记忆/证据/事件）、控制账（操作、尝试、编译、快照、容量）、梦库（仅 schema 占位）。
- 写入三段：观察（输入原话先落库并读回）→ 候选（capture / 工具候选）→ 提升六步（memories / timeline / pointers / 证据 / 候选状态 / promote 事件，同一事务）。
- 可靠提交：控制账预扣尝试、写后读回三态（found / missing / unknown）、最多一次即时补写、失败三次冻结、跨重启保留、操作者可解冻。
- 注入器官：按已验证钩子 `ctx.inject(['systemPrompt'], …)` 注册一个段（`memsys:context`，order=500），全集 S、排序、字符/字节/token 分账、full / compressed / grouped / protected_overflow 四档、分组三件套、快照分页、投递回执与曝光。
- 取回工具：`memsys_get / memsys_search / memsys_review_get / memsys_context_get` 的离线处理器，`memsys_record` 写入处理器。

**不包含**：做梦、self note 工具、judgments、projects、旧数据迁移、feed、主人专有动作入口。

## 二、环境要求

- Node >= 22.13（本机实测 v24.19.0）。
- 只用内置 `node:sqlite`，**零第三方依赖**，不编译原生模块。
- 不需要 API key、不需要网络；`live-check` 的模型回合由人另外执行。

## 三、迁移与自检

```powershell
# 迁移并打印固定验收行
node whale-unify/memsys/scripts/migrate.mjs --data-dir whale-unify/_build/test-data/m1
# 期望：MIGRATIONS_OK main=3 control=2 dream=1

# 三库完整性
node whale-unify/memsys/scripts/check-db.mjs --data-dir whale-unify/_build/test-data/m1
# 期望：每库 integrity_check=ok、foreign_key_check=0；migrations 3/2/1
```

- 生产默认目录是 `~/.dsh/memsys/`（由受控启动配置决定，模型不能选库或目录）。
- 验收/测试必须显式传 `--data-dir`，不要写生产库。
- 迁移按库各自事务执行；已应用脚本的哈希不一致会拒绝启动；库版本高于当前代码只读报错。

## 四、测试与门禁

```powershell
npm --prefix whale-unify/memsys test        # 全部离线套件，当前 118 条
node whale-unify/memsys/scripts/build.mjs  # 语法/入口/bundle 检查 → BUILD_OK
node whale-unify/memsys/scripts/check-bom.mjs  # UTF-8 与 BOM 检查 → UTF8_OK BOM=0
```

单套件示例：

```powershell
node --test whale-unify/memsys/test/m1-storage.test.mjs
node --test whale-unify/memsys/test/m2-write.test.mjs
node --test whale-unify/memsys/test/m3-reliable.test.mjs
node --test whale-unify/memsys/test/m4-context.test.mjs
node --test whale-unify/memsys/test/m5-tools.test.mjs whale-unify/memsys/test/e2e.test.mjs
```

## 五、装进 DSH（独立 profile）

> **禁止把工作区目录以 junction / 符号链接 / 硬链接的方式链进 profile。** 重建 profile 时递归删除会跟随链接，把源码一起删掉（本项目真出过一次事故）。要装就复制。

```powershell
# 1) 复制到 ASCII 临时目录（不要直接 add 工作区路径）
$stage = Join-Path $env:TEMP "dsh-memsys-pkg"
Remove-Item $stage -Recurse -Force -ErrorAction SilentlyContinue
New-Item -ItemType Directory $stage | Out-Null
Copy-Item whale-unify/memsys\package.json, whale-unify/memsys\index.mjs, whale-unify/memsys\cordis.patch.yml $stage
Copy-Item whale-unify/memsys\src $stage\src -Recurse

# 2) 建独立 profile（不要碰 desktop）并安装
dsh --profile memsys-plan1-probe --from-default-profile headless --dump-config
dsh plugin --profile memsys-plan1-probe add $stage

# 3) 验证 bundle 条目已组合
dsh --profile memsys-plan1-probe --dump-config    # 应出现 id: memsys / name: dsh-memsys

# 4) 收尾：卸掉插件，删临时副本
dsh plugin --profile memsys-plan1-probe remove dsh-memsys
Remove-Item $stage -Recurse -Force
```

若某次 profile 里已有 `node_modules/memsys` 链接，**先按目录项删除**（`[System.IO.Directory]::Delete($link)` 或 `rmdir`），确认目标未被动过，再重建 profile。

## 六、真机探针（无 key）

```powershell
node whale-unify/memsys/scripts/live-check.mjs --case inject --profile memsys-plan1-probe
# 期望：LIVE_CHECK_OK case=inject plugin=loaded section=memsys:context order=500 auto_inject=false delivery=unknown
```

它在**不调用模型**的前提下证明：插件装载成功、bundle 条目已组合、启动时 `ctx.inject(['systemPrompt'])` 回调执行并注册了 `memsys:context / order=500`（插件会写一个临时标记文件）。启动最后会因缺少 key 停在 `MISSING_CREDENTIAL`，这是预期行为。

**"段真的进了 system prompt" 需要一次真模型回合来核对 `system/message`，这一步不由本脚本承担。** 证据写在 `whale-unify/_build/artifacts/live-check-inject.json`。

## 七、默认行为：auto_inject = false（tools-only 档）

| 配置 | 行为 |
|---|---|
| `auto_inject: false`（默认） | **不注册** systemPrompt 段；不承诺逐轮交付；`delivery=unknown`；只能用取回工具主动查询 |
| `diagnostic_section: true`（仅探针） | 注册段（`memsys:context`，order=500），正文是诊断占位，**不是**真实记忆交付 |
| `auto_inject: true` 且预算/回执未验证 | 仍按 tools-only 处理：`compileRound` 没有 tokenizer 或宿主 H 时返回 `mode=tools-only`、`section=null` |

为什么默认关：宿主 tokenizer、真实上下文预算 H、独立投递回执三项都还没在真实宿主上验证。缺任何一项就不许声称"每轮全量交付"。

## 八、编译产物怎么读

`compileRound(...)` 的返回（节选）：

- `delivery_level`：`full`（完整目录在软预算与 H 内）/ `compressed`（摘要按 40→20→8 码点压缩）/ `grouped`（逐条装不下，只给分组目录）/ `protected_overflow`（连固定层 + 分组头都超过 H）。
- `section`：`{ name: 'memsys:context', order: 500, text, payload_hash }`。
- `hard` / `soft`：分别记条数、UTF-8 字节、token；**字符 / 字节 / token 三列分开，不互相顶替**。
- `groups[]`：每组给 `group_id`、中文组名、`total_count`、`deferred_count`，以及可执行参数
  `memsys_context_get(snapshot_revision=…, group_id=…, cursor=null, max_chars=8000)`。
  正文里不会出现"另有 N 条"这种不可执行的计数。
- `delivery`：默认 `unknown`；只有收到满足"空闲集合相等 + payload hash 匹配"的回执才会 `confirmed`，部分回执是 `incomplete`。
- 快照：`snapshot_revision` 指向控制账里的持久快照，分组页游标绑定"快照 + 组"；快照过期返回 `stale_cursor` 并给新报告入口，不会把新版数据拼进旧页。

## 九、工具面

离线处理器（测试与 tools-only 档都走它）：

```js
import { createReadHandler } from './src/tools/read.mjs';
const tools = createReadHandler({ main, control, clock });
tools.get({ ids: ['mem_…'], view: 'current', include_evidence: true, max_chars: 8000 });
tools.search({ keywords: '葱', scene: 'life', topic_key: 'tk:…', time_range: { start, end } });
tools.review({ kind: 'candidate' });      // 或 kind: 'pending' / 'due-history'
tools.context({ snapshot_revision, group_id, cursor: null, max_chars: 8000 });
tools.touch({ roundId, memoryId, kind: 'lookup' }); // 只对真实读取记 lookup
```

- `memsys_get`：1–10 个唯一 id；`missing_ids` 与读取错误分开；超长正文按码点分片，`next_cursor` 续页，拼回后与原文逐字一致。
- `memsys_search`：关键词/场景/主题/时间范围过滤；空命中是 `status=ok`，不是错误；`graph` 参数返回 `unsupported_feature=graph`（第一批没有骨架）。
- `memsys_review_get`：候选/权限提案/due-history，给期限、默认出路、可用操作；这里的文本是审核材料，不是事实正文。
- `memsys_context_get`：只读持久快照分组页，不扩大快照场景。
- `lookup` 与 `used` 分开：只有真实读取加 `uses`，同轮同条只加一次；`used` / 主人提及只刷新 `last_touched_at`。

**宿主工具注册 API 尚未验证**：`registerTools(...)` 在没有传入真实 `register` 函数时抛 `tool_registration_unverified`，能力状态保持 `unknown`。不要在这之前声称工具已在线可用。

## 十、数据、备份与恢复

- 位置：`~/.dsh/memsys/{memsys.db, control.db, dreams.db}`；连接固定 `journal_mode=WAL`、`foreign_keys=ON`、`synchronous=FULL`、`busy_timeout=5000`。
- 只追加：observations / evidence / relations / origins / operation_attempts / control_events 由触发器拒改拒删；candidates 只许 4 列、memories 只许 3 列事件投影。
- 备份：`node:sqlite` 没有 `db.backup()`，统一用 `VACUUM INTO` 做一致性快照（包含已提交 WAL 内容），不要直接复制 db/wal/shm。
- 检查点：`node scripts/checkpoint.mjs --label M5 --data-dir <dir>` 同时写源码副本（`_build/backup/<批次>/`）与三库备份（`<data-dir>/backup/<批次>/`）。
- 写后读回：业务提交后必须精确读回；`found / missing / unknown` 三态分明，`unknown` 不许当 `missing`。
- 冻结：同一对象连续三次失败 → `frozen=true`，第四次业务写为 0；重启不归零；冻结后探测到数据存在只记 `reconciliation`，不自动解冻。解冻只能由本地操作者指定 `object_key`、原因与新 generation。
- 梦库第一批只有 `schema_migrations` 和占位标记，没有任何梦内容表。

## 十一、真机验证结果（2026-11-03）

| 项 | 命令 | 结果 |
|---|---|---|
| 工具注册 | `node scripts/live-check.mjs --case tools` | `LIVE_CHECK_OK registration=registered registered=10 schemas=35 get=true` |
| 工具调度 | `node scripts/live-check.mjs --case dispatch`（带 key） | `LIVE_CHECK_OK dispatch=ok`；`tool/result` 里 `direct_hit_count: 2`（命中「葱是绿的」「葱可以吃」），`evidence_mean: 0.14` |
| 注入段 | `node scripts/live-check.mjs --case inject` | `LIVE_CHECK_OK section=memsys:context order=500 auto_inject=false delivery=unknown` |

证据：`_build/artifacts/live-check-{tools,dispatch,inject}.json`。
`live-check` 每次会先删 profile 内插件、清空 `%TEMP%` 暂存目录再复制，并记 `stage_hash`；出现 `stale_stage` 说明跑的不是当前代码。

## 十二、已知边界（不许当成已闭合）

写完功能不等于达标。下面 10 条是两轮 Codex 复核后**仍未满足设计稿**的：

1. **恢复不按操作类型核完整预期结果**（L1）：due/promote 的完整结果、事件与证据集合没进读回判据
2. **批准取得写锁后未重验基版本**（E2）：内容可能在验证与写入之间变化
3. **编译没走三败控制**（E8）：compile 直写控制账，没有 reserve/complete
4. **快照不是内容寻址**（C3）：靠 section hash 拒绝同 ID 覆盖；未用真实重复编译测混版
5. **空分组回执边界**（C1）：只有组头、无实际 memory 时的确认语义未测死
6. **证据原文无分片续页**（C4）：`observation_text` 只截断
7. **回退不重放关系内容**（B3）：只核行存在与关联，不核 relations 内容/hash
8. **合并只保 `due_at`**（B1）：候选层没有 `due_state`/`done`
9. **门牌回填靠事件自证**（B2）：不重读源文件；图只核基本字段
10. **写入类工具仍不可用**：`memsys_record`/`dream_record`/`organize` 返回 `runtime_identity_unavailable`

另外：`feed` 生产 provider 未接（`integration_pending`）；真实旧库尚未导入，迁移只在夹具上验过。


## 十二、三十秒自检

```powershell
node --version                                   # >= 22.13
node whale-unify/memsys/scripts/build.mjs        # BUILD_OK
node whale-unify/memsys/scripts/check-bom.mjs    # UTF8_OK BOM=0
npm --prefix whale-unify/memsys test             # 118/118
node whale-unify/memsys/scripts/migrate.mjs --data-dir whale-unify/_build/test-data/m5
node whale-unify/memsys/scripts/check-db.mjs --data-dir whale-unify/_build/test-data/m5
```
