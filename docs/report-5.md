# memsys 第五批（P5-D）交接

## 本轮落地
- **C2 最终预算复验**：所有段拼完用 `measureK(section)` 复验；`> H` 时返回 `delivery_level=budget_exceeded`、`reason=budget_exceeded`，并附 `requiredH`，不再“成功返回但超预算”。
- **P 成员**：grouped 文本纳入 `due_state=open` 的保护成员（`open:<id> · <text>`）；project 固定段仍在 `fixedText`。测试 `test/p5-d-budget.test.mjs` 断言 open 文本出现在最终文本且 `total ≤ H`。
- **夹具按判据修**：`e2e`、`m4-context`、`p4-p4-capacity`、`p4-p4-delivery`、`p2-m4` 增加 `compileBudget`：预算不足时用返回的 `requiredH` 重编译；并补足成员数，使 grouped 与 full 有可区分预算。
- **C5 inject 产物**：`evidence.section` 补 `result: 'ok'`；无 key 复跑 `LIVE_CHECK_OK case=inject section=memsys:context order=500`，artifact 自洽。
- **C4 证据预算**：`memsys_get(include_evidence)` 的 `observation_text` 计入 `max_chars`，超限截断并标 `observation_text_truncated`。
- **B3 真红**：临时移除 `anomalies` 阻断跑红后恢复，B3 首红债已补。

## 验证
- `npm test` 309 / 309
- `BUILD_OK files=116`
- `UTF8_OK BOM=0 files=134`
- `acceptance-boundaries --require-live` → `GATES_OK mode=require-live dynamic=passed`
- 检查点 `whale-unify/_build/backup/20261103-050637-7336-P5-D/`

## P6 之后的状态（2026-11-03 08:15，主管复跑 323/323）

| 条 | 状态 |
|---|---|
| **E8 编译三败控制** | **满足**：`compileRound` 走 reserve→compile→complete，三次失败按 `compile:session:round` 持久冻结，第四次 `object_frozen`，重启后仍冻结 |
| **E2 锁内基版本** | **满足**：`revalidateReceipt` 进锁后重读批准（hash+baseVersions+未消费）；六动作各一条测试（project 四动作 / scene-expansion / dream confirm），均断言 `receipt_already_consumed`，且证明是锁内第二次读 |
| **L1 完整读回** | **满足（带边界）**：`__expected__` 落 `operation_steps`，四类（observation/candidate/promote/due）共用 `verifyExpected`，三处调用点（正常提交/恢复/历史 recheck）统一；due 用事件 payload hash 不再错配 memories 行（含反向用例：正常提交必须 found）。**边界**：设计写"六步各一条关系"，实现只产出 `promote` 一条，其余是表操作 |
| **C3 分页混版** | **部分**：读路径已接（`getGroupPage` 比 `source_revision` → `stale_cursor`），`contentHash` 已进 snapshotId；**混版三态测试未绿**（夹具在"编译后改库"造不出前置行，未关外键、未删约束） |

## 仍不达标（report-5 边界，不冒充达标）
1. **A3 test-first 债**：首红被夹具的 `relations_append_only` 掩盖；修夹具后未补一次干净行为红，只有 B3 补了真红。
2. **C1 空分组边界**：某轮只有组头、没有实际 memory 时，组头回齐仍可能确认；actual 集合与“真实交付分组”的空/非空两态未测死。
3. **C3 分页混版（部分）**：读路径已接 `getGroupPage(main)`，游标解码后比 `snapshot.source_revision` 与 `currentRevision(main)`，不符返回 `stale_cursor`；`tools/read` 已传入 `main`。**混版三态测试未绿**：最小链夹具在“编译后改库”仍无法稳定造出前置行，未关外键/未删约束；snapshotId 的 contentHash 已有，但缺“真实重复编译 + 翻页中途改库 + 反向连续翻页”的可复现测试。
4. **C4 证据原文续页**：`observation_text` 已计入预算并截断，但没有像主文本那样提供证据分片续页/游标。
5. **C5 执行能力**：`toolCapabilityStatus` 只到 `capability=registration`、`execution=unverified`；真实调用成功仍靠 dispatch 探针，不由此标签证明。
6. **B3 回退内容**：rollback 逐 ID 核行存在与 memory→timeline/pointer/evidence 关联，没有重放 relations 内容/hash；计数仍参与比较。
7. **B1 due/done 映射**：合并只保留 `due_at`；候选层没有 `due_state/done`，仍由 due 队列与提升路径决定。
8. **B2 门牌回填**：verify 对 pointer 回填的认可靠 `pointer-change` 事件与指针行一致，不是重读源文件；图节点/边只核存在与基本字段。
9. **L1/E2 完整读回与锁内基版本**：恢复/重查仍未按操作类型保存完整预期结果；批准基版本未在主库锁内重验（二轮复核 L1/E2 项）。
10. **A 组 A3 之外的旧边界**：L6 逐项重放、E8 编译三败控制、E16 全入口 exact 等仍按 report-4 边界保留。
