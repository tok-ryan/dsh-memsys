# 第一批施工图：存储、写入、可靠提交、注入与取回

本图交付给 builder；唯一行为规范是 `memsys-design-v0.38.md`，页首遗留 v0.37 不改变现行版本。
已完整读取任务所列五份输入；另读 `env-facts.md`、`builder-checklist.md` 及探针源码以核对环境。
本次只产出本文件，不实施业务代码、不改设计稿、契约、验收清单、人格、冷记忆及交接卡。
下列命令是施工后必须交付的可执行验收契约，不是声称实现或运行验收已经完成。

## 1. 批次边界与施工决定

- 包目录固定为 `whale-unify/memsys/`，包名 `dsh-memsys`，ESM JavaScript（`.mjs`），不引入 TypeScript 或原生编译依赖。
- 数据库选内置 `node:sqlite` 的 `DatabaseSync`；环境文件已证实建表、WAL 与完整性检查可用，备份接口仍须 M1 实测。
- `package.json` 声明 Node >=22.13；本机 24.x 满足；运行能力探测优先于仅比较版本号。
- `npm run build` 做全部 `.mjs` 的 `node --check`、导出与包入口检查，不下载依赖；G2 采用验收框架允许的 build 分支。
- `npm test` 由 Node 脚本枚举已有离线测试，再以 `node --test` 执行；不存在测试、零用例、跳过用例均不算通过。
- 主库及控制账启用；`dreams.db` 只建迁移元信息占位，不建梦业务表、不实现确认或梦写入。
- 第一批不建 projects、self_notes、judgments、speculations、graph_nodes/graph_edges；不注册对应工具，不执行旧库导入或 feed。
- 数据库 schema migrations 属于本批底座；“不做迁移”指旧记忆内容搬迁，不是禁止建表升级。
- 路径 B 只接第一档日常候选；第二档／超过两步推断返回 `unsupported_in_batch` 并保留原模型观察，不能降格成事实。
- 第一批不开放主人裁决、注册／rekey、场景扩大、硬保护变动、due 开立／确认／恢复、普通 supersede 或纠错入口。
- 未开放动作可保存权限提案并到期 deferred；不得返回动作已执行；梦、项目、自我记录类请求直接报本批不支持。
- 第一批支持普通 capture 收尾、完整未归组解释直接提升、resolved 分歧到期 coexist，以及 pending-due 的限额与归档。
- `due-policy-v1` 未批准时不启 open；第一批生产 P_s 为空，不能因此遗漏 pending-due 的 100 条及 14 天收尾。
- 待确认惦记不进 S、不自动召回；这正是 Opus 指出的已知召回损失，本批不通过偷塞正文改变规范。
- `builder-checklist.md` 的“只准 none/pending-due”“默认收尾全部后移”被本图细化为允许必要的 shelved-due/coexist/deferred。
- checklist 的“字符／字节代替硬预算”不得照用；真实 H 和 token 计量未知时转工具模式。
- `env-facts.md` 的文件备份约定须受设计 §13.0 约束：活动 SQLite 用一致性备份，不能在线分别复制 db/WAL/SHM 后称一致。
- 本图不修改这些输入；差异由主管同步到验收清单及施工员清单。

## 2. 目录与文件职责

以下路径均相对 `whale-unify/memsys/`；新增文件必须归入以下模块，禁止把业务堆进入口。

| 文件 | 唯一职责 | 首交 |
|---|---|---|
| `package.json` | ESM 入口、Node 范围、build/test/migrate 脚本及 dsh.bundle.patch 指向 | M1 |
| `cordis.patch.yml` | bundle 的 `- insert: [{id, name, config}]` 安装声明，配置默认关闭自动注入 | M4 |
| `index.mjs` | 导出 name/apply，装配服务并注销监听及 section | M4 |
| `src/config.mjs` | 受控启动配置、路径覆盖、固定策略及能力开关校验 | M1 |
| `src/clock.mjs` | 单次系统读数、回拨检测和可注入的测试时钟 | M1 |
| `src/identity.mjs` | 稳定业务键、规范 JSON、SHA-256 与碰撞检查 | M1 |
| `src/contracts.mjs` | 字段枚举、默认值、请求校验和返回类型契约 | M1 |
| `src/storage/open.mjs` | SQLite 连接、WAL/外键设置和事务辅助 | M1 |
| `src/storage/migrate.mjs` | 校验迁移 hash、按版本执行并记录 schema_migrations | M1 |
| `src/storage/backup.mjs` | 一致性备份、恢复清单和隔离恢复校验 | M1 |
| `src/storage/repositories.mjs` | 参数化 SQL、完整对象装配和提交版本直读 | M1 |
| `src/storage/replay.mjs` | relations 重放、状态与可变投影重建 | M1 |
| `src/storage/migrations/control-001.sql` | 操作控制账、只追加尝试账及对象流索引 | M1 |
| `src/storage/migrations/main-001.sql` | 观察、候选、记忆、证据、事件及基础投影 | M1 |
| `src/storage/migrations/main-002.sql` | 到期索引、来源、配置与候选实体投影 | M1 |
| `src/storage/migrations/dream-001.sql` | 仅 schema 版本占位，禁止梦业务写入 | M1 |
| `src/storage/migrations/control-002.sql` | 编译产物、快照页、manifest、容量与投递账 | M4 |
| `src/storage/migrations/main-003.sql` | injections、uses、lookup 与反馈所需索引 | M4 |
| `src/control/ledger.mjs` | 固化操作、预扣尝试、同对象互斥及冻结 generation | M1 |
| `src/control/commit.mjs` | 业务提交、精确读回及最多一次即时补写 | M1 |
| `src/control/readback.mjs` | found/missing/unknown 分类与版本化集合核验 | M1 |
| `src/control/recovery.mjs` | 重启探测、恢复 observation/capture/提升任务 | M3 |
| `src/control/maintenance.mjs` | 本地操作者解冻，留原因和新 generation | M3 |
| `src/write/observe.mjs` | 保存受信输入、工具／文件材料和模型原输出 | M2 |
| `src/write/capture.mjs` | 整条原话候选及精确“记住：”命令候选 | M2 |
| `src/write/candidate.mjs` | 候选、证据、提及登记和服务端直接提升调度 | M2 |
| `src/write/promote.mjs` | 提升六步及同事务关联事件 | M2 |
| `src/write/origin.mjs` | 来源图解析、作者继承及读取时可信度折叠 | M2 |
| `src/write/topic.mjs` | 正式五元组键、unresolved 键及候选提及键 | M2 |
| `src/write/authority.mjs` | runtime 角色、权限动作拒绝和提案保存边界 | M2 |
| `src/write/review.mjs` | capture/shelve、分歧/coexist、权限/deferred 的到期收尾 | M2 |
| `src/write/due.mjs` | pending-due 入队、全身份上限及 shelved-due 投影 | M2 |
| `src/context/select.mjs` | 同快照 S、审核目录及场景边界选择 | M4 |
| `src/context/rank.mjs` | §6.3 字面评分、活动衰减、反馈 F 及稳定排序 | M4 |
| `src/context/budget.mjs` | 码点／字节／token 分账、压缩及硬层容量闸门 | M4 |
| `src/context/compile.mjs` | section 正文、manifest、展示分组与覆盖核验 | M4 |
| `src/context/snapshots.mjs` | 控制账持久快照、目录页、游标与历史报告 | M4 |
| `src/context/delivery.mjs` | 真实回执验证、unknown/incomplete 与曝光去重 | M4 |
| `src/read/get.mjs` | 具体 id 的原文、证据、时间线及历史读取 | M5 |
| `src/read/search.mjs` | 字面／标签／时间／主题查询及组索引 | M5 |
| `src/read/review.mjs` | 候选、权限 pending、due-history 的审核分页 | M5 |
| `src/read/pager.mjs` | 同快照正文分片、稳定 cursor 及 stale_cursor | M4 |
| `src/read/activity.mjs` | lookup、used、反馈及投影原子提交 | M5 |
| `src/tools/schemas.mjs` | 工具 JSON Schema 与字段白名单 | M2 |
| `src/tools/record.mjs` | memsys_record 受控处理器，先独立于 DSH 验收 | M2 |
| `src/tools/read.mjs` | 五个本批工具的统一返回与错误映射 | M5 |
| `src/runtime/session-events.mjs` | 从 session/event.log 读输入、轮次及最终输出 | M4 |
| `src/runtime/identities.mjs` | 持久 session/message/turn/call 映射与可信模式绑定 | M4 |
| `src/runtime/inject.mjs` | 按探针动态注册 systemPrompt 段并隔离会话 | M4 |
| `src/runtime/tools.mjs` | 按实测宿主工具注册 API 绑定工具处理器 | M5 |
| `src/runtime/capabilities.mjs` | 能力报告、版本失效及 tools-only 闸门 | M4 |
| `scripts/build.mjs` | 离线语法、导出和 bundle 结构检查 | M1 |
| `scripts/check-bom.mjs` | 包内源码／JSON／YAML／SQL 的 UTF-8 与 BOM 检查 | M1 |
| `scripts/test.mjs` | 明确枚举测试，拒绝空集合后调用 Node runner | M1 |
| `scripts/migrate.mjs` | 指定 data-dir 的迁移与完整性检查 CLI | M1 |
| `scripts/check-db.mjs` | 只读 integrity/foreign_key/迁移版本检查 | M1 |
| `scripts/checkpoint.mjs` | 源文件备份、双库屏障、一致性备份和只读比对 | M1 |
| `scripts/live-check.mjs` | 独立 probe profile 动态验收，缺前提明确失败 | M4 |
| `test/helpers/runtime.mjs` | 假 runtime、受信测试角色和 session/event log 重放 | M1 |
| `test/helpers/fixtures.mjs` | 通过服务造观察／候选／记忆及测试快照 | M1 |
| `test/helpers/faults.mjs` | 可定位到事务步骤和读回阶段的故障注入 | M1 |
| `test/helpers/worker.mjs` | 独立子进程断点退出与并发写测试入口 | M3 |
| `test/m1-storage.test.mjs` | schema、事务、只追加与备份验收 | M1 |
| `test/m2-write.test.mjs` | 三段写入、来源／主题／due／默认收尾验收 | M2 |
| `test/m3-reliable.test.mjs` | 三态、重试、崩溃恢复和跨进程互斥验收 | M3 |
| `test/m4-context.test.mjs` | S、预算、分组、manifest 及钩子适配离线验收 | M4 |
| `test/m5-tools.test.mjs` | schema、正文分页、查询错误和活动验收 | M5 |
| `test/e2e.test.mjs` | E1–E3 串联上述真实服务，明确测试回执身份 | M5 |

