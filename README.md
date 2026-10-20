# 本地集装箱与贸易单据工作台

这是一个本机运行的业务工作台，在同一网页入口提供两个并列功能：**集装箱装箱**和**贸易单据处理**。可维护的网页、后端与算法源码位于 `application/`。

## 当前使用方式

1. 将整个 `ContainerPlanner-网页版/ContainerPlanner/` 文件夹复制到 Windows 电脑。
2. 双击 `ContainerPlanner.exe`，保留启动的命令行窗口；程序会打开浏览器操作页面。
3. 使用结束后关闭命令行窗口。

这条路径是原便携版，继续提供原有集装箱功能。需要使用新开发的贸易单据导入与识别页面时，在 `application/` 中运行 `run_web_app.bat`；首次运行需要 Python 3.11+ 和网络来安装依赖，之后打开本机网页使用。新网页目前作为本地源码应用运行，尚未打成替换旧 EXE 的便携包。原便携版操作说明见 [`ContainerPlanner-网页版/ContainerPlanner/使用说明.md`](ContainerPlanner-网页版/ContainerPlanner/使用说明.md)。

## 当前项目状态

- `ContainerPlanner-网页版/ContainerPlanner/ContainerPlanner.exe` 是原有便携程序，保留用于原有集装箱功能。
- `application/` 是本地维护的完整网页应用源码，含 FastAPI 后端、静态前端、集装箱算法与单据解析接口。它与旧 EXE 是分开的，后续可独立运行、迭代和构建。
- 贸易单据页面提供统一规则的文件识别、字段候选提取、重复/冲突展示、来源证据、手工修订和本地保存；解析服务位于 `application/server/trade_documents.py`。
- OCR 在本机通过 RapidOCR/ONNX Runtime 执行。当前字段别名与规则是首版，待用户提供样例后可按真实格式扩充；识别结果需要人工核对。

## 项目导航

- [架构和依赖边界](docs/architecture.md)
- [本地网页源码与启动方式](application/README.md)
- [项目管理、命名和文件摆放](docs/project-management.md)
- [网页应用载体](web-app/README.md)
- [集装箱装箱模块](features/container-planner/README.md)
- [贸易单据模块与样例位置](features/trade-documents/README.md)
- [跨模块接口索引](docs/interfaces/README.md)
- [已确认的架构设计](docs/superpowers/specs/2026-10-17-project-architecture-design.md)
- [项目基础实施计划](docs/superpowers/plans/2026-10-17-project-foundation.md)

## 根目录数据

`真实数据/` 保存本机业务资料；`测试数据/` 保存装箱测试输入；`测试工具/` 和 `测试记录/` 保存既有分析脚本与记录；`发布包/` 保存便携包。真实资料不会自动作为功能样例或复制进发布包。

## 来源与许可

`application/` 的装箱网页、后端及算法代码基于 [hyt0019/loader](https://github.com/hyt0019/loader) 项目本地化后继续维护。上游项目采用 MIT License；以下保留其版权及许可声明，满足许可条件。当前工作目录已移除上游 Git 元数据，不配置上游远程，也不自动同步。以后如确需重新读取上游内容，必须先取得用户明确同意。

Copyright (c) 2026 HE

Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
