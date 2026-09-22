// ==================== إعدادات API ====================
var GOOGLE_SCRIPT_URL = "https://script.google.com/macros/s/AKfycbw_Xt9Vr6g6Cw4tUn-v-DHB80_timJqposFn_oAdDb1RZdHLxNWIVABfIdq8WPR1y8S/exec";

// ==================== إعدادات API ====================
var GOOGLE_SCRIPT_URL = "https://script.google.com/macros/s/AKfycbw_Xt9Vr6g6Cw4tUn-v-DHB80_timJqposFn_oAdDb1RZdHLxNWIVABfIdq8WPR1y8S/exec";
var WHATSAPP_ADMIN = "213696308000";
var API_BASE = "https://newdrama.vercel.app/api";
var SERIES_LIST_API = API_BASE + "/series-list";

// ==================== متغيرات النظام ====================
var seriesDatabase = {};
var isUnlocked = false;
var currentUnlockKey = null;
var currentSeries = null;
var currentEpisodes = [];
var currentEpisode = null;
var currentView = "home";
var currentCategory = null;
var currentTranslation = null;
var currentPage = 1;
var itemsPerPage = 20;

var pageHistoryStack = [];
var isBackNavigation = false;

function pushPageToHistory(pageType, pageData, pageTitle) {
    var state = { type: pageType, data: pageData, title: pageTitle, timestamp: Date.now() };
    pageHistoryStack.push(state);
    var historyState = { idx: pageHistoryStack.length - 1, type: pageType, data: pageData };
    history.pushState(historyState, pageTitle, '#' + pageType + '_' + Date.now());
    document.title = pageTitle;
}

function goBackToPreviousPage() {
    if (pageHistoryStack.length <= 1) {
        if (currentView === "home") {
            if (window.confirm("هل تريد الخروج من التطبيق؟")) { window.close(); }
        } else {
            var homeState = pageHistoryStack[0];
            if (homeState && homeState.type === 'home') {
                pageHistoryStack = [homeState];
                renderHomePage();
            } else {
                pageHistoryStack = [];
                renderHomePage();
            }
        }
        return;
    }
    pageHistoryStack.pop();
    var previousPage = pageHistoryStack[pageHistoryStack.length - 1];
    if (previousPage) {
        isBackNavigation = true;
        if (previousPage.type === 'home') renderHomePage();
        else if (previousPage.type === 'subcategories') showSubcategoriesPage(previousPage.data.categoryId, true);
        else if (previousPage.type === 'serieslist') showSeriesListPage(previousPage.data.categoryId, previousPage.data.translationType, true);
        else if (previousPage.type === 'series') showSeriesPage(previousPage.data.series, true);
        document.title = previousPage.title;
        isBackNavigation = false;
    }
}

window.addEventListener('popstate', function(event) { goBackToPreviousPage(); });

// ==================== دوال جلب البيانات ====================
function generateEpisodes(series) {
    var episodes = [];
    var total = series.totalEpisodes || 0;
    var freeLimit = series.freeLimit || 4;
    for (var i = 1; i <= total; i++) {
        episodes.push({id: i, number: i, title: i.toString(), locked: i > freeLimit});
    }
    return episodes;
}

async function fetchSeriesList() {
    try {
        var response = await fetch(SERIES_LIST_API + "?action=list");
        var data = await response.json();
        if (data.success && data.series) {
            seriesDatabase = data.series;
            for (var id in seriesDatabase) {
                await fetchSeriesEpisodesCount(id, seriesDatabase[id]);
            }
            return true;
        } else { throw new Error("فشل في جلب المسلسلات"); }
    } catch(e) {
        console.error("خطأ في جلب المسلسلات:", e);
        seriesDatabase = {};
        showToastMessage("⚠️ حدث خطأ في تحميل المسلسلات، حاول مرة أخرى");
        return false;
    }
}

async function fetchSeriesEpisodesCount(seriesId, series) {
    try {
        var url = API_BASE + "/" + series.apiFile + "?action=getEpisodesCount";
        var response = await fetch(url);
        var data = await response.json();
        if (data.success) {
            series.totalEpisodes = data.totalEpisodes;
            series.freeLimit = data.freeLimit || 4;
        } else {
            series.totalEpisodes = 0;
            series.freeLimit = 4;
        }
        series.episodes = generateEpisodes(series);
    } catch(e) {
        console.error("خطأ في جلب عدد الحلقات:", e);
        series.totalEpisodes = 0;
        series.freeLimit = 4;
        series.episodes = [];
    }
}

async function getEpisodeUrl(episodeId, seriesId, apiFile, unlockKey) {
    try {
        var url = API_BASE + "/" + apiFile + "?action=getEpisode&episodeId=" + episodeId + "&seriesId=" + seriesId;
        if (unlockKey && isUnlocked) url += "&key=" + encodeURIComponent(unlockKey);
        var response = await fetch(url);
        var data = await response.json();
        if (data.success && data.url) return data.url;
        return null;
    } catch(e) {
        console.error("خطأ في جلب الرابط:", e);
        return null;
    }
}

// ==================== دوال التحقق من المفاتيح ====================
async function verifyKeyWithServer(key) {
    try {
        var url = GOOGLE_SCRIPT_URL + "?action=verify&key=" + encodeURIComponent(key);
        var response = await fetch(url);
        var data = await response.json();
        if (data.valid === true) return true;
        return false;
    } catch(e) {
        console.error("خطأ في التحقق:", e);
        return false;
    }
}

async function checkStoredKey() {
    var storedKey = localStorage.getItem("drama_unlock_key");
    if (!storedKey) {
        isUnlocked = false;
        currentUnlockKey = null;
        updateUIForUnlocked(false);
        return false;
    }
    var isValid = await verifyKeyWithServer(storedKey);
    if (isValid) {
        isUnlocked = true;
        currentUnlockKey = storedKey;
        updateUIForUnlocked(true);
        return true;
    } else {
        localStorage.removeItem("drama_unlock_key");
        isUnlocked = false;
        currentUnlockKey = null;
        updateUIForUnlocked(false);
        return false;
    }
}

async function activateKey(key) {
    var isValid = await verifyKeyWithServer(key);
    if (isValid) {
        localStorage.setItem("drama_unlock_key", key);
        isUnlocked = true;
        currentUnlockKey = key;
        updateUIForUnlocked(true);
        closeLockModal();
        showToastMessage("✅ تم التفعيل بنجاح!");
        return true;
    } else {
        showToastMessage("❌ مفتاح غير صالح");
        return false;
    }
}

function updateUIForUnlocked(unlocked) {
    isUnlocked = unlocked;
    var statusBadge = document.getElementById("statusBadge");
    var userStatus = document.querySelector(".user-status");
    var sidebarUnlock = document.querySelector(".unlock-status");
    
    if (statusBadge) {
        if (unlocked) {
            statusBadge.classList.remove("locked");
            statusBadge.classList.add("unlocked");
            statusBadge.innerHTML = '<i class="fas fa-check-circle"></i> ✅ مفعل | جميع الحلقات متاحة';
        } else {
            statusBadge.classList.remove("unlocked");
            statusBadge.classList.add("locked");
            statusBadge.innerHTML = '<i class="fas fa-lock"></i> 🔒 غير مفعل | الحلقات 1-4 مجانية';
        }
    }
    if (userStatus) {
        if (unlocked) {
            userStatus.classList.add("unlocked");
            userStatus.innerHTML = '<i class="fas fa-check-circle"></i> <span>مفعل</span>';
        } else {
            userStatus.classList.remove("unlocked");
            userStatus.innerHTML = '<i class="fas fa-crown"></i> <span>اشتراك</span>';
        }
    }
    if (sidebarUnlock) {
        if (unlocked) {
            sidebarUnlock.classList.add("unlocked");
            sidebarUnlock.innerHTML = '<i class="fas fa-check-circle"></i> تم التفعيل';
        } else {
            sidebarUnlock.classList.remove("unlocked");
            sidebarUnlock.innerHTML = '<i class="fas fa-crown"></i> اشتراك';
        }
    }
    if (currentView === "series" && currentEpisodes && currentEpisodes.length > 0) {
        updateEpisodesLockUI();
    }
}

function updateEpisodesLockUI() {
    var items = document.querySelectorAll("#episodesList li");
    for (var i = 0; i < items.length; i++) {
        var $item = $(items[i]);
        var epId = parseInt($item.data("id"));
        var isLocked = epId > 4 && !isUnlocked;
        var textDiv = $item.find(".episode-text");
        textDiv.find(".episode-play-icon, .episode-lock-icon").remove();
        if (isLocked) {
            textDiv.prepend('<i class="fas fa-lock episode-lock-icon"></i>');
            $item.css("opacity", "0.7");
        } else {
            textDiv.prepend('<i class="fas fa-play-circle episode-play-icon"></i>');
            $item.css("opacity", "1");
        }
    }
}

function closeLockModal() {
    var modal = document.getElementById("lockModal");
    if (modal) modal.classList.remove("active");
    var paymentModal = document.getElementById("paymentModal");
    if (paymentModal) paymentModal.remove();
    var paypalModal = document.getElementById("paypalSuccessModal");
    if (paypalModal) paypalModal.remove();
}

