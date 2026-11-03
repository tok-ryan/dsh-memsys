# memsys 第二轮复核

已按顺序读取第一轮 review-final.md、fix-list.md、report-4.md、decisions.md #43–56，再核对实现、调用方和相关测试源码。
本次只做静态复核，没有运行测试、门禁、迁移、导入或宿主探针；294/294 是 report-4.md:19 的既有验收声明。
以下源码及测试路径相对 whale-unify/memsys/；交付材料用 _build/ 前缀，设计稿路径相对 whale-unify/。
行号对应本次读取的代码；失败路径均为代码推导，不冒充动态复现。
结论：22 条中，已修 2 条，部分修 18 条，未修 1 条，修错方向 1 条；不能将本批表述为“22 条全部修完”。
report-4.md:25 已承认编译三败未接，但 :12 的保护成员、最终预算、真实容量计数及场景过滤声明还超过当前实现。
decisions.md:163 的 expected_ids 并入延后成员，直接违背 memsys-design-v0.38.md:196、:197 的交付／曝光契约。

**一、逐条核对 L1–L6**

**L1：部分修。存在性恢复没有升级成完整事务读回。**
已补：src/control/recovery.mjs:17 对带 payload_hash 的行增加比较，可挡住 observation hash 不符。
仍缺：:19 对 promote 显式跳过比较；:95 的 due 探针仍读 memories，而 src/write/due-actions.mjs:138 固化的是 due-state 事件 hash。
结果：正常已提交的 due 变更也会因“事件 hash 对记忆 hash”被判 unknown；这不是证明该操作未提交。
src/write/candidate.mjs:582、:693 仍把刚查出的 memory 当 expected；src/control/readback.mjs:88 只验 timeline/pointer 存在，:96 只验缺少证据 ID。
src/control/recovery.mjs:371、:395 的冻结对账与历史 recheck 也没有调用新增 hash 校验。
还差：按操作类型保存并核对完整预期结果、事件和证据集合，让恢复、重查与正常提交共用同一判据。
测试边界：test/p4-p2-recovery.test.mjs:73 只篡改观察 hash，没有覆盖 due 已提交恢复或提升的完整结果。

**L2：部分修。有扫描器，但最初的丢链断点仍在。**
已补：src/control/recovery.mjs:124 扫 pending capture-job，并调用 captureObservation。
仍缺：src/write/observe.mjs:105 依次 insertObservation、appendRelation、advanceInputSeq，外层没有主库事务；src/control/commit.mjs:88 仅调用 writeTxn。
在观察提交与 job 插入之间中断，扫描器没有可扫描的指针；重试又会被 src/write/observe.mjs:106 的“观察存在即 return”跳过补指针。
新增错误：src/control/recovery.mjs:138 用固定 work/recovery 身份重建，生活输入会变成工作候选；src/write/capture.mjs:97、:121 直接采用该 mode。
src/control/recovery.mjs:138 没检查返回 receipt/status，:143 就记 done；src/write/capture.mjs:249 可以返回 unknown 而不抛异常。
还差：观察、带原始身份／场景的 job 和序号同事务；恢复确认完整 capture／命令记忆成功后才能记 done。
测试边界：test/p4-p2-recovery.test.mjs:95 在第二次 reserve 才中断，未覆盖观察与 job 之间的断点，也没有生活输入。

**L3：部分修。能续已写入 task 的主库步骤，不能续所有跨库断点。**
已补：src/dream/confirm.mjs:150 补了草稿字段；:251 写续跑计划；src/control/recovery.mjs:162 消费计划。
原缺口仍在：src/dream/confirm.mjs:233 先消费回执，:251 才存 task；两者之间中断后，重试被 :88 拒绝，恢复扫描又找不到 task。
梦库提交后、task 落库前的其它断点也没有快照扫描补链；src/control/recovery.mjs:163 只扫描主库 task。
快照仍不保真：src/dream/confirm.mjs:167 对 evidence ref 字符串做 hash，并未读取证据内容；:121 只要求 ownerObservationId 非空，不核观察存在、作者及批准内容。
续跑 :280 重新 resolveTopic 而非使用冻结快照；:349 用真假判断，批准的 structuredValue=false/0 会落成 null；:385 仅复制命题观察证据。
还差：先持久化可恢复意图，原子消费／关联回执；按快照和真实证据 hash 续跑，并覆盖上述全部断点。
测试边界：test/p4-p2-recovery.test.mjs:180 的故障发生在主库观察回执阶段，此时 task 已经存在。

