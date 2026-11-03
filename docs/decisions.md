# 施工决定记录（图没写死、施工时定的）

> 每条都经主管确认。以后回看"为什么这么做"就看这里。

## M1（2026-11-03 00:2x 验收通过）

| # | 决定 | 理由 | 谁定 |
|---|---|---|---|
| 1 | 备份用 `VACUUM INTO`，不用 `db.backup()` | `node:sqlite` v24 的 `DatabaseSync` 没有 `backup()` 方法（图 §4 允许降级）；另加 WAL 断言：写入落在 `-wal` 里时备份副本仍能读到 | builder 提，主管认 |
| 2 | 源码检查点写 `_build/backup/<批次>/`，三库备份写 `<data-dir>/backup/<批次>/`；`checkpoint.mjs` 支持 `--out` | 防止每跑一次测试就往 `_build/backup` 堆一份；测试写临时目录 | builder 提，主管认 |
| 3 | 梦库 `dream-001.sql` 只建 `db_marker` 一行（`schema_role=dream-placeholder`） | 第一批不建梦表，但要占 schema 版本位，迁移计数才有意义 | builder 提，主管认 |
| 4 | `commitControlled` 在发起补写前，先把第一次尝试按 missing/unknown 结掉，再 reserve 第二次 | 对应 §13.0.6"一个 object_stream 只准一个在途尝试"；三次失败冻结、第三次 found 清零都有断言 | builder 提，主管认 |

## 验收证据（主管亲自跑，2026-11-03 00:22，读数 1346b6）

- 迁移：`MIGRATIONS_OK main=2 control=1 dream=1`，exit=0（从干净 `test-data/m1` 重跑）
- 测试：24 tests / 24 pass / 0 fail / 0 skipped
- 库检查：main/control/dream 三库 `integrity_check=ok`、`foreign_key_check=0`
- 门禁：`BUILD_OK files=22`、`UTF8_OK BOM=0 files=27`

## M2（2026-11-03 00:30 验收通过，读数 943cf9）

| # | 决定 | 理由 | 谁定 |
|---|---|---|---|
| 5 | **改动 M1 代码**：`commitControlled` 业务写抛错时不再触发即时补写，只记 unknown 收尾 | 六步失败是业务回滚，重放等于二次执行；补写只该用于"写成功但读不到"。M1 的 missing 补写用例仍全过 | builder 提，主管认 |
| 6 | `candidates.reason` 属 M1 铁律的不可变列 → shelve/coexist 的原因只写事件 payload，不写列 | 候选内容不可变（§13.0.3），原因属于"发生了什么"，进事件账才可重放 | builder 提，主管认 |
| 7 | resolved 但同键无旧记忆 → 直接提升；resolved 同键同值 → 只进审核队列，不重复建记忆 | 避免同值重复入档；无旧条时没有冲突对象，不该卡 pending | builder 提，主管认 |
| 8 | 场景扩大（both/global）一律停在 pending + 提案，不静默放宽可见范围 | 跨场景扩大属主人专权（§8.3），机器不能替主人扩权限 | builder 提，主管认 |
| 9 | `timeline_change` 本批只允许 ongoing→ended_unknown；`pointer_change` 转 exact 必须有具体位置 | 没位置转 exact 就是编门牌（§7.6"精度不够就停在那档"），validation_error 才对 | builder 提，主管认 |

**M2 验收证据（主管亲自跑）**：`m2-write.test.mjs` 34/34；全量 `npm test` **58/58**，fail 0，skipped 0；`BUILD_OK files=34`；`UTF8_OK BOM=0 files=39`。

## M3（2026-11-03 00:35 验收通过，读数 e87c04）