// ==================== دوال PayPal ====================
function renderPayPalButtons(containerId, plan, amount) {
    var container = document.getElementById(containerId);
    if (!container) return;
    container.innerHTML = "";
    
    if (!window.paypal_sdk) {
        container.innerHTML = '<div style="color:#ef4444;font-size:11px;text-align:center;padding:10px;">⚠️ لم يتم تحميل PayPal SDK</div>';
        return;
    }
    
    var planNames = { weekly: "أسبوعي", monthly: "شهري", yearly: "سنوي" };
    var planName = planNames[plan] || "شهري";
    
    window.paypal_sdk.Buttons({
        style: { layout: 'vertical', color: 'gold', shape: 'pill', label: 'pay', height: 42 },
        createOrder: function(data, actions) {
            return actions.order.create({
                purchase_units: [{
                    amount: { value: amount.toFixed(2), currency_code: "USD" },
                    description: "اشتراك " + planName + " - عالم الدراما",
                    custom_id: "plan_" + plan + "_" + Date.now()
                }],
                application_context: {
                    brand_name: "عالم الدراما",
                    locale: "ar-SA",
                    shipping_preference: "NO_SHIPPING",
                    user_action: "PAY_NOW"
                }
            });
        },
        onApprove: async function(data, actions) {
            var errEl = document.getElementById("paypalError");
            if (errEl) errEl.innerHTML = '<span style="color:#3b82f6;">⏳ جاري التحقق من الدفع...</span>';
            
            try {
                var capture = await actions.order.capture();
                
                if (capture.status === "COMPLETED") {
                    var orderId = capture.id;
                    var payerEmail = (capture.payer && capture.payer.email_address) ? capture.payer.email_address : "غير محدد";
                    var payerName = "";
                    if (capture.payer && capture.payer.name) {
                        payerName = (capture.payer.name.given_name || "") + " " + (capture.payer.name.surname || "");
                    }
                    if (!payerName.trim()) payerName = "PayPal User";
                    
                    var saveUrl = GOOGLE_SCRIPT_URL + 
                        "?action=saveOrder" +
                        "&binanceId=" + encodeURIComponent("PAYPAL_" + payerEmail) +
                        "&phone=" + encodeURIComponent(payerName) +
                        "&plan=" + plan +
                        "&amount=" + amount +
                        "&paymentMethod=paypal" +
                        "&paypalOrderId=" + encodeURIComponent(orderId);
                    
                    var response = await fetch(saveUrl);
                    var result = await response.json();
                    
                    if (result.success && result.key) {
                        localStorage.setItem("drama_unlock_key", result.key);
                        isUnlocked = true;
                        currentUnlockKey = result.key;
                        
                        var paymentModal = document.getElementById("paymentModal");
                        if (paymentModal) paymentModal.remove();
                        
                        showPayPalSuccessWindow(
                            result.orderId || orderId,
                            payerEmail,
                            plan,
                            amount,
                            result.key
                        );
                        
                        updateUIForUnlocked(true);
                        
                        if (currentView === "home") renderHomePage();
                        else if (currentSeries) showSeriesPage(currentSeries);
                    } else {
                        if (errEl) errEl.innerHTML = '<span style="color:#ef4444;">❌ فشل في تفعيل المفتاح</span>';
                    }
                } else {
                    if (errEl) errEl.innerHTML = '<span style="color:#ef4444;">❌ لم يكتمل الدفع</span>';
                }
            } catch(e) {
                console.error("PayPal onApprove error:", e);
                if (errEl) errEl.innerHTML = '<span style="color:#ef4444;">❌ خطأ: ' + e.message + '</span>';
            }
        },
        onCancel: function(data) {
            var errEl = document.getElementById("paypalError");
            if (errEl) errEl.innerHTML = '<span style="color:#f59e0b;">⚠️ تم إلغاء الدفع</span>';
        },
        onError: function(err) {
            console.error("PayPal Error:", err);
            var errEl = document.getElementById("paypalError");
            if (errEl) errEl.innerHTML = '<span style="color:#ef4444;">❌ خطأ في PayPal</span>';
        }
    }).render("#" + containerId);
}

function showPayPalSuccessWindow(orderId, payerEmail, plan, amount, generatedKey) {
    var planNames = { weekly: "أسبوعي", monthly: "شهري", yearly: "سنوي" };
    var planName = planNames[plan] || "شهري";
    
    var modalHtml = '<div id="paypalSuccessModal" class="lock-modal active" style="z-index:3500;">' +
        '<div class="lock-card" style="max-width:360px; padding:16px 18px; border:2px solid #0070BA;">' +
            '<button id="closePayPalModal" class="btn-close">×</button>' +
            '<div style="text-align:center;">' +
                '<div style="width:70px; height:70px; background:linear-gradient(135deg,#10b981,#059669); border-radius:50%; display:flex; align-items:center; justify-content:center; margin:0 auto 12px;">' +
                    '<i class="fas fa-check" style="font-size:36px; color:white;"></i>' +
                '</div>' +
                '<h3 style="color:#10b981; font-size:20px;">✅ تم التفعيل بنجاح!</h3>' +
                '<p style="font-size:11px; color:#94a3b8; margin-top:6px;">جميع الحلقات متاحة الآن</p>' +
            '</div>' +
            '<div style="background:rgba(0,112,186,0.12); border-radius:14px; padding:12px; margin:14px 0;">' +
                '<p style="margin-bottom:6px; font-size:11px; color:#0070BA;"><i class="fas fa-key"></i> مفتاح التفعيل (احتفظ به):</p>' +
                '<div style="background:#0f172a; padding:10px; border-radius:10px; text-align:center;">' +
                    '<code id="paypalGeneratedKey" style="font-size:12px; font-weight:bold; direction:ltr; word-break:break-all; color:#10b981;">' + generatedKey + '</code>' +
                '</div>' +
                '<button id="copyPayPalKeyBtn" class="btn-copy" style="margin-top:8px; width:100%; padding:8px;">' +
                    '<i class="fas fa-copy"></i> نسخ المفتاح للاحتفاظ به' +
                '</button>' +
            '</div>' +
            '<div style="background:rgba(16,185,129,0.08); border-radius:12px; padding:10px; margin:10px 0;">' +
                '<div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:6px; font-size:10px;">' +
                    '<span>🆔 الطلب: <code style="font-size:9px;">' + orderId.substring(0, 20) + '...</code></span>' +
                    '<span>💰 ' + planName + ' ($' + amount + ')</span>' +
                '</div>' +
                '<div style="font-size:10px; margin-top:6px; color:#94a3b8; text-align:center;">📧 ' + payerEmail + '</div>' +
            '</div>' +
            '<button id="startWatchingBtn" class="btn-primary" style="width:100%; margin-top:10px; background:linear-gradient(135deg,#10b981,#059669); padding:12px;">' +
                '<i class="fas fa-play-circle"></i> ابدأ المشاهدة الآن' +
            '</button>' +
            '<a href="https://wa.me/' + WHATSAPP_ADMIN + '?text=' + encodeURIComponent('✅ تم الدفع عبر PayPal\nالطلب: ' + orderId + '\nالمفتاح: ' + generatedKey + '\nالبريد: ' + payerEmail) + '" target="_blank" class="btn-whatsapp" style="margin:8px 0; font-size:11px; padding:8px;">' +
                '<i class="fab fa-whatsapp"></i> للدعم' +
            '</a>' +
        '</div>' +
    '</div>';
    
    var oldModal = document.getElementById("paypalSuccessModal");
    if (oldModal) oldModal.remove();
    document.body.insertAdjacentHTML("beforeend", modalHtml);
    
    document.getElementById("copyPayPalKeyBtn").onclick = function() {
        navigator.clipboard.writeText(generatedKey);
        showToastMessage("✅ تم نسخ المفتاح");
        this.innerHTML = '<i class="fas fa-check"></i> تم النسخ';
        var btn = this;
        setTimeout(function() { btn.innerHTML = '<i class="fas fa-copy"></i> نسخ المفتاح للاحتفاظ به'; }, 2000);
    };
    
    document.getElementById("startWatchingBtn").onclick = function() {
        document.getElementById("paypalSuccessModal").remove();
        showToastMessage("🎬 استمتع بالمشاهدة!");
    };
    
    document.getElementById("closePayPalModal").onclick = function() {
        document.getElementById("paypalSuccessModal").remove();
    };
}