**L4：部分修。比较补了，输出和重放仍丢语义。**
已补：src/dream/organize.mjs:16 补比较字段，:53 禁 open 等状态，:60 联表比较，:176 改用实际 memoryId。
仍缺：src/storage/repositories.mjs:41 的 getMemory 只读 memories；src/dream/organize.mjs:126、:133 却从 first.start_at／first.pointer_status 生成新候选。
两个具有相同非空时间线／门牌的输入会通过比较，新结果仍被写成 null／unknown；due_at 在 :131 仍固定 null，done/dropped 也未原样保留。
:180 继续写 oldMemoryId/newMemoryId；src/storage/replay.mjs:34 的标准折叠只认 oldId。src/context/select.mjs:49 的局部补丁不能修复重放契约。
src/dream/organize.mjs:52 只验 due/key/binding，没有验证事实 active，仍可合并已退休或已取代对象。
还差：用实际联表值构造输出、保持允许状态的语义；统一 supersede 事件字段及所有读方。
测试边界：test/p4-p3-fidelity.test.mjs:207 仅测不同时间线被拒绝，没有测“相同非空字段合并后仍相同”。

**L5：部分修。部分字段映射改善，完整保真核验仍不成立。**
已补：src/import/legacy.mjs:141 保留 detail/type/due，:224 对缺 raw 使用 JSON 载体并置 lossy，:317 合并来源 token。
due 并非仅停在候选：src/write/promote.mjs:154 调 registerDueOnPromote，src/write/due.mjs:27 将 candidate.due_at 写入队列；report-4.md:29 不能代替这段代码事实。
仍缺：src/import/legacy.mjs:144 仅接受数组 origin；其它表示直接变空。:111 的版本 hash 未覆盖新纳入的 detail/type/due/origin。
:491 的字段核验只查 candidate；:506 对 timeline/pointer/evidence 仅验存在／数量；:517 的门牌核验拿同次生成的事件自证。
缺 raw 的证据范围在 :417 按摘要长度生成，却引用 :224 的 JSON 载体，范围并不表示该摘要的真实原文位置。
还差：完整来源与旧 due 状态映射、全字段版本身份、实际 memory／联表／证据内容对照，以及图实体和边的实际核验。
测试边界：test/p4-p3-fidelity.test.mjs:140 只断言候选新字段；没有篡改联表内容后要求 verify 失败。

**L6：部分修。增加了门槛，但仍不能证明回退不丢增量。**
已补：src/import/legacy.mjs:535 拒绝 unresolved；scripts/import-legacy.mjs:225 会打开恢复目录并比较业务表计数。
仍缺：src/import/legacy.mjs:107 的无 ID 记录只进 anomalies 后跳过；:453 的 unresolved 仅来自 quarantined，:535 不看 anomalies，丢掉的记录仍不阻断切换。
src/import/rollback.mjs:1 漏 evidence、due_queue、state 等；:15 只验数量不少于下限，不核内容、事件重放或关联。
scripts/import-legacy.mjs:182 只保存激活点计数，:230 还允许旧配置缺计数时使用 {}；激活后的新增事实不在比较基线。
src/gates/checks.mjs:63 仍只有高水位大小关系；scripts/acceptance-boundaries.mjs:62 仍用空临时库构造自一致报告。
还差：所有遗漏／异常纳入阻断，以真实恢复和逐项增量重放结果证明可回退；计数只能作辅助。
此缺口部分已披露于 report-4.md:27，但 anomalies 漏门禁及空基线放行没有在该边界中说明。

**二、逐条核对 E1–E16**

