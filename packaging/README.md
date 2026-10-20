# 源码网页的便携构建

当前构建入口为 `launcher.py`，加载 `application/server/main.py`，使用同一份源码和网页资源。旧的 `application/build_exe.bat` 仅构建命令行算法程序，不用于本网页 EXE。

1. 在 `application/web_env` 安装应用依赖和 `pyinstaller==6.22.3`。
2. 运行 `packaging/build-portable.ps1`，输出目录为 `packaging/dist/ContainerPlanner/`。
3. 双击输出目录里的 `ContainerPlanner.exe`，自动打开本机网页。服务仅监听 `127.0.0.1`，端口写入同级 `data/port.txt`；日志与模板也在 `data/`。
4. 设置 `LOADER_NO_BROWSER=1` 启动输出 EXE，再使用应用 Python 运行 `packaging/smoke-portable.py <便携目录绝对路径>`，验证 EXE 的启动、装箱子进程、Excel 方案回读和数量留空清单回读，以及合成 Excel/Word/PDF/图片 OCR 提取、Excel/PDF 来源预览和所有网页资源的 SHA-256 一致性。测试脚本使用构建环境依赖和 Windows Arial 字体；EXE 本身不依赖系统 Python。
5. 验证通过后部署整个目录，不能只复制 EXE。替换现有便携版前先将旧目录改名备份，保留用户数据。

设置 `LOADER_NO_BROWSER=1` 可用于无弹窗验收；`LOADER_PORT` 可指定端口。构建不包含 `application/data` 或任何真实业务资料。

启动器识别 OCR 子进程入口，并在无控制台的 Windows EXE 中恢复父进程传入的输入输出管道，避免 OCR 请求误启动另一个网页服务。运行 `application/web_env/Scripts/python.exe -m unittest discover -s packaging -p test_launcher.py` 验证入口分派。

Word 原版式预览与旧版 DOC 读取沿用应用对本机 Word/LibreOffice 的依赖；本构建不内置 Office 排版引擎。DOCX 文本读取、PDF、Excel 和 OCR 依赖随包发布。
