// ============================================================
//  DramaWorld Telegram Bot - إدارة الاشتراكات
// ============================================================

require('dotenv').config();
const TelegramBot = require('node-telegram-bot-api');
const axios = require('axios');

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const SCRIPT_URL = process.env.GOOGLE_SCRIPT_URL;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;
const ADMIN_CHAT_ID = process.env.ADMIN_CHAT_ID;

const bot = new TelegramBot(BOT_TOKEN, { polling: true });

// تخزين مؤقت للمستخدمين المصرح لهم
const authorizedUsers = new Set();
// تخزين حالة المستخدم الحالي
const userStates = new Map();

// ==================== دوال الاتصال بـ Google Script ====================
async function callScript(action, params = {}) {
  try {
    const query = new URLSearchParams({ action, ...params }).toString();
    const response = await axios.get(`${SCRIPT_URL}?${query}`, { timeout: 30000 });
    return response.data;
  } catch (error) {
    console.error('خطأ في الاتصال:', error.message);
    return { success: false, error: error.message };
  }
}

// ==================== التحقق من صلاحيات المشرف ====================
function isAdmin(chatId) {
  if (ADMIN_CHAT_ID && String(chatId) === String(ADMIN_CHAT_ID)) return true;
  return authorizedUsers.has(String(chatId));
}

// ==================== القائمة الرئيسية ====================
function getMainMenu() {
  return {
    reply_markup: {
      inline_keyboard: [
        [{ text: '📊 الإحصائيات', callback_data: 'stats' }],
        [{ text: '🔑 إدارة المفاتيح', callback_data: 'manage_keys' }],
        [{ text: '📋 الطلبات', callback_data: 'orders' }],
        [{ text: '👥 المشتركين', callback_data: 'subscribers' }],
        [{ text: '🔍 البحث عن مفتاح', callback_data: 'search_key' }],
        [{ text: '➕ إنشاء مفتاح يدوي', callback_data: 'create_key' }],
        [{ text: '❓ مساعدة', callback_data: 'help' }]
      ]
    }
  };
}

// ==================== لوحة المفاتيح ====================
function getKeysMenu() {
  return {
    reply_markup: {
      inline_keyboard: [
        [{ text: '✅ المفاتيح النشطة', callback_data: 'keys_active' }],
        [{ text: '⏰ المفاتيح المنتهية', callback_data: 'keys_expired' }],
        [{ text: '🚫 المفاتيح الملغاة', callback_data: 'keys_revoked' }],
        [{ text: '📋 كل المفاتيح', callback_data: 'keys_all' }],
        [{ text: '⬅️ رجوع', callback_data: 'main_menu' }]
      ]
    }
  };
}

// ==================== عرض الإحصائيات ====================
async function showStats(chatId, messageId = null) {
  const loadingMsg = await bot.sendMessage(chatId, '⏳ جاري تحميل الإحصائيات...');
  
  const result = await callScript('stats', { pass: ADMIN_PASSWORD });
  
  await bot.deleteMessage(chatId, loadingMsg.message_id);
  
  if (!result.success || !result.stats) {
    return bot.sendMessage(chatId, '❌ فشل في جلب الإحصائيات', getMainMenu());
  }
  
  const s = result.stats;
  const text = 
    `📊 *إحصائيات DramaWorld*\n\n` +
    `🔑 *المفاتيح:*\n` +
    `├ الإجمالي: ${s.totalKeys}\n` +
    `├ ✅ نشطة: ${s.active}\n` +
    `├ ⏰ منتهية: ${s.expired}\n` +
    `└ 🚫 ملغاة: ${s.revoked}\n\n` +
    `📦 *الطلبات:*\n` +
    `├ الإجمالي: ${s.totalOrders}\n` +
    `└ 💰 الإيرادات: $${s.totalRevenue}\n\n` +
    `📈 *حسب الباقة:*\n` +
    `├ أسبوعي: ${s.byPlan.weekly}\n` +
    `├ شهري: ${s.byPlan.monthly}\n` +
    `└ سنوي: ${s.byPlan.yearly}`;
  
  const opts = messageId 
    ? { chat_id: chatId, message_id: messageId, parse_mode: 'Markdown', ...getMainMenu() }
    : { chat_id: chatId, parse_mode: 'Markdown', ...getMainMenu() };
  
  if (messageId) {
    return bot.editMessageText(text, opts).catch(() => bot.sendMessage(chatId, text, getMainMenu()));
  }
  return bot.sendMessage(chatId, text, { parse_mode: 'Markdown', ...getMainMenu() });
}