| # | 决定 | 理由 | 谁定 |
|---|---|---|---|
| 10 | **改动已验收模块 `src/control/commit.mjs`**：加 `spec.hooks` 六处断点钩子（生产不传即空）；control 回执写失败时返回 `status=unknown, controlReceipt=failed`，不把业务成功当成功 | 回执失败 ≠ 业务失败，必须分状态；断点钩子让"崩溃点可控"可测而不是靠 sleep | builder 提，主管认 |
| 11 | `observe/capture/candidate` 只透传 `deps.commitHooks` 到 spec.hooks，不传时行为不变 | 不加分支、不改默认路径 | builder 提，主管认 |

**M3 验收证据（主管亲自跑）**：`m3-reliable.test.mjs` 20/20；全量 `npm test` **78/78**；`BUILD_OK files=38`；`UTF8_OK BOM=0 files=43`。

## M4（2026-11-03 00:46 验收通过）

| # | 决定 | 理由 | 谁定 |
|---|---|---|---|
| 12 | 曝光与投递分库：`injections` 在主库、`deliveries` 在控制账，跨库不宣称原子；控制账写失败 → 调用方拿 `unknown`，曝光另写、恢复时重核 | 两库无法一个事务，硬说原子就是骗人；分状态后可重放 | builder 提，主管认 |
| 13 | 分组头预算 K 含组头自身 → `H=1` 先触发 `protected_overflow`；测试用 overflow 返回的 `hard.tokens` 反推 K 再测 grouped | 避免拍脑袋填 H，测试自洽 | builder 提，主管认 |
| 14 | 没有 tokenizer 或宿主 H → tools-only（`section=null`、`delivery=unknown`、`delivery_level=unavailable`） | 不许拿字节冒充 token（§6.4） | builder 提，主管认 |
| 15 | `auto_inject` 默认 false；只有探针 patch 开 `diagnostic_section` 才注册段 | 生产不注册、不冒充逐轮交付 | builder 提，主管认 |
| 16 | 分组头三件套固定格式（组名+组 id+未展开数+完整 `memsys_context_get(…)`），测试断言全文不出现"另有" | §6.4 硬要求 | builder 提，主管认 |

**事故（已恢复，留档）**：`dsh plugin add file://` 把 `whale-unify/memsys` 以 junction 链进探针 profile；`--from-default-profile` 重建 profile 时递归删 `node_modules`，Node 沿 junction 把源码目录一起删了。已从 M3 检查点恢复 43 个文件、78 条测试复跑全绿，再重做 M4。防护见 `env-facts.md`「硬禁止」一节。

**M4 验收证据（主管亲自跑）**：`m4-context.test.mjs` 21/21；`LIVE_CHECK_OK case=inject plugin=loaded section=memsys:context order=500 auto_inject=false delivery=unknown`；全量 `npm test` **99/99**；`BUILD_OK files=52`；`BOM=0 files=60`。

## 验收分工（主人 2026-11-03 00:58 定）

- **过程中**：builder 自测 + 主管跑 `acceptance.md` 命令判过/打回。Codex 只出图，不参与逐批验收。
- **全部做完之后**：把整套代码 + 各批 `report-N.md` 一起交给 Codex 做**一次总复核**，只回答"有没有偏离设计稿的地方"。
- 因此过程中要把 `report-N.md`、`decisions.md` 写扎实，否则最后复核没有上下文。

## 第二批 · P2-M1（2026-11-03 01:05 验收通过，读数 7d753f）

| # | 决定 | 理由 | 谁定 |
|---|---|---|---|
| 17 | `appendRelation` 严格幂等默认开启：同键比规范 payload + 事件/负载版本，同文重放返回原 id，异文抛 `idempotency_conflict`；旧 `type:businessKey` 键格式不变 | 新事件要严格，老事件一个字节不许变 | builder 提，主管认 |
| 18 | 模型原输出在 self-note 内部先落库（`obs:model:<session>:<callId>:<slot>`，`source=model`），不改 `write/observe.mjs` | 图 §2.1 没授权改 observe；这样也保证"业务失败不丢原输出" | builder 提，主管认 |
| 19 | `reflection_judgment_ids` 非空 → `dependency_unavailable` | 不静默丢字段（图 §4） | builder 提，主管认 |
| 20 | 成环/异键冲突在事务内整笔回滚，原笔记仍可查 | 半条修订比没有更糟 | builder 提，主管认 |
| 21 | `self_get` 游标绑 `kind+view`，换视图返回 `invalid_cursor` | 不拿旧页拼新视图 | builder 提，主管认 |

