# 第一批报告（report-1）

**2026-11-03 00:50 完成。** 图：`plan-1.md`（Codex 出，636 行）；施工：`builder`；验收：主管亲自跑命令。

## 一、这批做成了什么

一个**能离线跑、零依赖**的记忆内核：

- 三库 SQLite（main / control / dream 占位），迁移版本 `main=3 control=2 dream=1`
- 写入三段：输入侧 capture → 候选 → 提升六步（同事务、幂等键照 §13.5.2）
- 可靠提交：写后读回三态（found/missing/unknown）、一次同键补写、控制账预扣、**三次冻结跨重启**
- 注入器官：`memsys:context` 段 order=500，实测进 system prompt；超预算走 grouped 交付，逐组给"名称+未展开数+取回参数"
- 取回工具：`memsys_get/search/review_get/context_get`，分页可续
- 端到端：E1 记住→下一轮目录、E2 未注册实体入档、E3 220 条超预算分组取回

## 二、验收证据（主管亲跑，不是转述）

| 里程碑 | 命令 | 结果 |
|---|---|---|
| M1 | migrate / m1 测试 / check-db | `MIGRATIONS_OK`、24/24、三库 integrity ok |
| M2 | m2-write 测试 | 34/34，六步各步失败不留半条 memory |
| M3 | m3-reliable 测试 | 20/20，两败+重启第三败 → frozen、第四次写 0 |
| M4 | m4-context + live-check | 21/21；`LIVE_CHECK_OK … section=memsys:context order=500 auto_inject=false delivery=unknown` |
| M5 | m5-tools + e2e | 19/19，E1–E3 全绿 |
| 全量 | `npm test` | **118/118**，fail 0，skipped 0 |
| 门禁 | build / BOM | `BUILD_OK files=60`、`UTF8_OK BOM=0 files=68` |

## 三、施工决定（16 条，全部经主管确认）

见 `decisions.md`。要点：
- `db.backup()` 不存在 → `VACUUM INTO` + WAL 断言
- 业务写失败不重放补写（补写只用于"写成功但读不到"）
- 候选 `reason` 不可变 → 原因只写事件
- 场景扩大一律等主人
- 曝光/投递分库、跨库不宣称原子
- 无 tokenizer → tools-only，不拿字节冒充 token
- `auto_inject` 默认 false

## 四、事故（已恢复）

`dsh plugin add file://` 把源码目录 junction 进 probe profile，重建 profile 时递归删除沿链接把 `whale-unify/memsys` 删空。已从检查点恢复（78 条测试复跑全绿）并重做 M4。防护写进 `env-facts.md`：**禁止任何指向工作区的链接**、装包先复制到 `%TEMP%`、重建前按目录项删链接。

## 五、已知边界（第二批要处理）

1. **宿主工具注册 API 未验证**：`runtime/tools.mjs` 在没有已验证 `register` 时抛 `tool_registration_unverified`，能力状态 `unknown`。所以现在**是 tools-only 档**——注入能用，模型不能主动调 memsys 工具。这需要 `live-check --case tools` 用真宿主验证一次（要我提供 key）。
2. **`key_status` / `binding_status` 是派生值**：第一批 schema 没存这两列，`memsys_get` 按 `topic_key` 前缀推导。设计稿要求入库 → 第二批补列 + 事件。
3. **`evidence_mean` 返回 null**：没有骨架检索，不编数字（符合"没装骨架就说明没关系检索"）。
4. **pending-due 召回**仍缺（opus 二审判词那条），在第二批 B4。

## 六、下一批前提

- plan-2（Codex 正在出）必须**接在这套存储/事件/控制账/注入之上**，不许另起
- 第二批新增迁移从 `main-003` 之后继续，不许改 `main-001/002`、`control-001`
- 需要我提供 key 跑一次真宿主工具注册验证
