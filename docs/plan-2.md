# 第二批施工图：自我记录、判断账、项目概览与待确认惦记

本图只交付施工方案；唯一行为规范是 `memsys-design-v0.38.md`，第二批范围以任务文件的 B1–B5 为准。
已完整读取 `codex-task-plan2.md`、`plan2-request.md`、设计 v0.38 全文、`plan-1.md`、`decisions.md`、`contract.md`。
另核对现有迁移、repositories/replay、record/schema、authority/topic、due/review 和提升调用点。
复核期间 decisions 新增 #10–#16，已重读并纳入；另读 env-facts 的探针安装防护和新落地的注入 schema。
本图的命令、文件和期望输出是 builder 必须交付的验收契约，不表示它们已经实现或验收通过。
时长均为规范策略参数；测试用受控时钟推进，不报告虚构发生时刻。
只新增本文件；不修改实现、设计、契约、第一批图、人格、冷记忆、交接卡。

## 1. 接续边界与不可推翻的决定

本批 M1–M5 是批内编号；提到既有里程碑一律写“第一批 M1”等。
前置是第一批 M1–M5 收尾且主管持有对应验收证据；读到的现有文件仅能证实部分模块存在，不能代替收尾证据。
第一批注入／工具模块尚未交付时，本图仍可审阅；builder 不得自行新搭另一套注入器官填空。
复用包 `whale-unify/memsys`、三库路径、node:sqlite、ESM、系统时钟、事务、可靠提交、来源图、分页和快照。
不新增 npm 依赖；不施工梦内容、定时反思、考试、图谱、feed、旧库搬迁或通用实体管理界面。
项目／惦记所需主人绑定操作是 B3/B4 的必要接线，只开放下文动作白名单，不顺手开放通用纠错／注册／合并。

| 已定事项 | 本批不可改变的执行方式 | 回归要求 |
|---|---|---|
| decisions #1 | SQLite 一致性备份用停写屏障下 VACUUM INTO | 活动 WAL 中数据在备份可读 |
| decisions #2 | 源码在 _build/backup；三库在 data-dir/backup；checkpoint 支持 --out | 测试检查点写测试目录 |
| decisions #3 | dream-001 只保留 db_marker 占位 | dream 版本仍为 1，不加梦业务表 |
| decisions #4 | 补写前先 complete 原 missing/unknown 尝试，再 reserve 下一次 | 同对象最多一个在途 |
| decisions #5 | 业务事务抛错只收尾 unknown，不即时重新执行业务 | 六步失败不二次执行，恢复按原操作核验 |
| decisions #6 | candidates.reason 不可变；归档／并存原因只在事件 | UPDATE reason 仍被拒 |
| decisions #7 | resolved 无旧条直接提升，同键同值只进审核 | 本批 judgment 接线不改变此分流 |
| decisions #8 | both/global 扩场景仍 pending + 提案 | 新工具不靠项目或来源扩大权限 |
| decisions #9 | timeline 只 ongoing→ended_unknown；pointer exact 要位置 | 不借本批完善时间或门牌功能 |
| decisions #10/#11 | 保留 spec.hooks 六处断点与 deps.commitHooks 透传；control 回执失败返回 unknown/controlReceipt=failed | 新写端复用故障钩子，不把业务成功当整次成功 |
| decisions #12 | injections 主库、deliveries 控制账分别提交 | 跨库不宣称原子；恢复重核真实回执 |
| decisions #13/#14 | K 实测；H=1 可能先 overflow；无 tokenizer/H 为 tools-only、section=null、level=unavailable | 测试从测量值构造 grouped 预算 |
| decisions #15/#16 | auto_inject 默认 false；探针 diagnostic_section 才注册；组头三件套完整 | 不开生产注入，不用含混省略句代组头 |

### 1.1 迁移编号冲突的明确处理

第一批图 §2、§4 已分配 `main-003.sql` 给 injections/uses，`control-002.sql` 给注入快照及容量账。
本任务“main-003 起”的含义落实为从既有 001/002 之后接续，绝不覆盖已分配的 003。
编号固定如下；不依据目录里暂时缺文件就抢占编号，不运行降版本迁移。

| 文件／编号 | 归属与交付点 | 新增对象／约束 |
|---|---|---|
| main-001、main-002、control-001、dream-001 | 第一批原件 | hash 必须不变，不改 SQL 或触发器 |
| main-003、control-002 | 第一批 M4 前置 | 原 injections/uses 与快照结构；本批不重写 |
| main-004.sql | 本批 M1 | self_notes 表、只追加触发器、幂等与读取索引 |
| main-005.sql | 本批 M2 | judgments、speculations、judgment_current 只读视图、judgment 引用 INSERT 校验 |
| main-006.sql | 本批 M3 | projects 表、只追加触发器、project-update 版本唯一索引 |
| control-003.sql | 本批 M3 | 给既有快照追加 manifest_json、容量账追加 due_report_id/protection_details；不建第二套快照 |
| 本批 M4/M5 | 无额外迁移 | due/review/state/relations/config 和 control 快照结构沿用 |

本批不增加既有事实表的可变列；judgment_id 已存在，只补新写引用检查，不回填旧行。
control-003 三列均为可空 TEXT（JSON 列服务验证），旧行 NULL 表示 legacy 未记录，不伪造历史 manifest/容量报告。
新编译必须填 manifest_json={eligible_ids,actual_ids,expected_ids,deferred_groups,hashes,typed_items}，随编译冻结且不 UPDATE。
protection_details 存三维 limits/remaining、退让 before/after、policyRevision；due_report_id 指主库报告事件，不伪造跨库 FK。
snapshot_items.memory_id 现为无外键 TEXT：保留列名兼容，用 opaque typed ID 装审核／项目，服务不得把它们当 memories 查询。
新增表及视图字段见 §4–§6；relations 仍是唯一事件账，state 仍是可重建投影。
main-005 仅给 candidates/memories 新 INSERT 的非空 judgment_id 加存在性触发器，不改旧不可变触发器。
main-006 唯一索引为 project-update 的 JSON projectId、revision 组合；类型限定的部分索引不约束其它事件。
既有 relations 没有 payload_hash 列：本批按规范 JSON 现场计算比较，完整 hash 同时固化在 operations，不 ALTER 历史行。
迁移前后记录全部已有 SQL 的 SHA-256；重复迁移必须 appliedNow 为空，已有 hash 不符拒绝启动。
离线迁移验收同时覆盖第一批终态库升级与全新库；最终版本固定 `main=6 control=3 dream=1`。

## 2. 文件交付与复用契约

以下相对路径均从 `whale-unify/memsys/` 起；新增文件职责不可挪到 index 单文件堆积。
第二批新增文件预算为 21 个：4 个 SQL、11 个业务／读工具模块、6 个测试文件；不含运行产物。
测试预算为 76 个有独立行为断言的场景（M1 14、M2 18、M3 14、M4 18、M5 12），允许合理合并，不把数量当验收。
不为凑条数重复实现同一函数的镜像测试；每项必须覆盖表中行为与至少一个反例。

