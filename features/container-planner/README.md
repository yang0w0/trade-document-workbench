# 集装箱装箱模块

## 功能范围

本地应用源码支持选择或填写柜体尺寸、录入货物长宽高/数量/单件重量/类型、导入 TXT 或 XLSX、设置禁止倒放、运行自动装箱计算、查看交互式 3D 装柜图，并导出 JSON 方案或 XLSX 装柜单。旧便携版操作见[使用说明](../../ContainerPlanner-网页版/ContainerPlanner/使用说明.md)。

## 模块边界

集装箱模块负责柜型与货物输入、摆放计算、装箱结果和方案导入/导出；统一导航由 `application/web/` 提供，单据解析由 `application/server/trade_documents.py` 提供。

单据模块后续若要提交货物参与装箱，应调用[装箱模块接口](../../docs/interfaces/container-planner-api.md)，不得直接耦合装箱页面状态。

## 当前源码与便携版

- 便携程序：`ContainerPlanner-网页版/ContainerPlanner/ContainerPlanner.exe`
- 打包网页资源：`ContainerPlanner-网页版/ContainerPlanner/_internal/web/`
- 运行依赖：同级 `_internal/`
- 集装箱算法和网页源码：`application/`；与单据功能共用统一网页入口
- 便携 EXE 与应用源码独立；旧便携版不会因修改源码而被覆盖

## 最大装填与新版便携程序

数量留空或填 0 表示最大装填。后端优先保留定量货物，搜索布局并尝试填充剩余空间；不使用前端保守估算封顶，也不自动降低需求件数。停止原因和最优性限制见[最大装填说明](maximum-loading.md)。

源码验证通过后，可用 `packaging/build-portable.ps1` 构建同一源码的网页 EXE，验收流程见[便携构建说明](../../packaging/README.md)。旧便携目录需要备份后再整体替换。

## 简化后的网页操作

网页固定使用自动工作流程与标准计算，无需选择手动或增强模式。底层优先级直接在每个商品卡片中选填，数值越大越靠底层；留空或 0 表示不使用该商品的优先级。存在有效商品的非零优先级时，自动采用产品优先级策略；全部未设置时，使用所选重量 / 密度指标或默认空间利用率策略。旧浏览器保存的工作与计算模式不再恢复。页面已移除使用说明折叠区。
