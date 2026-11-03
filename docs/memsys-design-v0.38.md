# dsh-memsys 设计稿 v0.37

这份稿定义行为、字段、权限、失败出路和验收条件，不是实现。DSH 钩子没有动态验过；不拿设计自检冒充运行成功。
本版完整读取 _review/codex-task-v037.md、memsys-design-v0.36.md、_review/opus-v0.36-review.md；v0.35、v0.36 原件与旧版修改史保留，本稿只有一份现行规范。
保留：一份主记忆、两个窗口、时间线四态、来源传染、只追加的事实与事件、self note、判断账、独立梦库、目录与全文分离、项目 Overview。只修未注册实体入口与容量降级，明确自建。
所有具体日期、距离和审计时刻由系统读取；本稿的时长是策略参数，不是对实际发生时间的估计。

## 零点五、判断分级与留痕

主人定调：事实资格可以由我判断，推断太远的东西不能做事实。判断要能查、能推翻，不能靠来源看起来干净就升级。

### 0.5.1 谁判断，谁执行

| 层 | 负责什么 | 不负责什么 |
|---|---|---|
| 主人 | 主人专有裁决、授权、纠错、确认梦命题、注册实体别名 | 代写 self note |
| 日常模型 | 值不值得记、文本解释、冲突建议、自己的判断与反思 | 伪造主人权限、系统时间、来源、topic_key |
| 本地钩子／受控服务 | 角色、签名回执、字节匹配、枚举、引用、来源图、版本、哈希、事务 | 理解指代、判是否复述、判证据现实独立、猜两句话是不是一回事 |
| 做梦会话 | 自己的梦与 self note；提出整理和复核建议 | 给自己的梦开证明、替主人裁决 |

“钩子核验”在全文只有结构含义。原话包含某个 id，并不证明主人授权了某动作；来源图没有梦，也不证明材料是独立现实证据。

| 错了谁能发现 | 产物 | 必须留什么 |
|---|---|---|
| 主人能发现 | 直接陈述的记录，或模型的日常解释 | 原始观察；解释仍标作者及语义状态 |
| 只有我可能发现 | judgment，必要时关联候选 | 结论、依据、来源、能推翻它的条件 |
| 谁都难发现／超过两步推断 | speculation | 推断链、依据、反证条件；不得进入自动事实注入 |

换主语或扩大范围各算一步，是模型的自检规则，不是钩子能验证的语义证明。拿不准就 speculation。一次情绪不能自动改写稳定偏好。

### 0.5.1b 两套时间不能混

recorded_at、observed_at、created_at、at、promoted_at、last_touched_at、due_done_at 全由系统盖；模型传入的审计时间丢弃并记违规。
start/end/due_at 是业务时间，只从有引用的原文抽取；没有就 null、精度 unknown。记录时间永远不能悄悄变成发生时间。
主人通过明确操作“从本次声明生效”时，另存 effective_from=该输入的 observed_at、time_basis=explicit_declaration；它只决定声明的适用顺序，不补 start。自由文本里的“现在”不触发这个操作。

### 0.5.2 判断与结果分开存

judgments 初始行含 id、at、phase(work/life/null)、verdict_text、basis、falsifier、evidence_refs、evidence_origin、topic_key、outcome。
outcome 为 pending/done/reverted/failed，表示动作结果；verdict.result 为 right/wrong/pending/unverified，表示判断对错。两个 pending 看字段名，不混用。
动作结果变化追加 outcome-change；原始判断行不改。状态转换要带 baseRevision、from、to、why、evidence_refs。done 必须带证明对象，不能只写“完成了”。
结构化测试工具的 operationId+exit_code 能证明那次命令成功，不能证明整个项目完成；自然语言“完成”仍是模型解释，标 semantic_status=proposed。
写入口和触发见 13.5.1b；反思里说某判断错了，要引用 judgmentId，不另造一份判断账。

### 0.5.3 对账触发、权限和老化

| 触发 | 产生什么 | 权限与边界 |
|---|---|---|
| 主人接受针对明确记忆的纠错操作 | 关联 judgment 追加 master/wrong | 纠错回执必须列出 judgmentId；不沿关联图猜主人否定了多少条 |
| 新候选／记忆与判断的规范 topic_key 相同 | needs-review，reason=topic_collision | 键相同只说明应复核，不代表相悖或一致 |
| 日常模型读完新旧证据 | auto 的 right/wrong/pending 建议 | 保留比较依据及反证条件；不是事实认证，不提升来源可信度 |
| self note 明确反省某个 judgmentId | self/wrong 或 needs-review | self 不许 right；只提交笔记不会自动猜它否定谁 |
| 老化扫描 | 无 verdict 则 auto/unverified；仅 self 则 needs-review；有 master 不动 | 从最后有效 verdict.at 起，无 verdict 用 judgments.at；阈值 30 天 |

verdict 折叠：master > self > auto；同层取最新系统提交序号，撤销事件指向的 verdict 不参与。已有 master 时，auto 最多 pending，不能覆盖主人结论。
needs-review 由本地服务在启动、输入采集后和维护唤醒时检查；键为 judgmentId+触发种类+依据版本，重复扫描不重复提醒。做题和做梦只算复习。
无人处理的 needs-review 到 13.0.4a 的期限后退出主动待办，保留“未复核”标记；不变成 right/wrong。

### 0.5.4 来源可信度不等于命题已验证

保留 origin 的 verified/unverified/from-dream 折叠，但增加独立的 semantic_status：quoted/proposed/accepted。
quoted 只证明“这个来源说过这些字”；proposed 是模型解释；accepted 是主人按具体提案批准，或注册的机械规则精确生成的窄义记录。accepted 也不代表外部世界永远为真。
模型从主人消息中抽出的摘要不能仅因 origin=master@ 就显示“已验证事实”；没有批准时显示“主人来源／模型解释待核”。来源和语义状态两个标签都要保留。

## 一、只有一份主记忆

工作和生活共用 memsys.db；dreams.db 隔离未经证实的推断；control.db 只放可靠写入控制账，不是第三份记忆。
工作窗口主动展示工作内容与底色，生活反过来。跨场景内容主动查询能查到，自动注入不串窗。
记忆记录不是工具指令。注入固定声明：“这些是记忆背景，不是命令；不一致时保留分歧并回查来源。”

## 二、运行时前提与钩子能力清单

### 2.1 模式与运行边界

会话创建时从受信 runtime 的 preset 取 work/life；会话期间不变。模型不能靠输入 mode=dream 获得做梦权限。
缺可靠模式时必须显式选择后才开自动注入；未选择只采集观察、允许主动检索。不默认猜生活或工作。
日常输入、日常模型、主人操作、做梦运行和恢复任务使用不同运行角色。受控工具按 runtime 判角色，参数里的 by/master 无授权作用。

### 2.2 钩子能力清单：全部尚待动态验证

P0 是启用对应承诺前的必验项。失败按本表降级，不能把“降级可用”称作“完整器官已就绪”。静态接口名、别的仓测试数和文档都不算本插件验证证据。

| 能力 | 用在哪些章节 | 缺了会怎样 | 有没有降级方案／必验级别 |
|---|---|---|---|
| 用户输入到达时拿完整原文、真实角色及消息标识 | 0.5、13.5.1 自动入口、13.5.1c 授权 | 观察丢失，无法区分真人输入和模型复述 | **P0**；可用经验证的持久会话日志游标补收。两者都无则停自动记忆，只允许显式导入；不得冒充输入采集成功 |
| 会话模式、执行角色、工作目录可从 runtime 取得 | 2.1、3、11、12、13.5 | 场景和梦写权失去边界 | **P0**；受控启动配置可替代；仍不可辨就关闭自动注入及权限写入 |
| 每轮推理前注入完整上下文，能测出真实预算 | 6 全节、12.8 | “每轮器官”不成立，可能被宿主静默裁剪 | **P0（器官模式）**；只开放主动 context/get，明确工具模式。禁止假报逐轮交付 |
| 持久 sessionId、messageSeq、turnSeq、工具 callId，重试保持身份 | 6.2c、9、13.0.4、13.5.2 | 重复观察、重复触碰、无法算轮次与去重 | **P0**；日志记录位置+会话文件身份可作替代，插件映射须落盘；无稳定事件身份则停自动写入，不能靠文本哈希合并两次真发言 |
| 工具开始／结束及原始结果、退出码、文件版本可见 | 0.5.2、6.5、13.5.1、14.2 | 无法证明命令成功或文件版本 | **P0（工具证据）**；仅从 memsys 自己包装的工具采集；其它工具返回只作未验证材料，不能伪造成功 |
| 受控写工具可调用并返回结构化回执 | 11、12.5、13.5.1b | self note、猜想、整理工具没有实用入口 | **P0（完整模式）**；先保留自动输入采集；日常文本块只是可选兼容，不算同等可靠替代 |
| 取得最终助手输出及 turn_end；能区分流片、重试和最终版本 | 6.2c、13.5.1b 兼容入口 | 文本块与使用反馈收不到 | 非自动入档前提；关闭文本兼容，反馈 unknown，主写入口照常。不得无限等输出块 |
| 隐藏结构化文本块，不显示给主人 | 13.5.1b 兼容入口 | JSON 泄漏到聊天，挤占回答输出预算 | 非 P0；默认关闭文本块，只用工具，拿到实测能力才可开启 |
| 上下文投递回执可查询，含 roundId、完整 payload hash、覆盖集合 | 6.2c、6.4、13.0.5 | 编译成功不等于模型收到，曝光无法确认 | **P0（曝光闭环／全量承诺）**；无回执只记 delivery=unknown，停反馈计数；不能把本地编译算全量交付 |
| 主人确认面板或完整消息命令可以验证身份、绑定提案 | 8、12.7、13.5.1c | 自由文本无法安全授权专有动作 | **P0（主人专有动作）**；受信用户消息的固定命令语法可替代面板。两者都无则挂起专有动作 |
| 维护唤醒、冷会话执行、截止扫描 | 0.5.3、11.1、12.5、13.0.4a | 无输入时不会收尾、写日记或做梦 | 非核心 P0；每次启动及输入补扫。离线期间不声称已执行；启用定时做梦前须验“投递后确实执行” |
| SQLite 写锁、持久化、文件读回、系统时钟 | 7、13 全节、14 | 不能承诺只追加、精确时间、重试恢复 | **P0**；控制账不可写时 fail closed，停写并报告；不退回无锁 append |

### 2.3 证据与开关

每项验证结果存 config.capability_report：宿主版本、插件版本、能力名、passed/failed/unknown、实际请求与结果证据路径/hash、替代路径、验证环境。unknown 不能当 passed；宿主升级后受影响项重新变 unknown。
最小动态用例：跨轮注入、双窗口并发、输入后输出前中断、重复回调、模型完全不吐块、工具参数错、投递后进程中断、重启恢复稳定 id。记录实际观察结果，不只记 exit 0。
验不出的能力关闭对应开关。启动时给一份简短能力状态；不把每次缺块都变成主人待办。

## 三、场景、底色与入档快照

### 3.1 场景

scene=work/life/both，scope=global/work-only/life-only。scene 默认取窗口，scope 默认取该窗口专属；both/global 必须来自主人批准或已注册的底色规则，模型只能提议。
身份、偏好、约定不自动等于底色。“代码先跑测试”可以只属工作。识别到另一个场景的词只作提示，不自动改归属。
场景改动按新候选／明确 reclassify 事件追加，原场景和来源保留；事件必须有主体批准，禁止模型静默扩大可见范围。

### 3.2 入档快照：只记录当时拿得到的

observations、candidates、memories、judgments、speculations、self_notes 都有 immutable 的 state_snapshot JSON；每个对象首次写入时各盖一份，不拿候选时刻冒充提升时刻。

| 快照字段 | 取值与来源 | 不可得时 |
|---|---|---|
| captured_at | 该对象首次入档尝试的系统时刻；控制账先固化 | 控制账/时钟不可用则不写 |
| phase | runtime 的 work/life/dream/maintenance | unknown，禁止猜场景 |
| session_id / round_id | 受信运行标识 | 非交互维护允许 round_id=null，并写触发 operationId |
| active_project_id | 已批准的本会话项目 id | null |
| energy / emotion | 同一输入包内的显式状态选择，或用户固定字段；附 source_ref | unknown；不读措辞、不由模型推情绪 |
| state_source_refs | 提供精力／情绪值的真实观察 id | [] |
| initial_strength / strength_policy | 首次入档时计算，策略 initial-v1 | 沿用确定的中性缺省，不事后估 |

