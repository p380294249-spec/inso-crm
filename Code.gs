// ============================================================
// INSO CRM — Google Apps Script API
// 版本：v1.0
// 说明：这是 API 中间层，连接前端网页和 Google Sheets
// ============================================================

const SPREADSHEET_ID = '12bRXbKGBVIG09LWcLrxdg68J1kmem4UXjJzpfwboO9k'; // ← 替换这里

// ============================================================
// 入口：所有 GET 请求走这里
// ============================================================
function doGet(e) {
  const action = e.parameter.action;

  try {
    if (action === 'ping') {
      return respond({ status: 'ok', message: 'INSO CRM API is running' });
    }

    if (action === 'getCustomers') {
      return respond(getCustomers(e.parameter));
    }

    if (action === 'getContactLog') {
      return respond(getContactLog(e.parameter));
    }

    if (action === 'getDashboard') {
      return respond(getDashboard());
    }

    if (action === 'getFollowups') {
      return respond(getFollowups());
    }

    return respond({ status: 'error', message: 'Unknown action: ' + action });

  } catch (err) {
    return respond({ status: 'error', message: err.toString() });
  }
}

// ============================================================
// 入口：所有 POST 请求走这里
// ============================================================
function doPost(e) {
  try {
    const body = JSON.parse(e.postData.contents);
    const action = body.action;

    if (action === 'addContactLog') {
      return respond(addContactLog(body.data));
    }

    if (action === 'addQuote') {
      return respond(addQuote(body.data));
    }

    if (action === 'updateCustomer') {
      return respond(updateCustomer(body.data));
    }

    return respond({ status: 'error', message: 'Unknown action: ' + action });

  } catch (err) {
    return respond({ status: 'error', message: err.toString() });
  }
}

// ============================================================
// GET：获取客户列表
// 参数：search（可选，按公司名或联系人搜索）
// ============================================================
function getCustomers(params) {
  const sheet = getSheet('Customers');
  const rows = sheetToObjects(sheet);

  let result = rows;

  // 如果有搜索关键词
  if (params.search) {
    const keyword = params.search.toLowerCase();
    result = rows.filter(r =>
      (r.company && r.company.toLowerCase().includes(keyword)) ||
      (r.contact_person && r.contact_person.toLowerCase().includes(keyword)) ||
      (r.customer_id && r.customer_id.toLowerCase().includes(keyword))
    );
  }

  return { status: 'ok', data: result, total: result.length };
}

// ============================================================
// GET：获取联系记录
// 参数：customer_id（可选）, date（可选，格式 YYYY-MM-DD）
// ============================================================
function getContactLog(params) {
  const sheet = getSheet('Contact_Log');
  const rows = sheetToObjects(sheet);

  let result = rows;

  if (params.customer_id) {
    result = result.filter(r => r.customer_id === params.customer_id);
  }

  if (params.date) {
    result = result.filter(r => r.log_date === params.date);
  }

  // 按时间倒序
  result.sort((a, b) => {
    const da = new Date(a.log_date + ' ' + (a.log_time || '00:00'));
    const db = new Date(b.log_date + ' ' + (b.log_time || '00:00'));
    return db - da;
  });

  return { status: 'ok', data: result, total: result.length };
}

// ============================================================
// GET：Dashboard 统计数据
// ============================================================
function getDashboard() {
  const today = formatDate(new Date());
  const logSheet = getSheet('Contact_Log');
  const quoteSheet = getSheet('Quote_Log');

  const logs = sheetToObjects(logSheet);
  const quotes = sheetToObjects(quoteSheet);

  const todayLogs = logs.filter(r => r.log_date === today);
  const todayQuotes = quotes.filter(r => r.quote_date === today);

  // 去重函数
  const uniqueCustomers = (arr) => [...new Set(arr.map(r => r.customer_id).filter(Boolean))];

  const contacted = uniqueCustomers(todayLogs.filter(r => r.action_type === 'SENT'));
  const replied = uniqueCustomers(todayLogs.filter(r => r.has_reply === 'TRUE'));
  const hasDemand = uniqueCustomers(todayLogs.filter(r => r.has_demand === 'TRUE'));
  const hasRfq = uniqueCustomers(todayLogs.filter(r => r.has_rfq === 'TRUE'));
  const quoted = uniqueCustomers(todayQuotes.filter(r => r.quote_status === '已报价'));

  // 今天有RFQ但未报价
  const rfqIds = new Set(hasRfq);
  const quotedIds = new Set(quoted);
  const pendingQuote = [...rfqIds].filter(id => !quotedIds.has(id));

  return {
    status: 'ok',
    date: today,
    data: {
      contacted_count: contacted.length,
      replied_count: replied.length,
      demand_count: hasDemand.length,
      rfq_count: hasRfq.length,
      quoted_count: quoted.length,
      pending_quote_count: pendingQuote.length,
      pending_quote_ids: pendingQuote
    }
  };
}

// ============================================================
// GET：今天需要跟进的客户
// ============================================================
function getFollowups() {
  const today = formatDate(new Date());
  const sheet = getSheet('Customers');
  const rows = sheetToObjects(sheet);

  const due = rows.filter(r =>
    r.next_followup_date &&
    r.next_followup_date <= today &&
    r.followup_status === 'active'
  );

  due.sort((a, b) => a.next_followup_date.localeCompare(b.next_followup_date));

  return { status: 'ok', data: due, total: due.length };
}

