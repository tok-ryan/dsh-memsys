# 第三批施工图：梦库、旧数据迁移、feed 与验收边界

本图交付 builder；唯一行为规范是 whale-unify/memsys-design-v0.38.md，页首遗留 v0.37 不改变规范版本。
已完整读取任务、design 全文、plan-1、plan-2、decisions、report-1；另核对现有存储、来源、恢复、迁移脚本及环境防护。
只出图，不写实现、不运行迁移、不切生产；本文所有命令与输出是施工交付契约，不是已经通过的验收。
施工由 builder 做，主管运行命令验收；全部施工结束后才交整套代码与三批报告总复核，按任务要求使用 astra。
任务所写 §13.5.4／§13.5.6／§13.5.7 在现行文件没有同名标题，不虚构引用；实际规则映射如下。
梦内容与主库边界看 §12.1／§12.5，确认和独立证据看 §12.7，跨库恢复看 §13.0.5，候选例外看 §13.5.5。
文中时长是规范策略参数，验收用测试时钟；真实审计时间只能取系统读数。

## 1. 接续前提与范围

第一批基线以 report-1 为准：main=3/control=2/dream=1，118 项离线测试记录；真实工具注册仍未验证。
第二批以 plan-2 交付 main=6/control=3/dream=1 为前置；本次目录抽查不能替代第二批完成报告及主管验收。
目录缺少第二批迁移不等于编号可占用；开工先核 report-2、decisions 增量、实际 schema 与已验收源码检查点。
缺第二批能力时写 dependency_unavailable 并停依赖里程碑；不得搭第二套 owner-actions、due、分页或提交器。
C1 含 §12 所需梦写入、确认／撤销、恢复、白名单整理及有条件梦目录；调度上线另有真宿主 gate。
C2 含旧内容导入、时间／门牌、骨架原关系保存和切换演练；不借骨架导入建设关系推理／图检索产品。
C3 只做 feed 筛选契约与受控接入，C4 只补边界与失败出口，C5 只做文档和总复核材料。
不新增 npm 依赖；仅用原包及 Node 标准库，数据库只用 node:sqlite；不接 dsh-mnemosyne 的库。

| 已定决定 | 第三批必须保持 | 验证位置 |
|---|---|---|
| #1／#2 | 停写屏障下 VACUUM INTO；源码与三库分目录，checkpoint 保留 --out | C1 升级与 C2 回滚 |
| #3 | dream-001 原字节与占位行保留；业务表从 dream-002 起 | SQL hash 清单 |
| #4／#5 | 补写前结前次尝试；业务抛错不即时重放，恢复另核 | C1/C2 断点测试 |
| #6／#7 | reason 不改；resolved 无旧条直接升、同值仅审核；梦确认走显式专用分支 | 旧 m2 回归及确认专测 |
| #8／#9 | 扩场景需独立授权；普通 timeline 仍只结束 ongoing；exact 门牌必须位置 | C1/C2 权限反例 |
| #10／#11 | 保留六处 hooks 及透传；控制回执失败仍 unknown/controlReceipt=failed | C1 故障矩阵 |
| #12 | 业务、投递、控制分库，不宣称跨库事务原子 | C1 恢复及旧 m4 |
| #13／#14 | K 实测、预算分账；缺 tokenizer/H 为 tools-only，不拿字节冒充 token | C1 梦目录、C4 |
| #15／#16 | auto_inject=false；诊断段独立开关，组头三件套完整 | C4 动态报告 |
| #17／#20 | appendRelation 严格比较 payload 与版本，旧键不变；环／异文整笔回滚 | C1 梦事件及 p2-m5 |
| #18／#19 | self-note 内部原输出保全不迁移；反省依赖缺失显报，不吞字段 | p2-m1/m2 与梦 self note |
| #21 | self_get 游标绑定 kind+view，换视图 invalid_cursor | 旧分页回归 |
| #22／#24／#25 | 有有效 master 拒绝任何 self/auto 新 verdict；defer 不改判断；候选落库即触发复核 | p2-m2，dream needs_review 不借道 verdict |
| #23／#28 | outcome/project 重投先查原事件，再验当前版本 | C1 子任务也先识别已完成请求 |
| #26／#27 | 项目身份不混状态；证据沿 {ref,kind,hash}，失效 effective 回退而 head 不回退 | p2-m3、撤销影响项目来源 |
| #29／#30 | 同值重填继承来源；模型 project_update 仅 work，life 拒绝；主人操作仍绑定 | C4 拔件与权限反例 |

并行施工新增 decisions #17–30 已完整重读；出图及总复核模型安排以该文件最新约定为准，不复写其记录。
#22 与设计允许 auto/pending、#30 与设计生活窗口逐次授权的差异保留为已定施工边界，report-3 明列供总复核；本批不推翻。
P2-M3 记录的 project_capacity_blocked 尚待 P2-M4 闭合；C1 前置不能只看 main=6/control=3，必须核第二批最终验收。

## 2. 迁移分配与存储补齐

旧 SQL 文件 main-001–006、control-001–003、dream-001 全部只读，SHA-256 必须与验收基线一致。
不修改旧 migration 的 SQL、触发器或 checksum，不因当前目录缺文件抢占；新增 SQL 只能顺序接续。
每库每次迁移一个 BEGIN IMMEDIATE，版本记录与 DDL 同事务；三库升级失败保留实际版本并停止业务。
先预检所有库版本、旧 hash、编号连续性、源库完整性，再备份并验证；不能先升级主库再发现梦库来自未来。
首次空目录明确 initial_empty，才可免无中生有的备份；已有未知／损坏库不是空库，不能吞异常当版本 0。

| 编号／阶段 | 新增结构 | 不可变／兼容要求 |
|---|---|---|
| main-007.sql／C1 | candidates、memories 补 key_status、binding_status、binding_basis、origin_mode | 新写必填；旧行 NULL 有明确 legacy 解释，不原地洗来源 |
| control-004.sql／C1 | operation_steps 追加步骤链接；context_snapshots 补 source_revisions JSON | 旧快照 NULL，旧操作照常读；不另建失败计数器 |
| dream-002.sql／C1 | dreams、propositions、candidates、relations、confirmation_snapshots | 独立库、库内 FK、追加保护、唯一键与提交序号 |
| main-008.sql／C2 | import_items、graph_nodes、graph_edges 及追加保护／引用索引 | 导入来源可追溯；骨架非事实认证；无新主事实权威 |
| C3–C5 | 不增加迁移 | 配置／报告沿用原事件与文件出口 |

C1 终态 main=7/control=4/dream=2；C2 至 C5 终态 main=8/control=4/dream=2。
main-007 新列均允许旧行 NULL；key_status 枚举 resolved/unresolved，binding_status 为 proposed/accepted。
binding_basis 为规范 JSON，含原观察／批准回执／规则版本；origin_mode 为 self/inherited，仅确认入口可写 inherited。
新 INSERT 必须填四列，并用新增触发器禁止 UPDATE 这四列；旧不可变触发器不删除、不放宽。
旧行的 NULL 不冒作“历史已入库”：受控补账追加 key-state-backfill 事件，state 保存有效投影及依据。
补账只能从原组件、原注册版本、原批准回执核得；不能单凭 tk: 前缀判 resolved，更不能推导 accepted。
原字段／payload_hash 不改；无法核得的条目标 legacy_binding_unknown，保留检索，阻断裁决／merge／梦确认依据。
新候选提升必须复制自身有效键、状态和绑定依据；judgments 沿用第二批列，不建平行主题算法。
默认 origin_mode=self；只有持有有效 confirm 快照的内部入口可写 inherited，模型 schema 不暴露该字段。
memories.credibility 仍只存原三枚举，不把 inherited 塞进旧 CHECK；inherited 是折叠方式，不是第四可信度。
初始存储值保守为 unverified，读取按当前确认及证据动态折叠；旧行 NULL 解释为 self，并显示 legacy 标记。
operation_steps 字段为 id、parent_operation_id、step_name、child_operation_id、target_db、target_ids、payload_hash、at。
其键为 parent_operation_id+step_name，追加保护，同键异文冲突；步骤结果一律由原 operations/attempts 核验。
步骤链接与尚未执行的子任务计划在控制账同事务固化，恢复扫描覆盖“已计划但尚未 reserve”的子任务。
source_revisions={main,dream,policy} 随新快照固化；同一主库 revision 下梦确认变化必须生成不同编译身份。
编译键原 source snapshot revision 扩展为稳定复合版本，不改变既有对象键；旧快照继续按旧版解释。