// ==================== نافذة الدفع ====================
function showPaymentModal() {
    if (isUnlocked) {
        showToastMessage("✅ أنت مفعل بالفعل! جميع الحلقات متاحة");
        return;
    }
    
    var BINANCE_ID = "749255539";
    var BARIDIMOB_RIP = "00799999002066937316";
    
    var modalHtml = '<div id="paymentModal" class="lock-modal active" style="z-index:3000;">' +
        '<div class="lock-card" style="max-width:380px; padding:16px 18px;">' +
            '<button id="closePayModal" class="btn-close">×</button>' +
            '<div style="text-align:center; margin-bottom:12px;">' +
                '<div style="width:60px; height:60px; background:linear-gradient(135deg,#0070BA,#003087); border-radius:50%; display:flex; align-items:center; justify-content:center; margin:0 auto 10px;">' +
                    '<i class="fas fa-crown" style="font-size:28px; color:white;"></i>' +
                '</div>' +
                '<h3 style="color:#0070BA;">اشتراك مميز</h3>' +
                '<p style="font-size:11px; color:#94a3b8;">اختر طريقة الدفع المناسبة لك</p>' +
            '</div>' +
            '<div style="display:flex; gap:6px; margin:12px 0; background:rgba(255,255,255,0.05); padding:5px; border-radius:14px;">' +
                '<button type="button" class="payment-tab active" data-tab="paypal" style="flex:1; padding:9px 4px; border:none; border-radius:10px; cursor:pointer; font-weight:bold; font-size:11px; transition:0.2s; background:linear-gradient(135deg,#0070BA,#003087); color:white;">' +
                    '<i class="fab fa-paypal"></i> PayPal' +
                '</button>' +
                '<button type="button" class="payment-tab" data-tab="binance" style="flex:1; padding:9px 4px; border:none; border-radius:10px; cursor:pointer; font-weight:bold; font-size:11px; transition:0.2s; background:transparent; color:#94a3b8;">' +
                    '<i class="fab fa-bitcoin"></i> Binance' +
                '</button>' +
                '<button type="button" class="payment-tab" data-tab="baridimob" style="flex:1; padding:9px 4px; border:none; border-radius:10px; cursor:pointer; font-weight:bold; font-size:11px; transition:0.2s; background:transparent; color:#94a3b8;">' +
                    '<i class="fas fa-university"></i> BaridiMob' +
                '</button>' +
            '</div>' +
            '<div style="display:flex; gap:8px; margin:12px 0;">' +
                '<div id="planWeekly" class="plan-selector" data-plan="weekly" style="flex:1; background:rgba(240,185,11,0.12); border-radius:14px; padding:10px 2px; cursor:pointer; border:1.5px solid #F0B90B; text-align:center; position:relative;">' +
                    '<div class="check-badge" style="background:#F0B90B; color:#1a1a1a;">✓</div>' +
                    '<i class="fas fa-star" style="color:#F0B90B; font-size:18px; margin-bottom:5px; display:block;"></i>' +
                    '<div style="font-size:12px; font-weight:700;">أسبوعي</div>' +
                    '<div style="font-size:16px; font-weight:800; color:#F0B90B;">$0.99</div>' +
                '</div>' +
                '<div id="planMonthly" class="plan-selector selected" data-plan="monthly" style="flex:1; background:linear-gradient(145deg,#0070BA20,#0070BA08); border-radius:14px; padding:10px 2px; cursor:pointer; border:1.5px solid #0070BA; text-align:center; position:relative; box-shadow:0 0 12px rgba(0,112,186,0.4);">' +
                    '<div class="check-badge" style="background:#0070BA;">✓</div>' +
                    '<i class="fas fa-gem" style="color:#0070BA; font-size:18px; margin-bottom:5px; display:block;"></i>' +
                    '<div style="font-size:12px; font-weight:700;">شهري</div>' +
                    '<div style="font-size:16px; font-weight:800; color:#0070BA;">$3</div>' +
                '</div>' +
                '<div id="planYearly" class="plan-selector" data-plan="yearly" style="flex:1; background:rgba(139,92,246,0.12); border-radius:14px; padding:10px 2px; cursor:pointer; border:1.5px solid #8b5cf6; text-align:center; position:relative;">' +
                    '<div class="check-badge" style="background:#8b5cf6;">✓</div>' +
                    '<i class="fas fa-crown" style="color:#8b5cf6; font-size:18px; margin-bottom:5px; display:block;"></i>' +
                    '<div style="font-size:12px; font-weight:700;">سنوي</div>' +
                    '<div style="font-size:16px; font-weight:800; color:#8b5cf6;">$30</div>' +
                '</div>' +
            '</div>' +
            '<div id="paypalContent" class="payment-content active" style="display:block;">' +
                '<div style="background:rgba(0,112,186,0.1); border-radius:14px; padding:14px; margin:10px 0; border:1px solid rgba(0,112,186,0.3);">' +
                    '<p style="font-size:12px; margin:0 0 10px; color:#0070BA; text-align:center; font-weight:bold;">' +
                        '<i class="fas fa-lock"></i> دفع آمن ومشفّر عبر PayPal' +
                    '</p>' +
                    '<div id="paypal-button-container" style="min-height:50px;"></div>' +
                    '<div id="paypalError" style="margin-top:8px; font-size:10px; color:#ef4444; text-align:center;"></div>' +
                '</div>' +
                '<div style="background:rgba(16,185,129,0.08); border-radius:10px; padding:8px; margin:8px 0; text-align:center;">' +
                    '<p style="font-size:10px; color:#10b981; margin:0;"><i class="fas fa-bolt"></i> التفعيل فوري بعد الدفع</p>' +
                '</div>' +
            '</div>' +
            '<div id="binanceContent" class="payment-content" style="display:none;">' +
                '<div style="background:linear-gradient(145deg, rgba(240,185,11,0.12), rgba(240,185,11,0.05)); border-radius:14px; padding:14px; margin:10px 0; border:1px solid rgba(240,185,11,0.35);">' +
                    '<p style="font-size:12px; margin:0 0 12px; color:#F0B90B; text-align:center; font-weight:bold;">' +
                        '<i class="fab fa-bitcoin"></i> الدفع عبر Binance Pay' +
                    '</p>' +
                    '<div class="binance-info-card">' +
                        '<p class="binance-info-label"><i class="fas fa-id-card"></i> معرّف Binance ID:</p>' +
                        '<div style="display:flex; align-items:center; justify-content:space-between; gap:8px;">' +
                            '<code id="binanceIdValue" class="binance-code binance-code-id">' + BINANCE_ID + '</code>' +
                            '<button id="copyBinanceIdBtn" class="btn-copy-binance"><i class="fas fa-copy"></i> نسخ</button>' +
                        '</div>' +
                    '</div>' +
                    '<div class="binance-info-card">' +
                        '<p class="binance-info-label"><i class="fas fa-dollar-sign"></i> المبلغ المطلوب (USDT):</p>' +
                        '<div style="display:flex; align-items:center; justify-content:space-between; gap:8px;">' +
                            '<code id="binanceAmountValue" class="binance-code binance-code-amount">$3.00</code>' +
                            '<span class="binance-network-badge"><i class="fas fa-network-wired"></i> BEP20 / TRC20</span>' +
                        '</div>' +
                    '</div>' +
                    '<div class="binance-instructions">' +
                        '<p style="font-size:10px; color:#3b82f6; margin:0; line-height:1.6;">' +
                            '<i class="fas fa-info-circle"></i> <strong>خطوات الدفع:</strong><br>' +
                            '1. افتح تطبيق Binance واذهب إلى Pay<br>' +
                            '2. أرسل المبلغ إلى المعرّف أعلاه<br>' +
                            '3. احتفظ بإيصال التحويل<br>' +
                            '4. اضغط "تأكيد الدفع" وأرسل الإيصال للإدارة' +
                        '</p>' +
                    '</div>' +
                    '<button id="confirmBinanceBtn" class="btn-whatsapp" style="background:linear-gradient(135deg,#F0B90B,#d4a017); color:#1a1a1a; font-size:12px; padding:12px; margin-bottom:8px;">' +
                        '<i class="fas fa-paper-plane"></i> تأكيد الدفع وإرسال الإيصال' +
                    '</button>' +
                '</div>' +
            '</div>' +
            '<div id="baridimobContent" class="payment-content" style="display:none;">' +
                '<div style="background:linear-gradient(145deg, rgba(16,185,129,0.12), rgba(16,185,129,0.05)); border-radius:14px; padding:14px; margin:10px 0; border:1px solid rgba(16,185,129,0.35);">' +
                    '<p style="font-size:12px; margin:0 0 12px; color:#10b981; text-align:center; font-weight:bold;">' +
                        '<i class="fas fa-university"></i> الدفع عبر BaridiMob' +
                    '</p>' +
                    '<div class="baridimob-info-card">' +
                        '<p class="baridimob-info-label"><i class="fas fa-credit-card"></i> رقم الحساب (RIP):</p>' +
                        '<div style="display:flex; align-items:center; justify-content:space-between; gap:8px;">' +
                            '<code id="baridimobRipValue" class="baridimob-code baridimob-code-rip">' + BARIDIMOB_RIP + '</code>' +
                            '<button id="copyBaridimobRipBtn" class="btn-copy-baridimob"><i class="fas fa-copy"></i> نسخ</button>' +
                        '</div>' +
                    '</div>' +
                    '<div class="baridimob-info-card">' +
                        '<p class="baridimob-info-label"><i class="fas fa-money-bill-wave"></i> المبلغ المطلوب:</p>' +
                        '<div style="display:flex; align-items:center; justify-content:space-between; gap:8px;">' +
                            '<code id="baridimobAmountValue" class="baridimob-code baridimob-code-amount">750 DZD</code>' +
                            '<span class="baridimob-network-badge"><i class="fas fa-exchange-alt"></i> سعر الصرف</span>' +
                        '</div>' +
                    '</div>' +
                    '<div class="baridimob-instructions">' +
                        '<p style="font-size:10px; color:#10b981; margin:0; line-height:1.6;">' +
                            '<i class="fas fa-info-circle"></i> <strong>خطوات الدفع:</strong><br>' +
                            '1. افتح تطبيق BaridiMob<br>' +
                            '2. اذهب إلى "تحويل" واختر "تحويل إلى RIP"<br>' +
                            '3. أدخل رقم RIP أعلاه والمبلغ المطلوب<br>' +
                            '4. احتفظ بإيصال التحويل<br>' +
                            '5. اضغط "تأكيد الدفع" وأرسل الإيصال للإدارة' +
                        '</p>' +
                    '</div>' +
                    '<button id="confirmBaridimobBtn" class="btn-whatsapp" style="background:linear-gradient(135deg,#10b981,#059669); color:white; font-size:12px; padding:12px; margin-bottom:8px;">' +
                        '<i class="fas fa-paper-plane"></i> تأكيد الدفع وإرسال الإيصال' +
                    '</button>' +
                '</div>' +
            '</div>' +
            '<div style="background:rgba(59,130,246,0.1); border-radius:12px; padding:10px; margin-top:10px;">' +
                '<p style="font-size:10px; margin:0 0 6px; color:#3b82f6;"><i class="fas fa-key"></i> لديك مفتاح؟</p>' +
                '<div style="display:flex; gap:6px;">' +
                    '<input type="text" id="existingKeyInput" placeholder="أدخل المفتاح" style="flex:2; padding:8px; font-size:10px; border-radius:30px; background:#0f1a24; border:none; color:white;">' +
                    '<button id="activateExistingKeyBtn" style="padding:8px 16px; font-size:11px; border-radius:30px; background:linear-gradient(135deg,#3b82f6,#2563eb); border:none; cursor:pointer; font-weight:bold; color:white;">تفعيل</button>' +
                '</div>' +
                '<div id="existingKeyError" style="margin-top:6px; font-size:10px; text-align:center;"></div>' +
            '</div>' +
        '</div>' +
    '</div>';
    
    var oldModal = document.getElementById("paymentModal");
    if (oldModal) oldModal.remove();
    document.body.insertAdjacentHTML("beforeend", modalHtml);
    
    var selectedPlan = "monthly";
    var planPrices = { weekly: 0.99, monthly: 3.00, yearly: 30.00 };
    var planPricesDZD = { weekly: 247.5, monthly: 750, yearly: 7500 };
    var planNames = { weekly: "أسبوعي", monthly: "شهري", yearly: "سنوي" };
    var currentPaymentTab = "paypal";
    
    function updateSelectedPlanUI(planElement, planType) {
        document.querySelectorAll(".plan-selector").forEach(function(p) {
            p.classList.remove("selected");
            p.style.boxShadow = "none";
            var badge = p.querySelector(".check-badge");
            if (badge) badge.style.display = "none";
            if (p.getAttribute("data-plan") === "weekly") {
                p.style.background = "rgba(240,185,11,0.12)";
                p.style.border = "1.5px solid #F0B90B";
            } else if (p.getAttribute("data-plan") === "monthly") {
                p.style.background = "rgba(0,112,186,0.12)";
                p.style.border = "1.5px solid #0070BA";
            } else {
                p.style.background = "rgba(139,92,246,0.12)";
                p.style.border = "1.5px solid #8b5cf6";
            }
        });
        planElement.classList.add("selected");
        var badge = planElement.querySelector(".check-badge");
        if (badge) badge.style.display = "flex";
        
        var planColor = planType === "weekly" ? "#F0B90B" : (planType === "monthly" ? "#0070BA" : "#8b5cf6");
        planElement.style.boxShadow = "0 0 15px " + planColor;
        planElement.style.background = "linear-gradient(145deg, " + planColor + "25, " + planColor + "08)";
        planElement.style.border = "1.5px solid " + planColor;
        
        var binanceAmountEl = document.getElementById("binanceAmountValue");
        if (binanceAmountEl) binanceAmountEl.textContent = "$" + planPrices[planType].toFixed(2);
        
        var baridiAmountEl = document.getElementById("baridimobAmountValue");
        if (baridiAmountEl) baridiAmountEl.textContent = planPricesDZD[planType] + " DZD";
        
        var binanceBtn = document.getElementById("confirmBinanceBtn");
        if (binanceBtn) {
            binanceBtn.onclick = function() {
                var msg = '💳 طلب اشتراك عبر Binance\nالباقة: ' + planNames[selectedPlan] + '\nالمبلغ: ' + planPrices[selectedPlan].toFixed(2) + ' USDT\nBinance ID: ' + BINANCE_ID + '\nسأرسل الإيصال الآن';
                window.open('https://wa.me/' + WHATSAPP_ADMIN + '?text=' + encodeURIComponent(msg), '_blank');
            };
        }
        
        var baridiBtn = document.getElementById("confirmBaridimobBtn");
        if (baridiBtn) {
            baridiBtn.onclick = function() {
                var msg = '🏦 طلب اشتراك عبر BaridiMob\nالباقة: ' + planNames[selectedPlan] + '\nالمبلغ: ' + planPricesDZD[selectedPlan] + ' DZD\nRIP: ' + BARIDIMOB_RIP + '\nسأرسل الإيصال الآن';
                window.open('https://wa.me/' + WHATSAPP_ADMIN + '?text=' + encodeURIComponent(msg), '_blank');
            };
        }
        
        if (currentPaymentTab === "paypal") {
            setTimeout(function() {
                renderPayPalButtons("paypal-button-container", planType, planPrices[planType]);
            }, 100);
        }
    }
    
    document.querySelectorAll(".plan-selector").forEach(function(el) {
        el.onclick = function() {
            var planType = this.getAttribute("data-plan");
            selectedPlan = planType;
            updateSelectedPlanUI(this, planType);
        };
    });
    
    var monthlyElement = document.getElementById("planMonthly");
    if (monthlyElement) updateSelectedPlanUI(monthlyElement, "monthly");
    
    document.querySelectorAll(".payment-tab").forEach(function(tab) {
        tab.onclick = function() {
            var tabName = this.getAttribute("data-tab");
            currentPaymentTab = tabName;
            
            document.querySelectorAll(".payment-tab").forEach(function(t) {
                t.classList.remove("active");
                t.style.background = "transparent";
                t.style.color = "#94a3b8";
            });
            this.classList.add("active");
            
            document.getElementById("paypalContent").style.display = "none";
            document.getElementById("binanceContent").style.display = "none";
            document.getElementById("baridimobContent").style.display = "none";
            
            if (tabName === "paypal") {
                this.style.background = "linear-gradient(135deg,#0070BA,#003087)";
                this.style.color = "white";
                document.getElementById("paypalContent").style.display = "block";
                setTimeout(function() {
                    renderPayPalButtons("paypal-button-container", selectedPlan, planPrices[selectedPlan]);
                }, 150);
            } else if (tabName === "binance") {
                this.style.background = "linear-gradient(135deg,#F0B90B,#d4a017)";
                this.style.color = "#1a1a1a";
                document.getElementById("binanceContent").style.display = "block";
            } else if (tabName === "baridimob") {
                this.style.background = "linear-gradient(135deg,#10b981,#059669)";
                this.style.color = "white";
                document.getElementById("baridimobContent").style.display = "block";
            }
        };
    });
    
    var copyBinanceBtn = document.getElementById("copyBinanceIdBtn");
    if (copyBinanceBtn) {
        copyBinanceBtn.onclick = function() {
            navigator.clipboard.writeText(BINANCE_ID).then(function() {
                showToastMessage("✅ تم نسخ Binance ID");
                copyBinanceBtn.classList.add("copied");
                copyBinanceBtn.innerHTML = '<i class="fas fa-check"></i> تم النسخ';
                setTimeout(function() {
                    copyBinanceBtn.classList.remove("copied");
                    copyBinanceBtn.innerHTML = '<i class="fas fa-copy"></i> نسخ';
                }, 2000);
            }).catch(function() {
                showToastMessage("⚠️ فشل النسخ، انسخ يدوياً");
            });
        };
    }
    
    var copyBaridimobBtn = document.getElementById("copyBaridimobRipBtn");
    if (copyBaridimobBtn) {
        copyBaridimobBtn.onclick = function() {
            navigator.clipboard.writeText(BARIDIMOB_RIP).then(function() {
                showToastMessage("✅ تم نسخ RIP BaridiMob");
                copyBaridimobBtn.classList.add("copied");
                copyBaridimobBtn.innerHTML = '<i class="fas fa-check"></i> تم النسخ';
                setTimeout(function() {
                    copyBaridimobBtn.classList.remove("copied");
                    copyBaridimobBtn.innerHTML = '<i class="fas fa-copy"></i> نسخ';
                }, 2000);
            }).catch(function() {
                showToastMessage("⚠️ فشل النسخ، انسخ يدوياً");
            });
        };
    }
    
    setTimeout(function() {
        renderPayPalButtons("paypal-button-container", "monthly", 3.00);
    }, 300);
    
    document.getElementById("activateExistingKeyBtn").onclick = async function() {
        var key = document.getElementById("existingKeyInput").value.trim();
        var errEl = document.getElementById("existingKeyError");
        if (!key) { errEl.innerHTML = '<span style="color:#f59e0b;">⚠️ أدخل المفتاح</span>'; return; }
        
        this.disabled = true;
        this.innerHTML = '<i class="fas fa-spinner fa-spin"></i>';
        
        var isValid = await activateKey(key);
        if (isValid) {
            errEl.innerHTML = '<span style="color:#22c55e;">✅ تم التفعيل!</span>';
            setTimeout(function() {
                var pm = document.getElementById("paymentModal");
                if (pm) pm.remove();
                if (currentView === "home") renderHomePage();
                else if (currentSeries) showSeriesPage(currentSeries);
            }, 1000);
        } else {
            errEl.innerHTML = '<span style="color:#ef4444;">❌ مفتاح غير صالح</span>';
            this.disabled = false;
            this.innerHTML = 'تفعيل';
        }
    };
    
    document.getElementById("closePayModal").onclick = function() {
        document.getElementById("paymentModal").remove();
    };
}