| 新增文件 | 职责 | 交付 |
|---|---|---|
| src/storage/migrations/main-004.sql | self_notes schema 与追加保护 | M1 |
| src/storage/migrations/main-005.sql | judgments/speculations、两列视图及引用约束 | M2 |
| src/storage/migrations/main-006.sql | projects schema 与快照唯一 revision | M3 |
| src/storage/migrations/control-003.sql | 沿用控制快照，补持久 manifest 和保护容量详情列 | M3 |
| src/write/self-note.mjs | 自我原文、修订关系、显式反省引用 | M1 |
| src/write/judgment.mjs | judgment/speculation、outcome/verdict、窄义工具结果 | M2 |
| src/write/judgment-review.mjs | 主题碰撞、老化、needs-review 与默认退出 | M2 |
| src/write/owner-actions.mjs | B2/B3/B4 必要提案／绑定回执，动作白名单 | M2 起，M3/M4 扩白名单 |
| src/write/project.mjs | 身份、首快照、完整更新、选择与来源继承 | M3 |
| src/write/due-actions.mjs | 确认／恢复／完成／提及、due-policy-v1 与报告 | M4 |
| src/context/pending-due.mjs | 同快照待确认选择、机械排序、审核分区 | M4 |
| src/read/self.mjs | 三种自我对象原文与事件，复用 pager | M1 起 |
| src/read/project.mjs | 身份、有效概览、版本历史，复用 pager | M3 |
| src/tools/self.mjs | memsys_self_get schema/handler | M1 |
| src/tools/project.mjs | memsys_project_get schema/handler | M3 |
| test/p2-m1-self.test.mjs | self note 与 main-004 升级 | M1 |
| test/p2-m2-judgment.test.mjs | 两列结果、反省／裁决／老化 | M2 |
| test/p2-m3-project.test.mjs | 项目版本、授权与来源有效性 | M3 |
| test/p2-m4-due.test.mjs | 待确认召回、确认边界及预算接线 | M4 |
| test/p2-m5-replay.test.mjs | 四类事件、历史兼容、幂等与重建 | M5 |
| test/p2-integration.test.mjs | 五块串联、拔件、升级恢复 | M5 |

### 2.1 需要改 M1 已验收模块（第一批 M1）

这份清单是实际修改许可边界；新增 SQL 不代表允许重写第一批存储底座。
未列文件若施工发现必改，先在交付 diff 中明确原因与回归项，不能藏成格式化改动。

| 已验收模块 | 必须改什么 | 不可破坏／回归 |
|---|---|---|
| src/storage/repositories.mjs | appendRelation 同键比较规范 payload 和版本；新增三类对象参数化取回 | 旧 dedupe/id 不改；同键异文必须冲突 |
| src/storage/replay.mjs | 分类型折叠自我关系、两列判断、项目、due/review/提及 | 原记忆终态优先、候选终态不复活 |
| src/contracts.mjs | 新对象／事件枚举、字段、错误形状 | 原 kind 与旧错误含义保持 |
| src/identity.mjs | 新事件业务键构造器与稳定 kind 命名空间 | 不更换已有对象 id/hash；canonicalJson 不改检索式归一 |
| test/m1-storage.test.mjs | 隔离旧 schema 断言与当前迁移断言，加入共享 helper 回归 | 原 24 项行为不删除；版本常量变化须说明 |

`storage/open.mjs、migrate.mjs、backup.mjs、control/ledger.mjs、commit.mjs、readback.mjs、clock.mjs` 无计划改动。
新服务用既有 commitControlled 的回调扩展目标读回，不另改三败算法；若其接口不足，报告具体阻塞，不做平行提交器。

### 2.2 需要改第一批已验收模块（其它阶段及第一批收尾后模块）

| 文件／模块 | 本批接线 | 必跑回归 |
|---|---|---|
| write/authority、tools/schemas、tools/record | 按 kind 判角色；三类自我对象；严格字段分支；verdict.by 窄例外 | 第一批 m2 的拒权、来源及旧入口 |
| write/observe、candidate、promote、topic、origin | 原输出保全、judgment 引用、共享有效主题、项目实体来源、四事件生产端 | 六步原子性、未归组、同键同值、来源传染 |
| write/review、write/due | needs-review 到期、四事件完整 payload、受控 due 生命周期 | capture/coexist、100 条上限及默认归档 |
| control/recovery、test/helpers/worker | 新操作按已固化目标恢复；追加故障场景 | 第一批 m3 的第三次 found／冻结及并发 |
| context/select、rank、budget、compile、snapshots、delivery | 项目硬保护、待确认审核域、typed manifest、原预算和回执 | 第一批 m4 的 S、12 组、K、未知投递 |
| read/review、read/pager、tools/read | needs-review/due 报告与新对象分页共用封装 | 第一批 m5 的长正文、跨页、重启、stale_cursor |
| runtime/session-events、identities、tools、index | 主人完整命令白名单；启动／输入扫描；新工具注册 | 真实 log 通道、会话隔离、卸载 disposer |
| scripts/live-check.mjs | 增加 plan2-context 用例、覆盖新工具注册与实际调用 | 第一批 probe profile 不改生产配置 |
| test/m2-write.test.mjs、m4-context.test.mjs、m5-tools.test.mjs | 把第一批“本批不支持”的断言限定旧能力配置，新增启用断言 | 不删未授权仍拒绝的反例 |
| test/helpers/runtime、fixtures、faults | 隔离身份、可信回执夹具、时钟／预算／崩溃注入 | 不把测试回执写成生产 capability passed |

scripts/build/test/check-bom 自动枚举新文件则复用原样；package.json 不增依赖；不改 persona 或外部插件。
原 context S 查询继续只查 memories；新增对象不能用 UNION 混进事实表伪装已接线。

## 3. 共用写入、授权、证据与读取契约

record 顶层仍 `{kind,items[1..20],request_id?}`；嵌套 schema 按 kind 分支，全部 additionalProperties=false。
审计时间入参先剥除并记违规；其它禁填权限字段拒绝。模型 request_id 只作相关标记，稳定身份来自 runtime。
callId 必须跨重启稳定且带会话命名空间；缺失不回退到常量 call／当前时间，返回 runtime_identity_unavailable。
self_note/judgment/speculation 业务键 `<kind>:<稳定调用id>:<项槽>`，ID 用原 objectId 前缀与全 SHA-256。
数组型证据只存规范 ref 集；需要 hash/span 的事件另存精确证据描述，不能只靠人可读标题定位。
同键重试先读原 operations 的生成值，at/state_snapshot/origin/目标事件集合全部复用；同键异文 idempotency_conflict。
新对象公共列：id TEXT PK、idempotency_key TEXT UNIQUE、at TEXT、payload_hash TEXT、origin 非空 JSON。
self_notes/judgments/speculations 另含 state_snapshot JSON、initial_strength REAL [0,1]，一律不可变。
原模型输出先独立 source=model、author_kind=model observation 并 found；业务失败不丢原输出，不生成用户 capture。
新 kind 的 basis_refs/evidence_refs 为非空字符串 ID 的数组（数组可空按 kind 判定），只引用已持久对象；id 前缀／库内类型由服务核验。
来源解析复用原 origin resolver；版本化对象须引用其不可变事件／快照 id，不用 projectId 代替最新证据版本。
服务在首次 operations 固化 evidenceSnapshot=[{id,kind,revision或null,payloadHash,source_span或null}]，核实际字节与指定版本；读取失败不能降成空集合。
这些对象的 basis_refs/evidence_refs 是指针集合，不往只支持 memory/candidate 的 evidence 表塞伪目标。
新增对象 origin=实际依据来源并集 + model runtime；主人依据不消除模型作者，已知梦分支不因其它来源正常而消失。
ref 不存在报 validation_error；无法读取报 unknown；已知梦素材可留自我对象并标 from-dream，但不能自动提升事实。
无外部依据允许 basis_refs=[]；仍有 model 来源。缺材料不自动补“工具执行过”的证明。
每个业务动作经原 commitControlled：control 固化／reserve → 主库事务 → 提交版本精确读回 → control complete。
新增事件与相应投影同事务；事务里不调模型、不发消息、不持锁等外部执行；业务抛错遵守 decisions #5。
业务验证失败尽量在 reserve 前报告；锁内竞争失败回滚后也不伪装 found，不吞失败控制记录。
object_key 绑定逻辑目标：修订目标/判断 id/项目 id/惦记 id；不随 revision、payload 或重试号换流避冻。
新对象按原 kind 键确定自身流；附带修改旧对象的修订操作须同时校验旧对象版本／关系，保持同事务。
原 CommitReceipt 字段不换名；额外返回 revision、eventIds、projection 时，不把 cached 状态当直读结果。

