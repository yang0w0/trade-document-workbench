# 贸易单据标准记录

**Owner:** `features/trade-documents/`  
**Contract ID:** `trade-documents.record.v1`  
**Status:** `proposed`  
**Consumers:** 单据核对/导出；经装箱接口传递已确认货物

## 目的

为不同合同、PI、发票、装箱单等来源提供共同的业务记录。每个可提取字段要能追溯到来源，并区分机器提取、计算和用户确认。

## 记录结构

以下字段是概念契约。最终字段名、必填条件和枚举需用用户提供的样例验证。

| 字段 | 类型/单位 | 说明 |
|---|---|---|
| `recordId` | string | 本次业务记录 ID |
| `contractVersion` | string | 使用的契约版本 |
| `sourceDocuments[]` | object[] | 来源文件 ID、文件名、格式和可定位位置 |
| `seller`、`buyer` | party | 名称、地址，以及来源证据 |
| `references` | object | 合同号、PI/发票号、日期、装运港、目的地和贸易条款等 |
| `items[]` | object[] | 产品描述、包装、数量、单价、金额、重量和尺寸等字段 |
| `field` | object | 每个字段的 `value`、`status`、`evidence[]` 和可选 `confidence` |
| `evidence[]` | object[] | 来源文档 ID、页码/工作表/单元格/段落等位置、原始文本 |
| `status` | enum | `extracted`、`derived`、`user_confirmed`、`missing` 或 `needs_review` |
| `confidence` | number 0–1 或 null | 解析器可选的置信度；不能替代用户确认 |

产品尺寸单位统一使用米，重量使用千克，货物数量使用计件数并保留原单据的单位文本；金额保留币种。来源未给出的尺寸/重量应为 `missing`，除非有明确匹配且确认的产品规格资料。计算值标为 `derived` 并记录公式和输入字段证据。

## 示例

```json
{
  "contractVersion": "trade-documents.record.v1",
  "recordId": "local-record-001",
  "sourceDocuments": [
    {"documentId": "doc-001", "fileName": "contract.xlsx", "format": "xlsx"}
  ],
  "buyer": {
    "name": {
      "value": "Example Buyer",
      "status": "extracted",
      "evidence": [{"documentId": "doc-001", "location": "SC!B9", "rawText": "Example Buyer"}],
      "confidence": null
    }
  },
  "items": [
    {
      "description": {"value": "Example product", "status": "extracted", "evidence": [], "confidence": null},
      "quantity": {"value": 100, "unit": "CTNS", "status": "extracted", "evidence": [], "confidence": null},
      "netWeightKg": {"value": null, "status": "missing", "evidence": [], "confidence": null},
      "dimensionsM": {"length": null, "width": null, "height": null, "status": "missing", "evidence": []}
    }
  ]
}
```

该示例仅用于说明结构，不是实际客户数据，也不是已经由程序实现的 schema。

## 错误与核对

- 无法解析字段：保留原始文件和可用证据，字段置为 `needs_review`，向网页返回定位信息。
- 字段冲突：同时保留候选值及来源，不静默采用某一份文件的值。
- 缺少导出所需字段：保持 `missing` 并由导出契约返回缺项，不填入猜测值。
- 计算字段：保留公式、输入来源与舍入规则；规则在样例确认前不得视为已核定。

## 原文预览适配接口（2026-10-17）

### Excel 来源查看兼容扩展（2026-10-19）

`POST /api/documents/workbook-sessions` 接受 `.xls/.xlsx`，保留上传原件，不按文件名或模板筛选。`GET /api/documents/workbook-sessions/{id}?sheet=...&cell=...` 沿用工作表、单元格、合并区域及样式结构，增加 `capabilities: {edit, downloadOriginal}`：`.xls` 只读，`.xlsx` 保留编辑。`.xls` 使用已有 xlrd 读取，无需用户另存格式；来源坐标沿用识别结果。

`GET /api/documents/workbook-sessions/{id}/original` 下载字节一致的原件。`.xls` 的 `/save` 返回 400，防止把旧格式内容伪装成 `.xlsx` 或丢失原公式。界面按能力显示只读提示和原件下载，不提供只读单元格编辑。会话沿用一小时有效期和 25 MB 上传限制；表格预览不承诺重现图表、嵌入图片或打印分页。

Word（`.doc/.docx`）和 PDF 与 Excel 工作簿编辑会话并列，提供以下本地接口：

