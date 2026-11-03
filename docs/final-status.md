# memsys 最终状态（2026-11-03 05:20）

## 一句话

插件能装、工具能注册、模型能调用、能拿到真数据；**但设计稿还有 10 条硬条款没达标**，其中 3 条会在真实使用中造成错误结果。

## 硬证据（主管亲跑）

| 项 | 结果 |
|---|---|
| 全量测试 | **324/324**，fail 0，skipped 0 |
| 编译门禁 | `BUILD_OK files=126` |
| 编码门禁 | `UTF8_OK BOM=0 files=144` |
| 动态门禁 | `GATES_OK mode=require-live dynamic=passed` |
| **真机读** | `LIVE_CHECK_OK case=dispatch dispatch=ok`；`direct_hit_count: 2`，命中「葱是绿的」「葱可以吃」，`evidence_mean: 0.14` |
| **真机写** | `LIVE_CHECK_OK case=record record=ok`（`_build/artifacts/live-check-record-ok.log`）；`memories=1/candidates=1/observations=1`，候选正文精确 `鲸鱼娘会拍水`，`origin.author_kind=model`、`call_id` 与调用一致 |
| 真机注入 | `LIVE_CHECK_OK case=inject section=memsys:context order=500 auto_inject=false delivery=unknown` |
| 迁移 | `main=8 control=4 dream=2`，三库 integrity ok |

真机链路完整走通：**插件加载 → 10 个工具进 schema → 模型调用 → 宿主校验 → 读回真实数据 / 写入候选与记忆**。

## 做过什么

- 三批功能：存储底座 / 观察-候选-提升 / 可靠提交与恢复 / 注入与编译 / 读工具 / 做梦 / 迁移 / feed / 验收 gate
- 两批复核修复：Codex 第一轮 22 条、第二轮逐条判定"已修 2 / 部分修 18 / 未修 1 / 修错方向 1"，按 A/B/C 组修到"大部分满足设计句"
- 期间修掉三条真机才会暴露的坑：输出 schema 与返回值不符（每次调用必失败）、暂存包不刷新（拿旧代码测）、搜索参数形态（`"[\"葱\"]"` 字符串）导致 0 命中

## 仍不达标（不许说"全部修完"）

1. **L1 完整读回**：恢复/重查未按操作类型保存并核对完整预期结果（事件/证据集合）
2. **E2 锁内基版本**：批准取得写锁后未重新验证已消费状态与基版本
3. **E8 编译三败控制**：compile 仍直写控制账，没走 reserve/complete
4. **C3 内容寻址快照**：snapshotId 不含时钟/内容 hash，靠 section hash 拒绝；未用真实重复编译测混版
5. **C1 空分组边界**：只有组头、无实际 memory 时的确认语义未测死
6. **C4 证据续页**：`observation_text` 只截断，没有分片续页
7. **B3 回退内容**：逐 ID 核存在与关联，未重放 relations 内容/hash
8. **B1 due/done 映射**：合并只保留 `due_at`，候选层没有 due_state/done
9. **B2 门牌/图**：pointer 回填靠 pointer-change 事件自证；图只核基本字段
10. **A3 test-first 债**：首红被夹具掩盖，未补一次干净红

## 文档在哪

- 设计：`memsys-design-v0.38.md`（未改）
- 施工图：`plan-1.md`、`plan-2.md`、`plan-3.md`
- 报告：`report-1..5.md`；复核：`review-final.md`、`review-final-2.md`；修复清单：`fix-list.md`
- 决定：`decisions.md` #1–65；进度：`progress.md`
- 真机产物：`_build/artifacts/live-check-tools.json`、`live-check-dispatch.json`、`live-check-inject.json`
