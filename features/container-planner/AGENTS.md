# 集装箱模块协作规则

- 仅修改集装箱模块自己的实现、说明和模块内验证材料。
- 浏览器全局导航归 `web-app/`；贸易单据解析和文件生成归 `features/trade-documents/`。
- 对外提供货物/柜型输入和装箱结果接口；消费者通过 `docs/interfaces/container-planner-api.md` 集成，不查看或修改本模块内部算法。
- 当前只有打包程序和内嵌网页资源，独立源码/构建流程尚未确认；不得把 `_internal/` 直接当作完整源码。
