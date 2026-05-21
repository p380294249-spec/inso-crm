// ============================================================
// INSO CRM — Google Apps Script API
// 版本：v1.0
// 说明：这是 API 中间层，连接前端网页和 Google Sheets
// ============================================================

const SPREADSHEET_ID = '12bRXbKGBVIG09LWcLrxdg68J1kmem4UXjJzpfwboO9k'; // ← 替换这里
const QUOTE_SHEET_NAMES = ['2026', 'Quote_Log'];
const QUOTE_STATUS_VALUES = [
  '有回复',
  '有询价',
  '已报价',
  '收到报价',
  '已发采购',
  '采购已报价',
  '已报给客户',
  '已成交',
  '丢单',
  '待跟进'
];

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
  const quoteSheet = getQuoteSheet();

  const logs = sheetToObjects(logSheet);
  const quotes = sheetToQuoteObjects(quoteSheet);

  const todayLogs = logs.filter(r => getRowValue(r, ['log_date', '联系日期']) === today);
  const todayQuotes = quotes.filter(r => getRowValue(r, ['quote_date', '报价日期', '日期']) === today);

  // 去重函数
  const uniqueCustomers = (arr) => [...new Set(arr.map(r => getRowValue(r, ['customer_id', '客户ID', '客户编号', 'Customer ID'])).filter(Boolean))];

  const contacted = uniqueCustomers(todayLogs.filter(r => r.action_type === 'SENT'));
  const replied = uniqueCustomers(todayLogs.filter(r => r.has_reply === 'TRUE'));
  const hasDemand = uniqueCustomers(todayLogs.filter(r => r.has_demand === 'TRUE'));
  const hasRfq = uniqueCustomers(todayLogs.filter(r => r.has_rfq === 'TRUE'));
  const quoted = uniqueCustomers(todayQuotes.filter(r => {
    const status = normalizeQuoteStatus(getRowValue(r, ['quote_status', '报价状态', '状态']));
    return status === '已报给客户' || status === '采购已报价' || status === '已成交';
  }));

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
  const sheet = getQuoteSheet();

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
  }, data.quote_status || '已报价', sheet.getName() + '!' + sheet.getLastRow());

  return { status: 'ok' };
}

// ============================================================
// Sheet 编辑报价状态时，自动同步客户主档
// ============================================================
function onEdit(e) {
  if (!e || !e.range) return;
  const sheet = e.range.getSheet();
  if (!isQuoteSheetName(sheet.getName())) return;
  if (e.range.getRow() === 1) return;

  const rowObj = sheetRowToQuoteObject(sheet, e.range.getRow());
  if (!rowObj) return;

  const editedKey = getQuoteColumnKey(sheet, e.range.getRow(), e.range.getColumn());
  if (!editedKey) return;
  if (['quote_status', 'rfq_status', 'followup_status', 'quote_date', 'customer_id', 'company', 'contact_person'].indexOf(editedKey) === -1) return;

  syncQuoteToCustomer(rowObj, e.source);

  const statusChanged = editedKey === 'quote_status' && e.value && e.value !== e.oldValue;
  if (statusChanged && isMeaningfulQuoteStatus(e.value)) {
    appendQuoteStatusContactLog(rowObj, e.value, sheet.getName() + '!' + e.range.getRow(), e.source);
  }
}