**P2-M1 验收证据（主管亲自跑）**：`p2-m1-self.test.mjs` 22/22（`P2_M1_OK self_note=true author_bound=true append_only=true forks=2`）；全量 `npm test` **140/140**；`BUILD_OK files=64`；`BOM=0 files=74`；迁移 `main=4 control=2 dream=1`。

## 出图模型约定（主人 2026-11-03 定）

| 批次 | 出图模型 | 备注 |
|---|---|---|
| plan-1 | gpt-6-astra | 已交付 |
| plan-2 | gpt-6-astra | 已交付 |
| plan-3 | gpt-6-astra | 进行中（sol 起草被叫停，已改回 astra） |
| **plan-4 起** | **gpt-6.1-sol** | 主人定：从第四批开始用 sol 出图，快 |
| 最终总复核 | gpt-6-astra | 最后一道，不求快 |

## 第二批 · P2-M2（2026-11-03 01:14 验收通过，读数 7017fb）

| # | 决定 | 理由 | 谁定 |
|---|---|---|---|
| 22 | master 层不可被模型覆盖：存在有效 master verdict 时，任何 self/auto 新 verdict（含 pending）返回 `invalid_transition` | 主人裁决是权限，不是"优先级更高的值" | builder 提，主管认 |
| 23 | outcome 重放先查事件再验状态：同 requestId 的重复 outcome-change 直接返回原结果 | 避免状态已变导致 replay 被判 stale | builder 提，主管认 |
| 24 | needs-review 的 deferred 只写 `review-defer` + `unreviewed=true`，verdict/outcome 一个不改 | 退出待办 ≠ 改判 | builder 提，主管认 |
| 25 | topic 碰撞在**候选落库时**就写 needs-review，不等提升后 | 候选停在 pending 也要能复核 | builder 提，主管认 |

**认可的一处"偏差"**：`judgment_current.outcome_revision` 走 state 投影，原始 `judgments.outcome` 列保持不可变初值——符合"事实只追加、当前状态可重建"，M5 不调。

**P2-M2 验收证据（主管亲自跑）**：`p2-m2-judgment.test.mjs` 22/22；全量 `npm test` **162/162**；`BUILD_OK files=68`；`BOM=0 files=79`；迁移 `main=5 control=2 dream=1`。

## 第二批 · P2-M3（2026-11-03 01:20 验收通过，读数 5aedad）

| # | 决定 | 理由 | 谁定 |
|---|---|---|---|
| 26 | `projects` 表严格只放身份（名/场景/来源/创建时间），四项状态只在 `project-update` 事件 + `state.project:<id>` 投影，`rebuildProjection` 必须与 state deepEqual | 身份与状态分离，投影可丢弃重建 | builder 提，主管认 |
| 27 | evidence 记为 `{ref,kind,hash}`；被 `verdict-void` 撤销的裁决整版失效 → `effectiveRevision` 回退、`headRevision` 不动 | 证据失效要能回退到上一版有效状态，但不能改写历史头 | builder 提，主管认 |
| 28 | 重放先于版本校验：同 `requestId` 重复提交先查原事件再验 `baseRevision` | 否则重试被误判 `stale_project` | builder 提，主管认 |
| 29 | 显式同值按继承处理：同字段原值重填不算新声明，evidence/origin 继续并集；只有值真变才挂新证据 | §6"不以原值重填洗白" | builder 提，主管认 |
| 30 | 模型 `project_update` 只走 work 窗口，life 窗口直接拒；主人专有 create/select/complete 必须绑定回执 | 项目属于工作窗口，生活窗口不该有 | builder 提，主管认 |

**未闭合（照实记）**：`project_capacity_blocked` 依赖 M4 预算/容量接口，留到 P2-M4 与 due 容量一起做；M3 没有用假 H 顶替。

