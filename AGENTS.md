# 项目协作规则

- 先读本文件和 [`docs/architecture.md`](docs/architecture.md)，再读任务所属模块的 README、`AGENTS.md` 和相关接口文档。
- 一次功能任务只查看、修改其所属模块及明确授权的共享接口；不要检查或修改其他模块的内部实现。
- 需要其他模块能力时，通过 [`docs/interfaces/`](docs/interfaces/README.md) 中的公开契约调用；接口不完整时，只提出或修改契约及本模块适配层。
- 真实业务资料位于 `真实数据/`，不得擅自复制到样例、测试夹具或发布包。样例需用户提供并确认，优先使用脱敏副本。
- 测试或修复单据导入、真实文件识别、OCR 时，先读 [`efficient-import-testing` skill](features/trade-documents/skills/efficient-import-testing/SKILL.md)，按分层缓存、失败摘要、定向回归与一次最终验收执行；修改与结果未变化时不重复运行昂贵检查。
- `ContainerPlanner.exe` 与 `_internal/` 是旧便携产物；当前可维护网页和后端源码位于 `application/`，不可将旧 EXE 当作该源码的构建入口。
- 新代码和文档按 `docs/project-management.md` 分类摆放。不要为规划中的目录创建没有实际内容的空源码目录。
- 当前网页与后端已本地化到 `application/`。未经用户明确同意，不得访问、读取或同步上游开源仓库；后续实现只基于本地副本进行。
