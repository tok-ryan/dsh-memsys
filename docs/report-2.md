# 第二批报告（report-2）

**2026-11-03 01:30 完成。** 图：`plan-2.md`（606 行）；施工：`builder`；验收：主管亲自跑命令。

## 一、这批做成了什么

在第一批内核上，把「我自己的记录」和「主人的判断」补齐：

- **B1 self note**：`memsys_record(kind=self_note)`、作者由 runtime 绑定、修订走 supersede 事件、分叉保留、**不自动进注入**
- **B2 judgments / speculations / outcome**：`outcome` 与 `verdict.result` 两列分开；`outcome-change` 可由窄义工具结果推进；翻案留痕；30 天老化（无 verdict → auto/unverified，只有 self → needs-review，有 master verdict 不动）
- **B3 projects Overview**：identity 表只放身份，四项状态走 `project-update` 完整快照 + 可重建投影；`baseRevision` 校验；证据失效回退到上一版有效快照
- **B4 pending-due 召回**：进审核分区（**不进固定栏目、不占 P、不进 S**），排序独立于 S；grouped 三件套完整；确认需绑定回执才转 open，未确认 14 天 shelve
- **B5 事件幂等**：due-state / candidate-entity / review-defer / shelve 四类 v2 事件全矩阵幂等；旧 v1 事件字节不变，适配器只读推导

## 二、验收证据（主管亲跑）

| 里程碑 | 结果 |
|---|---|
| P2-M1 | `p2-m1-self` 22/22，`P2_M1_OK self_note=true author_bound=true append_only=true forks=2` |
| P2-M2 | `p2-m2-judgment` 22/22，`P2_M2_OK outcome_separate=true aging_replay=true speculation_in_S=false` |
| P2-M3 | `p2-m3-project` 14/14，`P2_M3_OK snapshots=5 revision_conflict=true inherited_sources=true` |
| P2-M4 | `p2-m4-due` 16/16，`P2_M4_OK pending=20 pending_in_P=0 confirmed_open=1` |
| P2-M5 | `p2-m5-replay + p2-integration` 11/11，`P2_M5_OK matrix=4 legacy_bytes_unchanged=true` |
| 全量 | `npm test` **203/203**，fail 0，skipped 0 |
| 门禁 | `BUILD_OK files=77`、`UTF8_OK BOM=0 files=90` |
| 迁移 | `main=6 control=3 dream=1`，三库 integrity ok、foreign_key 0 |

## 三、施工决定（18 条：17–34）

见 `decisions.md`。本批要点：
- 严格幂等默认开、旧事件字节不动
- master verdict 不可被模型覆盖（`invalid_transition`）
- needs-review 的 deferred 只退出待办、不改判
- projects 身份与状态分离，证据失效回退但不改历史头
- pending-due 确认必须绑定回执；模型不能给项目"验证完成"

## 四、已知边界（未闭合，照实记）

1. **due 容量退让链未实现**：能算三维并给 80% 警告、能拒绝确认，但"满额先出报告 → 软层退到 70% → 预留目标"这条链没接。原因：`due-policy-v1` 从未真正获批，退让需要容量报告 + 主人可见清单 + 批准出口；用假退让就是骗人。落点已留（`capacity_rounds` 的 soft/hard streak、`due-report` 事件、`checkDueCapacity`）。
2. **`live-check --case plan2-context` 未跑**：宿主工具注册 API 仍未验证，project/self/due 只有离线 handler，跑也只会得到 `tool_registration_unverified`。能力状态保持 `unknown`。
3. **`due-batch` 明确 `unsupported_in_batch`**：逐项执行 + 整批过期校验没做，只保留命令解析。

## 五、下一批前提

- plan-3 已由 astra 出好（`plan-3.md`）：做梦（dream-002 起）、迁移（main-007/008、control-004）、feed 契约、§15 验收 gate
- 旧迁移编号 001–006 全部 hash 保护，不许改
- 两处未闭合要在第三批或最终复核里处理：工具注册真机验证需要一次带 key 的 live-check（我提供 key）
