# Changelog

## 0.3.0 (unreleased)

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