**P2-M3 验收证据（主管亲自跑）**：`p2-m3-project.test.mjs` 14/14；全量 `npm test` **176/176**；`BUILD_OK files=72`；`BOM=0 files=85`；迁移 `main=6 control=3 dream=1`。

## 第二批 · P2-M4（补记，编号 31–34；2026-11-03 01:25 验收通过，读数 b3ffbb）

| # | 决定 | 理由 | 谁定 |
|---|---|---|---|
| 31 | 确认一条 pending-due 后：它离开 D、进入 S，整体 eligible 数守恒但**组成变化**；测试按组成断言，不按总数 | 总数守恒容易被误读成"没变化" | builder 提，主管认 |
| 32 | due 容量**只做硬闸门**（拒绝确认并保持 pending），不做自动退让 | 退让必须先有容量报告与主人可见清单，否则是暗箱（见 #35） | builder 提，主管认 |
| 33 | `due-batch` 明确 `unsupported_in_batch`，只保留命令解析 | 不假装执行批量 | builder 提，主管认 |
| 34 | 到期上界读 `due_queue.deadline_at`（memories 无 due_at 列） | 以队列为真源 | builder 提，主管认 |



## 第三批前置（2026-11-03 01:32）

| # | 决定 | 理由 | 谁定 |
|---|---|---|---|
| 35 | **due 容量退让链等 `due-policy-v1` 获批后再补**；未批准前退让路径必须不可达，只能"拒绝 + 报告" | 退让没有主人可见的清单就是暗箱；宁可先拒绝 | 主管定，builder 认 |
| 36 | C4 的 gate 必须断言"policy 未批准时退让路径不可达" | 防止暗箱退让被测试或文档悄悄放行 | 主管定，builder 认 |
| 37 | 迁移基线：`main=6 / control=3 / dream=1`；10 个旧 SQL 的 SHA-256 记入 `_build/artifacts/p3/c1-baseline.json`；C1 终态 `7/4/2` | 只往后接，旧文件字节不动 | builder 提，主管认 |
| 38 | `main-007` 四列（key_status/binding_status/binding_basis/origin_mode）新写必填、禁 UPDATE；旧行 NULL + `key-state-backfill` 事件解释，无法核得的标 `legacy_binding_unknown`（保留检索、阻断裁决/merge/梦确认依据） | 不凭 `tk:` 前缀猜 resolved，不推导 accepted | builder 提，主管认 |

## 第三批 · C1（2026-11-03 02:20 验收通过，读数 37515d）

| # | 决定 | 理由 | 谁定 |
|---|---|---|---|
| 39 | 记忆 origin 不放 `d-…#pN`，只放 model 来源 + 命题观察引用；梦路径留在主库观察与确认快照里可查 | 设计禁止跨库 FK；读时不需要 dream 句柄 | builder 提，主管定 |
| 40 | 浮现阈值用 **freshness 单维** 比 0.45（不做带 query 的完整 R / R_eff） | 无查询词时 label/literal 恒 0，完整 R 上限 0.2，0.45 永不达成——设计稿自身口径矛盾 | builder 提，主管认，**须在 C4 gate 留证据** |
| 41 | `merge_exact` 新建 model observation 作 FK 锚点，新候选 `origin_mode=self`、不继承梦来源；旧条只加 supersede，原文不删 | candidates.observation_id 非空约束 | builder 提，主管认 |
| 42 | 浮现的"触发预留 / 投递留痕"未进控制账（只在 state 记频次、`delivery=unknown`） | 不假称已曝光；列 C1 剩余小口，由 builder 补或进 C4 gate | builder 提，主管认 |

**C1 验收证据（主管亲自跑）**：`p3-c1-dream` + `p3-c1-recovery` 19/19（`P3_C1_OK dream_atomic=true confirm_snapshot=1 dream_in_S=0`）；全量 `npm test` **222/222**；`BUILD_OK files=86`；`BOM=0 files=102`；干净目录迁移两次均 `main=7 control=4 dream=2`、第二次 `appliedNow` 全空、`precheck=integrity_ok`。

