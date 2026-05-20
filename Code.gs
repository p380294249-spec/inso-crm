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

    if (action === 'syncQuotes') {
      return respond(syncAllQuotesToCustomers());
    }

    if (action === 'setupQuoteWorkflow') {
      return respond(setupQuoteWorkflow());
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

    if (action === 'syncQuotes') {
      return respond(syncAllQuotesToCustomers());
    }

    if (action === 'setupQuoteWorkflow') {
      return respond(setupQuoteWorkflow());
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

  const due = rows.filter(r => {
    const nextDate = getRowValue(r, ['next_followup_date', '下次跟进日期']);
    const status = getRowValue(r, ['followup_status', '跟进状态']) || 'active';
    return nextDate && nextDate <= today && status === 'active';
  });

  due.sort((a, b) => {
    const da = getRowValue(a, ['next_followup_date', '下次跟进日期']);
    const db = getRowValue(b, ['next_followup_date', '下次跟进日期']);
    return da.localeCompare(db);
  });

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
    customer_stage: getStageFromContactLog(data),
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
  syncQuoteToCustomer({
    quote_date: quoteDate,
    customer_id: data.customer_id || '',
    company: data.company || '',
    contact_person: data.contact_person || '',
    quote_status: data.quote_status || '已报价',
    rfq_status: data.rfq_status || '',
    followup_status: data.followup_status || '待跟进'
  });
  appendQuoteStatusContactLog({
    quote_date: quoteDate,
    customer_id: data.customer_id || '',
    company: data.company || '',
    contact_person: data.contact_person || '',
    quote_status: data.quote_status || '已报价',
    rfq_status: data.rfq_status || '',
    followup_status: data.followup_status || '待跟进',
    remark: data.remark || ''
  }, data.quote_status || '已报价', sheet.getLastRow());

  return { status: 'ok' };
}

// ============================================================
// Sheet 编辑报价状态时，自动同步客户主档
// ============================================================
function onEdit(e) {
  if (!e || !e.range) return;
  const sheet = e.range.getSheet();
  if (sheet.getName() !== 'Quote_Log') return;
  if (e.range.getRow() === 1) return;

  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  const watchedKeys = [
    'quote_status',
    'rfq_status',
    'followup_status',
    'quote_date',
    'customer_id',
    'company',
    'contact_person'
  ];
  const watchedCols = watchedKeys
    .map(key => findHeaderIndex(headers, key) + 1)
    .filter(col => col > 0);

  if (watchedCols.length > 0 && watchedCols.indexOf(e.range.getColumn()) === -1) return;

  const rowObj = sheetRowToObject(sheet, e.range.getRow());
  syncQuoteToCustomer(rowObj, e.source);

  const quoteStatusCol = findHeaderIndex(headers, 'quote_status') + 1;
  const statusChanged = e.range.getColumn() === quoteStatusCol && e.value && e.value !== e.oldValue;
  if (statusChanged && isMeaningfulQuoteStatus(e.value)) {
    appendQuoteStatusContactLog(rowObj, e.value, e.range.getRow(), e.source);
  }
}

function setupQuoteWorkflow() {
  const sheet = getSheet('Quote_Log');
  ensureQuoteWorkflowHeaders(sheet);
  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];

  applyDropdown(sheet, headers, 'quote_status', [
    '收到报价',
    '已发采购',
    '采购已报价',
    '已报给客户',
    '已成交',
    '丢单',
    '待跟进'
  ]);
  applyDropdown(sheet, headers, 'rfq_status', [
    '待处理',
    '已发采购',
    '采购已回复',
    '客户确认',
    '关闭'
  ]);
  applyDropdown(sheet, headers, 'followup_status', [
    'active',
    '待跟进',
    '已报价待跟进',
    '已成交',
    '丢单',
    'closed'
  ]);

  setupCustomerStageDropdown();

  return { status: 'ok', message: 'Quote_Log dropdowns updated' };
}

