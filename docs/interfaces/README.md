# 接口目录

本目录记录跨层和跨模块的公开契约。调用方应依赖这里记录的业务数据和行为，不依赖其他模块内部路径。

| 接口 | 所有者 | 状态 | 用途 |
|---|---|---|---|
| [网页载体与模块接口](web-app-module-interface.md) | `web-app/` | `proposed` | 模块发现、导航和生命周期边界 |
| [贸易单据标准记录](trade-document-record.md) | `features/trade-documents/` | `proposed` | 提取字段、来源证据与确认状态 |
| [集装箱装箱 API](container-planner-api.md) | `features/container-planner/` | `proposed` | 接收柜型/货物并返回装箱结果 |
| [单据导出接口](document-export.md) | `features/trade-documents/` | `proposed` | 按模板导出 INV、PL 等文件 |

## 状态约定

- `proposed`：业务约定草案，尚未对照独立源码、真实接口或用户模板验证。
- `verified`：已对照实现及代表性样例验证，且模块所有者确认。

修改接口时先更新其契约与版本，再更新本模块调用适配层。只有经验证的契约才可作为现有实现能力向用户描述。当前网页通过本地 FastAPI 服务提供 HTTP/JSON 接口；业务字段定义应与传输方式解耦。