## 第四批（复核修复）

**起因**：`review-final.md`（Codex 总复核）列出 6 条会丢数据 + 16 条会出错 + 3 条口径问题。修复顺序与验收口径见 `fix-list.md`。

| # | 决定 | 理由 | 谁定 |
|---|---|---|---|
| 43 | 场景扩大（`scene=both`/跨窗口/`scope=global`）**无批准一律 `invalid_transition`**；批准入口 `scene-expansion-approval` 留到 P4 补 | 宁可暂时做不到，也不许偷偷放行 | 主管定 |
| 44 | 回执必须绑 `action+targets+完整 payload hash+baseVersions`，任一不符即 `receipt_hash_mismatch`/`receipt_base_version_mismatch` | 批准 A 落库 B 是权限事故 | builder 修，主管认 |
| 45 | 恢复按 `operations` 固化的 payload hash 精确读回，不符记 `readback_hash_mismatch`；不许拿"对象存在"当成功 | 存在 ≠ 本次事务成功 | builder 修，主管认 |
| 46 | 三败计数按**逻辑对象身份**（object_key+generation）累计，换 request/revision 不可绕过冻结 | 换版本逃冻结等于没有冻结 | builder 修，主管认 |
| 47 | capture-job 的 pending 行保持 pending，靠 done 指针判定（关系只追加）；测试断言 capture=1 且 done=1 | 不改只追加契约 | builder 提，主管认 |
| 48 | `merge_exact` 比较集合含 detail/topic_key/credibility/due_state + 联表 timeline·pointer；open 禁止合并；supersede 用 memoryId | 合并必须真的"完全相同" | builder 修，主管认 |
| 49 | 缺 raw 时用旧记录 JSON 载体（`lossy=1`、`raw_missing`），**不许拿 gist 顶原文** | 摘要不能冒充原文 | builder 修，主管认 |
| 50 | E16 硬切：source-versions 必须带 `file/span/spanHash`，否则一律 unknown | 不读真实文件就不许 exact | builder 修，主管认 |
| 51 | due 容量缺 H 时返回 `capacity_unknown` 并拒绝；硬层与 token 用估算（4096 字节、bytes/2） | 估算要写明，不许冒充实测 | builder 提，主管认 |
| 52 | 编译的"三败控制"与真实 K/H 仍缺，列入 report-4 边界 | 不假称已受控 | 主管定 |

**验收证据**：P1 7/7（270 全量）→ P2 8/8（278）→ P3 4/4（282）→ P4-A 4/4（286）→ P4-B 3/3（289）；`BUILD_OK files=107`、`BOM=0 files=125`。

| # | 决定 | 理由 | 谁定 |
|---|---|---|---|
| 53 | 回执 `expected` 取持久 `manifest.expected_ids ∪ deferred_groups.members`，不信调用方参数；group id 不滤除 | 分组也是交付物，漏回执就是漏交付 | builder 修，主管认 |
| 54 | `snapshotId` 纳入 query/H/softBudget/projectId/dream/due ids；同 ID 内容不同抛 `snapshot_id_conflict` | 同 ID 不许替换内容 | builder 修，主管认 |
| 55 | `get` 游标绑 memory payload_hash + timeline/pointer revision；`search` 游标绑 queryKey + 结果集 hash，变化即 `stale_cursor` | 翻页不许拼不同版本 | builder 修，主管认 |
| 56 | `--require-live` 只认 `status=passed` 且证据字段齐；`{}`/`unknown`/`result:fail` 均 `dynamic_evidence_incomplete` 非零 | 门禁不能把未知当通过 | builder 修，主管认 |
| 57 | 每个工具**独立声明 `output.schema`**（`additionalProperties:false`、字段列全、nullable 用 oneOf），不许统一 `{text}` | 宿主按 schema 校验返回值，声明不符则每次调用必失败（真机已复现） | 主管定，builder 修 |
| 58 | `live-check` 每次运行先移除插件 + 清空 `%TEMP%` 暂存目录再复制，artifact 记 `stage_hash` 并断言安装包与 stage 同哈希 | 跑旧包冒充新代码，等于白测（真机复现过） | 主管定，builder 修 |
| 59 | dispatch 判定分五档：`ok` / `empty_result` / `capture_missed` / `executed_but_output_invalid` / `blocked`；只有 `observed_count≥1` 才算 ok | 不许把"没抓到"或"0 条"说成通过 | 主管定，builder 修 |