function setupCustomerStageDropdown() {
  const sheet = getSheet('Customers');
  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  applyDropdown(sheet, headers, 'customer_stage', [
    '待开发',
    '有回复',
    '有询价',
    '有成交'
  ]);
}

function ensureQuoteWorkflowHeaders(sheet) {
  const defaultHeaders = [
    'quote_date',
    'customer_id',
    'company',
    'contact_person',
    'quote_status',
    'rfq_status',
    'followup_status',
    'mpn',
    'qty',
    'quoted_price',
    'remark'
  ];

  if (sheet.getLastColumn() < 1) {
    sheet.getRange(1, 1, 1, defaultHeaders.length).setValues([defaultHeaders]);
    return;
  }

  let headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  defaultHeaders.forEach(key => {
    if (findHeaderIndex(headers, key) === -1) {
      sheet.getRange(1, sheet.getLastColumn() + 1).setValue(key);
      headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
    }
  });
}

function syncAllQuotesToCustomers() {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  const sheet = ss.getSheetByName('Quote_Log');
  const rows = sheetToObjects(sheet);
  let updated = 0;
  const skipped = [];

  rows.forEach(row => {
    const result = syncQuoteToCustomer(row, ss);
    if (result.updated) {
      updated++;
    } else {
      skipped.push(result.reason || 'missing customer');
    }
  });

  return { status: 'ok', updated, skipped_count: skipped.length, skipped };
}

function syncQuoteToCustomer(quote, ss) {
  const spreadsheet = ss || SpreadsheetApp.openById(SPREADSHEET_ID);
  const custSheet = spreadsheet.getSheetByName('Customers');
  const customerId = resolveQuoteCustomerId(quote, spreadsheet);
  if (!customerId) {
    return { updated: false, reason: '找不到客户: ' + getRowValue(quote, ['company', '公司', 'contact_person', '联系人']) };
  }

  const quoteDate = getRowValue(quote, ['quote_date', '报价日期']) || formatDate(new Date());
  const quoteStatus = normalizeQuoteStatus(getRowValue(quote, ['quote_status', '报价状态']));
  const followupStatus = normalizeFollowupStatus(quoteStatus, getRowValue(quote, ['followup_status', '跟进状态']));

  const updates = {
    last_quote_date: quoteDate,
    followup_status: followupStatus
  };

  if (quoteStatus === '已成交') {
    updates.customer_stage = '有成交';
  } else if (quoteStatus === '丢单') {
    updates.followup_status = 'closed';
  } else if (quoteStatus === '已报给客户' || quoteStatus === '已报价' || quoteStatus === '采购已报价') {
    updates.customer_stage = '有询价';
  } else if (quoteStatus === '收到报价' || quoteStatus === '已发采购') {
    updates.customer_stage = '有询价';
  }

  updateCustomerDates(custSheet, customerId, updates);
  return { updated: true, customer_id: customerId, quote_status: quoteStatus };
}