initial-v1：base=0.5；精力 high/normal/low/unknown 的增量为 +0.1/0/-0.1/0；情绪强度 strong/normal/unknown 为 +0.1/0/0；夹到 [0,1]。这些是排序初值，不是心理测量，也不提升可信度。
没有明确当轮状态就用 unknown，不能沿用过期状态猜“当时心情”。情绪名称只作上下文；只对显式强度档计分。
initial_strength 入档即固定，不随补证据回填、不随重启重算、不由后来的主人解释改写。更正“当时其实很累”另记观察。新版本可以有新快照，旧版不动。
重试同一写入复用首次冻结的快照；真正提升创建 memories 时采自己的快照，并保留 candidateId 供追溯。迁移记录明确 phase=maintenance、energy/emotion=unknown，不重建历史心理状态。

## 四、记忆条目及不变量

| 字段组 | 现行含义 |
|---|---|
| id / idempotency_key / promoted_from | 系统生成；一候选最多提升一次 |
| type | identity/preference/promise/episode/fact/emotion/procedure |
| scene / scope | 展示边界，见 3.1 |
| text / detail / why | 一句话结论／展开摘要可空／为什么值得记必填；原文在 observation |
| tags / topic_key | tags 是检索标签；topic_key 是 8.3 的受控实体属性键，不能互相替代 |
| origin / credibility | 必填来源图及自身层级；读取时重新折叠，见 12.4 |
| semantic_status / record_kind | quoted/proposed/accepted；assertion/utterance。utterance 只记“说了什么” |
| judgment_id / evidence | 第二档判断必须可追溯；依据只在 evidence 表规范化存一份 |
| state_snapshot / initial_strength | 第三节的不可变入档上下文与初始强度 |
| start/end/prec/time_state | 在 timeline；不和审计时间混 |
| due_at / due_state / due_done_at | 到期业务值与完成投影 |
| weight / last_touched_at | 重要度 0..10，默认 5；活动投影不改发生时间 |
| lossy | 0/1；原文／摘要确有缺失就为 1，不把目录压缩写成存储损失 |
| recorded_at | 首次写入系统时间 |
| 状态 | 不存 memories.status；由事件折叠 active/已被取代/退休/记录有误 |

事实、原文、来源和入档快照只追加。投影的可变范围在 13.0.3 列全；不能为了重归组或补时间偷偷改旧行。
冲突和待裁决是组／提案状态，不是假造第五种 memories 状态。active 表示当前保留可检索，不意味着已被主人认可。

## 五、哪些值得记

### 5.1 日常语义入口的标准

值得留，而且以后不能可靠、便宜地找回，才成为日常 assertion。满足一项即可：改变以后选择、解释为什么、描述持续状态。
git 能重建的代码差异不重复背一遍；为什么改、主人口头判断和会丢失的上下文值得留。寒暄、一次性操作和一次情绪不自动升成稳定结论。
模型判值得记仍须留 why 和证据；高推断写 speculation。钩子不拿关键词冒充“理解了价值”。

### 5.2 自动采集不等于自动相信

所有受信输入原文先存 observation；这不是“全是记忆”。输入侧机械生成 capture 候选保证不漏入口，普通 capture 有自动收尾，见 13.0.4a。
不靠模型的实际入档路径是固定用户命令 `记住：<非空原文>`：整条受信用户消息必须符合这个语法。自动产出 episode/utterance，text 逐字保留冒号后的内容、why=“主人显式要求保留原话”。
这条记忆的语义只是“主人要求记下这段话”，semantic_status=quoted；不解析成主人已经确认其中所有事实，不设偏好、不取代旧条、不从引文生成授权。
没有这条固定命令的普通消息仍自动生成 capture；缺块不会丢观察，但不会假装已经理解所有话。自然语言捕获率是效果问题，不能用多存原文掩饰。

## 六、每轮交付：全量目录、压缩与分组降级

### 6.1 先定全集，再排序

本轮事实目录集合 S 为：重放 active、来源可安全折叠且不是 from-dream、scene/scope 允许本窗口且未冷却的全部 memories；due_state 为 pending-due/shelved-due/pending-done/cooled-due 的条目排除，分别留审核／历史报告。包括 quoted/proposed 和未归组记忆，每条保留语义与归组标记，不能包装成确定事实。梦、speculation、self note、退休和已取代正文不进入 S。这些是类型／可信度／权限边界，不是为了省预算删条。组内场景外成员只显示“另有受场景限制的成员”。同 resolved topic_key 成语义组；unresolved 不合语义组。常态交付各成员目录，容量降级按 6.4 的展示分组报告未展开项；展示分组没有裁决权限。跨栏目重复 id 只交付一次，附全部栏目标志。相关度只决定顺序和摘要长度，不决定 S 资格。未归组条目在场景不符、缺合法 scope、来源含梦／无法安全折叠、非 active 或已冷却时不进 S；权限提案仍进审核区，不能冒充生效记忆。条目数量不会扩大权限。保护集合 P=P_h∪P_s：硬保护 P_h 为本窗口合格的主人固定声明与边界、安全条目、当前项目快照、时钟与背景声明；软保护 P_s 仅为合法 open 惦记（含无日期）。两者独立成员账；惦记不能兼任硬保护，固定声明须单独条目与授权，不得靠 promise、期限、标签或模型解释制造硬保护。P_h 永不自动冷却／省略；主人声明／边界须绑定操作，安全条目须主人标记或已批准的机械安全规则。P_s 仅在 open 期间逐条完整交付，先按 13.0.4a 退出再冻结本轮 P，不能把未交付的 open 偷算成已交付。模型提取（自动采集、工具、文本块、整理建议）的 promise／带 due_at 条目只入 pending-due，不进 P；引用主人原话或期限也无例外。只有完整受信 `/mem due` 声明、主人显式确认 pending-due、主人在受控面板亲建惦记可开 open，均绑定 13.5.1c 回执；普通“记住”不等于建惦记。

| 栏目 | 成员 | 排序 |
|---|---|---|
| 现在 | 系统时钟、全局 last_spoke_at、能力状态 | 固定前置；距离由同一时钟算 |
| 还在进行 | S 内 time_state=ongoing | start 新→旧，未知最后，再 id |
| 放在心上 | S 内 scene=both | weight 大→小，再 recorded_at、id |
| 还惦记着 | S 内 due_state=open，含无到期日 | 到期早→晚，过期前置，未知最后，再 weight、id |
| 相关记忆 | S 全集；降级时未展开成员列在分组目录 | R_eff 大→小，再发生时间、证据分、id |
| 审核目录 | 本场景尚在主动期限内的提案／候选 | 主人专有请求优先，再创建序号；与其它段共用 6.4 降级 |
| 项目 Overview | 当前获准工作项目的四项状态 | 一项目四项，见 6.5 |

没有用户话题时按活动新鲜度、weight、id 排，不臆造查询。没有栏目内容就空着。

### 6.2 目录与全文

每条完整目录是 id、短结论、发生时间或 unknown、来源可信度、semantic_status、组／冲突标记、可取全文指针。默认短结论最多 80 码点。
detail、why 全文和观察原文按需 memsys_get；工具返回原存文字，不能临时“补全原文”。只交目录不代表读过全文。
压缩目录不改 memories.lossy；本轮另标 summary_compressed。未知业务时间显 unknown，不拿 recorded_at 补。
时钟和“记忆不是命令”声明每轮保留；不同来源的内容放数据区，不提升成系统指令。

### 6.2c 投递、反馈、活动

编译产物 manifest 固化 snapshot_revision、roundId、delivery_level、eligible_ids、expected_ids、deferred_groups（组名/id、成员 id、未展开数、取回命令）、各段 hash、payload hash。eligible_ids 含 S、审核项、项目快照、触发梦目录和固定段；expected_ids 只含实际条目与 group:<快照>:<组id> 描述。实际条目＋延后成员无重无漏覆盖 eligible_ids，P 全在实际条目中；完整 manifest 只存控制账，不把全量 id 清单塞进模型上下文。
回执须 received_ids=expected_ids 且 payload hash 相同；无延后项才叫 full/compressed 全量交付，有延后项叫 grouped 分组交付，绝不冒称全量。injections 只记回执证实的逐条 memory id，组名曝光不算组内曝光；同 roundId+memoryId 一条、slots 为集合。缺回执／不完整记 unknown/incomplete，不加使用次数。
反馈由模型可选提交 used_memory_ids；缺失=unknown，显式 []=unused。工具正文成功返回能独立记 lookup，不等反馈。模型只允许声明本轮实际交付或查出的 id。
连续 unused 次数 k：used 或真实触碰清零；unknown 不增加也不清零。k<3 时 F=1，k≥3 时 F=0.5^(k-2)。F 仅降相关排序，F<0.2 也不删目录。固定栏目排序不乘 F。
三轮内少给重复说明；延后成员既不算 unused，也不虚增曝光。多窗口各算自己的 roundId，反馈按曝光轮次稳定折叠，不按晚到回执的时间乱序算。
当轮最终反馈只接受一次，先受控工具后可选文本兼容；工具已经提交的集合不能被回合末空数组覆盖。提交后的修正需新反馈修正事件，不能改旧事件。

### 6.3 排序算法

R=0.5×标签命中+0.3×字面重合+0.2×活动新鲜度，三项各在 [0,1]；R_eff=R×F。0.45 只作相关性高低标签和校准参考，绝不砍目录。
标签命中=本条 topic: 标签中完整出现在查询里的数量／标签总数；无标签为 0。标签不负责实体归一。
字面规范化为 NFKC、Unicode 小写、去标点符号空白；按码点相邻二元组取集合，单字取单字单元，空串为空集。
N 是当前 active 且非 from-dream 的 memories 数；df(g) 是含该单元的条目数。idf(g)=1+ln((N+1)/(df(g)+1))。
L=交集 idf 和／并集 idf 和；空并集为 0，结果夹 [0,1]。规范化后的非空整句相等自然为 1；子串不直接满分。
词频缓存 state.lexical_stats 绑定源 revision，增删状态／来源折叠变化后标脏；打分前同一快照重建，不混旧 df 和新 N。
活动新鲜度=initial_strength×2^(-age_days/H)。age_days=max(0,now-last_touched_at)；weight 0..3/4..7/8..10 对应 H=15/30/90 天。
证据分不乘 R，只破同分；注入不增加证据分。阈值、半衰期和初始强度都是待校准参数，不引用别的项目数字当自己效果。

### 6.4 预算不足的确定处理

默认软预算 3,200 Unicode 字符；真实硬预算 H 从宿主取得，用宿主 tokenizer 或经验证的保守上界复核，同时记 UTF-8 字节数。K 为最小分组／状态报告头的保守预留，按至多 12 组及计数字段实测上界；固定开销 K 计入硬层字节／token，不计成员，成员按稳定对象 id 去重，字节不能冒充 token。先补扫惦记并执行下述软层退让，再冻结 S、P、审核全集和已触发梦目录，所有段共用 H 与 manifest。P 不压掉边界、否定、条件和安全正文；其余目录允许压缩。P 的正常上限同时为 64 个成员、12,288 UTF-8 字节、0.60H token；硬层含 K，软层仅可用剩余额度，三项任一先到即算满。硬层添加／扩大须在提交前校验三项上限；不够则保留待确认提案，报告需修订的固定项／增容，不默默添加。存量因宿主预算缩小或强制安全正文增加而越限时，标 hard_over_cap、软层清空并禁止新增；硬层仍完整交付，只有硬层自身（含 K）超 H 才是 protected_overflow，不以治理上限冒充宿主装不下。

