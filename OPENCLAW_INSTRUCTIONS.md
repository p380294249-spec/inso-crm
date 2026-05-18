# OpenClaw 操作指令 — INSO CRM API 框架搭建

这是分步指令，按顺序执行，不要跳步。

---

## 第一步：复制 Google Sheets ID

1. 打开 Shawn 的 Google Sheets（他会发你链接）
2. 看浏览器地址栏，格式是：
   ```
   https://docs.google.com/spreadsheets/d/【这一段就是ID】/edit
   ```
3. 复制那段 ID，后面要用

---

## 第二步：打开 Apps Script

1. 在 Google Sheets 页面，点顶部菜单：**扩展程序 → Apps Script**
2. 会打开一个新窗口，左边显示 `Code.gs`
3. 把里面原有的所有代码**全部删掉**

---

## 第三步：粘贴代码

把下面 `Code.gs` 文件里的代码**完整复制**，粘贴到 Apps Script 编辑器里。

粘贴完之后，找到第 6 行：
```javascript
const SPREADSHEET_ID = 'YOUR_SPREADSHEET_ID_HERE';
```
把 `YOUR_SPREADSHEET_ID_HERE` 替换成第一步复制的 ID。

替换后例子（你的ID不一样，这只是示意）：
```javascript
const SPREADSHEET_ID = '1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgVE2upms';
```

---

## 第四步：保存并部署

1. 点右上角**保存图标**（或 Ctrl+S）
2. 点右上角蓝色按钮 **"部署" → "新建部署"**
3. 点"类型"旁边的设置图标 ⚙️，选择 **"网页应用"**
4. 填写以下设置：
   - 说明：`INSO CRM API v1`
   - 执行身份：**我（你的 Google 账户）**
   - 谁可以访问：**所有人**
5. 点 **"部署"**
6. Google 会要求授权，点 **"授权访问"** → 选你的 Google 账号 → 点 **"高级"** → 点 **"转到 INSO CRM API（不安全）"** → 点 **"允许"**
7. 部署成功后会显示一个 **"网络应用网址"**，格式是：
   ```
   https://script.google.com/macros/s/xxxxxxxx/exec
   ```
8. **把这个网址复制发给 Shawn**，这就是 API 地址

---

## 第五步：测试 API 是否正常

在浏览器地址栏直接访问（把网址换成你刚才得到的）：

```
https://script.google.com/macros/s/你的ID/exec?action=ping
```

如果看到：
```json
{"status":"ok","message":"INSO CRM API is running"}
```

说明 **API 部署成功**，告诉 Shawn 可以继续下一步。

如果看到错误，截图发给 Shawn。

---

## 注意事项

- 每次修改代码后，必须重新部署（"部署" → "管理部署" → 编辑 → 版本选"新版本" → 部署）
- 不要修改代码里任何中文注释以外的内容
- Sheet 名称必须和代码里一致（见下方说明）

## Google Sheets 必须有这四个 Sheet（标签页名称）

| Sheet 名称 | 用途 |
|-----------|------|
| `Customers` | 客户主档 |
| `Contact_Log` | 联系记录 |
| `Quote_Log` | 报价记录 |
| `Dashboard` | 统计（可以先空着）|

名称必须完全一致，包括大小写。