运行产物固定放 `_build/artifacts/`；验收数据放 `_build/test-data/`；源码检查点放 `_build/backup/`。
`progress.md`、`report-1.md`、`blockers.md` 由既定角色维护；本次出图不创建实现产物。

## 3. 依赖与验收命令

依赖图固定：`M1 → M2 → M3 → M4 → M5`；M4 所需 context 分页在 M4 交付，不倒依赖 M5。
M1 已交付最小控制账与安全提交；M3 完善恢复及故障矩阵，禁止 M2 先搭一个无控制账写入口。
所有命令从工作区根运行；PowerShell 不用 `&&` 串联，逐条执行并检查退出码。
每阶段先跑 G1–G5，再跑该阶段专测；测试目录以测试名隔离，不写 `~/.dsh/memsys`。
build 在 M1–M3 检查已交付核心模块导出，M4 起才要求 index/bundle；不会因尚未交付宿主入口让 M1 依赖 M4。

| 门禁 | 可粘贴命令 | 期望输出／断言 |
|---|---|---|
| G1 | `node --version` | >=22.13，且 M1 实测 node:sqlite；本机环境记录为 24.x |
| G2 | `npm --prefix whale-unify/memsys run build` | `BUILD_OK`，退出码 0，无下载或编译依赖 |
| G3 | `npm --prefix whale-unify/memsys test` | TAP `fail 0`、`tests > 0`、`skipped 0`；所有已交付离线套件运行 |
| G4 | `node whale-unify/scripts/now.mjs` | 打印实际时间及非空读数编号；脚本内容未变 |
| G5 | `node whale-unify/memsys/scripts/check-bom.mjs` | `UTF8_OK BOM=0`，退出码 0；不是搜索文本里的 BOM 字样 |

### M1 存储底座

交付：文件表首交 M1 的全部文件；main-001/002、control-001、dream-001；不装 DSH、不注册注入。
前置：无；mkdir、迁移、写锁、备份、读回都只用本地 Node 标准库。
验收命令：
```powershell
node whale-unify/memsys/scripts/migrate.mjs --data-dir whale-unify/_build/test-data/m1
node --test whale-unify/memsys/test/m1-storage.test.mjs
node whale-unify/memsys/scripts/check-db.mjs --data-dir whale-unify/_build/test-data/m1
```
期望：`MIGRATIONS_OK main=2 control=1 dream=1`；TAP `fail 0`；三库逐个 `integrity_check=ok`、`foreign_key_check=0`。
测试包括二次迁移无新增、非法 UPDATE/DELETE 被拒、SAVEPOINT 回滚、control 失败不发业务写及备份恢复内容相同。
回滚点：首次开工前源码清单及空库标记；单库迁移失败事务回滚，已成功库保留版本，禁止降版本继续写。

### M2 观察、候选与提升

交付：文件表首交 M2 全部文件及测试；不开真实宿主工具，直接调用同一 record 处理器。
前置：M1；所有写服务必须经 ledger/commit，观察先独立落库。
验收命令：
```powershell
node --test whale-unify/memsys/test/m2-write.test.mjs
```
期望：TAP `fail 0`；断言普通输入 1 observation/1 capture/0 memory，记住命令 1 memory/1 promote，重复回调计数不变。
六步每步抛错均无半条 memory；原 observation 仍 found；新食材 proposed 立即入档，模型不能伪造 owner 或 open。
回滚点：M1 检查点；停止候选消费者后回退源码，已保存 observation 与事件不删除，未完成任务留恢复账。

### M3 可靠提交与恢复

交付：recovery/maintenance、故障与子进程工具、m3 测试；补全 M1 控制账的恢复与冻结分支。
前置：M2；只操作测试库，M1–M3 全部离线运行，不需要 DSH/key/网络。
验收命令：
```powershell
node --test whale-unify/memsys/test/m3-reliable.test.mjs
```
期望：TAP `fail 0`；强制两败再重启第三败得到 `frozen=true,consecutive_failures=3`，第四次业务写次数为 0。
第三次 found 可清零；冻结后探测 found 只记 reconciliation；双进程同对象只一个在途，不同对象可继续。
回滚点：M2 检查点；保留当前控制账及尝试历史，关闭写入口，禁止覆盖旧 control.db 使冻结计数归零。

### M4 注入与分组器官

交付：control-002/main-003、context 全模块、pager、runtime 除 tools 外全部、入口/bundle/live-check 与 m4 测试。
前置：M3；本阶段已有快照分页服务及 memsys_context_get 处理器，尚未验宿主注册时不得开启 grouped 自动注入。
验收命令：
```powershell
node --test whale-unify/memsys/test/m4-context.test.mjs
node whale-unify/memsys/scripts/live-check.mjs --case inject --profile memsys-plan1-probe
```
期望：离线 TAP `fail 0`；动态产物 `section_present=true,session_event_log=true,cross_session_leak=false,delivery=unknown`。
动态读到实际 system/message 才算段存在；H/调用时序未验输出 `mode=tools-only`，不能标完整器官通过。
回滚点：M3 检查点；注销新增 section 与监听、关 auto_inject；保留快照与能力失败证据，读写底座继续可用。

### M5 取回工具与端到端

交付：read 模块、tools/read、runtime/tools、m5 与 e2e；复用 M4 context 处理器完成宿主注册。
前置：M4；工具 schema 检查通过后再做真实调用，注册 API 不凭空假定。
验收命令：
```powershell
node --test whale-unify/memsys/test/m5-tools.test.mjs whale-unify/memsys/test/e2e.test.mjs
node whale-unify/memsys/scripts/live-check.mjs --case tools-e1 --profile memsys-plan1-probe
```
期望：TAP `fail 0`，用例 E1/E2/E3 均出现；动态工具实际返回原文，下一轮 system/message 含目标及来源。
缺凭据／运行时／预算能力时命令非零并报能力名，不许 skip 后报通过；交付报告分列离线通过、动态未过与 tools-only。
回滚点：M4 检查点；注销工具发布层，保留处理器、数据及分页清单；未通过动态门禁不启生产自动注入。