### 3.1 本批最小主人操作通道

复用 `propose_owner_action` 保存 pending 完整 payload，受信原话仍先 observation；只接受宿主绑定 owner 身份。
无面板使用整条 `/mem accept <proposalId> <payloadHash>`；引文、转贴、模型工具参数、自由句“对”均不授权。
owner-actions 生成 approval-receipt 事件：receiptId、ownerId、proposalId、action、payloadHash、targetIds/baseVersions、nonce、inputEventId。
唯一业务键为受信 inputEventId+proposalId；nonce 由服务固化，同一 nonce 只消费一次；重复原请求返回原回执。
该事件是主库 relations 内授权元数据，不是新增权限来源；pending-resolve 与执行动作、投影同事务。
未关闭提案、准确 hash、目标版本、身份和动作白名单都在写锁内复核；任一过期返回 stale_proposal，整笔不写。
允许动作：master-verdict／其撤销、project-create/select/update/complete、due-policy-approve、due-confirm/restore/done/mention/batch。
`project-complete` 只批准精确项目快照的整体完成含义；`project-update` 是生活窗口对该次 payload 的授权。
due 专有固定命令见 §7，同样生成绑定提案及回执；不因新通道存在就开放 corrected/demote/梦确认／通用 rekey。
主人回执不清洗来源链，不代写 self note，不替代 due-policy-v1 批准。
授权通道不可验证时保留提案，动作 executed=false；离线可用可信 fixture 验逻辑，动态能力保持 unknown。

### 3.2 新读取工具

| 工具 | 参数 | 返回 |
|---|---|---|
| memsys_self_get | kind=self_note/judgment/speculation 必填；ids[1..10] 可选；view=current/history、cursor、max_chars | 原文、来源、快照、相关事件；judgment 返回分开的 outcome 与 verdict |
| memsys_project_get | projectId 必填；history:boolean 默认 false；cursor、max_chars | 身份、四项概览、headRevision/effectiveRevision、证据、来源、历史页 |
| memsys_review_get 扩展 | kind 增 needs-review；保留 due-history；ids 与 kind 二选一 | 未复核标记、到期依据、due 四态计数与可执行确认／恢复入口 |

分页沿用第一批 1000..16000、默认 8000 码点，完整序列化计量、字段分片、持久 cursor；不是截断后半正文。
显式 ids 在 current 也返回旧笔记／失效项目版本状态；列表 current 只列当前分支，history 全部可读。
主人可读全部 self note；模型主动复盘可读，dream/maintenance 只读不增 uses；查询不触发自动事实注入。
新增工具只读自我／项目对象时不记 memory lookup、不改 uses/F；依据全文另由 memsys_get 的原规则计数。

## 4. B1 self note：原文、作者与分叉

| self_notes 字段 | 类型／约束 | 来源／可变范围 |
|---|---|---|
| 公共身份、origin、快照列 | §3 公共列；idempotency_key UNIQUE | 首次尝试固化，只 INSERT |
| observation_id | TEXT FK observations，NOT NULL | 必须 source=model/author_kind=model |
| text、reason | 非空 TEXT，保留原字节 | 模型独立成文，不能主人代填作者 |
| basis_refs | JSON ref[]，可 [] | 核实实际引用，不复制依据正文 |
| author_runtime | JSON {role,sessionId,callId,identity} | 受信 daily/dream 模型；owner/maintenance 不能直接写 |
| reflection_judgment_ids | JSON string[]，默认 [] | 显式反省目标，只产生 needs-review |

supersedesId 是请求字段，不在 self_notes 增 supersedes 可变列；关系只在 relations。
M1 实现 self_note 与 memsys_self_get；reflection_judgment_ids 非空到 M2 才启用，M1 返回 dependency_unavailable，不静默丢引用。
无心得允许调用方报告 skipped；服务不自动填空模板、不自建反思调度器，关闭做梦后日常 self note 仍可写。
普通写：model observation found → 新笔记＋必要 needs-review → 精确正文/依据/事件读回。
修订写：新增笔记＋supersede 同事务；payload={targetType:self_note,oldId,newId,reason,authority:{role,authorRuntime},oldRevision}。
supersede 业务键=oldId+newId；只限同一自我身份的 self_note，不借此开放普通 memories 取代。
排序使用 commit_seq、ordinal 的二元组比较，不按 at/start，也不把 seq×常数作为无界安全比较。
新笔记必须在系统提交顺序上晚于旧笔记；重试复用已提交边，允许不同新 id 同指旧 id。
禁自环、跨类型边、逆写入顺序边；成环请求追加 conflict 记录尝试，supersede 不生效，原笔记仍可查。
同旧篇两个合法新篇都保留 current 分支；不让“最后写入”吞另一篇，不删除旧原文。
有明确 judgmentId 的反省仅 needs-review；self/wrong 须另调 verdict 或受控原子组合，不能读 text 猜否定对象。
本批默认采用两个显式工具调用，不扩展异构 actions 批协议；needs-review 随笔记同事务落账。
抽成候选必须走原 candidate 服务且保留 self/model 全来源；笔记不是主人事实，也不自动进 S／审核正文。
自动编译不得扫描 self_notes 输出标题、摘要或条数；用户主动 self_get 才返回指定对象／分页列表。

## 5. B2 judgments、speculations、outcome 与复核

### 5.1 数据形状与两列存储

| 对象／字段 | 约束 | 可变范围／读取 |
|---|---|---|
| judgments 公共列＋observation_id | §3 公共身份／快照，model observation FK | 原始判断整行只追加 |
| at、phase | 系统时间；work/life/null | null 不自动作为跨场景可见 |
| verdict_text、basis、falsifier | 非空 TEXT | 结论、依据、可推翻条件不可覆盖 |
| evidence_refs、evidence_origin | JSON refs 与实际依据来源图 | 与含 model 的整体 origin 分别保存 |
| topic_key、topic_components、registry_revision | 服务生成，正式五元组或 unresolved | 保留原键，不接受模型直接传 key |
| key_status、binding_status、binding_basis | resolved/unresolved；proposed/accepted；JSON | 初始模型绑定 proposed；有效键读原共享投影 |
| outcome | pending/done/reverted/failed，初始值不可变 | 后续 outcome-change 折叠，不 UPDATE judgments |
| proof_scope | 初始结果证明 JSON 或 null，done 必填 | 同 §5.2 的范围结构；原始证明只追加 |
| speculations 公共列＋observation_id | 同 §3；model observation FK | 只追加 |
| speculations.text、basis、falsifier | 非空 TEXT；basis 必须写明有序推断步骤及每步依据 | 不用标题替代推断链，不作事实认证 |
| speculations.basis_refs、linked_judgment_ids | JSON refs[]、judgment id[]，默认 [] | 核引用，不自动反省／裁决 |
| state.judgment:<id> | JSON {outcome,outcomeRevision,verdict:{id,by,result,at},needsReview,unreviewed} | 事件投影；可重建 |
| judgment_current SQL VIEW | id、outcome、verdict_result、outcome_revision、verdict_id | outcome 与 verdict_result 是两个独立查询列 |

