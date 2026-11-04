# Changelog

## 0.3.1

### Added

- **检索改造：查询改写 + 同义扩展**（`docs/EVAL.md` 指出的短板）。`memsys_search` 的 `keywords`
  是整句字符串，旧检索只做 `includes(整句)`，口语问句几乎零召回。现在：
  - `src/read/expand.mjs`：整句 → 分词（短块整词、长句二元组）+ 通用域同义扩展；纯函数、零依赖。
  - `src/read/search.mjs`：过滤面用「原词 + 扩展词」放宽，排序用「原问 + 扩展词」，并把 `why/detail`
    纳入打分面（之前只参与过滤）；排序不再把关键词数组直接当 query。
  - 私人实体（人名/作品名/公司名）**不进代码**：宿主启动时 `setAliasProvider(() => loadAliases(dataDir))`
    从 `<dataDir>/aliases.json` 读，文件不存在当空；`src` 只留通用域词，`npm pack` 不含私人名字。
  - 设备上验：20 题 C 配置召回 17/26 → 26/26，回答覆盖 28/52（53.8%）→ **39/52（75.0%）**，
    c08/c17/c10 三道零召回题全部修复（判分器 `eval/grade.mjs`，口径差异见 `docs/EVAL.md` 第七节）。

### Fixed

- **球架上的球点不动**：3D 台面（`rotateX(62deg)` 的 deck / 前缘 / 背板 / 立柱）压在球前面，
  命中测试落在 `.ms-rack` 上而不是 `.ms-ball` 按钮。修法：装饰件 `pointer-events:none`，
  架子容器本身不拦点击，只把球位那一串恢复可点；整排球位再往观众方向抬 14px。
  验证方式：无头浏览器 `elementFromPoint(球心)` 从 `.ms-rack` 变为 `BUTTON.ms-ball`。
- **面板数量对不上**：顶部显示的是总数（如「记忆 25 条」），球架只渲染 `recent`（最近 5 条），
  看起来像丢数据。修法：顶部写明「球架显示最近 5 条」，`/api/summary` 补 `total` 与 `recent_limit`。
- **点击死区（球位里球圆外那圈）**：`onClick` 原本只挂在 44px 的 `.ms-ball` 上，点在软垫/托座上没反应。
  修法：handler 挪到整块 `.ms-slot`，球上移除避免冒泡双触发。
- **点开看不到正文**：卡片只从 `recent` 里找，球不属于最近 5 条时就是空白。
  修法：新增 `GET /dsh-memsys/api/memory?id=`（复用读路径，loopback + 同源鉴权，
  400 `empty_id`/`invalid_id`、404 `not_found`），本地没有就单条拉取，取不到显示「这条读不出来了」。
- **read 工具输出与注册 schema 不一致**：`memsys_get` 被宿主判 `value.snapshot_revision must be a string`。
  修法：六个 read 工具的返回体与 `output.schema` 逐字段对齐（`get` 的真实值 `rev_<n>`、
  `review_get`/`self_get`/`project_get` 补 `reason` 等字段、`context_get` 的报告字段允许 null），
  并新增 `P6/schema: read tool outputs satisfy their registered output schemas`，用真实返回值跑校验。

## 0.3.0

复习考试、人格版本化、数据目录统一、玻璃球精修。

### Added
- **`memsys_quiz` 工具**：`pick` / `challenge` / `submit` / `status` 四种模式。间隔重复调度
  （`1 / 4 / 16 / 64 / 256` 天），复述题只给「我的理解」不给原话，辨伪题只改一个点。
- **`quiz_state` / `quiz_attempts` 两张表**（migration `main-009`）。考试只写自己的表，
  `memories` 行数、`uses` 表、任何 verdict 字段都不变。
- **人格版本化**：`persona/vN.md` 递增版本，设置页第三块可编辑并保留历史；
  上下文注入新增独立 section `memsys:persona`，排在记忆段之前。只有 owner 能改。
- **玻璃球精修**：记忆球架的光学件（主高光 / 对侧反光 / 球底焦散 / 边缘光）、
  按记忆类型上色、按权重分层尺寸、每个球错相浮动。
- `summary` API 的 `recent` 每条多带 `type` / `weight` / `recorded_at`（纯新增字段）。

### Fixed
- **复习间隔从来不会升级**：echo 时代 `level` 只读不写，实际永远按 1 天到期。
  现在 `score >= 0.8` 升一级（封顶 4）、`score < 0.6` 归零。
- **`dueHours` 是个死参数**：全仓没有调用点，已删除，到期只看间隔天数。

### Changed
- 数据目录统一到 `~/.dsh/memsys`，旧的 `data_dir` 散点收敛到唯一 `resolveDataDir()`；
  带幂等迁移（WAL 锁检测，重复跑无副作用）。
- 陈旧说法（`corrected` / `superseded`）默认不进复习题源，避免把已被推翻的说法当"已学会"。

## 0.2.3

- 默认 tokenizer/H，auto-inject 真正能编译；memsys 服务；记忆搜索框；球架面板；精简 README。
