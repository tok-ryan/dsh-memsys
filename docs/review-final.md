# memsys 最终复核

完整阅读了 memsys-design-v0.38.md、plan-1/2/3.md、report-1/2/3.md、decisions.md，以及 memsys/ 全部源码、SQL、脚本、测试和夹具。
另核对 report-3.md 引用的 _build/artifacts/live-check-tools.json；工具注册结论以这份产物为准。
以下是静态复核，没有运行实现测试、验收、导入、迁移或宿主探针；256/256 是主管报告的结果。
设计章节均指 whale-unify/memsys-design-v0.38.md；源码路径均相对 whale-unify/memsys/，交付文档路径相对 whale-unify/_build/。
行号指本次读取的文件；推导的失败路径不是声称已动态复现。
结论：已有真实实现和注册证据，但授权、恢复、数据保真与容量交付仍存在会改变业务结果的缺口，不能据全绿测试判定符合设计。
任务列出的已知未实现／未验证边界不重复计为新缺陷；下面指出的是额外的错误路径或报告证据范围。

**一、偏离清单**

**会丢数据**

这里包括操作结果丢失、业务字段丢失和来源失效未能正确传播；不把“旧行还在”当作业务结果完整。

L1．恢复把“对象存在”当成“本次事务成功”。
文件：src/control/recovery.mjs:40、:80、:108；src/control/readback.mjs:85；src/write/candidate.mjs:581、:656。
行为：恢复按 object_key 查当前行，不用 operations 固化的 payload/hash/事件集合；due 只要原 memory 在，就返回 found。
触发：已有惦记的变更在 reserve 后、业务提交前中断，原 memory 仍存在，恢复会把未执行变更结为成功并清失败数。
提升读回也存在从库中取 memory 再拿它当 expected 的自比较，不能证明等于批准的完整事务结果。
设计：§13.0.5、§13.0.6 要求对应提交版本、正文、关系及证据集合精确匹配；存在性不满足此判据。
影响：实际操作丢失却报 recovered_found，后续恢复不再补齐；现有恢复测试不能证明这条更新路径正确。

L2．观察保存后，没有可执行的 capture 恢复链。
文件：src/write/observe.mjs:105；src/control/recovery.mjs:56、:108。
行为：观察、capture-job 关系、输入序号分别写入；源码没有消费 capture-job 的恢复扫描器。
触发：观察已提交而 capture 尚未建立时退出，恢复只确认 observation 存在，既不补 capture，也不补固定记住命令对应记忆。
设计：§13.0.5 要求观察和恢复指针同事务，重启补建同一 capture；§15 明确覆盖模型整轮不发块。
影响：原话可能保住了，但承诺生成的候选／命令记忆丢失；不能用“观察条数仍为一”证明链路完整。
证据边界：test/m3-reliable.test.mjs 的相关断点主要核对观察保全，没有证明恢复扫描补齐 capture。

L3．梦确认的跨库断点不能自动续完。
文件：src/dream/confirm.mjs:79、:158、:170、:201；src/control/recovery.mjs:40。
行为：梦库写 confirm+快照后先消费主库 receipt，再创建主库观察／候选；重试入口会先拒绝已消费的回执。
快照未保全最终使用的时间、pointer、tags、weight、structuredValue 等全部字段，evidence_snapshot 只有 ref，没有原证据 hash。
触发：消费回执后、主库候选提交前中断；现有恢复只探 main 对象，没有按 confirmId 续跑跨库子步骤。
设计：§12.7、§13.0.5 要求完整快照、实际批准观察、原证据校验和服务自动补写；ownerObservationId 还允许为空。
影响：梦库显示已确认，主库可能永远没有结果；快照也不足以逐字重建批准的完整候选。
test/p3-c1-recovery.test.mjs 覆盖的是主库结果已在后的控制账故障，未覆盖上述两库之间的缺口。

