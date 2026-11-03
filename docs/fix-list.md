# 复核后的修复清单（batch-4）

> 来源：`review-final.md`（Codex 总复核，2026-11-03 03:0x）。原文逐条有文件:行号，本文件只排顺序与验收口径。
> 原则：**每条都要"先写一个能复现的失败测试，再修到它过"**；不许只改代码不写测试。全部修完再跑全量 + `--require-live` gate。

## P1 权限与来源（不修会出权限事故）

| # | 问题 | 落点 | 完成标准 |
|---|---|---|---|
| E1 | 模型两步调用 `promote_candidate` 绕过场景扩大审批 | `write/candidate.mjs`、`tools/record.mjs` | 提升时重核场景扩大批准；测试：pending(both) → 直接 promote → 必须 `invalid_transition` |
| E2 | 主人回执没绑定最终 payload 与基版本 | `write/owner-actions.mjs`、`write/project.mjs`、`dream/confirm.mjs` | 回执核 action+target+**完整 payload hash + baseVersions**；改一个字段就不得沿用批准；测试：批准 A 改 B → 拒绝 |

## P2 中断后只说真话（不修会"说已记住其实没完成"）

| # | 问题 | 落点 | 完成标准 |
|---|---|---|---|
| L1 | 恢复把"对象存在"当"本次事务成功" | `control/recovery.mjs`、`control/readback.mjs`、`write/candidate.mjs` | 按 operations 固化的 payload/hash/事件集合精确读回；测试：reserve 后中断改字段 → 恢复不得报 found |
| L2 | 观察落库后没有 capture 恢复链 | `write/observe.mjs`、`control/recovery.mjs` | 重启扫描补建 capture（同事务指针）；测试：观察提交后中断 → 重启后 capture 存在且只一条 |
| L3 | 梦确认跨库断点不能续完；快照字段不全 | `dream/confirm.mjs`、`control/recovery.mjs` | 按 confirmId 续跑跨库子步骤；快照保全最终时间/pointer/tags/weight/structuredValue + 证据 hash；ownerObservationId 不许空 |
| E5 | 三败计数绑 request，换 request 可绕过冻结 | `control/ledger.mjs`、`control/recovery.mjs` | 计数按**逻辑对象身份**累计；测试：换 revision/requestKey 连败三次仍 frozen |
| E6 | 梦确认撤销/void 不能可靠影响派生记忆 | `dream/confirm.mjs`、`dream/replay.mjs`、`context/select.mjs` | 按逻辑来源链即时折叠；void 只给 dreamId 也能全撤；多次确认要回退到上一个仍有效确认 |

## P3 数据保真与切换证明（不修会静默改语义）

| # | 问题 | 落点 | 完成标准 |
|---|---|---|---|
| L4 | `merge_exact` 合并并不精确相同的记录 | `dream/organize.mjs` | 比较集合补 detail/topic_key/credibility/due_state/联表 timeline·pointer；open 状态禁止合并；supersede 事件用 memoryId 不用 candidateId |
| L5 | 旧内容导入字段不保真 | `import/legacy.mjs` | 保留 detail/业务类型/due/完整 origin；缺 raw 不得用 gist 顶 observation；verify 对 timeline/pointer/evidence/detail/due/origin 全核对 |
| L6 | cutover / rollback 通过条件不足 | `scripts/import-legacy.mjs`、`acceptance-boundaries.mjs` | 未解决项（unresolved/quarantine）一律阻断切换；回退要实际恢复+重放+逐项核对业务增量 |
| E16 | exact 门牌只核声明不核原文 | `import/pointers.mjs`、`tools/record.mjs` | exact 必须读取真实文件版本并核对 span；伪路径不得 exact |

## P4 其余 E 项（按序清）

E3 shelved-due 恢复方向（必须先回 pending-due）｜E4 due 准入三维+硬层+目标字节｜E7 grouped 保护成员与最终预算复验｜E8 容量账真实计数与编译三败控制｜E9 manifest 覆盖审核/固定段+场景过滤+可取回｜E10 回执校验分组与曝光只记 memory｜E11 快照/游标版本稳定｜E12 取回真实 key_status/binding_status + 证据原文可取｜E13 时间检索按 time_state/precision + 证据均值｜E14 浮现资格按命题当前确认与 void｜E15 require-live 严格判据（只认 status=passed + 必需字段）

## 不修但要写清（口径）

D1 self/auto 在 master 存在时禁 pending、life 窗口禁项目更新（比设计严）｜D2 梦阈值 freshness 单维（已记 #40）｜D3 `decisions.md` 缺 #31–34/#43–53 与 report-2 的 15 天 vs 代码 14 天

**D3 的修法：补决定编号 + 改报告口径，不许改代码迁就报告。**