每阶段检查点由 `node whale-unify/memsys/scripts/checkpoint.mjs --label M1 --data-dir whale-unify/_build/test-data/m1` 这一 CLI 建立；后续替换 label/data-dir。
M1 脚本尚未交付时由 builder 以 Node fs.cp 建首个源码检查点；数据库仍走一致性备份，绝不 fs.cp 活动库。
检查点目录名由脚本读取系统时间生成并附唯一序号，不能手写估计时间；清单存源码 hash、库 revision、操作高水位和无库标记。
回滚仅在停写并保全失败现场后进行；有新事实的库不原地覆盖旧备份，隔离恢复并重放增量，控制账历史不丢。
通用门禁失败按 acceptance 不计里程碑失败；专测连续失败三次冻结施工、写 blockers；与库内 object_key 三败是两套账。

## 4. 数据层：库、迁移与事务

生产位置沿用规范：`~/.dsh/memsys/{memsys.db,control.db,dreams.db}`，由 os.homedir() 拼接。
只允许受控启动参数 dataDir 覆盖；模型请求不能选库或目录。验收始终显式传 `_build/test-data/<case>`。
备份产物放数据目录 `backup/<系统生成批次>/`，源码及备份 manifest 副本放 `_build/backup/<批次>/`。
首次建库不需要虚构备份；记录 `initial_empty=true`。已有库先一致性备份并校验，才执行 migration。

| 次序／文件 | 数据对象 | 必须建立的约束 |
|---|---|---|
| 1 control-001 | schema_migrations、operations、operation_attempts、control_events、object_streams | request_key 唯一；完整业务键留存；一个 object_key 仅一在途尝试 |
| 2 main-001 | observations、candidates、memories、evidence、timeline、pointers、relations、state、config | promoted_from 唯一；evidence 两端各恰一个非空；事件 dedupe_key 唯一 |
| 3 main-002 | origins、candidate_entity_registry、review_queue、due_queue | path+content_hash 唯一；候选/权限 pending 到期索引各自覆盖；同身份 due 入队序号持久 |
| 4 dream-001 | schema_migrations 占位 | 无任何梦内容表，无从主库向梦库写内容的服务 |
| 5 control-002 | compilations、context_snapshots、snapshot_items、snapshot_groups、deliveries、capacity_rounds | compile key、snapshot id、roundId/流去重；原 payload/manifest 不可变 |
| 6 main-003 | injections、uses | UNIQUE(round_id,memory_id)；lookup 事件独立幂等键，uses 可重建 |

`schema_migrations(version,name,checksum,applied_at)` 每库独立；顺序严格，已应用脚本 hash 不一致拒绝启动。
每库单个 migration `BEGIN IMMEDIATE → DDL/索引/触发器/版本记录 → COMMIT`；跨库不宣称原子升级。
升级全程停业务写，失败保持各库实际版本；恢复继续未完成版本；程序不支持未来版本时只读报错。
每连接启 `journal_mode=WAL`、`foreign_keys=ON`、`synchronous=FULL`、有界 busy_timeout（初值 5000ms，非无限重试）。
读事务冻结主库 revision；写事务先取锁；嵌套 SAVEPOINT；任何网络、模型推理、宿主发送均不在 SQLite 写事务内。
commit_seq 由主库锁内单调序列分配，同事务 ordinal 区分事件；时间回拨不影响重放先后。
review_queue、due_queue 属于 state 的物化索引，清空后能从对象及 relations 重建，不另设不可追溯业务状态。
object_streams 只索引当前 generation/冻结/在途；权威来自控制事件及尝试账，不能因重建而消掉失败历史。
entity_registry/attribute_registry/alias_registry 作为 config 的版本化 JSON 投影；topic 模块统一读，不另有自由注册入口。
基础 registry 只含固定 owner、work/life/global、规范列出的属性枚举；初始化记录规则版本及 config-change，不编主人批准。
主库 observations/evidence/relations/origins 原文只 INSERT；trigger 禁 UPDATE/DELETE，payload_hash 与原 UTF-8 同存可复核。
candidates 仅 status/promoted_at/rejected_reason/owner_touched 可改；memories 仅 due_state/due_done_at/last_touched_at 可改。
timeline、pointers、uses、state、config 与物化索引的变动必须由对应事件和同事务更新支持；投影不是第二套权威。
通过唯一内部 transaction API 暴露这些更新，事务提交检查变更清单含对应事件；测试直接越界 SQL 必须被拒或整笔回滚。
候选状态、事实状态、due 状态分列；memories 不建 status；active 从无终态关系重放得到。
关系折叠：demote/corrected 终态优先于 supersede；后到 newId 不复活旧终态；supersede 环记 conflict 而不生效。
本批不开放 supersede/corrected/rekey 写端；重放器仍识别合法历史格式，未知 event_version 则隔离报错，不猜状态。
evidence 的唯一身份覆盖目标种类/id、来源种类/id、role、source_span；用四种非空组合的部分唯一索引避开 SQLite NULL 漏去重。
source_span 固定为原文 UTF-8 字节半开区间 `[start,end)`；验边界、hash、原文字节，中文不混用 JS UTF-16 偏移。
快照对象保存独立 state_snapshot/initial_strength；observations/candidates/memories 首次尝试分别冻结，retry 复用。
initial-v1 从规范读取：base 0.5，精力与显式情绪强度增量夹到 [0,1]；无同输入证据一律 unknown。

`backupDatabases(dataDir, manifest)` 使用 node:sqlite 一致性备份 API，M1 测其可用性及 WAL 中已提交内容是否包含。
若该 Node 构建无 backup API，降级为停写屏障下经实测的 `VACUUM INTO`；两者都不可用则阻断迁移，不用裸文件复制替代。
双库备份前暂停新操作，等待在途完成或记录未完成尝试；读各库高水位和 operations 状态，写恢复清单；梦库注明 placeholder。
备份与恢复清单含库名、schema 版本、文件 hash、commit_seq、control generation、在途 operation id、系统时刻及工具版本。
`check-db.mjs` 在迁移前源库、迁移后库、备份副本、恢复演练副本分别执行 `PRAGMA integrity_check` 与 `foreign_key_check`。
`integrity_check` 必须唯一结果 `ok`；外键违规为 0；否则保全文件并停升级，不能继续写后再声称完成。
正常测试结束与第一批收尾也跑完整性检查；不在每条聊天输入上执行全库完整扫描。
恢复到隔离 dataDir、验证清单后切换服务配置；原目录保留。生产恢复若有备份后的事实，先重放增量，不能覆写抹掉。

## 5. 写入三段：接口、身份与六步

函数均接 `TrustedRuntime`，包含身份、角色、mode、sessionId、roundId、稳定事件/callId；由适配层构造，不接受模型同名参数。
核心签名固定如下，均为接口约定而非本次实现代码：

| 入口 | 输入 | 输出／事务边界 |
|---|---|---|
| `observeInput(runtime, envelope)` | 完整原话、受信消息 id/日志位置、原始事件定位 | observation 的 CommitReceipt；独立事务含 capture 恢复任务 |
| `captureObservation(runtime, observationId)` | 已 found 的观察 id | capture 候选；命令分支同时建 quote 候选并原子提升／收尾 |
| `recordCandidates(runtime, request)` | 合法 kind、items、evidence_refs、固定 source_unit | 逐项回执；候选+证据+提及+恢复任务同事务，每项 SAVEPOINT |
| `promoteCandidate(runtime, candidateId, baseRevision)` | 已持久候选及预期版本 | memory CommitReceipt；六步一个主库事务 |
| `scanReviews(runtime, inputSeq, clock)` | 启动或真实输入触发及持久输入序号 | shelve/coexist/deferred 事件；逐项按版本锁定 |
| `enforcePendingDue(runtime, txn)` | 提升或维护中的主人身份、策略版本 | pending/shelved 投影、报告及事件，与入队同事务 |
| `record(runtime, request)` | 路径 B 工具请求 | items[{operation_id,id,readback,pendingId,error,failures,frozen}] |