L4．merge_exact 会合并并不精确相同的记录，丢业务区别。
文件：src/dream/organize.mjs:16、:24、:52、:111、:163；src/storage/repositories.mjs 的 getMemory。
行为：比较集合遗漏 detail/topic_key/credibility/due_state；读取的 memories 行没有 timeline/pointers 联表字段。
所以不同时间线／门牌可被当成两边都是 null；新候选又把这些字段写成 unknown/null，并把 due_at 置空。
open 未列入禁止合并状态；此外 supersede 写 oldMemoryId/newMemoryId，且 newMemoryId 实为 candidateId，与标准重放契约不一致。
设计：§12.6、§8.1、§13.0.5 要求完整字段与来源一致、合法状态和可重放的取代事件。
影响：自动整理可抹掉生效目录中的时间、门牌和惦记区别，旧正文仍存并不能抵消这项语义数据损失。
test/p3-c1-dream.test.mjs 的合并夹具使用空时间／未知门牌，未覆盖这些差异。

L5．旧内容导入未按字段保真，核验也检查不到这些损失。
文件：src/import/legacy.mjs:104、:225、:353、:374、:444。
行为：计划映射没有保留旧 detail、业务类型、due 和完整 origin；候选 text=raw、detail=gist，due_at 固定 null。
缺 raw 时用 gist 充 observation；来源仅写 migrated，不能保留旧梦链等来源约束。
核验侧重 raw／存在性，对缺失的 timeline/pointer/evidence、detail/due/origin 没有完整对应核对；图数量主要来自导入索引。
设计：§14.1、§12.4 要求原文、业务字段、来源限制保全；信息不足必须显式标注，不能以摘要替原文。
影响：带上述字段的真实旧记录导入后语义改变，verify 仍可能通过；夹具只含简化 raw/gist 不能支持保真结论。

L6．cutover 和 rollback-check 的通过条件不能证明可安全切换／回退。
文件：scripts/import-legacy.mjs:126、:159、:193；src/import/legacy.mjs:444；scripts/acceptance-boundaries.mjs:62。
行为：cutover 接受 verify.status 和恢复报告布尔值，没有把所有 unresolved/quarantine 等未解决项纳入阻断。
crossCheck 的序号大小关系只证明计数关系，不能证明备份之后的新增事实已保存并可重放。
rollback-check 主要检查 dataDir 与 restore.hash 标志，没有实际恢复、重放并逐项核对目标业务内容。
设计：§14.1、§13.0.5 要求完整核验、可恢复备份与切换后增量保全。
影响：演练门禁可能给出虚假的安全结论；这里挑的是隔离门禁本身不足，不重复“生产只演练”的已知边界。
acceptance-boundaries 用空临时库构造 restoreReport 的自一致结果，不能证明带业务增量的回滚能力。

**会出错**

E1．模型可用单独 promote_candidate 绕过场景扩大审批。
文件：src/write/candidate.mjs:242、:356、:497、:617；src/tools/record.mjs:225。
行为：创建 both/global 候选会停 pending，但 promoteCandidate 只核日常角色、pending 与可选 hash，没有重核场景扩大批准。
触发：模型拿到该 pending candidateId 后再调用 promote_candidate，即可进入正式记忆，不需要主人回执。
设计：§8.3、§13.5.1c、§13.5.5；decisions.md #8 也明确扩大可见范围属主人权限。
影响：原本隔离的生活／工作内容可被扩大投递；宿主写入口尚拒绝调用不等于底层权限检查成立。
test/m2-write.test.mjs:639 的场景扩大测试停在第一次 pending，没有继续调用提升入口。

E2．主人回执没有统一绑定最终 payload 与基版本。
文件：src/write/owner-actions.mjs:51、:75；src/write/project.mjs:155、:480；src/dream/confirm.mjs:23、:201。
行为：verdict 主要核 action/target，未绑定 result/basis；项目创建未逐项核批准内容，完成操作拿当前快照而非批准版本。
梦确认 hash 只含 action、dreamId、propositionId、textHash，不含 candidateDraft、确认路径和完整 evidence。
触发：同一个尚未消费的合法回执配上修改后的草稿／项目快照，仍可能写入未获批准的内容。
设计：§13.5.1c、§12.7 要求锁内核对已批准提案、完整 payload 与 baseVersions；防重复消费不能替代此检查。
影响：主人批准 A，落库却可能是 B，并获得 accepted 或完成等权限效果；测试中的任意 h-N hash 和空版本遮住了该边界。