// ==================== عرض صفحة المسلسل ====================
function showSeriesPage(series, fromBack) {
    currentView = "series";
    currentSeries = series;
    currentEpisodes = series.episodes || [];
    
    if (!fromBack && !isBackNavigation) {
        pushPageToHistory("series", { series: series }, series.title);
    }
    
    var episodesHtml = "";
    var totalEp = currentEpisodes.length;
    for (var i = 0; i < totalEp; i++) {
        var ep = currentEpisodes[i];
        var isLocked = ep.locked && !isUnlocked;
        episodesHtml += '<li data-id="' + ep.id + '">' +
            '<div class="episode-text">' + 
            (isLocked ? '<i class="fas fa-lock episode-lock-icon"></i>' : '<i class="fas fa-play-circle episode-play-icon"></i>') + 
            '<span class="episode-number">الحلقة ' + ep.title + '</span>' +
            '</div>' +
            '</li>';
    }
    
    var statusClass = isUnlocked ? "unlocked" : "locked";
    var statusText = isUnlocked ? "✅ مفعل | جميع الحلقات متاحة" : "🔒 غير مفعل | الحلقات 1-4 مجانية";
    var sidebarHtml = buildSidebarHtml();
    
    var html = '<div class="main-layout">' + sidebarHtml + 
        '<div class="content-area">' +
            '<div class="top-bar">' +
                '<div class="top-bar-left">' +
                    '<button class="back-btn" id="backBtn"><i class="fas fa-arrow-right"></i></button>' +
                    '<div class="menu-toggle" id="menuToggle"><i class="fas fa-bars"></i></div>' +
                '</div>' +
                '<div class="top-bar-right">' +
                    '<button class="activation-btn" id="unlockBtn"><i class="fas fa-crown"></i> اشتراك</button>' +
                    '<button class="home-btn" id="homeBtn"><i class="fas fa-home"></i></button>' +
                    '<button class="theme-toggle-btn" id="themeToggleBtn"><i class="fas fa-moon"></i></button>' +
                '</div>' +
            '</div>' +
            '<div class="info-bar">' +
                '<div class="info-bar-left">' +
                    '<div class="servers" id="serversDropdown">' +
                        '<span class="icon"><i class="fas fa-list-ul"></i>الحلقات<span style="background:rgba(255,255,255,0.2); padding:2px 6px; border-radius:20px; font-size:10px;">' + totalEp +
                        '</span> </span>' +
                        '<ul class="content" id="episodesList">' + episodesHtml + '</ul>' +
                    '</div>' +
                '</div>' +
                '<div class="info-bar-right">' +
                    '<div class="title-section">' +
                        '<span class="series-name" id="seriesName">' + series.title + '</span>' +
                        '<span class="episode-number" id="currentEpisodeNumber">الحلقة 1</span>' +
                    '</div>' +
                '</div>' +
            '</div>' +
            '<div class="video-wrapper">' +
                '<video id="videoPlayer" controls playsinline preload="metadata" style="width:100%;" oncontextmenu="return false;" controlsList="nodownload noremoteplayback" disablePictureInPicture="true">' +
                    '<source id="videoSource" src="#" type="video/mp4"></source>' +
                '</video>' +
            '</div>' +
        '</div>' +
        '<div class="status-badge ' + statusClass + '" id="statusBadge">' +
            '<i class="' + (isUnlocked ? 'fas fa-check-circle' : 'fas fa-lock') + '"></i> ' + statusText +
        '</div>' +
    '</div>';
    
    document.getElementById("app-root").innerHTML = html;
    setupSeriesEvents();
    initTheme();
    setupSidebarEvents();
    if (currentEpisodes.length > 0) { loadEpisode(currentEpisodes[0]); }
}