视图通过 judgment 原行与 state 投影取值；没有 verdict 时 verdict_result=NULL，不假造 pending 事件。
对外返回仍分 `outcome` 与 `verdict.result`；NULL 表示尚无裁决，pending 是实际裁决枚举，二者不混。
初始 outcome 可四态，但 done 也必须有 §5.2 的证明；新调用不可用初始 done 绕 outcome_change 校验。
创建 judgment 只需自身证据，不要求先有 memories；speculation 无自动 candidate/promote 分支。
第二档 candidate 可给 judgment_id 引用已存在判断；需要同时新建时用 candidate item 的 judgment 草稿嵌套分支；两者互斥。
草稿含 judgment 必填字段，稳定槽为候选槽下固定子槽；候选＋证据＋judgment 同事务、每候选一个 SAVEPOINT。
新增判断原输出仍先独立保存；后续失败三者全回滚；提升复制 judgment_id，不把判断结论写成 quoted。
candidate 去重的完整语义 payload 纳入 judgment 引用／草稿；同原语义仅补材料走新候选 derived，不能改旧 judgment_id。
第二档不能漏判断，超过两步推断进 speculation；步数与语义由模型自检，服务只验证字段和角色。
judgments 不进入 S；需要时仅其 active needs-review 进入审核目录，明确“判断待复核”，不能算记忆事实。

### 5.2 outcome-change 与窄义工具结果

请求 `{judgmentId,baseRevision,from,to,why,evidence_refs,proof_scope}`；outcomeRevision 初始 0，成功事件后 +1。
proof_scope 形状为 `{kind:command/object,operationId,objectId?,objectVersion?,ruleRevision?,resultRef,resultHash}`。
to=done 必须非空证明对象；其它状态也留证据与 why，可明确证据不足，不能自动宣称正确。
事件 payload 加系统生成 semantic_status、requestId、itemSlot；业务键 judgmentId+requestId+itemSlot。
同键重放优先直读原事件，再做新写版本比较；已成功请求不能因后续版本变化误报 stale。
新请求锁内核 from 与 baseRevision，失败返回 stale_outcome 和当前版本，不追加半个事件。
允许 pending→done/failed/reverted、done→reverted、failed→pending/reverted、reverted→pending；同态新请求拒绝 no_state_change。
failed/reverted 后重试先显式回 pending；真实翻案另有 verdict/wrong，outcome=reverted 自身不等于判断错。
自动 registered_tool_outcome 仅供受信工具包装器，模型 schema 不暴露可伪造的机器结果入口。
包装器在执行前持久绑定 operationId、judgmentId、proof_scope；结果返回后取真实结果 observation，不执行第二次外部命令。
exit_code=0 只证该 operationId 命令 done；非零为 failed；结果缺失为 unknown，不从自然语言“成功”猜退出码。
真实机器证明可给 accepted 窄义结果；模型解释结果仍 proposed；两者都不能证明整个项目完成。
一个 operationId 的同一原始结果回调稳定生成一个 requestId/项槽；重复回调只有一个 outcome-change。
后到旧结果遇已 reverted 版本返回 stale，不覆盖；恢复只补账和读回，不重跑有副作用工具。
proof_scope、原始结果 hash、版本或角色不符均拒绝；自动 outcome-change 不生成 right verdict。

### 5.3 verdict、needs-review 与老化

| 事件 | payload 与键 | 权限／效应 |
|---|---|---|
| verdict | judgmentId,by,result,basis,falsifier,evidence_refs,evidenceOrigin,requestId,itemSlot；键=requestId+itemSlot | self/auto 来自对应模型通道；master 必须回执 |
| verdict-void | verdictId,judgmentId,receiptId,reason；键=稳定主人操作 id+项槽 | 本批只开放主人绑定撤销；不删除旧 verdict |
| needs-review | judgmentId,trigger,sourceVersion,why,scene,scope,review_policy,policyRevision,deadline_at,created_input_seq | 键=judgmentId+trigger+sourceVersion |
| review-defer | reviewId,reason,triggerId,policyRevision | 键=reviewId；关闭活动索引，unreviewed=true |

verdict.by 是严格 kind 专用例外：self 只 wrong/pending，auto 可 right/wrong/pending；auto/unverified 只服务老化器。
by 参数表达建议类型，仍须 runtime 白名单验证；其它 kind 的 by/origin/master 禁令保持。
已有有效 master 时 auto 只准 pending，不能覆盖主人结论；self 也不能压过 master。
折叠排除已合法 void 的 verdict；按 master > self > auto，同层按 commit_seq/ordinal 最新，at 只审计。
主人纠错尚未在本批开放；如存在可信纠错回执适配，只处理回执明确列出的 judgmentId，不能沿图猜否定范围。
新候选／记忆的有效 resolved topic_key 与 judgment 相同只触发 topic_collision；unresolved 不按自由词拼主题。
sourceVersion 固定为来源对象类型/id/已提交版本；候选及其提升记忆是可追溯不同版本，不重复扫描同一版本。
self note 引用触发 reflection，sourceVersion=self_note id/hash；模型 needs_review 触发 explicit，绑定稳定调用 id。
老化触发点：启动、真实输入采集后、维护唤醒；无唤醒能力就启动／输入补扫，不依赖做梦开关。
阈值为 30×24 小时；基准取最后有效 verdict.at，无 verdict 取 judgments.at；当前系统回拨暂停时间触发。
达到阈值且无 verdict：追加服务 auto/unverified；已有 master：不动；只有 self 结论：追加 needs-review。
已有 auto 而非“无 verdict／仅 self”的组合，本批不擅自反复发老化裁决；仍可按新证据显式复核。
老化业务键包含 judgmentId+aging+锚点 verdictId或judgment初始版本，不用扫描时刻生成新键。
已 defer 的同锚点不重开；只有新有效证据版本／新 verdict 锚点才能形成新请求。
needs-review 创建时固化输入序号与普通期限：3 次后续真实输入或 24 小时先到，review_queue 单独索引。
复核优先级按原审核目录；无场景合法来源的 phase=null 复核只主动可查，不泄漏进其它窗口。
到期 review-defer 不改 outcome/verdict，不把“无人反对”变 right；重复扫描及重启结果相同。

## 6. B3 projects Overview：身份、快照与来源

| 对象／字段 | 类型／唯一约束 | 可变范围 |
|---|---|---|
| projects 公共身份列 | id PK、idempotency_key UNIQUE、at/payload_hash/origin | 只 INSERT，创建键=project:主人操作 id |
| name、scene、created_at | 非空 TEXT；scene 固定 work；系统 created_at | 同名允许不同 id，不自动别名合并 |
| approval_receipt_id | 非空 TEXT，引用真实 approval-receipt 事件 | 创建身份必须绑定主人批准 |
| project-update.snapshot | current_task/progress/next_action/blockers，各 string或null | 完整四字段事件，只追加 |
| project-update 元数据 | projectId,baseRevision,revision,evidence_refs,origin,proof_scope,semantic_status,receiptId可空 | UNIQUE(projectId,revision) |
| state.project:<id> | headRevision,effectiveRevision,snapshot,evidence_refs,origin,validity | 只读缓存的持久投影，可重建 |
| state.active_project:<sessionId> | projectId或null、selectionReceiptId、选择版本 | 从带回执 config-change 重放 |