| 条件 | 动作 | 是否算成功交付 |
|---|---|---|
| 完整目录在软预算与 H 内 | 常态全量目录，原样交付 | 完整回执后 full |
| 超软预算 | 非 P 条目依次压为 40、20、8 码点；共用图例，保留 id、语义／冲突标志及结论；仍超软但不超 H 可带量交付 | 完整回执后 compressed |
| 逐条最小目录超 H，P＋分组头可装下 | 固定段 P＋分组目录＋每组未展开计数＋展开命令；非 P 逐条目录延后 | 完整回执后 grouped，capacity_insufficient=true，自动注入继续 |
| P_h＋K 超 H（P_s 已清空） | 返回 protected_overflow、硬层量／H／差额及软层退让报告；保留硬层全文供分页，显式报错，尝试已验证的同轮多段或更大上下文 | 全段进同轮才成功；否则 incomplete，不裁硬层冒称成功 |
| 宿主支持同轮完整多段／能力失效 | 多段共用 manifest，全段回执后启动推理；静默裁尾／无预算或回执保证则按 2.2 能力闸门退工具模式 | 不完整回执不得冒称成功；容量分级不能掩盖宿主故障 |

展示分组按服务字段固定为“工作／生活／跨场景”×“已归组记忆／未归组记忆／审核项／未验证梦”至多 12 个顶层组；组内按 topic_key 或对象 id 分子组。记忆／审核取自身 scene，梦取本轮合格 linkedIds 中 id 最小者的 scene，每项只属一组；场景外不泄漏条数，空组不列，分组不合并实体、不扩大授权。降级头必须逐组给出“生活·未归组记忆（life:ungrouped）：未展开 37 条；memsys_context_get(snapshot_revision=R,group_id=life:ungrouped,cursor=null,max_chars=8000)”这样的三件套；实际组名、计数、R 由服务填满，禁止“另有 N 条”。所有非空顶层组都在头内；首个组页给子组总数、目录分页及各子组取回入口，不要求子组全集塞一页；P 单列成员不计入未展开数。memsys_context_get 返回同快照组名、总数、本页目录、剩余数、子组目录与 next_cursor；大条目按 9.0a 分片。cursor 绑定快照与组，不允许丢页、重复计数或拼接新版；stale_cursor 返回新报告入口，须从新快照重取。已投递快照默认保留 30 天，主人可延长；重启不丢游标。control.db 由服务逐轮分别记 hard_count/bytes/tokens/H、soft_count/bytes/tokens/H、K、各上限／余量、退让前后值、due_report_id；另记 payload_bytes、full_directory_bytes、tokens/H、group_count（顶层／子组）、eligible_count、deferred_count、soft_over_streak、hard_over_streak、protected_over_streak、回执态及策略版本。报告必须并列硬／软两行，不能仅报 P 总量；同 roundId 不重复计，模型自报无效，重启保留。超限按压缩前软预算／压缩后硬预算分别判；成功分组不清 hard_over_streak，恢复预算内才清；protected_over_streak 只数 P_h＋K 超 H，软层满额绝不增加它。每轮状态头给 pending-due、shelved-due、pending-done、cooled-due 各自计数和可分页报告入口，按场景过滤，不把这些条目正文塞回 P。
默认预警：full_directory_bytes≥10,240 或最小逐条 tokens≥0.7H 或子组≥80 或 soft_over_streak≥2，先生成可分页分组报告及冷却／coexist 收敛清单；升级阈值为 12,800 字节、0.85H、100 子组或 soft_over_streak≥3。hard_over_streak=1 即报主人，≥3 只维持 grouped 并重发变化报告，不因此停注入。普通归档冷却只改交付投影、不改 active、不删原文：预警后服务仅对非 P、无开放待审、无 ongoing、无 open 惦记且 90 天无真实触碰的条目追加 delivery-cool；首次启用需主人批准。报告逐组列冷却数及 memsys_context_get 同组 view=history 入口，不混入 S／未展开数；正文 lookup 或主人 restore 追加 delivery-restore，下轮回 S。pending-due/shelved-due/pending-done/cooled-due 不套此政策，lookup 只能检索，恢复按 13.0.4a；未授权政策只给提案。coexist 收敛仍只对 12.6 合格重复机械合并，其余等主人批准，不能为省容量伪造一致。P 任一维度达上限 80%（条数向上取整）先持久化“可收口惦记清单”：明确完成信号、超期无提及、无日期沉寂、其余压力退让分别列 id／版本／原文指针／依据／状态／恢复入口；带 `/mem due-batch <reportId> <payloadHash>` 的可审阅批次，主人执行才可 done/dropped。达到上限或预计新增会越限，先确保清单及可见通知入账，再由服务按 13.0.4a 转 pending-done／cooled-due，直到三项都≤上限 70%（条数向下取整）或软层为空；报告生成不等于主人确认，也不等待确认阻塞退让。排序：合格完成信号优先，其次超期沉寂，最后按服务 last_due_mention_at 最旧、open 提交序号、id；必要时近期／未来到期项也可 reason=capacity 冷却，逐项显明，无静默豁免。硬层独占超 70% 时清空软层即可，不反复循环。
新增／恢复须在同一锁内为目标预留空间，再退让其它软项；目标加硬层已达任一上限则返回 due_capacity_blocked，保留 pending-due／原冷却状态，不假称已 open。预留目标不能再退让，回落循环以达 70% 或其它软项为空为止；可高于回落线，但必须低于三项上限，避免恢复即冷却或循环不收敛。首次启用须主人批准整套 due-policy-v1（含容量退让）；未批准时只收 pending-due、存量不启自动保护承诺，不运行无出口的 open 策略。增长测算仅用目录字节估计：假设硬层连 K 为 4,096 字节／16 成员，每条惦记目录 256 字节，软层字节余量容纳 floor((12,288−4,096)/256)=32 条；每轮另验真实 token，实际容量可能更少。若每日确认 2 条且无出口，16 天填满此字节余量；模型每日提取 20 条而无人确认时 P_s 增量为 0，pending 最多 100 条。以上是待实测校准的假设，不是测量；无论输入速率，服务依确定上限退让，历史库仍增长。只有主人显式关闭，或 protected_over_streak≥3 且仍无法完整交付硬层时，才容量降级为 auto_paused；保留可见状态、两层账、逐组报告和分页入口，只读重测预算。P_h＋K 恢复≤0.8H 即自动恢复 grouped，再按余量接纳软层；主人关闭须主人恢复。容量状态不计 13.0.6 技术三败冻结；能力故障仍按 2.2，编译／读回失败仍按 13.0.6。

### 6.5 项目 Overview

projects 只有身份、名字和创建来源。当前在做什么／到哪／下一步／卡在哪四项来自 project-update 完整快照，每项 string|null，默认最多 80 码点。
创建项目和 active_project 选择都要求 13.5.1c 的主人操作回执；自然语言“建项目 X”可由模型提案，钩子不猜是不是持续项目。
工作窗口可以由模型提交进度建议；生活窗口不自动显示工作项目，更新需主人对该次 projectId 和 payload 明确授权。
每次 project-update 带 baseRevision，服务锁内生成 revision+1；未给字段沿用，null 表示清空。沿用任何旧值就继承旧快照的 evidence_refs/origin 并集；不得借新证据替旧进度洗白。
模型“完成”只能显示“模型报告完成，未验”；注册工具证明只覆盖 proof_scope 指定的命令／对象。项目整体完成需主人回执，不由钩子读日志猜。
next_action 是该四项之一，不另存第二份。相同输入对同一项目同字段冲突，拒绝该项目更新，不按数组顺序赢。
来源失效则回退到最后有效版本，可能为空；不继续展示作废的“完成”。Overview 不增加 memories uses，不乘反馈 F。

## 七、时间线

### 7.1 字段和四态

| time_state | start/end | 含义 |
|---|---|---|
| point | start 可知或 null；end=null | 只知道一个事件点或完全未知，不宣称持续区间 |
| exact | start/end 都有值及精度 | 起止有记录，粗精度仍不是精确秒 |
| ongoing | start 可知；end=null | 有依据说明在进行 |
| ended_unknown | start 可知；end=null | 已结束，结束时间不知道 |

精度 minute/day/month/year/unknown。业务时间提案带证据引用和原文范围，模型不得补缺失年月。系统能检验格式及区间合理性，不能检验自然语言解释正确性；未批准解释带 proposed 标。
ongoing 结束追加 timeline-change，from/to 带版本；投影更新与事件同事务。补 start 不是普通 end 更新：需主人批准的时间更正，保留完整旧值。

### 7.2 查询

区间重叠用起止相交，不用“端点是否落进查询段”。月／年先展开成上下界，不能拿月中当真时刻。
两段确定边界可以判确定重叠／不重叠；未知一端且仍可能相交只能报可能重叠。ended_unknown 不能当正无穷。
ongoing 查现在时以上界 now 截止；历史 as_of 查询以当时 as_of 截止，并重放当时已知事件，不让后来信息冒充当时所知。
时长只有精度足够时才输出精确数字；粗精度给范围，完全未知就说不知道。两件事的距离也遵守同一规则。
“多久以前”由同一系统时钟算；last_touched_at 不参与发生时间查询。时钟回拨记异常，活动 age 夹到 0，不改原业务时间。

## 八、冲突、取代与主题键

### 8.1 只追加，取代也入账

supersede(old,new) 是事件，不能改旧正文。禁自环；形成环的请求改记 conflict，不参与状态折叠；同一旧条被两个合法新条取代，保留分叉，两新条都 active。
受控写服务检查图、角色、版本和授权，不靠模型说“没环”。事件带库内单调 commit_seq，同事务带 ordinal；按两者重放，时钟回拨不改变顺序。at 只作审计时间。
记忆已退休或记录有误，不因后来收到旧 supersede 的 newId 而复活。复活需要新的候选和合法提升；没有隐式状态回退。
普通 supersede 必须：规范 topic_key 相同且 resolved、绑定已 accepted、结构化状态属性相同、值不同、有可比业务时间，且模型提交 state_change 提案或主人已批准该变更。
模型提案不是生效授权：未经主人批准只可并存 proposed，不能退出一条 accepted 的旧事实。机械注册规则明确允许的窄类型更新可自行生效，规则版本须进事件。
时间只有新时间区间下界严格晚于旧时间区间上界才算“后来”；相同、交叠、任一未知都不可比，走默认并存，不要求主人补日期才能留下一句话。
日常偏好专有操作可使用 explicit_declaration 的 effective_from 顺序；只与同一声明序列比较，不拿它覆盖有实际 start 的历史事实。

### 8.2 纠错与新状态不同

纠错表示旧记录有误，由主人批准 corrected+新候选提升同事务完成；新业务时间仍按证据，不能拿纠错时刻代替发生时间。
普通输入“我现在不吃葱了”没有明确业务日期时保留原话并可生成 proposed 偏好，与旧说法同组标分歧；不猜开始日期、不自动判旧说法错误，也不永久挂主动待办。
若主人用受控偏好操作选择“从本次声明生效”，服务记录声明生效时刻；这是授权产生的新数据，不能倒过来宣称系统理解了自由文本。

### 8.3 topic_key：服务生成，不给模型自由发挥

topic_key 的输入为五元组：[topic-v1, entity_id, attribute_id, object_id_or_null, scope_id]；用规范 JSON 的 UTF-8 字节作 SHA-256，前缀 tk:，存完整 256 位摘要。注册表同时存完整元组，碰撞报错，不能静默合并。
scope_id 为明确的 global/work/life 或注册项目 id；不把同一个人工作约定和生活约定并成一个键。属性“值”不进入键，否则吃葱／不吃葱永远撞不上。

| 输入 | 唯一产生规则 | 不确定时 |
|---|---|---|
| entity_id | 主人固定 owner；项目用批准的 projectId；其它实体用正式注册 id | 未注册则登记候选提及、记忆走未归组，不拿姓名相似度合并 |
| attribute_id | 只能取 config 的属性枚举：food_preference、residence、communication_style、project_status、promise、event 等；枚举带 value_kind 和允许 scope | 模型可建议新属性，但不能新造已生效枚举 |
| object_id_or_null | food_preference 取注册食材 id；promise/event 取稳定事件实体 id；无客体的属性用 null | 不能把自由词直接哈希成“已识别同一客体” |
| scope_id | runtime 默认场景范围；主人授权后可 global／projectId | 缺合法范围则隔离 |
| 引文和 alias | 原文范围必须字节匹配；alias 规范化只做 NFKC、小写、首尾空白去除、连续空白合一，保留标点和否定词 | 别名零命中或多命中都 unresolved；不自动选第一个 |