## 3. 交付文件与旧模块改动风险

下表路径相对 whale-unify/memsys；报告、README 的例外路径在表中写明。
新增业务模块不直接向模型暴露 db handle；生产接线必须调用既有事务、commitControlled、origin、pager。
测试生成物只在 _build/test-data/p3-* 或 Node 临时目录，证据在 _build/artifacts/p3；不写生产默认目录。

| 新文件 | 职责 | 交付 |
|---|---|---|
| src/storage/migrations/main-007.sql、control-004.sql、dream-002.sql | §2 的 C1 schema | C1 |
| src/storage/migrations/main-008.sql | 导入映射、骨架原关系 | C2 |
| src/dream/store.mjs | 梦三对象原子写、库内事件与精确读回 | C1 |
| src/dream/confirm.mjs | 批准核验、确认快照、主库补建、撤销 | C1 |
| src/dream/replay.mjs | 最新有效确认、void、inferred/dead 折叠 | C1 |
| src/dream/organize.mjs | merge_exact 与 supersede_proposal 窄白名单 | C1 |
| src/dream/surface.mjs | linkedIds 场景、原始 R、频次与梦目录 | C1 |
| src/read/dream.mjs、src/tools/dream.mjs | dream_record、organize、梦读取处理器与 schema | C1 |
| src/import/legacy.mjs | 旧格式识别、只读清单、导入计划及逐项写入 | C2 |
| src/import/pointers.mjs | 指定版本原文匹配与 pointer-change 补账 | C2 |
| src/feed/filter.mjs | 三闸纯筛选、理由与发布时间校验 | C3 |
| src/tools/feed.mjs、scripts/feed.mjs | 同一 filter 的工具与离线 JSON CLI 入口 | C3 |
| scripts/import-legacy.mjs | plan/apply/verify/pointer-plan/pointer-apply/cutover-check/activate/rollback-check | C2 |
| scripts/restore-check.mjs | manifest 校验、隔离恢复及高水位比对 | C2 |
| scripts/acceptance-boundaries.mjs | 汇总能力、失败出口、发布 gate 的证据报告 | C4 |
| scripts/prepare-review.mjs | 收集代码 hash、报告、决定、测试日志与未闭合项 | C5 |
| test/p3-c1-dream.test.mjs、test/p3-c1-recovery.test.mjs | 梦隔离、确认、撤销、跨库与整理 | C1 |
| test/p3-c2-import.test.mjs、test/p3-c2-rollback.test.mjs | 导入映射、备份恢复、门牌与幂等 | C2 |
| test/p3-c3-feed.test.mjs、test/fixtures/p3-feed.json | 三闸边界与无副作用夹具 | C3 |
| test/p3-c4-boundaries.test.mjs、test/p3-integration.test.mjs | §15 矩阵及三批串联／拔件 | C4/C5 |
| README.md、../README.md | 包使用手册与整仓入口链接，保留已有项目说明 | C5 |
| ../_build/report-3.md、../_build/acceptance.md | 主管证据／边界与第三批可执行命令 | C5 |

### 3.1 会碰前两批已验收模块：必须单列 diff 与回归

| 已验收文件／模块 | 本批改动及风险 | 必跑回归／限制 |
|---|---|---|
| storage/migrate、scripts/migrate | 全库预检、备份 gate、JSON appliedNow、未来版本拒绝 | m1-storage；不改旧 SQL |
| storage/backup、scripts/checkpoint | 真正检查 integrity/FK/hash，梦高水位，不再硬写 placeholder-only | m1-storage、C2 WAL 与损坏备份 |
| storage/repositories、replay | 新列写入、补账事件、导入与图事件、类型化梦引用 | p2-m5-replay；旧事件原字节不变 |
| identity、contracts | 新对象／事件命名空间、复合快照身份、错误枚举 | 原幂等键不重算；异文仍冲突 |
| write/origin、topic | 当前梦确认折叠、图深度／环、真实绑定状态 | m2-write、p2-project；禁止 verified 缓存残留 |
| write/observe、candidate、promote | 内部确认／迁移入口、完整六步与新列；self-note 原保全路径不移，禁止借道模型候选 | m2-write 六断点、旧 E1/E2 |
| write/authority、owner-actions、review | 三种梦专有动作白名单、nonce、deferred | p2-judgment/due；不开放通用 owner 后门 |
| write/due、due-actions | confirm/merge/import 同样经过惦记门禁 | p2-m4-due；不得自动 open |
| control/recovery、maintenance | 梦库目标与持久步骤恢复、取消补写、维护导入任务 | m3-reliable；关做梦也要恢复 |
| context/select/rank/compile/budget/snapshots/delivery | 独立梦区、复合 revision、撤销校验、typed manifest | m4-context、p2-m4-due、旧 E3 |
| read/get/search/review/pager/self/project、tools/read | 动态来源、梦历史、安全失效、分页路由 | m5-tools、p2 自我/项目；不截正文 |
| config、runtime/capabilities/identities/session-events/tools、index | dream 可信角色、工具/门禁、唤醒执行证据 | C4 真宿主；默认开关不扩大 |
| tools/schemas/record | 严格 kind 分支及原工具兼容 | m5-tools、p2 全部 schema 反例 |
| scripts/live-check | 第三批工具／owner／梦执行／双轮探针 | 临时副本安装，不链工作区 |
| test/helpers/runtime/fixtures/faults/worker、既有 test | 新故障夹具、阶段版本断言兼容 | 不删旧行为、不 skip、不改成空测试 |

ledger/commit/readback/clock 的算法无计划改动；接口不足先报具体 blocker，不复制三败或另用内存任务账。
build/test/check-bom 若已自动枚举则保持；需扩展枚举时列 diff；package.json 不增加依赖。
若第二批最终路径有调整，先用 report-2 映射同职责模块，记录决定；不能悄悄漏掉上表接线。
已核的 backup 实现会记录检查结果但尚需强制失败，restoreToIsolated 尚需复制前核 manifest；本批明确修这两个出口。

## 4. C1 梦内容、权限、确认与来源

### 4.1 梦库对象与最小工具

| 对象 | 字段与约束 | 权限／可变范围 |
|---|---|---|
| dreams | id、at、idempotency_key、payload_hash、linked_ids、basis、idea、origin | dream runtime 新建；正文全不可变 |
| propositions | id、dream_id FK、ordinal、text、text_hash、at、idempotency_key、payload_hash | UNIQUE(dream_id,ordinal)，不可改命题 |
| candidates（梦库） | id、dream_id FK、proposition_id FK、text、basis、origin、status、at、idempotency_key、payload_hash | 初始 inferred；只有合法梦事件可投影 dead |
| relations（梦库） | 与主库同构的 type/payload/key/seq/ordinal/version | 只追加；各库独立提交序号 |
| confirmation_snapshots | confirm_id UNIQUE、payload、payload_hash、approval_receipt_id、original_session_id | 与 confirm 同事务，只追加 |
| 梦只读投影 | confirm 当前有效集合、dream void、候选状态 | 从原对象和梦 relations 重放，不存唯一确认状态缓存 |

dreamId 为 d- 加完整业务键 SHA-256；propositionId 为 dreamId#pN，N 从 1 起且绑定不可变项槽。
dream-record 键为 [dream,受信sessionId,稳定callId]，命题与 inferred 候选键绑定 dreamId+槽。
同请求原文不同报 idempotency_conflict；新想法用新调用留新梦，不原地改旧命题或把 inferred 改成确认候选。
dreams.origin 继承 linkedIds 实际来源并含模型运行来源；引用某个命题时必须带 d-xxx#pN 污染标记。
memsys_dream_record 输入只含 linkedIds、basis、idea、propositions[{text}]；linkedIds 可空，命题至少一项。
linkedIds 非空时逐 id 读回，缺失／无法查分别 validation_error／unknown；不拿旧摘要当依据，禁止模型传 origin/at/role。
所有嵌套 schema additionalProperties=false；文本非空，项数上限 20、linkedIds 上限 20 是单请求资源限制。
原始梦工具输出由 dream/store 内部经受控白名单独立保全为主库 source=model/author_kind=model observation；复用 #18 的做法，不改 self-note 原路径；失败不丢输出，不生成用户 capture。
随后一个梦库事务写 dream+全部 propositions+对应 inferred 候选+记录事件，任何一项失败全回滚。
这两次写及控制账非原子；主库保全原输出不授梦库写权，梦写只有 runtime.role=dream 可执行。
日常／owner／maintenance 直接写梦内容一律 forbidden_role；model 传 mode=dream 不改变运行角色。
主库不为未确认梦建普通 candidate/memory；梦库不能放主库 facts、due、项目权威状态。
memsys_review_get 增 kind=dream，返回梦原文、命题、候选及确认历史，复用 pager；不另造不必要的公开 dream_get。
读取显式 id 可跨场景并显示 linkedIds 限制；自动目录仍按 §4.5；梦与维护读取不加 uses。