**E1：已修（针对原两步扩大场景绕过）。**
src/write/candidate.mjs:633 按候选 ID/hash 检查批准事件；:668 在普通提升路径再次调用，both/global/跨窗口无批准会拒绝。
:736 的批准服务校验 action、目标、hash 和 baseVersions；src/tools/record.mjs:225 仍委托同一提升函数。
test/p4-p1-auth.test.mjs:142 覆盖无批准直接 promote；test/p4-p4-c.test.mjs:145 覆盖合法批准后提升。
边界：这证明服务层原绕过被封住，不代表报告已披露的提案 UI／宿主接线已经实现。
补充：批准服务 :748 追加事件后没有消费回执；同候选批准重复执行不新增权限，但消费语义仍不统一。

**E2：部分修。主要入口绑定增强，但“最终完整 payload＋锁内版本”仍不完整。**
src/write/owner-actions.mjs:56 新增统一校验；:127、src/write/project.mjs:196、:519、src/dream/confirm.mjs:88 均已接入。
仍缺：src/write/project.mjs:337 的更新 hash 只绑定 projectId/patch，未绑定 :364 的 evidenceRefs、:404 的 semanticStatus 等实际写入内容。
src/write/owner-actions.mjs:127、src/write/project.mjs:519 等先验证，再进入主库事务；取得写锁后没有重新验证已消费状态和批准基版本。
src/write/owner-actions.mjs:132 使用判断正文的不可变 hash，不是当前裁决版本；不能阻止另一裁决已生效后执行旧批准。
还差：统一规范化最终业务 payload，在同一主库锁内核当前基版本及回执未消费，再写业务并消费。
test/p4-p1-auth.test.mjs:32 证明三种修改草稿被拒绝，但不证明所有字段和锁内竞态已覆盖。

**E3：部分修。状态方向正确，重新入队没有完整重建。**
src/write/due-actions.mjs:319 已将 shelved-due 恢复到 pending-due，并在 :333 更新期限／序号。
但 :107 的事件与 state 投影保存旧期限／旧序号，:333 的补 UPDATE 在事务之后，重放与队列会不一致。
更直接的失败：没有更新 enqueued_at；src/write/due.mjs:74 按旧入队时间老化，已因老化搁置的条目恢复后会再次被搁置。
还差：新入队时间、序号、期限和事件投影同事务；恢复待确认不应先被 open 的容量要求卡住（src/write/due-actions.mjs:308）。
test/p4-p4-c.test.mjs:49 使用新鲜入队时间，只断言队列 deadline/seq，避开真实老化恢复场景。

**E4：部分修。缺 H 拒绝及目标字节已补，真实三维准入未完成。**
src/write/due-actions.mjs:45 对缺 H 返回 capacity_unknown；:263、:308 传入 H 和目标字节。
:49 硬层仍固定 4096 字节，:53 以 bytes/2 代 token，:48 成员数只含 open 和目标，不含真实硬保护成员。
:263 的容量读与 :285 的 transition 不在同一写锁内；src/write/project.mjs:20 仍只有项目自身 JSON 字节限制。
还差：共享真实 P_h/P_s/K 计量、宿主 tokenizer/H 与锁内预留；不能把估算当完整准入。
估算边界已记录在 decisions.md:156、report-4.md:26；本项不能因此改判为已修。

**E5：部分修。换请求的第四次写被挡住，但第三败未持久冻结。**
src/control/ledger.mjs:92 已跨请求统计同 object_key/generation 的完成失败。
然而 :265、:276 仍用单个 operation.consecutive_failures 决定完成后的 frozen；三个不同请求各失败一次，流仍未置 frozen。
第四次 reserve 在 :105 命中，:107 写 frozen 后 :110 抛错；src/storage/open.mjs:56 随即回滚，冻结记录与 freeze 事件都未提交。
结果：后续写会持续被扫描结果拒绝，但持久冻结标志／报告／冻结对账仍不成立。
还差：完成第三败时按对象统计并持久冻结，返回正确累计数；禁止“写冻结再抛异常回滚”。
test/p4-p2-recovery.test.mjs:235 只断言第四次抛 object_frozen，没有断言第三败后的持久 frozen。

