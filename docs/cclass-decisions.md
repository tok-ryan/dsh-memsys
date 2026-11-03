# C 类口径裁定

范围：B1／L6／B2；仅静态核对，不宣称测试通过。
源码路径相对 whale-unify/memsys/，设计稿路径相对 whale-unify/。
依据：memsys-design-v0.38.md、review-final-2.md、decisions.md 及指定源码。
decisions.md 实际列到 #64，未找到 #65；不补造决定。
复核中没有名为 B1／B2 的条目，分别对应 L4、L5／E16。
以下修复建议不改旧事实、旧事件、旧 SQL，不另建成功判据。
新增诊断原因会明确标为“拟新增”，不冒充现有返回码。

## B1：merge_exact 合并后的 due 语义

### 1. 设计要求

§12.6，设计稿:422：
> 自动 merge_exact 要求除系统身份、入档快照、活动计数和证据行 id 外的业务字段逐字段完全相同
> 至少包括 text、detail、why、type、scene、scope、有效 topic_key、key_status、binding_status、结构化值、时间各字段、semantic_status、record_kind、origin 集合、credibility、weight、tags、due 状态、pointer 和 judgment_id

§12.6，设计稿:424：
> 合并新候选提升与旧条的 supersede 同事务

§13.5.2，设计稿:701：
> 无合法 due 回执的衍生 promise／期限条目只能 pending-due

§13.0.4a，设计稿:559：
> due_state 为 none/done/dropped 无自动重开

解读：合并必须保持业务语义；不能把已完成／放弃条目重新变成待确认惦记。
§6.5:236 的“项目整体完成需主人回执”也不能替代独立的 due 完成授权。

### 2. 当前实现差异

src/dream/organize.mjs:61：阻断五种活动 due 状态，但放行 none／done／dropped。
src/dream/organize.mjs:18：比较 due_state，没有比较 due_done_at。
src/dream/organize.mjs:88：已比较 due_queue.deadline_at。
src/dream/organize.mjs:139：构造候选却读 first.due_at，未使用队列期限。
src/storage/repositories.mjs:41：getMemory 只读 memories；决定 #34 已定期限真源为队列。
src/write/promote.mjs:58：新记忆初始 none，due_done_at=null。
src/write/due.mjs:14：promise／非空期限经普通提升变 pending-due，终态因此丢失。
复核所述时间线、门牌取值和 supersede 字段问题已有修复，不能重复列为未修。

### 3. 最小可行口径

**条款不明确**：§12.6 未规定终态如何继承，§13.5.2 又约束衍生条目初态。
不能由施工自行增加“自动 due-state 写 done/dropped”的例外。

口径 A（建议 MVP）：不能无损保留 due 语义的输入，拒绝自动合并。
落点：src/dream/organize.mjs 的 mergeExact。
将终态 done/dropped 加入 blocked_by_due_state；不产生候选、记忆或 supersede。
对 none 再核普通提升结果仍为 none，并核 due_done_at=null。
期限统一从 dueDeadline 取值；出现非空期限／promise 等会重入队的输入同样拒绝。
相关读取与准入核验放进现有 withImmediate 内，避免核验后状态变化。
代价：终态重复条目保留两份；不新增授权规则，不改 candidates schema。
这是限制自动合并能力，不能对外宣称“所有字节相同条目均可合并”。

口径 B：明确批准“终态继承属于机械复制”的设计例外后，支持无损合并。
落点：mergeExact 冻结来源 ID、due revision、期限、终态和完成时刻；
promoteInTransaction／registerDueOnPromote 接收服务内部冻结快照，并原子写新投影。
新增 promote 事件载荷记录继承依据；正常读取和恢复共用该事件解释。
不伪造新 due-done 回执，不自动追加表示“新判完成”的 due-state。
代价：需补明 §13.5.2 的例外、事件载荷与重放支持；未经选择不得实施。

### 4. 验收断言

一个参数化用例：两条 active/resolved/accepted、其它业务字段相同的记忆。
输入分支为 done／dropped，另加 none 但普通提升会产生 pending-due 的边界夹具。
按口径 A：mergeExact 抛 code=blocked_by_due_state；新增业务行和 supersede 均为 0。
当前代码会合并或重新入队，所以该断言能先红后绿。
若选择 B：相同终态合并成功，期限／due_done_at 原样保留，事件重放结果相同；
两条 due_done_at 不同则 validation_error，且整个合并不落库。

