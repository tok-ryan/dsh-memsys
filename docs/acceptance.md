# 验收清单（第一批，已按 plan-1 填实）

> 规则：每条都是可粘贴命令 + 明确期望。**跑不过就是没过**。从工作区根目录执行；PowerShell 不串联 `&&`，逐条跑并看退出码。
> 图：`_build/plan-1.md`；事实：`_build/env-facts.md`（无 git，回滚用时间戳备份目录）。

## 通用门禁（每个里程碑都跑）

| # | 命令 | 期望 |
|---|---|---|
| G1 | `node --version` | >= 22.13（本机 24.19.0），且 `node:sqlite` 可用 |
| G2 | `npm --prefix whale-unify/memsys run build` | 输出 `BUILD_OK`，退出码 0，无下载/编译 |
| G3 | `npm --prefix whale-unify/memsys test` | TAP `fail 0`、`tests > 0`、`skipped 0` |
| G4 | `node whale-unify/scripts/now.mjs` | 打印真实时间 + 非空读数编号 |
| G5 | `node whale-unify/memsys/scripts/check-bom.mjs` | `UTF8_OK BOM=0`，退出码 0 |

## 里程碑

| 里程碑 | 命令 | 期望 |
|---|---|---|
| **M1 存储底座** | `node whale-unify/memsys/scripts/migrate.mjs --data-dir whale-unify/_build/test-data/m1`<br>`node --test whale-unify/memsys/test/m1-storage.test.mjs`<br>`node whale-unify/memsys/scripts/check-db.mjs --data-dir whale-unify/_build/test-data/m1` | `MIGRATIONS_OK main=3 control=2 dream=1`（M4 后版本号已升）；TAP `fail 0`；三库 `integrity_check=ok`、`foreign_key_check=0`；二次迁移无新增；非法 UPDATE/DELETE 被拒；SAVEPOINT 回滚有效 |
| **M2 写入三段** | `node --test whale-unify/memsys/test/m2-write.test.mjs` | TAP `fail 0`；普通输入 = 1 observation + 1 capture + 0 memory；`记住：` 命令 = 1 memory + 1 promote；重复回调计数不变；六步任一步抛错不留半条 memory，原 observation 仍 found |
| **M3 可靠提交** | `node --test whale-unify/memsys/test/m3-reliable.test.mjs` | TAP `fail 0`；两败 + 重启第三败 → `frozen=true, consecutive_failures=3`，第四次业务写 0 次；第三次 found 可清零；冻结后只记 reconciliation |
| **M4 注入器官** | `node --test whale-unify/memsys/test/m4-context.test.mjs`<br>`node whale-unify/memsys/scripts/live-check.mjs --case inject --profile memsys-plan1-probe` | TAP `fail 0`；段名 `memsys:context`、order 500 出现在 `system/message`；无回执时 `delivery=unknown`；`auto_inject=false` 默认 |
| **M5 取回工具** | `node --test whale-unify/memsys/test/m5-tools.test.mjs whale-unify/memsys/test/e2e.test.mjs` | TAP `fail 0`；工具签名符合 §9.0a；分页游标可续；E1–E3 全绿 |

## 端到端（随 M5 跑）

| # | 场景 | 期望 |
|---|---|---|
| E1 | `记住：不吃葱。` → 下一轮目录 | 正文精确、quoted/utterance、start=null、scope=life-only；重放不增条；无回执时 `delivery=unknown` |
| E2 | `我不喜欢刺角瓜。`（未注册实体） | 直接提升 proposed/assertion、`key_status=unresolved`、可检索、禁止裁决/取代/梦确认 |
| E3 | 200+ 条造数 → 硬预算 | `level=grouped, capacity_insufficient=true`；每组有名称/条数/取回参数；遍历集合与 manifest 相等；`protected_overflow` 只在 P+K 装不下时出现 |

## 打回规则

- G1–G5 任一不过 → 打回，**不计**失败次数。
- 里程碑验收不过 → 计一次失败；连续 3 次 → 冻结，写 `_build/blockers.md`，停手报主管。
- 打回时必须附：命令 + 实际输出 + 你以为会看到什么。