function setupSeriesEvents() {
    var episodesMenu = $("#episodesList");
    var serversIcon = $(".servers .icon");
    
    serversIcon.off("click").on("click", function(e) {
        e.stopPropagation();
        episodesMenu.toggleClass("active");
    });
    
    $(document).off("click").on("click", function(e) {
        if (!$(e.target).closest(".servers").length) {
            episodesMenu.removeClass("active");
        }
    });
    
    $("#unlockBtn").off("click").on("click", function() { showPaymentModal(); });
    $("#homeBtn").off("click").on("click", function() { 
        pageHistoryStack = [];
        renderHomePage(); 
    });
    $("#backBtn").off("click").on("click", function() { goBackToPreviousPage(); });
    
    $("#episodesList li").off("click").on("click", async function() {
        var epId = $(this).data("id");
        var episode = null;
        for (var i = 0; i < currentEpisodes.length; i++) { 
            if (currentEpisodes[i].id == epId) { 
                episode = currentEpisodes[i]; 
                break; 
            } 
        }
        if (episode) { 
            await loadEpisode(episode); 
            $("#episodesList").removeClass("active");
        }
    });
}

async function loadEpisode(episode) {
    if (!episode) return;
    if (episode.id > 4 && !isUnlocked) { showPaymentModal(); return; }
    
    var realUrl = await getEpisodeUrl(episode.id, currentSeries.seriesId, currentSeries.apiFile, currentUnlockKey);
    
    if (realUrl) {
        currentEpisode = episode;
        var video = document.getElementById("videoPlayer");
        var source = document.getElementById("videoSource");
        
if (source) source.src = `/api/stream?episodeId=${episode.id}&seriesId=${currentSeries.seriesId}&key=${currentUnlockKey || ''}`;        if (video) { 
            video.load(); 
            video.play().catch(function(e) { 
                console.log("تشغيل تلقائي غير مسموح:", e);
            }); 
        }
        
        var seriesNameSpan = document.getElementById("seriesName");
        var episodeNumberSpan = document.getElementById("currentEpisodeNumber");
        if (seriesNameSpan) seriesNameSpan.innerText = currentSeries.title;
        if (episodeNumberSpan) episodeNumberSpan.innerText = "الحلقة " + episode.number;
        
        var items = document.querySelectorAll("#episodesList li");
        for (var i = 0; i < items.length; i++) {
            items[i].classList.remove("active");
            if ($(items[i]).data("id") == episode.id) { items[i].classList.add("active"); }
        }
    } else { 
        showToastMessage("⚠️ رابط هذه الحلقة غير متوفر حالياً");
    }
}