路径 A 必须由 `agent/inbox/spliced` 的真实用户原文触发，绝不等待 assistant/message、turn/end 或模型吐 JSON 块。
主库先存完整 observation 与可重建 capture-job 事件；读回 found 后才推进候选；unknown 保留任务，不拿未核原文提升。
用户输入序号按同一真实身份跨窗口持久递增；重复日志事件不能重复递增，也不能触发额外“后续输入”。
普通 capture：source_unit=`bytes:0:<完整UTF8长度>`，quoted/utterance、episode、why=输入原话留存，start=null、unresolved。
整条消息精确 `记住：<非空原文>` 才匹配；不 trim 正文、不从代码块/转贴中抽命令、不把相似说法当授权。
quote 的 source_unit 固定 command_body，正文逐字取冒号之后，why=“主人显式要求保留原话”。
命令事务包含 quote 候选、六步提升、原 capture→shelved 及 reason=explicit_capture_promoted；任一失败全部回滚，观察不回滚。
路径 B 先保全 source=model/author_kind=model 的原工具产物；候选父 observation 是 source_unit 明确引用的真实依据，不硬挂本轮用户。
服务取实际 evidence 来源并集，加 model 运行来源和 `model_inference` 作者标记；不允许参数给 origin/credibility/topic_key 自证。
审计时间输入丢弃并追加违规事件；payload 其余非法权限字段拒绝；业务 start/end/due_at 必须附原文范围，无依据为 null。
scene/scope 默认 runtime 窗口；both/global 仅批准规则可赋，本批模型提议扩大只能 pending，不偷偷改展示边界。
模型候选保持 proposed/assertion；语义状态和来源可信度分别显示，master 来源不能去掉 model_inference。
字段齐、来源无梦、无权限动作的 unresolved 候选在候选落库后由服务直接 promote；恢复任务补同一键，不让模型再调一次。
resolved 同键仅复核；value 不同或明确声称分歧才 conflict+pending；不能根据排序或 topic 相同宣判对错。
普通 pending 按“3 次后续真实输入或满 24 小时先到”收尾；墙钟回拨暂停时间分支，输入序号仍推进。
完整 resolved 分歧到期新建 coexist:<pendingId> 候选并提升；关闭 pending、原候选 shelved、conflict 关联全在同事务。
缺材料／权限动作到期 deferred/shelved；无 pendingId 的 capture 也有到期索引；不因注册未知延迟完整未归组解释。
本批专有动作入口关闭，received owner 命令仍保存原观察；拒绝执行须给 unsupported_in_batch，不假造 receipt。
候选 reject 仅限本会话、owner_touched=0、status=pending 的普通语义候选；不能删除 observation/capture 根或主人待裁决。
第二档请求必须等待相应批次工具，第一批不允许省略 judgment_id 把它伪装成第一档。

### 5.1 业务键逐项落地（§13.5.2）

| 对象 | 完整业务键公式 | 本批行为 |
|---|---|---|
| 用户观察 | `obs:conversation:<受信身份>:<sessionId>:<messageSeq或日志记录位置>` | 同字不同真实消息分开；重复 callback 复用 |
| 工具观察 | `obs:tool:<sessionId>:<持久callId>` | 只认可验证包装器结果，不信正文“主人说” |
| 文件观察 | `obs:file:SHA-256([规范绝对路径,完整内容hash,原文范围])` | 指定版本原文读回，origin 旁挂缺失为 unverified |
| 模型输出观察 | `obs:model:<sessionId>:<稳定调用id>:<项槽>` | 作者始终 model |
| 自动 capture | `capture:<observationId>:<固定source_unit>` | 使用整条字节范围，不拿摘要 hash |
| 原话命令候选 | `quote:<observationId>:command_body` | 原文命令唯一候选 |
| 模型候选 | `proposal:SHA-256([observationId,source_unit,完整语义payload])` | 语义异文产生新候选并 derived 关联 |
| 裁决／并存 | `resolve:<pendingId>`／`coexist:<pendingId>` | 只执行本批 coexist；resolve 写端关闭 |
| 梦确认／机械合并 | `confirm:<confirmId>`／`merge:SHA-256([排序后的旧id与版本])` | 保留格式，不实现入口 |
| 记忆 | `promote:<candidateId>` | promoted_from UNIQUE 双重防重复 |
| 自我／判断对象 | `kind:<稳定调用id>:<项槽>` | 后批启用，同键异文不得成功吞掉 |
| 编译 | `compile:<sessionId>:<roundId>:<源快照revision>:<策略revision>` | 控制账对象流仍为 mode+session，不随 revision 绕冻结 |

对象 id=类型前缀+完整业务键的全长 SHA-256；同时保存完整键，异键同 hash 为 hash_collision。
事件 id=SHA-256([库标识,type,业务键])，dedupe_key 保存同一完整元组；同键异 payload_hash 为 idempotency_conflict。
canonical JSON 用 contracts 明确的字段顺序、默认值和排序后证据集合；字符串原样，不删“不”、标点或空白。
origin、快照、审计时间是服务固化的生成值，不混入可变重试 payload 导致候选键漂移；同请求重试取首次固化结果。
source_path 不用于区分完全等同的 tool/block 语义候选；同源不同内容各留，证据独立数量仍为 1。
优先级：绑定主人操作 > 输入确定性命令 > 工具 > 文本兼容；只控制动作资格，绝不覆盖历史根。

### 5.2 提升六步与映射

先由 control 固化 memory 自己的快照、时间、目标 id、完整目标集合；再 `BEGIN IMMEDIATE` 核候选状态/版本/权限。
1. INSERT memories：text/detail/why/type/scene/scope/tags/value/lossy 原样映射，promoted_from=candidateId。
2. INSERT timeline：start/end 与各端精度；默认 null/null/unknown/point；exact 缺任一端拒绝。
3. INSERT pointers：默认 unknown/null；exact 要可逐字回查的真实位置，不从摘要猜门牌。
4. INSERT memory evidence：复制支持关系成新行；candidate evidence 原行保留，不 UPDATE 改归属。
5. UPDATE candidate.status=promoted、promoted_at=首次冻结提升时刻；其余内容不动。
6. INSERT promote 事件，锁内分配 commit_seq/ordinal；所需 conflict 关联同事务，COMMIT 后精确读回全部集合。
memories 使用候选 effective_topic_key/组件/注册版本及键溯源；本批没有 rekey 写入口，不省掉溯源列。
origin/confidence 映射来源图/credibility，读取重新折叠；recorded_at=last_touched_at 为 memory 首次尝试时刻。
`type=promise` 或 due_at 非空只进 pending-due；其余 none；due_done_at=null；quoted 命令不自动理解正文期限。
所有派生候选也过同一 due 闸门；本批没有 open 授权入口，拒绝外来 open 数据冒充已批准。
跨窗口同身份 pending-due 超 100，在同一写锁内按入队提交序号/id 最旧转 shelved-due，至 100。
满 14 天无确认也 shelved-due；状态/索引/报告事件同事务；时钟回拨停止时间老化；归档不退休事实也不改正文。
未归组主题禁止裁决、supersede 任一端及梦确认依据；模型反复使用或同名多条都不提升权限。
候选提及 ce:SHA-256([observationId,source_span,scope_id]) 与候选同事务登记；只是原字节与证据，不填定义、类型或 alias。

## 6. 可靠提交：读回三态与冻结

接口：`commitControlled(runtime, operationSpec, writeTxn, readExact): CommitReceipt`，业务服务不得绕过。
operationSpec 包含 request_key、object_key、target_db、所有目标 id、不可变正文、事件/证据集合与预期提交版本。
写入 object_key=`目标库:逻辑对象id`；编译 object_key=`mode:sessionId:inject-stream`；改变 payload/revision 不换对象流。
operations 保存规范要求的 immutable_payload/hash、冻结生成值、status、failures/frozen/generation、last_readback/error。
operation_attempts 不补写 completed_at：为同一 attempt_no 追加 reserve/complete 两行，以 phase 区分，完成行带完成时刻和结果。
该附加 phase 表达只追加的尝试生命周期；UNIQUE(object_key,generation,attempt_no,phase)，失败计数按 reserve/完成折叠。
control_events 追加 reserve/success/freeze/reconcile/unfreeze，operations/object_streams 为其可重建投影；状态更新同控制事务留事件。
预扣过程：控制账 `BEGIN IMMEDIATE` → 验对象未冻结且无在途 → 固化 payload → reserve attempt → failures+1 → COMMIT。
主库写事务单独执行，不与 control 跨库 ATTACH 冒充原子事务；commit 后用新读事务按稳定 id 直读并核集合。
读回成功再开 control 事务追加 complete/success，更新 found、清零；控制回执写失败仍对调用方 unknown，恢复补核。
一次读回用对象提交时的历史投影完整快照；后续合法 timeline/last_touched 更新不应误报旧操作 hash 损坏。

| readback | 精确判据 | 处理 |
|---|---|---|
| found | 权威库目标、原文字节、证据/关系集合和提交版本完全匹配 | 返回 id/hash/revision；非冻结对象清零连续失败 |
| missing | 权威库可查，确认整个目标事务不存在 | 最多一次同键同 payload 即时补写 |
| unknown | 锁/权限/超时、内容不符、部分目标、只查到索引或控制回执失败 | 留原因；仅条件式幂等写可安全时最多补写一次 |