**E6：部分修。正常撤销可按 confirmId 跟踪，跨库撤销仍会漏。**
src/dream/confirm.mjs:431 建 dream-confirm-link，:495 让 void 按 dreamId 找派生对象；src/dream/replay.mjs:50 可回退前一个有效确认。
但 src/context/select.mjs:11 只读主库 link/revoke，不读取梦库当前状态；src/dream/confirm.mjs:455、:487 提交梦库后再写主库撤销，断点没有补偿任务。
因此梦库已撤销、主库标记未补时，派生记忆仍可进入 S；缺 link 的已提升记忆也没有失效保护。
此外 src/control/recovery.mjs:177 续跑 task 不校验梦已 void/unconfirm，可能在 void 扫描 links 之后新增未撤销派生结果。
还差：读取时可靠折叠当前来源，或先固化可恢复撤销意图并保证所有读方一致；续跑也必须服从当前有效性。
test/p4-p2-recovery.test.mjs:294、:308 覆盖完整执行的撤销，没有上述断点。

**E7：未修。原两个实质问题均仍存在。**
src/context/compile.mjs:77 将 open 放入普通目录，:243 参与普通压缩，:257 把全部组成员变成 deferred，:321 清空实际条目。
grouped 时 buildSection 在 :103 只输出分组头；不存在 open 保护成员单独完整交付的分支。
:259 仅比较 K；:309 拼入审核标题及梦文本后，:324 虽算 total，却没有再次与 H 比较就持久化并返回。
test/p4-p4-capacity.test.mjs:65 构造的是 pending-due 而不是 open；:85 只断言 hard＋soft，遗漏实际 section 的附加文本。
还差：冻结并完整交付 P，所有段拼接后核最终 tokenizer(section.text)≤H；测试必须包含真正 open 成员。

**E8：部分修。仅补了一条溢出记账路径，常态计数仍是原占位口径。**
src/context/compile.mjs:260 为 protected_overflow 写容量行并增加 streak，已不再完全无记录。
但 src/context/snapshots.mjs:180 的 hard_count 仍取 measureK 的 0（src/context/budget.mjs:73）；:185 的 soft_count 仍是码点数。
src/context/snapshots.mjs:197 的三个 streak 仍固定 0；src/context/compile.mjs:261 取全局最新行，未隔离流，同 roundId 重写也可能重复递增。
compileRound 未接 reserve/complete，见 src/context/compile.mjs:132、:371；report-4.md:25 对三败未做的披露属实。
还差：两层真实成员／字节／token 账、分流且同轮幂等的 streak、编译持久失败控制。
test/p4-p4-capacity.test.mjs:119 只验任一 token>0、任一 streak≥1，不能证明“真实计数与连续升级”。

**E9：部分修。状态组可取回，但覆盖集合与场景泄漏仍在。**
src/context/snapshots.mjs:158 新增 __status__ 组；src/context/compile.mjs:357 将 fixed 标记放进 manifest.eligible_ids。
但 src/context/compile.mjs:47 的 mode 参数没有进入 SQL，:66 的待审计数也无场景过滤；状态头仍泄漏其它场景数量。
:336 的 eligible 仍不含普通候选／pending／needs-review；:342 的 coverage 在 :357 添加 fixed 之前已结束，fixed 不在 actual/deferred 中。
传给持久快照的 eligibleIds 在 :382 又不含 fixed；同一快照的 manifest 与 eligible_ids 列彼此不一致。
还差：统一覆盖全集、固定段的实际交付身份和场景过滤；状态页也应提供真正状态报告内容。
test/p4-p4-capacity.test.mjs:98 只验早已过滤的“待确认惦记 1 条”，没有验 [状态] 的 pending-due 数。