## 第五批（第二轮复核修复）

**起因**：`review-final-2.md` 判定 22 条中"已修 2 / 部分修 18 / 未修 1 / 修错方向 1"。本轮按它给的三件优先级分 A/B/C 组。

| # | 决定 | 理由 | 谁定 |
|---|---|---|---|
| 60 | **推翻 #53**：回执 expected 按设计 §6.2c 取"实际交付集合"，不用 deferred members 凑数 | 设计优先于迁就绿色断言 | 主管定（二轮指出） |
| 61 | 观察 + capture-job（含冻结身份/场景）+ 输入序号同事务；恢复按 job 重建身份，不许固定 work | 否则生活输入会变工作候选 | builder 修，主管认 |
| 62 | 梦确认先落 intent + 回执关联再原子消费；续跑用冻结 topic；`structuredValue=false/0` 必须保真 | 已消费却无主库结果 = 永久丢 | builder 修，主管认 |
| 63 | 三败冻结：先提交冻结事务再抛 `object_frozen`；测试必须验"重启后仍 frozen" | 错误名不能当落库证据 | builder 修，主管认 |
| 64 | 撤销折叠与续跑共用同一"来源有效性"判据（按 dream 来源链） | 撤销后还被当有效背景是致命的 | builder 修，主管认 |

## 第六批 · C 类口径（2026-11-03 12:00 开工，主人定）

依据 `cclass-decisions.md`（Astra 只读裁定）。**B1 取口径 A、L6 取口径 A、B2 按设计硬要求直接做。**

| # | 决定 | 理由 | 谁定 |
|---|---|---|---|
| 65 | **B1 口径 A**：`merge_exact` 遇到 `done`/`dropped` 终态、非空期限或 promise 类输入一律 `blocked_by_due_state`，不产生候选/记忆/supersede；`none` 需再核普通提升后仍为 `none` 且 `due_done_at=null`；期限统一从队列取（`dueDeadline`），核验与准入放在同一 `withImmediate` 内 | 先收紧能力：宁可拒绝合并，也不悄悄把"已完成/已放弃"变回待确认 | 主人选 A |
| 66 | **L6 口径 A**：只支持"维护停写下完整备份恢复"；到边界冻结三库一致清单，用已定 #1 的一致性备份恢复到独立目录 | 不加增量机制，先把证明做实 | 主人选 A |
| 67 | L6 共同落点必须做：`rollback.mjs` 存**内容**不只 ID；修 `import_items` 主键（`item_id`→`id`）；查询异常不许吞成空列表，缺表/读取失败一律 failed/unknown | 三处都会让"回退通过"变成假通过 | Astra 指出，主人认 |
| 68 | **B2 按设计硬要求做**：门牌必须读真实文件核完整版本 hash + 字节范围，`location` 不能是自由字符串；`applyPointers` 提交前复核源字节与 planHash；骨架按真实 ID 读 `graph_nodes`/`graph_edges` 逐字段比（节点 id/label/kind/origin/source_ref，边 id/from_id/to_id/kind/origin/source_ref） | 设计稿 §14.1/§14.2 没有含糊空间 | Astra 指出，主人认 |
| 69 | 本批**先红后绿**，且每条只写"满足设计哪一句"；`decisions.md` 只到 #69（此前误称 65 条，Astra 已纠正） | 保持对账诚实 | 主管定 |