条件式写先查完整键：不存在则 INSERT；同键同 payload 返回已有；异文拒绝、不覆盖；六步部分缺失报 unknown/corruption。
只读预探测不计写尝试；即时补写必另 reserve/预扣；单调用最多原写+一次补写，不做第三次即时循环。
若缺安全条件式契约或不可写，记录 repair_blocked；原文保全位置、readback、attempts、frozen 一并返回。
已两败时允许 reserve 第三次；预扣为 3 后拦其它尝试，允许该在途第三次完成；found 可清零，失败/中断才 frozen。
崩溃恢复先直读：非冻结 pending 若完整 found 则补成功；否则未完成 reserve 占一败，再按限额调度下一尝试。
第三次已冻结后探到 found 仅记录 reconciliation=found，保持冻结；禁止后台自动解冻。
受控本地 `unfreeze(object_key,reason,newGeneration)` 追加事件；角色不是模型；旧 generation 尝试账永久保留。
control 不可写返回 control_ledger_unavailable，业务写数为 0；不能内存暂存计数或改无锁文件追加。
多进程互斥用控制账唯一在途约束及 SQLite 写锁；进程持有本地独占服务锁，锁失效须证实原进程结束再接管。
锁的持有人记录进程 id、启动指纹、instance id 和控制账 generation；重启用 OS 存活/启动指纹复核，避免 PID 复用误抢锁。
仅凭超时不能抢占活进程；无法证实死亡则 fail closed；跨 DSH 会话锁仍以动态双窗口证据决定能力开关。
编译也先冻结快照、写产物、读回 manifest；技术失败按会话流三败；容量不足不计技术失败。
编译 found 与 delivery 完全分开：没有宿主回执就 unknown，不通过重复外部发送猜成功。

## 7. 注入器官：按已验钩子编译，按能力闸门投递

### 7.1 宿主接法与轮次

唯一已验注入调用如下；preparedSectionText 由本轮编译产物提供，不把模型内容当指令执行：
```js
ctx.inject(['systemPrompt'], (c) => {
  c.systemPrompt.section({
    name: 'memsys:context',
    order: 500,
    text: preparedSectionText,
  })
})
```
只注册这一个 section，内部六栏目共享预算和 manifest，避免每栏重复算 H；保留返回 disposer，在卸载时注销。
禁止静态 `export const inject`，禁止注入 agent/session 伪服务，禁止未经 inject 访问 ctx.systemPrompt。
回合读取仅 `ctx.on('session/event', payload => consumeLog(payload.log))`；log 内按事件 type 分派。
`agent/inbox/spliced` 给原文和消息锚点；turn/start、step/start 给轮次；assistant/message 保存最终输出；turn/end 收尾。
system/message 只核 payload 是否出现；不能把它伪装成 received_ids/hash 的独立投递回执。
seq 按 session 稳定去重；roundId=受信 sessionId+turn 号；step、seq 记录定位，不能每个 step/end 开新轮。
多条完整 log 可能重复带旧事件；先以 sessionId+seq 去重，输入身份再用真实 message id/位置去重，禁止原文 hash 跨消息去重。
持久会话标识、callId 及消息身份字段从原始探针记录／宿主类型核实；未核字段不得自行写成 payload.sessionId 等假定结构。
`consumeLog` 维护已提交游标；只在相应 observation found 后推进输入游标，重启可重复补收但不得跳过未入账原文。
受信模式会话创建时冻结 work/life；无可靠 preset 则受控启动配置替代；仍不明只采观察及检索，不默认 life。
每轮流程须证实“输入采集完成 → 收尾扫描 → 冻结快照 → 编译 → section 更新 → 宿主构建 prompt”，不能只靠事件先后猜。
探针只证明 section 插入和 order 生效，尚未证明动态 text 更新接口、回调重入时机及多会话隔离；列为待验证。
适配器只使用实测后的 section 更新／重注册或宿主渲染回调；未验时不把启动时的一份字符串冒充逐轮更新。
若日志只能回合末收到，观察仍能入账，但需实测持久日志补收/下一轮屏障；输入中断恢复未验则关闭相应自动采集承诺。
默认 `auto_inject=false`；probe profile 仅以 diagnostic 开关测试段存在，不改变生产 auto_inject 或回执状态。预算或回执保证缺失时生产为 tools-only，delivery=unknown，不作逐轮全量承诺。
这不是重新否定已验钩子：section/log 能力直接继承探针；新增时序、身份、预算、回执各自单列验证。

### 7.2 全集 S 与排序

先在同一主库读快照重放状态、有效键、交付温度；origin 深度≤5，缺链/环为 unverified，含已知梦分支仍 from-dream。
新写空 origin 拒绝；来源读失败标 unsafe/unknown，禁止用旧缓存装成安全可折叠。只有可完成结构折叠者参与 S。
下面 `folded_memory` 是 select 模块在该读快照建立的逻辑行集／临时视图，不是新事实表：
```sql
SELECT m.*, f.fact_state, f.effective_topic_key, f.key_status,
       f.binding_status, f.credibility, f.conflict_marker
FROM memories AS m JOIN folded_memory AS f ON f.memory_id = m.id
WHERE f.fact_state = 'active'
  AND f.origin_safe = 1 AND f.credibility <> 'from-dream'
  AND f.delivery_cooled = 0
  AND (m.scene = :mode OR m.scene = 'both')
  AND (m.scope = 'global' OR m.scope = :window_scope)
  AND m.due_state NOT IN
      ('pending-due','shelved-due','pending-done','cooled-due')
ORDER BY m.id;
```
:mode 为 work/life，:window_scope 为 work-only/life-only；非法 scene/scope 组合已在写入口拒绝，旧非法行隔离。
此 SQL 无 LIMIT、无相关性阈值；quoted/proposed/unresolved 都可进 S；项目、梦、自我对象本批不造空事实占位。
先选 S 再排序；R=0.5×标签命中+0.3×字面重合+0.2×新鲜度，R_eff=R×F；0.45 只作相关标签。
字面按 NFKC/小写/去标点空白/码点二元组，idf=1+ln((N+1)/(df+1))；缓存绑定源 revision，写入身份绝不用此规范化。
新鲜度=initial_strength×2^(-age/HalfLife)，age=max(0,now-last_touched_at)；weight 0..3/4..7/8..10 分别 15/30/90 天。
栏目顺序：现在、还在进行、放在心上、还惦记着、相关记忆、审核目录；项目 Overview 本批不启。
现在含同一系统时钟、全局 last_spoke_at、能力状态、记忆背景声明；距离由同一读数算，未知不猜。
其它固定栏按 §6.1 排序，只有相关栏乘 F；跨栏 id 只放一次，slots 保存全部栏目标志。
完整目录含 id、≤80 码点短结论、业务时间或 unknown、来源/语义标签、归组/冲突标记和全文指针。
压缩只改本轮 summary_compressed，不改 memories.lossy；否定、条件、安全正文和主人边界不能被压掉。

### 7.3 预算、分组与返回结构