- `POST /api/documents/source-sessions`：multipart `file`，返回 `sessionId`、`fileName`。最大 25 MB；内存会话一小时过期，服务重启失效。
- `GET /api/documents/source-sessions/{id}`：原文元数据。
- `POST /api/documents/source-sessions/{id}/focus`：JSON `{location, text}`，按字段来源定位。业务文本不进入页面 URL。
- `GET /api/documents/source-sessions/{id}/pages/{page}.png`：按原页尺寸渲染，标记由网页单独叠加，不改原件。
- `GET /api/documents/source-sessions/{id}/original`：下载与上传字节一致的原件。
- `GET /api/documents/source-sessions/{id}/preview.pdf`：PDF 输入原样返回；Word 返回本机排版引擎生成的 PDF。

元数据包含 `adapter: word|pdf`、`format`、`pageCount`、`pages[{width,height}]`（PDF 点单位）、`focusPage`、`matches[{page,rect,kind?}]`、`locationResolved`、`expiresInSeconds`、`capabilities`。文字可能匹配多处；PDF 表格使用原单元格边界，扫描 PDF 使用已有 OCR 坐标（识别分辨率为 PDF 点单位的 2 倍）。未精确定位时打开来源页并提示人工核对。

后续模板修改沿用格式适配器与能力声明。当前 `preview`、`downloadOriginal` 为 true，`edit`、`fieldMapping` 为 false。取得样例后，模板适配器应增加独立模板 ID、映射版本和 `{fieldId, targetLocator, transform?}` 映射；Word 定位器可指向段落、单元格、内容控件，PDF 定位器可指向表单字段或页内区域。填充应生成新文件、保留原模板、记录来源证据及人工修订，重新验证分页和字体。扫描 PDF 不默认支持直接编辑文字；本轮不提供未经样例验证的模板填充接口。

Word 预览需要 LibreOffice（支持 `LIBREOFFICE_PATH`）或 Windows Microsoft Word。转换以只读方式打开，Word COM 关闭宏及自动链接更新；版式依赖本机引擎和字体，新增模板仍须逐份核对。PDF 的页面、字体和图像来自原件。

## 兼容与状态

### 填写模板接口（2026-10-19）

`GET /api/templates` 返回原有种类，并兼容增加 `trade_sections`（栏目模板）和 `trade_records`（总体模板）。两者沿用 `PUT /api/templates/{kind}/{id}` 的 `{id,name,values}` 和 `DELETE /api/templates/{kind}/{id}`。模板存入同一个后端模板文件，旧文件缺少新种类时视为空列表。

栏目模板 `values` 为 `{group,fields,customFields?}`，group 为单据、交易方、运输、付款、包装、自定义；fields 是字段 ID 到填写值的映射。自定义栏目保存 `{label,value}` 列表。套用时只填写该栏目的字段。总体模板为 `{fields,products,customFields}`；products 为 `{values}` 列表，产品仍限于现有十项字段。总体套用替换整页填写值及产品列表，须先确认；不保存或删除源文件、识别候选、来源证据。产品模板使用原有 `trade_products`，按所点击卡片保存，默认名称为该产品名。所有模板支持删除，同种类同名保存可确认覆盖。

适用当前合同、PI、发票、申报资料的手工填写与核对页面；这些是填写内容模板，不包含正式单据排版、文件生成或字段映射能力。

### 当前 HTTP 提取接口的兼容扩展（2026-10-17）

`POST /api/documents/extract` 仍返回 `document`、`fields`、`unmatchedText`，增加可选 `warnings[]`（`fieldId`、`message`、`location`）。候选保留 `value`、`confidence`、`rawText`、`location`、`evidence[]`，增加 `normalizedValue`，用于数字与单位的等值归并；小数点不再被当作标点删除。格式异常的原文日期保留原值，并带 `needsReview` 与 `reviewNote`。

`GET /api/documents/fields` 动态提供可用字段。新增可选字段：船名 `vessel_name`、航次 `voyage_no`、提箱号 `pickup_no`、卸货港 `discharge_port`、截单时间 `cutoff_date`、品牌 `brand`、品牌类型 `brand_type`、生产日期 `production_date`、批号 `batch_no`、样品数量 `sample_quantity`、加工保存方法 `processing_method`、享惠情况 `export_preference`、成分 `composition`、每柜数量 `quantity_per_container`、未注明毛净重的申报重量 `declared_weight`。

每柜数量不当作整批数量；样品数量不当作批量；卸货港与最终目的港分别保留。仅标注“数/重量”的检验申请中的重量归入 `declared_weight`，不推定毛重或净重。成分比例按工作簿已有百分比显示格式读取，未执行配方计算。来源单据之间的柜量、单价、日期或规格差异继续返回各自候选。

增加可选字段可以在同一主版本内兼容；改名、更改单位语义或删除字段须升级主版本。当前状态为 `proposed`，金额/重量公式、字段来源定位方式及买方/卖方规范化规则都需要样例验证。