### 4.2 两种确认提案都必须绑定主人决定

确认入口复用 propose_owner_action 与完整 /mem accept <proposalId> <payloadHash>；新增 action=confirm-dream。
unconfirm-dream 绑定 confirmId 与事件版本；void-dream 绑定 dreamId 与当前命题集 hash；三者均不能由 dream 角色执行。
拒绝命令沿同一 /mem reject 通道收尾；自由句“对”、提及 id、模型解释唯一目标均只成 pending。
confirm 提案同时显示 propositionId/textHash、原文、完整主库 candidateDraft、主题组件、scene/scope、证据及版本。
主人批准命题不自动批准扩大场景／惦记／新实体；这些条件不满足则挂起，不能默许 global 或 open。
候选主题组件必须已正式注册且无歧义，主人准确批准绑定后 accepted；不能在确认里顺手注册／rekey。
以未归组记忆为 linkedIds 可以做梦；用它作确认依据、作为确认候选未归组目标均拒绝 unresolved_forbidden。

| 路径 | 可提交的依据 | 谁判断／结构 gate |
|---|---|---|
| 主人直接确认命题 | 真实批准观察与精确命题 hash；可无额外现实证据 | owner 回执批准这句命题，不伪称工具独立实测 |
| 独立现实证据提案 | evidence_refs、版本/hash/span、独立理由、逐命题对应关系 | 服务核结构；主人裁决现实独立／支持关系／非复述 |
| 明知模型或梦衍生 | model observation、self_note、dream、含梦来源 | 结构上拒绝；主人点普通接受也不能洗白 |
| 无法查完来源 | unknown 作者、缺旁挂、深度截断、环、读失败 | 不视作独立；保留提案并给原因，不默认为空证据 |
| 包装 derived／工具转述 | 继续展开原链；原链有模型、梦或未归组依据仍拒绝 | observed@ 或包装器名称不覆盖原作者 |

独立路径逐根核 author_kind 与来源；无梦只是必要条件，不能自动证明独立现实证据。
来自合格 memory 的依据必须有效 resolved，并展开到已知作者原观察；普通高分／多 uses 不授独立性。
主人直接路径明确标 confirmation_basis=owner_assertion；独立路径标 owner_adjudicated_evidence，两个标签不可混。
前者不是向证据列表塞一条伪“现实 observation”；保留实际 owner 输入，命题正文仍来自梦且可撤销。
提案到期按普通 3 次后续输入或 24 小时 deferred；没有确认就继续 from-dream，不无限主动请求、不超时洗白。

### 4.3 跨库顺序与完整恢复快照

1. 保存并 found 真实主人批准 observation；主库 owner-actions 锁内核提案、hash、版本、nonce，追加绑定回执与梦动作任务。
2. 回执消费表示授权已接收，不表示梦确认／提升完成；pending-resolve 保留 result=accepted，另记 execution_state=authorized。
3. 控制账固化 confirmId、目标 id、子任务键、首次生成值；确认候选及证据、主库观察与提升所需完整字段都进入快照。
4. 重验结构和主人语义裁决，在梦库同事务追加 confirm+confirmation_snapshots，commitControlled 精确读回整集合。
5. 梦步骤 found 才向主库写 source=dream 命题观察；键 obs:dream:<propositionId>:<textHash>，作者 model，正文逐字匹配。
6. 命题观察独立提交并 found，origin 永久含 d-xxx#pN；这只是主库 FK 锚点，不是第二份现实证据。
7. 主库一个事务新建 confirm:<confirmId> 候选、candidate evidence，并调用既有提升六步；promote:<candidateId> 唯一。
8. 读回候选、memory、timeline、pointer、两套证据、promote 事件及提交版本，再记录主库子任务 found；最终才返回链路完成。

上述 pending-resolve 仅关闭权限提案，不冒称主库候选已提升；执行状态由各子任务和最终精确读回推导。
一份 nonce 只绑定一份固定完整计划；恢复凭原回执补同一子任务，不再消费 nonce，不要求主人重新确认。
confirm 事件含 propositionId/textHash、evidence_refs/evidenceOrigin、approvalReceiptId、确认路径及证据描述 hash。
snapshot.payload 含 candidate 完整字段、source_unit/path、主题及绑定、scene/scope、time/due/pointer、why、judgment 引用或 null。
还含命题原文/hash、原来源、每条证据 id/类型/版本/hash/span/role、original_session_id、owner observation/receipt、全部目标键。
审计生成值与对象 state_snapshot 按各对象首次尝试分别固化；延后创建 memory 时在其首次操作中补冻结自身快照，不复用候选快照。
恢复快照保存完整确定性业务字段，尚未发起的 memory 审计字段显式标 deferred_generated，由子 operation 固化后引用；不得省略未知业务字段。
候选自身为 origin_mode=inherited，semantic_status=accepted/assertion；origin 保留梦命题路径，来源折叠沿有效 confirm 截断。
主人确认不保证外部世界永真；due 闸门照常执行，promise 或 due_at 非空且无专有 due 回执只能 pending-due。
原 inferred 候选不改 text、origin 或改成 promoted；主库确认候选另 id，证据关系另行追加，绝不跨库伪 FK。

### 4.4 撤销、失效、恢复与并发

| 故障／竞争点 | 恢复动作 | 不可出现的结果 |
|---|---|---|
| 原批准 observation 成功、任务未固化 | 输入稳定事件重放，复核提案后补原回执／任务 | 不凭摘要重造主人消息 |
| 回执已消费、梦步骤未开始 | 扫已授权任务，按原键创建／执行未完成子步骤 | 不因 nonce 已用而永久卡死 |
| 梦事务任一步抛错 | 整梦事务回滚，记 unknown，不即时再执行业务 | 不留下只有 confirm 没快照 |
| 梦 commit 后 control 回执失败 | 报 unknown，恢复核 confirm+完整 snapshot 后补控制结果 | 不用主库缺条反推梦确认失败 |
| confirm found、主库尚未写 | 重验确认、原证据 hash、来源、目标版本，再补原键 | 不依赖做梦调度或模型再输出 |
| 主库命题观察成功、提升失败 | 观察保留；候选与六步全回滚，按原任务恢复 | 不留半条 memory |
| unconfirm/void 先于主库补写 | 取消尚未完成主库任务，控制账留 cancellation 原因 | 不撤销原批准观察、不补事实 |
| 撤销与主库 commit 竞争 | 允许留可查的 from-dream 行；返回状态与读来源重新核验 | 不留永久 verified 缓存 |
| 引用缺失／hash 改变／作者证据失效 | 当前 confirm 无效，停止补写；已提升条目退出 S | 不只看 confirm 行存在 |
| 第三次失败／冻结后发现 found | 按原 ledger 记 reconciliation，冻结不清 | 不因换步骤或重启得第四次写 |

所有梦写与确认变更经同一受控服务锁串行；直接 SQL／外部进程绕服务不在权限承诺内。
子步骤 object_key 按目标库+逻辑对象固定，不能用 payload、revision、重试号换流避冻；新批准操作也要先核目标流。
恢复先读每个目标的精确提交集合，不使用“SELECT 有一行”作为 found；未知步骤版本 quarantine 并显错。
控制账不可写，主库和梦库业务写数都为 0；不另用 JSON 文件暂存失败次数。
同命题按梦库 commit_seq/ordinal 找最后有效 confirm；unconfirm 只撤指定 confirm，前一个有效确认可继续生效。
dream-void 使整梦所有命题 from-dream，不能被后来普通 confirm 自动复活；本批不开放 unvoid。
无有效确认、已撤销或有效性无法证明时，已提升梦记忆保留原文与事实状态，但折叠为 from-dream／unsafe 并退出 S。
原梦来源分支不会因另有 master@ 或 observed@ 被盖掉；深度上限 5，已知梦优先于其它未知分支。
来源服务返回 credibility、safe、reason、dreamRevision；无法安全展开时不给“可独立证明”的真值。
缓存至少绑定 main/dream/registry revisions；origin/get/search/project/context 共用 resolver，不各自绕过。
旧快照不能偷偷拼新内容：current 读取前若梦依赖 revision 失效，返回 stale_cursor+fresh_report_entry。
history 可读原快照并明确历史确认已撤销；不把旧回执或旧 verified 标签当当前资格。
投递前复核复合 revision；已改变则作废本次待投递编译并重编，未经核验不发自动事实目录。
已交付的历史上下文无法收回，记录撤销与后续纠正状态；不宣称跨库与外部推理有绝对原子性。