E3．shelved-due 的恢复跳过重新待确认，直接进入 open。
文件：src/write/due-actions.mjs:295；test/p2-m4-due.test.mjs:339。
行为：shelved-due、pending-done、cooled-due 共用 to=open；测试也把 shelved 的这一行为断言成正确。
设计：§13.0.4a 的 shelved-due 必须先回 pending-due，重建期限和入队序号，再显式确认。
说明：该节另明确允许 pending-done/cooled-due 经回执恢复 open，不能把这两种恢复也误判成缺陷。
影响：从未确认过的搁置提案可由“恢复待处理”直接获得保护席位，混淆恢复与确认权限。
这不是已知的“容量退让没实现”，而是已实现状态迁移方向错误。

E4．due 准入检查不为目标预留真实三维容量。
文件：src/write/due-actions.mjs:41、:259、:299；src/write/project.mjs 的 projectTooLarge。
行为：只统计已有 open 的正文；不含硬层 P_h/K，调用时不传 H，目标只加成员数、不加目标字节与 token。
触发：现有 open 为空、目标正文超过字节上限，检查仍可允许确认；硬层已占满的情形同样未反映。
设计：§6.4 要求同一锁内计算目标＋硬层，并同时核成员、字节、宿主 token 额度。
影响：报告所称“能拒绝确认”只对部分成员上限成立；项目侧单独 JSON 字节检查也不是共享保护层容量检查。
现有容量夹具主要用很小的成员上限，没有证明单条过大、硬层占用和真实 H 下的准入正确。

E5．三败计数绑定 request，不足以冻结同一坏对象。
文件：src/control/ledger.mjs:99、:164、:200；src/control/recovery.mjs:199。
行为：连续失败数保存在按 request_key 找到的 operations，新请求新建计数；object_streams 只控制在途／冻结等状态。
触发：同一 object_key 已失败两次，换 revision/request_key，新的 operation 重新从首次失败开始。
设计：§13.0.6 明确逻辑对象身份不能随版本变化，坏对象换 revision 也不能绕过冻结。
影响：持续修改同一坏对象可避开第三败冻结；存在 object_stream 表不代表跨请求失败数正确。
test/m1-storage.test.mjs、test/m3-reliable.test.mjs 的三败场景复用同一请求，未覆盖换请求继续失败。

E6．梦确认撤销／void 不可靠地影响所有派生记忆。
文件：src/dream/confirm.mjs:222、:303、:330；src/dream/replay.mjs:21；src/context/select.mjs。
行为：主库 origin 不保留完整梦路径，读取不按当前梦确认折叠；unconfirm 信任调用方 memoryId，void 的 memoryIds 默认空。
触发：只提供 dreamId 执行 void 可成功，但没有对应主库 revoke 标记的派生记忆仍可能入选；漏传／错传 ID 同样有问题。
设计：§12.4、§12.7、§13.0.5 要求服务追踪派生链，每次读取参考当前确认状态，撤销不能留下永久有效缓存。
影响：已作废内容继续作为有效记忆出现；decisions.md #39 的“不建跨库 FK”不等于可以省去逻辑来源关联。
另有多次确认时只取最后 confirm 再判无效的折叠，未实现回退前一个仍有效确认；单确认、完整手传 ID 的夹具不足以覆盖。