度量三列独立：Unicode 码点用 Array.from(text).length；UTF-8 用 Buffer.byteLength；token 用宿主 tokenizer 或已验证保守上界。
软预算 3200 码点；H 是该轮扣除其它系统段、工具声明及宿主预留后的记忆可用 token，不能直接用模型总上下文长度。
tokenizer/可用 H 未知时返回 `budget_unverified`，不以“1 字节=1 token”或字符倍数自证安全；单测使用明确标 test 的计量器。
K 包含固定头、至多 12 组、实际最长 id/cursor/命令/计数字段；M4 用真实序列化及 tokenizer 测上下界，不能手填 256。
数字或游标长度增长使 K 超过已验上界即重算/关闸；一轮内先固定 K，再判 P 与 grouped 是否放得下。
本批 P_h 是时钟、能力与背景声明及确有授权的安全固定项；无 projects，不凭模型标签制造硬保护；P_s 生产为空。
未批准 open 策略不接存量 open 承诺；检测到无合法原 due 回执则追加 due-state→pending-due，保留异常报告，不补造批准。
测试可以向 budget 纯函数提供明确标 test-only 的合法保护集合，测容量几何，不宣称 due 主人操作链已实现。
保护上限并验 64 成员、12288 字节、0.60H；K 计入硬层字节/token，不计成员；P_h/P_s 去重且独立列账。
生产无 P_s 也要输出软层 0 行；后批启 open 前须完整实现 80% 清单、满额退至 70%、预留恢复目标和三种合法入口。
本批若发现未支持的非空软保护流，关闭该流的自动保护承诺并报告，不偷偷省略 open 后仍报器官完整。
full→非 P 40/20/8 码点 compressed→grouped；完整目录超软但压后≤H 可带量交付，不能按相关性删条。
grouped 条件为最小逐条目录超 H、P+完整组头≤H；P 全部逐项保留，非 P 成员转 deferred。
P_h+K>H 才 protected_overflow；治理上限超限但仍≤H 是 hard_over_cap，不能混为宿主装不下。
protected_over_streak≥3 且硬层仍不可完整交付才 auto_paused；P_h+K≤0.8H 自动恢复 grouped；主人关闭不自动恢复。
硬层全文仍保存在快照供分页；未验证同轮多段能力不假装拆段成功，回执态 incomplete；容量失败不涨技术冻结次数。
展示组固定 scene(work/life/both)×类别(registered/ungrouped/review/dream)，至多 12，空组不列；本批 dream 组为空。
未归组按对象 id 成子组，resolved 按 topic_key；这是展示目录，不取得合并、裁决或扩场景权限。
每个非空组头列真实组名/id、未展开数和填满 snapshot_revision 的 memsys_context_get 命令；场景外不漏数量。

编译结果接口（字段完整，以下为形状而非虚构实测数据）：
```text
CompiledContext {
  snapshot_revision, roundId, source_revision, policy_revision,
  delivery_level: full|compressed|grouped|protected_overflow,
  delivery: unknown|incomplete|confirmed, capacity_insufficient,
  section: {name:'memsys:context',order:500,text,payload_hash},
  hard: {count,bytes,tokens,H,K}, soft: {count,bytes,tokens,H},
  groups: [{group_id,name,total_count,deferred_count,fetch:{
    tool:'memsys_context_get',args:{snapshot_revision,group_id,
      cursor:null,max_chars:8000,view:'current'}}}],
  status_report: {pending_due,shelved_due,pending_done,cooled_due,report_entry}
}
```
内部 manifest 另存 eligible_ids、实际 ids、expected_ids、各段 hash、完整 deferred_groups 成员清单，绝不塞全 id 数组进 prompt。
eligible_ids 覆盖 S、活动审核及固定段；expected_ids=实际条目 ids+group:<snapshot>:<group_id> 描述；本批无项目/梦项。
读回检查实际条目与 deferred 成员无重无漏覆盖 eligible，保护 P 全在实际条目；审核与固定段也计同一预算。
capacity_rounds 每 roundId/流记两层账、K、上限/余量、前后值、due_report_id、payload/full_directory bytes、tokens/H、组数及三种 streak。
预警阈值按 §6.4 原值：10240 字节/0.7H/80 子组/soft streak 2；升级 12800/0.85H/100/3，先生成分页报告。
hard streak=1 报告，≥3 继续 grouped，不自动暂停；grouped 不清 hard streak，恢复预算内才清。
未经主人批准不自动 delivery-cool；本批仅给冷却建议及 history 入口，不为减条数假执行合并或归档。

### 7.4 快照、投递与反馈

`snapshot_revision` 是控制账持久快照 id，绑定主库 revision、策略及模式；不是进程内数组序号，重启不能丢页。
快照固化目录原文、分组成员、序位及计数，默认保留 30 天；逻辑到期返回 stale_cursor，不删事实/事件。
本批不做物理历史清理；owner 延长保留期的维护能力后批接入，不能提前回收仍有效的游标。
独立回执须实际 received_ids=expected_ids 且完整 payload hash 匹配；缺回执 unknown，部分回执 incomplete。
只有合法回执证实的逐项 memory ids INSERT injections；组描述不算组员曝光，UNIQUE(roundId,memoryId)，slots 一次写成集合。
编译可为 grouped 且 delivery=unknown；不能用一个枚举同时表达布局等级和投递证明。
模型反馈缺失 unknown、显式 [] 为 unused；仅接受本轮确已投递或实际查出 id；无回执停止曝光反馈计数。
lookup 成功可独立触碰，不依赖注入回执；反馈工具优先于兼容文本，最终反馈一次，修正另追加事件。
unused k<3 时 F=1，k≥3 时 F=0.5^(k-2)；unknown 不增不清，真实 used/lookup 清零；F 只影响排序。
文本隐藏能力未验，兼容块默认关闭；缺块仅 extraction_missing/feedback unknown，不记数据库技术失败。

## 8. 工具定义与分页

所有工具顶层 JSON Schema 为 object、additionalProperties=false；runtime 角色/session/round/callId 不放进模型可填 schema。
工具注册 API 尚待实测，业务 handler 和以下 schema 固定；适配层不得因宿主差异删字段或假造返回。
公共分页字段：cursor:string|null 默认 null；max_chars:integer 默认 8000、最小 1000、最大 16000；view 枚举 current/history 默认 current。
max_chars 计整个序列化返回的码点预算，预留错误/页头开销；正文分片按码点，source_span 仍是 UTF-8 字节，二者字段不可混用。

| 工具名 | required 与入参 schema | 返回和范围 |
|---|---|---|
| `memsys_get` | required ids；ids:string[]，1..10 且 uniqueItems；view；include_evidence:boolean 默认 false；cursor；max_chars | items、missing_ids、snapshot_revision、next_cursor、truncated、clock；id 指定时任何状态均可查 |
| `memsys_search` | 无 required；keywords:string；scene 枚举 work/life/both；topic_key:string；time_range:{start?,end?,as_of?}；graph:{seed_ids,depth}?；cursor；max_chars | hits、group_index、direct_hit_count、evidence_mean、relation_depth、clock 及分页头；支持空条件分页 |
| `memsys_review_get` | ids:string[1..10] 与 kind 二选一；kind 枚举 candidate/pending/due-history；cursor；max_chars | entries、证据原文、default_outcome、deadline、可用操作、历史原因及分页头，不作为事实正文 |
| `memsys_context_get` | required snapshot_revision,group_id；二者 string；cursor；max_chars；view | 同快照组名/计数、本页目录、子组入口、剩余数、next_cursor、clock |
| `memsys_record` | required kind,items；kind 见下；items:object[1..20]；evidence_refs:string[]；request_id:string 可省略 | 每项 operation_id/id/readback/pendingId/validation_error/failures/frozen，服务盖真实 request_id |

所有嵌套 object 同样 additionalProperties=false；字符串 id/ref 非空，空 cursor 只可为 null；未知枚举报 validation_error。
search.time_range 的 start/end/as_of 为有时区 ISO 字符串或明确 YYYY/ YYYY-MM/ YYYY-MM-DD 精度，校验 start≤end；缺边界不填审计时间。
search.graph 的 seed_ids 为 1..10 个非空 id、depth 为 1..5 整数；参数格式合法仍因本批无图功能明确 unsupported_feature。
record.type 枚举 identity/preference/promise/episode/fact/emotion/procedure；weight 为 0..10，detail 为 string|null，tags 为去重 string[]。
record.time 为 {start,end,prec_start,prec_end,time_state,evidence_ref,source_span}；精度与四态按 §7.1，due_at 同样需 evidence_ref/span。
record.topic_components 为 {entity_ref,attribute_ref,object_ref}，object_ref 可 null；scope 由 runtime 定；entity_mention 为 {evidence_ref,source_span}。
source_span 为 {start,end} 非负整数字节范围；source_unit 为受控绑定字符串；items 数量 20 是本批单请求资源上限，不影响全集 S。
工具错误公共返回 {status,code,message,retryable,unresolved_ids,clock}；成功 clock 为同一系统读数，所有错误路径也不能伪造命中数。
request_id 若宿主 schema 要求显式字段，由适配器注入真实 callId 派生值；模型任意字符串只作相关标识，不能改变幂等或解冻。
record kind 本批只接 candidate/promote_candidate/reject_candidate/propose_owner_action/feedback/timeline_change/pointer_change。
candidate item required text/why/type/evidence_refs/source_unit；可选 detail/tags/topic_components/entity_mention/structured_value/time/due_at/weight。
source_unit 必须由引用观察+已核 span 或持久项槽绑定；模型可建议定位但不能任意改单位身份绕去重；禁止直接输入 topic_key。
promote/reject item required candidateId/baseRevision/reason；propose_owner_action required action/targetIds/baseVersions/payload/evidence_refs。
feedback required used_memory_ids:string[]；timeline/pointer required targetId/baseRevision/from/to/evidence_refs/reason；对象 from/to 字段严格白名单。
本批 timeline_change 只结束有据 ongoing；补 start、改变解释或扩大场景进入权限提案；pointer_change exact 必须完整原文匹配。
不注册 project_get/self_get；不支持 judgment/speculation/self_note/dream/project 的 record kind，返回 unsupported_in_batch。
search graph 参数若出现则 `unsupported_feature=graph`，不假装零命中；时间查询支持粗精度边界及 possible_overlap，不用未知 end 当正无穷。
主动 get/search/review 可以跨窗口查询，始终返回 scene/scope 与来源限制；自动快照 context_get 不扩大该快照场景。
具体 id 在 current 下也返回其历史状态，不把退休误报 missing；组的 current 展开活跃成员，history 给历史索引。
search 返回目录不加 lookup；get 的正文含 text/detail/why、原观察、来源图、语义状态、时间线、门牌及组/待裁决标记。