### 4.5 主库整理与梦浮现

memsys_organize 只接 merge_exact、supersede_proposal；运行角色 dream，主库没有任意写 SQL 入口。
merge_exact 逐字段比较 §12.6：正文/摘要/why、类型/场景/范围、有效键/绑定、值、时间、来源、语义、权重、标签、due、pointer、judgment。
允许忽略的仅系统身份、各自入档快照、活动计数、证据行 id；不得做 NFKC、去标点、去否定或相似度合并。
所有端点必须 active、resolved、绑定 accepted；任一 open/pending-done/cooled-due 阻断并要求主人另处置。
新候选键 merge:SHA-256([排序旧id与版本])，source_path=resolve、reason=exact_merge；不改旧 source_path CHECK 增新枚举。
候选引用全部旧条及其真实来源，origin_mode=self；含梦／无法折叠的输入只给建议，本批机械 merge 不洗梦链。
新候选与完整提升、旧条 supersede 同主库事务；新 memory 独立快照，旧快照/证据不删除，due 入口仍只允许合法态。
supersede_proposal 只存主库 pending；自由文本不同、权重不同、未归组、范围变化不能自动取代。
无通用主人 supersede 执行能力时 proposal 返回 action_execution_unavailable，并按原期限 deferred，不能冒称执行。
memsys_record 的 dream 白名单只保留 self_note/speculation/needs_review；日常 judgment/master 操作不能借梦角色开放。
needs_review 只追加复核，不改 master verdict；self note 仍用第二批原作者绑定与原文保全。

梦浮现默认关闭，只有配置和能力均允许才运行；它与做梦写工具、恢复分别有开关。
只看本窗口合法 linkedIds；原始 R 最大值达到 0.45 才触发，不使用带 F 的 R_eff，也不让梦自己匹配词触发。
无合格 linkedIds 不浮现；梦自身不设 scene，展示 scene 取合格 linkedIds 中 id 最小者的 scene。
频次键为 [sessionId,系统日界,有效topic_key或dreamId]；同主题多个梦稳定选一个，最多一次，重启不能重置。
日界用配置时区与系统时钟，回拨不重开已消费频次；梦读取、inferred 数量、浮现均不提升可信度。
触发预留／投递结果在控制账留痕；unknown 不自动重发，频次标“触发已占用、投递未知”，不假称曝光。
独立“未验证的梦”区使用 dream:<propositionId> typed ID，eligible/actual/deferred 全部纳入原 manifest。
梦不是 S，也不是 P_h/P_s；同一个已确认主库 memory 若符合 S，仍按 memory 身份交付，不能把梦正文替进去。
分组复用 scene:dream，仍最多 12 顶层组；K 重测，组头必须有名称/id、未展开数、完整 context_get 参数。
梦页可从 context_get／review_get 取原文及确认历史；目录与梦正文均不加 memory uses/injections/unused。
关做梦、浮现、考试、骨架后，输入采集、due 扫描、self note、确认撤销恢复仍必须运行。

## 5. C2 旧内容迁移与门牌补账

### 5.1 先确定真实输入，再生成不可变计划

默认只读发现位置为 os.homedir()/.dsh/whale-soul/memory；必须由本地操作者确认源目录和导出格式。
工作区 soul.json、soul-latest.json 经核是 npm registry 元数据；遇该形状报 unsupported_legacy_format，不能按记忆导入。
本图不假定生产记录数量或字段已核实；24 点/3 区间/24 未知门牌/8 节点是设计基准夹具，真实计数独立盘点。
plan 模式列出规范绝对路径、源系统身份、格式版本、每文件 SHA-256、源稳定 id、范围、原字节 hash 与异常。
目录只读，逐项 lstat/realpath；不跟随越界链接、不遍历 node_modules；输入与目标目录不得相同或互相包含。
若源是 SQLite，停旧写者后用一致性备份导出，记录 integrity/FK 与 WAL 内容核验；源是文件则停写后复制并双读 hash。
源文件解析前按原字节 hash；JSON 编码须严格 UTF-8，非法字节拒绝，缺 raw 与 raw="" 明确区分。
计划含 mapping_policy=legacy-v1、目标版本、场景映射、逐项 actions/expectedHashes、来源缺口、总数和 planHash。
计划不调用模型、不写主库、不填猜的时间／门牌；相同源版本与策略生成相同业务计划 hash。
apply 前重核源清单与计划 hash；新增／删除／变动文件都 source_changed，要求重做计划，不现场默默换输入。
命令只接受本地操作者的 --source/--plan/--data-dir；模型工具不能选择目录或发起迁移。
场景／scope 未知的旧项先进入计划 quarantined；操作者提供明确映射，扩大到 both/global 仍需主人授权。
不拿 maintenance 角色默认成 life，不因迁移权限给模型原本没有的场景权限。

### 5.2 映射、业务时间与旧来源

| 旧资料 | 新落点 | 必验边界 |
|---|---|---|
| raw 原字节 | source=file、author_kind=unknown observation，origin 含 migrated:whale-soul | 未核来源 unverified；raw 缺失不拿 detail 冒原文 |
| gist/detail/why | source_path=resolve 的迁移候选，记录 migration 类型／键与 mapping_policy | why 缺失固定“迁移：旧数据无 why”；proposed/assertion |
| raw 缺失 | 保存完整旧记录 JSON 为文件观察并 lossy=1、raw_missing；摘要只作摘要证据 | get 明示“旧记录载体，原话缺失”，不能显示为主人原话 |
| 24 条点事件夹具 | 各一条 memory/timeline，point，end=null | start 仅旧有据值；不造持续零天 |
| 3 条额外区间夹具 | 各独立 episode/candidate/memory/timeline，并关联旧源 id | 不给同一 memory 第二条 timeline，不全压成 point |
| 24 个 unknown 门牌 | pointers unknown、location=null、保留 search_hint | 导入不自动 exact |
| 8 节点及旧边夹具 | graph_nodes/graph_edges 带 migrated 来源、源记录 hash 与引用 | 悬空边隔离，原关系不是事实认证 |
| 旧 topic／实体文字 | 按冻结 registry 明确映射；无法唯一映射 unresolved | 不自由拼新客体；resolved 也不等于绑定 accepted |
| 旧 promise／due／open | 同原 due 服务核原批准证据；无合法回执 pending-due | 不继承假 open；100 条及归档政策照常执行 |

导入新对象 recorded_at/at/state_snapshot 为本次系统首次尝试，phase=maintenance、energy/emotion=unknown。
旧 created_at/mtime/迁移时刻只存 legacy 元数据，不能当 start/end、owner 确认时刻或历史心理状态。
业务时间只取源记录中明确业务字段或有原文引用的已存值，保留 minute/day/month/year/unknown 精度和原表示。
完整起止且精度合法才 exact；有明确持续依据而无 end 为 ongoing；明确结束但结束未知为 ended_unknown。
point 不硬造 end；无依据 start/end 为 null；缺年份／时区／区间矛盾列异常，不能使用 Date.parse 自动猜完整值。
非法时间项可保全原观察，但相应候选不提升；整批 verify 报 unresolved，切换 gate 失败，待新计划处置。
迁移是新建 timeline 的受控路径，不扩大普通 timeline_change 权限，也不 UPDATE 已有事实的历史时间。
所有导入来源含 migrated:whale-soul，并保留可核的旧完整来源分支；原有梦链不得被迁移标签抹掉。
新候选到 memory 仍走原六步，schema 字段齐全并逐项读回；旧 confidence/uses/考试分不升级真实性。
节点只有 memory_id、label/kind、origin、源引用；边存 from/to/kind、origin、来源引用；公用 id/key/hash/at 只追加。
边／节点的旧 id 与新 id 对应进 import_items；先导入关联 memory 后建节点、后建边，缺端点不静默丢边。
骨架只保存／核验；search(graph=...) 未实现仍 unsupported_feature，evidence_mean 不用骨架条数填数。