E7．grouped 会延后保护成员，最终文本还可能超 H。
文件：src/context/compile.mjs:72、:215、:247。
行为：open 惦记参与普通压缩／分组；grouped 将所有组员移到 deferred，实际栏目清空，没有保留 P_s 原文。
预算判定先量 fixed/status/groupHeaders，再拼审核标题和完整梦文本，不重验最终 chosen.total.tokens≤H。
设计：§6.1、§6.2c、§6.4 要求 P 在实际条目中完整交付，软层退出需合法 due 退让，所有段共用最终硬预算。
影响：可能“成功 grouped”却隐去仍 open 的保护内容，或交付超过宿主预算的 section。
test/m4-context.test.mjs 的 H 从返回头预算反推，只断言分组，不能证明最终载荷和 P 完整。

E8．容量账记录的是占位量，编译未进入要求的持久失败控制。
文件：src/context/snapshots.mjs:162、:167、:179；src/context/compile.mjs:254。
行为：hard_count 缺 memberCount 时记零，soft_count 使用 codePoints；三类 over_streak 固定零。
protected_overflow 在持久化前直接返回；compileRound 未按 §13.0.6 建立该会话编译流的 reserve／精确读回／三败冻结。
设计：§6.4 要求两层成员、字节、token 和连续超限独立持久计账；§13.0.6 要求编译也受控。
影响：报表无法支撑预警、连续超限升级或重启延续；不能因表有字段就声称容量状态已落地。
此项针对账本与技术失败控制，不把已知 due 退让缺失重复列入。

E9．manifest 漏审核项与固定段，状态计数跨场景且取回入口不存在。
文件：src/context/compile.mjs:44、:47、:289；src/context/snapshots.mjs 的 getGroupPage。
行为：eligible_ids 只收 S、项目、pending-due 与梦；普通候选／pending／needs-review／固定段未纳入覆盖集合。
状态头的 due/review 计数未按当前 scene 过滤；给出的 __status__ group 没有对应持久组页。
设计：§6.2c、§6.4 要求覆盖全部合格对象、场景外不泄漏条数、状态报告可分页取回。
影响：coverage 可显示完整却漏待审内容，工作场景可泄漏生活待办数量，报告入口返回 group_missing。
“未出现场景外 memoryId”的测试不足以证明计数没有泄漏。

E10．回执校验会接受缺失分组描述，曝光还混入非 memory ID。
文件：src/context/delivery.mjs:23、:34、:79。
行为：比较前把双方 group: ID 都滤掉；expectedIds 取调用参数，没有绑定持久 manifest 的 expected_ids/round。
触发：真实交付只有分组描述时，receivedIds=[] 配正确 payloadHash，也可得到 confirmed。
所有 received 的非 group ID 均写 injections，未区分 project、dream、review 与逐条 memory。
设计：§6.2c 要求完整 expected_ids 集合相等，分组也须回执；曝光只记确实交付的 memory。
影响：可把缺失目录说成成功交付，并产生错误曝光；这是本地校验缺陷，独立于“宿主回执未验”。

E11．快照／游标不足以保证分页不拼接不同版本。
文件：src/context/compile.mjs:207；src/context/snapshots.mjs:91、:109、:131；src/read/get.mjs:134；src/read/search.mjs:99。
行为：snapshotId 不含查询、预算和梦状态，持久化又允许替换同 ID 的编译／组页。
get 游标主要保存 ID，后续页重新读当前投影；search 游标只有偏移，未绑定查询与冻结结果集。
设计：§6.4、§9.0a 要求同快照连续分页，输入／版本不匹配必须拒绝或给 stale_cursor。
影响：同 ID 快照可被重编译改变，变更期间翻页可重复、漏项或混用状态；顺序不变的静态夹具证明不了版本稳定。

E12．取回接口输出推测的权限状态，原始证据还不可直取。
文件：src/read/get.mjs:15、:47、:77；src/read/search.mjs:130。
行为：key_status 从 topic_key 前缀猜，binding_status 固定 proposed，conflict_marker 固定 false。
新 accepted 记录会显示 proposed；旧 NULL 状态可能被猜成 resolved，与 decisions.md #38 的 legacy_binding_unknown 相反。
evidence 返回引用列表，但 memsys_get 没有按 observation ID 取回该观察原文的对应路径。
设计：§6.2、§8.3、§8.4、§9.0a 要求真实语义／绑定／冲突标记及可取原文。
影响：模型无法据返回内容区分已批准、未知绑定和冲突，也无法完成设计承诺的证据原文核对。