function appendQuoteStatusContactLog(quote, rawStatus, sourceRow, ss) {
  const quoteStatus = normalizeQuoteStatus(rawStatus || getRowValue(quote, ['quote_status', '报价状态']));
  if (!isMeaningfulQuoteStatus(quoteStatus)) return { logged: false, reason: 'status ignored' };

  const spreadsheet = ss || SpreadsheetApp.openById(SPREADSHEET_ID);
  const customerId = resolveQuoteCustomerId(quote, spreadsheet);
  if (!customerId) return { logged: false, reason: 'customer not found' };

  const marker = 'AUTO_QUOTE_SYNC row=' + sourceRow + ' status=' + quoteStatus;
  const logSheet = spreadsheet.getSheetByName('Contact_Log');
  const existingLogs = sheetToObjects(logSheet);
  const alreadyLogged = existingLogs.some(log => getRowValue(log, ['remark', '备注']).indexOf(marker) !== -1);
  if (alreadyLogged) return { logged: false, reason: 'duplicate' };

  const customer = getCustomerById(spreadsheet, customerId);
  const now = new Date();
  const quoteDate = getRowValue(quote, ['quote_date', '报价日期']) || formatDate(now);
  const logTime = formatTime(now);
  const logId = 'LOG-' + String(logSheet.getLastRow()).padStart(6, '0');
  const actionType = getQuoteActionType(quoteStatus);
  const result = getQuoteLogResult(quoteStatus);
  const hasQuote = quoteStatus === '已报给客户' || quoteStatus === '采购已报价' || quoteStatus === '已成交';
  const hasRfq = quoteStatus !== '待跟进';
  const company = getRowValue(quote, ['company', '公司']) || getRowValue(customer, ['company', '公司']);
  const contactPerson = getRowValue(quote, ['contact_person', '联系人']) || getRowValue(customer, ['contact_person', '联系人']);
  const channel = getRowValue(customer, ['default_channel', 'WhatsApp/Skype/LinkedIn']);
  const note = buildQuoteAutoLogNote(quoteStatus, quote);

  logSheet.appendRow([
    logId,
    quoteDate,
    logTime,
    customerId,
    company,
    contactPerson,
    channel,
    actionType,
    note,
    '',
    note,
    result,
    'TRUE',
    'FALSE',
    hasRfq ? 'TRUE' : 'FALSE',
    hasQuote ? 'TRUE' : 'FALSE',
    '',
    'AUTO',
    marker + (getRowValue(quote, ['remark', '备注']) ? ' | ' + getRowValue(quote, ['remark', '备注']) : '')
  ]);

  return { logged: true, log_id: logId };
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
        const col = findHeaderIndex(headers, key);
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
          const col = findHeaderIndex(headers, key);
          if (col !== -1) {
            sheet.getRange(i + 1, col + 1).setValue(dates[key]);
          }
        }
      });
      break;
    }
  }
}

function getRowValue(row, keys) {
  for (let i = 0; i < keys.length; i++) {
    const value = row[keys[i]];
    if (value !== undefined && value !== null && value !== '') return String(value);
  }
  return '';
}

function getStageFromContactLog(data) {
  if (data.result === '已成交') return '有成交';
  if (data.has_quote === 'TRUE' || data.has_rfq === 'TRUE' || data.result === '有询价' || data.result === '已报价') {
    return '有询价';
  }
  if (data.has_reply === 'TRUE' || data.has_demand === 'TRUE' || data.result === '有回复' || data.result === '有需求') {
    return '有回复';
  }
  return null;
}

function findHeaderIndex(headers, key) {
  const aliases = {
    company: ['company', '公司'],
    contact_person: ['contact_person', '联系人'],
    default_channel: ['default_channel', 'WhatsApp/Skype/LinkedIn'],
    customer_stage: ['customer_stage', '客户阶段'],
    grade: ['grade', '等级'],
    country: ['country', '国家/地区'],
    source: ['source', '来源'],
    email: ['email', '邮箱'],
    last_contact_date: ['last_contact_date', '最后联系日期'],
    last_reply_date: ['last_reply_date', '最后回复日期'],
    last_rfq_date: ['last_rfq_date', '最后RFQ日期'],
    last_quote_date: ['last_quote_date', '最后报价日期'],
    next_followup_date: ['next_followup_date', '下次跟进日期'],
    followup_status: ['followup_status', '跟进状态'],
    quote_date: ['quote_date', '报价日期'],
    quote_status: ['quote_status', '报价状态'],
    rfq_status: ['rfq_status', 'RFQ状态'],
    mpn: ['mpn', '型号', 'MPN'],
    qty: ['qty', '数量', 'QTY'],
    quoted_price: ['quoted_price', '报价', '单价'],
    remark: ['remark', '备注']
  };
  const candidates = aliases[key] || [key];
  for (let i = 0; i < candidates.length; i++) {
    const col = headers.indexOf(candidates[i]);
    if (col !== -1) return col;
  }
  return -1;
}

function sheetRowToObject(sheet, rowNumber) {
  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  const values = sheet.getRange(rowNumber, 1, 1, sheet.getLastColumn()).getValues()[0];
  const obj = {};
  headers.forEach((h, i) => {
    if (values[i] instanceof Date) {
      obj[h] = formatDate(values[i]);
    } else {
      obj[h] = values[i] === '' ? null : String(values[i]);
    }
  });
  return obj;
}