## L6：cutover／rollback 的回退证明

### 1. 设计要求

§14.1，设计稿:727：
> 备份、完整性校验、逐项写后读回、关联闭合、回滚演练通过才允许一次切换

§13.0.5，设计稿:585：
> 操作清单固定目标 id、提交版本、原文／事件／证据集合及 hash。
> 正文和追加事件逐字读回；可变投影则读回该提交版本的完整历史快照，并验证对应事件已提交

§8.1，设计稿:267：
> 事件带库内单调 commit_seq，同事务带 ordinal；按两者重放，时钟回拨不改变顺序。

解读：计数和 ID 只能辅助证明，成功必须覆盖指定恢复边界的真实内容、关系及投影。
设计要求精确匹配，不强制“每个字段各存一个 hash”；全字段比较也可满足。

### 2. 当前实现差异

src/import/rollback.mjs:1：计数清单漏 evidence、due_queue、graph、项目等数据。
src/import/rollback.mjs:40：snapshotBusinessRows 仅保存部分表的 ID，不保存内容。
src/import/rollback.mjs:37：import_items 键写成 item_id，真实主键是 id。
src/import/rollback.mjs:45：查询异常被吞成空列表，使该表可能完全漏验。
src/import/rollback.mjs:52：只核 ID 存在及每条记忆至少一组关联，不比较字段／事件。
scripts/import-legacy.mjs:182：只冻结激活点清单，不能证明后续写入可恢复。
scripts/import-legacy.mjs:229：缺清单仍可回落到空计数；cutover-check 也未共用内容核验。
src/import/legacy.mjs:589 已阻断 anomalies，复核指出的该漏洞不再列作未修。

### 3. 最小可行口径

**条款不明确**：§14 未指定回退备份年龄，以及是否必须提供增量恢复机制。
两种方案必须达到同一完整性标准；不能把不同方案变成两套成功判据。

口径 A（建议 MVP）：仅支持维护停写下的完整备份恢复。
在回退目标边界冻结三库一致清单，采用已定 #1 的一致性备份方式恢复到独立目录。
备份覆盖该边界前的全部提交；边界冻结后继续写入，原证明即不足以覆盖新增结果。
代价：需要维护停写和完整备份；没有“从任意旧备份追平”的能力。

口径 B：旧备份加完整增量恢复，追到明确冻结的目标边界。
增量必须包含新增事实、证据、关系和控制账，不能只搬 relations 后宣称事实齐全。
代价：增加增量捕获、连续性及幂等恢复处理；正文行缺失时不能靠事件猜造。

共同落点：扩展 src/import/rollback.mjs 的 snapshotBusinessRows／compareBusinessRows。
修正 import_items 主键；清单覆盖三库不可丢失数据、完整证据集合与业务关联。
保存完整预期字段及边界版本；重算实际内容摘要，不能只比较行内自报 payload_hash。
缺清单、缺表、读取失败必须失败／unknown，不再转成空集合通过。
复用 src/control/readback.mjs 的精确读回入口，补齐字段集合，不另写宽松比较器。
恢复库按 commit_seq／ordinal 运行现有生产折叠函数，比较该边界的投影。
项目状态沿用 rebuildProjection 与决定 #26；没有重放支持的状态不得报验证成功。
scripts/import-legacy.mjs 的 cutover-check／activate／rollback-check 共用上述结果。
计数保留为诊断；控制账 attempts／generation／冻结状态必须保全，不可重置。
旧事件不改字节；选择 B 时增量恢复必须保留事件顺序、版本与幂等身份。

### 4. 验收断言

一个参数化恢复用例：冻结边界后制作恢复夹具，保持所有表计数和 ID 不变。
分别替换 observation 正文、relations.payload、evidence 关联或项目投影的一项。
损坏仅构造于隔离测试夹具，不为测试关闭生产只追加保护。
期望 compareBusinessRows.ok=false，CLI 为 ROLLBACK_CHECK_FAILED、退出非零。
正确恢复且生产折叠一致时才 ok=true；缺基线同样不得通过。
补充同一用例分支：激活后新增一条事实，回退目标包含它，恢复库漏它必须失败。
当前内容变更可漏检，激活后新增对象也不在旧基线内，故这些断言能先红后绿。

