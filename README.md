# dsh-memsys

DeepSeek Harness 的长期记忆插件。事实只追加，候选可审，判断与裁决分开；记忆按预算注入上下文，支持项目、惦记、梦境、检索，以及**间隔重复的复习考试**与**可版本化的人格**。

零第三方运行时依赖，只使用 Node 内置的 `node:sqlite`。

## 特性

- **可审写入**：模型只能提交候选；记忆由候选提升产生，不能直接落事实。
- **三库分离**：主库（事实/候选/记忆/证据/关系）、控制库（操作/尝试/编译/快照/容量）、梦库。
- **可靠提交**：预扣、写后读回、最多一次即时补写、连续失败冻结、跨重启恢复。
- **按预算注入**：支持 full / compressed / grouped / protected_overflow 四种交付级别，快照分页可续。
- **复习考试**：`memsys_quiz` 按 `1 / 4 / 16 / 64 / 256` 天间隔出题——复述题只给「我的理解」不给原话，辨伪题只改一处。考试只写自己的表，不碰记忆、不加 uses、不改裁决。
- **人格版本化**：`persona/vN.md` 递增版本，注入时作为独立段落排在记忆段之前；只有主人能改，旧版本永不覆盖。
- **检索与项目**：按关键词、场景、主题、时间检索；口语问句会做同义扩展（「挥霍 token」也能捞到「花钱谨慎」），私人别名可从数据目录加载；项目概览与版本；待确认惦记的审核分区。
- **模块开关**：context / read / write / dream / projects / due / feed 七项独立开关（复习考试跟随 `due`）。
- **可选 Web UI**：左侧栏「记忆」走廊（木架 5×5 格，滚轮一格翻一面墙）、设置页模块开关与人格编辑；无 Web 服务时自动降级。

## 环境要求

- Node.js >= 22.13
- DeepSeek Harness 0.2.x
- 无第三方运行时依赖

## 安装

```bash
dsh plugin --profile <profile> add dsh-memsys
```

建议使用独立 profile，不要直接装进日常使用的 profile。

从源码安装时，先把仓库复制到临时目录再安装，不要在 profile 里使用 junction 或符号链接。

```bash
dsh plugin --profile <profile> add "file:///C:/path/to/dsh-memsys"
```

安装后自检：

```bash
dsh --profile <profile> --dump-config
```

配置中应出现 `dsh-memsys`。

## 配置

数据目录只有一处解析逻辑：默认 `~/.dsh/memsys`，可用 `MEMSYS_DATA_DIR` 环境变量或显式 `data_dir` 覆盖。

```yaml
- id: memsys
  config:
    modules:
      context: true
      read: true
      write: true
      dream: true
      projects: true
      due: true
      feed: true
```

- `data_dir`：**0.3.0 起已废弃**，默认使用 `~/.dsh/memsys`。旧目录请先用 `node scripts/migrate-datadir.mjs --from <旧目录> --dry-run` 预演，再执行正式迁移。
- `modules`：缺省为开启。安装后的默认行为是自动注入关闭（`context: false`），其余六项开启；可在设置页或 `ui-config.json` 中覆盖。
- `persona_section`：是否注入 `memsys:persona` 段落（默认 `true`），顺序固定 400，在记忆段（500）之前。
- 兼容旧配置：只有 `auto_inject: true` 时等价于 `modules.context: true`。

配置优先级：

1. `<data_dir>/ui-config.json`
2. profile 的 `config`
3. 默认值

## 工具

| 工具 | 用途 |
|---|---|
| `memsys_get` | 按 id 读取记忆、证据、时间线，支持历史视图 |
| `memsys_search` | 关键词 / 场景 / 主题 / 时间检索 |
| `memsys_review_get` | 候选、待审、惦记历史、已确认梦境 |
| `memsys_context_get` | 展开冻结上下文快照中的一个分组 |
| `memsys_project_get` | 项目概览与版本历史 |
| `memsys_self_get` | 自述、判断、推测 |
| `memsys_record` | 写入候选、判断、自述、项目更新、惦记操作提案 |
| `memsys_dream_record` | 记录梦境与命题 |
| `memsys_organize` | 精确合并或取代提案 |
| `memsys_feed` | 信息流筛选（需要对应 provider） |
| `memsys_quiz` | 复习考试：`pick` 出复述题 / `challenge` 出辨伪题 / `submit` 交卷判分 / `status` 看进度 |