注册表 entity_registry / attribute_registry / alias_registry 存 config 的版本化投影，正式注册变化在 registry-change 事件。初始固定 owner、work/life/global 及上述属性；项目创建、正式实体／客体定义与属性扩充仍需主人批准。候选提及另用 candidate_entity_registry，不算正式注册。
自动登记时机：受控日常候选附 entity_mention 的 evidence_ref＋source_span，服务验引用可读、非空范围逐字匹配且无唯一正式别名命中后，在候选写入事务内登记。机械字段只有 ce:SHA-256([observationId,source_span,scope_id])、原文字节、证据 id/hash／偏移、runtime scope、系统 at、status=candidate、ruleRevision；同键重试复用，跨观察同名仍分开。
模型只能指出“此处出现一个新实体”和原文范围，不能写候选实体的定义、规范名称、类型推断、授权或别名。服务从 evidence 取字段，不接受模型复述替原文；零命中／多命中都不自动同义合并。登记不是提升前置条件，无提及建议也可直接留未归组记忆。
模型提交的 entity_ref/attribute_ref/object_ref 是建议。已有 id 可做结构检验，但对自由文本的绑定默认 proposed；系统不因 id 存在就相信解释正确。key_status=resolved 只表示五元组均已注册且无歧义，binding_status=proposed/accepted 另列；resolved 不等于语义已批准。proposed 绑定可用于复核和标注并存，不能自动取代 accepted 旧事实。
精确用户命令或主人批准后才能给绑定 accepted。自然语言语义不明时只存 unresolved 键：`unresolved:`+SHA-256([observationId,source_unit])，source_unit 为固定原文偏移或请求项槽号；不取模型自由主题词。
缺任一正式组件或绑定歧义的完整日常解释，只要证据有效、无梦来源、无待执行权限动作，即直接提升 active/proposed/assertion 并标“未归组”；不等主人、不等到期，不因未注册而 shelve。新食材、事件、第三方或未批准新属性都适用；原话命令仍 quoted/utterance。
未归组记忆可检索、可按 6.1 交付；禁止参与冲突裁决、作为任一 supersede 端点（含 exact_merge）、参与梦确认（含作确认依据）。同名、多条、被反复使用均不升级权限；若需上述动作，须主人先批准正式注册／明确绑定并逐目标 rekey，再另验动作授权。
必须等主人的是正式定义／属性扩充、实体合并、别名、绑定 accepted、rekey 扩大归组和跨场景扩大；候选实体数量与记忆数量不触发其中任何一项。初始机械登记规则只给记录权限，修改规则或扩大权限须主人回执；登记事件不能冒作 registry-change 授权。
注册新别名须指定唯一实体 id、别名、适用命名空间、baseRegistryRevision，由主人操作批准。同一命名空间同一规范别名绑定不同 id 时拒绝；两个同名项目继续分开。
实体合并要显式 fromId→toId，服务检查存在性、类型、无环和引用版本；不做自动同义合并。归一过程追加 rekey，不改旧 topic_key 原列。
rekey 的输入是明确 targetType+targetId、baseKeyRevision、目标五元组、registryRevision；服务重算键。影响多个条目／判断时必须逐个列出目标，一事务追加，不凭 fromKey 把整组偷偷搬走。
memories、candidates、judgments 都通过同一个 effective_topic_key 读取最后有效 rekey。原始键、注册版本和历史仍可查询；候选提升取其 effective key 并记录来源版本。
例：owner+food_preference+ingredient:scallion+life，两条 value=like/dislike 的记录键相同。别名“葱”和“香葱”只有注册到同一 ingredient id 才归一；“不吃香菜”绝不去掉“不”再做候选去重。

### 8.4 成组读取

主动查询返回组成员索引及状态，current 展开当前成员、history 展开历史，具体 id 无论状态都能查且标状态。
自动注入常态展开合格成员，容量不足按 6.4 列逐组未展开数量及入口，各自保留 proposed/quoted/accepted；其它场景只给受限提示。组分歧不由“排序第一”变成定论。
待裁决不阻止原始观察保存；它只阻止提案要求的权限动作。默认出路在 13.0.4a，不能用“保守”当永久等主人兜底的借口。

## 九、检索、全文与活动

### 9.0a 工具契约

| 工具 | 输入 | 返回与边界 |
|---|---|---|
| memsys_get | ids(1..10)、view=current/history、include_evidence、cursor、max_chars | items、missing_ids、snapshot_revision、next_cursor、truncated、clock；正文、依据、时间线、来源、语义状态、组与待裁决标记 |
| memsys_search | 时间范围／scene／关键词／topic_key／图关系、cursor、max_chars | 有状态的结果及组索引；没有命中与读取失败分开返回 |
| memsys_project_get | projectId、history、cursor、max_chars | 项目身份、四项 Overview、revision、来源、证据、历史分页 |
| memsys_review_get | ids 或 kind、cursor、max_chars | 候选／pending／needs-review 原文、证据、默认出路、可用操作；不是事实正文 |
| memsys_self_get | self_note/speculation/judgment 的类型与 id 或 cursor | 原文及来源、相关事件；主人可看全部 self note，不自动注入 |
| memsys_context_get | snapshot_revision、group_id、cursor、max_chars；view=current/history | 6.4 的分组目录、计数、展开页及游标；history 含冷却报告；目录不计正文 lookup，不扩大自动注入场景 |

max_chars 默认 8000，范围 1000..16000。正文过大按 path/offset/total_chars 跨页，不删后半；游标绑定输入和只读快照，快照失效返回 stale_cursor，不能接上新版冒充同一原文。
工具按真实存储返回文本，不生成“完整原文”。读取错误返回 unknown/error，不把 missing_ids 混进无法查询的 id。主动查询不按窗口场景过滤，但始终显示 scene/scope 和来源限制。
只有完整或明确分片正文真正返回日常对话才有 lookup 触碰；后台扫描、空页、错误、单纯目录都不算。相同 roundId+memoryId 的多次／多页 lookup 只加一次 uses。

### 9.0b 淡忘和弹回

last_touched_at 初值为 recorded_at，之后取有效 memory-touch.at 与初值最大值。lookup、模型声明 used、主人显式引用目标的受控触碰可刷新它；自由文本提起由模型报告时标 proposed，只影响排序。
真实触碰恢复 F=1，活动新鲜度从 initial_strength 重新衰减；不改初始强度、不改场景／可信度、不补发生时间。
uses 只统计成功 lookup；used 和 owner_mention 不能抬高证据分。初始强度、反馈、重要度和证据可信度各算各的。

### 9.1 把握分开报

| 指标 | 计算与说明 |
|---|---|
| 命中数量 | 直接字面／标签命中数，不含图遍历追加节点 |
| 关系深度 | 直接命中为第 1 代；没装骨架就说明没有关系检索 |
| 门牌分 | exact=1、unknown=0.35、无门牌=0，权重 0.40 |
| 时间分 | 业务时间至少一端有有效值=1；全部 unknown=0，权重 0.25；有 time_state 不等于有时间 |
| 回查分 | min(uses.count/5,1)，权重 0.20 |
| 考试分 | 最近有效考试分 0..1，无则 0，权重 0.15 |

证据分是四项加权和；平均证据为命中均值，零命中为 null。它只是可回查程度，不是命题真实性概率。
少+硬可答“只有一条，但出处清楚”；少+软说明缺依据。数量和证据不硬乘成一个数。
输出标“实测／算的／我的感觉”。感觉若真的驱动决定，进 speculation 留痕，不能冒充工具结果。

## 十、可拔部件

| 部件 | 拔掉会怎样 | 仍必须保留 |
|---|---|---|
| 库与 self note | 不能拔 | 原文、来源、写入控制账、受控读写 |
| 时间线 | 区间查询与时间距离不可用 | 工具返回系统时钟；不能改猜时间 |
| 浮现 | 退为主动工具模式 | 全文检索、写入；明确没有逐轮交付 |
| 考试 | 无记忆复习分 | 真实证据和判断对账；不能拿考试判事实对错 |
| 骨架 | 无关系遍历 | 时间／关键词／主题查询 |
| 门牌 | 精确定位能力变弱 | origin、证据原文、未知标记不能拔 |
| 做梦 | 无定时整理与联想 | 输入采集、期限收尾、恢复、self note 工具不依赖做梦 |

考试按 1:4:16 的复习间隔保留排期，但考试不是事实验证；出题／答题不增加 uses，不自动改 verdict。

## 十一、self note：记我自己

只有我能写和追加修订；主人随时能看，不能替写；谁都不能删。主人提出看法是观察，我另写自己的理解。
self note 不自动注入，也不通过原样复制变成主人事实。抽成候选时保留模型作者来源和全部 origin。

### 11.1 写入口和触发

日常／做梦模型调用 memsys_record(kind=self_note)；输入 text、basis_refs、reason、supersedesId 可空、reflection_judgment_ids 可空。作者由 runtime 绑定 self，主人不能靠工具参数代写。
reflection_judgment_ids 只生成 needs-review；要判 wrong 必须另交明确 self verdict，或同一原子批次提交，不靠服务读笔记猜语义。
触发是：模型明确形成反思时、主人请求“写你的想法”后由模型独立成文时、已启用的低谷维护反思任务。无心得可显式 skipped，不硬生成。
维护调度只发反思请求和追踪 missing/skipped/written，钩子不替模型写日记。工具入口不依赖 turn_end；模型仍可能不写，这是创作行为的剩余依赖，不能靠自动填模板假装解决。

### 11.2 修订与来源

修订追加新 self_note+supersede(old,new)，按系统写入顺序，不按业务 start；禁环。两篇取代同一篇保留分叉，模型可再写一篇说明引用两者，不删任何篇。
无外部依据的反思也有 runtime 的 model:<sessionId>:<requestId> 来源，折叠 unverified。用了梦素材必须附 d-xxx#pN，仍 from-dream，不能用 model 来源盖过去。
原文写“做了什么”必须带工具／文件证明；主体写想明白什么、在意什么、哪里判错。没有全记住就承认不全。

## 十二、做梦与来源

### 12.1 两库隔离的是可信度

做梦仍是我；推断在 dreams.db，不能靠改动作名称变成事实。日常会话只可写梦的 confirm/unconfirm/dream-void 和确认快照，不能假造梦内容。
梦内容只有 dream runtime 能写；主库整理走受控工具的白名单，不能直接拿数据库连接随便改事实。

### 12.4 origin 与可信度

| origin | 折叠值 | 条件 |
|---|---|---|
| master@系统日期 | verified 来源 | 仅受信真人输入或结构化批准生成；不证明模型解释正确 |
| observed@系统日期 | verified 来源 | 真实工具观察；工具返回模型／梦内容时继承原链，不自动洗成 observed |
| model:运行标识 | unverified | 模型自身生成／无外部依据的反思与猜想 |
| file:路径#完整内容hash | 查 origins(path,hash) 后递归 | 缺旁挂、旧路径无 hash 都 unverified，不能套最新版本 |
| migrated:whale-soul | unverified | 老数据来源未核实 |
| d-xxx#pN | from-dream | 有有效 confirm 才按该 confirm 的证据来源截断 |
| 空／未知来源 | unverified 并报违规 | 新写拒绝空 origin，旧数据不能悄悄补 master@ |

可信度=min(自身层级,所有来源分支)，from-dream<unverified<verified。inherited 只用于确认梦路径，跳过自身层，不跳过来源。
递归最多 5 层，环／缺失分支为 unverified；已知另一路有梦仍为 from-dream，不能拿未知分支抬高。查不完不能作为独立证据的结构前提。
导入、复制、合并保留完整来源；origin/evidenceOrigin 由服务从实际证据引用生成，模型不能传 master@ 自证。
同命题多个确认取最后有效 commit_seq 的 confirm；unconfirm 只撤一条，剩余有效确认仍可用；dream-void 令整梦全部命题恢复 from-dream。

### 12.5 整理工具的实在入口