// ==================== القائمة الجانبية ====================
function buildSidebarHtml() {
    var mainCategories = [
        { id: "mexican", name: "مسلسلات مكسيكية", icon: "fas fa-flag fa-fw", color: "#ef4444" },
        { id: "indian", name: "مسلسلات هندية", icon: "fas fa-flag fa-fw", color: "#f97316" },
        { id: "turkish", name: "مسلسلات تركية", icon: "fas fa-flag fa-fw", color: "#22c55e" },
        { id: "arabic", name: "مسلسلات عربية", icon: "fas fa-flag fa-fw", color: "#3b82f6" },
        { id: "korean", name: "مسلسلات كورية", icon: "fas fa-flag fa-fw", color: "#ec4899" }
    ];
    
    var unlockText = isUnlocked ? '<i class="fas fa-check-circle"></i> تم التفعيل' : '<i class="fas fa-crown"></i> اشتراك';
    
    var html = '<div class="sidebar" id="sidebar">' +
        '<div class="sidebar-header">' +
            '<button class="sidebar-close-btn" id="closeSidebarBtn" title="إغلاق"><i class="fas fa-times"></i></button>' +
            '<h2><i class="fas fa-tv"></i> عالم الدراما</h2>' +
            '<p>أحدث المسلسلات المترجمة والمدبلجة</p>' +
        '</div>' +
        '<div class="sidebar-section">' +
            '<div class="sidebar-nav-btn" id="sidebarHomeBtn"><i class="fas fa-home"></i> الرئيسية</div>' +
        '</div>';
    
    for (var c = 0; c < mainCategories.length; c++) {
        var cat = mainCategories[c];
        var count = 0;
        for (var id in seriesDatabase) { 
            if (seriesDatabase[id].category === cat.id) count++; 
        }
        if (count > 0) {
            html += '<div class="sidebar-section">' +
                '<h3 data-category-id="' + cat.id + '" style="cursor:pointer;">' +
                    '<i class="' + cat.icon + '" style="color:' + cat.color + ';"></i> ' + cat.name + 
                    '<span style="background:#0070BA; padding:2px 8px; border-radius:20px; font-size:11px; color:white; margin-right:8px;">' + count + '</span>' +
                '</h3>' +
            '</div>';
        }
    }
    
    html += '<div class="sidebar-section">' +
        '<div class="sidebar-nav-btn" id="sidebarPrivacyBtn"><i class="fas fa-shield-alt"></i> سياسة الخصوصية</div>' +
        '<div class="sidebar-nav-btn" id="sidebarContactBtn"><i class="fas fa-envelope"></i> اتصل بنا</div>' +
        '<div class="sidebar-nav-btn" id="sidebarTermsBtn"><i class="fas fa-file-contract"></i> شروط الاستخدام</div>' +
        '<div class="sidebar-nav-btn" id="sidebarDisclaimerBtn"><i class="fas fa-exclamation-triangle"></i> إخلاء مسؤولية</div>' +
    '</div>';
    
    html += '<div class="sidebar-section">' +
        '<h3 id="sidebarThemeBtn" style="cursor:pointer;">' +
            '<i class="fas fa-moon"></i> <span id="sidebarThemeText">الوضع النهاري</span>' +
        '</h3>' +
    '</div>';
    
    html += '<div class="unlock-status" id="sidebarUnlockBtn">' + unlockText + '</div>' +
    '</div><div class="sidebar-overlay" id="sidebarOverlay"></div>';
    
    return html;
}

function setupSidebarEvents() {
    var sidebar = document.getElementById("sidebar");
    var overlay = document.getElementById("sidebarOverlay");
    var menuToggle = document.getElementById("menuToggle");
    var homeMenuToggle = document.getElementById("homeMenuToggle");
    var closeBtn = document.getElementById("closeSidebarBtn");
    
    var openSidebar = function() { 
        if (sidebar) sidebar.classList.add("open"); 
        if (overlay) overlay.classList.add("active"); 
        document.body.style.overflow = "hidden"; 
    };
    
    if (menuToggle) menuToggle.onclick = openSidebar;
    if (homeMenuToggle) homeMenuToggle.onclick = openSidebar;
    
    var closeSidebar = function() { 
        if (sidebar) sidebar.classList.remove("open"); 
        if (overlay) overlay.classList.remove("active"); 
        document.body.style.overflow = ""; 
    };
    
    if (closeBtn) closeBtn.onclick = closeSidebar;
    if (overlay) overlay.onclick = closeSidebar;
    
    document.addEventListener("keydown", function(e) { 
        if (e.key === "Escape" && sidebar && sidebar.classList.contains("open")) { 
            closeSidebar(); 
        } 
    });
    
    var homeBtn = document.getElementById("sidebarHomeBtn");
    if (homeBtn) homeBtn.onclick = function() { closeSidebar(); pageHistoryStack = []; renderHomePage(); };
    
    var categoryHeaders = document.querySelectorAll(".sidebar-section h3[data-category-id]");
    for (var i = 0; i < categoryHeaders.length; i++) {
        categoryHeaders[i].onclick = function() {
            var categoryId = this.getAttribute("data-category-id");
            if (categoryId) { closeSidebar(); showSubcategoriesPage(categoryId); }
        };
    }
    
    var privacyBtn = document.getElementById("sidebarPrivacyBtn");
    if (privacyBtn) privacyBtn.onclick = function() { closeSidebar(); showStaticPage("privacy"); };
    var contactBtn = document.getElementById("sidebarContactBtn");
    if (contactBtn) contactBtn.onclick = function() { closeSidebar(); showStaticPage("contact"); };
    var termsBtn = document.getElementById("sidebarTermsBtn");
    if (termsBtn) termsBtn.onclick = function() { closeSidebar(); showStaticPage("terms"); };
    var disclaimerBtn = document.getElementById("sidebarDisclaimerBtn");
    if (disclaimerBtn) disclaimerBtn.onclick = function() { closeSidebar(); showStaticPage("disclaimer"); };
    
    var unlockBtn = document.getElementById("sidebarUnlockBtn");
    if (unlockBtn) unlockBtn.onclick = function() { showPaymentModal(); };
    
    var themeBtn = document.getElementById("sidebarThemeBtn");
    if (themeBtn) {
        themeBtn.onclick = function() {
            if (document.body.classList.contains("light-mode")) {
                document.body.classList.remove("light-mode");
                localStorage.setItem("drama_theme", "dark");
                document.getElementById("sidebarThemeText").innerHTML = "الوضع النهاري";
                themeBtn.innerHTML = '<i class="fas fa-sun"></i> <span id="sidebarThemeText">الوضع النهاري</span>';
            } else {
                document.body.classList.add("light-mode");
                localStorage.setItem("drama_theme", "light");
                document.getElementById("sidebarThemeText").innerHTML = "الوضع الليلي";
                themeBtn.innerHTML = '<i class="fas fa-moon"></i> <span id="sidebarThemeText">الوضع الليلي</span>';
            }
            updateAllThemeButtons();
        };
        var isLight = document.body.classList.contains("light-mode");
        if (isLight) {
            document.getElementById("sidebarThemeText").innerHTML = "الوضع الليلي";
            themeBtn.innerHTML = '<i class="fas fa-moon"></i> <span id="sidebarThemeText">الوضع الليلي</span>';
        }
    }
}

