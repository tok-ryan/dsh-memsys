# 第四批报告（report-4）：复核修复

**2026-11-03 03:50 完成。** 起因：`review-final.md`（Codex 总复核）列出 6 条会丢数据、16 条会出错、3 条口径问题。顺序与验收口径见 `fix-list.md`，逐条决定见 `decisions.md` #43–56。

## 零、第二轮复核后的更正（2026-11-03 04:50）

**本报告下面"修了什么"的措辞偏乐观，以 `review-final-2.md` 为准。** 二轮逐条核对代码后的判定：**已修 2 条、部分修 18 条、未修 1 条、修错方向 1 条**。

主要遗漏：
- **L1/L2/L3 事务级缺口**：观察与 capture-job 不同事务（`observe.mjs:105`）；恢复用固定 work 身份重建，生活输入会变工作候选（`recovery.mjs:138`）；梦确认"先消费回执再存 task"之间中断会永久丢主库结果（`confirm.mjs:233/251`）
- **L4 合并仍丢语义**：比了却没在输出保留（`organize.mjs:126/133`）；supersede 字段与重放契约不一致
- **L5 导入保真不成立**：`legacy.mjs:144` 只接受数组 origin；版本 hash 未覆盖新纳入字段；verify 用同次事件自证
- **L6 切换/回退证明不足**：`anomalies` 不阻断；`rollback.mjs` 只验数量下限
- **E2 只部分绑**：项目 update 的 hash 未绑 evidenceRefs/semanticStatus；取锁后未重验已消费状态
- **decisions #53 与设计冲突**：把 deferred members 并入 `expected_ids`，设计 §6.2c 要求"实际交付集合相等"——以设计为准，待改

**不能说"22 条全部修完"。**

## 一、修了什么

| 组 | 编号 | 内容 |
|---|---|---|
| P1 权限 | E1 / E2 | 场景扩大无批准一律拒（并补了主人批准入口）；回执绑 `action+targets+完整 payload hash+baseVersions` |
| P2 恢复 | L1 / L2 / L3 / E5 / E6 | 按固化 payload hash 精确读回；补建 capture；梦确认跨库可续 + 快照补全；三败按逻辑对象累计；撤销按来源链折叠 |
| P3 保真 | L4 / L5 / L6 / E16 | `merge_exact` 补字段与联表比对、open 禁合并；缺 raw 用 JSON 载体不用 gist；cutover 未解决即阻断；exact 必须读真实文件 span |
| P4-A 容量 | E4 / E7 / E8 / E9 | due 缺 H 即拒；grouped 不吞保护成员、拼完复验 ≤H；容量账真实计数 + 溢出 streak；manifest 覆盖固定段与审核项、状态组可取回 |
| P4-B 交付 | E10 / E11 / E15 | 回执取持久 manifest、分组也须回执、曝光只记 memory；快照/游标版本绑定；`--require-live` 只认 `status=passed` |
| P4-C 读与梦 | E3 / E12 / E13 / E14 / E1 | shelved-due 先回 pending-due；读真列 + NULL→`legacy_binding_unknown`；时间检索按 time_state/precision + 均值；浮现按当前有效确认+void；场景扩大批准入口 |

## 二、验收证据（主管亲跑）

- test-first：每组成立前都先跑出失败（红），修后才绿；E2 与 L2 各有一次"偏差/假绿"由 builder 主动报出，L2 重做断点后才算数
- 全量：**294/294**（270 → 278 → 282 → 286 → 289 → 294）
- 门禁：`BUILD_OK files=108`；`UTF8_OK BOM=0 files=126`
- 动态门：`acceptance-boundaries --require-live --live-report _build/artifacts/live-check-tools.json` → `GATES_OK mode=require-live dynamic=passed`

## 三、仍然没做到的（照实列，20 条）

1. **编译三败控制未做**：compile 仍直写控制账，没走 reserve/complete；只做了容量行真实计数与溢出 streak
2. **容量是估算**：硬层固定 4096 字节、token=bytes/2，不是实测 K/H
3. **L6 回退只到逐表计数**：没有逐行重放事件、逐字段 hash
4. **E16 是硬切**：`source-versions` 必须带 `file/span/spanHash`，旧格式一律 unknown
5. **L5 due 只到候选层**：未验证提升后 due 状态与 due 服务一致
6. **L4 比较当前投影**：不核历史版本
7. **get 游标签名有限**：只覆盖 payload_hash + timeline/pointer revision
8. **search 在 uses 变化时 stale**（有意从严）
9. **`conflict_marker` 只查 conflict 事件**：本批没有产生该事件的写路径
10. **evidence_mean 公式简化**：exam 固定 0、业务时间二元
11. **E14 频次 topic 来自 linked memory**：无 topic_key 退回 dreamId；跨进程未实测
12. **E1 只有批准服务**：无提案 UI、无宿主命令接线
13. **capture-job pending 行不关闭**（靠 done 指针）
14. **`deferred_generated` 是静态清单**
15. **宿主工具调度已验（真机）**：`live-check --case dispatch` → `dispatch=ok`、`observed_count=2`（模型实际调用 `memsys_search`、宿主按 schema 校验通过、返回 2 条命中）；但 `record/dream_record/organize` 仍 `runtime_identity_unavailable`（宿主 runtime 身份未接线）
16. **feed provider 未接**
17. **真实旧数据未导入**（C2 的 24/3/8 是夹具）
18. **cutover/rollback 未在生产跑**
19. **D1 比设计严**：master 存在时禁 self/auto pending；life 窗口禁项目更新
20. **D2 梦阈值 freshness 单维**（#40）；**D3** 文档口径已修（report-2 改 14 天、decisions 补 #31–34/#43–56）

## 四、下一步

- 第二轮 Codex 复核（只问：修的东西是不是真修了、有没有引入新问题）
- 真机跑一次"模型实际调用 `memsys_get`"，把 `dispatch=unknown` 变成有证据
- README 补第四批内容与 20 条边界