| 工具／kind | 输入 | dream 角色允许的输出 |
|---|---|---|
| memsys_get / memsys_review_get / memsys_self_get | 显式 ids 或分页游标 | 只读复盘，不加 lookup uses |
| memsys_dream_record | linkedIds、basis、idea、propositions[{text}] | 梦原文、命题和 inferred 候选同梦库事务 |
| memsys_organize(kind=merge_exact) | ids、各 baseRevision | 仅满足 12.6 字节等价的机械合并 |
| memsys_organize(kind=supersede_proposal) | oldId、newId、basis_refs、reason | 主库 pending 提案，不执行语义取代 |
| memsys_record(kind=self_note/speculation) | 11.1／13.5.1b 对应字段 | 自己的反思／猜想，保留梦 origin |
| memsys_record(kind=needs_review) | judgmentId、why、evidence_refs | 标复核，不能改 master verdict |

整理任务由独立、被标记的会话执行。可用 DSH 唤醒或外部受控启动，但只有“被唤醒后确实完成工具读写并退出”的动态记录才算可用。调度可关，恢复和期限收尾不能随它一起关。

### 12.6 Merge 的机械边界

自动 merge_exact 要求除系统身份、入档快照、活动计数和证据行 id 外的业务字段逐字段完全相同，至少包括 text、detail、why、type、scene、scope、有效 topic_key、key_status、binding_status、结构化值、时间各字段、semantic_status、record_kind、origin 集合、credibility、weight、tags、due 状态、pointer 和 judgment_id；不使用模糊相似度，也不删除“可能”“只在周末”。
多个入档快照不合并改写：新条有自己的快照，evidence 指向所有旧条，旧快照仍可取。权重不同或任一内容不同就只提建议，不算机械重复。
合并新候选提升与旧条的 supersede 同事务；使用 reason=exact_merge，不走“新发生时间必须更晚”的状态变迁规则。禁环和 8.3 的未归组端点禁令仍适用。
模型声称命题／限定／范围“不变”不能授权服务做语义合并；改写、提炼、乱连全进梦库或 speculation。普通 Supersede 建议按 8.1，不因 dream 角色豁免主人权限。

### 12.7 梦怎么被确认

主人确认必须针对一个 propositionId 和该命题的文本 hash，走 13.5.1c 的绑定回执。“对”而没有绑定目标，只生成待确认提案，不截断来源。
独立现实证据路径：日常模型提交 evidence_refs、为什么独立、命题对应关系；服务只验来源图可展开且不含梦、引用存在、版本和字节范围匹配。
“确为现实独立证据／不是模型复述／确实支持该命题”由主人在绑定提案中裁决。模型可以建议，但不能凭自己的判断让 confirm 生效。缺裁决默认保留梦并撤去主动请求，不能超时洗白。
已知 author_kind=model、self_note、dream、来源含梦或未归组记忆的证据结构上直接排除；author_kind=unknown 不视作独立。不得包装为 derived 证据绕过未归组禁令；另取独立现实原观察须重新裁决。未标来源的外部文本仍可能是模型生成，这个识别问题本地无法根治。
confirm 存 evidence_refs、evidenceOrigin、approvalReceiptId、proposition hash。先提交梦库 confirm+完整恢复快照，再提交主库提升。梦原文永远留着。
unconfirm／dream-void 都需主人绑定操作；撤销后已提升记忆仍在，但折叠 from-dream、退出 S，主动查询标“确认撤销”。

### 12.8 梦的有条件浮现

梦不混入事实集合 S。已启用做梦浮现时，按场景合格 linkedIds 的最高原始 R≥0.45 触发独立“未验证的梦”区，同一 topic_key／dreamId 每会话每天最多一次。
这些是梦区触发条件，不是事实目录的条数预算。已触发梦目录参与 6.4 的压缩／分组分页，组名明确“未验证梦”；未展开不计曝光，不冒充事实或全量交付。
linkedIds 全不合场景则不浮；梦没有自己的 scene。确认／撤销影响来源折叠，不能靠浮现次数增加可信度。

## 十三、存储、事件与可靠提交

### 13.0 SQLite 与责任边界

主库、梦库、控制账均用 SQLite；WAL、foreign_keys 开启，写入先取写锁，嵌套用 SAVEPOINT；事务不跨模型推理持锁。
迁移前使用数据库一致性备份接口，完整性校验通过才迁移；不能只复制仍在写的 db 主文件漏掉 WAL。
事实状态从事件重放；操作失败次数不属于可丢弃投影。控制账独立于业务事务，业务回滚不能把失败次数一起抹掉。

### 13.0.2 文件

| 位置 | 内容 | 权限 |
|---|---|---|
| ~/.dsh/memsys/memsys.db | 观察、候选、记忆、证据、时间线、门牌、活动、项目、自我记录、事件、配置 | 日常受控服务；做梦只有 12.5 白名单 |
| ~/.dsh/memsys/dreams.db | dreams、propositions、梦候选、confirm 等事件、恢复快照 | 内容归 dream；确认归有主人回执的日常入口 |
| ~/.dsh/memsys/control.db | operations、operation_attempts、投递与读回控制账、逐轮容量账／快照分页清单 | 服务内部；不接受模型传失败／容量计数或重置 |
| ~/.dsh/memsys/backup/ | 经校验的版本化备份及三库恢复清单 | 受控备份／恢复流程 |

### 13.0.3 每张表的字段与可变范围

公共不可变对象列：id、at、idempotency_key UNIQUE、payload_hash；需要来源的对象含非空 origin。完整 payload 的规范化规则见 13.5.2。
公共快照列 state_snapshot JSON、initial_strength REAL 适用于 observations/candidates/memories/self_notes/judgments/speculations；两者在首次尝试前固化。证据来源文本字段不做检索式规范化。

| 表 | 业务字段 | 可变范围 |
|---|---|---|
| observations | text、source(conversation/tool/file/dream/correction/model)、author_kind(owner/tool/file/model/unknown)、runtime_refs、origin、lossy、state_snapshot、initial_strength | 原文与来源不改；source=model 专门保存反思原输出，不伪装主人 |
| candidates | observation_id FK、source_unit、source_path(capture/tool/block/dream/resolve/confirm)、text、detail、why、type、scene、scope、tags、topic_key、topic_components、registry_revision、structured_value、semantic_status、record_kind、origin、confidence、lossy、start/end/prec/time_state、due_at、weight、pointer 字段、judgment_id、creator_session_id、owner_touched、reason、resolved_from、state_snapshot、initial_strength、status、promoted_at、rejected_reason | 只改 status/promoted_at/rejected_reason/owner_touched，必须同事务有事件；内容补充另建候选 |
| memories | candidates 内容列按 13.5.2 映射；recorded_at、promoted_from UNIQUE FK、due_state、due_done_at、last_touched_at | 只有 due_state/due_done_at/last_touched_at 为事件投影；其余不改 |
| evidence | id、memory_id或candidate_id、observation_id或source_memory_id、role(basis/derived)、source_span、at | 只追加；每边恰一个非空，五元组身份再加 source_span 唯一，避免不同引文被吞 |
| timeline | memory_id PK、start/end、各 prec、time_state、revision | 当前投影可更新，完整 from/to 事件同事务；历史可重建 |
| pointers | memory_id PK、status(exact/unknown)、location、search_hint、lossy、revision | 同 pointer-change 事件更新；未知不能变猜测位置 |
| injections | round_id、memory_id、slots JSON、topic_hits、manifest_hash、receipt_id、at；UNIQUE(round_id,memory_id) | 只追加，used 不在此表可变 |
| uses | memory_id PK、count、last_used_at | 从 lookup 事件重建 |
| projects | name、scene=work、origin、created_at、创建回执 | 只追加；Overview 放事件 |
| self_notes | text、origin、basis_refs、reason、state_snapshot、initial_strength、author_runtime | 只追加；没有 supersedes 列，关系在事件账 |
| judgments | 0.5.2 全部字段、origin、state_snapshot、initial_strength | 初始行不改；outcome/verdict 走事件 |
| speculations | text、basis、falsifier、origin、basis_refs、linked_judgment_ids、state_snapshot、initial_strength | 只追加，不进入自动事实注入 |
| origins | path+content_hash 复合主键、origin、author_kind、at、来源证明引用 | 版本独立追加，不取路径最新代替指定 hash |
| graph_nodes / graph_edges | memory_id、label/kind；from_id/to_id/kind、来源引用 | 原关系追加；作废走事件，不能抹掉旧推断 |
| relations | type、payload JSON、dedupe_key UNIQUE、at、commit_seq、ordinal、event_version、payload_version | 只追加，类型与重放规则见下 |
| state | key PK、value JSON、source_revision | 只作可重建投影：项目选择、词频、活动、提醒、交付温度、恢复游标；不可存唯一失败计数 |
| config | key、value、revision | 按 registry-change/config-change 重建的配置投影；不能直接改表绕授权 |
| candidate_entity_registry | 8.3 的机械提及字段及 evidence_refs | 从 candidate-entity 事件重建；不包含定义／别名／权限，无正式 id 效力 |

带主题的 candidates/memories/judgments 另存 key_status、binding_status 和绑定依据；rekey 同时记录这些字段的 from/to，不能仅换哈希就升级绑定权限。candidates 另存 review_policy、policyRevision、deadline_at、created_input_seq，首次创建即固化，普通 capture 没有 pendingId 也不例外；提升时不继承活动待审任务。

候选 status 为 pending/conflicted/promoted/rejected/demoted/shelved。shelved 表示保守归档、退出主动待办但保留原文；不是被判错，不会自动重新提升。
evidence 的 role 和引文位置都是机械元数据，不代表“独立”。提升时另加支持 memory 的行，不把支持 candidate 的行 UPDATE 成支持 memory。
dreams.db：dreams(id,at,linked_ids,basis,idea,origin)；propositions(id,dream_id,text)；candidates(id,dream_id,proposition_id,text,basis,origin,status=inferred/dead)；relations 与主库事件同构。
确认快照另存 confirmation_snapshots(confirm_id UNIQUE,payload,payload_hash,approval_receipt_id,original_session_id)。payload 含主库候选完整字段、证据 id/hash、命题原文及来源；不是省略字段的摘要。推断候选不能原地改成确认候选。

### 13.0.4 事件与幂等键

事件 id=SHA-256([库标识,type,业务键])；dedupe_key 使用同一完整元组。相同键不同 payload_hash 返回 idempotency_conflict，不能当成功忽略。同一请求所有服务生成值在 control.operations 预先固化，重试复用，不能因为重新取 at 生成另一个事件。

| type | 关键 payload | 业务键／效应 |
|---|---|---|
| promote | candidateId,memoryId,by,ruleRevision | candidateId；六步提升完成 |
| reject / shelve / demote | targetId,reason,receiptId可空 | targetId+操作 id；终止候选或退休记忆，原文不删 |
| supersede | oldId,newId,reason,authority | oldId+newId；合法边使旧条退出当前，不复活终态 |
| conflict | refs,reason,requestId | refs+原因码+请求 id；只记分歧 |
| pending | requestId,kind,refs,candidateId?,request_payload,baseVersions,created_at,deadline_at,created_input_seq,policyRevision | requestId；相关候选转 conflicted |
| pending-resolve | pendingId,result,actor,receiptId?,newCandidateId?,reason | pendingId；只能一次 accepted/rejected/coexist/deferred |
| corrected | oldId,newId,receiptId,reason | 主人操作 id；旧条记录有误，新条另建 |
| rekey | targetType,targetId,fromKey,toKey,baseKeyRevision,registryRevision,receiptId | 操作 id+目标 id；只更新有效键投影 |
| registry-change / config-change | baseRevision,newRevision,change,receiptId | 配置流+newRevision；投影与事件同事务 |
| candidate-entity | candidateEntityId、证据 hash/span、原文字节、scope、ruleRevision | observationId+source_span+scope；服务机械登记提及，与候选同事务，不写正式 registry |
| delivery-cool / delivery-restore | memoryId、baseRevision、policyRevision、reason、触碰证明或主人回执 | memoryId+触发操作 id；只改交付温度；P 内不得直接 cool，惦记先走 due-state；lookup 不恢复惦记 open |
| verdict / verdict-void | judgmentId,by,result,evidenceOrigin,refs；或 verdictId,receiptId | 稳定 requestId+项槽；不取现取时间当业务键 |
| outcome-change | judgmentId,baseRevision,from,to,why,evidence_refs,proof_scope,semantic_status | judgmentId+requestId+项槽；锁内检查 from/revision |
| needs-review | judgmentId,trigger,sourceVersion,why,review_policy,policyRevision,deadline_at,created_input_seq | judgmentId+trigger+sourceVersion；不改 verdict |
| review-defer | reviewId,reason | reviewId；退出主动提示，未复核标记保留 |
| timeline-change / pointer-change / reclassify | memoryId,baseRevision,from,to,authority | 操作 id+目标 id；投影更新有完整历史 |
| due-state | memoryId,baseRevision,from,to,reason,evidence_refs,policyRevision,receiptId或triggerId,reportId | memoryId+触发操作 id+baseRevision；按 13.0.4a 追加并同事务更新 due_state；自动事件不得写 done/dropped |
| due-mention | memoryId,ownerInputId,receiptId | memoryId+ownerInputId；仅受控主人引用，服务刷新惦记提及投影；扫描／注入／模型 used／lookup 不刷新 |
| due-done | memoryId,baseRevision,from,how(done/dropped),receiptId | 主人操作 id+memoryId；仅 open/pending-done/cooled-due 可转 done/dropped；仅 done 盖 due_done_at，其它态为 null |
| memory-touch | memoryId,roundId,kind(lookup/used/owner_mention),evidence_refs | roundId+memoryId+kind；只有 lookup 加 uses |
| injection-feedback / feedback-revise | roundId,memoryId,result,baseFeedbackRevision | roundId+memoryId+反馈版本；unknown 不当 unused |
| project-update | projectId,baseRevision,revision,snapshot,evidence_refs,origin,proof_scope | projectId+revision；锁内版本检查 |
| confirm / unconfirm / dream-void | 命题及证据／confirmId／dreamId、主人回执 | 稳定主人操作 id；只写 dreams.db |