E13．时间检索把点事件当成持续区间，且未实现证据均值。
文件：src/read/search.mjs:31、:130、:151；src/gates/checks.mjs 的 gateEvidenceMean。
行为：时间筛选不依据 time_state/precision/as_of；无 end 时替为查询上界，旧 point 也可命中后续区间。
仅给查询起点时上界为 null 的比较亦不正确；月／年区间展开与可能重叠没有落实。
此外有直接命中也固定返回 evidence_mean=null，只有公式字符串；gate 反而断言这种 unavailable 状态。
设计：§7.2、§9.1；后者仅零命中均值为 null，关系图未接不妨碍直接命中均值计算。
影响：返回错误业务时间命中，且不能提供设计规定的检索证据指标；第三批施工图 §7 要求的指标没有做成。

E14．梦浮现的资格和频次键使用错误对象。
文件：src/dream/surface.mjs:67；src/dream/replay.mjs；src/context/compile.mjs 的梦目录调用。
行为：有过 confirm 就压住整个梦，未按命题当前确认折叠；没有检查 void；以 basis 前缀充 topic key 记频次。
触发：不同梦碰巧同一 basis 前缀会互相限流，已撤销确认仍被视作确认过，void 梦仍可能候选浮现。
设计：§12.8 要求有效命题、合法关联、按规定主题身份和当前状态决定浮现。
影响：该出现的漏掉、不该出现的仍有机会出现；与已知“跨进程频次未验”是不同问题。
freshness 替代 R 的决定另列口径项，不混作这里的身份／状态错误。

E15．require-live 接受任意真值报告，失败格式不一致会冒充 passed。
文件：src/gates/checks.mjs:115；scripts/live-check.mjs 的结果格式；test/p3-c4-gates.test.mjs。
行为：只拒绝缺报告或 status==='failed'，其余对象一律 dynamic_status='passed'。
触发：{}、{status:'unknown'}，甚至 live-check 格式的 {result:'fail'} 都不能被这段判据排除。
设计：§2.2、§2.3、§15 要求动态能力有对应有效证据，不把 unknown 或失败转换成通过。
影响：--require-live 可能放行没有成功证明的报告；现有测试只覆盖缺报告、failed、passed 三种手写对象。
这不推翻已读取的真实注册产物，但说明同一个门禁不能可靠区分其它失败／未知结果。

E16．exact 门牌只核声明，没有读真实文件版本和原文范围。
文件：src/import/pointers.mjs:28、:66；src/tools/record.mjs:88。
行为：versions JSON 中 ID/hash/location 对得上就可给 exact，没有读取 location 所指原文并核对 span。
模型 pointer_change 只要求具体 location；路径存在与内容精确匹配未构成必要条件。
设计：§14.2、§14.3 要求指定真实版本与原文范围匹配；decisions.md #9 的“有位置”比设计弱。
影响：错误甚至不存在的路径可挂 exact；test/p3-c2-import.test.mjs:58、:157 使用未建立真实文件的 C:/legacy/... 路径仍断言成功。
这属于夹具掩盖的内容证明缺失，不是生产旧库尚未盘点。

**只是口径不同**

D1．自我裁决和生活窗口项目更新采用了更严格的能力边界。
文件：src/write/judgment.mjs、src/write/project.mjs；decisions.md #22、#30。
行为：存在 master 时连新的 self/auto pending 也拒绝；life 的模型项目更新直接拒绝。
设计：§0.5.3 允许 auto pending 提请复核但不改 master；§6.5 允许主人对特定 projectId/payload 授权生活窗口更新。
判定：不会因此扩大权限，但缩掉了设计允许的路径；这是已明确的施工决定，不能描述为完全实现原设计。

