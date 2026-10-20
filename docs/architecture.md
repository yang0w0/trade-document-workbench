# 项目架构

## 运行形态

旧便携程序由 `ContainerPlanner.exe` 启动；可维护的新网页应用源码位于 `application/`，以统一入口并列呈现集装箱装箱与贸易单据处理。两者当前独立，旧 EXE 保留以保证原功能可继续使用。

## 目标组件

| 组件 | 职责 | 不负责 |
|---|---|---|
| `application/web/` 与 `application/server/` | 本地网页载体、FastAPI 服务与公开 API | 各领域的提取规则或装箱算法定义 |
| `application/packer_pro.py`、`application/block_engine.py` | 集装箱计算与 3D 结果数据 | 单据字段提取 |
| `application/server/trade_documents.py` | 单据导入、文本/OCR读取、字段候选与证据 | 自动生成尚未提供模板的正式单据 |
| `shared/contracts/` | 多模块共同遵守的稳定数据结构和接口定义 | 单一模块的领域逻辑 |
| `packaging/` | 可复现的本机便携发布配置和构建脚本 | 业务规则 |

## 依赖方向

```text
web-app ──调用公开接口──> container-planner
       └─调用公开接口──> trade-documents

trade-documents ──装箱数据契约──> container-planner
        └────────契约定义────────> shared/contracts
container-planner ──────────────> shared/contracts
```

模块不得导入或读取另一个模块的内部实现。单据模块要调用装箱功能时，使用装箱模块公布的请求/响应契约。只有真实存在多个消费者的稳定通用能力才进入 shared。

## 当前状态与迁移边界

当前本地网页应用源码与后端已在 `application/` 中，可独立运行与维护。旧便携 EXE 及其 `_internal/` 仍单独保留；应用源码与旧 EXE 的重新打包尚需单独构建流程。

真实业务数据和历史发布包留在原目录，不自动复制进应用或样例。上游仓库元数据已从本地源码移除；再次读取上游必须得到用户明确同意。