### 5.3 内容幂等、逐项提交与切换

import_items 字段为 id、source_system、source_object_id、source_version_hash、item_kind、target_ids、mapping_policy、payload_hash、at。
唯一键为 [source_system,source_object_id,source_version_hash,item_kind,mapping_policy]；有原 id 不拿文件顺序代身份。
无原 id 时用冻结源文件身份+明确结构路径/范围；不同真实记录相同文字也分开，不跨源正文去重。
文件 manifest hash 只标批次，不用整个包 hash 重建每个未变化 item；原记录版本 hash 控制逐项幂等。
原 id 后续内容变了建立新版本和 derived 关联，不覆盖旧观察／候选；不同策略需新显式计划，禁止无声重复提升。
每项操作固定观察／候选／memory／证据／事件目标；observation 先 found，候选+完整提升+import_items 同主库事务。
图项的原关系+import_items 同事务；映射只是审计索引，不能代替完整业务读回。
批处理按项持久游标，部分已完成允许重启续跑；完成标记只来自逐项 found，全批不是一个跨库事务。
重复 apply 输出 appliedNow=[]、已有项 reused=N；不能以 INSERT OR IGNORE 把同键异文算成功。
schema migrate 的 appliedNow 与内容 import 的 appliedNow 分字段／命令返回，不能只看版本号相同宣称内容幂等。
verify 必须比较记录计数、逐字段原字节、每项目标、证据闭合、timeline/pointer、图两端及全库 integrity/FK。
部分跳过、隔离、unknown、未闭合外键逻辑引用，都令 cutover_ready=false；不得用总数相等掩盖错配。
切换是单次受控配置动作，绑定 planHash、verifyHash、源高水位、恢复演练报告；先停旧写者再重核增量。
旧系统仍是权威直到切换报告成功；新系统启动先核配置指向及可读状态，失败则不启动新写者。
本批交付 cutover-check/activate 协议及隔离演练；生产 activate 需操作者显式指定生产计划与 verified 报告，不在出图时执行。
切换不删除旧目录、旧备份或旧插件数据；不允许新旧系统同时对同一导入任务持续写。

### 5.4 备份、hash、降版本拒绝与回滚演练

| 检查点 | 必须完成 | 失败出路 |
|---|---|---|
| 升级／导入之前 | 停写屏障、在途清单、源及目标三库 integrity=ok/FK=0 | 不开始 DDL 或导入，保全现场 |
| 一致性备份 | VACUUM INTO 三库，闭库后核 SHA-256、schema、主/梦 commit_seq、control generation/任务 | 任一库失败整批 backup_ready=false |
| manifest | 源码/SQL hash、库名与版本、库文件 hash、源清单 hash、系统时刻、在途 operation ids | 缺项拒绝恢复／迁移，不把缺失高水位写 0 |
| 执行前 | 全库支持版本、连续迁移、已应用 SQL hash，源计划未变 | schema_from_future／migration_checksum_mismatch 等非零 |
| 执行中断 | 单 migration 回滚；跨库保留成功版本，业务关闭 | 修正后只跑未应用版本，不做 down migration |
| 恢复之前 | 先核 manifest 与全部源备份文件 hash，目标为新的隔离目录 | hash 不符拒绝复制；拒绝覆盖非空目标 |
| 恢复之后 | 三库 integrity/FK、原文/事件/任务/冻结及各高水位一致 | 恢复不合格不切换，保留损坏现场 |
| 备份后有新事实 | 保全当前三库及增量，兼容恢复器按原键重放并核验 | 不能证明增量完整则保持停写，不回退丢数据 |
| 代码回滚 | 用源码检查点与匹配 schema 的隔离库验证后切配置 | 旧代码遇未来 schema 只读报错，禁止写旧版库结构 |

restore-check 必须复用并加固原 backup 模块，不复制裸活动 db/WAL/SHM 拼成所谓一致备份。
备份目标 label 冲突拒绝或系统生成唯一新目录；不覆盖已有备份，不用旧 control.db 把失败计数清零。
真实 WAL 用例先写已提交未 checkpoint 内容，再备份、隔离恢复，必须仍能读出该条。
演练一：main 成功/control 回执未记即中断，恢复后 reconciliation，原业务不重复、冻结历史保持。
演练二：篡改备份一字节、删 manifest 字段、混用不同批次梦库，各自必须拒绝，退出码非零。
演练三：只迁成 main-007、control-004 未完成；重启预检关闭业务，修复后接续，旧版本 hash 不变。
演练四：新版库交旧迁移集合，必须 schema_from_future；不能删 schema_migrations 伪装回退成功。

### 5.5 回溯补门牌

pointer-plan 仅在显式指定会话／文件版本清单中找原文，记录规范路径、内容 hash、UTF-8 字节范围及候选位置。
精确字节匹配与字符边界都通过才可提 exact；相似摘要、只匹配 detail、多个未消歧位置均保持 unknown。
source file 重新读 hash 不同、路径失效、无原 raw 均不补；不按“最新同名文件”替代指定版本。
pointer-apply 输入 planHash+memoryId+baseRevision；原 authority 核范围，pointer-change 完整 from/to 与投影同事务。
补账操作键绑定原目标、源版本与字节范围；同键异文冲突、重复不增加 revision，竞态返回 stale。
补门牌不改 origin、credibility、semantic_status、业务时间或独立证据数量，不增加 uses。
报告分别列 exact、unknown、ambiguous、source_changed；有未知不等于迁移丢条，但不能宣称门牌全修复。

## 6. C3 feed 三闸契约

feed 是“值得扫”的候选筛选，不是观看、观察采集或长期记忆入口，不调用 dream/candidate/promote。
输入 items=[{id,title,description,publishedAt}]、keywords、recentDays；默认 recentDays=7，由受控配置提供。
模型不能覆盖 now、抓取时间或策略；recentDays 必须整数 1..7，扩大默认窗口的值拒绝，不能悄悄放宽规范。
本地 API/CLI 可缩小窗口并在响应显明；外部 provider 的秒时间戳先经明确适配转 UTC，核心只收带时区 ISO。
拒绝自动猜秒／毫秒单位、裸 YYYY-MM-DD 的发布瞬间与无时区日期；保留原 publishedAt 便于审计。
系统 now 每次调用读取一次并固化；缓存命中也重新筛日期，不拿 fetchedAt/cacheAt 补发布时间。

| 闸门 | 确定算法 | 失败理由／审计字段 |
|---|---|---|
| 相关 | 标题 NFKC+小写后包含至少一个非空偏好关键词；简介命中不算标题命中 | not_relevant；keyword、标题匹配范围 |
| 有细节 | 标题与简介分别扫描再合并匹配，不能跨字段拼出 token | no_details；类型、字段、匹配文本、码点范围 |
| 发布日期存在／合法 | 缺/null/空→missing；非严格日历合法 ISO→invalid | missing_publish_time／invalid_publish_time |
| 不在未来 | publishedAt<=本次系统 now | future_publish_time |
| 窗口内 | now-recentDays×86400000 <= publishedAt <= now，两端包含 | too_old；窗口上下界及策略版本 |

细节代理固定四类：独立英文 token 至少 3 字母；版本号；数字+单位／百分号；非空《书名号》。
英文按完整字母数字词边界取纯 ASCII 字母串，不能从 abc123 截 abc 冒独立 token；大小写均可。
版本号规则为可选 v/V 前缀、至少两段数字点分、可选字母数字预发布后缀，左右不得嵌在其它字母数字词内。
数字单位允许非负整数／小数与可选空格；单位固定 %、％、GB、MB、TB、ms、s、秒、分钟、小时、天、元、万、亿。
单位按最长先匹配，英文单位遵守完整词边界，大小写仅按列出形式；不从 10msec 截出 10ms。
《》内 trim 后非空才算，有标题引号但没内容不算；普通情绪词、两个字母 AI 本身不满足英文细节代理。
这是可审计字面代理，不宣称理解了内容质量；关键词和规则版本写输出，不根据点赞数暗自过闸。
每个输入都返回 id/title/description/publishedAt、accepted、matchedKeywords、detailMatches、rejectionReasons、now/recentDays/policyRevision。
多闸失败保留所有原因，顺序固定相关→细节→时间；非法日期不再附 too_old，重复 id 不跨不同内容静默合并。
空 keywords 报 keywords_unavailable，不自动放行；空 items 合法返回 0 候选，provider 失败是 error 不能冒充空列表。
离线 CLI 读取 JSON；memsys_feed 只接受受控 provider 的候选，provider 未配置返回 feed_provider_unavailable。
不修改外部 surfcore 仓库、不接 B站凭据、不做推荐发送；现有调用方需显式采用本契约，未接入写 integration_pending。
无任何 observation/memory/uses 写入；后续实际读取材料才由原观察通道保留真实来源，扫过不等于看过。