// ==================== عرض المفاتيح ====================
async function showKeys(chatId, filter = 'all', messageId = null, page = 0) {
  const loadingMsg = await bot.sendMessage(chatId, '⏳ جاري التحميل...');
  
  const result = await callScript('listKeys', { pass: ADMIN_PASSWORD });
  
  await bot.deleteMessage(chatId, loadingMsg.message_id);
  
  if (!result.success || !result.keys) {
    return bot.sendMessage(chatId, '❌ فشل في جلب المفاتيح', getMainMenu());
  }
  
  let keys = result.keys;
  
  if (filter !== 'all') {
    keys = keys.filter(k => String(k.status).trim() === filter);
  }
  
  if (keys.length === 0) {
    const text = `📭 لا توجد مفاتيح ${filter !== 'all' ? 'بهذه الحالة' : ''}`;
    return bot.sendMessage(chatId, text, getKeysMenu());
  }
  
  // ترتيب حسب التاريخ (الأحدث أولاً)
  keys.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  
  const perPage = 5;
  const totalPages = Math.ceil(keys.length / perPage);
  const startIdx = page * perPage;
  const pageKeys = keys.slice(startIdx, startIdx + perPage);
  
  let text = `🔑 *المفاتيح ${filter !== 'all' ? `(${getStatusName(filter)})` : ''}*\n`;
  text += `📊 ${keys.length} مفتاح | صفحة ${page + 1}/${totalPages}\n\n`;
  
  for (let i = 0; i < pageKeys.length; i++) {
    const k = pageKeys[i];
    const status = getStatusEmoji(k.status);
    const plan = getPlanName(k.plan);
    const expiry = formatDate(k.expiresAt);
    
    text += `${status} *${i + 1 + startIdx}.* \`${k.key}\`\n`;
    text += `   💎 ${plan} | 📅 ${expiry}\n`;
    if (k.payerInfo) text += `   👤 ${truncate(k.payerInfo, 30)}\n`;
    text += `\n`;
  }
  
  // أزرار التنقل
  const navButtons = [];
  if (page > 0) navButtons.push({ text: '⬅️ السابق', callback_data: `keys_${filter}_${page - 1}` });
  if (page < totalPages - 1) navButtons.push({ text: 'التالي ➡️', callback_data: `keys_${filter}_${page + 1}` });
  
  const keyboard = [];
  if (navButtons.length > 0) keyboard.push(navButtons);
  
  // أزرار التفعيل السريع للمفاتيح المعروضة
  for (const k of pageKeys) {
    const status = String(k.status).trim();
    if (status === 'active') {
      keyboard.push([
        { text: `🚫 إلغاء ${k.key.substring(6, 18)}`, callback_data: `revoke_${k.key}` }
      ]);
    } else {
      keyboard.push([
        { text: `✅ تفعيل ${k.key.substring(6, 18)}`, callback_data: `activate_${k.key}` }
      ]);
    }
  }
  
  keyboard.push([{ text: '⬅️ رجوع للقائمة', callback_data: 'manage_keys' }]);
  
  const opts = { parse_mode: 'Markdown', reply_markup: { inline_keyboard: keyboard } };
  
  if (messageId) {
    return bot.editMessageText(text, { chat_id: chatId, message_id: messageId, ...opts })
      .catch(() => bot.sendMessage(chatId, text, opts));
  }
  return bot.sendMessage(chatId, text, opts);
}