function setupQuoteWorkflow() {
  const sheet = getQuoteSheet();
  if (sheet.getName() !== '2026') {
    ensureQuoteWorkflowHeaders(sheet);
  }
  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];

  applyDropdown(sheet, headers, 'quote_status', QUOTE_STATUS_VALUES);
  applyQuoteBlockDropdowns(sheet);
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

  return { status: 'ok', message: sheet.getName() + ' dropdowns updated' };
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
  const sheet = getQuoteSheet(ss);
  const rows = sheetToQuoteObjects(sheet);
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
  } else if (quoteStatus === '已报给客户' || quoteStatus === '已报价' || quoteStatus === '采购已报价' || quoteStatus === '有询价') {
    updates.customer_stage = '有询价';
  } else if (quoteStatus === '收到报价' || quoteStatus === '已发采购') {
    updates.customer_stage = '有询价';
  } else if (quoteStatus === '有回复') {
    updates.customer_stage = '有回复';
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
  const hasQuote = quoteStatus === '已报给客户' || quoteStatus === '已报价' || quoteStatus === '采购已报价' || quoteStatus === '已成交';
  const hasRfq = quoteStatus === '有询价' || quoteStatus === '收到报价' || quoteStatus === '已发采购' || hasQuote;
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

  const idCol = findHeaderIndex(headers, 'customer_id');
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
  const idCol = findHeaderIndex(headers, 'customer_id');

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
    customer_id: ['customer_id', '客户ID', '客户编号', 'Customer ID'],
    company: ['company', '公司', '公司名', '客户公司', '客户名称', '客户'],
    contact_person: ['contact_person', '联系人', '客户联系人', 'Contact', 'contact', 'WHO', 'Who', 'who'],
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
    quote_date: ['quote_date', '报价日期', '日期', 'Date', 'date', 'DATE'],
    quote_status: ['quote_status', '报价状态', '状态', '进度', 'STATUS', 'Status', 'status', 'HOW', 'How', 'how'],
    rfq_status: ['rfq_status', 'RFQ状态', '询价状态'],
    mpn: ['mpn', '型号', 'MPN', 'Part Number', '料号'],
    qty: ['qty', '数量', 'QTY', 'Qty'],
    quoted_price: ['quoted_price', '报价', '单价', 'Price', 'price', '价格'],
    remark: ['remark', '备注', '说明', 'Remark'],
    quote_class: ['CLASS', 'Class', 'class', '等级'],
    quote_what: ['WHAT', 'What', 'what']
  };
  const candidates = aliases[key] || [key];
  for (let i = 0; i < candidates.length; i++) {
    const col = headers.indexOf(candidates[i]);
    if (col !== -1) return col;
  }
  return -1;
}

function getQuoteSheet(ss) {
  const spreadsheet = ss || SpreadsheetApp.openById(SPREADSHEET_ID);
  for (let i = 0; i < QUOTE_SHEET_NAMES.length; i++) {
    const sheet = spreadsheet.getSheetByName(QUOTE_SHEET_NAMES[i]);
    if (sheet) return sheet;
  }
  throw new Error('找不到报价 Sheet，请建立 2026 或 Quote_Log 标签页');
}