**E10：修错方向。分组漏验改善，却把未交付成员变成必收和曝光对象。**
src/context/delivery.mjs:20 绑定持久编译与 round，:87 排除非 memory ID；这两点是有效修复。
但 :33、:34 把 deferred_groups.members 并入 expected，违背 memsys-design-v0.38.md:196、:197 的 received_ids=实际 expected_ids。
只交付组头时，正确回执被判 incomplete；按新测试补上未展开成员后又在 :86 为这些 memory 写 injections，形成虚假逐条曝光。
hash 仍比较 compilations.payload_hash（:50），它来自 sectionHash（src/context/snapshots.mjs:104），不是 manifest.hashes.payload（src/context/compile.mjs:363）。
还差：分清 section hash／payload hash，回执严格对持久 expected_ids，延后成员绝不要求回执、绝不计逐条曝光。
test/p4-p4-delivery.test.mjs:55、:64、:67 恰好把错误行为断言为成功；decisions.md:163 不能替代原交付契约。

**E11：部分修。参数绑定补了，快照不可变检查实际失效。**
src/context/compile.mjs:207 纳入 query/H 等；src/read/get.mjs:103 纳入部分版本；src/read/search.mjs:121 绑定查询与有序结果身份。
但 src/context/snapshots.mjs:92、:110 先 INSERT OR REPLACE，:133 才读取 existing；:144 比较的是本次新写的 hash，旧版本已被覆盖。
同 roundId／业务 revision 下时钟文本变化，snapshotId 不变而 section 变化（src/context/compile.mjs:31、:207），可静默改写分页快照。
get 游标不绑定 view/includeEvidence，也不含 due／冲突／历史版本；search 的 :122 只含 ID/payload_hash，联表和 due 变化但结果顺序不变时不会 stale。
未发现“每次翻页必 stale”：src/tools/read.mjs:14、:25 不自动写 uses，search hash 也不含 uses；report-4.md:32 的“uses 变化即 stale”不是当前实现。
还差：覆盖前比较或保留不可变快照、签名覆盖实际返回字段；测试应测重编译同 ID 和连续成功翻页，而不只测变更拒绝。

**E12：部分修。get 真列和观察直取已补，搜索与冲突标记仍错。**
src/read/get.mjs:53 使用真实绑定列并将 NULL 标 unknown；:80 返回证据原文，:176 支持 observation ID。
但 src/read/search.mjs:159 仍按 tk: 前缀猜 key_status，缺 binding_status；不同读接口对同一旧记录仍可能给出不同权限解释。
src/read/get.mjs:56 只匹配 conflict.payload.memoryId；实际 src/write/candidate.mjs:524 写的是 refs 数组，所以已有冲突仍读成 false。
还差：所有读口共用真实绑定／冲突折叠，识别 refs；新增 observation 分支还必须执行字符预算和分片（src/read/get.mjs:184 直接返回整篇）。
report-4.md:33 称本批没有 conflict 写路径，与 src/write/candidate.mjs:524 的实际写入路径不符。

**E13：部分修。点事件误命中修了，但精度、历史语义和使用分未修对。**
src/read/search.mjs:45 不再把 point 延伸到查询上界，:109 对直接命中计算 evidence_mean。
但 :32 没读 prec_start/prec_end/as_of；:52 对 ended_unknown 的缺失结束仍等同无上界，也不区分可能重叠。
:114 使用 SELECT COUNT(*) FROM uses，而 src/read/activity.mjs:40 的表语义是一条 memory 一行、次数在 count 列；多次使用也最多得到 1/5 使用分。
还差：按精度展开、区分确定／可能重叠、正确处理 ongoing/as_of，以及读取真实 uses.count。
test/p4-p4-c.test.mjs:85 只测 point/确定区间与均值类型；均值返回 number 不代表数值符合公式。

**E14：已修（针对原确认折叠、void 与 basis 频次键问题）。**
src/dream/surface.mjs:64 明确排除 void，:72 按 confirmationState 寻找当前未确认命题，:76 用关联记忆 topic_key，缺省 dreamId。
src/dream/replay.mjs:50 先剔除失效确认再取最新有效确认；不再由一个历史 confirm 压住整个梦。
test/p4-p4-c.test.mjs:125 覆盖同梦的已确认命题被排除、另一未确认命题仍浮现。
保留已披露边界：freshness 单维及跨进程频次证据不足（report-4.md:35、:44），不将其说成完整相关性算法已验。