D2．梦相关性阈值改成 freshness 单维。
文件：src/dream/surface.mjs；decisions.md #40；report-3.md:29。
设计：§12.8 与 §6.3 的相关性口径要求结合 R；代码用 freshness≥0.45。
判定：决定与理由已有记录，报告也说明待校准，不属于偷偷伪造实现；仍需承认与唯一规范不同。
它不为 E14 的身份、void 或当前确认折叠错误提供例外。

D3．交付记录数量与个别阈值描述不一致。
文件：decisions.md 实际只有 #1–30、#35–42；report-3.md:25；report-2.md:12；src/write/due.mjs:10。
行为：任务／第三批报告称 53 条决定，但指定文件缺 #31–34、#43–53；不能把缺失决定当成已批准的设计豁免。
report-2 写未确认 15 天 shelve，而代码与设计 §13.0.4a 是 14 天；测试推进 15 天不证明阈值为 15。
判定：前者是审计材料缺口，后者是报告口径错误；没有据此推断运行代码阈值也错。

**二、假实现与夹具排查**

“假实现”在此只指交付表述超过实现／证据，不推断作者动机。

工具注册：不是空壳。
src/runtime/tools.mjs:171 与 index.mjs:53 确有 defineTool/register 调用。
report-3.md 的 C5 和 artifacts/live-check-tools.json 证明 10 个名称进入 schema、get 返回定义。
get_found 不是执行 get handler，更不是模型工具调用；因此“注册已验”成立，“业务调用可用”仍未验证。

投递回执：有本地函数，但不是严格按设计核验。
src/context/delivery.mjs 已能比 hash、写 deliveries/injections；E10 给出了错误确认的具体条件。
test/m4-context.test.mjs 主要 memory-only 的完整列表，不能证明 grouped/mixed ID 情况。
decisions.md #12 提到恢复重核，但该文件两库写之间没有对应可恢复子任务，不能把注释当恢复实现。

due 退让：报告已承认未实现，不再当新增发现。
新增的是 report-2.md:39 的“三维计算／拒绝确认”表述过满：E4 说明实际调用不传 H、不预留目标字节、不含硬层。
E3 的 shelved 恢复方向与 E8 的零 streak 也是已写代码中的错误，不能归入“等 policy 批准再说”。

梦浮现／确认／整理：有实现，但交付范围说大了。
report-3.md:7 的“完整快照、精确读回、撤销后退出 S”分别受 L3、E6 限制。
report-3.md:8 的“merge_exact 逐字段比较”不覆盖实际联表字段和漏列字段，见 L4。
离线单库、空 timeline/pointer、调用方给全 memoryIds 的夹具，会避开这些真实输入边界。

cutover／门牌：有演练逻辑，但通过条件不足。
L5/L6/E16 表明简化导入、空库 restoreReport 与伪路径能通过对应断言。
所以 report-3 的 24/3/8、replay_equal 只能解释夹具覆盖；不能推为真实旧记录保真或带增量回退成功。
这与报告诚实披露“真实旧库未导入”可以同时成立，不把披露过的边界另算缺陷。

feed provider：没有发现拿 fixture 冒充生产接入。
src/feed/filter.mjs 有真实纯筛选逻辑；src/tools/feed.mjs 无 provider 会明确返回不可用。
test/p3-c3-feed.test.mjs 与 test/fixtures/p3-feed.json 验的是筛选／零写入；index.mjs 未传 provider。
report-3.md 已披露生产 provider 未接，因此此项保留原边界，不要求把未实现说成实现。

验收门禁：不是所有绿色都证明规范成立。
E15 的动态证据判据、E13 的 evidence_mean=null 断言，以及 E3 对错误状态迁移的断言，属于“测试通过但判据偏离设计”。
256/256 不能覆盖这些未断言的行为；本次也没有重跑测试来制造新的通过声明。

**三、装进 DSH 能不能用**