// ==================== عرض الطلبات ====================
async function showOrders(chatId, page = 0, messageId = null) {
  // نستخدم listKeys للحصول على الطلبات (من خلال المفاتيح)
  const loadingMsg = await bot.sendMessage(chatId, '⏳ جاري التحميل...');
  
  const result = await callScript('listKeys', { pass: ADMIN_PASSWORD });
  
  await bot.deleteMessage(chatId, loadingMsg.message_id);
  
  if (!result.success || !result.keys) {
    return bot.sendMessage(chatId, '❌ فشل في جلب الطلبات', getMainMenu());
  }
  
  const keys = result.keys.filter(k => k.payerInfo && k.payerInfo.trim());
  keys.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  
  if (keys.length === 0) {
    return bot.sendMessage(chatId, '📭 لا توجد طلبات', getMainMenu());
  }
  
  const perPage = 5;
  const totalPages = Math.ceil(keys.length / perPage);
  const startIdx = page * perPage;
  const pageKeys = keys.slice(startIdx, startIdx + perPage);
  
  let text = `📋 *أحدث الطلبات*\n`;
  text += `📊 ${keys.length} طلب | صفحة ${page + 1}/${totalPages}\n\n`;
  
  for (let i = 0; i < pageKeys.length; i++) {
    const k = pageKeys[i];
    const info = k.payerInfo.split('|').map(s => s.trim());
    const email = info[0] || 'غير محدد';
    const name = info[1] || 'غير محدد';
    
    text += `*${i + 1 + startIdx}.* 👤 ${name}\n`;
    text += `   📧 ${email}\n`;
    text += `   💎 ${getPlanName(k.plan)} | 🔑 \`${k.key}\`\n`;
    text += `   📅 ${formatDate(k.createdAt)}\n\n`;
  }
  
  const navButtons = [];
  if (page > 0) navButtons.push({ text: '⬅️ السابق', callback_data: `orders_${page - 1}` });
  if (page < totalPages - 1) navButtons.push({ text: 'التالي ➡️', callback_data: `orders_${page + 1}` });
  
  const keyboard = [];
  if (navButtons.length > 0) keyboard.push(navButtons);
  keyboard.push([{ text: '⬅️ رجوع', callback_data: 'main_menu' }]);
  
  const opts = { parse_mode: 'Markdown', reply_markup: { inline_keyboard: keyboard } };
  
  if (messageId) {
    return bot.editMessageText(text, { chat_id: chatId, message_id: messageId, ...opts })
      .catch(() => bot.sendMessage(chatId, text, opts));
  }
  return bot.sendMessage(chatId, text, opts);
}

// ==================== عرض المشتركين ====================
async function showSubscribers(chatId, page = 0, messageId = null) {
  const loadingMsg = await bot.sendMessage(chatId, '⏳ جاري التحميل...');
  
  const result = await callScript('listKeys', { pass: ADMIN_PASSWORD });
  
  await bot.deleteMessage(chatId, loadingMsg.message_id);
  
  if (!result.success || !result.keys) {
    return bot.sendMessage(chatId, '❌ فشل في جلب المشتركين', getMainMenu());
  }
  
  // المشتركين النشطين فقط
  const now = new Date();
  const subscribers = result.keys.filter(k => {
    if (String(k.status).trim() !== 'active') return false;
    const expiry = new Date(k.expiresAt);
    return expiry > now;
  });
  
  subscribers.sort((a, b) => new Date(a.expiresAt) - new Date(b.expiresAt));
  
  if (subscribers.length === 0) {
    return bot.sendMessage(chatId, '📭 لا يوجد مشتركون نشطون', getMainMenu());
  }
  
  const perPage = 5;
  const totalPages = Math.ceil(subscribers.length / perPage);
  const startIdx = page * perPage;
  const pageSubs = subscribers.slice(startIdx, startIdx + perPage);
  
  let text = `👥 *المشتركون النشطون*\n`;
  text += `📊 ${subscribers.length} مشترك | صفحة ${page + 1}/${totalPages}\n\n`;
  
  for (let i = 0; i < pageSubs.length; i++) {
    const k = pageSubs[i];
    const info = k.payerInfo ? k.payerInfo.split('|').map(s => s.trim()) : ['', ''];
    const daysLeft = Math.ceil((new Date(k.expiresAt) - now) / (1000 * 60 * 60 * 24));
    
    text += `*${i + 1 + startIdx}.* ${info[1] || info[0] || 'غير محدد'}\n`;
    text += `   🔑 \`${k.key}\`\n`;
    text += `   💎 ${getPlanName(k.plan)} | ⏰ ${daysLeft} يوم متبقي\n\n`;
  }
  
  const navButtons = [];
  if (page > 0) navButtons.push({ text: '⬅️ السابق', callback_data: `subs_${page - 1}` });
  if (page < totalPages - 1) navButtons.push({ text: 'التالي ➡️', callback_data: `subs_${page + 1}` });
  
  const keyboard = [];
  if (navButtons.length > 0) keyboard.push(navButtons);
  keyboard.push([{ text: '⬅️ رجوع', callback_data: 'main_menu' }]);
  
  const opts = { parse_mode: 'Markdown', reply_markup: { inline_keyboard: keyboard } };
  
  if (messageId) {
    return bot.edit