## 7. C4 把 §15 与未根治项变成可检查的 gate

能力状态只允许 passed/failed/unknown；报告必须含宿主/插件版本、能力名、请求/结果证据路径/hash、环境及替代路径。
offlinePassed、livePassed、cutoverReady 分开，unknown 不转 passed；宿主／插件接口升级后相关动态结果失效。
acceptance-boundaries 离线模式要求每个失败出口实际触发过断言；允许输出未通过的 live gate，但不得标系统完整就绪。
--require-live 则检查所需动态证据，缺证据非零 capability_unverified；只打印 marker 的“探针”不得登记 passed。
自动注册段、工具可用、逐轮更新、完整投递是不同能力；tools-only 也可能只有本地 handler，未验宿主注册不能说模型能调。

| §15 场景 | 离线必须断言 | 失败出口／真宿主 gate |
|---|---|---|
| 模型整轮不发块 | 原文/capture 在，记住命令 quoted，反馈 unknown | 输入与持久日志都未验则停自动采集，只显式导入 |
| 重复工具／兼容块 | 同键同文一份，异文冲突，不同真实消息分开 | 稳定 call/message 身份未验则禁自动写 |
| “对”及伪 owner | 无绑定回执不产生 confirm/master | 权限通道未验保留 pending，默认 deferred |
| 未注册实体／同名项目 | 未归组 proposed 可留，supersede/裁决/梦依据全拒 | registry/rekey 未交付标 action_execution_unavailable |
| 新偏好 start=null | 保留分歧，coexist/deferred，旧事实不失效 | 扫描不依赖梦；无法重建旧待审标 legacy_incomplete |
| 超预算与增长 | P_h/P_s 独立账、K、退让先报告、硬层自身才 overflow | 无 H/tokenizer tools-only；无回执 delivery=unknown |
| 批量期限与衍生候选 | confirm/merge/import 也 pending-due；101→100、期限边界及回拨 | 无真实 due-policy 批准不启 open 保护 |
| 完成信号／恢复 | pending-done/cooled 非 done；失效及批次 stale 不半写 | 无 proof_scope 只建议；容量不足明确 blocked |
| 自我／猜想／命令失败 | 作者绑定、outcome 操作对应、原文可读 | 工具未注册明确 unavailable，不以自然语言块补授权 |
| commit 后断线 | 精确集合读回、未知回执、跨库续跑不重复 | 无法查权威库 unknown，不能用索引有命中代 found |
| 三败后重启 | frozen/3 保持，第四业务写为 0 | 显式维护解冻，不能自动新 generation |
| 梦撤销／来源失效 | from-dream、退出 S、旧游标显失效 | 已投递内容只能后续纠正，关闭失效编译而非复用缓存 |

| 仍未根治／待校准项 | 可交付的检测或出口 | 不能声称 |
|---|---|---|
| 自然语言抽取率 | missing/invalid/proposed 分列，原话保留；显式记住命令仍可用 | 原话全存等于全理解 |
| 主人批准负担 | pending 默认退出且原文可查，迟到需新提案 | 无回应等于同意 |
| 注册覆盖／未归组矫正缺口 | 每目标列 needs_registration/binding/rekey；不开放的动作明确 gate | 重复使用等于注册或 accepted |
| 未标来源外部模型文本 | known model/unknown 作者拒独立证据；owner 独立性裁决有原文 | 本地正则能识别全部 AI 文本 |
| 反馈排序／initial-v1 | 原参数与策略版本保留，给实测观察入口，不自动调参 | 排名或初始强度证明真假 |
| 容量／token／工具成本 | 记录实际字节、token 证据、分页与 overflow，缺测量关闭承诺 | 字节可代真实 token |
| 保守证据／仍重要惦记被冷却 | 报告理由、unknown 通知、原文和恢复入口；恢复仍核容量 | 自动冷却等于不重要或已完成 |
| 历史库持续增长 | 报库/快照/备份体积与写入失败，磁盘不可写 fail closed | 分组或归档已经解决无限增长 |
| self note／梦创作缺产物 | missing/skipped/written 区分；唤醒但没写不算完成 | 空模板或发出唤醒等于完成反思 |
| 旧事件不足／缺原文 | legacy 标记与关联缺口报告，权限动作拒绝 | 新建推测元数据能补出真实历史 |

report-1 的四个边界逐项核销：工具注册看 live；key/binding 列看 main-007；pending-due 看第二批验收；evidence_mean 看下条。
evidence_mean 不依赖骨架：按 §9.1 对直接命中计算 0.40×门牌+0.25×业务时间+0.20×min(uses/5,1)+0.15×有效考试。
unknown 门牌=0.35、无门牌=0；无业务时间=0；未装考试按 0；直接命中 0 才 mean=null。
C4 补 read/search 的该计算及来源字段；无法读取某项返回 metric_status=unknown，不能用 null 伪装零命中。
没有骨架仍显 relation_search=unavailable；不把迁入的 8 个节点当已实现图检索，不扩大直接命中分母。
未开放通用纠错、注册、rekey、全新 /mem due、面板亲建等前批边界列 coverage=not_implemented+明确错误与提案出口。
这些 gate 保证边界诚实，不代表设计全量功能完成；report-3 必须列为剩余差异，交总复核判断，不偷偷移出范围。

## 8. 五个里程碑：交付、命令、期望与回滚

依赖为前两批基线 → C1 → C2 → C3 → C4 → C5；C1 的迁移防护先于梦业务，C2 扩为内容迁移演练。
所有命令从 C:/Users/15728/Desktop/ai/大肥鱼 执行；PowerShell 逐条跑，检查 $LASTEXITCODE，不用 &&。
每套专测须 tests>0、fail 0、cancelled 0、skipped 0；marker 必须在真实断言通过后输出，不能只打印字符串。
已有 m1–m5/e2e 和第二批套件继续由 npm test 枚举；旧阶段版本断言用固定迁移夹具，不删旧行为。
阶段开始建源码与三库检查点，label=P3-C1…P3-C5，系统生成唯一目录；无 git 回滚依赖。
每阶段专测通过后运行共用门禁；通用门禁与里程碑失败按既有契约记账，专测连续三败冻结施工并报主管。

~~~powershell
npm --prefix whale-unify/memsys run build
npm --prefix whale-unify/memsys test
node whale-unify/memsys/scripts/check-bom.mjs
~~~

期望 BUILD_OK files=N、全量 TAP fail 0/skipped 0、UTF8_OK BOM=0 files=N；N 来自实际文件枚举。
新增 --json 输出必须保留原 MIGRATIONS_OK marker（stderr），stdout 单一可解析 JSON；原不带 --json 的 CLI 保持兼容。
报告不得预填测试总数；本文夹具数不代表生产记录数，执行证据写实际值。

### C1：梦库与确认链

交付：§3 的 C1 文件、main-007/control-004/dream-002、全部 §4 接线及迁移预检／备份防护。
前置：第二批报告、主管离线验收及 owner-actions/review/due/pager 可复用；不要求真宿主在线。
先跑专测建立隔离夹具，再验 CLI；fresh 数据目录命令可重复，已有库必须备份预检。

~~~powershell
node --test whale-unify/memsys/test/p3-c1-dream.test.mjs whale-unify/memsys/test/p3-c1-recovery.test.mjs
node --test whale-unify/memsys/test/m2-write.test.mjs whale-unify/memsys/test/m3-reliable.test.mjs whale-unify/memsys/test/p2-m5-replay.test.mjs
node whale-unify/memsys/scripts/migrate.mjs --data-dir whale-unify/_build/test-data/p3-c1 --json
node whale-unify/memsys/scripts/migrate.mjs --data-dir whale-unify/_build/test-data/p3-c1 --json
node whale-unify/memsys/scripts/check-db.mjs --data-dir whale-unify/_build/test-data/p3-c1
~~~