加载／注册：已有指定隔离探针的成功证据，不能再一概写“没有注册”。
package.json 声明 ESM、index.mjs 入口、dsh.bundle.patch、Node≥22.13，并把 @deepseek-ai/dsh-tools 列为可选 peer。
cordis.patch.yml 插入 dsh-memsys；index.mjs:16 注入 tools 服务，apply 调 registerHostTools。
artifacts/live-check-tools.json 的 plugin_install/plugin_composed exit=0，注册列表含全部 10 个工具，errors=[]。
结论：在该产物记录的 DSH 环境，插件加载与工具 schema 注册有证据；其它安装环境的兼容性未验证。
该产物未绑定整包源文件哈希，不能把它解释为任何后续改动都已动态验证。

实际工具调用：未验证，而且部分 handler 明确不可用。
index.mjs:19 创建延迟 handler；:22 要求 config.data_dir 或 MEMSYS_DATA_DIR，否则读工具返回 data_dir_missing。
默认 cordis.patch.yml 没设 data_dir；有外部环境变量可满足条件，不能断言所有安装必失败，也不能称开箱即能读库。
:35 有真实读 handler；:41 feed 缺 provider；:42 的 record/dream_record/organize 固定返回 runtime_identity_unavailable。
:28 只延迟开库／迁移，没有接服务恢复、真实输入捕获或逐轮身份生命周期。
src/runtime/tools.mjs 的 execute 委托 handler；输出 schema 的 text 与实际结构化返回能否被宿主接受，未验证。
探针读取 schemas/get 定义，未请求模型调用；产物里的无操作回复也不能证明 dispatch。

自动注入：默认不启用，开启也没有接到业务编译。
cordis.patch.yml 设 auto_inject=false、diagnostic_section=false；index.mjs:110 的自动段只是固定 tools-only 提示。
入口没有把 compileRound、每轮更新和投递回执接进宿主生命周期，不能把底层编译器测试当成真实注入。
report-1.md:12 的“实测进 system prompt”超过所示 marker 的证明范围：index.mjs 的 marker 证明段注册，不证明模型收到内容。
scripts/live-check.mjs 的 inject 判据同样依赖注册标记，真实同轮系统消息、预算和回执均未验证。
因此可用结论是“隔离宿主已加载并注册工具；业务读写和自动记忆链未闭合”，不是“装上即可按设计运行”。

**四、最该先修的三件事**

1. 封住未经完整批准就生效的入口。
不修会发生：模型两步调用扩大场景，或合法回执批准 A、实际写 B，并获得 accepted／完成权限。
范围：E1/E2，落点 candidate.mjs、owner-actions.mjs、project.mjs、dream/confirm.mjs。
完成标准：提升再次核权限；回执绑定最终完整 payload 与基版本，内容／版本／场景任一变化都不得沿用批准。
这是权限与来源可信度底线，不能靠宿主当前拒绝写工具掩盖。

2. 保证中断后只报真实提交，并能续完观察与梦确认。
不修会发生：原对象存在就被恢复成成功，命令 capture 或已批准梦结果永久缺失，重试又被已消费回执阻断。
范围：L1/L2/L3、E5/E6，落点 control、observe、dream/confirm 与来源读取。
完成标准：按固化事务结果精确读回；按逻辑对象累计失败；恢复指针／跨库步骤可续；撤销按来源链即时折叠。
这应先于接真实输入，否则系统会持续产生“说已记住，实际未完成”的状态。

3. 在真实数据导入或自动整理前，修正保真映射与切换证明。
不修会发生：时间、门牌、due、detail、梦来源在合并／导入中丢失，核验仍可能通过，回退也未证明保存增量。
范围：L4/L5/L6、E16，落点 dream/organize、import/legacy、import/pointers、scripts/import-legacy。
完成标准：完整业务字段与实际源版本核对；有区别就不得 exact merge；未解决项阻断切换；回退证明覆盖实际业务增量。
保留旧行和通过空库／简化夹具都不能替代上述条件。
