# 网页应用载体

网页载体是浏览器中的统一入口，目标职责包括本地服务启动、静态页面托管、全局导航和模块装配。集装箱装箱与贸易单据处理是它承载的两个并列业务模块。

可维护的统一网页与本地 API 源码位于 [`application/`](../application/README.md)。旧 [`ContainerPlanner.exe`](../ContainerPlanner-网页版/ContainerPlanner/ContainerPlanner.exe) 继续保留作为现成便携程序，不是新网页源码的构建入口。

源码分层及启动方式见本地应用 README。后续可继续在本地应用源码中开发，不要求连接上游仓库。