**E15：部分修。旧真值漏洞已封，inject 证据分支仍过宽。**
src/gates/checks.mjs:143 要求 status=passed；tools 分支检查 result/schemas/get，{}、unknown、仅 result:fail 已不能通过。
scripts/acceptance-boundaries.mjs:118 在 requireLive 下真实检查 gate；同时传 --offline 也没有跳过该分支。
但 src/gates/checks.mjs:147 对 inject 只验任意非空 section.name，不核名称、order、result；带 status=passed、result=fail、错误 section 的报告仍可通过此 gate。
实际 live-check producer 对名称和顺序的要求更严，见 scripts/live-check.mjs:388 的 section_name_or_order_mismatch 分支；消费者没有保持同样契约。
还差：按 case 验完整成功结构并排除矛盾失败字段；注册证据仍只证明注册，不等于执行或自动注入。
test/p4-p4-delivery.test.mjs:92 只覆盖 tools 成功和几个缺字段对象，未覆盖 inject 分支。

**E16：部分修。仅回填规划新增了真实读取，其它 exact 入口仍可伪造。**
src/import/pointers.mjs:38 要求 file/span/spanHash，:44 读取文件并核 span hash，这堵住旧版本清单裸声明路径。
但 :29 的版本绑定仍是清单自报；:56 只证明文件片段等于清单自报 hash，未证明等于导入原文，location 与 file/span 也未绑定。
:93 的 apply 不复验真实文件／计划 hash；scripts/import-legacy.mjs:116 直接 JSON.parse 传入，规划后文件变化亦可应用 exact。
src/tools/record.mjs:100 仍只要求 location；src/import/legacy.mjs:151 仍直接接受旧记录自称 exact，均绕开新增检查。
还差：所有 exact 入口统一核真实版本、源原文范围和位置；应用时复验，不能只靠一个规划函数。
test/p4-p3-fidelity.test.mjs:187 只测缺 file/span/hash 的伪路径，未测“真文件＋假位置／错原文”及工具写入口。

**三、修复引入的新不一致、失效检查和测试契约**

1. **恢复可能扩大场景，并把失败捕获永久标 done。**
这是新增 recoverCaptureJobs 的行为，不是“有扫描器就解决 L2”：固定 work 身份且忽略返回状态，见 src/control/recovery.mjs:138、:143。
实际影响是生活原话进入工作目录、缺失捕获后不再重试；扫描必须保存并恢复原始可信运行上下文。

2. **shelved 恢复可立即被重新搁置，且回放丢掉新入队信息。**
新增 src/write/due-actions.mjs:333 的事务外补 UPDATE 没改 enqueued_at，也未回写事件 payload；src/write/due.mjs:74 仍使用旧时间。
test/p4-p4-c.test.mjs:49 的新鲜时间夹具掩盖了该路径；应使用真正老化后的队列核对事件、state 和重启行为。

3. **“三败冻结”的新增拒绝分支回滚自己的冻结操作。**
src/control/ledger.mjs:107 写状态后抛错，src/storage/open.mjs:56 回滚；test/p4-p2-recovery.test.mjs:235 仅验抛错。
不能从 object_frozen 错误名称推断数据库已经 frozen；持久状态、累计数和恢复对账均需核实。

4. **快照冲突检查变成自比较；分页并非普遍永久 stale，而是可能混版。**
src/context/snapshots.mjs:133 读取的是 :110 新覆盖的数据，正常 manifest 下 :144 的冲突保护不起作用。
src/read/search.mjs:122 未含 uses／联表 revision；src/read/get.mjs:160 只验部分版本。没有证据支持报告所称一切 uses 变动都会 stale。
要测的是真实重复编译和分页期间状态变化；不能把“一个 pointer revision 变化能拒绝”当完整快照稳定证明。

5. **交付 hash 与 expected_ids 契约没有统一，新增测试认可虚假曝光。**
src/context/compile.mjs:363 生成独立 payload hash，src/context/delivery.mjs:50 却接受 section hash；新测试 :45 专门从 compilation 取后者。
test/p4-p4-delivery.test.mjs:55 拒绝正确组头回执，:64 人工加入 deferredMembers 才确认；:69 只验曝光 ID 前缀，未验延后成员零曝光。
这是实质测试口径偏移；decisions.md:163 的决定与设计稿 :197 冲突，应修合同而不是继续迁就绿色断言。