`memsys_context_get({snapshot_revision,group_id,cursor=null,max_chars=8000,view='current'})` 的返回固定为：
```text
{status:'ok',snapshot_revision,group_id,name,total_count,deferred_count,
 page_count,remaining_count,items:[DirectoryItem|TextFragment],
 subgroup_total,subgroups:[{id,name,count,fetch}],subgroups_next_cursor,
 next_cursor,truncated,clock}
```
group_id 可为顶层或已返回的子组 id；子组目录另分页，所有 fetch 绑定同一快照，第一组页无需一次塞所有子组。
view=current 的分组页仅展开编译时该组 deferred 成员，total_count=deferred_count；已单列 P 不再次入页，读取不改编译计数。
view=history 使用同快照历史报告成员，total_count 为历史成员数、deferred_count=0；两种 view 的游标、计数及子组目录分别绑定。
remaining_count 为目录尚未完整送出的成员数；跨页大条目的最后一片才减少该成员，page_count 只计本页完成的成员。
正文片 `TextFragment={id,path,offset,total_chars,text,fragment_complete}`；offset 用码点，按 path 稳定顺序分页，不遗漏后半原文。
cursor 为服务生成的不透明 token，绑定工具名、规范输入 hash、快照、group/view、对象序位及字段偏移；不能仅 base64(offset) 任意改组。
快照页及 cursor 状态持久写 control，经读回才返回；跨库读取先固定完整结果快照，不能翻页再查最新版原文拼接。
非法/错组游标为 invalid_cursor；真实过期为 stale_cursor，返回 fresh_report_entry，调用方从新快照重取。
新报告入口只返回可用快照 id 与调用参数，不自称旧页可接续；源数据改动本身不使尚保留的旧快照自动失效。
成功未命中为 status=ok 且 missing_ids/hits 确定；不可查返回 status=unknown/error、error.code、unresolved_ids，不归入 missing_ids。
所有文本都来自已存原字节；禁临时补全原文；语义标签与 unknown 业务时间不可为省预算丢掉。

`lookup` 只在日常对话实际获得完整或明确分片正文后记；后台、dream/maintenance、目录、空页、错误均不计。
按 roundId+memoryId+lookup 去重，memory-touch、uses、last_touched_at 同事务；同轮多次/多页只加 1，uses 不能冒作证据独立性。
used/owner_mention 可触碰但不加 uses；last_touched_at=max(recorded_at,有效touch.at)，不改业务发生时间及 initial_strength。
工具返回是否真正交付的钩子待验证；只有服务构造结果而无成功返回证据时记录 pending lookup，不加 uses，恢复不得重复计。
生产本批不启普通自动冷却；lookup 不恢复 pending/shelved/pending-done/cooled-due 的 open，也不刷新 due-mention 锚点。

## 9. 测试策略与造数步骤

测试使用真实 SQLite 临时目录、同一生产服务、受控假 runtime 及可注入时钟；不以 mock 返回 found 代替存储断言。
测试身份固定 `test-owner/test-session` 并在证据上标 fixture；这些数据不写生产库，不冒充真实主人说过。
每条专测命令负责表中的全部断言；失败输出用例名、目标 id、期望/实际 hash，日志不打印凭据。

| 套件／命令关联 | 重点用例 | 必须验证的反面 |
|---|---|---|
| m1-storage（M1） | 全表/索引、二次迁移、WAL、外键、事件重放、备份隔离恢复 | 修改已用迁移 hash 拒绝；活动 WAL 数据不能在备份中丢失 |
| m2-write（M2） | 三种输入、命令精确匹配、证据 span、快照各自冻结、提升六断点 | 包含“不”的异文不去重；引文命令不执行；后段失败不抹 observation |
| m2-write（M2） | 未归组直接提升、同名跨观察、alias 零/多命中、resolved 分歧 | 未归组不裁决；master 来源模型解释仍 proposed；start=null 不死等 |
| m2-write（M2） | capture 输入序号/期限、coexist 全事务、权限 deferred、pending 101 条 | 不等模型输出；跨窗口共同限额；第 101 条不扩大 P；回拨不提前老化 |
| m3-reliable（M3） | found/missing/unknown、只一次补写、在途第三次成功、重启冻结 | unknown 不当 missing；revision 不绕冻结；control 失效时零业务写 |
| m3-reliable（M3） | 双子进程同键竞争、不同对象隔离、控制成功回执写失败 | 不按超时强抢活进程；失败计数不随业务回滚消失 |
| m4-context（M4） | S 等于预期集合、跨栏去重、排序/来源、每轮内容改变 | 低相关条仍在；场景外无计数泄漏；缺回执无曝光/unused |
| m4-context（M4） | full/compressed/grouped、12 组 K、巨条、H 缩小、阈值账 | P_s 空也要分账；保护正文不可裁；容量不足不算技术三败 |
| m5-tools（M5） | 五工具 schema、current/history、超长中文/emoji 分片、cursor 重启 | 非法参数拒绝；错误不报 missing；跨页不换快照，不截后半 |
| m5-tools（M5） | 时间区间包含/相交/未知、lookup 去重与成功返回故障 | ended_unknown 不当无限未来；目录/空页/后台不触碰 |
| live-check inject（M4） | 独立 profile 的真实 system/message、session/event.log、双会话 | 缺事件、串会话、旧字符串冒充逐轮更新均非零退出 |
| live-check tools-e1（M5） | 真实工具可调用、读原文、输入→下一轮段更新 | 工具仅出现在列表不算通过；测试回执不能变生产 capability=passed |

### E1 输入一句话→下一轮目录

1. 新建隔离库并迁移全部本批版本；fake runtime 选 life、明确稳定 session/turn/messageSeq，模型输出设置为空。
2. 送入完整受信测试消息 `记住：不吃葱。`，通过 session/event.log 的 agent/inbox/spliced 适配器进 observeInput。
3. 等 observation 的真实 found，再检查自动 capture、quote、memory、timeline、pointer、memory evidence、promote 集合。
4. 断言正文精确“不吃葱。”，quoted/utterance、来源为测试 owner 原输入、业务 start=null，scope=life-only；capture 已 shelved。
5. 推进真实测试轮次身份，先扫描恢复，再编译新 round；给足测试 H，读 section 含 id/正文/来源/语义标签和背景声明。
6. 整个过程不调用模型、不发块、不调用 promote 工具；用同一 event 重放，观察/记忆数量及输入序号不变。
7. 不给回执时 assert delivery=unknown、injections=0；另用明确 test-only 的合法回执验 confirmed，不写生产能力 passed。
8. 动态复现向独立 probe profile 送同一句受信输入，再发无记忆块的第二轮输入，抓实际 system/message 核匹配；无回执仍 unknown。

### E2 新食材→未归组可检索

1. 新隔离库仅启初始 registry；受信测试输入 `我不喜欢刺角瓜。` 入 observation，原始中文以 UTF-8 保存。
2. 工具假 runtime 以稳定 callId 提交第一档 candidate：text=不喜欢刺角瓜、why=会改变选食材、type=preference。
3. evidence_refs 指向该观察，entity_mention 给“刺角瓜”的精确字节 span；建议 owner/food_preference，客体尚未正式注册。
4. 不调用 promote；候选事务后服务直接提升 memory，断言 proposed/assertion、key_status=unresolved、标 model_inference。
5. 检查 ce 提及只保存原文/证据/范围，没有正式定义或 alias；另一消息同名建立另一 ce，不据此合并。
6. search 与 get 能读回原文、来源和未归组标；life 的 S 含该 id，work 的自动 S 不含，主动跨场景查询可查。
7. 用此 id 尝试裁决/supersede/confirm 入口得到 unsupported_in_batch；另直接测 authority 判定 unresolved_forbidden，覆盖作为两端及依据。
8. 对同一输入重复工具调用语义不变只一候选；改变否定生成新候选并留 derived，绝不覆盖“不喜欢”。