主人专有操作清单：accepted/rejected 的冲突裁决、demote、corrected、due-done、due 开立／确认／恢复、confirm/unconfirm/dream-void、master verdict 及其撤销、正式注册／定义／合并／别名／属性／rekey 授权、场景扩大、项目创建／选择、硬保护变动与冷却政策批准。candidate-entity 机械登记不授上述权限；服务不能通过 result=accepted 冒充主人。
pending-resolve 的自动默认只准 coexist/deferred；惦记另按 due-state 白名单收尾，不支持伪造 ownerObservationId。默认与主人决定竞争时锁内检查 pendingId／due revision，先提交者胜；迟到决定返回 stale_proposal，须针对保留结果新建提案，不能改原关闭记录。
惦记命令均为完整受信主人消息，并生成 13.5.1c 的绑定提案／回执：`/mem due <JSON>`（仅 text、due_at或null、scene、scope，缺省按当前窗口；拒绝未知字段／越权场景），`/mem due-confirm <id> <revision> <payloadHash>`，`/mem due-done <id> <revision> <done或dropped>`，`/mem due-restore <id> <revision>`。受控面板亲建必须由主人填写并确认同一 payload；模型代填、复述或普通“记住”均不算亲建。
`/mem due-batch <reportId> <payloadHash>` 只执行报告中主人选定且可见的逐项 action/id/from/baseRevision；默认自动清单只含待确认／冷却，done/dropped 必须另选并绑定新 hash。整批先验回执、版本及容量，任一过期则整批不写；回执与逐项事件同事务、按操作 id 幂等，禁止“全部完成”不列目标。

### 13.0.4a 待裁决有默认出路

所有待审项创建时固化 review_policy、policyRevision、deadline_at、created_input_seq；候选、pending 和 needs-review 各自有持久到期索引，不能只扫描 pending 而漏掉 capture。普通待审初值为累计 3 次后续真实用户输入或满 24 小时，先到触发；惦记专用 due-policy-v1 见下，不套普通期限。重启／启动／每次输入／维护唤醒补扫，离线不假装执行。
跨窗口按同一身份的持久输入序号计数；墙钟回拨不提前触发时间期限，仍可由输入序号推进；不能把重启当新的一天清零。

| 待审类别 | 到期默认动作 | 是否必须等主人 |
|---|---|---|
| 普通原文 capture，无语义提炼 | shelve，reason=raw_capture_unreviewed；观察仍在，检索可见 | 否，不自动变成长期偏好 |
| 字段／证据完整，仅实体／客体／属性未注册或绑定歧义的日常解释 | 创建时直接提升未归组 proposed；恢复扫描补同一 promote，不等待到期、不建 conflict 待办 | 否；候选实体登记不等于正式实体授权 |
| 完整、来源合法、只是时间不可比／含义有分歧的日常模型候选 | 新建 coexist 候选，semantic_status=proposed，提升为带分歧的并存记录；旧事实不退出 | 否；“并存”不裁哪条真 |
| 缺必填字段、证据截断、材料来源不完整 | shelve／deferred，保留原文与原因；不自动补字段或提升 | 否；后续有新证据可建新候选 |
| corrected/demote/梦确认/主人 verdict/场景扩大/实体合并等权限动作 | pending-resolve(deferred)，不执行动作、不改旧结论，撤去主动待办 | **动作生效必须等主人**；请求不无限占待办 |
| needs-review，没有主人新决定 | review-defer，标未复核，不改原 verdict/outcome | 否；如要改 master 仍须主人 |
| 技术性写入／读回错误 | 不走语义超时政策，按 13.0.6 重试／冻结 | 冻结后需明确恢复操作，不用“并存”遮盖失败 |

coexist 必须有原候选完整字段、有效证据引用、非梦来源、已 resolved 的主题绑定；其解释未接受就明确 proposed。unresolved 普通候选走未归组直接提升，不伪造同组分歧；显式请求权限动作的提案仍 deferred，不借入档执行动作。
默认收尾同一主库事务：关闭 pending、原候选→shelved+事件、必要的新候选→提升、conflict 关联；新候选键 coexist:{pendingId}。没有 pendingId 的 capture 以 candidateId 追加一次 shelve；needs-review 以 reviewId 追加一次 review-defer，各自关闭活动索引。失败整组回滚，旧待审项仍开着，不做半关闭。
主人 accepted/rejected 同样一个主库事务：检查回执、目标版本、pending 未关闭；accepted 新建 resolve:{pendingId} 候选并按六步提升，旧冲突候选 rejected；rejected 只收尾。不把原候选改写成主人原话。
新候选的来源为原依据与本次批准的并集；主人批准不能清掉梦链，梦依然只走 confirm。accepted 的新文本与时间来自被批准提案，不猜主人一句“好”是在改哪个字段。
关闭只是退出活动队列，review_get 保留全部历史。后续主人可以针对 shelved/deferred/coexist id 创建新请求，事件链相连；不自动反复把旧请求重新排队。

惦记状态与候选 status、事实 active 分开：完整候选可照常提升 memories，但 due_state 的 pending-due／shelved-due 只属待确认区；shelve 不退休该记忆、不改原文。due-state 与事件、持久活动索引同事务，state.due:<id> 从事件重建 revision、opened_at、last_due_mention_at、deadline_at、证据版本、归档原因；系统盖时刻，模型不能传阈值／计次／状态。due-policy-v1 数值变更须主人批准新版本，不由模型自调。

| 起点／触发 | 确定终点与条件 | 可见与撤回 |
|---|---|---|
| 模型 promise／due_at 提取 | pending-due；同一主人跨窗口合计最多 100 条，本次入队满 14 天未确认→shelved-due；超 100 按本次入队提交序号、id 从旧到新 shelve 至 100，写入事务内执行 | memsys_review_get(kind=due-history) 分页显全部惦记状态／原文／理由；due-restore 只回 pending-due，重算期限与入队序号，绝不自动 open |
| 三种合法主人入口／冷却撤回 | `/mem due`、pending-due 显式确认、受控面板亲建→open；pending-done/cooled-due 的 due-restore→open；均核回执、场景／来源／active 和 6.4 容量 | 记 opened_at、初始化提及锚点；shelved-due 必须先恢复待确认再确认；无回执、模型反复 promote／整理／提及期限均不能 open |
| open 有明确后续完成证据 | pending-done（待主人确认完成），退出 P；仅认受信主人在已绑定 id/revision 面板提交的完整原话“这个做完了”，或创建／确认时绑定 proof_scope 的项目快照从未满足→满足注册机械条件，证据必须为主人或注册工具 | 报告列原话／快照版本、规则和“未确认完成”；自由指代、模型报告完成、无对应 proof_scope 只提建议；due_done_at=null。只处理本次 open 后新提交的证据版本，恢复撤回不会被同一旧信号再次退出 |
| open 超期且沉寂 | cooled-due；有确定 due_at 上界的，now≥到期上界+30 天且距最后受控主人提及≥30 天；无日期则距 opened_at≥90 天且无提及≥90 天 | 粗精度取区间上界，日期解释仍标 proposed；报告列“冷却惦记，未判完成”、阈值／锚点／原文；due-restore 一条命令申请恢复 |
| 6.4 容量压力 | 未满老化期限也可 open→cooled-due，reason=capacity；先报告、按固定顺序退让，不判完成 | 同报告显明近期项也可能被让出；恢复须容量检查，可退让其它软项，不以再冷却本目标假称成功 |
| pending-done 无确认／证据撤销 | 满 14 天无决定→cooled-due，保留完成待核标记；证据撤销／来源失效立即转 cooled-due、reason=evidence_invalid | 不自动 done，也不自动重开 P；报告保留证据历史、无效原因、due-restore 与 due-done 入口 |

所有自动退出均不删数据、不改事实正文／时间线、不写 done/dropped；只有主人 due-done 判完成／放弃。报告及可见状态通知须先落盘才退让，通知投递不明标 unknown、不冒称主人已见；退出与 reportId 同事务，报告分页可查，不依赖模型主动提醒。沉寂只认服务核验的 `/mem due-mention <id> <revision>`／受控主人目标引用回执；普通聊天的模型指代仅成 proposed 建议，不能刷新计时。扫描与计数按持久事件身份去重，墙钟回拨暂停时间老化并报告，重启不归零；恢复 open 重设提及锚点，避免立即再因旧沉寂冷却。due_state 为 none/done/dropped 无自动重开；done 的撤销须主人新提案，不能让 lookup 或模型反馈恢复。

### 13.0.4b 状态重放

| 对象／事件 | 状态效果 |
|---|---|
| 候选创建 | pending |
| pending + promote | promoted |
| pending + pending 事件 | conflicted |
| pending + 合法 reject/shelve | rejected/shelved |
| conflicted + 主人裁决 | 原候选 rejected；接受时另建新候选，不复用旧 id |
| conflicted + 默认 coexist/deferred | 原候选 shelved；coexist 可另建 proposed 记忆 |
| pending/promoted + 主人 demote | demoted；已提升记忆退休 |
| 新 memories | active，语义状态另看，不自动 accepted |
| 合法 supersede/corrected/demote | 旧记忆依次成为已被取代／记录有误／退休 |
| conflict/pending/rekey/反馈 | 不直接改变记忆事实状态 |
| unconfirm/dream-void | 改折叠可信度，不改记忆状态 |

rejected/demoted/shelved 不自动重开，补证据建新候选并引用旧 id。多个关系同时影响记忆时：退休／记录有误优先于取代，active 只在没有终态事件时成立；不靠后来 unrelated 事件复活。

### 13.0.5 事务与跨库恢复

观察先独立提交并读回；后面的失败不能回滚已经保存的原话。capture 任务与观察的恢复指针在同一业务事务，重启扫描未完成观察会补建同一 capture。
候选+证据+必要 judgment 一个整理事务，每候选一个 SAVEPOINT。候选提升六步不可拆：memories、timeline、pointers、memory evidence、candidate 状态、promote 事件；必要 conflict/supersede/corrected 同事务。
活动事件、uses、last_touched_at 同事务；反馈独立按回合；项目身份、首个快照、操作去重同事务；曝光与已核回执的投影同事务。
数据库提交后必须执行 13.0.6 的读回才向调用方报 found。业务 commit 成功但回执读不到时报告 unknown，不误说事务回滚了。
操作清单固定目标 id、提交版本、原文／事件／证据集合及 hash。正文和追加事件逐字读回；可变投影则读回该提交版本的完整历史快照，并验证对应事件已提交，不拿后来合法更新的当前投影与旧 payload 比较后误报损坏。
梦确认：先保存真实主人批准观察；梦库同事务写 confirm+确认快照；读回 found 后再主库补建 source=dream 命题观察+confirm 候选+完整提升。
跨库不宣称原子性。control.operations 留子步骤和 confirmId，恢复时重新验证确认仍有效、原证据及 hash 还在，再按稳定键补主库；已撤销则取消补写。
恢复任务属于受控服务，不依赖做梦启用、模型再吐一次块或主人记得提醒。来源读不出时标 unknown 并停止提升，不用旧缓存假装确认仍有效。
主库条目的来源折叠每次读取都参考当前梦确认状态；撤销与主库补写竞争最多留下不可注入的 from-dream 行，不能留下永久 verified 缓存。