project-create 必须同事务写 projects、首个 project-update(revision=1,baseRevision=0)、回执消费及去重。
首快照默认四项 null；如提案含内容，批准的是这份准确 payload，不由服务补进度。
创建批准同时登记该 projectId 为项目实体／合法项目 scope：registry-change 带同一回执，不注册任意别名。
项目实体只为本项目身份；不把旧 unresolved 记忆批量 rekey，不重建另一份项目注册表。
project-select 绑定 sessionId、projectId、当前版本和选择版本；工作窗口才可自动展示，生活窗口不默认带入。
四项默认最多 80 码点；超长返回 validation_error，保全原输出并请模型另作摘要，不无声截掉条件。
schema 区分缺字段与 null：缺字段沿用，显式 null 清空，空字符串不当 null；读取总返回四项。
锁内 baseRevision 必须等于最新已提交 headRevision；服务分配 revision=head+1，调用方不能指定 revision。
同请求同项目若同字段存在不同值，整项目组 validation_error；不同项目可独立 SAVEPOINT，不按数组顺序覆盖。
同项目兼容变更先确定合并 patch 再生成一个快照；相同 requestId 重试复用首次固化 revision，不再次 +1。
来源继承：任一字段未给而沿用旧值（含 null），evidence_refs 与 origin 都取旧快照并集加本次来源。
即使只改 next_action，也不得用新的干净证据抹去旧 progress 的 model/from-dream 来源。
四项全部显式给出时可形成新完整声明；若仍表示沿用旧进度，必须引用旧快照并继承来源，不能以原值重填洗白。
服务只机械保证缺省字段继承；显式重复值默认保守继承，主人绑定新的独立证据声明才可形成另一个来源完整版本，旧版永久保留。
schema/proof_scope 记录各证明适用字段、命令／对象范围与版本；字符串含“完成”不能触发机械认证。
模型快照 semantic_status=proposed；所有四项以模型报告显示，完成字样显示“模型报告完成，未验”。
工具证明仅给指定字段的窄义证明；项目整体完成需 project-complete 回执绑定完整快照，不能靠 exit_code 升级。
生活窗口 project_update 必须本次 projectId+payload 的回执；工作窗口模型可提进度，但仍是 proposed。
提交前校验项目硬保护容量：更新／选择会扩大当前 P_h 时按三项上限核算，不够保留提案，返回 project_capacity_blocked。
无有效预算能力可保存非生效建议提案，不能偷偷扩大激活项目；初始四空快照与创建身份允许离线保存。
测试向同一预算接口注入 test-only H/tokenizer，生产无能力时 tools-only；不靠“80 字所以一定装得下”。

### 6.1 有效版本与注入

每次读回展开指定版本 evidence/origin；无外部依据的 model 来源为 unverified 但可展示“未验”，不等于来源失效。
缺失／撤销／hash 不符的引用使该版本失效，沿 revision 倒序找最后有效版本；全部失效则四项为空并报告原因。
headRevision 始终是最高提交版本；effectiveRevision 仅展示回退版本，不能把回退版当最新写基线造成重复 revision。
若当前头无效，部分更新不能继续继承失效字段；需基于 headRevision 提交四项明确声明及有效依据，同值替代按上条主人绑定规则，保留无效历史。
来源含梦保留 from-dream 标记，不变事实；无法安全折叠时不能沿用旧 verified 缓存。
工作窗口仅当前获准项目一页四项，作为 P_h 独立 typed 成员，不是 memory，不计 uses、不乘 F。
项目完整快照参加同一预算／manifest；容量下降沿第一批 hard_over_cap/protected_overflow 处理，不静默裁硬层。
project_get(history=true) 给全部版本与逐版有效性，读取旧操作按提交版本核正文／事件，不拿当前回退结果比旧 hash。

## 7. B4 pending-due：审核召回与正式惦记接线

### 7.1 明确选择、排序与分区

待确认集合 D 与 S 分开：active memory、due_state=pending-due、scene/scope 合法、来源可安全折叠且非 from-dream。
shelved-due、pending-done、cooled-due 留 due-history；不能换标题把它们又注入正文。
本批“有条件”指上述状态／来源／场景门禁；不新增任意 R 阈值或 top-N 让其余待确认消失。
D 全量纳入审核目录的“待确认惦记”子区，逐项显“未确认”；没合格成员就不造空栏。
D 不进 S、不进固定栏目、不占 P；状态报告头属于既有 K，不能借计数头把 D 正文塞进硬保护。
排序口径固定为服务可审计的字典序，不声称机器测出了情绪张力：
1. tension_class：有确定 due_at 上界且已过期=2，确定未来期限=1，无确定期限=0；它只表示期限压力。
2. mention：本轮有受信主人目标引用回执=2，有模型明确 evidence_ref/span 指向的 proposed 提及=1，否则 0。
3. recency：本次入队 commit_seq 新→旧；同序以 due_at 上界早→晚、id 升序稳定打破平局。
模型 proposed 提及只影响此排序，不更新 last_due_mention_at、不延期、不获得 confirmed/accepted。
业务时间与新旧分开：due_at 从原 candidate 的有据业务时间取；入队序号不是发生时间。
不臆测无时区字符串；沿用第一批时间区间解析，粗精度比较上界，未知最后。
排序在同一 source_revision/系统读数冻结，分页不按实时钟重新排序；策略名 pending-recall-v1 写编译策略版本。
确认授权仍要求来源／active／场景及容量逐项校验；出现在待确认区不等于可以自动 open。

### 7.2 grouped 报告、计数与回执

D 在既有 scene:review 顶层组下，子组 `due:pending:<memoryId>`；不增加第 13 个顶层组。
full/compressed 下显示审核子区和合格条数；grouped 下 review 组头另给 pending_due_count，页内标 kind=pending-due。
新增审核项使用 typed ID `review:due:<memoryId>`；needs-review 用 `review:judgment:<reviewId>`；避免同 memory id 重复计数。
manifest eligible_ids=S＋普通审核＋D 的 typed IDs＋当前项目快照＋固定段；同一对象不同时落 S 与 D。
deferred_groups 保存全部未展开 D，expected_ids 只列实际项或组描述；遍历 context_get 必须一条不漏。
状态头分别报场景可见的 pending-due/shelved-due/pending-done/cooled-due 数量，D 合格数另列，二者语义不同。
不合场景不泄漏条数；来源不合格的 pending 只在授权主动报告看原文及原因，不强塞自动 D。
K 重测真实序列化后的计数、typed ID、命令与游标最大开销；原软／硬账、P_h/P_s 上限不改。
待确认条目和项目均不是 injections 的事实曝光；typed 审核项即使有真实回执也不记 memory used/unused。
查 due-history 的正文仅在实际日常返回时按原 memory lookup 计一次；目录、扫描与组头不计。
旧 snapshot 继续返回旧 D，确认后新快照才移到 S/P_s；不能在翻旧页时把状态换成新版本。
无真实 H/计量器／逐轮能力时 tools-only；缺回执 delivery=unknown，不能将本地 grouped 成功当主人已见。

### 7.3 确认需要的最小完整 due 闭环

B4 验收要求“确认后转正式惦记”，必须实现原规范 open 的出口与容量，不能只改 pending→open。
以下均是 B4 依赖，不新增其它记忆整理功能；生产启 open 前须真实主人批准完整 due-policy-v1。
未批准只召回 pending、保留确认提案；离线夹具可批准测试策略，不能把测试批准带入生产。
本批入口开放 pending 确认及必要恢复／完成／提及／批次；全新 /mem due 和面板亲建不施工，明确 unsupported_in_batch。
仅收完整受信消息：/mem due-confirm <id> <revision> <payloadHash>、/mem due-restore <id> <revision>。
收口命令为 /mem due-done <id> <revision> <done或dropped>、/mem due-mention <id> <revision>。
批次为 /mem due-batch <reportId> <payloadHash>；所有命令先建相同绑定提案／回执再执行，不信模型复述。
due-state payload={memoryId,baseRevision,revision,from,to,reason,evidence_refs,policyRevision,receiptId或triggerId,reportId,dueProjection}。
dueProjection 完整保存 ownerIdentity、enqueued_seq/at、opened_at、last_due_mention_at、deadline_at、lastEvidenceVersion、归档原因。
沿用 state.due:<id>；due_queue 只是它的现有列物化索引，memories 只改 due_state/due_done_at。
deadline_at 是系统策略到期，不是 due_at；旧 due_queue.deadline_at 的业务值不再作老化权威，按原 candidate 和入队证据重建。
每次状态转换 revision+1，版本竞争先提交胜；确认对已归档旧版本返回 stale_proposal，不补做 open。
来源、active 或预算不合格时保留 pending，不能用 receipt 洗掉梦／扩大场景／绕过原未归组权限。
未归组可被主人确认惦记，但仍不得参与 supersede/裁决/梦确认；due 确认不是 rekey。
同主人跨窗口 pending 上限 100，本次入队满 14 天转 shelved-due；恢复 shelved 只回 pending 并重算入队，需另确认。
身份从原受信观察／操作追溯；不能沿用现有 due cap 查询忽略 identity 的参数，按所有者聚合再限额。
due-policy 白名单与出口如下：