// ==================== الصفحات الثابتة ====================
function showStaticPage(pageType) {
    var content = "", title = "";
    if(pageType === "privacy") {
        title = "سياسة الخصوصية";
        content = '<div style="max-width:900px;margin:0 auto;padding:40px 20px;direction:rtl;"><h1 style="color:#0070BA;margin-bottom:20px;">سياسة الخصوصية</h1><p>آخر تحديث: ' + new Date().toLocaleDateString('ar-EG') + '</p><h2>1. المعلومات التي نجمعها</h2><p>نحن في موقع عالم الدراما نحرص على حماية خصوصية زوارنا. لا نقوم بجمع أي معلومات شخصية مثل الاسم أو البريد الإلكتروني أو رقم الهاتف إلا إذا قدمتها طواعية من خلال نماذج الاتصال.</p><h2>2. استخدام المعلومات</h2><p>نستخدم المعلومات التي تقدمها فقط للرد على استفساراتك وتحسين تجربتك على الموقع.</p><h2>3. Google AdSense وملفات تعريف الارتباط</h2><p>يستخدم الموقع Google AdSense لعرض الإعلانات. تستخدم Google ملفات تعريف الارتباط (cookies) لتقديم إعلانات مخصصة بناءً على زياراتك السابقة للموقع.</p></div>';
    } else if(pageType === "contact") {
        title = "اتصل بنا";
        content = '<div style="max-width:800px;margin:0 auto;padding:40px 20px;direction:rtl;"><h1 style="color:#0070BA;margin-bottom:20px;">اتصل بنا</h1><p>يسعدنا تواصلك معنا.</p><div style="background:rgba(0,112,186,0.1);padding:25px;border-radius:15px;margin:25px 0;"><form id="contactFormPage" onsubmit="event.preventDefault(); submitContactFormPage();"><div style="margin-bottom:15px;"><label style="display:block;margin-bottom:5px;font-weight:bold;">الاسم</label><input type="text" id="contactNamePage" required style="width:100%;padding:12px;border-radius:10px;border:1px solid #ddd;background:#f9f9f9;"></div><div style="margin-bottom:15px;"><label style="display:block;margin-bottom:5px;font-weight:bold;">البريد الإلكتروني</label><input type="email" id="contactEmailPage" required style="width:100%;padding:12px;border-radius:10px;border:1px solid #ddd;background:#f9f9f9;"></div><div style="margin-bottom:15px;"><label style="display:block;margin-bottom:5px;font-weight:bold;">الرسالة</label><textarea id="contactMessagePage" rows="5" required style="width:100%;padding:12px;border-radius:10px;border:1px solid #ddd;background:#f9f9f9;"></textarea></div><button type="submit" style="background:#0070BA;color:white;padding:12px 30px;border:none;border-radius:10px;cursor:pointer;font-weight:bold;">إرسال</button></form><div id="contactResultPage" style="margin-top:15px;"></div></div><div style="text-align:center;"><p><i class="fas fa-envelope"></i> البريد: <strong>meguerhi1@gmail.com</strong></p><p><i class="fab fa-whatsapp"></i> واتساب: <strong>+213696308000</strong></p></div></div>';
    } else if(pageType === "terms") {
        title = "شروط الاستخدام";
        content = '<div style="max-width:900px;margin:0 auto;padding:40px 20px;direction:rtl;"><h1 style="color:#0070BA;margin-bottom:20px;">شروط الاستخدام</h1><h2>1. قبول الشروط</h2><p>باستخدامك لهذا الموقع، فإنك توافق على الالتزام بشروط الاستخدام هذه.</p><h2>2. المحتوى والحقوق</h2><p>جميع المحتويات المعروضة على هذا الموقع هي لأغراض ترفيهية وتعليمية.</p><h2>3. الاشتراك والتفعيل</h2><p>الاشتراك في الباقة المميزة يتيح لك الوصول إلى جميع الحلقات.</p></div>';
    } else if(pageType === "disclaimer") {
        title = "إخلاء مسؤولية";
        content = '<div style="max-width:900px;margin:0 auto;padding:40px 20px;direction:rtl;"><h1 style="color:#0070BA;margin-bottom:20px;">إخلا�ء مسؤولية</h1><p>المحتوى المقدم على موقع "عالم الدراما" هو للأغراض الترفيهية فقط.</p><h2>المحتوى الخارجي</h2><p>قد يحتوي الموقع على روابط لمحتوى خارجي. نحن لسنا مسؤولين عن توفر هذه المحتويات.</p></div>';
    }
    var sidebarHtml = buildSidebarHtml();
    var statusClass = isUnlocked ? "unlocked" : "";
    var statusText = isUnlocked ? "مفعل" : "اشتراك";
    var html = '<div class="home-wrapper">' + sidebarHtml + '<div class="home-container"><div class="home-controls"><div class="home-menu-toggle" id="homeMenuToggle"><i class="fas fa-bars"></i></div><div class="user-status ' + statusClass + '" id="homeUnlockBtn"><i class="fas fa-crown"></i> <span>' + statusText + '</span></div><div class="home-theme-btn" id="homeThemeToggle"><i class="fas fa-moon"></i></div></div><div class="home-header" onclick="window.location.href=window.location.pathname"><h1><i class="fas fa-tv"></i> ' + title + '</h1><p>عالم الدراما - جميع المسلسلات المترجمة والمدبلجة</p></div>' + content + '</div></div>';
    document.getElementById("app-root").innerHTML = html;
    setupSidebarEvents();
    var unlockBtn = document.getElementById("homeUnlockBtn");
    if(unlockBtn) unlockBtn.onclick = function() { showPaymentModal(); };
    initTheme();
    window.submitContactFormPage = function() {
        var nameEl = document.getElementById('contactNamePage');
        var emailEl = document.getElementById('contactEmailPage');
        var messageEl = document.getElementById('contactMessagePage');
        var result = document.getElementById('contactResultPage');
        if(nameEl && emailEl && messageEl && nameEl.value && emailEl.value && messageEl.value) {
            var existingContacts = JSON.parse(localStorage.getItem('contacts') || '[]');
            existingContacts.push({ name: nameEl.value, email: emailEl.value, message: messageEl.value, date: new Date().toISOString() });
            localStorage.setItem('contacts', JSON.stringify(existingContacts));
            result.innerHTML = '<div style="background:#22c55e;color:white;padding:10px;border-radius:10px;">✓ تم إرسال رسالتك بنجاح!</div>';
            var form = document.getElementById('contactFormPage');
            if (form) form.reset();
            setTimeout(function() { result.innerHTML = ''; }, 5000);
        }
    };
}

// ==================== عرض الصفحات ====================
function showSubcategoriesPage(categoryId, fromBack) {
    currentView = "subcategories";
    currentCategory = categoryId;
    
    if (!fromBack && !isBackNavigation) {
        pushPageToHistory("subcategories", { categoryId: categoryId }, "مسلسلات " + categoryId);
    }
    
    var categoryNames = { mexican: "المكسيكية", indian: "الهندية", turkish: "التركية", arabic: "العربية", korean: "الكورية" };
    var categoryName = categoryNames[categoryId] || categoryId;
    var subCount = 0, dubCount = 0;
    for (var id in seriesDatabase) {
        if (seriesDatabase[id].category === categoryId) {
            if (seriesDatabase[id].translation === "sub") subCount++;
            else if (seriesDatabase[id].translation === "dub") dubCount++;
        }
    }
    var subcategoriesHtml = '';
    if (subCount > 0) subcategoriesHtml += '<div class="subcategory-card" data-translation="sub"><i class="fas fa-language"></i><h3>📺 مترجم</h3><p>مسلسلات ' + categoryName + ' مترجمة<br>' + subCount + ' مسلسل</p></div>';
    if (dubCount > 0) subcategoriesHtml += '<div class="subcategory-card" data-translation="dub"><i class="fas fa-microphone-alt"></i><h3>🎙️ مدبلج</h3><p>مسلسلات ' + categoryName + ' مدبلجة<br>' + dubCount + ' مسلسل</p></div>';
    var statusClass = isUnlocked ? "unlocked" : "";
    var statusText = isUnlocked ? "مفعل" : "اشتراك";
    var sidebarHtml = buildSidebarHtml();
    var html = '<div class="home-wrapper">' + sidebarHtml + '<div class="home-container"><div class="home-controls"><div class="home-menu-toggle" id="homeMenuToggle"><i class="fas fa-bars"></i></div><div class="user-status ' + statusClass + '" id="homeUnlockBtn"><i class="fas fa-crown"></i> <span>' + statusText + '</span></div><div class="home-theme-btn" id="homeThemeToggle"><i class="fas fa-moon"></i></div></div><div class="home-header"><h1><i class="fas fa-tv"></i> مسلسلات ' + categoryName + '</h1><p>اختر نوع المشاهدة</p></div><div class="subcategories-grid" id="subcategoriesGrid">' + subcategoriesHtml + '</div></div></div>';
    document.getElementById("app-root").innerHTML = html;
    setupSidebarEvents();
    var subCards = document.querySelectorAll(".subcategory-card");
    for (var i = 0; i < subCards.length; i++) {
        subCards[i].onclick = function() {
            var translation = this.getAttribute("data-translation");
            showSeriesListPage(currentCategory, translation);
        };
    }
    var unlockBtn = document.getElementById("homeUnlockBtn");
    if (unlockBtn) unlockBtn.onclick = function() { showPaymentModal(); };
    initTheme();
}

function showSeriesListPage(categoryId, translationType, fromBack) {
    currentView = "serieslist";
    currentCategory = categoryId;
    currentTranslation = translationType;
    currentPage = 1;
    
    if (!fromBack && !isBackNavigation) {
        pushPageToHistory("serieslist", { categoryId: categoryId, translationType: translationType }, "قائمة المسلسلات");
    }
    
    renderSeriesList();
}

function createSeriesCard(series) {
    var epCount = series.totalEpisodes || 0;
    var typeLabel = series.translation === "sub" ? "مترجم" : "مدبلج";
    var genres = series.genres || [];
    
    var genresHtml = '';
    for (var g = 0; g < genres.length; g++) {
        genresHtml += '<span class="series-card-genre">' + genres[g] + '</span>';
    }
    
    return '<div class="series-card" data-series-id="' + series.id + '">' +
        '<div class="series-card-image-wrapper">' +
            '<img class="series-card-image" src="' + series.image + '" alt="' + series.title + '" loading="lazy"/>' +
            '<span class="series-card-badge">' + typeLabel + '</span>' +
        '</div>' +
        '<div class="series-card-info">' +
            '<div class="series-card-title">' + series.title + '</div>' +
            '<div class="series-card-genres">' + genresHtml + '</div>' +
            '<div class="series-card-episodes"><i class="fas fa-tv"></i> ' + epCount + ' حلقة</div>' +
        '</div>' +
    '</div>';
}