C1 阶段 CLI 期望 versions={main:7,control:4,dream:2}；第二次 results 各库 appliedNow=[]；三库 integrity=ok/FK=0。
C2 SQL 已交付后 CLI 自然升到 8/4/2；C1 历史版本断言由专测的固定 SQL 集保留，不要求 CLI 降级。
专测期望 P3_C1_OK dream_atomic=true confirm_recovered=true dream_in_S=0；TAP 全绿。
必须覆盖：daily/伪 dream 拒绝、三对象事务、原输出保留、两条确认路径、直接 owner 非伪独立证据、未归组绕路拒绝。
再覆盖：完整快照、六步各断点、多个 confirm 最新有效、撤一条／整梦 void、hash 失效、回执中断、三败、两进程竞争。
整理测逐字段一个差异即拒绝自动 merge；同文快照不同可合法合并；due、未归组、环、来源污染负例齐全。
梦目录测 R 与 R_eff 分离、0.45 边界、场景、同主题频次、重启、grouped 遍历完整、typed 项不记曝光。
回滚点：P3-C1 前检查点；关梦新写/浮现，保留已授权任务、梦历史及兼容来源读取／撤销恢复；不退回会缓存 verified 的旧 reader。

### C2：导入、门牌与恢复演练

交付：main-008、import 两模块、两个 CLI、两个专测；§5 全流程及旧列补账核验。
前置：C1 离线通过，受控维护角色与三库备份可用；生产源缺失不阻断夹具测试，但必须阻断生产迁移。
p3-c2-import 套件用真实服务造 24 点/3 区间/8 节点及边；另输出受管夹具 source 与 source-versions.json 供下列 CLI 验收。
固定夹具目录仅写测试拥有的文件，遇非夹具目录拒绝；suite 自身数据库用独立临时目录，不冒用下面的 smoke 目标。
planHash 从文件读取，无手填占位；同一 source 稳定，apply 强制校验 plan 自身 hash。

~~~powershell
node --test whale-unify/memsys/test/p3-c2-import.test.mjs whale-unify/memsys/test/p3-c2-rollback.test.mjs
node whale-unify/memsys/scripts/import-legacy.mjs plan --source whale-unify/_build/test-data/p3-import/source --out whale-unify/_build/test-data/p3-import/plan.json
node whale-unify/memsys/scripts/import-legacy.mjs apply --plan whale-unify/_build/test-data/p3-import/plan.json --data-dir whale-unify/_build/test-data/p3-import/target
node whale-unify/memsys/scripts/import-legacy.mjs apply --plan whale-unify/_build/test-data/p3-import/plan.json --data-dir whale-unify/_build/test-data/p3-import/target
node whale-unify/memsys/scripts/import-legacy.mjs verify --plan whale-unify/_build/test-data/p3-import/plan.json --data-dir whale-unify/_build/test-data/p3-import/target
node whale-unify/memsys/scripts/import-legacy.mjs pointer-plan --versions whale-unify/_build/test-data/p3-import/source-versions.json --data-dir whale-unify/_build/test-data/p3-import/target --out whale-unify/_build/test-data/p3-import/pointers.json
node whale-unify/memsys/scripts/import-legacy.mjs pointer-apply --plan whale-unify/_build/test-data/p3-import/pointers.json --data-dir whale-unify/_build/test-data/p3-import/target
node whale-unify/memsys/scripts/checkpoint.mjs --label P3-C2 --data-dir whale-unify/_build/test-data/p3-import/target --out whale-unify/_build/test-data/p3-import/checkpoints
node whale-unify/memsys/scripts/restore-check.mjs --data-dir whale-unify/_build/test-data/p3-import/target --checkpoint-root whale-unify/_build/test-data/p3-import/checkpoints --label P3-C2 --out whale-unify/_build/test-data/p3-import/restores
node whale-unify/memsys/scripts/import-legacy.mjs cutover-check --plan whale-unify/_build/test-data/p3-import/plan.json --data-dir whale-unify/_build/test-data/p3-import/target --restore-report whale-unify/_build/test-data/p3-import/restores/report.json
node whale-unify/memsys/scripts/import-legacy.mjs activate --plan whale-unify/_build/test-data/p3-import/plan.json --data-dir whale-unify/_build/test-data/p3-import/target --restore-report whale-unify/_build/test-data/p3-import/restores/report.json --deployment-dir whale-unify/_build/test-data/p3-import/deployment
node whale-unify/memsys/scripts/import-legacy.mjs rollback-check --deployment-dir whale-unify/_build/test-data/p3-import/deployment --restore-report whale-unify/_build/test-data/p3-import/restores/report.json
node whale-unify/memsys/scripts/check-db.mjs --data-dir whale-unify/_build/test-data/p3-import/target
~~~

期望 P3_C2_OK points=24 intervals=3 unknown_pointers=24 nodes=8 replay_equal=true；该 marker 在补门牌前夹具断言得出。
CLI 依次输出 IMPORT_PLAN_OK、IMPORT_OK、IMPORT_OK appliedNow=[]、IMPORT_VERIFY_OK unresolved=0、POINTER_PLAN_OK、POINTER_APPLY_OK。
再依次 CHECKPOINT_OK、RESTORE_CHECK_OK hash=true integrity=true ledger_preserved=true、CUTOVER_READY、ACTIVATE_OK、ROLLBACK_CHECK_OK、三库完整性通过。
verify 接受有合法 pointer-change 的投影变更，原导入提交集合仍按历史版本精确核验，不能误判被篡改。
restore-check 从该 root 中按有效 manifest 系统序号选本次 label 最后检查点，明确打印选中批次；并列歧义拒绝、不猜路径。
恢复实际目录由系统生成唯一子目录，report.json 记录路径/hash；activate 只能切该 deployment-dir 的隔离配置，不改 DSH 生产。
回滚点：P3-C2 前检查点与未删旧数据；有新事实必须增量保全、隔离恢复核验；异常批次保留断点，禁止在线覆盖三库。

### C3：feed 契约

交付：filter、tool/CLI、夹具、p3-c3-feed。
前置：C2 基线稳定，验收不调用外部 feed provider。
夹具 keywords 从 JSON 读取；测试时钟只注入测试依赖，CLI 不接受 --now；输出基于真实系统时钟。

~~~powershell
node --test whale-unify/memsys/test/p3-c3-feed.test.mjs
node whale-unify/memsys/scripts/feed.mjs --input whale-unify/memsys/test/fixtures/p3-feed.json
~~~

期望 P3_C3_OK recentDays=7 boundaries=true side_effects=0；CLI 给每项完整筛选理由，退出码 0，不预设随时间变化的通过条数。
测试覆盖阈值恰好前／后、当前时刻、未来、missing/invalid、时区换日、缓存变旧、只简介相关、无关键词及四种细节。
额外断言 abc123、AI、空《》、10msec 不误中对应代理；provider 异常不冒空列表；四类主库对象与 uses 计数不变。
回滚点：P3-C3 前检查点；撤 feed 发布层，保留原 provider 只读能力，记 integration_pending，不影响记忆库。

### C4：边界与真宿主分开验

交付：boundaries 脚本、专测、search 指标补齐、live-check 扩展。
前置：C1–C3 离线通过。
离线命令全部无需 DSH/key/网络；--offline 会把动态能力列 unknown，但断言失败出口必须真实可复现。

~~~powershell
node --test whale-unify/memsys/test/p3-c4-boundaries.test.mjs
node whale-unify/memsys/scripts/acceptance-boundaries.mjs --offline --out whale-unify/_build/artifacts/p3/boundaries.json
~~~

期望 P3_C4_OK cases=12 fail_closed=true；BOUNDARIES_OK offlinePassed=true livePassed=false，生产能力另按有效证据填写。
离线报告每项给 testName、错误码、保留数据位置、恢复入口及未启开关；不能只填笼统“人工处理”。
以下单列真宿主命令，不放进 npm test；缺 profile/key/身份能力要非零并写具体 gate，不 skip：

~~~powershell
node whale-unify/memsys/scripts/live-check.mjs --case plan3-tools --profile memsys-plan3-probe
node whale-unify/memsys/scripts/live-check.mjs --case plan3-owner --profile memsys-plan3-probe
node whale-unify/memsys/scripts/live-check.mjs --case plan3-dream --profile memsys-plan3-probe
node whale-unify/memsys/scripts/live-check.mjs --case plan3-context --profile memsys-plan3-probe
node whale-unify/memsys/scripts/acceptance-boundaries.mjs --require-live --evidence-dir whale-unify/_build/artifacts/p3 --out whale-unify/_build/artifacts/p3/live-boundaries.json
~~~