| 起点／触发 | 终点／限制 | 持久证据 |
|---|---|---|
| pending-due + 合法确认 | open，初始化 opened_at/提及锚点 | 主人回执、容量报告及 proof_scope 绑定 |
| open + 绑定完成信号 | pending-done，退出 P_s，非 done | 完整受信目标原话或 proof_scope 对应注册项目证明的新版本 |
| open 超期沉寂 | 有到期上界：过期且无受控提及各 30 天；无日期：open 且无提及各 90 天→cooled-due | 上界、锚点、规则；模型完成报告无效 |
| open + 容量压力 | cooled-due，reason=capacity；近期／未来到期也无豁免 | 先落报告和可见通知，再退出 |
| pending-done 无确认／证据失效 | 14 天→cooled-due；失效立即 cooled-due | 完成待核标记与失效依据保留 |
| pending-done/cooled-due + restore | 有容量且回执有效→open；重设锚点 | 不再消费同一旧完成证据 |
| open/pending-done/cooled-due + due-done | done/dropped；仅 done 盖 due_done_at | 主人逐目标回执；自动路径禁止两终态 |
| none/done/dropped | 不自动重开 | lookup/used/扫描均不恢复 |

P 总上限原样保留：64 成员、12288 UTF-8 字节、0.60H token；K 算硬层，不计成员。
任一维度达 80% 先生成可收口清单；满额／预计越限先持久化报告和通知，退软层到三维都≤70% 或软层空。
退让顺序：合格完成信号、超期沉寂、最后受控提及最旧、open 序号、id；自动只有 pending-done/cooled-due。
确认／恢复在同一锁内预留目标，再退其它软项；目标加硬层已达任一上限返回 due_capacity_blocked，原态不变。
预留目标不得成为本次退让对象；硬层独占回落线则其它软层清空，不无限循环；硬超治理线禁止新增。
报告存 relations 的 due-report 事件：reportId、policyRevision、sourceRevision、逐项 id/from/baseRevision/action/reason/证据/恢复入口、payloadHash。
键=稳定触发操作 id+报告种类；通知状态另记 unknown/confirmed，不直接工具发 QQ／外部消息，复用本地状态头。
默认报告无 done/dropped；主人选择后新 payloadHash 绑定逐项动作；任一版本过期整批不写。
due-mention 键=memoryId+ownerInputId；只有受控目标引用刷新锚点，扫描／注入／used／lookup 不刷新。
due-done 键=主人操作 id+memoryId；receipt、报告引用、状态、到期索引同事务，读回含全部集合。
没有维护唤醒时启动／输入补扫；时钟回拨暂停时间老化但不暂停容量检查，不声称离线已经执行。

## 8. B5 四类事件幂等、兼容与重放

M1 先交共享 appendRelation 严格比较能力；M2/M4 在各自生产端使用，M5 完成四类故障矩阵和兼容验收。
B5 不是等 M5 才给前面业务加幂等，也不允许先把缺证据事件写入再约定以后补。
新落地 compile 的审核计数尚未进入完整 manifest，dueCounts 未按场景过滤；M3/M4 在原器官内补齐并测负例，不另写器官。
buildGroups 不能依赖 slice(0,12) 截掉第 13 组；通过固定分类保证上限，异常分类显错，不能丢 eligible 成员。

| 事件 | 完整业务键 | 必需 payload／投影 |
|---|---|---|
| due-state | memoryId+triggerOperationId+baseRevision | §7.3 完整 from/to/revision、策略、证据、回执或触发、报告及 dueProjection |
| candidate-entity | observationId+source_span+scope_id | candidateEntityId、observationId、原字节及 evidence hash/span/refs、scope、ruleRevision、status=candidate |
| review-defer | reviewId | reviewId、reason、triggerId、policyRevision；review_queue 关闭＋未复核标 |
| shelve | targetId+operationId | targetType、targetId、reason、receiptId可null、reviewId可null；candidate.status=shelved |

完整键组成用 canonicalJson 数组编码，不用任意冒号拼接造成歧义；full key 与事件版本同时固化。
新增事件按设计 eventId(main,type,businessKey)；旧事件保持既有 id/dedupe 原值，不全库重编号。
appendRelation 提供版本化入口：旧调用继续识别旧 key 格式，新调用 event_version=2/payload_version=2 保存完整元组。
两版本都严格比较规范 payload；同键同文返回原 id/commit_seq，同键异文 idempotency_conflict，不 silent return。
不改变全局 canonicalJson；证据集合由业务层排序，正文空白、否定和标点保持原样。
外层事件 at 不作为业务键；重投必须复用 operations 固化值，payload 内生成时间也不重新采样。
重复命中后不再执行投影 UPDATE；原提交缺投影属于核验／重建问题，不能边重复投递边悄悄修补。
新事件先验证已登记 event/payload version、类型、外键引用、from/revision、权限；未知格式 quarantine 并报错。
重放顺序为 commit_seq、ordinal、id；未知版本不能直接 continue，缺字段不能默认为成功。
candidate-entity 与候选/证据同事务；不存定义／别名／实体权限；原字节 BLOB 在事件用明确 base64 编码并附 hash。
review-defer 只有合法 needs-review 目标；shelve 不能把 memory 退休，due 的 shelved-due 必须走 due-state。
默认 shelve 的 operationId 从 candidateId+review_policy版本+到期基准派生；不能把每次启动当新操作。
自动 due 触发 identity 固定为目标入队／open 版本+策略+原因+证据版本，容量触发另绑定持久 report 操作。
扫描到多个已到期目标按锁内当前版本逐个确定动作；与 owner 确认竞争后重读，不用旧 from 直接覆盖。

### 8.1 第一批旧事件兼容，不伪造历史

现有 appendRelation 的旧 dedupe=type:businessKey，部分 due-state 缺 baseRevision/策略/报告，不能把新 schema 硬套旧 payload。
v1 只读适配器以旧生成器的确切格式解码：due old key 尾部 revision 为新版本，base=new−1；须与前序折叠一致。
初始 due 入队以 promote 事件 commit_seq/at 和不可变候选的 promise/due_at 推导；不从可变 due_state 反推初态。
旧 reason=cap-100/pending-due-14d 映射已知策略版本；无 report/receipt 的字段标 legacy_missing，不能补造主人批准。
旧 candidate-entity 缺元数据时仅可从指定 observation 原字节、已存证据和现有不可变提及行恢复；核 hash 后才接受。
若事件根本不存在而仅有旧提及行，保留行并报告 legacy_event_missing；不伪装已具备完整事件重建证明。
旧 shelve 的明确 reason 与目标映射成稳定默认操作，保留原 key/id；review-defer 无旧数据也必须支持新格式。
历史事件不足以重建的字段报 unknown/legacy_incomplete，阻止受影响权限动作，不猜时间、证据或版本。
已有旧终结事件重试先查兼容映射和原 control 任务；返回旧结果，不另发 v2 等价终结事件。
v1/v2 混合序列须证明同一目标终结一次；历史原文、事件字节、SQL checksum 全保持。

### 8.2 重建与故障策略