function applyDropdown(sheet, headers, key, values) {
  const col = findHeaderIndex(headers, key);
  if (col === -1) return;
  const maxRows = Math.max(sheet.getMaxRows() - 1, 1);
  const rule = SpreadsheetApp.newDataValidation()
    .requireValueInList(values, true)
    .setAllowInvalid(false)
    .build();
  sheet.getRange(2, col + 1, maxRows, 1).setDataValidation(rule);
}

function resolveQuoteCustomerId(quote, ss) {
  const directId = getRowValue(quote, ['customer_id']);
  if (directId) return directId;

  const company = getRowValue(quote, ['company', '公司']).toLowerCase();
  const contact = getRowValue(quote, ['contact_person', '联系人']).toLowerCase();
  if (!company && !contact) return '';

  const spreadsheet = ss || SpreadsheetApp.openById(SPREADSHEET_ID);
  const customers = sheetToObjects(spreadsheet.getSheetByName('Customers'));
  const exact = customers.find(c =>
    (!company || getRowValue(c, ['company', '公司']).toLowerCase() === company) &&
    (!contact || getRowValue(c, ['contact_person', '联系人']).toLowerCase() === contact)
  );
  if (exact) return getRowValue(exact, ['customer_id']);

  const companyOnly = customers.find(c =>
    company && getRowValue(c, ['company', '公司']).toLowerCase() === company
  );
  return companyOnly ? getRowValue(companyOnly, ['customer_id']) : '';
}

function normalizeQuoteStatus(status) {
  const value = status || '';
  if (value === '已报价') return '已报给客户';
  if (value === 'QUOTE_SENT') return '已报给客户';
  if (value === 'WON') return '已成交';
  if (value === 'LOST') return '丢单';
  return value || '待跟进';
}

function normalizeFollowupStatus(quoteStatus, existingStatus) {
  if (quoteStatus === '已成交') return '已成交';
  if (quoteStatus === '丢单') return 'closed';
  if (quoteStatus === '已报给客户' || quoteStatus === '采购已报价') return '已报价待跟进';
  if (quoteStatus === '已发采购' || quoteStatus === '收到报价') return 'active';
  return existingStatus || 'active';
}

function isMeaningfulQuoteStatus(status) {
  const value = normalizeQuoteStatus(status);
  return [
    '收到报价',
    '已发采购',
    '采购已报价',
    '已报给客户',
    '已成交',
    '丢单'
  ].indexOf(value) !== -1;
}

function getQuoteActionType(status) {
  const value = normalizeQuoteStatus(status);
  if (value === '已成交') return 'ORDER_WON';
  if (value === '已报给客户' || value === '采购已报价') return 'QUOTED';
  if (value === '丢单') return 'LOST';
  return 'FOLLOW_UP';
}

function getQuoteLogResult(status) {
  const value = normalizeQuoteStatus(status);
  if (value === '已成交') return '已成交';
  if (value === '丢单') return '丢单';
  if (value === '已报给客户' || value === '采购已报价') return '已报价';
  return '有询价';
}

function buildQuoteAutoLogNote(status, quote) {
  const value = normalizeQuoteStatus(status);
  const mpn = getRowValue(quote, ['mpn', '型号', 'MPN']);
  const qty = getRowValue(quote, ['qty', '数量', 'QTY']);
  const price = getRowValue(quote, ['quoted_price', '报价', '单价']);
  const parts = ['报价状态更新：' + value];
  if (mpn) parts.push('型号 ' + mpn);
  if (qty) parts.push('数量 ' + qty);
  if (price) parts.push('报价 ' + price);
  return parts.join('，');
}

function getCustomerById(ss, customerId) {
  const customers = sheetToObjects(ss.getSheetByName('Customers'));
  return customers.find(customer => getRowValue(customer, ['customer_id']) === customerId) || {};
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