tools 期望实际调用 dream_record/organize/review_get/feed 及既有工具成功；日常调用 dream_record 必拒，不能只看工具列表。
owner 期望真实输入绑定、hash/版本/nonce 拒伪、确认与撤销读回；仅诊断身份夹具不能登记生产 owner passed。
dream 期望受控独立会话唤醒后读主库、写梦、退出，execution=completed；没有产物记录 missing/skipped，不能通过。
context 期望双窗口隔离、下一轮更新、梦独立区、撤销退出 S；H/tokenizer/K/独立回执分别报告，缺任何一项不启完整器官。
各 case 只在自身断言通过时 LIVE_CHECK_OK；delivery 无独立回执始终 unknown，不能为通过 --require-live 造回执。
探针从临时 ASCII 包副本安装，不允许指向工作区的 junction/symlink/硬链；重建前核链接，清理只删受控目录项。
成功或失败均核探针依赖已移除、原源码 hash 未变；凭据不写命令行、日志、源码或报告；不改生产 auto_inject。
回滚点：P3-C4 前检查点；注销新增适配，能力 failed/unknown 证据保留，默认门禁保持关闭，不回滚业务事实。

### C5：README、report-3 素材与总复核包

交付：包 README、整仓 README 入口、report-3、acceptance 第三批命令、prepare-review、p3-integration。
前置：C1–C4 离线与共用门禁通过；动态未过可以交材料，但必须显著标“未上线能力／未完成差异”，不能写全部验收完成。
README 写安装副本防护、三库边界、工具/角色、梦确认撤销、导入/恢复、feed 默认窗口、能力状态与常见错误。
整仓 README 只更新 memsys 说明和入口，不把旧运行系统替换成已切换的描述；人格、冷记忆和其它桥配置不改。
report-3 按每里程碑列交付文件、命令、exit code、真实用例数、原日志路径/hash、迁移版本/appliedNow、回滚证据。
另外列 decisions 新增项、与 design 的差异、与前两批接口的实际改动、live 状态、生产迁移/切换是否执行。
报告一项没跑就写 not_run 和原因，绝不能复制本文期望输出当证据；owner/key/凭据内容不入报告。
prepare-review 只收材料与 hash，不调用任何模型、不启动新一轮逐批复核；总复核由约定角色执行。

~~~powershell
node --test whale-unify/memsys/test/p3-integration.test.mjs
npm --prefix whale-unify/memsys test
npm --prefix whale-unify/memsys run build
node whale-unify/memsys/scripts/check-bom.mjs
node whale-unify/memsys/scripts/migrate.mjs --data-dir whale-unify/_build/test-data/p3-final --json
node whale-unify/memsys/scripts/migrate.mjs --data-dir whale-unify/_build/test-data/p3-final --json
node whale-unify/memsys/scripts/check-db.mjs --data-dir whale-unify/_build/test-data/p3-final
node whale-unify/memsys/scripts/prepare-review.mjs --reports whale-unify/_build --out whale-unify/_build/artifacts/p3/review
~~~

期望 P3_INTEGRATION_OK chains=4 modules_detachable=true，TAP fail 0/skipped 0；BUILD_OK、UTF8_OK BOM=0。
迁移两次终态 8/4/2，第二次 appliedNow 各库 []，完整性全部通过；REVIEW_BUNDLE_OK 附真实未闭合 gate 清单。
prepare-review 必须读齐 design、plan-1/2/3、decisions、report-1/2/3、acceptance、源码/SQL 与验收日志索引。
缺任一必需报告或日志 hash 不符则 review_material_incomplete 非零；未通过但有真实记录的动态项可打包为 unresolved。
四条集成链固定：旧源导入→精确门牌→查询；梦→主人确认→完整提升→撤销→新 S 排除；梦 typed grouped 全页取回；feed 无入库→后续真读才观察。
拔件集成关闭梦调度/浮现/考试/骨架，仍验证原输入采集、self note、期限退出、控制恢复和旧工具检索。
回滚点：P3-C5 前源码／文档检查点；报告只更正事实并保留原证据，不删失败日志，不用打包成功替代实现通过。

## 9. 验收补充：不可偷换的几个集合

梦确认 evidence 中 source=dream 观察只作 derived 命题锚点，不计独立现实依据；支持依据另列 owner/合格现实 observation。
确认快照逐项保留 role；独立性检查只接受专门的现实依据集，不能因主库 FK 需要命题观察就误收它作为证据。
快照必须保存主库候选完整字段及字面默认值，不能依赖恢复时新版本默认值；缺字段返回 snapshot_incomplete，不自动修成成功。
沿 decisions #27 保留既有 evidence={ref,kind,hash}，确认计划另附 revision/span/role；不把旧 ref 改名覆盖，适配器显式映射。
memory 审计字段延后冻结不影响完整候选快照；其子任务 first-attempt 生成值一旦固化，重启必须复用。
inferred 候选不进入主库候选列表；梦命题观察不走普通 capture；同原话不同来源身份不被文本 hash 合并。
事实 S、待确认 D、梦目录、项目 Overview、P_h/P_s、expected/eligible/deferred 分列，typed IDs 不能误作 memory IDs 计曝光。
恢复不得替主人产生新语义裁决；失效确认可撤去主动请求或标取消，但保留旧事件及为何未补主库。
旧列补账不是注册／rekey：缺原证据时仍 blocked，不能为让确认测试通过批量把历史 binding_status 设 accepted。
生产迁移真实计数、发布窗口、系统日期均从运行取得；离线造数和固定时钟必须在日志标 fixture。
本图指定 main-007 的新增列与 origin_mode 是实施存储方案，不改变规范只追加边界；旧原文/hash/事实字段保持。
本图没有替生产批准 dream 调度、due 策略、场景扩大或迁移切换；离线模拟批准不能迁入真实 capability_report。

## 10. 图末自检与交付口径

| 自检项 | 本图结果／核验位置 |
|---|---|
| 输入是否完整读取 | 任务、design 全文、plan-1/2、decisions、report-1；开篇标明失效节号的实际对应 |
| 每里程碑是否有命令与期望 | §8 C1–C5；每项均有交付、前置、完整路径命令、输出及回滚点 |
| 迁移是否不动旧编号 | §2；新增 main-007/008、control-004、dream-002，旧 main-001–006 等 hash 保护 |
| schema 与内容幂等是否区分 | §5.3 与 C1/C2/C5；两类 appliedNow 分列，重复运行均无新增 |
| 梦库是否越权 | §4；dream 内容限定角色，确认归 owner，inferred 不进 S，主库只走白名单 |
| 是否伪造独立证据 | §4.2、§9；模型/梦/未归组/unknown 排除，命题 FK 锚点不算现实依据 |
| 跨库是否假称原子 | §4.3/4.4；先梦确认快照、再命题观察、再主库六步，步骤计划持久并可取消 |
| 迁移失败策略是否齐全 | §5.4；备份、双 hash、完整性、降版本拒绝、隔离恢复及增量保护 |
| 改动清单是否完整 | §3.1 单列已验模块与回归；新增 schema/业务/脚本/测试/文档均有归属 |
| 离线与动态是否混在一起 | §8 C4 分两组；unknown 明示不通过，不把真宿主放 npm test |
| report-1 边界是否逐项处理 | §7；工具动态 gate、主题列补齐、确定证据分、第二批 pending-due 前置 |
| 未根治项是否有出口 | §7 两张矩阵；明确拒绝、deferred、恢复、指标 unknown 和未实施动作 gate |
| 依赖与范围是否越界 | 仅 Node 标准库/node:sqlite；不改外部 surfcore，不做图推理或生产切换 |
| 总复核材料是否可追溯 | C5；三批报告、决定、源码/SQL hash、测试日志、真实未闭合项齐备 |
| 静态检查是否冒充实现验收 | 不冒充；本轮只验本图结构/编码/输入完整性，实现与宿主验收由施工后执行 |

静态检查通过：622 行（要求 400–650），严格 UTF-8 解码成功、无 BOM／替换乱码；13 张表无空项或错列，围栏闭合，C1–C5 均有交付、前置、验收命令、期望及回滚点。任务、design、plan-1、plan-2、report-1 的 SHA-256 未变；decisions 并行新增 #17–30 已重读纳入。本轮未执行实现测试、迁移、真宿主验收或生产切换。