6. **主人回执旧测试多数确实升级了 hash，但 helper 的输入规范化不一致。**
test/p2-m2-judgment.test.mjs:281、test/p3-c1-dream.test.mjs:168 已提供真实 payload hash/baseVersions，未发现这些路径以“成功或 hash 错误均可”替代成功断言。
但 projectCreatePayloadHash 在 src/write/project.mjs:165 对调用方原始 snapshot 直接 hash，createProject 在 :194 补齐四个 null 后才验 hash。
因此按公开 helper 批准 snapshot={} 再原样调用 createProject 也会 hash_mismatch；旧测试在 test/p2-m3-project.test.mjs:63、:72 手动补 null，掩盖接口不一致。
旧任意 h-N 回执被严格拒绝本身正确；还需统一规范化和处理旧待审批记录，不能靠每个调用方各自猜最终形状。

7. **新读字段既有错误来源，也破坏了字符预算。**
src/read/search.mjs:114 数的是 uses 行数，不是次数；src/read/get.mjs:56 查的 conflict 字段与 src/write/candidate.mjs:526 的 refs 不相容。
src/read/get.mjs:184 的观察整篇返回未更新 used、未分片；:90 的 observation_text 也未计预算，大原话可使 max_chars 失效。
这些是新增实现问题，不能归入“exam 暂未接”或“conflict 没写入口”的报告边界。

8. **门禁没有发现 CLI 绕过，但成功证据校验仍不一致。**
scripts/acceptance-boundaries.mjs:16、:79、:118 保留强制 gate；_build/artifacts/live-check-tools.json:191、:199 确有 tools 字段和 passed，不能据此指控报告被伪造。
残留漏洞是 src/gates/checks.mjs:147 的 inject 分支；另 src/runtime/tools.mjs:269 只看 tools.result 就给 capability passed，与 gateRequireLive 的严格程度不一致。
因此须区分注册能力标签、require-live 总门和业务执行能力，不能将一个 passed 扩大解释。
无业务作用的残留也存在：src/read/get.mjs:15 的 keyStatusOf 已无调用；src/context/delivery.mjs:14 的 expectedIds 不再被使用，接口签名仍暗示调用方可决定集合。

**四、剩余最该先处理的三件事（按不修的后果排序）**

1. **补齐可信批准与恢复链，消除“丢结果／换场景／撤销后继续有效”。**
不修会发生：已消费的梦批准永久无主库结果；生活捕获恢复到工作场景；已撤销梦记忆仍被当有效背景。
依据：src/dream/confirm.mjs:233、src/control/recovery.mjs:138、src/context/select.mjs:11；项目完整 payload 和锁内核验亦见 src/write/project.mjs:337、:519。
完成条件：意图／指针先可靠落盘，原始可信上下文可重建，最终 payload 与当前版本在锁内校验，撤销与续跑共同遵守来源有效性。

2. **关闭合并／导入的语义丢失和虚假切换证明。**
不修会发生：相同有效时间线、门牌合并后消失；导入掉记录或错关联仍 verify/cutover 通过；数量够就误称可回退。
依据：src/dream/organize.mjs:126、src/import/legacy.mjs:107、:506、src/import/rollback.mjs:15、src/tools/record.mjs:100。
完成条件：比较什么就完整保留什么；全入口核 exact；所有异常阻断切换，恢复并重放真实增量后逐项核内容和关系。

3. **重建交付、快照和验收判据，防止“少交付却报成功”。**
不修会发生：open 惦记被延后、最终载荷超 H、组内未展开成员虚增曝光；场景外计数泄漏，同 ID 快照还能被覆盖。
依据：src/context/compile.mjs:257、:324、src/context/delivery.mjs:34、src/context/snapshots.mjs:110、src/context/compile.mjs:47。
完成条件：真实 P 完整交付、最终全文预算复验、回执只认实际 expected_ids、延后零曝光、快照不可变，并让测试断言这些业务结果。