复习考试的一条完整回合：

```text
memsys_quiz { mode: "pick" }                       # 只给元信息 + 我的理解，不给原话
memsys_quiz { mode: "submit", kind: "pick",
              id: "<上一步返回的 id>",
              answer: "凭印象复述的内容" }          # 交卷，level 按分数升降
memsys_quiz { mode: "status" }                     # 考过 N 条 / 平均分 / 考砸几条 / 最差一条
```

关闭模块时：

- `read: false`：不注册读取类工具。
- `dream: false`：不注册梦境工具，梦不浮现。
- `projects: false`：不注册项目读取工具。
- `feed: false`：不注册信息流工具。
- `due: false`：不注册复习考试工具。
- `write: false`：写工具保留注册，但调用返回 `module_disabled`。

## Web UI

安装后，Web GUI 会增加：

- **左侧栏「记忆」走廊**：记忆条数、候选条数、待确认惦记数，以及一条**记忆走廊**——
  一面墙 5 层 × 5 颗 = 25 条，球坐在白色丝绒垫上，按记忆类型上色；
  滚轮一格翻一整面墙（往前=更旧、往回走缓存），点球展开正文。
  纯 CSS 3D 实现，不引 three.js、不加构建步骤。
- **设置 →「记忆系统」**：模块开关、当前数据目录，以及「人格」编辑块（保存为新版本、查看历史版本）。
- **数据接口**：`/dsh-memsys/api/summary`（带 `?offset=&limit=25` 时按面分页）、`/dsh-memsys/api/config`、`/dsh-memsys/api/persona`、`/dsh-memsys/api/memory?id=`（单条正文），仅接受 loopback 与同源请求。

没有 `webServer` 服务时，host 半不激活 UI 路由，浏览器半也不会加载；headless profile 不受影响。

## 数据与备份

- 默认目录：`~/.dsh/memsys`（可用 `MEMSYS_DATA_DIR` 或显式 `data_dir` 覆盖）。
- `aliases.json`（可选）：私人别名表，形如 `[{"triggers":["创作线"],"adds":["钢铁黎明","civ-evo"]}]`；
  只从数据目录读、**不进 npm 包**，用于把口语问句映射到记忆里的写法。
- `memsys.db`：业务事实与证据，以及 `quiz_state` / `quiz_attempts`。
- `control.db`：操作账、编译快照、容量与恢复。
- `dreams.db`：梦境库。
- 备份使用 SQLite 一致性备份；恢复校验会比较三库版本与关键表内容，不一致时失败。
- 迁移旧数据：`node scripts/migrate-datadir.mjs --from <旧目录> [--dry-run]`，幂等、带 WAL 锁检测与内容校验，重复执行无副作用。

## 开发

```bash
npm test
npm run build
```

测试覆盖存储、写入、可靠提交、上下文编译、检索、项目、惦记、梦、导入、回退、模块闸门，以及复习考试（调度 / 出题 / 判卷 / 工具面）与人格版本化。

## 设计边界

- 模型不能直接写记忆，只能提交候选；确认与裁决属于主人侧动作。
- 复习考试不改记忆、不加 uses、不改任何裁决字段；陈旧说法（corrected / superseded）默认不进题源。
- 人格只有主人能改；旧版本只追加不覆盖。
- 没有宿主回执时，交付状态保持 `unknown`，不假装已投递。
- 证据必须能回到原始观察；来源不可读或字节范围变化时，门牌回填拒绝写入。
- 自动注入是显式开关；关闭时只保留普通工具读取。

## 已知限制

- `L6` 回退核验只到内容 hash 与关联，**未逐项重放 relations 内容**。
- 真实旧库尚未导入；生产 cutover 未跑。
- `feed` 的生产 provider 未接。
- 界面只在开发者本机目测过一次，未做多分辨率与暗色之外的主题验证。
- 自动注入默认关闭（`context: false`），需要手动开启。
- 3D 球架是 CSS 3D 实现（零依赖、无构建），不做真正的折射渲染。

## License

MIT