### E3 超硬预算→逐组取回

1. 通过 observe/candidate/promote 服务在隔离库造至少 200 条非 due 记忆；生产规则一致，输入和来源全标 fixture。
2. 构造已注册/未归组及活动审核三类；需正式客体的 fixture 由测试专用受信配置种子提供，不能开放生产模型注册后门。
3. 添加各组中文、emoji、否定条件、一个超过单页的大正文；另造场景外条目作不可泄漏对照。
4. 按测试 tokenizer 算 P+K 与最小逐条目录量，选 `P+K < H < 最小逐条目录tokens`，不能盲目把 H 降到保护头也装不下。
5. 编译后 assert level=grouped、capacity_insufficient=true；所有非空可见组均有名称/id、未展开数和可执行 fetch 参数。
6. 对每个 fetch 调 context_get 并追完 next_cursor 与 subgroups_next_cursor，跨进程重启后继续剩余页；大目录项也分片完整。
7. 核遍历的 deferred 成员集合与 manifest 相等、无重无漏，P 与 deferred 不交；各组计数和 remaining_count 收敛到 0。
8. 按目录 id 用 get 拼完整正文，逐码点等于原存文本；分页正文触碰同轮只 1 次，context 目录触碰 0 次。
9. 源库追加新条后旧游标仍返回旧快照；测试时钟推进至快照保留边界外得到 stale_cursor 和新报告入口，不接新版拼页。
10. 降低 H 至 P_h+K 也装不下，断言 protected_overflow/incomplete；重复三轮才满足容量暂停条件，不增加对象技术 failures。
11. 增大可用 H 至 P_h+K≤0.8H 后自动 grouped；另外测试主人关闭不自动恢复；所有 token 断言注明测试计量器，非宿主校准结果。

故障点必须覆盖：控制账 reserve 前后、observation commit 后、候选 commit 后、提升六步每步、业务 commit 后读回前、control 成功回执前。
子进程用可控断点退出，不靠人为关窗口或真实等待期限；重启实际重开同一数据库，不能重置测试目录假称恢复。
模拟 hash 不符、读锁、权限拒绝和索引孤儿，分别断言 unknown；权威库完全不存在才 missing。
历史投影测试先成功修改 timeline/touch，再重读旧 operation，仍按其提交版本 found；缺任一证据集合必须 unknown。
备份恢复测试包括主库成功/控制账尚未记成功的断点；恢复先 reconciliation，不盲目重做外部投递。

## 10. 风险、待验证与降级

| 项目 | 已知／待验证 | 验证位置 | 失败降级 |
|---|---|---|---|
| 动态注入和 session/event.log | 已由 probe-p0 证实；不能改成总线 assistant/message | M4 真实 system/message 复核适配器 | 注销错误适配，保留主动工具 |
| sessionId/callId 重启稳定性与输入事件完整时机 | 待验证；turn/step/seq 存在不等于所有身份字段已验 | M4 live 双轮、重复回调、输入后输出前中断 | 已验持久日志位置补收；两入口均无则停自动采集，只显式导入 |
| section 每轮更新、共享服务会话隔离 | 待验证；探针只有固定段 | M4 live 两窗口各自不同 id | 单会话工具模式；不共享可变全局 preparedSectionText |
| 真实角色/preset | 待验证字段及信任链 | M4 启动配置与日志身份匹配 | 受控配置显式模式；不明禁权限写和自动注入 |
| H/tokenizer/宿主静默裁尾 | 待验证，不能以 UTF-8 字节代替 token | M4 live 长负载与逐段 hash | tools-only，预算标 unknown，编译 mock 通过不算动态通过 |
| 独立投递回执 | probe 未得到对象 | M4 delivery adapter 可用性探测 | delivery=unknown，停曝光反馈；无全量承诺，不重发猜成功 |
| 工具注册与成功返回通知 | 待验证，探针未测工具 API | M5 live 实际调用及失败返回 | 路径 A 继续；handler 离线可用，宿主工具未过不得声称已上线 |
| 跨会话写锁/进程死亡接管 | probe 未验 | M3 真子进程+M4 双 profile | 单受控服务进程串行，拒绝第二写者，不能退无锁 append |
| node:sqlite 备份 API | WAL/建表已验，备份尚待验证 | M1 WAL 活动数据备份恢复 | 停写 VACUUM INTO 实测；仍失败则阻断迁移 |
| scope 扩大/注册纠错负担 | 已知取舍，本批无 owner 专有入口 | M2 未归组权限负例 | 原文/proposed 可留；明确需后批注册/rekey 才能裁决 |
| pending-due 召回损失 | Opus 已指出；它被排除 S | M2 队列及 M4 S 测试 | 状态头+review_get 报告，正文不偷塞；待后批召回方案 |
| open 与软保护完整生命周期 | 本批不开放且未批准策略 | M4 空软层及入口拒绝；后批另验整套 | 不启 P_s 承诺，不假实现 due 容量退让或主人面板 |
| K/目录规模与保留历史增长 | 上限参数待实测，快照持久占空间 | M4 12 组/巨条/边界数字、M5 续页 | grouped 或 protected_overflow；只报告磁盘压力，不删事实 |
| 回执 hash/tokenizer 版本改变 | 待验证宿主升级失效机制 | capability_report 版本差异测试 | 受影响能力变 unknown，重验前关闭对应自动开关 |
| 工具成功后触碰记账失败 | 跨边界非原子，不能装成正文读取失败 | M5 结果已返回/控制账失败断点 | 标 activity_pending，恢复同 round/id 幂等补账；不重复向外发送正文 |

capability_report 必含宿主/插件版本、能力名、passed/failed/unknown、请求和结果证据路径/hash、替代路径及验证环境。
每次 live-check 写独立报告到 `_build/artifacts/`，不修改原 probe-p0 结论；没有证据的项保持 unknown。
动态验证只用独立 profile，不安装到 desktop；凭据通过受控环境/现有安全配置输入，不出现在命令行、日志或快照。
不照搬旧 run-probe 的输出脚本：probe-p0 指向 probe10.jsonl，而旧 runner 读取 probe.jsonl；live-check 必须校准实际文件路径。
工具注册失败、真实 H 不明或缺回执不是文档补一句即可通过；主管报告必须清楚标“离线实现通过／动态能力未闭合”。

## 11. 文档自检与交付口径

以下是本图静态自检；不能替代尚待施工的 Node 测试或 DSH 动态验收。

| 任务要求 | 本图自检结果 | 核验位置 |
|---|---|---|
| 五个里程碑都有可执行命令 | 是；五段均指定 node --test 文件，另列动态命令及期望 | §3 |
| 无模型每轮吐块的唯一入口 | 是；输入采集/capture/记住命令不等输出，E1 模型为空 | §5、§9 E1 |
| 注入及回合读取按探针 | 是；ctx.inject(['systemPrompt']) + section order=500；session/event.log | §7.1 |
| M1–M3 可脱离 DSH 验收 | 是；内置 SQLite、真实测试库、假 runtime，无宿主导入依赖 | §2、§3、§9 |
| E1–E3 有构造数据步骤 | 是；分别 8、8、11 步，覆盖无块、未注册、超硬预算 | §9 |
| 里程碑无循环 | 是；M1→M2→M3→M4→M5；M4 自带 context 页处理器 | §3 |
| 存储/幂等/六步/读回有落实 | 是；迁移有序、六步单事务、原键全列、预扣与恢复分开 | §4–§6 |
| 取回契约与范围一致 | 是；四个读取工具+record，后批工具明确不注册 | §8 |
| 有假设即有待验证和降级 | 是；宿主新增能力独立列项，已验 section/log 不重新假定 | §10 |
| 编码、行数、表格及受保护输入 | 由本次 Node 静态检查回填，结果见末行 | 本文件字节与输入 SHA-256 对比 |

静态检查结果：共 636 行（要求 400–700）；UTF-8 无 BOM／替换乱码；代码围栏闭合；10 张表无空项或错列；5 个里程碑均有 node --test 命令；32 个受保护输入文件 SHA-256 未变。实现验收与动态验收均未执行。