replayMain 扩展返回自我分支、判断两列、项目快照、due、review、candidate_entity 的只读折叠，不另建业务权威。
candidate_entity_registry 有禁止 DELETE/UPDATE 的旧触发器：正常库不能“清空重放”，只核对或幂等补缺。
完整重建测试在新隔离副本中复制不可变对象／原事件，再由折叠 INSERT 缺失索引；旧库和旧触发器保持不动。
state/review_queue/due_queue 可重建投影由单事务替换；memories 仅同步白名单 due 列，候选仅状态白名单。
历史资料不足的旧索引作为 legacy 输入单列，不计作“纯事件可重建通过”；新 v2 数据必须纯权威对象＋事件重建相同。
维护重建不发新业务事件、不增加 uses、不消费 owner nonce、不改 operations 的尝试／冻结历史。
每种事件测试：首次写、同键同文重投、同键异文、主库回滚、commit 后回执中断、重启读回、并发竞争及投影重建。
先主库成功后 control 失败返回 unknown；恢复精确核事件与提交版本；第三次失败仍冻结，不能用新 payload_version 绕过。
新增对象的只追加 trigger 直接 SQL UPDATE/DELETE 必须失败；合法投影修改必须有同事务事件。

## 9. 本批 M1–M5 交付与可粘贴验收

依赖为第一批验收基线 → M1 → M2 → M3 → M4 → M5；B5 共享设施提前随 M1 落地，最终整体验 M5。
所有命令从工作区根执行，逐条检查退出码；不得依赖 git、网络、模型服务或生产数据。
专测用真实 node:sqlite 临时库、真实服务、可信测试 runtime；固定时钟／tokenizer 必须标 test-only。
所有专测要求 TAP tests>0、fail 0、cancelled 0、skipped 0；只打印 marker、不运行断言视为失败。
用例通过后以 Node test diagnostic 输出相应 P2_M*_OK 标记，标记内容必须来自真实断言结果。
每阶段再运行通用门禁；新增测试要被原 scripts/test.mjs 枚举，不能单测通过而 npm test 漏掉。

~~~powershell
npm --prefix whale-unify/memsys run build
npm --prefix whale-unify/memsys test
node whale-unify/memsys/scripts/check-bom.mjs
~~~
期望依次 `BUILD_OK files=N`、全部已交付套件 TAP fail 0/skipped 0、`UTF8_OK BOM=0 files=N`；N 为实际枚举数。
原第一批用例继续运行；无法跑的动态能力单列，不能让 offline test skip 冒充全部通过。
阶段开始先用既有 checkpoint CLI 建源码及三库检查点；label 用 P2-M1…P2-M5，测试 --out 指向隔离目录。
备份采用 decisions #1/#2；恢复不得覆盖已产生新事实的生产库，不以旧 control.db 重置失败计数。

### M1：B1 self note 与共享严格幂等

交付：main-004、self-note/read-self/tools-self、p2-m1-self；§2.1 的 repositories/identity/contracts/replay 最小扩展。
前置：第一批 main-003/control-002 与 read/pager/record/可靠提交基线完整；本阶段不依赖本批判断／项目。
reflection 非空先明确拒绝 dependency_unavailable，M2 补接；基础 self note 不受此限制。
验收命令：
~~~powershell
node --test whale-unify/memsys/test/p2-m1-self.test.mjs
node --test whale-unify/memsys/test/m1-storage.test.mjs whale-unify/memsys/test/m2-write.test.mjs
~~~
期望 `P2_M1_OK self_note=true author_bound=true append_only=true forks=2`；两段均 TAP fail 0、skipped 0。
造一篇→self_get 原字节相等→修订→history 旧篇仍在＋supersede 存在；再第二分支，两篇 current 均可取。
14 个场景覆盖：作者、空依据、梦来源、原输出保全、异文冲突、回拨顺序、自环/跨类型、分叉、SQL 禁改、分页、禁自动注入、事务中断、升级、旧 API 回归。
用第一批终态库迁 main-004，验证旧 hash/行字节不变；新库重跑两次；本套件迁移夹具固定截至 main-004。
验证 owner 无法填 author/runtime 代写；关闭做梦仍写 daily self note；非空反省目标不得被静默忽略。
回滚：关新增 kind 发布层，保留已写自我原文和事件；旧二进制不认识未来 schema 则只读报错，禁止向下删迁移。

### M2：B2 判断／猜想／对账与默认退出
交付：main-005、judgment/judgment-review、owner-actions 最小回执、p2-m2-judgment；self 反省与第二档候选接线。
前置：M1；review_queue、输入序号、来源、topic 与 control 复用；不要求 project 或真实工具服务。
验收命令：
~~~powershell
node --test whale-unify/memsys/test/p2-m2-judgment.test.mjs
node --test whale-unify/memsys/test/p2-m1-self.test.mjs whale-unify/memsys/test/m3-reliable.test.mjs
~~~
期望 `P2_M2_OK outcome_separate=true aging_replay=true speculation_in_S=0`；TAP fail 0/skipped 0。
18 个场景覆盖：原始行不可改、outcome done 与 verdict pending 并存、工具窄义证明、旧结果不覆盖 reverted、同结果去重、伪证明拒绝。
还须覆盖 self 禁 right、master 优先/void、反省只复核、topic 碰撞、无裁决／仅 self／有 master 老化、边界前后、回拨、defer 不重开、候选原子性、猜想隔离、分页及离线扫描。
阈值夹具用服务时钟设置，断言阈值前一刻无事件、达到时一次事件、反复扫描事件总数不增。
场景不能只检查 outcome 字符串：读 SQL VIEW 两列及原 judgment 行，验证 done 不使 verdict.right。
关考试／做梦仍扫描；重启恢复相同 reviewId/deadline；有 master 的老化不产生改判。
回滚：停新 judgment 写端及扫描，保留已追加账；控制账恢复处理原固定操作，不自动解冻。

### M3：B3 项目身份、完整快照与 Overview

交付：main-006/control-003、project/read-project/tools-project、p2-m3-project；owner-actions 项目白名单、原 context 项目接口。
前置：M2；容量调用第一批 budget 接口及测试计量器，不倒依赖本批 M4；生活窗口授权不走模型猜意图。
验收命令：
~~~powershell
node --test whale-unify/memsys/test/p2-m3-project.test.mjs
node --test whale-unify/memsys/test/p2-m2-judgment.test.mjs whale-unify/memsys/test/m4-context.test.mjs
~~~
期望 `P2_M3_OK snapshots=5 revision_conflict=true inherited_sources=true`；TAP fail 0/skipped 0。
通过 owner fixture 建项目（首快照 1）→四次更新（revision 2..5）→project_get 追齐五版；重复原请求不产生第六版。
14 个场景覆盖：伪回执、同名分离、创建原子性、选择授权、四次快照、缺省/null、同输入字段冲突、并发 stale。
还须覆盖来源并集及显式重填旧值、来源失效回退/head 不回退、命令不证整体完成、生活限制、容量阻断、分页与重建。
造旧 progress=“模型报告完成”并引用模型材料，下一次只改 next_action 且给干净工具证据；仍含旧 model 来源，不能显示整体完成已验。
使最新依据失效后 effectiveRevision 回退，headRevision 仍 5；下一次合法提交必须以 5 为基线，产生 6。
工作 Overview 四项完整且 uses 不变；生活自动内容及数量不泄漏。
回滚：取消本批新增自动 Overview 接线，保留身份和快照历史可查；不能删 projects 让旧批准失踪。

### M4：B4 待确认惦记、grouped 与确认闭环

