# 第三批报告（report-3）

**2026-11-03 02:32 完成。** 图：`plan-3.md`（astra 出）；施工：`builder`；验收：主管亲自跑。

## 一、这批做成了什么

- **做梦（C1）**：独立 `dreams.db`（dreams / propositions / candidates / relations / confirmation_snapshots），库内 FK + 追加保护 + 独立提交序号；梦**不进事实集合 S**；确认链 = 主库保全原输出 → 梦库 confirm + 完整快照（同事务、精确读回）→ 主库补 `source=dream` 命题观察 → `confirm:<confirmId>` 候选 + 六步提升；撤销/void 让已提升条目退出 S 但原文不删
- **梦浮现与整理**：默认关闭；只在合法 linkedIds 上按 freshness≥0.45 浮现，同会话同日一次；`merge_exact` 逐字段比较、梦链只回建议；`supersede_proposal` 只存不执行
- **迁移（C2）**：`main-008` + 旧内容导入（`import_items`）、门牌回溯（按导入时版本哈希精确匹配，绝不取最新）、骨架 graph 节点/边（非证据）
- **feed（C3）**：三闸顺序固定（相关→细节→时间）、窗口两端包含、严格时区 ISO、零写入
- **§15 gate 化（C4）**：六条可失败断言 + `--require-live` 区分 not_run / failed

## 二、验收证据（主管亲跑）

| 里程碑 | 结果 |
|---|---|
| C1 | `p3-c1-dream + recovery` 19/19，`P3_C1_OK dream_atomic=true confirm_snapshot=1 dream_in_S=0` |
| C2 | `p3-c2-import + migration` 12/12，`P3_C2_OK points=24 unknown_pointers=24 nodes=8 replay_equal=true`；旧 10 SQL hash `changed=[]` |
| C3 | `p3-c3-feed` 11/11，`P3_C3_OK recentDays=7 boundaries=true side_effects=0` |
| C4 | `p3-c4-boundaries + gates` 11/11；`--require-live` 无动态证据 → `GATES_FAILED reason=dynamic_not_run` exit=2；`--offline` → `GATES_OK gates=5 dynamic=unknown` exit=0 |
| 全量 | `npm test` **256/256**，fail 0，skipped 0 |
| 门禁 | `BUILD_OK files=100`、`UTF8_OK BOM=0 files=118` |
| 迁移 | `main=8 control=4 dream=2`，三库 integrity ok、FK 0 |

## 三、施工决定（43–53 等）

见 `decisions.md`。本批关键：
- 记忆 origin 不放跨库梦路径（39）
- 浮现阈值用 freshness 单维，须在 C4 留重校准待办（40，已落 gate）
- 旧行 `key_status/binding_status` NULL + `legacy_binding_unknown`，不凭前缀猜权限（38）
- due 退让在 policy 批准前不可达（35/36，已落 gate）

## 四、仍待实测（C4 gate 已把它们变成可失败的检查）

1. **工具调用调度**：注册已在真机验过（10 个 `memsys_*` 全进 schema，见 `_build/artifacts/live-check-tools.json`），但**模型真正 execute 调度**未验；`dispatch=unknown`
2. **自动注入与投递回执**：`auto_inject`、`delivery_receipt`、`per_round_update` 仍 unknown
3. **梦浮现跨进程频次**：只在离线单库验证
4. **due 退让链**：policy 批准后仍未实现（`retreat_not_implemented_after_approval`）
5. **`owner_adjudicated_evidence`**：独立现实证据路径未实现（只有 `owner_assertion`）
6. **dream 别名 / self-note 建议**：未实现
7. **feed provider 接入**：生产 provider 未接
8. **生产 cutover / 回滚重放**：只做隔离演练
9. **真实旧库盘点**：C2 的 24/3/8 是夹具，真实数据尚未导入

## 四·五、C5 工具注册（已验）

真机证据（`_build/artifacts/live-check-tools.json`）：
- `registration.status = registered`
- `registered = [memsys_get, search, project_get, review_get, self_get, context_get, record, dream_record, organize, feed]`（10 个）
- `schema_count = 35`，`schemas_has_memsys = true`，`get_found = true`，`errors = []`
- `define_tool = "function"`，`tools_service = true`

两个真因（记下来省下一次）：探针写文件漏 `import fs`，异常被 catch 吞掉导致 marker 恒为 null；`defineTool` 的参数子集不合法（不支持 `minItems/maxItems`、`type:'object'` 必须显式 `additionalProperties`）。

## 五、下一步

- C5 文档收尾（README 补三批功能、安装与 gate 用法）
- 交给 Codex 做**一次总复核**（对照设计稿挑偏离）
- 仍需老板决定：模型实际 `execute` 调度要不要专门验一轮（需要真跑一次带 key 的对话并要求模型调用 `memsys_get`）