function renderSeriesList() {
    var filteredSeries = [];
    for (var id in seriesDatabase) {
        if (seriesDatabase[id].category === currentCategory && seriesDatabase[id].translation === currentTranslation) {
            filteredSeries.push(seriesDatabase[id]);
        }
    }
    var totalItems = filteredSeries.length;
    var totalPages = Math.ceil(totalItems / itemsPerPage);
    var startIndex = (currentPage - 1) * itemsPerPage;
    var endIndex = startIndex + itemsPerPage;
    var pageSeries = filteredSeries.slice(startIndex, endIndex);
    var gridHtml = "";
    for (var i = 0; i < pageSeries.length; i++) {
        gridHtml += createSeriesCard(pageSeries[i]);
    }
    var paginationHtml = '';
    if (totalPages > 1) {
        paginationHtml = '<div class="pagination"><button id="prevPageBtn" ' + (currentPage === 1 ? 'disabled' : '') + '><i class="fas fa-chevron-right"></i> السابق</button><span>الصفحة ' + currentPage + ' من ' + totalPages + '</span><button id="nextPageBtn" ' + (currentPage === totalPages ? 'disabled' : '') + '>التالي <i class="fas fa-chevron-left"></i></button></div>';
    }
    var categoryNames = { mexican: "المكسيكية", indian: "الهندية", turkish: "التركية", arabic: "العربية", korean: "الكورية" };
    var categoryName = categoryNames[currentCategory] || currentCategory;
    var translationName = currentTranslation === "sub" ? "المترجمة" : "المدبلجة";
    var headerIcon = currentTranslation === "sub" ? '<i class="fas fa-language"></i>' : '<i class="fas fa-microphone-alt"></i>';
    var statusClass = isUnlocked ? "unlocked" : "";
    var statusText = isUnlocked ? "مفعل" : "اشتراك";
    var sidebarHtml = buildSidebarHtml();
    var html = '<div class="home-wrapper">' + sidebarHtml + '<div class="home-container"><div class="home-controls"><div class="home-menu-toggle" id="homeMenuToggle"><i class="fas fa-bars"></i></div><div class="user-status ' + statusClass + '" id="homeUnlockBtn"><i class="fas fa-crown"></i> <span>' + statusText + '</span></div><div class="home-theme-btn" id="homeThemeToggle"><i class="fas fa-moon"></i></div></div><div class="home-header"><h1>' + headerIcon + ' مسلسلات ' + categoryName + ' ' + translationName + '</h1><p>عرض ' + totalItems + ' مسلسل</p></div><div class="search-header"><i class="fas fa-search"></i><input type="text" id="homeSearchInput" placeholder="ابحث عن مسلسل..."></div><div class="series-grid" id="seriesGrid">' + gridHtml + '</div>' + paginationHtml + '</div></div>';
    document.getElementById("app-root").innerHTML = html;
    setupSidebarEvents();
    var cards = document.querySelectorAll(".series-card");
    for (var i = 0; i < cards.length; i++) {
        cards[i].onclick = function() {
            var id = this.getAttribute("data-series-id");
            var series = seriesDatabase[id];
            if (series) showSeriesPage(series);
        };
    }
    var searchInput = document.getElementById("homeSearchInput");
    if (searchInput) {
        searchInput.oninput = function() {
            var term = this.value.trim().toLowerCase();
            var allCards = document.querySelectorAll(".series-card");
            var hasResults = false;
            for (var i = 0; i < allCards.length; i++) {
                var title = allCards[i].querySelector(".series-card-title").innerText.toLowerCase();
                if (title.includes(term)) { allCards[i].style.display = "flex"; hasResults = true; } 
                else { allCards[i].style.display = "none"; }
            }
            var grid = document.getElementById("seriesGrid");
            var noResults = document.getElementById("noResultsMsg");
            if (!hasResults && term.length > 0) {
                if (!noResults) {
                    var msg = document.createElement("div");
                    msg.id = "noResultsMsg";
                    msg.className = "no-results";
                    msg.innerHTML = '<i class="fas fa-search"></i> لا توجد نتائج';
                    grid.parentNode.insertBefore(msg, grid.nextSibling);
                }
            } else if (noResults) { noResults.remove(); }
        };
    }
    var prevBtn = document.getElementById("prevPageBtn");
    var nextBtn = document.getElementById("nextPageBtn");
    if (prevBtn) prevBtn.onclick = function() { if (currentPage > 1) { currentPage--; renderSeriesList(); } };
    if (nextBtn) nextBtn.onclick = function() { if (currentPage < totalPages) { currentPage++; renderSeriesList(); } };
    var unlockBtn = document.getElementById("homeUnlockBtn");
    if (unlockBtn) unlockBtn.onclick = function() { showPaymentModal(); };
    initTheme();
}

function renderHomePage() {
    currentView = "home";
    currentCategory = null;
    currentTranslation = null;
    currentPage = 1;
    
    if (!isBackNavigation) {
        pageHistoryStack = [];
        pushPageToHistory("home", {}, "عالم الدراما");
    }
    
    var gridHtml = "";
    for (var id in seriesDatabase) {
        gridHtml += createSeriesCard(seriesDatabase[id]);
    }
    var statusClass = isUnlocked ? "unlocked" : "";
    var statusText = isUnlocked ? "مفعل" : "اشتراك";
    var sidebarHtml = buildSidebarHtml();
    var html = '<div class="home-wrapper">' + sidebarHtml + '<div class="home-container"><div class="home-controls"><div class="home-menu-toggle" id="homeMenuToggle"><i class="fas fa-bars"></i></div><div class="user-status ' + statusClass + '" id="homeUnlockBtn"><i class="fas fa-crown"></i> <span>' + statusText + '</span></div><div class="home-theme-btn" id="homeThemeToggle"><i class="fas fa-moon"></i></div></div><div class="home-header" id="homeHeader"><h1><i class="fas fa-tv"></i> عالم الدراما</h1><p>جميع المسلسلات المترجمة والمدبلجة</p></div><div class="search-header"><i class="fas fa-search"></i><input type="text" id="homeSearchInput" placeholder="ابحث عن مسلسل..."></div><div class="series-grid" id="seriesGrid">' + gridHtml + '</div></div></div>';
    document.getElementById("app-root").innerHTML = html;
    setupSidebarEvents();
    var cards = document.querySelectorAll(".series-card");
    for (var i = 0; i < cards.length; i++) {
        cards[i].onclick = function() { var id = this.getAttribute("data-series-id"); var series = seriesDatabase[id]; if (series) showSeriesPage(series); };
    }
    var searchInput = document.getElementById("homeSearchInput");
    if (searchInput) {
        searchInput.oninput = function() {
            var term = this.value.trim().toLowerCase();
            var allCards = document.querySelectorAll(".series-card");
            var hasResults = false;
            for (var i = 0; i < allCards.length; i++) {
                var title = allCards[i].querySelector(".series-card-title").innerText.toLowerCase();
                if (title.includes(term)) { allCards[i].style.display = "flex"; hasResults = true; }
                else { allCards[i].style.display = "none"; }
            }
            var grid = document.getElementById("seriesGrid");
            var noResults = document.getElementById("noResultsMsg");
            if (!hasResults && term.length > 0) {
                if (!noResults) {
                    var msg = document.createElement("div");
                    msg.id = "noResultsMsg";
                    msg.className = "no-results";
                    msg.innerHTML = '<i class="fas fa-search"></i> لا توجد نتائج';
                    grid.parentNode.insertBefore(msg, grid.nextSibling);
                }
            } else if (noResults) { noResults.remove(); }
        };
    }
    var unlockBtn = document.getElementById("homeUnlockBtn");
    if (unlockBtn) unlockBtn.onclick = function() { showPaymentModal(); };
    initTheme();
}

// ==================== نظام السمة ====================
function initTheme() {
    var saved = localStorage.getItem("drama_theme");
    if (saved === "light") { document.body.classList.add("light-mode"); }
    else { document.body.classList.remove("light-mode"); }
    updateAllThemeButtons();
}

function updateAllThemeButtons() {
    var isLight = document.body.classList.contains("light-mode");
    var btns = document.querySelectorAll("#themeToggleBtn, #homeThemeToggle");
    for (var i = 0; i < btns.length; i++) {
        if (btns[i]) {
            btns[i].innerHTML = isLight ? '<i class="fas fa-sun"></i>' : '<i class="fas fa-moon"></i>';
            btns[i].onclick = function(e) {
                e.preventDefault();
                if (document.body.classList.contains("light-mode")) {
                    document.body.classList.remove("light-mode");
                    localStorage.setItem("drama_theme", "dark");
                } else {
                    document.body.classList.add("light-mode");
                    localStorage.setItem("drama_theme", "light");
                }
                updateAllThemeButtons();
            };
        }
    }
}

// ==================== دالة Toast ====================
function showToastMessage(message) {
    var existingToast = document.querySelector(".toast");
    if (existingToast) existingToast.remove();
    
    var toast = document.createElement("div");
    toast.className = "toast";
    toast.innerText = message;
    document.body.appendChild(toast);
    
    setTimeout(function() {
        if (toast.parentNode) toast.remove();
    }, 3000);
}

// ==================== الحماية ====================
document.addEventListener('contextmenu', function(e) { e.preventDefault(); return false; });
document.addEventListener('selectstart', function(e) {
    var tag = e.target.tagName;
    if (tag !== 'INPUT' && tag !== 'TEXTAREA') { e.preventDefault(); return false; }
});
document.addEventListener('keydown', function(e) {
    if (e.key === 'F12' || e.keyCode === 123) { e.preventDefault(); return false; }
    if (e.ctrlKey && e.shiftKey && (e.key === 'I' || e.key === 'i' || e.key === 'J' || e.key === 'j' || e.key === 'C' || e.key === 'c')) { e.preventDefault(); return false; }
    if (e.ctrlKey && (e.key === 'U' || e.key === 'u')) { e.preventDefault(); return false; }
    if (e.ctrlKey && (e.key === 'S' || e.key === 's')) { e.preventDefault(); return false; }
}, true);

// ==================== التهيئة ====================
async function init() {
    await fetchSeriesList();
    await checkStoredKey();
    renderHomePage();
}
init();