### 13.0.6 写完读回、最多一次即时补写、三次冻结

control.db 的 operations 为权威任务账：object_key、operation_id、request_key UNIQUE、target_db、immutable_payload、payload_hash、target_ids、首次生成的时间与快照、status、consecutive_failures、frozen、freeze_reason、generation、last_readback、last_error。
operation_attempts 只追加：object_key、generation、attempt_no、operation_id、reserved_at、completed_at、result、error、expected_hash、actual_hash。operations 计数投影可由尝试账重建，但不允许启动时归零。
object_key 不用重试号／时间／payload hash 换身份：写入是“目标库+逻辑对象 id”；编译是“模式+会话注入流”。一个坏对象换 revision 也不能绕过冻结；新对象与不同流不互相拖死。
每次尝试前先在控制账事务保留 attempt，持久增加 consecutive_failures；这是预扣失败。成功完成提交和精确读回后才标成功并将连续失败清零。进程在中间死掉，未完成尝试仍占一次，重启不偷掉它。同一 object_key 仅准一个在途尝试；已有两次失败时可保留并执行第三次，预扣到 3 后拒绝其它写尝试，但允许这次在途尝试完成；第三次 found 可清零，第三次失败或中断才置 frozen。
控制账写不下就不发业务写入，也不在内存里“暂记成功次数”。控制账自身不可用时停写并报告 control_ledger_unavailable；三次计数承诺不能覆盖连计数介质都坏了的情况。

| 读回态 | 判据 | 动作 |
|---|---|---|
| found | 按稳定目标 id/键直接读，逐字段精确匹配已固化 payload；文本按原 UTF-8 字节，关系和证据集合齐全 | 返回目标 id/hash/提交版本；连续失败清零 |
| missing | 权威目标存储可成功查询且确定该对象／事务结果不存在 | 保留同键同 payload，允许一次即时幂等补写，再读回并报告 |
| unknown | 超时、读锁错误、权限错误、哈希不一致、只能查搜索索引、部分步骤不可判定 | 不能当 missing；先记录具体原因，再尝试一次同键条件式补写并读回；不得换 id 或覆盖不一致旧行 |

即时补写也算一次尝试、也先扣持久计数。相同键已有相同 payload 就返回原对象；相同键不同原文报 idempotency_conflict 并保持 unknown，不覆盖。unknown 的补写只在目标支持此条件式幂等契约且可写时执行，否则记录 repair_blocked 并报告，不冒险重复写。
一次调用最多“原尝试+一次补写”；第二次仍失败就报告原文保全位置、readback 状态、次数、冻结状态。后续启动或恢复调度可进行下一次，但第三次失败立即冻结，同一次调用不得再补第四次。
例如失败→即时补写失败→重启恢复失败，计数 1→2→3，冻结；不是每次进程各试三次。只读探测不新增写入尝试，不能用无限探测循环拖住回复。
恢复先只读探测未完成的目标：若确认完整 found，补记成功；若第三次已冻结，即便探测找回结果也只记 reconciliation=found，保持冻结，直到明确解冻，防止后台自动重新开闸。
解冻必须由主人／本地操作者的受控维护操作指定 object_key、原因和新 generation；旧尝试账不删。非冻结对象一次真正 found 可清零连续失败；配置改动和重启不能清零。
编译使用同一控制账：冻结输入快照、按 manifest 读回产物，核对实际条目＋延后成员无重无漏覆盖 eligible_ids、P 完整且 expected_ids 匹配才算编译 found；错误累计三次冻结该流。真实容量不足按 6.4 分级，不累计技术失败。
编译 found 不等于投递 found；投递必须另有 6.2c 的宿主回执。无回执不重复外部发送来猜成功，只标 unknown，避免重复副作用。

## 十三点五、写入入口和契约

### 13.5.1 主路径 A：输入侧自动采集与机械入档

受信输入到达即先固化 observation 原文／身份／快照；使用稳定 input event id，不等待助手输出。工具／文件也采集，但不得把工具内“主人说”变成真人输入。
每条真实用户消息由服务产生 source_path=capture 的候选，source_unit 固定为整条消息的字节范围，默认 episode/utterance、quoted、why=“输入原话留存，待提炼”、start=null、topic_key=unresolved 键。
固定命令 `记住：...` 匹配时，原文捕获之外另有 source_unit=command_body，直接按 5.2 提升 quoted 记忆；不需要模型候选、不需要 turn_end、不需要 used_memory_ids。
为避免同消息重复存两个待办，命令匹配成功时整条 capture 直接标 shelved(reason=explicit_capture_promoted)，与命令候选提升同事务；原观察不动。
普通 capture 到期限没有语义产出就 shelved。输入还会触发期限扫描、恢复未完成观察和 judgment 主题碰撞扫描；这些都不调模型。
输入侧采集丢失时只有 2.2 中验证过的日志补收能接续；没有入口能力就诚实降级，不让模型凭记忆补造原话。

### 13.5.1b 路径 B：受控工具优先，文本块只兼容

主工具 memsys_record 输入 request_id、kind、items、evidence_refs、runtime 绑定的 source_unit。返回每项 operation_id、对象 id、found/missing/unknown、pendingId 或 validation_error、失败次数与冻结状态。
request_id 由运行时工具调用标识派生，模型的任意字符串不能改请求身份；payload 错误可修正后使用新的调用 id，但逻辑目标冻结仍按 object_key 管。
每次只提交所需 kind，不要求每轮输出 17 个空数组；没有工具调用时路径 A 照常形成原话候选和显式原话记忆。

| kind／入口 | 必填输入 | 触发与落点 |
|---|---|---|
| candidate | text、why、type、evidence_refs、source_unit；topic_components 建议、entity_mention 的证据范围可选、时间字段可空 | 日常模型认为值得留时；候选+证据，proposed；服务决定合法结构和默认字段，可机械登记候选提及 |
| judgment | verdict_text、basis、falsifier、evidence_refs、outcome；topic_components 建议 | 作第二档判断时；judgments，不必先有 memories |
| self_note | text、basis_refs、reason；supersedesId 可空 | 11.1 的反思触发；self_notes 与取代事件同事务 |
| speculation | text、basis、falsifier、basis_refs、linked_judgment_ids 可空 | 推断过远／感觉驱动决定时；speculations，永不自动事实注入 |
| outcome_change | judgmentId、baseRevision、from、to、why、evidence_refs、proof_scope | 模型发现执行结果变化时；追加 outcome-change，不覆盖 judgment |
| registered_tool_outcome | operationId、judgmentId、原始机器结果引用 | 受控工具包装器在结果返回时自动调用；只改精确绑定的命令结果，完全不依赖模型吐块 |
| needs_review | judgmentId、why、evidence_refs | 反思或新证据提示；另有 0.5.3 本地自动触发 |
| verdict | judgmentId、by=self/auto、result、basis、evidence_refs | 模型对账；self 禁 right；master 必须走主人通道 |
| promote_candidate / reject_candidate | candidateId、baseRevision、reason | 日常模型重审自己的 pending；必须过 13.5.5，不能改 conflicted 或主人干预对象 |
| propose_owner_action | action、targetIds、baseVersions、精确 payload、引用 | 自由文本需要主人权力时；保存提案，不执行动作 |
| project_update | projectId、baseRevision、四项变更、evidence_refs、proof_scope | 日常工作进度变化；完整快照和来源继承见 6.5 |
| feedback / touch | 当轮 memory ids 或目标 id+证据 | 使用声明／真实正文 lookup；按 6.2c、9.0b |
| timeline_change / pointer_change | targetId、baseRevision、from/to、evidence_refs、reason | 时间结束／门牌回查；不能借它改 start 或扩大场景 |

模型自身产物先保存 source=model、author_kind=model 的原输出观察，origin 包含 model 运行标识与真实素材链；不能因为 basis_refs 只引主人就把整篇反思变成主人写的。
outcome_change 的机械 from/revision 不匹配则拒绝该次写入，返回当前版本供重新判断，不能把迟到的 failed 覆盖已经 reverted 的新状态。重复回调按原 operationId 只生成一条事件。
自我反思、猜想和结果变化都有独立工具入口；工具缺失必须降级报告，不能只写“以后整理工具会做”。
可选文本兼容：只有验证了 turn_end 与隐藏能力才启用。接受单个 memsys 对象，其中 actions 为上述 kind 的数组、used_memory_ids 可选；不要求每轮发块、不把块送到用户正文。
缺块／格式坏仅记 extraction_missing/extraction_invalid，使用反馈 unknown；不能回滚路径 A，也不能把模型未发块计成数据库写失败。块的解析上限及 token 占用记录实际值。

### 13.5.1c 主人操作：验证结构，不猜“嗯”指向谁

受控面板显示 action、目标 id 与当前文本、精确变更 payload、来源和 baseVersions。主人点接受后由 runtime 生成不可由模型伪造的 receipt，绑定 owner 身份、proposalId、payload_hash、目标版本、nonce 和 input event id。
没有面板时的替代命令：完整受信用户消息 `/mem accept <proposalId> <payloadHash>` 或 `/mem reject <proposalId> <payloadHash>`。只接受完整消息精确语法，不扫描代码块、引文、转贴内部的命令。
专有命令先创建相同的提案／回执对象；带 id 的自由句子仍不是这个协议。角色是 owner、字符串匹配也不能把自然语言指代判定塞回钩子。
receipt 与已落库的完整提案匹配，锁内检查目标版本未变、nonce 未消费；过期版本返回 stale_proposal，不擅自把批准套在新文本上。
“对”“记错了”“这条别记”等自然话由模型给建议、生成待确认提案；不能生成 master verdict 或 confirm。默认到期 deferred，原话保存，动作未生效。
这增加了专有操作的确认成本，换来可验证权限。日常原话记忆与 proposed 解释不需要每条主人点批准。

### 13.5.2 优先级、去重和映射

优先级只决定哪个提案能执行，不能覆盖历史：主人绑定操作 > 输入侧确定性命令 > 受控模型工具 > 文本兼容。capture 永远是原文根，不是与语义候选竞争删除的低级副本。
同一 source_unit 的工具／文本兼容候选：若内容完全等同则只存一次；内容不同则按下述键各留提案，并标同源不独立，不允许后到文本块覆盖工具结果。显式授权动作遇同目标冲突拒绝较低优先级的执行，保留其提案。
不依赖到达顺序比较语义。输入侧“保留原话”和模型“解释偏好”是不同 record_kind，可以同时存在；它们共用 observation，证据独立数仍为 1。

| 对象 | 稳定业务键 |
|---|---|
| 用户观察 | obs:conversation:<受信身份>:<sessionId>:<messageSeq或日志记录位置> |
| 工具观察 | obs:tool:<sessionId>:<持久 callId> |
| 文件观察 | obs:file:SHA-256([规范绝对路径,完整内容hash,原文范围]) |
| 模型原输出观察 | obs:model:<sessionId>:<稳定调用id>:<项槽> |
| 自动 capture | capture:<observationId>:<固定 source_unit> |
| 显式原话命令候选 | quote:<observationId>:command_body |
| 模型候选 | proposal:SHA-256([observationId,source_unit,完整语义payload]) |
| 裁决／默认并存候选 | resolve:<pendingId>／coexist:<pendingId> |
| 梦确认候选 | confirm:<confirmId> |
| 机械合并候选 | merge:SHA-256([排序后的旧id与版本]) |
| 记忆 | promote:<candidateId> |
| self_note/speculation/judgment | kind:<稳定调用id>:<项槽>；重复同键异文报错 |
| 编译产物 | compile:<sessionId>:<roundId>:<源快照revision>:<策略revision>；失败计数仍按会话流 object_key |