function isQuoteSheetName(name) {
  return QUOTE_SHEET_NAMES.indexOf(name) !== -1;
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

function sheetRowToQuoteObject(sheet, rowNumber) {
  const block = findQuoteBlockHeader(sheet, rowNumber);
  if (!block) return sheetRowToObject(sheet, rowNumber);

  const values = sheet.getRange(rowNumber, 1, 1, sheet.getLastColumn()).getValues()[0];
  const obj = {};
  block.headers.forEach((header, i) => {
    const key = canonicalQuoteHeaderKey(header);
    if (!key) return;
    const value = values[i];
    obj[key] = value instanceof Date ? formatDate(value) : (value === '' ? null : String(value));
  });

  obj.quote_date = obj.quote_date || inferQuoteBlockDate(sheet, rowNumber, block.row);
  obj.quote_status = obj.quote_status || '';
  obj.contact_person = obj.contact_person || '';
  return obj;
}

function sheetToQuoteObjects(sheet) {
  const data = sheet.getDataRange().getValues();
  if (data.length < 2) return [];

  const defaultHeaders = data[0].map(value => value === null ? '' : String(value).trim());
  const rows = [];
  let currentHeaders = null;
  let currentDate = '';

  for (let i = 1; i < data.length; i++) {
    const rowValues = data[i];
    if (isQuoteBlockHeaderRow(rowValues)) {
      currentHeaders = rowValues.map(value => value === null ? '' : String(value).trim());
      currentDate = '';
      continue;
    }

    const headers = currentHeaders || defaultHeaders;
    const obj = {};
    headers.forEach((header, colIndex) => {
      const key = canonicalQuoteHeaderKey(header);
      if (!key) return;
      const value = rowValues[colIndex];
      obj[key] = value instanceof Date ? formatDate(value) : (value === '' ? null : String(value));
    });

    const rowDate = rowValues[0] instanceof Date ? formatDate(rowValues[0]) : (rowValues[0] ? String(rowValues[0]).trim() : '');
    if (rowDate && /^\d{4}-\d{1,2}-\d{1,2}$/.test(rowDate)) currentDate = rowDate;
    obj.quote_date = obj.quote_date || currentDate || formatDate(new Date());

    if (
      getRowValue(obj, ['customer_id', '客户ID', '客户编号', 'Customer ID']) ||
      getRowValue(obj, ['company', '公司', '客户公司', '客户']) ||
      getRowValue(obj, ['contact_person', '联系人']) ||
      getRowValue(obj, ['quote_status', '报价状态', '状态']) ||
      getRowValue(obj, ['mpn', '型号', 'MPN'])
    ) {
      rows.push(obj);
    }
  }
  return rows;
}

function getQuoteColumnKey(sheet, rowNumber, colNumber) {
  const block = findQuoteBlockHeader(sheet, rowNumber);
  if (block) return canonicalQuoteHeaderKey(block.headers[colNumber - 1]);

  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  return canonicalQuoteHeaderKey(headers[colNumber - 1]);
}

function findQuoteBlockHeader(sheet, rowNumber) {
  const start = Math.max(1, rowNumber - 40);
  const count = rowNumber - start;
  if (count <= 0) return null;

  const rows = sheet.getRange(start, 1, count, sheet.getLastColumn()).getValues();
  for (let i = rows.length - 1; i >= 0; i--) {
    if (isQuoteBlockHeaderRow(rows[i])) {
      return { row: start + i, headers: rows[i].map(value => value === null ? '' : String(value).trim()) };
    }
  }
  return null;
}

function isQuoteBlockHeaderRow(row) {
  const headers = row.map(value => value === null ? '' : String(value).trim().toUpperCase());
  const hasCustomer = headers.indexOf('WHO') !== -1 || headers.indexOf('CONTACT_PERSON') !== -1 || headers.indexOf('联系人') !== -1;
  const hasPart = headers.indexOf('MPN') !== -1 || headers.indexOf('PART NO. OFFER') !== -1 || headers.indexOf('PART NO OFFER') !== -1;
  const hasStatus = headers.indexOf('STATUS') !== -1 || headers.indexOf('HOW') !== -1 || headers.indexOf('状态') !== -1;
  return hasCustomer && hasPart && hasStatus;
}

function canonicalQuoteHeaderKey(header) {
  const label = header === null || header === undefined ? '' : String(header).trim();
  if (!label) return '';

  const normalized = label.toUpperCase();
  const direct = {
    HOW: 'quote_status',
    STATUS: 'quote_status',
    DATE: 'quote_date',
    WHO: 'contact_person',
    CLASS: 'quote_class',
    WHAT: 'quote_what',
    MPN: 'mpn',
    MFR: 'mfr',
    QTY: 'qty',
    BRAND: 'brand',
    USD: 'quoted_price',
    'QTY OFFER': 'qty_offer',
    'D/C': 'dc',
    'L/T': 'lead_time',
    REMARK: 'remark',
    STOCK: 'stock',
    TOTAL: 'total'
  };
  if (direct[normalized]) return direct[normalized];
  if (normalized === 'PART NO. OFFER' || normalized === 'PART NO OFFER') return 'part_no_offer';

  const keys = ['customer_id', 'company', 'contact_person', 'quote_date', 'quote_status', 'rfq_status', 'followup_status', 'mpn', 'qty', 'quoted_price', 'remark'];
  for (let i = 0; i < keys.length; i++) {
    if (findHeaderIndex([label], keys[i]) === 0) return keys[i];
  }
  return '';
}

function inferQuoteBlockDate(sheet, rowNumber, headerRow) {
  const firstColValue = sheet.getRange(rowNumber, 1).getValue();
  if (firstColValue instanceof Date) return formatDate(firstColValue);
  if (firstColValue) {
    const text = String(firstColValue).trim();
    if (/^\d{4}-\d{1,2}-\d{1,2}$/.test(text)) return text;
  }

  for (let row = rowNumber - 1; row > headerRow; row--) {
    const value = sheet.getRange(row, 1).getValue();
    if (value instanceof Date) return formatDate(value);
    if (value && /^\d{4}-\d{1,2}-\d{1,2}$/.test(String(value).trim())) return String(value).trim();
  }
  return formatDate(new Date());
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

function applyQuoteBlockDropdowns(sheet) {
  const maxRows = sheet.getMaxRows();
  const lastCol = sheet.getLastColumn();
  if (maxRows < 2 || lastCol < 1) return;

  const values = sheet.getRange(1, 1, Math.min(sheet.getLastRow(), maxRows), lastCol).getValues();
  const rule = SpreadsheetApp.newDataValidation()
    .requireValueInList(QUOTE_STATUS_VALUES, true)
    .setAllowInvalid(false)
    .build();

  const headerRows = [];
  values.forEach((row, index) => {
    if (isQuoteBlockHeaderRow(row)) headerRows.push(index + 1);
  });

  headerRows.forEach((headerRow, index) => {
    const rowValues = values[headerRow - 1];
    rowValues.forEach((header, colIndex) => {
      if (canonicalQuoteHeaderKey(header) !== 'quote_status') return;
      const headerCell = sheet.getRange(headerRow, colIndex + 1);
      if (String(header || '').trim().toUpperCase() === 'HOW') headerCell.setValue('STATUS');

      const nextHeaderRow = headerRows[index + 1] || maxRows + 1;
      const startRow = headerRow + 1;
      const numRows = Math.max(nextHeaderRow - startRow, 0);
      if (numRows > 0) {
        sheet.getRange(startRow, colIndex + 1, numRows, 1).setDataValidation(rule);
      }
    });
  });
}

function resolveQuoteCustomerId(quote, ss) {
  const directId = getRowValue(quote, ['customer_id', '客户ID', '客户编号', 'Customer ID']);
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
  if (exact) return getRowValue(exact, ['customer_id', '客户ID', '客户编号', 'Customer ID']);

  const companyOnly = customers.find(c =>
    company && getRowValue(c, ['company', '公司']).toLowerCase() === company
  );
  return companyOnly ? getRowValue(companyOnly, ['customer_id', '客户ID', '客户编号', 'Customer ID']) : '';
}

function normalizeQuoteStatus(status) {
  const value = status || '';
  if (value === 'QUOTE_SENT') return '已报给客户';
  if (value === 'WON') return '已成交';
  if (value === 'LOST') return '丢单';
  return value || '待跟进';
}

function normalizeFollowupStatus(quoteStatus, existingStatus) {
  if (quoteStatus === '已成交') return '已成交';
  if (quoteStatus === '丢单') return 'closed';
  if (quoteStatus === '已报给客户' || quoteStatus === '已报价' || quoteStatus === '采购已报价') return '已报价待跟进';
  if (quoteStatus === '已发采购' || quoteStatus === '收到报价' || quoteStatus === '有回复' || quoteStatus === '有询价') return 'active';
  return existingStatus || 'active';
}

function isMeaningfulQuoteStatus(status) {
  const value = normalizeQuoteStatus(status);
  return [
    '有回复',
    '有询价',
    '已报价',
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
  if (value === '已报给客户' || value === '已报价' || value === '采购已报价') return 'QUOTED';
  if (value === '丢单') return 'LOST';
  return 'FOLLOW_UP';
}

function getQuoteLogResult(status) {
  const value = normalizeQuoteStatus(status);
  if (value === '已成交') return '已成交';
  if (value === '丢单') return '丢单';
  if (value === '有回复') return '有回复';
  if (value === '有询价') return '有询价';
  if (value === '已报给客户' || value === '已报价' || value === '采购已报价') return '已报价';
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
  return customers.find(customer => getRowValue(customer, ['customer_id', '客户ID', '客户编号', 'Customer ID']) === customerId) || {};
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
  }).filter(r =>
    getRowValue(r, ['customer_id', '客户ID', '客户编号', 'Customer ID']) ||
    getRowValue(r, ['log_id']) ||
    getRowValue(r, ['quote_date', '报价日期', '日期']) ||
    getRowValue(r, ['company', '公司', '客户公司', '客户']) ||
    getRowValue(r, ['contact_person', '联系人'])
  ); // 过滤空行
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