## B2：门牌回填与骨架图核验

### 1. 设计要求

§14.2，设计稿:731：
> 先读真实会话／文件指定版本，原文范围精确匹配才给 exact；只找到相似摘要仍 unknown。
> pointer-change 留 from/to、版本和证据，同事务更新投影。

§14.1，设计稿:724：
> 8 个骨架节点及边 | graph_nodes/graph_edges，附迁移来源 | 无证据边不变事实认证

§13.0.6，设计稿:601：
> 按稳定目标 id/键直接读，逐字段精确匹配已固化 payload；文本按原 UTF-8 字节，关系和证据集合齐全

解读：门牌须能由指定版本的真实原文独立复核；骨架须核真实行、端点与迁移来源。
这两项的最低要求明确，不能以“校验深度未定”为由允许事件自证或索引计数替代。

### 2. 当前实现差异

src/import/pointers.mjs:44 已读取文件并核片段 hash；不能说整个回填过程从未读文件。
但 :29／:56 只核清单声明，没有绑定导入原文、完整文件版本及 location。
src/import/pointers.mjs:93 的 applyPointers 不重验源字节、计划 hash 或基版本。
src/import/legacy.mjs:540 允许 pointer-change 与投影互相证明，未核真实源文件。
src/import/legacy.mjs:154 仍直接接受旧记录自报 exact。
src/import/legacy.mjs:484 仅按 import_items 统计 graph，没有读取节点／边核基本字段。
因此任务背景对 graph 的描述偏宽：当前甚至没有完成真实实体存在性核验。

### 3. 最小可行口径

在 src/import/pointers.mjs 增加一个小型共享核验函数，供 planPointers／applyPointers／verifyPlan 调用。
输入固定为源对象版本、完整文件 hash、字节范围、原观察引用和目标门牌基版本。
实际读取文件；核完整版本 hash，再核范围与对应 observation 原文 UTF-8 字节相等。
location 必须由已核 file/span 导出或严格验证映射，不能接受无关自由字符串。
导入记录的 source_version_hash 是记录映射 hash，不能冒充完整源文件内容 hash。
缺 raw、版本不可取或只有相似摘要时保持 unknown，不用 gist 或 JSON 载体冒充历史原文。
applyPointers 重算 planHash／payloadHash，并在提交前复核源字节。
锁内核 pointer 基版本；新 pointer-change 带完整 from/to、证据和版本，同事务更新投影。
旧事件保持原样；兼容读取不能把缺证据的旧事件补解释成已验证 exact。
verifyPlan 使用同一核验函数；源版本不可读则报告未能核验并阻断切换。
这不要求只读 verify 擅自改写已有 pointer 投影。

src/import/legacy.mjs 的 buildPlan 不再把旧记录自称 exact 当已核事实。
具备同一核验函数要求的证据才准 exact，否则 unknown；保留旧声明供追溯。
verifyPlan 按实际节点／边 ID 读 graph_nodes／graph_edges，与冻结映射逐字段比较。
节点核 id/label/kind/origin/source_ref；边核 id/from_id/to_id/kind/origin/source_ref。
同时核两端真实节点和 import_items 的源版本／映射身份，不能只查外键或数量。
期望值来自冻结源计划及映射规则，不能从待验证目标行反向生成。
源数据若带来源引用，buildPlan 须保留；缺失则明确 migrated，不补成 verified。
继续使用精确读回函数；修的是核验输入和字段集合，不新增第二套事实判据。

### 4. 验收断言

一个参数化用例覆盖“门牌计划后源变化”与“骨架同 ID 错内容”。
门牌：用真实匹配文件生成计划，再改文件后 applyPointers。
期望 code=source_changed（沿用已有错误名），无新 pointer-change，投影仍 unknown。
再构造真文件但 location／导入原文不匹配的分支，必须拒绝 exact。
骨架：恢复夹具保持 ID、数量和 import_items 不变，替换节点 label 或边端点。
期望 verifyPlan.status=failed，missing 含目标字段诊断，cutoverGate 返回 verify_failed。
诊断可拟新增 graph_field_mismatch／pointer_evidence_mismatch，不改变成功标准。
当前 apply 不复验文件、verify 不读 graph 实体，因此两类断言均能先红后绿。