所有对象 id 为类型前缀+完整业务键的 SHA-256；不使用“时间戳+随机三位不会撞”的假设。哈希碰撞必须核对原完整键，异键同 hash 报异常。
完整语义 payload 使用固定字段顺序的规范 JSON：缺省按契约补齐、证据集合排序、字符串保持原文；不去标点、不把“不吃”归一成“吃”。不能拿 6.3 的检索规范化做写入身份。
路径 B 的模型候选父 observationId 是其明确引用的 source_unit 所在观察，不一律挂本轮用户；origin 永远取实际依据并集并标模型作者。服务不接受模型另给 origin／at／topic_key。
新增材料或改变原意产生新候选并通过 derived 关联旧候选，不能重用旧键不同 payload 静默吞掉。不同真实输入的相同文字也是不同观察，不跨输入偷偷去重。

| 候选字段 | 提升落点／缺省 |
|---|---|
| text/detail/why/type/scene/scope/tags/structured_value/semantic_status/record_kind/lossy | memories 同名；text、why、type、scene、scope 必须合法，detail 可 null |
| origin/confidence | memories.origin/credibility；服务从证据及作者来源算，不能仅有 master@ 就去掉 proposed |
| effective_topic_key、组件与注册版本 | memories 及键溯源；完整 unresolved 日常解释直接提升未归组 proposed；原话 utterance 仍 quoted／未归组；两者均不裁决／取代／确认梦 |
| start/end/prec/time_state | timeline；未知为 null/unknown/point，exact 缺任一端拒绝提升 |
| due_at/weight | memories；缺省 null/5；type=promise 或 due_at 非空初始 pending-due，否则 none；仅 6.1 三种主人入口核回执后初始 open，due_done_at=null。origin=master@／semantic_status=accepted 不替代 due 授权 |
| pointer_status/location | pointers；缺省 unknown/null，exact 必须有可精确回查的证据位置 |
| judgment_id | 第二档必有；其它可 null |
| id、证据行 | promoted_from、另建支持 memory 的 evidence 行 |
| 入档快照与强度 | memories 首次尝试单独冻结；不回填 candidate 的旧快照 |
| recorded_at/last_touched_at | 首次尝试的系统时刻，成功读回后生效；last_touched_at 初值相同 |

due 入口闸门覆盖 capture/tool/block/整理、coexist/resolve/confirm/merge/迁移及重试，模型不得传 due_state；即使批准别的语义动作，也不隐含批准惦记。无合法 due 回执的衍生 promise／期限条目只能 pending-due；open、pending-done、cooled-due 目标不得被自动 merge/supersede 绕过惦记收口，须另行主人明确处置。启用／升级时核验存量 open 的原 due 回执，缺失则追加 due-state 转 pending-due，不补造批准；due 授权不扩大场景、不清洗来源、不豁免未归组权限。

### 13.5.5 提升与语义挂起

服务只核结构：必填、角色、来源图、归组资格、目标状态／版本、原文范围、时间格式、幂等和事务。未注册只影响归组及权限动作，不阻止合格日常解释入档；服务不判原话是否支持结论，不判别人是不是在转述。
输入机械原话命令直接提升 quoted/utterance；完整且无权限动作的日常解释可提升 proposed/assertion。未注册按 8.3 走未归组，由服务在 candidate 写入后直接提升、恢复补扫，不要求模型再次 promote；保留模型标记和判断依据。模型不许把 proposed 自行升 accepted。
resolved topic 下结构化 value 不同或模型声称有分歧就挂 conflict 提案；同键本身只触发复核，不自动判谁错。默认并存按 13.0.4a，不让业务 start=null 卡住全部入口。
证据截断、缺字段、来源无法解析、权限不明时挂起，保存具体原因，到期归档；不能由钩子“补一个合理解释”。
梦推断永不从主库候选路径原地提升；只有 12.7 的有效确认快照可例外创建 inherited 记忆。来源含梦的普通候选不能靠主人 resolve 清洗。
reject_candidate 只允许日常模型处置本会话、owner_touched=0、status=pending 的普通语义候选；不能 reject 输入原观察，也不能收掉主人冲突决定。默认 shelve 属于固定政策，角色不同、原因必须写明。
主人 demote 不删数据，退出当前事实；要重新记须新观察／新提案。模型发现记歪可以主动给 corrected 提案，真正纠错仍走主人通道。

## 十四、迁移、复用与外部入口

### 14.1 迁移映射

| 旧数据 | 新结构 | 不许顺手编的东西 |
|---|---|---|
| raw | observations.text，origin=migrated:whale-soul | 原文缺失不能拿 detail 冒充 |
| gist/detail | 候选 text/detail，提升后 memories 对应字段 | why 缺失写“迁移：旧数据无 why”；semantic_status=proposed、credibility=unverified |
| 24 条点事件 | 24 条 timeline，time_state=point | 不造 end、不改成持续 0 天 |
| 3 条额外区间 | 单独建 episode 与 timeline，按旧 start/end 状态保留 | 不硬挤成某条记忆的第二行，不全压成 point |
| 24 条未知门牌 | pointers unknown、旧 search_hint | 换系统不变 exact |
| 8 个骨架节点及边 | graph_nodes/graph_edges，附迁移来源 | 无证据边不变事实认证 |

迁移 topic_key 从固定 registry 机械映射；未知项 unresolved，不让模型批量自由归组。迁移快照记录导入当刻，历史精力／情绪 unknown。
备份、完整性校验、逐项写后读回、关联闭合、回滚演练通过才允许一次切换；不在这次文档修改中执行迁移。旧系统备份保留，切换不是删旧数据。

### 14.2 回溯补门牌

先读真实会话／文件指定版本，原文范围精确匹配才给 exact；只找到相似摘要仍 unknown。pointer-change 留 from/to、版本和证据，同事务更新投影。
补门牌不增加来源独立性，也不把 migrated 自动改 verified。历史来源不足必须保持不足。

### 14.4 dsh-mnemosyne 的边界

明确自建 dsh-memsys。dsh-mnemosyne 只作存储、迁移、备份和事件投递的机制参考，不作运行时依赖，不接它的库，不另建上游 status 权威。
本设计自己承担候选、权限、事件重放、容量降级和恢复；2.2 的能力探针仍须逐项动态验证，不能拿参考项目的测试数当本插件证据。
事件携带 event_version/payload_version；消费重试按稳定业务键和读回回执去重。机制参考不能替代输入授权、语义独立性或容量验证。

### 14.5 feed 契约保留

feed 的三闸只筛值得扫的候选，不生成长期记忆：标题命中偏好关键词；标题＋简介有细节；发布时间在系统 now 前 7 天内。
“细节”用可审计字面代理：独立英文 token 至少 3 字母、版本号、数字＋固定单位／百分号、非空书名号。单位初值 %、％、GB、MB、TB、ms、s、秒、分钟、小时、天、元、万、亿。
无／非法／未来发布时间分别报 missing_publish_time/invalid_publish_time/future_publish_time；七天外 too_old；缓存仍按本轮时钟复核，不拿抓取时间冒充发布。
feed 返回 id、标题、简介、发布时间、命中依据、筛除原因。后续真读取才产生 observation；扫过不等于看过，不加 memories uses、不伪造 master@。

## 十五、验收边界与仍未根治的事

本文件现行版本为 v0.38；页首版本与开场描述按限改要求保留为 v0.37 基线说明，现行 P 契约见本次修改章节。完整读过任务、v0.37 与 Opus 三审；设计走读／静态自检不等于 DSH 动态验证。

| 场景 | 设计应有的结果 | 实现前必须实测什么 |
|---|---|---|
| 模型整轮不发块 | 输入原文和 capture 在；固定记住命令形成 quoted 记忆；反馈 unknown | 真实输入钩子／日志补收、退出前中断恢复 |
| 同一写入工具重试／文本兼容重复 | 相同业务键同原文只一份；异文拒绝或不同提案 | 重复回调、不同真实消息不误去重 |
| 用户说“对”，模型声称唯一目标 | pending，不能产生 master/confirm | 接口拒绝伪造 receipt 和 model role 冒充 owner |
| 新食材、事件、第三方／同名项目、未登记别名 | 完整解释直接成未归组 proposed；候选提及不授定义／合并权 | 不等主人也能提升；所有 supersede 端点／裁决／梦确认入口拒绝未归组 |
| 偏好有新说法但 start=null | 带分歧保留；到期限 coexist 或 shelved；旧事实不悄悄失效 | 默认扫描即使关做梦也运行 |
| 超预算与持续增长 | 硬／软独立计账；先清单后退软层，只有硬层自身超 H 才可 overflow／暂停 | 实测目录字节及 token、K 上界；未来期限／无日期／频繁提及项同时满额、单条过大、预算缩小、恢复竞争 |
| 模型批量提取／期限原话／整理衍生 | 仅 pending-due；跨窗口第 101 条收旧至 100，满 14 天 shelve，P 增量为 0 | 所有入口拒模型伪造 due 回执；并发上限、边界时刻、重启／回拨、无主人处理的持续输入 |
| 完成信号／沉寂退出及撤回 | pending-done／cooled-due 都非 done；原文保留、报告可查、主人可恢复 | 错指代与模型快照不能触发；证据撤销、通知 unknown、due-restore 容量不足、整批 stale 不半写 |
| 自我反思／猜想／命令失败 | 独立工具写入对应表／outcome 事件，原文读回 | 工具可调用、作者绑定、结果 operationId 对应 |
| 提交成功后断线 | unknown；同键补写不重复；恢复读回 | commit／回执之间断点与部分跨库恢复 |
| 同一对象失败三次后重启 | 仍 frozen、计数仍 3，不能第四写 | 控制账预扣、失败回滚、冻结解锁日志 |
| 梦确认后撤销或来源失效 | 读取时 from-dream，不能残留有效缓存 | 两库竞争、撤销前后快照、缓存失效 |

仍待校准：自然语言抽取率、用户批准负担、实体／客体注册覆盖、反馈排序是否有用、initial-v1 的参数、目录增长下容量、真实 token 和工具成本。
语义没有被本地正则解决：钩子退回结构，模型解释标 proposed，主人专有语义动作待明确批准。原文不会因为缺块丢掉，不等于能自动理解每句话。
未归组无法归组、无法矫正：已知、施工期解决，本次不修。只产出设计稿，不写实现、不排工期、不动旧版及人格／冷记忆／交接卡，不声称新一轮 Opus 或 DSH 验收通过。

## 修改记录（v0.37 → v0.38）

| 要求／自检 | 落点 | 改动与核验结论（设计走读；非动态验收） |
|---|---|---|
| 一、收紧入口；自检 1／2 | 6.1、13.0.4a、13.5.2 | 模型及衍生 promise 只能 pending-due，100 条／14 天默认 shelve；只有三种带回执主人入口开 open，恢复也不能绕过；原话含期限、accepted 与 master@ 均不授 due 权 |
| 二、分层记账；自检 3 | 6.1、6.4 | P_h／P_s 分账、分报；软层先退，硬层自身超 H 才可 protected_overflow；模型不能借类型、合并、lookup 加回 P |
| 三、确定出口；自检 4／5 | 13.0.4、13.0.4a、13.5.2 | 绑定完成信号→pending-done；超期且沉寂 30 天、无日期沉寂 90 天或容量压力→cooled-due；均不判完成、不删数据、可撤回。移除旧的全部 P 永不冷却与自动初始 open，退出不再只靠 due-done |
| 四、增长与上限 | 6.4、15 | 64 成员／12,288 字节／0.60H；80% 预警、满额退软层至 70% 或空，先清单／批次再退让；256 字节等仅估算待校准；硬层越治理线与实际装不下分别处理 |
| 六项自检中的结构项 6 | 全稿逐章节比对 | Node 静态检查通过：780 行≤780，UTF-8 无 BOM／替换乱码；28 张表无空项／错列，71 个标题无重复；仅六个允许章节及修改记录变化，白名单外逐字一致；旧规则断言通过。v0.35／36／37 等旧稿、任务／判词、persona／memory/cold／handoff 共 28 个文件 SHA-256 均未变 |

残余风险：保守证据匹配会漏掉自然表达，容量退让可能冷却仍重要的惦记；硬保护仍可能超宿主预算，历史库继续增长。阈值、通知与恢复链尚待实测，未归组问题留施工期。