交付：pending-due、due-actions、p2-m4-due；原 due/review/context/owner/runtime 接线；live-check 的 plan2-context。
前置：M3；离线全部可跑；仅真实注入与宿主新工具注册验证依赖独立 probe profile。
验收命令：
~~~powershell
node --test whale-unify/memsys/test/p2-m4-due.test.mjs
node --test whale-unify/memsys/test/m4-context.test.mjs whale-unify/memsys/test/m5-tools.test.mjs
node whale-unify/memsys/scripts/live-check.mjs --case plan2-context --profile memsys-plan2-probe
~~~
离线期望 `P2_M4_OK pending=20 grouped_complete=true pending_in_P=0 confirmed_open=1`；所有计数来自各自隔离场景。
动态期望报告有 section_present=true、pending_review_present=true、project_work_only=true、self_auto_present=false。
同一动态用例实际调用 self_get/project_get/record 新 kind；报告 tools_callable=true；只列工具名不算成功。
动态同时核双窗口和下一轮更新，cross_session_leak=false；未发现独立回执时 delivery=unknown，绝不能伪造 confirmed。
现有 live-check inject 只证实 section 注册 marker；本批 plan2-context 必须另抓真实 system/message 与实际工具结果，不能复用 marker 冒称上述动态通过。
探针安装先复制包到临时 ASCII 目录，再安装副本；禁止 file:// 工作区安装或任何指向 whale-unify 的 junction/symlink/硬链。
重建／清理 profile 前逐项核验链接，只删链接目录项；目标路径必须解析且受控，不递归追随链接，也不跨 shell 拼删除命令。
清理失败不得继续 reset；成功或失败退出均清理探针依赖并核 node_modules/memsys 不存在，原源码 hash 不变。
缺 profile/工具注册/H 等能力返回非零及具体能力名，报告“离线通过／动态未闭合”；不能自动改生产开关。
18 个场景至少包含：20 条召回、排序同快照、场景／来源过滤、压缩/grouped、分页重启、待确认不占 P、非法确认。
其余包含：策略未批准、合法确认、确认与归档竞争、14 天默认归档、跨身份／窗口 101 条、80%/100% 容量边界、预留目标、完成证据、恢复不复用旧证据、回拨、投递 unknown/拔件。
造数通过原 candidate→promote 生产路径造 20 条合格 pending；不能直接 SQL 把它们改成 open 骗确认链。
取足预算时审核区列 20；缩至 P+K 可装而逐条装不下，逐页并集仍 20，P_s 增量 0。
测试批准 due-policy 与单条确认后新快照 D=19、open=1、P_s=1；旧快照仍 20，不被当前状态污染。
另一个隔离 fixture 保持无人确认，阈值满后 20 条均 shelved-due；memories 原文及事实 active 不变。
回滚：禁新 open、关新增自动审核展示；已 open 必须由兼容扫描／读取继续维护，不能退到无出口的第一批写服务。

### M5：B5 四事件全矩阵与批内集成

交付：p2-m5-replay、p2-integration；四事件全部生产端与历史适配；不新增业务范围。
前置：M4 离线通过；真实注入证据独立列状态，不让 M5 离线测试依赖网络或运行中的 DSH。
验收命令：
~~~powershell
node --test whale-unify/memsys/test/p2-m5-replay.test.mjs whale-unify/memsys/test/p2-integration.test.mjs
node whale-unify/memsys/scripts/migrate.mjs --data-dir whale-unify/_build/test-data/p2-final
node whale-unify/memsys/scripts/check-db.mjs --data-dir whale-unify/_build/test-data/p2-final
~~~
期望 `P2_M5_OK dedupe_types=4 replay_equal=true legacy_checked=true`；TAP fail 0/skipped 0。
迁移期望 `MIGRATIONS_OK main=6 control=3 dream=1`；三库 integrity_check=ok、foreign_key_check=0；重复运行不新增迁移。
12 个主场景：四种事件各一组重复/异文/重放矩阵、旧新混合、旧事件不足显错、崩溃恢复、并发竞争，以及四个集成场景。
集成一：工具结果改 outcome→self note 引用 judgment→needs-review→defer；verdict 不随 outcome 或超时改判。
集成二：项目五版→来源失效→回退→新头更新；旧 operation 精确读回仍 found。
集成三：20 待确认→grouped 全取回→确认一条→容量退让／恢复；manifest/P/状态报告相互一致。
集成四：关闭浮现、考试、骨架、做梦后，self 工具、判断扫描、due 到期、恢复、项目主动取回仍可用。
恢复测试用真实子进程断点与同库重开；第三次失败 frozen 后第四次业务写为 0；控制账不可写时业务写为 0。
每个新表至少验证一处 commit 后回执断点；历史快照不会因后来合法变更而误报损坏。
本阶段还跑 §9 通用门禁和第一批全部离线套件；与新版本无关的旧断言不得删除／skip。
回滚：保留失败库、源码检查点与控制尝试账；隔离恢复验证后才切配置，不在线覆写数据库。

## 10. 风险与交付自检

| 风险 | 本图给定处理 | 不能冒称的结果 |
|---|---|---|
| 第一批尚有模块未收尾 | 以第一批 M1–M5 证据和预留迁移为前置 | 目录缺文件不等于可抢 main-003 |
| 同键异文检查影响旧生产端 | M1 共享改动即全量回归，生成值冻结，v1 兼容 | 不能保持 silent reuse 迁就旧测试 |
| due 确认带来 open 责任 | §7 完整出口／容量政策、批准闸门 | 未批准不声称已开启正式惦记 |
| 权限通道未实测 | 按受信 runtime+完整命令，M4 probe 验真实适配 | 离线 fixture 不证明真实主人身份链 |
| 来源缺失与过期缓存 | 项目有效版本重算、判断保留原账、受影响项 fail closed | 不拿 verified 缓存掩盖失效 |
| 旧事件缺必要字段 | legacy_missing/unknown 与旧原件并存 | 不生成假的历史报告或主人回执 |
| 硬预算／回执未知 | 继承 tools-only/unknown 能力闸门 | 不用字节当 token，不把编译当投递 |
| 范围膨胀 | 新文件 21 个、五块范围、白名单接线；无依赖 | 不补做梦／feed／通用实体治理 |

以下为出图自检，不是实现验收；施工员失败三次按契约冻结并报主管，不无限重试。

| 自检问题 | 答案／核验位置 |
|---|---|
| 五个里程碑是否都有可执行命令？ | 是，§9 M1–M5 均给 node --test 的完整路径和期望，M4 单列 probe |
| 有没有任何一步改 main-001/002 或 control-001？ | 没有；§1.1 保留旧 hash，003 归第一批，新增 main-004–006/control-003 |
| pending-due 是否明确不进 P、不占固定栏目？ | 是，§7.1/7.2：D 是审核集合，不进 S/P，grouped 无漏项 |
| 是否列全需要改第一批已验收模块？ | 是，§2.1 单列第一批 M1，§2.2 列其余接线与回归 |
| self note / judgments 是否进入 S？ | 均否；仅 judgment 的 needs-review 进入审核；speculation 也不自动注入 |
| 项目是否新建第二份状态账？ | 否，projects 只身份，project-update 是权威完整快照，state 可重建 |
| outcome 与 verdict.result 是否分开？ | 是，原始 outcome 不可变，投影及 SQL VIEW 分两列，两个 pending 独立 |
| 旧数据与新幂等键是否兼容？ | §8 保留旧 id/key，版本化严格比较；历史不足显报，不补造 |
| 本批新增依赖／实现代码了吗？ | 没有；本文只出图，施工限 Node 标准库及原包 |
| 静态检查是否替代验收？ | 不替代；仅检查本文结构、编码、行数与受保护输入完整性 |

静态检查通过：608 行（要求 400–650），UTF-8 无 BOM／替换乱码；14 张表列数一致且无空项，代码围栏闭合，M1–M5 均含完整验收命令。抽查的 61 个既有文件中 56 个 hash 未变；并行施工变更见下，不宣称全库未变。实现测试、迁移及动态验收本轮未执行。

并行施工变更核对：_build/decisions.md、memsys/package.json、memsys/src/tools/schemas.mjs、memsys/test/m1-storage.test.mjs、handoff/current.md；本轮仅写 plan-2.md。新增施工决定已重读纳入，业务文件未由出图方修改。