// ============================================================
// POST：写入联系记录（同时更新客户主档）
// ============================================================
function addContactLog(data) {
  const logSheet = getSheet('Contact_Log');
  const custSheet = getSheet('Customers');

  // 自动生成 log_id
  const lastRow = logSheet.getLastRow();
  const logId = 'LOG-' + String(lastRow).padStart(6, '0');

  // 自动填入时间
  const now = new Date();
  const logDate = data.log_date || formatDate(now);
  const logTime = data.log_time || formatTime(now);

  // 写入一行到 Contact_Log
  logSheet.appendRow([
    logId,
    logDate,
    logTime,
    data.customer_id || '',
    data.company || '',
    data.contact_person || '',
    data.channel || '',
    data.action_type || '',
    data.my_message || '',
    data.customer_reply || '',
    data.ai_summary || '',
    data.result || '',
    data.has_reply || 'FALSE',
    data.has_demand || 'FALSE',
    data.has_rfq || 'FALSE',
    data.has_quote || 'FALSE',
    data.next_followup_date || '',
    data.created_by || 'Shawn',
    data.remark || ''
  ]);

  // 同步更新 Customers 主档对应字段
  updateCustomerDates(custSheet, data.customer_id, {
    last_contact_date: logDate,
    last_reply_date: data.has_reply === 'TRUE' ? logDate : null,
    last_rfq_date: data.has_rfq === 'TRUE' ? logDate : null,
    next_followup_date: data.next_followup_date || null
  });

  return { status: 'ok', log_id: logId };
}

// ============================================================
// POST：写入报价记录
// ============================================================
function addQuote(data) {
  const sheet = getSheet('Quote_Log');

  const now = new Date();
  const quoteDate = data.quote_date || formatDate(now);

  sheet.appendRow([
    quoteDate,
    data.customer_id || '',
    data.company || '',
    data.contact_person || '',
    data.quote_status || '已报价',
    data.rfq_status || '',
    data.followup_status || '待跟进',
    data.mpn || '',
    data.qty || '',
    data.quoted_price || '',
    data.remark || ''
  ]);

  // 更新客户主档 last_quote_date
  const custSheet = getSheet('Customers');
  updateCustomerDates(custSheet, data.customer_id, {
    last_quote_date: quoteDate
  });

  return { status: 'ok' };
}

// ============================================================
// POST：更新客户信息
// ============================================================
function updateCustomer(data) {
  const sheet = getSheet('Customers');
  const rows = sheet.getDataRange().getValues();
  const headers = rows[0];

  const idCol = headers.indexOf('customer_id');
  if (idCol === -1) throw new Error('Customers sheet 缺少 customer_id 列');

  for (let i = 1; i < rows.length; i++) {
    if (rows[i][idCol] === data.customer_id) {
      // 更新指定字段
      Object.keys(data).forEach(key => {
        const col = headers.indexOf(key);
        if (col !== -1 && key !== 'customer_id') {
          sheet.getRange(i + 1, col + 1).setValue(data[key]);
        }
      });
      return { status: 'ok', updated: data.customer_id };
    }
  }

  return { status: 'error', message: '客户不存在: ' + data.customer_id };
}

// ============================================================
// 内部工具函数
// ============================================================

// 更新客户主档日期字段
function updateCustomerDates(sheet, customerId, dates) {
  if (!customerId) return;

  const rows = sheet.getDataRange().getValues();
  const headers = rows[0];
  const idCol = headers.indexOf('customer_id');

  for (let i = 1; i < rows.length; i++) {
    if (rows[i][idCol] === customerId) {
      Object.keys(dates).forEach(key => {
        if (dates[key]) {
          const col = headers.indexOf(key);
          if (col !== -1) {
            sheet.getRange(i + 1, col + 1).setValue(dates[key]);
          }
        }
      });
      break;
    }
  }
}

// 获取 Sheet（找不到则报错提示）
function getSheet(name) {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  const sheet = ss.getSheetByName(name);
  if (!sheet) throw new Error('找不到 Sheet: ' + name + '，请检查标签页名称是否正确');
  return sheet;
}

// Sheet 转 JSON 对象数组
function sheetToObjects(sheet) {
  const data = sheet.getDataRange().getValues();
  if (data.length < 2) return [];

  const headers = data[0];
  return data.slice(1).map(row => {
    const obj = {};
    headers.forEach((h, i) => {
      // 日期对象转字符串
      if (row[i] instanceof Date) {
        obj[h] = formatDate(row[i]);
      } else {
        obj[h] = row[i] === '' ? null : String(row[i]);
      }
    });
    return obj;
  }).filter(r => r.customer_id || r.log_id || r.quote_date); // 过滤空行
}

// 统一 JSON 返回格式（加 CORS 头）
function respond(data) {
  return ContentService
    .createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
}

// 格式化日期 → YYYY-MM-DD
function formatDate(date) {
  if (!date || !(date instanceof Date)) return '';
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

// 格式化时间 → HH:MM
function formatTime(date) {
  const h = String(date.getHours()).padStart(2, '0');
  const m = String(date.getMinutes()).padStart(2, '0');
  return `${h}:${m}`;
}
