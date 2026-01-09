// Hàm gọi Google Apps Script API
const google.script.run = {
  withSuccessHandler: function(successCallback) {
    this.successCallback = successCallback;
    return this;
  },
  withFailureHandler: function(failureCallback) {
    this.failureCallback = failureCallback;
    return this;
  }
};

// Tạo wrapper cho mỗi function
function createAPICall(functionName) {
  return function(...params) {
    return {
      withSuccessHandler: function(successCallback) {
        this.successCallback = successCallback;
        return this;
      },
      withFailureHandler: function(failureCallback) {
        this.failureCallback = failureCallback;
        
        // Execute API call
        const executeCall = async () => {
          try {
            const response = await fetch(API_URL, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
              },
              body: JSON.stringify({
                function: functionName,
                parameters: params.length === 1 ? params[0] : params
              }),
              mode: 'cors',
              credentials: 'include'
            });
            
            const result = await response.json();
            
            if (result.success) {
              if (this.successCallback) {
                this.successCallback(result.data);
              }
            } else {
              if (this.failureCallback) {
                this.failureCallback(new Error(result.error));
              }
            }
          } catch (error) {
            if (this.failureCallback) {
              this.failureCallback(error);
            }
          }
        };
        
        executeCall();
        return this;
      }
    };
  };
}

// Map tất cả các function cần gọi
const api = {
  getNhanVienList: createAPICall('getNhanVienList'),
  getNhanVienListByLang: createAPICall('getNhanVienListByLang'),
  getEvaluatedEmployees: createAPICall('getEvaluatedEmployees'),
  getDraftEmployees: createAPICall('getDraftEmployees'),
  getCauHoiTheoNhanVienByLang: createAPICall('getCauHoiTheoNhanVienByLang'),
  submitDanhGia: createAPICall('submitDanhGia'),
  saveDraft: createAPICall('saveDraft'),
  getDraft: createAPICall('getDraft'),
  deleteDraft: createAPICall('deleteDraft'),
  getEvaluatedEmployeesDetail: createAPICall('getEvaluatedEmployeesDetail'),
  getAllEmployeesDetail: createAPICall('getAllEmployeesDetail'),
  getRemainingEmployeesDetail: createAPICall('getRemainingEmployeesDetail'),
  getEvaluationResult: createAPICall('getEvaluationResult'),
  getNhanVienInfoByLang: createAPICall('getNhanVienInfoByLang'),
  getCauHoiConfigDataForUI: createAPICall('getCauHoiConfigDataForUI'),
  saveCauHoiConfigByRole: createAPICall('saveCauHoiConfigByRole'),
  getAllEmployeesForAdmin: createAPICall('getAllEmployeesForAdmin'),
  updateEvaluators: createAPICall('updateEvaluators'),
  submitFeedback: createAPICall('submitFeedback')
};

// Gắn vào google.script.run để giữ nguyên cú pháp gốc
if (typeof google === 'undefined') {
  window.google = {};
}
if (typeof google.script === 'undefined') {
  google.script = {};
}
google.script.run = api;

  let groupedData = {};
  let isSearchPopupOpen = false;
  let isInAdminMode = false;
  let evaluatedEmployees = new Set();
  let draftEmployees = new Set();
  let cachedUserInfo = null;
  let cachedUserInfoLang = null;

function isEmployeeExpired(employee) {
  if (!employee.hanDanhGia) return false;
  
  try {
    const deadline = new Date(employee.hanDanhGia);
    deadline.setHours(23, 59, 59, 999);
    
    const now = new Date();
    return now > deadline;
  } catch (e) {
    console.error('❌ Lỗi kiểm tra hạn:', e);
    return false;
  }
}

  let currentUser = null;
  let isAdmin = false;
  const webAppUrl = "<?!= config.webAppUrl ?>";
  try {
    currentUser = <?!= JSON.stringify(config.currentUser) ?>;
    isAdmin = <?!= config.isAdmin || false ?>;
    console.log('🔧 Khởi tạo currentUser:', currentUser);
    console.log('🔧 isAdmin:', isAdmin);
  } catch (error) {
    console.error('❌ Lỗi khởi tạo currentUser:', error);
    currentUser = null;
    isAdmin = false; 
  }

  function toggleCompetency(element) {
    const arrow = element.querySelector('.competency-toggle');
    const content = element.nextElementSibling;
    
    if (content && content.classList.contains('competency-content')) {
      const isCollapsed = content.style.display === 'none';
      
      if (isCollapsed) {
        // Mở ra
        content.style.display = 'block';
        content.style.maxHeight = '10000px';
        content.style.opacity = '1';
        arrow.innerHTML = '▼';
        arrow.style.transform = 'rotate(0deg)';
      } else {
        // Đóng lại
        content.style.display = 'none';
        content.style.maxHeight = '0';
        content.style.opacity = '0';
        arrow.innerHTML = '▶';
        arrow.style.transform = 'rotate(-90deg)';
      }
    }
  }

  // Kiểm tra thông tin người dùng
  if (!currentUser || !currentUser.email) {
    document.getElementById('content').innerHTML = `
      <div style="text-align:center; padding:40px; background:white; border-radius:10px;">
        <h3 style="color:#dc3545;">⚠️ Không tìm thấy thông tin người dùng</h3>
        <p>Email của bạn không có trong hệ thống nhân viên.<br>Vui lòng liên hệ quản trị viên.</p>
        <p style="color:#999; font-size:13px; margin-top:20px;">
          Email đăng nhập: <code>${currentUser?.email || 'Không xác định'}</code>
        </p>
      </div>
    `;
  } else {
    document.getElementById('current-user-info').innerHTML = 
      `<b>${currentUser.ten}</b>`;
    
    // ✅ THÊM ĐOẠN NÀY: ẨN MỌI THỨ NẾU LÀ ADMIN
    if (isAdmin) {
      document.getElementById('progress-section').style.display = 'none';
      document.getElementById('searchContainer').style.display = 'none';
      document.getElementById('content').style.display = 'none';
    } else {
      // ✅ CHỈ ẨN VÀ LOAD DỮ LIỆU NẾU KHÔNG PHẢI ADMIN
      document.getElementById('progress-section').style.display = 'none';
      document.getElementById('searchContainer').style.display = 'none';
      
      // ✅ Hiển thị loading trong content
      document.getElementById('content').innerHTML = `
        <div style="text-align:center; padding:60px 20px;">
          <div class="spinner" style="margin:0 auto 20px;"></div>
          <p style="color:#666; font-size:16px;">⏳ Đang tải dữ liệu...</p>
        </div>
      `;
      
      // Load dữ liệu nhân viên
      google.script.run.withSuccessHandler(data => {
        groupedData = data;
        
        let evaluatedLoaded = false;
        let draftLoaded = false;
        
        google.script.run.withSuccessHandler(list => {
          evaluatedEmployees = new Set(list.map(id => String(id).trim()));
          evaluatedLoaded = true;
          
          if (evaluatedLoaded && draftLoaded) {
            showProgressAndContent();
          }
        }).getEvaluatedEmployees(currentUser);
        
        google.script.run.withSuccessHandler(drafts => {
          draftEmployees = new Set(drafts.map(e => e.id));
          draftLoaded = true;
          
          if (evaluatedLoaded && draftLoaded) {
            showProgressAndContent();
          }
        }).getDraftEmployees(currentUser, currentLang);
      }).getNhanVienList(currentUser);
    }
  }

  function showProgressAndContent() {
    // ✅ KIỂM TRA FLAG
    if (isInAdminMode) {
      console.log('🚫 isInAdminMode = true, bỏ qua hiển thị progress');
      return;
    }
    
    // Render departments
    renderDepartments();
    
    // Update progress
    updateProgress();
    
    // Hiện progress section và search
    document.getElementById('progress-section').style.display = 'block';
    document.getElementById('searchContainer').style.display = 'block';
  }

  // 🌐 === ĐA NGÔN NGỮ - PHẢI KHAI BÁO TRƯỚC KHI DÙNG ===
  let currentLang = localStorage.getItem('lang') || 'vi';

  const translations = {
    vi: {
      title: "HỆ THỐNG ĐÁNH GIÁ NHÂN SỰ 360°",
      menuConfig: "Cấu hình câu hỏi",
      userInfo: "Thông tin cá nhân",
      progressTitle: "Tiến độ đánh giá",
      total: "Tổng nhân viên (Click để xem)",
      evaluated: "Đã đánh giá (Click để xem)",
      remaining: "Chưa đánh giá (Click để xem)",
      draft: "Đánh giá tiếp (Click để xem)",
      departmentListTitle: "DANH SÁCH ĐÁNH GIÁ",
      btnEvaluate: "Đánh giá",
      btnReview: "Đánh giá lại",
      btnContinue: "Đánh giá tiếp",
      btnSubmit: "Gửi đánh giá",
      btnSaveDraft: "Lưu nháp",
      btnCancel: "Hủy",
      btnClose: "Đóng",
      btnBack: "⬅ Quay lại danh sách",
      statusDone: "✔ Đã đánh giá",
      loading: "Đang tải dữ liệu...",
      loadingQuestions: "⏳ Đang tải câu hỏi...",
      processing: "Đang xử lý...",
      saveDraftSuccess: "Đã lưu nháp thành công",
      submitSuccess: "Đã gửi đánh giá cho",
      searchPlaceholder: "Tìm theo tên hoặc mã nhân viên...",
      lblEmployeeId: "Mã nhân viên",
      lblDepartment: "Cơ sở",
      lblDivision: "Bộ phận",
      lblPosition: "Chức vụ",
      lblEmail: "Email",
      thCriteria: "Tiêu chí đánh giá",
      ratingPoor: "Hoàn toàn không đồng ý",
      ratingWeak: "Không đồng ý",
      ratingAverage: "Trung lập",
      ratingGood: "Đồng ý",
      ratingExcellent: "Hoàn toàn đồng ý",
      errorIncomplete: "Vui lòng trả lời đầy đủ tất cả câu hỏi!",
      errorRemaining: "Còn {count} câu hỏi chưa được trả lời.",
      footer: "© 2025 Educo HR | Hệ thống đánh giá nhân sự 360°",
      badgeEvaluated: "Đã đánh giá",
      badgeDraft: "Đang đánh giá",
      badgePending: "Chưa đánh giá",
      evaluateTitle: "Đánh giá:",
      scdraft: "Đã tải bản nháp",
      draftFound: "Tìm thấy bản nháp đã lưu!",
      draftLastTime: "Lần cuối:",
      draftClear: "🗑️ Xóa nháp",
      loading: "⏳ Đang tải danh sách...",
      totalemp: "Danh sách tất cả nhân viên",
      evaluatedemp: "Danh sách nhân viên đã đánh giá",
      cont_eva: "Danh sách đánh giá tiếp",
      not_eval_emp: "Danh sách nhân viên chưa đánh giá",
      hint: "Gợi ý",
      clickToEvaluate: "Click vào tên nhân viên để đánh giá ngay",
      clickToContinue: "Click vào tên để tiếp tục đánh giá",
      clickToViewResult: "Click vào tên nhân viên để xem lại kết quả đánh giá",
      loadingEvaluation: "⏳ Đang tải kết quả đánh giá...",
      thEmployeeId: "Mã NV",
      thFullName: "Họ tên",
      thFacility: "Cơ sở",
      thDepartment: "Bộ phận",
      thPosition: "Chức danh",
      resultTitle: "📊 Kết quả đánh giá",
      infoEmployee: "Nhân viên",
      infoDepartment: "Cơ sở",
      infoDivision: "Bộ phận",
      infoPosition: "Chức vụ",
      infoDate: "Ngày đánh giá",
      thQuestion: "Câu hỏi",
      thAnswer: "Đánh giá",
      userInfo: "Thông tin cá nhân",
      noEmployeeFound: "Không tìm thấy nhân viên",
      noEvaluated: "Chưa có nhân viên nào được đánh giá",
      noData: "Không có dữ liệu.",
      noDraft: "Không có bản đánh giá nào đang lưu nháp",
      confirmDeleteDraft: "Xác nhận xóa nháp",
      confirmDeleteDraftMsg: "Bạn có chắc chắn muốn xóa bản nháp này?",
      confirmDeleteDraftNote: "Tất cả dữ liệu đã nhập sẽ bị mất.",
      btnDelete: "Xóa nháp",
      draftDeleted: "Đã xóa nháp",
      draftLoading: "Đang tải bản nháp...",
      draftLoadSuccess: "Đã tải bản nháp thành công!",
      draftLoadContinue: "Bạn có thể tiếp tục đánh giá từ nơi đã dừng lại.",
      pleaseWait: "Vui lòng đợi trong giây lát...",
      reviewDate: "Ngày đánh giá",
      menuDocumentation: "Tài liệu hướng dẫn",
      docTitle: "Tài liệu hướng dẫn",
      docSubtitle: "Chọn ngôn ngữ phù hợp với bạn",
      docVietnamese: "Tiếng Việt",
      docEnglish: "Tiếng Anh",
      docNote: "Lưu ý: Tài liệu sẽ mở trong tab mới. Bạn có thể tải về hoặc xem trực tuyến.",
      reportBtn: "Báo cáo tổng hợp",
      feedbackBtn: "Góp ý",
      feedbackTitle: "Góp ý về hệ thống",
      feedbackSubtitle: "Ý kiến của bạn sẽ giúp chúng tôi cải thiện hệ thống tốt hơn",
      feedbackGoodPoints: "Những điểm hiệu quả",
      feedbackGoodPointsPlaceholder: "Những gì bạn thấy tốt về hệ thống đánh giá này...",
      feedbackBadPoints: "Những điểm chưa hiệu quả",
      feedbackBadPointsPlaceholder: "Những gì bạn nghĩ cần được cải thiện...",
      feedbackSuggestions: "Đề xuất cải thiện",
      feedbackSuggestionsPlaceholder: "Ý kiến và đề xuất của bạn...",
      feedbackSubmit: "Gửi góp ý",
      feedbackCancel: "Hủy",
      feedbackSuccess: "Cảm ơn bạn đã góp ý!",
      feedbackError: "Có lỗi xảy ra khi gửi góp ý",
      feedbackRequired: "Vui lòng điền ít nhất một ý kiến",
      roleSelectionTitle: "Chọn vai trò của bạn",
      roleSelectionSubtitle: "Bạn có quyền truy cập đầy đủ hệ thống",
      roleAdmin: "Quản trị viên",
      roleAdminDesc: "Cấu hình hệ thống, quản lý câu hỏi",
      roleEvaluator: "Người đánh giá",
      roleEvaluatorDesc: "Đánh giá nhân viên theo phân công",
      expiredDeadline: "Đã hết hạn đánh giá",
      deadlineLabel: "Hạn",
      progressAnswered: "Câu đã trả lời"
    },
    en: {
      title: "360° HR EVALUATION SYSTEM",
      menuConfig: "Question Config",
      userInfo: "User Info",
      progressTitle: "Evaluation Progress",
      total: "Total Employees (Click to view)",
      evaluated: "Evaluated (Click to view)",
      remaining: "Not yet Evaluated (Click to view)",
      draft: "Continue Evaluations (Click to view)",
      departmentListTitle: "EVALUATION LIST",
      btnEvaluate: "Evaluate",
      btnReview: "Re-evaluate",
      btnContinue: "Continue",
      btnSubmit: "Submit Evaluation",
      btnSaveDraft: "Save Draft",
      btnCancel: "Cancel",
      btnClose: "Close",
      btnBack: "⬅ Back to List",
      statusDone: "✔ Evaluated",
      loading: "Loading data...",
      loadingQuestions: "⏳ Loading questions...",
      processing: "Processing...",
      saveDraftSuccess: "Draft saved successfully",
      submitSuccess: "Evaluation submitted for",
      searchPlaceholder: "Search by name or employee ID...",
      lblEmployeeId: "Employee ID",
      lblDepartment: "Facility",
      lblDivision: "Department",
      lblPosition: "Position",
      lblEmail: "Email",
      thCriteria: "Evaluation Criteria",
      ratingPoor: "Completely Disagree",
      ratingWeak: "Disagree",
      ratingAverage: "Neutral",
      ratingGood: "Agree",
      ratingExcellent: "Completely Agree",
      errorIncomplete: "Please answer all questions!",
      errorRemaining: "{count} questions remaining.",
      footer: "© 2025 Educo HR | 360° Employee Evaluation System",
      badgeEvaluated: "Evaluated",
      badgeDraft: "In Progress",
      badgePending: "Not Evaluated",
      evaluateTitle: "Evaluate:",
      scdraft: "Draft loaded",
      draftFound: "A saved draft was found!",
      draftLastTime: "Last saved:",
      draftClear: "🗑️ Delete draft",
      loading: "⏳ Loading list...",
      totalemp: "TOTAL EMPLOYEES LIST",
      evaluatedemp: "LIST OF EVALUATED EMPLOYEES",
      cont_eva: "LIST OF EMPLOYEES TO CONTINUE EVALUATING",
      not_eval_emp: "PENDING EMPLOYEE EVALUATIONS",
      hint: "Hint",
      clickToEvaluate: "Click on an employee name to start evaluating",
      clickToContinue: "Click a name to continue evaluating",
      clickToViewResult: "Click a name to view evaluation results",
      loadingEvaluation: "⏳ Loading evaluation result...",
      thEmployeeId: "ID",
      thFullName: "Full Name",
      thFacility: "Facility",
      thDepartment: "Department",
      thPosition: "Position",
      resultTitle: "📊 Evaluation Result",
      infoEmployee: "Employee",
      infoDepartment: "Facility",
      infoDivision: "Division",
      infoPosition: "Position",
      infoDate: "Evaluation Date",
      thQuestion: "Question",
      thAnswer: "Answer",
      userInfo: "User Info",
      noEmployeeFound: "No employee found",
      noEvaluated: "No employees have been evaluated yet",
      noData: "No data available.",
      noDraft: "No draft evaluations found",
      confirmDeleteDraft: "Confirm Delete Draft",
      confirmDeleteDraftMsg: "Are you sure you want to delete this draft?",
      confirmDeleteDraftNote: "All entered data will be lost.",
      btnDelete: "Delete Draft",
      draftDeleted: "Draft deleted",
      draftLoading: "Loading draft...",
      draftLoadSuccess: "Draft loaded successfully!",
      draftLoadContinue: "You can continue from where you left off.",
      pleaseWait: "Please wait a moment...",
      reviewDate: "Review Date",
      menuDocumentation: "Documentation",
      docTitle: "User Guide",
      docSubtitle: "Choose your preferred language",
      docVietnamese: "Vietnamese",
      docEnglish: "English",
      docNote: "Note: Documentation will open in a new tab. You can download or view online.",
      reportBtn: "Summary Report",
      feedbackBtn: "Feedback",
      feedbackTitle: "System Feedback",
      feedbackSubtitle: "Your feedback helps us improve the system",
      feedbackGoodPoints: "Effective Points",
      feedbackGoodPointsPlaceholder: "What you like about this evaluation system...",
      feedbackBadPoints: "Areas for Improvement",
      feedbackBadPointsPlaceholder: "What needs to be improved...",
      feedbackSuggestions: "Improvement Suggestions",
      feedbackSuggestionsPlaceholder: "Your ideas and suggestions...",
      feedbackSubmit: "Submit Feedback",
      feedbackCancel: "Cancel",
      feedbackSuccess: "Thank you for your feedback!",
      feedbackError: "An error occurred while submitting feedback",
      feedbackRequired: "Please provide at least one comment",
      roleSelectionTitle: "Select Your Role",
      roleSelectionSubtitle: "You have full system access",
      roleAdmin: "Administrator",
      roleAdminDesc: "System configuration, question management",
      roleEvaluator: "Evaluator",
      roleEvaluatorDesc: "Evaluate assigned employees",
      expiredDeadline: "Evaluation deadline has expired",
      deadlineLabel: "Deadline",
      progressAnswered: "Questions Answered"
    }
  };

  function t(key) {
    return translations[currentLang][key] || key;
  }

  function switchLanguage(lang) {
    if (lang !== 'vi' && lang !== 'en') return;
    currentLang = lang;
    localStorage.setItem('lang', lang);
    document.getElementById('flag-vi').classList.toggle('flag-active', lang === 'vi');
    document.getElementById('flag-en').classList.toggle('flag-active', lang === 'en');
    applyLanguage();
    reloadFast(lang);
    preloadUserInfoByLang(lang);
  }

  function reloadFast(lang) {
    showLoading();
    google.script.run
      .withSuccessHandler(data => {
        groupedData = data;      // chỉ thay groupedData
        renderDepartments();     // render lại danh sách
        hideLoading();
      })
      .withFailureHandler(err => {
        hideLoading();
        showToast("Load error: " + err.message, "error");
      })
      .getNhanVienListByLang(currentUser, lang);
  }

  function applyLanguage() {
    const headerTitle = document.querySelector('header h1');
    if (headerTitle) headerTitle.innerText = t('title');

    const dropdownItems = document.querySelectorAll('#dropdownMenu div');
    if (dropdownItems.length > 0) dropdownItems[0].innerText = t('userInfo');
    // if (dropdownItems.length > 1) dropdownItems[1].innerText = t('menuDocumentation');
    if (dropdownItems.length > 1) dropdownItems[1].innerText = t('menuConfig');

    const progressTitle = document.querySelector('#progress-section h3');
    if (progressTitle) progressTitle.innerText = t('progressTitle');

    const statLabels = document.querySelectorAll('.stat-label');
    if (statLabels[0]) statLabels[0].innerText = t('total');
    if (statLabels[1]) statLabels[1].innerText = t('evaluated');
    if (statLabels[2]) statLabels[2].innerText = t('draft');
    if (statLabels[3]) statLabels[3].innerText = t('remaining');

    const searchInput = document.getElementById('employeeSearch');
    if (searchInput) searchInput.placeholder = t('searchPlaceholder');

    const loadingText = document.getElementById('loadingText');
    if (loadingText) loadingText.innerText = t('processing');
    
    const footer = document.getElementById('footer');
    if (footer) footer.innerText = t('footer');
    
    const titleElement = document.getElementById('title');
    const evalPage = document.getElementById('evaluationPage');
    if (titleElement && evalPage && evalPage.style.display === 'none') {
      titleElement.innerText = t('departmentListTitle');
    }

    const contentDiv = document.getElementById('content');
    if (contentDiv && contentDiv.innerText.trim() !== '') {
        contentDiv.innerText = t('loading');
    }

    const btnBack1 = document.getElementById('btnBack1');
    if (btnBack1) btnBack1.innerText = t('btnBack');

    const fBack = document.getElementById('floatingBackBtn');
    if (fBack) fBack.title = t('btnBack');

    const btnCloseUserInfo = document.getElementById('btnCloseUserInfo');
    if (btnCloseUserInfo) btnCloseUserInfo.innerText = t('btnClose');

    const actionButtons = document.querySelectorAll('[data-i18n]');
    actionButtons.forEach(btn => {
      const key = btn.getAttribute('data-i18n');
      btn.innerText = t(key);
    });

    const docTitle = document.getElementById('doc-popup-title');
    if (docTitle) docTitle.innerText = t('docTitle');
    
    const docSubtitle = document.getElementById('doc-popup-subtitle');
    if (docSubtitle) docSubtitle.innerText = t('docSubtitle');
    
    const docNote = document.getElementById('doc-popup-note-content');
    if (docNote) docNote.innerHTML = t('docNote');

    const reportBtnText = document.getElementById('reportBtnText');
    if (reportBtnText) reportBtnText.innerText = t('reportBtn');

    const docBtnText = document.getElementById('docBtnText');
    if (docBtnText) docBtnText.innerText = t('menuDocumentation');

    const feedbackBtnText = document.getElementById('feedbackBtnText');
    if (feedbackBtnText) feedbackBtnText.innerText = t('feedbackBtn');

    const progressLabel = document.getElementById('progressLabel');
    if (progressLabel) progressLabel.innerText = t('progressAnswered');
  }

  function reloadDataWithLanguage(lang) {
    showLoading();
    google.script.run
      .withSuccessHandler(data => {
        groupedData = data;
        google.script.run
          .withSuccessHandler(list => {
            evaluatedEmployees = new Set(list.map(id => String(id).trim()));
            google.script.run
              .withSuccessHandler(drafts => {
                draftEmployees = new Set(drafts.map(e => e.id));
                renderDepartments();
                updateProgress();
                hideLoading();
              })
              .getDraftEmployees(currentUser,currentLang);
          })
          .getEvaluatedEmployees(currentUser);
      })
      .withFailureHandler(err => {
        hideLoading();
        showToast(t('errorLoadData') + ': ' + err.message, 'error');
      })
      .getNhanVienListByLang(currentUser, lang);
  }

  function preloadUserInfoByLang(lang) {
    if (cachedUserInfo && cachedUserInfoLang === lang) return;
    google.script.run
      .withSuccessHandler(u => {
        cachedUserInfo = u;
        cachedUserInfoLang = lang;
      })
      .withFailureHandler(() => {
        cachedUserInfo = currentUser;    // fallback
        cachedUserInfoLang = lang;
      })
      .getNhanVienInfoByLang(currentUser.id, lang);
  }

      // Load danh sách nhân viên đã được đánh giá
      function loadEvaluatedList() {
        document.getElementById("searchContainer").style.display = "block";
        console.log('🔄 Bắt đầu tải danh sách đánh giá...');
        google.script.run
          .withSuccessHandler(list => {
            evaluatedEmployees = new Set(list.map(id => String(id).trim()));
            let allIds = [];
            Object.values(groupedData).forEach(pb => {
              Object.values(pb).forEach(nvList => {
                nvList.forEach(nv => allIds.push(String(nv.id).trim()));
              });
            });
            
            renderDepartments();
                google.script.run
        .withSuccessHandler(list => {
          draftEmployees = new Set(list.map(e => e.id));
          updateProgress(); 
        })
        .getDraftEmployees(currentUser,currentLang);
            updateProgress();
          })
          .withFailureHandler(err => {
            console.error('❌ Lỗi khi tải danh sách đánh giá:', err);
            renderDepartments();
            updateProgress();
          })
          .getEvaluatedEmployees(currentUser);
      }

  // Cập nhật thanh tiến độ
  function updateProgress() {
    if (isInAdminMode) {
      return;
    }
    let total = 0;
    let evaluated = 0;
    let draft = 0;
    
    Object.values(groupedData).forEach(pb => {
      Object.values(pb).forEach(nvList => {
        total += nvList.length;
        nvList.forEach(nv => {
          const nvId = String(nv.id);
          if (evaluatedEmployees.has(nvId)) {
            evaluated++;
          } else if (draftEmployees.has(nvId)) {
            draft++;
          }
        });
      });
    });

    const remaining = total - evaluated - draft;
    
    // ✅ CHỈ TÍNH PHẦN TRĂM DỰA TRÊN ĐÃ ĐÁNH GIÁ / TỔNG
    const percentageExact = total > 0 ? (evaluated / total) * 100 : 0;
    let percentageDisplay = percentageExact.toFixed(1);

    document.getElementById('stat-total').textContent = total;
    document.getElementById('stat-evaluated').textContent = evaluated;
    document.getElementById('stat-draft').textContent = draft;
    document.getElementById('stat-remaining').textContent = remaining;
    
    // ✅ Thanh progress bar chỉ hiển thị % đã đánh giá hoàn tất
    document.getElementById('progress-bar').style.width = Math.min(percentageExact, 100) + '%';
    document.getElementById('progress-bar').textContent = percentageDisplay + '%';
    document.getElementById('progress-section').style.display = 'block';
  }

  <!-- SHOW DANH SÁCH ĐÃ ĐÁNH GIÁ -->
  function showEvaluatedList() {
    const popup = document.getElementById('popup');
    const content = document.getElementById('popup-content');
    popup.style.display = 'flex';

  content.innerHTML = `
    <div style="padding:40px 20px; text-align:center; font-size:16px;">
      <div class="spinner" style="margin:auto;"></div>
      <p style="margin-top:12px;">${t("loading")}</p>
    </div>
  `;

    google.script.run
      .withSuccessHandler(list => {

        content.innerHTML = `
          <div class="popup-header">
            <h3>${t("evaluatedemp")} (${list.length})</h3>
            <button class="popup-close" onclick="closePopup()">
              <svg viewBox="0 0 24 24">
                <path d="M6 6 L18 18 M18 6 L6 18"
                  stroke="currentColor"
                  stroke-width="3"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  fill="none"/>
              </svg>
            </button>
          </div>

          <div class="popup-body-scroll">
            ${
              list.length === 0
              ? `
                <p style="text-align:center; color:#666; padding:20px;">
                  ${t('noEvaluated')}
                </p>
              `
              : `
                <div style="background:#e8f5e9; border:1px solid #4caf50; border-radius:8px; padding:12px; margin-bottom:15px;">
                  <p style="margin:0; color:#2e7d32; font-size:14px;">
                    👁️ <b>${t("hint")}:</b> ${t("clickToViewResult")}
                  </p>
                </div>

                <table class="evaluated-list-table">
                  <thead>
                    <tr>
                      <th style="width:10%;">${t("thEmployeeId")}</th>
                      <th style="width:20%;">${t("thFullName")}</th>
                      <th style="width:25%;">${t("thFacility")}</th>
                      <th style="width:25%;">${t("thDepartment")}</th>
                      <th style="width:20%;">${t("thPosition")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    ${list.map(nv => `
                      <tr style="cursor:pointer;"
                          onclick="viewEvaluationResult('${nv.id}', '${nv.ten.replace(/'/g, "\\'")}')">
                        <td>${nv.id}</td>
                        <td><b>${nv.ten}</b></td>
                        <td>${nv.phongban}</td>
                        <td>${nv.bophan}</td>
                        <td>${nv.chucvu}</td>
                      </tr>
                    `).join('')}
                  </tbody>
                </table>
              `
            }
          </div>
        `;
      })

      .withFailureHandler(err => {
        content.innerHTML = `
          <div class="popup-header">
            <h3 style="color:#dc3545;">❌ Lỗi</h3>
            <button class="popup-close" onclick="closePopup()">×</button>
          </div>

          <div class="popup-body-scroll" style="padding:15px;">
            <p style="color:#666;">Không thể tải danh sách: ${err.message}</p>
          </div>
        `;
      })

      .getEvaluatedEmployeesDetail(currentUser, currentLang);
  }

  <!-- DANH SÁCH TỔNG NHÂN VIÊN -->
  function showAllEmployeesList() {
    const popup = document.getElementById('popup');
    const content = document.getElementById('popup-content');
    popup.style.display = 'flex';

    content.innerHTML = `
      <div style="
        padding:40px 20px;
        text-align:center;
        font-size:16px;
      ">
        <div class="spinner" style="margin:auto;"></div>
        <p style="margin-top:12px;">${t("loading")}</p>
      </div>
    `;

    google.script.run
      .withSuccessHandler(list => {
        content.innerHTML = `
          <div class="popup-header">
            <h3>${t("totalemp")} (${list.length})</h3>
            <button class="popup-close" onclick="closePopup()">
              <svg viewBox="0 0 24 24">
                <path d="M6 6 L18 18 M18 6 L6 18"
                  stroke="currentColor"
                  stroke-width="3"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  fill="none"/>
            </svg>
            </button>
          </div>
          <div class="popup-body-scroll">
            <table class="evaluated-list-table">
              <thead>
                <tr>
                  <th style="width:10%;">${t("thEmployeeId")}</th>
                  <th style="width:20%;">${t("thFullName")}</th>
                  <th style="width:25%;">${t("thFacility")}</th>
                  <th style="width:25%;">${t("thDepartment")}</th>
                  <th style="width:20%;">${t("thPosition")}</th>
                </tr>
              </thead>
              <tbody>
                ${list.map(nv => `
                  <tr>
                    <td>${nv.id}</td>
                    <td><b>${nv.ten}</b></td>
                    <td>${nv.phongban}</td>
                    <td>${nv.bophan}</td>
                    <td>${nv.chucvu}</td>
                  </tr>
                `).join('')}
              </tbody>
            </table>
          </div>

          <!-- FOOTER (để dạng comment theo yêu cầu) -->
          <!--
          <div class="popup-footer">
            <button onclick="closePopup()">${t('btnClose')}</button>
          </div>
          -->
        `;
      })

      .withFailureHandler(err => {
        content.innerHTML = `
          <div class="popup-header">
            <h3 style="color:#dc3545;">❌ Lỗi</h3>
            <button class="popup-close" onclick="closePopup()">×</button>
          </div>

          <div class="popup-body-scroll" style="padding:15px;">
            <p style="color:#666;">Không thể tải danh sách: ${err.message}</p>
          </div>

          <!--
          <div class="popup-footer">
            <button onclick="closePopup()">${t('btnClose')}</button>
          </div>
          -->
        `;
      })
      .getAllEmployeesDetail(currentUser, currentLang);
  }

  function renderDepartments() {
    const container = document.getElementById('content');
    document.getElementById('title').innerText = t('departmentListTitle');

    container.innerHTML = Object.keys(groupedData).map(pb => `
      <div class="dept-item" style="border:1px solid #cfe5ff; border-radius:8px; margin-bottom:10px;">
        <div class="dept-header" onclick="toggleDepartment('${pb}')" 
            style="cursor:pointer; padding:15px; background:#f7faff; display:flex;border-radius:8px; justify-content:space-between; align-items:center;">
          <strong style="color:#0078d7; font-size:17px;">
            ${pb} (${Object.values(groupedData[pb]).reduce((t, arr) => t + arr.length, 0)})
          </strong>
          <span id="arrow-${pb}" style="font-size:18px; color:#0078d7;">▶</span>
        </div>
        <div id="dept-body-${pb}" style="display:none; padding:15px; background:white;"></div>
      </div>
    `).join('');
  }

  function renderPositions(pb) {
    renderEmployees(pb);
  }

  function toggleDepartment(pb) {
    const body = document.getElementById(`dept-body-${pb}`);
    const arrow = document.getElementById(`arrow-${pb}`);

    if (body.style.display === "none") {
      body.style.display = "block";
      arrow.innerText = "▼";
      renderEmployees(pb);
    } else {
      body.style.display = "none";
      arrow.innerText = "▶";
    }
  }

function renderEmployees(pb) {
  let nvList = [];

  Object.keys(groupedData[pb]).forEach(cv => {
    groupedData[pb][cv].forEach(nv => {
      nv.chucvu = cv;
      nvList.push(nv);
    });
  });

  const container = document.getElementById(`dept-body-${pb}`);

  // ✅ Render
  container.innerHTML = nvList.map(nv => {
    const isEvaluated = evaluatedEmployees.has(String(nv.id));
    const avatarUrl = nv.avatar || 'https://cdn-icons-png.flaticon.com/512/847/847969.png';
    const btnId = `btn-${nv.id}`;
    const isDraft = !isEvaluated && draftEmployees.has(String(nv.id));
    
    // ✅ KIỂM TRA HẾT HẠN (CHÍNH XÁC HƠN)
    const isExpired = isEmployeeExpired(nv);
    
    // ✅ ẨN NÚT NẾU QUÁ HẠN (kể cả đã đánh giá)
    const btnDisabled = isExpired ? 'disabled' : '';
    const btnStyle = isExpired 
      ? 'opacity:0.5; cursor:not-allowed; pointer-events:none;' 
      : '';
    
    return `
    <div class="employee-card-upgrade" style="margin-bottom:10px;" data-employee-id="${nv.id}">
      <img src="${avatarUrl}" class="employee-avatar">
      <div class="employee-details">
        <h3 class="employee-name-main">
          ${nv.ten} 
          ${isEvaluated ? `<span class="badge-evaluated">${t('statusDone')}</span>` : ''}
        </h3>
        <div style="font-size:14px; color:#555; margin-top:2px;">🆔 ${nv.id}</div>         
        <div style="font-size:14px; color:#555; margin-top:2px;">💼 ${nv.chucvu}</div>
        <div style="font-size:14px; color:#555; margin-top:2px;">📧 ${nv.email || 'Chưa có email'}</div>
        
        ${isExpired ? `
          <div style="
            font-size:13px; 
            color:#dc3545; 
            margin-top:6px; 
            font-weight:600;
            background:#ffe6e6;
            padding:4px 8px;
            border-radius:4px;
            display:inline-block;
          ">
            ⏰ ${t('expiredDeadline')}
          </div>
        ` : (nv.hanDanhGia ? `
          <div style="font-size:13px; color:#666; margin-top:2px;">
            ⏰ ${t('deadlineLabel')}: ${new Date(nv.hanDanhGia).toLocaleDateString(currentLang === 'vi' ? 'vi-VN' : 'en-US')}
          </div>
        ` : '')}
      </div>

      <button class="evaluate-btn-upgrade 
        ${isEvaluated ? 'review-again' : (isDraft ? 'continue-draft' : '')}"
        id="${btnId}"
        ${btnDisabled}
        style="${btnStyle}"
        onclick="openPopup('${nv.id}','${nv.ten}','${avatarUrl}')">

        ${isExpired ? '🔒 ' : ''}
        ${isEvaluated ? t('btnReview') : (isDraft ? t('btnContinue') : t('btnEvaluate'))}

      </button>
    </div>
  `;
  }).join('');
}

  // === MỞ TRANG ĐÁNH GIÁ FULL MÀN HÌNH ===
  function openPopup(id,ten,avatarUrl) {
    const titleElement = document.getElementById('title');
    titleElement.innerText = `${t('evaluateTitle')} ${ten}`;
    titleElement.style.position = 'sticky';
    titleElement.style.top = '0';
    titleElement.style.zIndex = '999';
    titleElement.style.background = 'none';
    titleElement.style.padding = '0px 10px';
    titleElement.style.margin = '0';
    // titleElement.style.boxShadow = '0 2px 8px rgba(0,0,0,0.1)';
    window.scrollTo({ top: 0, behavior: 'smooth' });
    // Ẩn nội dung khác
    document.getElementById("searchContainer").style.display = "none";
    document.getElementById("progress-section").style.display = "none";
    document.getElementById("content").style.display = "none";
    document.getElementById("evaluationPage").style.display = "block";
    document.getElementById("evaluationHeaderWrapper").style.display = "block";

    const evalHeader = document.getElementById("evaluationHeader");
    document.getElementById("employeeAvatar").src = avatarUrl || 'https://cdn-icons-png.flaticon.com/512/847/847969.png';
    document.getElementById("employeeName").innerText = ten;
    
    // Load thông tin nhân viên theo ngôn ngữ
    google.script.run
      .withSuccessHandler(nvInfo => {
        if (nvInfo) {
          document.getElementById("employeeInfo").innerHTML = `
            ${t('lblEmployeeId')}: <b>${nvInfo.id}</b><br>          
            ${t('lblDepartment')}: <b>${nvInfo.phongban}</b><br>
            ${t('lblDivision')}: <b>${nvInfo.bophan}</b><br>
            ${t('lblPosition')}: <b>${nvInfo.chucvu}</b>
          `;
        } else {
          // Fallback nếu không tìm thấy
          document.getElementById("employeeInfo").innerHTML = `
            ${t('lblEmployeeId')}: <b>${currentUser.id}</b><br>          
            ${t('lblDepartment')}: <b>${currentUser.phongban}</b><br>
            ${t('lblDivision')}: <b>${currentUser.bophan}</b><br>
            ${t('lblPosition')}: <b>${currentUser.chucvu}</b>
          `;
        }
      })
      .getNhanVienInfoByLang(id, currentLang);

    const container = document.getElementById("evaluationContent");
    container.innerHTML = `<p style="text-align:center;">${t('loadingQuestions')}</p>`;

    // Gọi câu hỏi từ sheet
    google.script.run
      .withSuccessHandler(cauHoiData => {
      // ✅ Kiểm tra nếu không có câu hỏi nào
      if (!cauHoiData || Object.keys(cauHoiData).length === 0) {
        container.innerHTML = `
          <div style="
            text-align:center; 
            padding:60px 40px; 
            background:white; 
            border-radius:10px;
            box-shadow: 0 2px 8px rgba(0,0,0,0.1);
          ">
            <div style="font-size:80px; margin-bottom:20px;">📋</div>
            <h2 style="color:#ff9800; margin-bottom:15px;">
              ${currentLang === 'vi' ? 'Không có câu hỏi đánh giá' : 'No Evaluation Questions'}
            </h2>
            <p style="color:#666; font-size:16px; line-height:1.6; max-width:500px; margin:0 auto 30px;">
              ${currentLang === 'vi' 
                ? `Chức danh này chưa được cấu hình câu hỏi đánh giá.<br>Vui lòng liên hệ quản trị viên để được hỗ trợ.`
                : `This position has not been configured with evaluation questions.<br>Please contact the administrator for assistance.`
              }
            </p>
            <button onclick="closeEvaluationPage()" class="back-btn" style="
              font-family: inherit;
              margin-top:10px;
              padding:12px 30px;
              font-size:16px;
            ">
              ${currentLang === 'vi' ? '⬅ Quay lại danh sách' : '⬅ Back to List'}
            </button>
          </div>
        `;
        return;
      }
        let html = `<form id="dgForm" data-nhan-vien-id="${id}" novalidate>`;

        // ✅ BƯỚC 1: Phân loại câu hỏi - TEXT cuối cùng, còn lại giữ nguyên thứ tự
        const scaleQuestions = [];
        const textQuestions = [];

        Object.keys(cauHoiData).forEach((nangLuc, nlIndex) => {
          Object.keys(cauHoiData[nangLuc]).forEach(nangLucCon => {
            const questions = cauHoiData[nangLuc][nangLucCon];
            
            questions.forEach(q => {
              const item = {
                nangLuc: nangLuc,
                nangLucCon: nangLucCon,
                question: q,
                nlIndex: nlIndex,
                thuTu: q.thuTu || 999999
              };
              
              if (q.loai === "text") {
                textQuestions.push(item);
              } else {
                scaleQuestions.push(item);
              }
            });
          });
        });

        // ✅ Sắp xếp scale theo thứ tự gốc, text giữ nguyên
        scaleQuestions.sort((a, b) => a.thuTu - b.thuTu);
        textQuestions.sort((a, b) => a.thuTu - b.thuTu);

        // ✅ BƯỚC 2: Render Scale questions trước
        let currentNangLuc = null;
        let currentNangLucCon = null;
        let tableOpened = false;

        scaleQuestions.forEach((item) => {
          const { nangLuc, nangLucCon, question, nlIndex } = item;
          const gradientClass = `gradient-${(nlIndex % 4) + 1}`;

          // 🔹 Header năng lực mới
          if (currentNangLuc !== nangLuc) {
            // Đóng năng lực cũ nếu có
            if (currentNangLuc !== null) {
              if (tableOpened) {
                html += `</tbody></table>`;
                tableOpened = false;
              }
              html += `</div></div>`; // đóng competency-content và wrapper
            }

            html += `
              <div style="margin-top: 40px;">
                <div class="competency-header-table ${gradientClass}" onclick="toggleCompetency(this)">
                  <div style="display:flex; align-items:center; gap:12px;">
                    <span style="font-size:26px;">🏆</span>
                    <span>${nangLuc}</span>
                  </div>
                  <span class="competency-toggle">▼</span>
                </div>
                <div class="competency-content">
            `;

            currentNangLuc = nangLuc;
            currentNangLucCon = null;
          }

          // 🔹 Mở bảng nếu chưa mở
          if (!tableOpened) {
            html += `
              <table class="evaluation-table">
                <colgroup>
                  <col class="col-criteria">
                  <col class="col-rating">
                  <col class="col-rating">
                  <col class="col-rating">
                  <col class="col-rating">
                  <col class="col-rating">
                  <col class="col-rating">
                </colgroup>
                <thead>
                  <tr>
                    <th>${t('thCriteria')}</th>
                    <th>${t('ratingPoor')}<br>(1)</th>
                    <th>${t('ratingWeak')}<br>(2)</th>
                    <th>${t('ratingAverage')}<br>(3)</th>
                    <th>${t('ratingGood')}<br>(4)</th>
                    <th>${t('ratingExcellent')}<br>(5)</th>
                    <th>N/A</th>
                  </tr>
                </thead>
                <tbody>
            `;
            tableOpened = true;
          }


          // 🔹 Năng lực con
          if (currentNangLucCon !== nangLucCon) {
            html += `
              <tr class="sub-competency-row">
                <td colspan="7">
                  <span class="sub-competency-badge">${nangLucCon}</span>
                </td>
              </tr>
            `;
            currentNangLucCon = nangLucCon;
          }

          // 🔹 Render câu hỏi scale
          html += `
            <tr data-question-id="${question.id}" data-type="scale">
              <td>${question.noidung}</td>
              ${[1,2,3,4,5].map(v => `
                <td>
                  <div class="table-rating-option">
                    <input type="radio" name="${question.id}" value="${v}" id="${question.id}_${v}">
                    <label for="${question.id}_${v}">${v}</label>
                  </div>
                </td>
              `).join('')}
              <td>
                <div class="table-rating-option na-option">
                  <input type="radio" name="${question.id}" value="N/A" id="${question.id}_na">
                  <label for="${question.id}_na">N/A</label>
                </div>
              </td>
            </tr>
          `;
        });

        // ✅ Đóng năng lực cuối của scale questions
        if (currentNangLuc !== null) {
          if (tableOpened) {
            html += `</tbody></table>`;
            tableOpened = false;
          }
          html += `</div></div>`;
        }

        // ✅ BƯỚC 3: Render Text questions (luôn ở cuối)
        if (textQuestions.length > 0) {
          currentNangLuc = null;
          currentNangLucCon = null;

          textQuestions.forEach((item) => {
            const { nangLuc, nangLucCon, question, nlIndex } = item;
            const gradientClass = `gradient-${(nlIndex % 4) + 1}`;

            // Header năng lực
            if (currentNangLuc !== nangLuc) {
              // Đóng năng lực cũ nếu có
              if (currentNangLuc !== null) {
                html += `</div></div>`; // đóng competency-content và wrapper cũ
              }
              
              html += `
                <div style="margin-top: 40px;">
                  <div class="competency-header-table ${gradientClass}" onclick="toggleCompetency(this)">
                    <div style="display:flex; align-items:center; gap:12px;">
                      <span style="font-size:26px;">🏆</span>
                      <span>${nangLuc}</span>
                    </div>
                    <span class="competency-toggle">▼</span>
                  </div>
                  <div class="competency-content">
              `;
              currentNangLuc = nangLuc;
              currentNangLucCon = null;
            }

            // Năng lực con
            if (currentNangLucCon !== nangLucCon) {
              html += `
                <div class="sub-competency-title">${nangLucCon}</div>
              `;
              currentNangLucCon = nangLucCon;
            }

            // Render text question
            html += `
              <div class="text-question-block" data-question-id="${question.id}" data-type="text">
                <div class="text-question-title">${question.noidung}</div>
                <textarea name="${question.id}" class="text-answer-table" placeholder="Nhập câu trả lời..." required></textarea>
              </div>
            `;
          });
          
          // Đóng năng lực cuối cùng của text questions
          if (currentNangLuc !== null) {
            html += `</div></div>`;
          }
        }

        html += `
          <div id="draft-info"></div>
          <div class="draft-actions">
            <button type="button" class="btn-save-draft" onclick="saveDraftData()">
              ${t('btnSaveDraft')}
            </button>
            <button type="submit" style="font-size:15px; padding:10px 20px;">
              ${t('btnSubmit')}
            </button>
            <button type="button" class="back-btn" style="font-size:15px;" onclick="closeEvaluationPage()">
              ${t('btnCancel')}
            </button>
          </div>
        </form>`;

        container.innerHTML = html;
        initAnswerProgress();
        const form = document.getElementById('dgForm');
        if (form) {
          form.addEventListener('change', updateAnswerProgress);
          form.addEventListener('input', updateAnswerProgress);
        }
        const isDraft = draftEmployees.has(String(id));
        if (isDraft) {
          showDraftLoadingIndicator();
        }
        loadDraft(id);
        const isEvaluated = evaluatedEmployees.has(String(id));
        console.log('🔍 Checking evaluation status:', {
          id: id,
          isEvaluated: isEvaluated,
          evaluatedEmployees: Array.from(evaluatedEmployees)
        });

        if (isEvaluated) {
          console.log('✅ Đã đánh giá, sẽ load kết quả để chỉnh sửa');
          loadEvaluationForEdit(id);
        } else {
          console.log('📝 Chưa đánh giá, sẽ load draft nếu có');
        }
        // Gửi form - dùng addEventListener để chắc chắn gắn
        const dgForm = document.getElementById("dgForm");

        dgForm.addEventListener('submit', function(e) {
          e.preventDefault();

          const form = e.target;
          // ✅ Thu thập câu hỏi theo đúng thứ tự hiển thị trong DOM
          const allQuestions = [];

          form.querySelectorAll("[data-question-id]").forEach(block => {
            allQuestions.push({
              name: block.getAttribute("data-question-id"),
              type: block.dataset.type,
              element: block
            });
          });

          // Tìm câu chưa trả lời
          const unanswered = [];
          allQuestions.forEach(q => {
            if (q.type === 'scale') {
              const checked = form.querySelector(`input[name="${q.name}"]:checked`);
              if (!checked) unanswered.push(q);
            } else {
              const ta = form.querySelector(`textarea[name="${q.name}"]`);
              if (!ta || !ta.value.trim()) unanswered.push(q);
            }
          });

          console.log('DEBUG: total questions:', allQuestions.length, 'unanswered:', unanswered.length);

          if (unanswered.length > 0) {
            // Xóa error cũ
            document.querySelectorAll('.error-message').forEach(el => el.remove());
            document.querySelectorAll('.question-error').forEach(el => el.classList.remove('question-error'));
            document.querySelectorAll('.missing-answer').forEach(el => el.classList.remove('missing-answer'));

            // Thông báo lỗi trên form
            const errorMsg = document.createElement('div');
            errorMsg.className = 'error-message';
            errorMsg.innerHTML = `
              <span class="error-icon">⚠️</span>
              <div>
                <strong>Vui lòng trả lời đầy đủ tất cả câu hỏi!</strong><br>
                <small>Còn ${unanswered.length} câu hỏi chưa được trả lời.</small>
              </div>
            `;
            form.insertBefore(errorMsg, form.firstChild);

            // Highlight + scroll đến câu đầu
            const first = unanswered[0];
            if (first && first.element) {
              first.element.classList.add('question-error');
              if (first.type === 'scale') {
                first.element.querySelectorAll('.table-rating-option').forEach(opt => {
                  opt.classList.add('missing-answer');
                });
              } else {
                const ta = first.element.querySelector('textarea');
                if (ta) ta.classList.add('missing-answer');
              }
              
              setTimeout(() => {
                try {
                  first.element.scrollIntoView({ behavior: 'smooth', block: 'center' });
                } catch (err) { 
                  console.warn('scrollIntoView failed', err); 
                }
              }, 80);
            }

            showToast(t('errorIncomplete'), 'error');

            setTimeout(() => {
              document.querySelectorAll('.question-error').forEach(el => el.classList.remove('question-error'));
              document.querySelectorAll('.missing-answer').forEach(el => el.classList.remove('missing-answer'));
            }, 2500);

            return;
          }

          // Nếu tới đây là hợp lệ → tiếp tục xử lý gửi
          showLoading();
          const formData = Array.from(new FormData(form).entries())
            .map(([cauHoiId, traLoi]) => ({
              nhanVienId: String(dgForm.dataset.nhanVienId || id),
              nhanVien: dgForm.dataset.nhanVienTen || '',
              cauHoiId,
              traLoi
            }));

          google.script.run
            .withSuccessHandler(() => {
              hideLoading();
              google.script.run.withSuccessHandler(() => {
                console.log('Đã xóa nháp sau khi submit');
              }).deleteDraft(dgForm.dataset.nhanVienId, currentUser);

              showToast(`${t('submitSuccess')} ${document.getElementById('employeeName').innerText}`);
              evaluatedEmployees.add(String(dgForm.dataset.nhanVienId));
              updateProgress();
              closeEvaluationPage();
              goToHome();
            })
            .withFailureHandler(err => {
              hideLoading();
              showToast("Lỗi khi lưu đánh giá: " + (err.message || err), "error");
            })
            .submitDanhGia(formData, currentUser);
        });

      })
      .withFailureHandler(err => {
        container.innerHTML = `<p style="color:red;">Lỗi tải câu hỏi: ${err.message}</p>`;
      })
      .getCauHoiTheoNhanVienByLang(id, currentLang);
  }

  // === ĐÓNG TRANG ĐÁNH GIÁ (quay lại danh sách) ===
  function closeEvaluationPage() {
    document.getElementById("searchContainer").style.display = "block";
    document.getElementById("evaluationPage").style.display = "none";
    document.getElementById("evaluationHeaderWrapper").style.display = "none";
    document.getElementById("content").style.display = "block";
    document.getElementById("progress-section").style.display = "block";
    
    const titleElement = document.getElementById('title');
    titleElement.style.display = "block";
    titleElement.innerText = t('departmentListTitle');
    titleElement.style.marginBottom = "20px";
  }

      function showToast(message, type = 'success') {
        const toast = document.createElement('div');
        toast.className = 'toast';
        toast.style.background = type === 'success' ? '#28a745' : '#dc3545';
        toast.innerHTML = `<span style="font-size:20px;">${type==='success'?'✓':'✗'}</span> <span>${message}</span>`;
        document.body.appendChild(toast);
        setTimeout(() => { 
          toast.classList.add('hide'); 
          setTimeout(() => toast.remove(), 300); 
        }, 3000);
      }

      function showLoading() { 
        document.getElementById('loading-overlay').style.display='flex'; 
      }
      function hideLoading() { 
        document.getElementById('loading-overlay').style.display='none'; 
      }

  function closePopup() {
    const popup = document.getElementById('popup');
    const content = document.getElementById('popup-content');
    popup.style.display = 'none';
    content.innerHTML = '';
    
    // ✅ CHỈ hiển thị lại danh sách nếu popup được mở từ tìm kiếm
    if (isSearchPopupOpen) {
      const contentDiv = document.getElementById("content");
      const titleElement = document.getElementById("title");
      const searchInput = document.getElementById("employeeSearch");
      
      if (contentDiv && contentDiv.style.display === "none") {
        contentDiv.style.display = "block";
        if (titleElement) titleElement.style.display = "block";
        
        // Reset thanh tìm kiếm
        if (searchInput) searchInput.value = "";
        const searchResults = document.getElementById("searchResults");
        if (searchResults) searchResults.innerHTML = "";
      }
      
      // Reset flag
      isSearchPopupOpen = false;
    }
  }

  <!-- DANH SÁCH CHƯA ĐÁNH GIÁ -->
  function showRemainingList() {
    const popup = document.getElementById('popup');
    const content = document.getElementById('popup-content');
    popup.style.display = 'flex';

    content.innerHTML = `
      <div style="
        padding:40px 20px;
        text-align:center;
        font-size:16px;
      ">
        <div class="spinner" style="margin:auto;"></div>
        <p style="margin-top:12px;">${t("loading")}</p>
      </div>
    `;

    google.script.run
      .withSuccessHandler(list => {

        // 🟢 Trường hợp KHÔNG còn nhân viên nào chưa đánh giá
        if (list.length === 0) {
          content.innerHTML = `
            <div class="popup-header">
              <h3>${t("not_eval_emp")}</h3>
              <button class="popup-close" onclick="closePopup()">
                <svg viewBox="0 0 24 24">
                  <path d="M6 6 L18 18 M18 6 L6 18"
                        stroke="currentColor"
                        stroke-width="3"
                        stroke-linecap="round"
                        stroke-linejoin="round"
                        fill="none"/>
                </svg>
              </button>
            </div>

            <div class="popup-body-scroll" style="padding:20px;">
              <div style="
                text-align:center;
                padding:30px;
                background:#e8f5e9;
                border-radius:8px;
                margin:15px 0;
              ">
                <div style="font-size:48px; margin-bottom:10px;">🎉</div>
                <p style="color:#2e7d32; font-size:16px; font-weight:600; margin:0;">
                  Chúc mừng! Bạn đã hoàn thành đánh giá tất cả nhân viên
                </p>
              </div>
            </div>
          `;
          return;
        }

        // 🟡 Trường hợp CÒN nhân viên chưa đánh giá
        content.innerHTML = `
          <div class="popup-header">
            <h3>${t("not_eval_emp")} (${list.length})</h3>
            <button class="popup-close" onclick="closePopup()">
              <svg viewBox="0 0 24 24">
                <path d="M6 6 L18 18 M18 6 L6 18"
                      stroke="currentColor"
                      stroke-width="3"
                      stroke-linecap="round"
                      stroke-linejoin="round"
                      fill="none"/>
              </svg>
            </button>
          </div>

          <div class="popup-body-scroll">

            <div style="
              background:#fff3cd;
              border:1px solid #ffc107;
              border-radius:8px;
              padding:12px;
              margin-bottom:15px;
            ">
              <p style="margin:0; color:#856404; font-size:14px;">
                💡 <b>${t("hint")}:</b> ${t("clickToEvaluate")}
              </p>
            </div>

            <table class="evaluated-list-table">
              <thead>
                <tr>
                  <th style="width:10%;">${t("thEmployeeId")}</th>
                  <th style="width:20%;">${t("thFullName")}</th>
                  <th style="width:25%;">${t("thFacility")}</th>
                  <th style="width:25%;">${t("thDepartment")}</th>
                  <th style="width:20%;">${t("thPosition")}</th>
                </tr>
              </thead>

              <tbody>
                ${list.map(nv => {
                  // ✅ Kiểm tra hết hạn
                  const employee = findEmployeeById(nv.id);
                  const isExpired = employee ? isEmployeeExpired(employee) : false;
                  
                  return `
                    <tr style="cursor:${isExpired ? 'not-allowed' : 'pointer'}; opacity:${isExpired ? '0.5' : '1'};"
                        ${isExpired ? '' : `onclick="evaluateFromList('${nv.id}', '${nv.ten.replace(/'/g, "\\'")}', '${nv.phongban}')"`}
                        title="${isExpired ? t('expiredDeadline') : ''}">
                      <td>${nv.id}</td>
                      <td><b>${nv.ten}</b></td>
                      <td>${nv.phongban}</td>
                      <td>${nv.bophan}</td>
                      <td>${nv.chucvu}</td>
                    </tr>
                  `;
                }).join('')}
              </tbody>
            </table>

          </div>
        `;
      })

      .withFailureHandler(err => {
        content.innerHTML = `
          <div class="popup-header">
            <h3 style="color:#dc3545;">❌ Lỗi</h3>

            <button class="popup-close" onclick="closePopup()">
              <svg viewBox="0 0 24 24">
                <path d="M6 6 L18 18 M18 6 L6 18"
                      stroke="currentColor"
                      stroke-width="3"
                      stroke-linecap="round"
                      stroke-linejoin="round"
                      fill="none"/>
              </svg>
            </button>
          </div>

          <div class="popup-body-scroll" style="padding:15px;">
            <p style="color:#666;">Không thể tải danh sách: ${err.message}</p>
          </div>
        `;
      })

      .getRemainingEmployeesDetail(currentUser, currentLang);
  }

  function evaluateFromList(id, ten, phongban) {
    closePopup();
    let avatarUrl = "https://cdn-icons-png.flaticon.com/512/847/847969.png";
    Object.keys(groupedData).forEach(pb => {
      Object.keys(groupedData[pb]).forEach(cv => {
        groupedData[pb][cv].forEach(nv => {
          if (String(nv.id) === String(id)) {
            if (nv.avatar && nv.avatar.trim() !== "") {
              avatarUrl = nv.avatar;
            }
          }
        });
      });
    });

    openPopup(id, ten, avatarUrl);
  }

  // Quay về trang chủ
  function goToHome() {
    // ✅ KIỂM TRA NẾU ĐANG Ở CHẾ ĐỘ ADMIN THÌ KHÔNG LÀM GÌ
    const adminContainer = document.getElementById('admin-mode-container');
    if (adminContainer && adminContainer.style.display === 'block') {
      console.log('🚫 Đang ở chế độ admin, không thực hiện goToHome');
      return;
    }
    
    document.getElementById("evaluationPage").style.display = "none";
    document.getElementById("evaluationHeaderWrapper").style.display = "none";
    document.getElementById("content").style.display = "block";
    document.getElementById("progress-section").style.display = "block";
    document.getElementById("searchContainer").style.display = "block";
    
    const titleElement = document.getElementById('title');
    if (titleElement) {
      titleElement.innerText = t('departmentListTitle');
      titleElement.style.position = 'static';
      titleElement.style.top = 'auto';
      titleElement.style.zIndex = 'auto';
      titleElement.style.background = 'none';
      titleElement.style.padding = '0';
      titleElement.style.margin = '0 0 20px 0';
      titleElement.style.boxShadow = 'none';
      titleElement.style.display = 'block';
    }
    
    closePopup();
    renderDepartments();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  <!-- XEM LẠI KẾT QUẢ ĐÁNH GIÁ -->
  function viewEvaluationResult(nhanVienId, nhanVienTen) {
    const popup = document.getElementById('popup');
    const content = document.getElementById('popup-content');
    popup.style.display = 'flex';
    isSearchPopupOpen = true;

    // 🔥 Loading chuẩn
    content.innerHTML = `
      <div style="
        padding:40px 20px;
        text-align:center;
        font-size:16px;
      ">
        <div class="spinner" style="margin:auto;"></div>
        <p style="margin-top:12px;">${t("loadingEvaluation")}</p>
      </div>
    `;

    if (!currentUser || !currentUser.email) {
      content.innerHTML = `
        <div class="popup-header">
          <h3 style="color:#dc3545;">❌ Lỗi</h3>
          <button class="popup-close" onclick="closePopup()">
            <svg viewBox="0 0 24 24">
              <path d="M6 6 L18 18 M18 6 L6 18"
                stroke="currentColor" stroke-width="3"
                stroke-linecap="round" stroke-linejoin="round"
                fill="none"/>
            </svg>
          </button>
        </div>

        <div class="popup-body-scroll" style="padding:15px;">
          <p>Không thể tải kết quả đánh giá do thiếu thông tin người dùng.</p>
          <button onclick="location.reload()" style="margin-top:15px;">Tải lại trang</button>
        </div>
      `;
      return;
    }

    google.script.run
      .withSuccessHandler(result => {

        if (!result || !result.nhanVien) {
          content.innerHTML = `
            <div class="popup-header">
              <h3 style="color:#dc3545;">❌ Không tìm thấy</h3>
              <button class="popup-close" onclick="closePopup()">
                <svg viewBox="0 0 24 24">
                  <path d="M6 6 L18 18 M18 6 L6 18"
                    stroke="currentColor" stroke-width="3"
                    stroke-linecap="round" stroke-linejoin="round"
                    fill="none"/>
                </svg>
              </button>
            </div>

            <div class="popup-body-scroll" style="padding:15px;">
              <p>Không tìm thấy kết quả đánh giá.</p>
              <button onclick="showEvaluatedList()" style="background:#6c757d;">⬅ Quay lại</button>
            </div>
          `;
          return;
        }

        const nv = result.nhanVien;
        const ngayDanhGia = new Date(result.ngayDanhGia).toLocaleString(currentLang === 'vi' ? 'vi-VN' : 'en-US');
        const grouped = result.cauHoi;
    
        // 🎨 Bảng màu gradient đẹp mắt
        const gradients = [
          'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
          'linear-gradient(135deg, #f093fb 0%, #f5576c 100%)',
          'linear-gradient(135deg, #4facfe 0%, #00f2fe 100%)',
          'linear-gradient(135deg, #43e97b 0%, #38f9d7 100%)',
          'linear-gradient(135deg, #fa709a 0%, #fee140 100%)',
          'linear-gradient(135deg, #30cfd0 0%, #330867 100%)'
        ];

        const nhomColorMap = {};
        let idx = 0;
        Object.keys(grouped).forEach(k => {
          nhomColorMap[k] = {
            gradient: gradients[idx % gradients.length],
            color: idx % 2 === 0 ? '#667eea' : '#f5576c'
          };
          idx++;
        });

        // ✅ Thu thập và phân loại câu hỏi
        const allScale = [];
        const allText = [];

        Object.keys(grouped).forEach(nhom => {
          const style = nhomColorMap[nhom];
          Object.keys(grouped[nhom]).forEach(sub => {
            grouped[nhom][sub].forEach(q => {
              const item = { 
                ...q, 
                nhom, 
                subGroup: sub, 
                gradient: style.gradient,
                color: style.color,
                thuTu: Number(q.id)
              };
              q.loai === "scale" ? allScale.push(item) : allText.push(item);
            });
          });
        });

        allScale.sort((a, b) => a.thuTu - b.thuTu);
        allText.sort((a, b) => a.thuTu - b.thuTu);

        const safeAvatar = (nv.avatar || "https://cdn-icons-png.flaticon.com/512/847/847969.png")
        .replace(/[`"]/g, "")
        .trim();

  // =======================
  // HEADER + INFO (STICKY)
  // =======================
  let html = `
    <div class="popup-header" style="
        background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
        color: white;
        display:flex;
        align-items:center;
        justify-content:space-between;
        padding: 12px 16px;
    ">
      <h3 style="color:white; margin:0; font-size:20px;">${t("resultTitle")}</h3>
      <button class="popup-close" onclick="closePopup()">
        <svg viewBox="0 0 24 24">
          <path d="M6 6 L18 18 M18 6 L6 18"
            stroke="currentColor" stroke-width="3"
            stroke-linecap="round" stroke-linejoin="round"
            fill="none"/>
        </svg>
      </button>
    </div>

    <!-- PROFILE HEADER MỚI -->
    <div style="
        display:flex;
        align-items:center;
        gap:18px;
        background:white;
        padding:18px;
        border-bottom:3px solid #667eea;
        box-shadow:0 4px 15px rgba(0,0,0,0.05);
    ">
        <img src="${safeAvatar}"
          style="
            width:90px;
            height:90px;
            object-fit:cover;
            border-radius:50%;
            border:3px solid #667eea;
            box-shadow:0 4px 16px rgba(102,126,234,0.4);
        ">

        <div style="flex:1;">
            <div style="font-size:22px; font-weight:700; color:#0078d7; margin-bottom:8px;">
                ${nv.ten}
            </div>

            <div style="display:grid; grid-template-columns:1fr 1fr; gap:6px 12px; font-size:14px;">
                <div>
                    <span style="color:#666;">${t("infoPosition")}:</span>
                    <span style="font-weight:600; color:#333; margin-left:4px;">${nv.chucvu}</span>
                </div>
                
                <div>
                    <span style="color:#666;">${t("infoDepartment")}:</span>
                    <span style="font-weight:600; color:#333; margin-left:4px;">${nv.phongban}</span>
                </div>
                
                <div>
                    <span style="color:#666;">${t("infoDivision")}:</span>
                    <span style="font-weight:600; color:#333; margin-left:4px;">${nv.bophan}</span>
                </div>
                
                <div>
                    <span style="color:#666;">${t("reviewDate")}:</span>
                    <span style="font-weight:600; color:#333; margin-left:4px;">${ngayDanhGia}</span>
                </div>
            </div>
        </div>
    </div>

    <div class="popup-body-scroll" style="padding: 20px 16px 16px;">
  `;

        // =======================
        // SCALE QUESTIONS
        // =======================
        if (allScale.length > 0) {
          let currentNhom = null;
          let currentSub = null;
          let tableOpen = false;

          allScale.forEach(q => {

            // 🔹 Header năng lực mới
            if (currentNhom !== q.nhom) {
              if (tableOpen) html += `</tbody></table></div>`;
              html += `
                <div style="
                  background: ${q.gradient};
                  border-radius: 16px;
                  padding: 20px;
                  margin: 25px 0 20px 0;
                  box-shadow: 0 8px 24px rgba(102, 126, 234, 0.3);
                  position: relative;
                  overflow: hidden;
                ">
                  <div style="
                    position: absolute;
                    top: -20px;
                    right: -20px;
                    width: 100px;
                    height: 100px;
                    background: rgba(255,255,255,0.1);
                    border-radius: 50%;
                  "></div>
                  <h3 style="
                    color: white;
                    margin: 0;
                    font-size: 22px;
                    display: flex;
                    align-items: center;
                    gap: 12px;
                    position: relative;
                    z-index: 1;
                  ">
                    <span style="font-size: 32px;">🏆</span>
                    ${q.nhom}
                  </h3>
                </div>
                
                <div style="
                  background: white;
                  border-radius: 12px;
                  overflow: hidden;
                  box-shadow: 0 4px 16px rgba(0,0,0,0.1);
                  margin-bottom: 20px;
                ">
              `;
              currentNhom = q.nhom;
              currentSub = null;
              tableOpen = false;
            }

            // 🔹 Mở bảng nếu chưa mở
            if (!tableOpen) {
              html += `
                <table style="width:100%; border-collapse:collapse;">
                  <thead>
                    <tr style="background: ${q.gradient};">
                      <th style="
                        color:white; 
                        padding:15px 20px; 
                        text-align:left;
                        font-size: 15px;
                        font-weight: 600;
                      ">${t("thQuestion")}</th>
                      <th style="
                        color:white; 
                        padding:15px 20px; 
                        text-align:center;
                        font-size: 15px;
                        font-weight: 600;
                        min-width: 280px;
                      ">${t("thAnswer")}</th>
                    </tr>
                  </thead>
                  <tbody>
              `;
              tableOpen = true;
            }

            // 🔹 Năng lực con
            if (currentSub !== q.subGroup) {
              html += `
                <tr style="background: linear-gradient(90deg, ${q.gradient.match(/\#[\w]+/)[0]}15, transparent);">
                  <td colspan="2" style="
                    padding: 12px 20px; 
                    font-weight: 700;
                    font-size: 15px;
                    color: ${q.color};
                    border-bottom: 2px solid ${q.color}30;
                  ">
                    <span style="margin-right: 8px;">▸</span>${q.subGroup}
                  </td>
                </tr>
              `;
              currentSub = q.subGroup;
            }

            const rating = q.traLoi === "N/A" ? "N/A" : Number(q.traLoi);

            const ratingColors = {
              1: { bg: '#dc3545', light: '#dc354520' },
              2: { bg: '#fd7e14', light: '#fd7e1420' },
              3: { bg: '#ffc107', light: '#ffc10720' },
              4: { bg: '#28a745', light: '#28a74520' },
              5: { bg: '#0078d7', light: '#0078d720' },
              'N/A': { bg: '#6c757d', light: '#6c757d20' }
            };

            const color = ratingColors[rating] || ratingColors['N/A'];

            html += `
              <tr style="border-bottom: 1px solid #f0f0f0; transition: all 0.2s;">
                <td style="padding: 18px 20px; border-right: 1px solid #f0f0f0;">
                  <div style="font-size: 14px; color: #333; line-height: 1.6;">${q.noidung}</div>
                </td>
                <td style="padding: 18px 20px; text-align: center;">
                  <div style="display: flex; gap: 8px; justify-content: center; align-items: center;">
            `;

            [1,2,3,4,5,'N/A'].forEach(v => {
              const isSel = (v === 'N/A' && q.traLoi === 'N/A') || (v !== 'N/A' && v === rating);
              
              const btnColor = ratingColors[v] || ratingColors['N/A'];

              html += `
                <div style="
                  width: ${v === 'N/A' ? '50px' : '36px'};
                  height: 36px;
                  border-radius: ${v === 'N/A' ? '18px' : '50%'};
                  background: ${isSel ? btnColor.bg : 'white'};
                  border: 2px solid ${isSel ? btnColor.bg : '#e0e0e0'};
                  color: ${isSel ? 'white' : '#999'};
                  font-weight: ${isSel ? '700' : '500'};
                  font-size: ${v === 'N/A' ? '12px' : '14px'};
                  display: flex;
                  align-items: center;
                  justify-content: center;
                  transition: all 0.3s;
                  ${isSel ? 'box-shadow: 0 4px 12px ' + btnColor.light + ';' : ''}
                  ${isSel ? 'transform: scale(1.15);' : ''}
                ">${v}</div>
              `;
            });

            html += `</div></td></tr>`;
          });

          if (tableOpen) html += `</tbody></table></div>`;
        }

        // =======================
        // TEXT QUESTIONS
        // =======================
        if (allText.length > 0) {
          let currentNhom = null;
          let currentSub = null;

          allText.forEach(q => {

            // 🔹 Header năng lực mới
            if (currentNhom !== q.nhom) {
              html += `
                <div style="
                  background: ${q.gradient};
                  border-radius: 16px;
                  padding: 20px;
                  margin: 25px 0 20px 0;
                  box-shadow: 0 8px 24px rgba(102, 126, 234, 0.3);
                  position: relative;
                  overflow: hidden;
                ">
                  <div style="
                    position: absolute;
                    top: -20px;
                    right: -20px;
                    width: 100px;
                    height: 100px;
                    background: rgba(255,255,255,0.1);
                    border-radius: 50%;
                  "></div>
                  <h3 style="
                    color: white;
                    margin: 0;
                    font-size: 22px;
                    display: flex;
                    align-items: center;
                    gap: 12px;
                    position: relative;
                    z-index: 1;
                  ">
                    <span style="font-size: 32px;">💬</span>
                    ${q.nhom}
                  </h3>
                </div>
              `;
              currentNhom = q.nhom;
              currentSub = null;
            }

            // 🔹 Năng lực con
            if (currentSub !== q.subGroup) {
              html += `
                <div style="
                  font-weight: 700;
                  font-size: 16px;
                  margin: 20px 0 15px;
                  padding: 12px 20px;
                  background: linear-gradient(90deg, ${q.gradient.match(/\#[\w]+/)[0]}15, transparent);
                  border-left: 4px solid ${q.color};
                  border-radius: 8px;
                  color: ${q.color};
                ">
                  <span style="margin-right: 8px;">▸</span>${q.subGroup}
                </div>
              `;
              currentSub = q.subGroup;
            }

            // 🔹 Render text question
            html += `
              <div style="
                background: white;
                border: 2px solid #f0f0f0;
                border-radius: 12px;
                padding: 20px;
                margin-bottom: 20px;
                box-shadow: 0 2px 8px rgba(0,0,0,0.06);
                transition: all 0.2s;
              ">
                <div style="
                  font-weight: 600;
                  font-size: 15px;
                  margin-bottom: 12px;
                  color: #333;
                  display: flex;
                  align-items: center;
                  gap: 8px;
                ">
                  <span style="color: ${q.color};">📝</span>
                  ${q.noidung}
                </div>
                
                <div style="
                  background: linear-gradient(135deg, #f8f9fa 0%, #ffffff 100%);
                  padding: 0px 16px 40px 16px;
                  border-radius: 8px;
                  border: 1px solid #e9ecef;
                  white-space: pre-line;
                  line-height: 1.6;
                  color: #495057;
                  font-size: 14px;
                  text-indent: 0;
                ">

                  ${q.traLoi || `<i style='color:#999'>${currentLang === 'vi' ? 'Không có câu trả lời' : 'No answer provided'}</i>`}
                </div>
              </div>
            `;
          });
        }

        // =======================
        // FOOTER
        // =======================
        html += `
          </div>
          <div style="
            text-align: center;
            padding: 12px 20px 5px;
            border-top: 2px solid #f0f0f0;
            background: white;
          ">
            <button onclick="showEvaluatedList()" style="
              display: inline-block;
              margin-top: 12px;
              background: linear-gradient(135deg, #6c757d 0%, #5a6268 100%);
              color: white;
              border: none;
              padding: 12px 20px;
              border-radius: 25px;
              font-size: 12px;
              font-weight: 600;
              cursor: pointer;
              box-shadow: 0 4px 12px rgba(108, 117, 125, 0.3);
              transition: all 0.3s;
            " onmouseover="this.style.transform='translateY(-2px)'; this.style.boxShadow='0 6px 20px rgba(108, 117, 125, 0.4)'"
              onmouseout="this.style.transform='translateY(0)'; this.style.boxShadow='0 4px 12px rgba(108, 117, 125, 0.3)'">
              ${t('btnBack')}
            </button>
          </div>
        `;

        content.innerHTML = html;
      })

      .withFailureHandler(err => {
        content.innerHTML = `
          <div class="popup-header">
            <h3 style="color:#dc3545;">❌ Lỗi</h3>
            <button class="popup-close" onclick="closePopup()">
              <svg viewBox="0 0 24 24">
                <path d="M6 6 L18 18 M18 6 L6 18"
                  stroke="currentColor" stroke-width="3"
                  stroke-linecap="round" stroke-linejoin="round"
                  fill="none"/>
              </svg>
            </button>
          </div>

          <div class="popup-body-scroll" style="padding:15px;">
            <p>${err.message}</p>
            <button onclick="showEvaluatedList()" style="background:#6c757d; margin-top:15px;">
              ${t('btnBack')}
            </button>
          </div>
        `;
      })

      .getEvaluationResult(nhanVienId, currentUser, currentLang);
  }

  function isCurrentUserValid() {
    if (!currentUser) {
      console.error('❌ currentUser is null');
      showToast('Lỗi: Không tìm thấy thông tin người dùng', 'error');
      return false;
    }
    
    if (!currentUser.email) {
      console.error('❌ currentUser.ten is empty');
      showToast('Lỗi: Thông tin người dùng không đầy đủ', 'error');
      return false;
    }
    
    return true;
  }
  function scrollToTop() {
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  window.addEventListener('scroll', () => {
    const backToTopBtn = document.getElementById('backToTopBtn');
    const floatingBackBtn = document.getElementById('floatingBackBtn');
    const evaluationPage = document.getElementById('evaluationPage');
    
    if (window.pageYOffset > 300) {
      backToTopBtn.style.display = 'block';
    } else {
      backToTopBtn.style.display = 'none';
    }
    
    if (evaluationPage.style.display === 'block' && window.pageYOffset > 300) {
      floatingBackBtn.style.display = 'block';
    } else {
      floatingBackBtn.style.display = 'none';
    }
  });

  // ===== LƯU NHÁP =====
  function saveDraftData() {
    const form = document.getElementById('dgForm');
    const formData = new FormData(form);
    
    const draftData = {
      tenNhanVien: document.getElementById('employeeName').innerText,
      answers: {}
    };

    // Lưu tất cả câu trả lời
    for (let [cauHoiId, traLoi] of formData.entries()) {
      draftData.answers[cauHoiId] = traLoi;
    }

    const nhanVienId = form.dataset.nhanVienId;

    showLoading();

    google.script.run
      .withSuccessHandler(result => {
        hideLoading();
        showToast(t('saveDraftSuccess'), 'success');
        goToHome();

        // Kiểm tra xem đây có phải draft mới
        const isNewDraft = !draftEmployees.has(nhanVienId);
        draftEmployees.add(nhanVienId);

        // Cập nhật số liệu tổng nếu là draft mới
        if (isNewDraft) {
          const currentDraft = parseInt(document.getElementById("stat-draft").textContent) || 0;
          const currentRemaining = parseInt(document.getElementById("stat-remaining").textContent) || 0;

          document.getElementById("stat-draft").textContent = currentDraft + 1;
          document.getElementById("stat-remaining").textContent = Math.max(0, currentRemaining - 1);
        }

        // Cập nhật thanh progress
        const total = parseInt(document.getElementById("stat-total").textContent) || 0;
        const evaluated = parseInt(document.getElementById("stat-evaluated").textContent) || 0;
        const percentageExact = total > 0 ? (evaluated / total) * 100 : 0;
        document.getElementById('progress-bar').style.width = Math.min(percentageExact, 100) + '%';
        document.getElementById('progress-bar').textContent = percentageExact.toFixed(1) + '%';

        // Cập nhật dữ liệu draft chi tiết trên UI NGAY
        updateDraftUI(nhanVienId, result.timestamp);

        // Render lại giao diện
        closeEvaluationPage();
        renderDepartments();

        // Đồng bộ lại từ server nền
        google.script.run.withSuccessHandler(drafts => {
          draftEmployees = new Set(drafts.map(e => e.id));
          document.getElementById("stat-draft").textContent = draftEmployees.size;
        }).getDraftEmployees(currentUser, currentLang);

      })
      .withFailureHandler(err => {
        hideLoading();
        showToast('❌ Lỗi khi lưu nháp: ' + err.message, 'error');
      })
      .saveDraft(nhanVienId, draftData, currentUser);
  }

  // Hàm cập nhật dữ liệu draft chi tiết trên UI ngay lập tức
  function updateDraftUI(nhanVienId, timestamp) {
    const draftRow = document.querySelector(`[data-nhanvien-id="${nhanVienId}"]`);
    if (draftRow) {
      const dateCell = draftRow.querySelector('.draft-date');
      if (dateCell) {
        dateCell.textContent = new Date(timestamp).toLocaleString();
      }
    }
  }

  function loadDraft(nhanVienId) {
    // ===== util local: chỉ dùng cho loadDraft =====
    function normalizeAnswerValue(value) {
      if (typeof value !== 'string') return value;

      let v = value.trim();
      if (v.startsWith('"') && v.endsWith('"')) {
        v = v.slice(1, -1);
      }
      return v;
    }

    // ✅ Nếu đã đánh giá thì không load draft
    const isEvaluated = evaluatedEmployees.has(String(nhanVienId));
    if (isEvaluated) return;

    google.script.run
      .withSuccessHandler(draft => {

        if (!draft || !draft.data || !draft.data.answers) {
          console.log('Không có nháp để tải');
          hideDraftLoadingIndicator(false);
          return;
        }

        hideDraftLoadingIndicator(true);

        const evalContent = document.getElementById('evaluationContent');
        if (!evalContent) return;

        const timestamp = new Date(draft.timestamp).toLocaleString(
          currentLang === 'vi' ? 'vi-VN' : 'en-US'
        );

        const draftInfoHtml = `
          <div id="draft-info" class="draft-info">
            <div class="draft-info-icon">📝</div>
            <div class="draft-info-text">
              <b>${t('draftFound')}</b><br>
              <small>${t('draftLastTime')} ${timestamp}</small>
            </div>
            <button class="btn-clear-draft" onclick="clearDraft()">
              ${t('draftClear')}
            </button>
          </div>
        `;

        evalContent.insertAdjacentHTML('afterbegin', draftInfoHtml);

        // ===== điền dữ liệu =====
        const answers = draft.data.answers;
        let filledCount = 0;

        Object.keys(answers).forEach(cauHoiId => {
          const rawValue = answers[cauHoiId];
          if (!rawValue) return;

          const value = normalizeAnswerValue(rawValue);

          // SCALE (radio)
          const radioInput = document.querySelector(
            `input[name="${CSS.escape(cauHoiId)}"][value="${CSS.escape(String(value))}"]`
          );
          if (radioInput) {
            radioInput.checked = true;
            filledCount++;
            return;
          }

          // TEXT (textarea)
          const textareaInput = document.querySelector(
            `textarea[name="${CSS.escape(cauHoiId)}"]`
          );
          if (textareaInput) {
            textareaInput.value = value;
            filledCount++;
          }
        });

        console.log(`✅ Đã load ${filledCount} câu từ draft`);
        updateAnswerProgress();
        showToast(t('scdraft'), 'success');
      })
      .withFailureHandler(err => {
        console.log('❌ Lỗi khi tải nháp:', err);
        hideDraftLoadingIndicator(false);
      })
      .getDraft(nhanVienId, currentUser);
  }

  // ===== XÓA NHÁP =====
  function clearDraft() {
    const form = document.getElementById('dgForm');
    const nhanVienId = form.dataset.nhanVienId;
    
    // Tạo popup xác nhận nhỏ
    const popup = document.getElementById('popup');
    const content = document.getElementById('popup-content');
    popup.style.display = 'flex';
    
    content.innerHTML = `
      <div class="popup-header">
        <h3 style="color:#dc3545;">⚠️ ${t('confirmDeleteDraft')}</h3>
        <button class="popup-close" onclick="closePopup()">
          <svg viewBox="0 0 24 24">
            <path d="M6 6 L18 18 M18 6 L6 18"
                  stroke="currentColor"
                  stroke-width="3"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  fill="none"/>
          </svg>
        </button>
      </div>
      
      <div class="popup-body-scroll" style="padding:30px; text-align:center;">
        <div style="font-size:48px; margin-bottom:15px;">🗑️</div>
        <p style="font-size:16px; color:#333; margin-bottom:10px;">
          <strong>${t('confirmDeleteDraftMsg')}</strong>
        </p>
        <p style="color:#666; font-size:14px;">
          ${t('confirmDeleteDraftNote')}
        </p>
      </div>
      
      <div style="text-align:center; padding:15px; border-top:1px solid #ddd;">
        <button onclick="closePopup()" 
                style="background:#6c757d; margin-right:10px;">
          ❌ ${t('btnCancel')}
        </button>
        <button onclick="confirmClearDraft('${nhanVienId}')" 
                style="background:#dc3545;">
          🗑️ ${t('btnDelete')}
        </button>
      </div>
    `;
  }

  // ===== XÁC NHẬN XÓA NHÁP =====
  function confirmClearDraft(nhanVienId) {
    closePopup();
    showLoading();
    
    google.script.run
      .withSuccessHandler(result => {
        hideLoading();
        if (result.success) {
          showToast(t('draftDeleted'), 'success');
          
          // Xóa thông báo nháp
          const draftInfo = document.getElementById('draft-info');
          if (draftInfo) {
            draftInfo.remove();
          }
          
          // Xóa khỏi Set draftEmployees
          draftEmployees.delete(nhanVienId);
          
          // Chỉ cập nhật progress, KHÔNG render lại departments
          updateProgress();
          document.getElementById("progress-section").style.display = "none";
          // ✅ XÓA TẤT CẢ CÂU TRẢ LỜI TRONG FORM
          const form = document.getElementById('dgForm');
          if (form) {
            // Xóa tất cả radio đã chọn
            form.querySelectorAll('input[type="radio"]:checked').forEach(radio => {
              radio.checked = false;
            });
            
            // Xóa tất cả textarea
            form.querySelectorAll('textarea').forEach(textarea => {
              textarea.value = '';
            });
          }
          
        } else {
          showToast('⚠️ ' + result.message, 'error');
        }
      })
      .withFailureHandler(err => {
        hideLoading();
        showToast('❌ Lỗi khi xóa nháp: ' + err.message, 'error');
      })
      .deleteDraft(nhanVienId, currentUser);
  }

  // ===== KIỂM TRA XEM CÓ DRAFT KHÔNG =====
  function checkDraftExists(nhanVienId, callback) {
    google.script.run
      .withSuccessHandler(draft => {
        callback(draft !== null && draft.data);
      })
      .withFailureHandler(() => {
        callback(false);
      })
      .getDraft(nhanVienId, currentUser);
  }

  <!-- DANH SÁCH ĐANG ĐÁNH GIÁ -->
  function showDraftList() {
    const popup = document.getElementById('popup');
    const content = document.getElementById('popup-content');
    popup.style.display = 'flex';

    content.innerHTML = `
      <div style="
        padding:40px 20px;
        text-align:center;
        font-size:16px;
      ">
        <div class="spinner" style="margin:auto;"></div>
        <p style="margin-top:12px;">${t("loading")}</p>
      </div>
    `;

    google.script.run
      .withSuccessHandler(list => {

        // Không có bản nháp
        if (!list || list.length === 0) {
          content.innerHTML = `
            <div class="popup-header">
              <h3 style="color:#28a745;">${t('noDraft')}</h3>

              <button class="popup-close" onclick="closePopup()">
                <svg viewBox="0 0 24 24">
                  <path d="M6 6 L18 18 M18 6 L6 18"
                        stroke="currentColor"
                        stroke-width="3"
                        stroke-linecap="round"
                        stroke-linejoin="round"
                        fill="none" />
                </svg>
              </button>
            </div>

            <div class="popup-body-scroll" style="padding:20px;">
              <p style="color:#666; text-align:center;">${t('noData')}</p>
            </div>
          `;
          return;
        }

        // Có bản nháp
        content.innerHTML = `
          <div class="popup-header">
            <h3 style="color:#28a745;">${t("cont_eva")} (${list.length})</h3>

            <button class="popup-close" onclick="closePopup()">
              <svg viewBox="0 0 24 24">
                <path d="M6 6 L18 18 M18 6 L6 18"
                      stroke="currentColor"
                      stroke-width="3"
                      stroke-linecap="round"
                      stroke-linejoin="round"
                      fill="none"/>
              </svg>
            </button>
          </div>

          <div class="popup-body-scroll">

            <div style="background:#e8f5e9; border:1px solid #28a745; border-radius:8px; padding:12px; margin-bottom:15px;">
              <p style="margin:0; color:#1d6f30; font-size:14px;">
                💡 <b>${t("hint")}:</b> ${t("clickToContinue")}
              </p>
            </div>

            <table class="evaluated-list-table">
              <thead>
                <tr>
                  <th style="width:10%;">${t("thEmployeeId")}</th>
                  <th style="width:20%;">${t("thFullName")}</th>
                  <th style="width:25%;">${t("thFacility")}</th>
                  <th style="width:25%;">${t("thDepartment")}</th>
                  <th style="width:20%;">${t("thPosition")}</th>
                </tr>
              </thead>

              <tbody>
                ${list.map(nv => {
                  // ✅ Kiểm tra hết hạn
                  const employee = findEmployeeById(nv.id);
                  const isExpired = employee ? isEmployeeExpired(employee) : false;
                  
                  return `
                    <tr style="cursor:${isExpired ? 'not-allowed' : 'pointer'}; opacity:${isExpired ? '0.5' : '1'};"
                        ${isExpired ? '' : `onclick="evaluateFromList('${nv.id}', '${nv.ten.replace(/'/g, "\\'")}', '${nv.phongban}')"`}
                        title="${isExpired ? t('expiredDeadline') : ''}">
                      <td>${nv.id}</td>
                      <td><b>${nv.ten}</b></td>
                      <td>${nv.phongban}</td>
                      <td>${nv.bophan}</td>
                      <td>${nv.chucvu}</td>
                    </tr>
                  `;
                }).join('')}
              </tbody>
            </table>

          </div>
        `;
      })

      .withFailureHandler(err => {
        content.innerHTML = `
          <div class="popup-header">
            <h3 style="color:#dc3545;">Lỗi tải danh sách</h3>

            <button class="popup-close" onclick="closePopup()">
              <svg viewBox="0 0 24 24">
                <path d="M6 6 L18 18 M18 6 L6 18"
                      stroke="currentColor"
                      stroke-width="3"
                      stroke-linecap="round"
                      stroke-linejoin="round"
                      fill="none"/>
              </svg>
            </button>
          </div>

          <div class="popup-body-scroll" style="padding:15px;">
            <p style="color:#666;">${err.message}</p>
          </div>
        `;
      })

      .getDraftEmployees(currentUser, currentLang);
  }

  function removeVietnameseTones(str) {
    return str
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/đ/g, 'd')
      .replace(/Đ/g, 'D');
  }

  function searchEmployee() {
    const keyword = removeVietnameseTones(
      document.getElementById("employeeSearch").value.trim().toLowerCase()
    );
    const resultBox = document.getElementById("searchResults");
    const contentDiv = document.getElementById("content");
    const titleElement = document.getElementById("title");
    
    if (!keyword) {
      resultBox.innerHTML = "";
      contentDiv.style.display = "block";
      titleElement.style.display = "block";
      return;
    }

    contentDiv.style.display = "none";
    titleElement.style.display = "none";

    let results = [];

    Object.values(groupedData).forEach(pb => {
      Object.values(pb).forEach(list => {
        list.forEach(nv => {
          if (
            removeVietnameseTones(nv.ten.toLowerCase()).includes(keyword) ||
            removeVietnameseTones(String(nv.id).toLowerCase()).includes(keyword) ||
            (nv.email && removeVietnameseTones(nv.email.toLowerCase()).includes(keyword)) ||
            (nv.chucvu && removeVietnameseTones(nv.chucvu.toLowerCase()).includes(keyword)) ||
            (nv.bophan && removeVietnameseTones(nv.bophan.toLowerCase()).includes(keyword)) ||
            (nv.phongban && removeVietnameseTones(nv.phongban.toLowerCase()).includes(keyword))
          ) {
            results.push(nv);
          }
        });
      });
    });

    if (results.length === 0) {
      resultBox.innerHTML = `
        <p style="padding:10px; color:#666; text-align:center;">
          ${t("noEmployeeFound")}
        </p>
      `;
      return;
    }

    resultBox.innerHTML = results.map(nv => formatEmployeeCard(nv)).join("");
  }

  function formatEmployeeCard(nv) {
    let badgeClass = "status-pending";
    let badgeText = t('badgePending');
    let status = "chua"; // mặc định

    if (evaluatedEmployees.has(String(nv.id))) {
      badgeClass = "status-done";
      badgeText = t('badgeEvaluated');
      status = "da";
    } else if (draftEmployees.has(String(nv.id))) {
      badgeClass = "status-draft";
      badgeText = t('badgeDraft');
      status = "dang";
    }

    const avatar = (nv.avatar && nv.avatar.trim() !== "")
      ? nv.avatar
      : "https://cdn-icons-png.flaticon.com/512/847/847969.png";

    const safeTen = String(nv.ten).replace(/'/g, "\\'").replace(/"/g, "&quot;");
    const safeAvt = String(avatar).replace(/"/g, "&quot;");
    const isExpired = isEmployeeExpired(nv);
    const cardStyle = isExpired && status !== 'da' 
      ? 'opacity:0.6; pointer-events:none;' 
      : '';

    return `
    <div class="employee-card-upgrade"
        style="${cardStyle}"
        onclick="return handleSearchSelectFromCard(this)"
        data-id="${String(nv.id)}"
        data-ten="${safeTen}"
        data-avatar="${safeAvt}"
        data-status="${status}">
      <span class="status-badge ${badgeClass}">${badgeText}</span>
      <img class="employee-avatar" src="${avatar}">
      <div class="employee-details">
        <div class="employee-name-main">${nv.ten} - ${nv.id}</div>
        <div>${nv.chucvu}</div>
        <div>${nv.phongban} - ${nv.bophan}</div>
        <div>${nv.email}</div>
      </div>
    </div>`;
  }

  // Dropdown menu
  document.addEventListener('click', e => {
    const menu = document.getElementById('dropdownMenu');
    if (document.getElementById('userButton').contains(e.target)) {
      menu.style.display = menu.style.display === 'block' ? 'none' : 'block';
    } else {
      menu.style.display = 'none';
    }
  });

  // Cập nhật hiển thị menu config theo quyền admin
  if (!isAdmin) {
    const configItem = document.getElementById('configMenuItem');
    if (configItem) {
      configItem.style.opacity = '0.4';
      configItem.style.pointerEvents = 'none';
    }
  }

  function openUserInfo() {
    const popup = document.getElementById('user-info-popup');
    let u = (cachedUserInfo && cachedUserInfoLang === currentLang)
            ? cachedUserInfo
            : currentUser;

    document.getElementById('userAvatar').src =
      u.avatar || 'https://cdn-icons-png.flaticon.com/512/847/847969.png';
    document.getElementById('userFullName').innerText = u.ten || '—';
    document.getElementById('userRole').innerText = u.chucvu || '—';

    document.getElementById('userDetails').innerHTML = `
      ${infoRow('🆔', t('lblEmployeeId'), u.id)}
      ${infoRow('✉️', t('lblEmail'), u.email)}
      ${infoRow('🏢', t('lblDepartment'), u.phongban)}
      ${infoRow('🧩', t('lblDivision'), u.bophan)}
      ${infoRow('💼', t('lblPosition'), u.chucvu)}
    `;

    popup.style.display = 'flex';
    if (cachedUserInfoLang !== currentLang) {
      google.script.run
        .withSuccessHandler(fresh => {
          if (!fresh) return;
          cachedUserInfo = fresh;
          cachedUserInfoLang = currentLang;
          document.getElementById('userAvatar').src =
            fresh.avatar || 'https://cdn-icons-png.flaticon.com/512/847/847969.png';

          document.getElementById('userFullName').innerText = fresh.ten || '—';
          document.getElementById('userRole').innerText = fresh.chucvu || '—';

          document.getElementById('userDetails').innerHTML = `
            ${infoRow('🆔', t('lblEmployeeId'), fresh.id)}
            ${infoRow('✉️', t('lblEmail'), fresh.email)}
            ${infoRow('🏢', t('lblDepartment'), fresh.phongban)}
            ${infoRow('🧩', t('lblDivision'), fresh.bophan)}
            ${infoRow('💼', t('lblPosition'), fresh.chucvu)}
          `;
        })
        .getNhanVienInfoByLang(currentUser.id, currentLang);
    }

    popup.addEventListener('click', function handler(e) {
      if (e.target === popup) {
        closeUserInfoPopup();
        popup.removeEventListener('click', handler);
      }
    });

    document.addEventListener('keydown', function escHandler(e) {
      if (e.key === 'Escape') {
        closeUserInfoPopup();
        document.removeEventListener('keydown', escHandler);
      }
    });
  }

  function closeUserInfoPopup() {
    document.getElementById('user-info-popup').style.display = 'none';
  }

  function infoRow(icon, label, value) {
    return `
      <div>
        <span>${icon} <b>${label}:</b></span>
        <span>${value || '—'}</span>
      </div>
    `;
  }

  // // ⚙️ Mở popup cấu hình câu hỏi (phiên bản nhóm theo năng lực)
  // function openConfigRolePage() {
  //   if (!isAdmin) return;

  //   // Tạo container riêng cho admin (KHÔNG dùng popup)
  //   let adminContainer = document.getElementById('admin-config-container');
    
  //   if (!adminContainer) {
  //     adminContainer = document.createElement('div');
  //     adminContainer.id = 'admin-config-container';
  //     adminContainer.style.cssText = `
  //       max-width: 1400px;
  //       margin: 20px auto;
  //       background: white;
  //       border-radius: 16px;
  //       padding: 40px;
  //       box-shadow: 0 4px 20px rgba(0,0,0,0.1);
  //     `;
      
  //     const overlay = document.querySelector('.overlay');
  //     const content = document.getElementById('content');
  //     overlay.insertBefore(adminContainer, content);
  //   }

  //   // Loading
  //   adminContainer.innerHTML = `
  //     <div style="text-align:center; padding:60px 20px;">
  //       <div class="spinner" style="margin:0 auto 20px;"></div>
  //       <p style="color:#666; font-size:16px;">⏳ Đang tải cấu hình...</p>
  //     </div>
  //   `;

  //   google.script.run
  //     .withSuccessHandler((data) => {
  //       const { cauHoi, configs, roles } = data;
  //       const cauHoiGrouped = cauHoi;
  //       const configsMap = configs.reduce((acc, c) => {
  //         const r = String(c.chucvu || "").trim();
  //         if (!acc[r]) acc[r] = [];
  //         acc[r].push(String(c.cauHoiId || "").trim());
  //         return acc;
  //       }, {});

  //       // HTML cho trang admin
  //       let html = `
  //         <div style="text-align:center; margin-bottom:40px;">
  //           <h2 style="color:#0078d7; font-size:32px; font-weight:700; margin:0 0 10px;">
  //             ⚙️ Cấu hình câu hỏi theo chức danh
  //           </h2>
  //           <p style="color:#666; font-size:16px;">
  //             Chọn câu hỏi áp dụng cho từng chức danh (nhóm theo năng lực)
  //           </p>
  //         </div>

  //         <div style="display:flex; gap:25px; flex-wrap:wrap; align-items:flex-start;">

  //           <!-- Danh sách chức danh -->
  //           <div id="roleList" style="
  //             flex:1;
  //             min-width:250px;
  //             max-width:300px;
  //             max-height:65vh;
  //             overflow-y:auto;
  //             border-right:2px solid #e0e0e0;
  //             padding-right:20px;
  //           ">
  //             ${roles.map(r => `
  //               <div class="role-item" style="
  //                 padding:14px 18px;
  //                 border-radius:8px;
  //                 margin:8px 0;
  //                 cursor:pointer;
  //                 border:2px solid #e9ecef;
  //                 transition:all 0.2s;
  //                 font-weight:500;
  //                 background:white;
  //               "
  //               onclick="showRoleQuestions('${r}')"
  //               onmouseover="if(!this.classList.contains('active')) {this.style.background='#e8f4ff'; this.style.borderColor='#0078d7'}"
  //               onmouseout="if(!this.classList.contains('active')) {this.style.background='white'; this.style.borderColor='#e9ecef'}">
  //                 <b>${r}</b>
  //               </div>
  //             `).join("")}
  //           </div>

  //           <!-- Danh sách câu hỏi -->
  //           <div id="questionList" style="
  //             flex:3;
  //             min-width:500px;
  //             max-height:65vh;
  //             overflow-y:auto;
  //             padding:20px;
  //             border:2px solid #e0e0e0;
  //             border-radius:12px;
  //             background:#fafbfc;
  //           ">
  //             <p style="color:#777; text-align:center; padding:40px 20px;">
  //               👉 Chọn một chức danh ở bên trái để xem câu hỏi
  //             </p>
  //           </div>
  //         </div>

  //         <!-- Nút lưu -->
  //         <div style="text-align:center; margin-top:30px; padding-top:20px; border-top:2px solid #e0e0e0;">
  //           <button onclick="saveRoleConfig()" style="
  //             background:#0078d7;
  //             color:white;
  //             border:none;
  //             padding:14px 40px;
  //             border-radius:25px;
  //             font-size:16px;
  //             font-weight:600;
  //             cursor:pointer;
  //             box-shadow:0 4px 12px rgba(0,120,215,0.3);
  //             transition:all 0.3s;
  //           "
  //           onmouseover="this.style.transform='translateY(-2px)'; this.style.boxShadow='0 6px 18px rgba(0,120,215,0.4)'"
  //           onmouseout="this.style.transform='translateY(0)'; this.style.boxShadow='0 4px 12px rgba(0,120,215,0.3)'">
  //             💾 Lưu thay đổi
  //           </button>
  //         </div>
  //       `;

  //       adminContainer.innerHTML = html;

  //       // Lưu dữ liệu vào biến toàn cục
  //       window._cauHoiGrouped = cauHoiGrouped;
  //       window._configsMap = configsMap;
  //       window._roles = roles;
  //     })
  //     .withFailureHandler((err) => {
  //       adminContainer.innerHTML = `
  //         <div style="text-align:center; padding:40px;">
  //           <h3 style="color:#dc3545;">❌ Lỗi</h3>
  //           <p style="color:#666;">Không thể tải cấu hình: ${err.message}</p>
  //         </div>
  //       `;
  //     })
  //     .getCauHoiConfigDataForUI();
  // }

  // 📋 Hiển thị câu hỏi theo NĂNG LỰC
  function showRoleQuestions(role) {
    document.querySelectorAll('.role-item').forEach(item => {
      item.classList.remove('active');
      item.style.background = 'white';
      item.style.borderColor = '#e9ecef';
      item.style.color = '#333';
    });
    
    event.target.closest('.role-item').classList.add('active');
    event.target.closest('.role-item').style.background = 'linear-gradient(135deg, #0078d7 0%, #005ea6 100%)';
    event.target.closest('.role-item').style.color = 'white';
    event.target.closest('.role-item').style.borderColor = '#0078d7';

    const cauHoiGrouped = window._cauHoiGrouped;
    const configsMap = window._configsMap;
    const allowed = configsMap[role] || [];
    const container = document.getElementById("questionList");

    let html = `
      <h4 style="color:#0078d7; margin-top:0;">${role}</h4>
      <p style="font-size:13px; color:#666; margin-bottom:10px;">
        Tích chọn các câu hỏi áp dụng cho chức danh này.
      </p>
      
      <!-- ✅ NÚT CHỌN TẤT CẢ TOÀN BỘ -->
      <div style="display:flex; gap:8px; margin-bottom:15px; padding:10px; background:#f8f9fa; border-radius:8px;">
        <button type="button" class="btn-mini" onclick="toggleAllQuestions('${role}', true)" style="flex:1;">
          ✅ Chọn tất cả câu hỏi
        </button>
        <button type="button" class="btn-mini" onclick="toggleAllQuestions('${role}', false)" style="flex:1;">
          ❌ Bỏ chọn tất cả
        </button>
      </div>
    `;

    // ✅ BƯỚC 1: Thu thập tất cả năng lực và tìm thứ tự nhỏ nhất
    const nangLucList = [];
    
    Object.keys(cauHoiGrouped).forEach((nangLuc) => {
      let minThuTu = 999999;
      
      // Tìm thứ tự nhỏ nhất trong năng lực này
      Object.keys(cauHoiGrouped[nangLuc]).forEach(nangLucCon => {
        cauHoiGrouped[nangLuc][nangLucCon].forEach(q => {
          const thuTu = q.thuTu || q.index || 999999;
          if (thuTu < minThuTu) minThuTu = thuTu;
        });
      });
      
      nangLucList.push({ 
        ten: nangLuc, 
        thuTu: minThuTu 
      });
    });

    // ✅ BƯỚC 2: Sắp xếp các năng lực theo thứ tự
    nangLucList.sort((a, b) => a.thuTu - b.thuTu);

    // ✅ BƯỚC 3: Render theo thứ tự đã sắp
    nangLucList.forEach(({ ten: nangLuc }) => {
      html += `
        <div class="competency-block" style="margin:10px 0; padding:10px; border:1px solid #ddd; border-radius:8px;">
          <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:6px;">
            <div style="font-weight:600; color:#0078d7; font-size:16px;">🏆 ${nangLuc}</div>
            <div style="display:flex; gap:6px;">
              <button type="button" class="btn-mini" onclick="toggleAllInGroup('${role}','${nangLuc}', true)">Chọn tất cả</button>
              <button type="button" class="btn-mini" onclick="toggleAllInGroup('${role}','${nangLuc}', false)">Bỏ chọn</button>
            </div>
          </div>
      `;

      const subGroup = cauHoiGrouped[nangLuc];

      // ✅ BƯỚC 4: Sắp xếp các năng lực con theo thứ tự
      const nangLucConList = [];
      
      Object.keys(subGroup).forEach(nangLucCon => {
        const questions = subGroup[nangLucCon];
        const minThuTu = Math.min(...questions.map(q => q.thuTu || q.index || 999999));
        nangLucConList.push({
          ten: nangLucCon,
          questions: questions,
          thuTu: minThuTu
        });
      });

      // Sắp xếp năng lực con
      nangLucConList.sort((a, b) => a.thuTu - b.thuTu);

      // ✅ BƯỚC 5: Render từng năng lực con
      nangLucConList.forEach(({ ten: nangLucCon, questions }) => {
        html += `
          <div style="margin:6px 0 4px 10px; font-weight:500; color:#444;">➤ ${nangLucCon}</div>
        `;

        // ✅ Sắp xếp câu hỏi trong năng lực con
        const sortedQuestions = [...questions].sort((a, b) => {
          const thuTuA = a.thuTu || a.index || 999999;
          const thuTuB = b.thuTu || b.index || 999999;
          return thuTuA - thuTuB;
        });

        sortedQuestions.forEach((q) => {
          const checked = allowed.includes(String(q.id)) ? "checked" : "";
          const typeLabel = q.loai === "text" ? " " : " ";
          const typeColor = q.loai === "text" ? "color:#28a745;" : "color:#0078d7;";

          html += `
            <label style="display:block; margin-left:25px; margin-bottom:3px; font-size:14px;">
              <input type="checkbox"
                    class="question-checkbox"
                    data-role="${role}"
                    data-nangluc="${nangLuc}"
                    value="${q.id}"
                    ${checked}>
              <span style="${typeColor}">${typeLabel}</span> ${q.noidung}
            </label>
          `;
        });
      });

      html += `</div>`;
    });

    container.innerHTML = html;
    window._selectedRole = role;
  }

  // ✅ NÚT CHỌN/BỎ TẤT CẢ TOÀN BỘ CÂU HỎI
  function toggleAllQuestions(role, isSelectAll) {
    const boxes = document.querySelectorAll(
      `.question-checkbox[data-role="${role}"]`
    );
    boxes.forEach((cb) => (cb.checked = isSelectAll));
  }

  // Chọn tất cả / Bỏ chọn tất cả theo từng năng lực
  function toggleAllInGroup(role, nangLuc, isSelectAll) {
    const boxes = document.querySelectorAll(
      `.question-checkbox[data-role="${role}"][data-nangluc="${nangLuc}"]`
    );
    boxes.forEach((cb) => (cb.checked = isSelectAll));
  }

  // ✅ Lưu cấu hình - CHO PHÉP RỖNG
  function saveRoleConfig() {
    const checkboxes = document.querySelectorAll('#popup-content input[type="checkbox"]');
    const configList = Array.from(checkboxes)
      .filter((cb) => cb.checked)
      .map((cb) => ({
        chucvu: cb.dataset.role,
        cauHoiId: cb.value
      }));

    // ✅ Lấy role hiện tại (cần lưu ngay cả khi rỗng)
    const currentRole = window._selectedRole;
    
    if (!currentRole) {
      showToast("⚠️ Vui lòng chọn một chức danh trước khi lưu", "error");
      return;
    }

    google.script.run
      .withSuccessHandler(() => {
        showToast("Đã lưu cấu hình thành công!", "success");
      })
      .withFailureHandler((err) => {
        showToast("❌ Lỗi: " + err.message, "error");
      })
      .saveCauHoiConfigByRole(configList, currentRole);
  }

    window.handleSearchSelectFromCard = function(el){
    var id     = String(el.dataset.id || '');
    var ten    = el.dataset.ten || '';
    var avatar = el.dataset.avatar || 'https://cdn-icons-png.flaticon.com/512/847/847969.png';
    var status = el.dataset.status || 'chua'; // 'da' | 'dang' | 'chua'

    // ✅ Xóa kết quả tìm kiếm
    var res   = document.getElementById('searchResults');
    var input = document.getElementById('employeeSearch');
    
    if (res) res.innerHTML = '';
    if (input) input.value = '';

    // ✅ Scroll lên đầu trang
    try { window.scrollTo({ top: 0, behavior: 'smooth' }); } catch(e) {}

    // ✅ Xử lý theo trạng thái
    if (status === 'da') {
      window.viewEvaluationResult(id, ten);
    } else {
      // Nếu chưa đánh giá hoặc đang draft → mở trang đánh giá
      // (openPopup sẽ tự động ẩn content, title, searchContainer, progress-section)
      window.openPopup(id, ten, avatar);
    }

    return false;
  };

  // Đảm bảo global
  window.openPopup = window.openPopup;
  window.viewEvaluationResult = window.viewEvaluationResult;

  window.addEventListener('load', () => {
    document.getElementById('language-selector-popup').style.display = 'flex';
    document.querySelector('.overlay').style.display = 'none';
  });

  // Hàm xử lý khi chọn ngôn ngữ từ popup
  function selectLanguageAndStart(lang) {
    currentLang = lang;
    localStorage.setItem('lang', lang);
    updateLanguageButtonDisplay(lang);
    
    document.getElementById('language-selector-popup').style.display = 'none';
    
    if (isAdmin) {
      document.querySelector('.overlay').style.display = 'block';
      showRoleSelector();
      return;
    }
    
    // ✅ CHỈ CHẠY PHẦN NÀY NẾU KHÔNG PHẢI ADMIN
    startEvaluatorMode();
    document.getElementById("evaluationHeaderWrapper").style.display = "none";
    document.querySelector('.overlay').style.display = 'block';
    document.getElementById("evaluationPage").style.display = "none";
    document.getElementById("content").style.display = "block";
    document.getElementById("progress-section").style.display = "block";
    document.getElementById("searchContainer").style.display = "block";
    
    applyLanguage();
    
    // ✅ Kiểm tra tồn tại trước khi toggle class
    const flagVi = document.getElementById('flag-vi');
    const flagEn = document.getElementById('flag-en');
    if (flagVi) flagVi.classList.toggle('flag-active', lang === 'vi');
    if (flagEn) flagEn.classList.toggle('flag-active', lang === 'en');
    
    // Hiện loading
    showLoading();
    
    // Reload dữ liệu theo ngôn ngữ
    google.script.run
      .withSuccessHandler(data => {
        groupedData = data;
        
        // Load lại evaluated và draft
        google.script.run
          .withSuccessHandler(list => {
            evaluatedEmployees = new Set(list.map(id => String(id).trim()));
            
            google.script.run
              .withSuccessHandler(drafts => {
                draftEmployees = new Set(drafts.map(e => e.id));
                
                // ✅ Render lại giao diện với dữ liệu mới
                renderDepartments();
                updateProgress();
                hideLoading();
              })
              .getDraftEmployees(currentUser, lang);
          })
          .getEvaluatedEmployees(currentUser);
      })
      .withFailureHandler(err => {
        hideLoading();
        showToast("Load error: " + err.message, "error");
      })
      .getNhanVienListByLang(currentUser, lang);
    
    // Preload user info
    preloadUserInfoByLang(lang);
  }

  // ===== HÀM RESET VÀ HIỆN POPUP CHỌN NGÔN NGỮ =====
  function resetAndShowLanguageSelector() {
    localStorage.removeItem('lang');
    currentLang = null;
    const overlay = document.querySelector('.overlay');
    if (overlay) overlay.style.display = 'none';
    
    // ✅ ẨN POPUP CHỌN VAI TRÒ (THÊM DÒNG NÀY)
    const rolePopup = document.getElementById('role-selector-popup');
    if (rolePopup) rolePopup.style.display = 'none';
    
    const langPopup = document.getElementById('language-selector-popup');
    if (langPopup) {
      langPopup.style.display = 'flex';
    }
    
    // Reset các biến cache
    groupedData = {};
    evaluatedEmployees = new Set();
    draftEmployees = new Set();
    cachedUserInfo = null;
    cachedUserInfoLang = null;
    
    closePopup();
    closeUserInfoPopup();
    
    window.scrollTo({ top: 0, behavior: 'instant' });
  }
  // Hàm xử lý khi chọn ngôn ngữ từ popup
  function selectLanguageAndStart(lang) {
    currentLang = lang;
    localStorage.setItem('lang', lang);
    updateLanguageButtonDisplay(lang);
    document.getElementById('language-selector-popup').style.display = 'none';
    if (isAdmin) {
      showRoleSelector();
    } else {
      startEvaluatorMode();
    }  
    document.getElementById("evaluationHeaderWrapper").style.display = "none";
    document.querySelector('.overlay').style.display = 'block';
    document.getElementById("evaluationPage").style.display = "none";
    document.getElementById("content").style.display = "block";
    document.getElementById("progress-section").style.display = "block";
    document.getElementById("searchContainer").style.display = "block";
    const searchInput = document.getElementById("employeeSearch");
    const searchResults = document.getElementById("searchResults");
    if (searchInput) searchInput.value = "";
    if (searchResults) searchResults.innerHTML = "";
    const titleElement = document.getElementById('title');
    if (titleElement) {
      titleElement.style.display = "block";
      titleElement.innerText = t('departmentListTitle');
    }
    
    closePopup();
    closeUserInfoPopup();
    
    applyLanguage();
    
    const flagVi = document.getElementById('flag-vi');
    const flagEn = document.getElementById('flag-en');
    if (flagVi) flagVi.classList.toggle('flag-active', lang === 'vi');
    if (flagEn) flagEn.classList.toggle('flag-active', lang === 'en');
    
    window.scrollTo({ top: 0, behavior: 'smooth' });
    
    showLoading();
    
    google.script.run
      .withSuccessHandler(data => {
        groupedData = data;
        
        // Load lại evaluated và draft
        google.script.run
          .withSuccessHandler(list => {
            evaluatedEmployees = new Set(list.map(id => String(id).trim()));
            
            google.script.run
              .withSuccessHandler(drafts => {
                draftEmployees = new Set(drafts.map(e => e.id));
                
                // ✅ Render lại giao diện với dữ liệu mới
                renderDepartments();
                updateProgress();
                hideLoading();
              })
              .getDraftEmployees(currentUser, lang);
          })
          .getEvaluatedEmployees(currentUser);
      })
      .withFailureHandler(err => {
        hideLoading();
        showToast("Load error: " + err.message, "error");
      })
      .getNhanVienListByLang(currentUser, lang);
    
    // Preload user info
    preloadUserInfoByLang(lang);
  }

  // ===== HÀM CẬP NHẬT HIỂN THỊ NGÔN NGỮ TRÊN NÚT =====
  function updateLanguageButtonDisplay(lang) {
    const display = document.getElementById('currentLangDisplay');
    if (display) {
      display.textContent = lang === 'vi' ? 'VI ⮕ EN ' : 'EN ⮕ VN';
    }
  }

  // ===== HIỂN THỊ THÔNG BÁO ĐANG TẢI DRAFT =====
  function showDraftLoadingIndicator() {
    const container = document.getElementById('evaluationContent');
    
    // Tạo thông báo loading ở đầu form
    const loadingBanner = document.createElement('div');
    loadingBanner.id = 'draft-loading-banner';
    loadingBanner.style.cssText = `
      background: linear-gradient(135deg, #fff3cd 0%, #ffeaa7 100%);
      border: 2px solid #ffc107;
      border-radius: 12px;
      padding: 20px;
      margin: 0 0 25px 0;
      display: flex;
      align-items: center;
      gap: 15px;
      animation: slideDown 0.4s ease-out;
      box-shadow: 0 4px 12px rgba(255, 193, 7, 0.3);
    `;
    
    loadingBanner.innerHTML = `
      <div style="
        width: 50px;
        height: 50px;
        border: 4px solid #fff;
        border-top-color: #ffc107;
        border-radius: 50%;
        animation: spin 1s linear infinite;
      "></div>
      
      <div style="flex: 1;">
        <div style="
          font-size: 18px;
          font-weight: 700;
          color: #856404;
          margin-bottom: 5px;
        ">
          ${currentLang === 'vi' ? '📝 Đang tải kết quả...' : '📝 Loading...'}
        </div>
        <div style="
          font-size: 14px;
          color: #856404;
          opacity: 0.8;
        ">
          ${currentLang === 'vi' 
            ? 'Vui lòng đợi trong giây lát...' 
            : 'Please wait a moment...'}
        </div>
      </div>
    `;
    
    // Thêm vào đầu form
    const form = document.getElementById('dgForm');
    if (form) {
      form.insertBefore(loadingBanner, form.firstChild);
    }
  }

  // ===== ẨN THÔNG BÁO VÀ HIỆN THÔNG TIN DRAFT =====
  function hideDraftLoadingIndicator(success = true) {
    const banner = document.getElementById('draft-loading-banner');
    if (!banner) return;
    
    if (success) {
      // Đổi thành thông báo thành công
      banner.style.background = 'linear-gradient(135deg, #d4edda 0%, #c3e6cb 100%)';
      banner.style.borderColor = '#28a745';
      banner.style.boxShadow = '0 4px 12px rgba(40, 167, 69, 0.3)';
      
      banner.innerHTML = `
        <div style="
          width: 50px;
          height: 50px;
          background: #28a745;
          border-radius: 50%;
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 30px;
          color: white;
          animation: bounceIn 0.5s ease-out;
        ">
          ✓
        </div>
        
        <div style="flex: 1;">
          <div style="
            font-size: 18px;
            font-weight: 700;
            color: #155724;
            margin-bottom: 5px;
          ">
            ${currentLang === 'vi' ? 'Đã tải kết quả thành công!' : 'Draft loaded successfully!'}
          </div>
          <div style="
            font-size: 14px;
            color: #155724;
            opacity: 0.8;
          ">
            ${currentLang === 'vi' 
              ? 'Bạn có thể tiếp tục đánh giá từ nơi đã dừng lại hoặc chỉnh sửa đánh giá.' 
              : 'You can continue from where you left off.'}
          </div>
        </div>
        
        <button 
          onclick="document.getElementById('draft-loading-banner').remove()"
          style="
            background: transparent;
            border: none;
            color: #155724;
            font-size: 24px;
            cursor: pointer;
            padding: 5px 10px;
            opacity: 0.6;
            transition: opacity 0.2s;
          "
          onmouseover="this.style.opacity='1'"
          onmouseout="this.style.opacity='0.6'"
        >
          ×
        </button>
      `;
      
      // Tự động ẩn sau 5 giây
      setTimeout(() => {
        if (banner && banner.parentNode) {
          banner.style.animation = 'slideUp 0.4s ease-in';
          setTimeout(() => banner.remove(), 400);
        }
      }, 5000);
    } else {
      // Nếu không có draft, xóa banner luôn
      banner.style.animation = 'slideUp 0.4s ease-in';
      setTimeout(() => banner.remove(), 400);
    }
  }

  // ===== MỞ POPUP TÀI LIỆU HƯỚNG DẪN =====
  function openDocumentation() {
    const popup = document.getElementById('documentation-popup');
    
    // ⚠️ THAY ĐỔI LINK CỦA BẠN Ở ĐÂY
    const docLinkVi = 'https://docs.google.com/presentation/d/13bLxODuaU3wRKorhp5Srecwy1_Wdxf1Jqf3kpq72RT0/edit?usp=sharing';
    const docLinkEn = 'https://docs.google.com/presentation/d/1DAsMiPdDP7qZGnu4Y-yFYf61c8Y9kzTCJlzlGv_oBkI/edit?usp=sharing';
    
    // Set links
    document.getElementById('doc-link-vi').href = docLinkVi;
    document.getElementById('doc-link-en').href = docLinkEn;
    
    const docTitle = document.getElementById('doc-popup-title');
    if (docTitle) docTitle.innerText = t('docTitle');
    
    const docSubtitle = document.getElementById('doc-popup-subtitle');
    if (docSubtitle) docSubtitle.innerText = t('docSubtitle');
    
    const docNote = document.getElementById('doc-popup-note-content');
    if (docNote) docNote.innerHTML = t('docNote');

    popup.style.display = 'flex';
    
    popup.addEventListener('click', function handler(e) {
      if (e.target === popup) {
        closeDocumentation();
        popup.removeEventListener('click', handler);
      }
    });
    
    document.addEventListener('keydown', function escHandler(e) {
      if (e.key === 'Escape') {
        closeDocumentation();
        document.removeEventListener('keydown', escHandler);
      }
    });
  }

  function openConfigRolePageInAdminMode() {
    const adminContent = document.getElementById('admin-content');
    
    // Loading
    adminContent.innerHTML = `
      <div style="text-align:center; padding:60px 20px;">
        <div class="spinner" style="margin:0 auto 20px;"></div>
        <p style="color:#666; font-size:16px;">⏳ Đang tải cấu hình...</p>
      </div>
    `;

    google.script.run
      .withSuccessHandler((data) => {
        const { cauHoi, configs, roles } = data;
        const cauHoiGrouped = cauHoi;
        const configsMap = configs.reduce((acc, c) => {
          const r = String(c.chucvu || "").trim();
          if (!acc[r]) acc[r] = [];
          acc[r].push(String(c.cauHoiId || "").trim());
          return acc;
        }, {});

        // HTML cho trang admin
        let html = `
          <div style="display:flex; gap:25px; flex-wrap:wrap; align-items:flex-start; max-width:1400px; margin:0 auto;">

            <!-- Danh sách chức danh -->
            <div id="roleList" style="
              flex:1;
              min-width:250px;
              max-width:300px;
              max-height:65vh;
              overflow-y:auto;
              border-right:2px solid #e0e0e0;
              padding-right:20px;
            ">
              ${roles.map(r => `
                <div class="role-item" style="
                  padding:14px 18px;
                  border-radius:8px;
                  margin:8px 0;
                  cursor:pointer;
                  border:2px solid #e9ecef;
                  transition:all 0.2s;
                  font-weight:500;
                  background:white;
                "
                onclick="showRoleQuestions('${r}')"
                onmouseover="if(!this.classList.contains('active')) {this.style.background='#e8f4ff'; this.style.borderColor='#0078d7'}"
                onmouseout="if(!this.classList.contains('active')) {this.style.background='white'; this.style.borderColor='#e9ecef'}">
                  <b>${r}</b>
                </div>
              `).join("")}
            </div>

            <!-- Danh sách câu hỏi -->
            <div id="questionList" style="
              flex:3;
              min-width:500px;
              max-height:65vh;
              overflow-y:auto;
              padding:20px;
              border:2px solid #e0e0e0;
              border-radius:12px;
              background:#fafbfc;
            ">
              <p style="color:#777; text-align:center; padding:40px 20px;">
                👉 Chọn một chức danh ở bên trái để xem câu hỏi
              </p>
            </div>
          </div>

          <!-- Nút lưu -->
          <div style="text-align:center; margin-top:30px; padding-top:20px; border-top:2px solid #e0e0e0;">
            <button onclick="saveRoleConfig()" style="
              background:#0078d7;
              color:white;
              border:none;
              padding:14px 40px;
              border-radius:25px;
              font-size:16px;
              font-weight:600;
              cursor:pointer;
              box-shadow:0 4px 12px rgba(0,120,215,0.3);
              transition:all 0.3s;
            "
            onmouseover="this.style.transform='translateY(-2px)'; this.style.boxShadow='0 6px 18px rgba(0,120,215,0.4)'"
            onmouseout="this.style.transform='translateY(0)'; this.style.boxShadow='0 4px 12px rgba(0,120,215,0.3)'">
              💾 Lưu thay đổi
            </button>
          </div>
        `;

        adminContent.innerHTML = html;

        // Lưu dữ liệu vào biến toàn cục
        window._cauHoiGrouped = cauHoiGrouped;
        window._configsMap = configsMap;
        window._roles = roles;
      })
      .withFailureHandler((err) => {
        adminContent.innerHTML = `
          <div style="text-align:center; padding:40px;">
            <h3 style="color:#dc3545;">❌ Lỗi</h3>
            <p style="color:#666;">Không thể tải cấu hình: ${err.message}</p>
          </div>
        `;
      })
      .getCauHoiConfigDataForUI();
  }

  // ===== ĐÓNG POPUP TÀI LIỆU =====
  function closeDocumentation() {
    const popup = document.getElementById('documentation-popup');
    popup.style.display = 'none';
  }

  // ===== MỞ POPUP GÓP Ý =====
  function openFeedbackPopup() {
    const popup = document.getElementById('feedback-popup');
    
    // Cập nhật text theo ngôn ngữ
    const feedbackTitle = document.getElementById('feedback-popup-title');
    if (feedbackTitle) feedbackTitle.innerText = t('feedbackTitle');
    
    const feedbackSubtitle = document.getElementById('feedback-popup-subtitle');
    if (feedbackSubtitle) feedbackSubtitle.innerText = t('feedbackSubtitle');
    
    const labelGood = document.getElementById('feedback-label-good');
    if (labelGood) labelGood.innerText = '✅ ' + t('feedbackGoodPoints');
    
    const labelBad = document.getElementById('feedback-label-bad');
    if (labelBad) labelBad.innerText = '⚠️ ' + t('feedbackBadPoints');
    
    const labelSuggest = document.getElementById('feedback-label-suggest');
    if (labelSuggest) labelSuggest.innerText = '💡 ' + t('feedbackSuggestions');
    
    // Cập nhật placeholder
    const inputGood = document.getElementById('feedback-good');
    if (inputGood) inputGood.placeholder = t('feedbackGoodPointsPlaceholder');
    
    const inputBad = document.getElementById('feedback-bad');
    if (inputBad) inputBad.placeholder = t('feedbackBadPointsPlaceholder');
    
    const inputSuggest = document.getElementById('feedback-suggest');
    if (inputSuggest) inputSuggest.placeholder = t('feedbackSuggestionsPlaceholder');
    
    // Cập nhật buttons
    const btnCancel = document.getElementById('feedback-btn-cancel');
    if (btnCancel) btnCancel.innerText = t('feedbackCancel');
    
    const btnSubmit = document.getElementById('feedback-btn-submit');
    if (btnSubmit) btnSubmit.innerText = t('feedbackSubmit');
    
    // Reset form
    document.getElementById('feedback-good').value = '';
    document.getElementById('feedback-bad').value = '';
    document.getElementById('feedback-suggest').value = '';
    
    popup.style.display = 'flex';
    
    // Đóng khi click outside
    // popup.addEventListener('click', function handler(e) {
    //   if (e.target === popup) {
    //     closeFeedbackPopup();
    //     popup.removeEventListener('click', handler);
    //   }
    // });
    
    // // Đóng khi nhấn ESC
    // document.addEventListener('keydown', function escHandler(e) {
    //   if (e.key === 'Escape') {
    //     closeFeedbackPopup();
    //     document.removeEventListener('keydown', escHandler);
    //   }
    // });
  }

  // ===== ĐÓNG POPUP GÓP Ý =====
  function closeFeedbackPopup() {
    document.getElementById('feedback-popup').style.display = 'none';
  }

  // ===== GỬI GÓP Ý =====
  function submitFeedbackForm(event) {
    event.preventDefault();
    
    const good = document.getElementById('feedback-good').value.trim();
    const bad = document.getElementById('feedback-bad').value.trim();
    const suggest = document.getElementById('feedback-suggest').value.trim();
    
    // Kiểm tra ít nhất 1 trường được điền
    if (!good && !bad && !suggest) {
      showToast(t('feedbackRequired'), 'error');
      return;
    }
    
    const feedbackData = {
      diemTot: good,
      diemChuaTot: bad,
      deXuat: suggest
    };
    
    showLoading();
    
    google.script.run
      .withSuccessHandler(() => {
        hideLoading();
        closeFeedbackPopup();
        showToast(t('feedbackSuccess'), 'success');
      })
      .withFailureHandler(err => {
        hideLoading();
        showToast(t('feedbackError') + ': ' + err.message, 'error');
      })
      .submitFeedback(feedbackData, currentUser);
  }

  // ===== HIỂN THỊ POPUP CHỌN VAI TRÒ =====
  function showRoleSelector() {
    const popup = document.getElementById('role-selector-popup');
    
    // Cập nhật text theo ngôn ngữ
    const title = document.getElementById('role-selector-title');
    if (title) title.innerText = t('roleSelectionTitle');
    
    const subtitle = document.getElementById('role-selector-subtitle');
    if (subtitle) subtitle.innerText = t('roleSelectionSubtitle');
    
    const adminTitle = document.getElementById('role-admin-title');
    if (adminTitle) adminTitle.innerText = t('roleAdmin');
    
    const adminDesc = document.getElementById('role-admin-desc');
    if (adminDesc) adminDesc.innerText = t('roleAdminDesc');
    
    const evaluatorTitle = document.getElementById('role-evaluator-title');
    if (evaluatorTitle) evaluatorTitle.innerText = t('roleEvaluator');
    
    const evaluatorDesc = document.getElementById('role-evaluator-desc');
    if (evaluatorDesc) evaluatorDesc.innerText = t('roleEvaluatorDesc');
    
    popup.style.display = 'flex';
  }

  // ===== XỬ LÝ CHỌN VAI TRÒ =====
  function selectRole(role) {
    document.getElementById('role-selector-popup').style.display = 'none';
    
    if (role === 'admin') {
      startAdminMode();
    } else {
      startEvaluatorMode();
    }
  }

  // ===== VÀO TRANG QUẢN TRỊ =====
function startAdminMode() {
  isInAdminMode = true;
  // ẨN HOÀN TOÀN TẤT CẢ PHẦN ĐÁNH GIÁ
  document.getElementById('userMenu').style.display = 'none';
  document.getElementById("searchContainer").style.display = "none";
  document.getElementById("progress-section").style.display = "none";
  document.getElementById("content").style.display = "none";
  document.getElementById("evaluationPage").style.display = "none";
  document.getElementById("evaluationHeaderWrapper").style.display = "none";
  document.getElementById("title").style.display = "none";
  
  // ✅ VÔ HIỆU HÓA LOGO
  const logo = document.getElementById('header-logo');
  if (logo) {
    logo.style.cursor = 'default';
    logo.onclick = null;
  }

  // ẨN FOOTER
  const footer = document.getElementById('footer');
  if (footer) footer.style.display = 'none';
  
  // ✅ ẨN NÚT BACK TO TOP VÀ FLOATING BACK
  const backToTopBtn = document.getElementById('backToTopBtn');
  const floatingBackBtn = document.getElementById('floatingBackBtn');
  if (backToTopBtn) backToTopBtn.style.display = 'none';
  if (floatingBackBtn) floatingBackBtn.style.display = 'none';
  
  // ✅ HIỆN ADMIN CONTAINER (ĐÃ CÓ SẴN TRONG HTML)
  const adminContainer = document.getElementById("admin-mode-container");
  adminContainer.style.display = "block";
  
  // ✅ NỘI DUNG ADMIN (cập nhật innerHTML)
  adminContainer.innerHTML = `
      <div style="text-align:center; margin-bottom:40px;">
        <h2 style="color:#dc3545; font-size:32px; font-weight:700; margin:0 0 10px;">
          ⚙️ TRANG QUẢN TRỊ HỆ THỐNG
        </h2>
        <p style="color:#666; font-size:16px;">
          Xin chào <b>${currentUser.ten}</b> - Bạn đang ở chế độ quản trị viên
        </p>
      </div>
      
      <!-- 2 BOX CHỨC NĂNG -->
      <div style="display:grid; grid-template-columns:1fr 1fr; gap:30px; margin-bottom:40px;">

        <!-- BOX 1: Cấu hình câu hỏi -->
        <div onclick="openConfigRolePageInAdminMode()" style="
          position:relative;
          background:linear-gradient(135deg, #8fd3f4 0%, #84fab0 100%);
          padding:2px 25px;
          border-radius:20px;
          cursor:pointer;
          transition:all 0.3s;
          box-shadow:0 4px 15px rgba(132,250,176,0.4);
          color:#0f172a;
          height:90px;
        "
        onmouseover="this.style.transform='translateY(-5px)'; this.style.boxShadow='0 8px 25px rgba(132,250,176,0.6)'"
        onmouseout="this.style.transform='translateY(0)'; this.style.boxShadow='0 4px 15px rgba(132,250,176,0.4)'">

          <!-- ICON -->
          <div style="
            position:absolute;
            left:25px;
            top:50%;
            transform:translateY(-50%);
            font-size:45px;
          ">⚙️</div>

          <!-- TEXT CENTER -->
          <div style="
            height:100%;
            display:flex;
            flex-direction:column;
            justify-content:center;
            align-items:center;
            text-align:center;
          ">
            <h3 style="margin:0 0 6px; font-size:18px;">Cấu hình câu hỏi</h3>
            <p style="margin:0; font-size:13px; opacity:0.85;">
              Chọn câu hỏi áp dụng cho từng chức danh
            </p>
          </div>
        </div>


        <!-- BOX 2: Chọn người đánh giá -->
        <div onclick="openEvaluatorManager()" style="
          position:relative;
          background:linear-gradient(135deg, #f093fb 0%, #f5576c 100%);
          padding:2px 25px;
          border-radius:20px;
          cursor:pointer;
          transition:all 0.3s;
          box-shadow:0 4px 15px rgba(245,87,108,0.3);
          color:white;
          height:90px;
        "
        onmouseover="this.style.transform='translateY(-5px)'; this.style.boxShadow='0 8px 25px rgba(245,87,108,0.5)'"
        onmouseout="this.style.transform='translateY(0)'; this.style.boxShadow='0 4px 15px rgba(245,87,108,0.3)'">

          <!-- ICON -->
          <div style="
            position:absolute;
            left:25px;
            top:50%;
            transform:translateY(-50%);
            font-size:45px;
          ">👥</div>

          <!-- TEXT CENTER -->
          <div style="
            height:100%;
            display:flex;
            flex-direction:column;
            justify-content:center;
            align-items:center;
            text-align:center;
          ">
            <h3 style="margin:0 0 6px; font-size:18px;">Chọn người đánh giá</h3>
            <p style="margin:0; font-size:13px; opacity:0.9;">
              Quản lý ai đánh giá ai trong hệ thống
            </p>
          </div>
        </div>
</div>

<div id="admin-content"></div>
    `;
  
  // // Mở trang config
  // openConfigRolePageInAdminMode();
}

  // ===== VÀO TRANG ĐÁNH GIÁ =====
  function startEvaluatorMode() {
    isInAdminMode = false;
    document.querySelector('.overlay').style.display = 'block';
    document.getElementById('userMenu').style.display = 'block';
    
    // ✅ HIỆN LẠI CÁC NÚT (đã ẩn khi vào admin)
    const backToTopBtn = document.getElementById('backToTopBtn');
    const floatingBackBtn = document.getElementById('floatingBackBtn');
    if (backToTopBtn) backToTopBtn.style.display = 'none'; // sẽ hiện khi scroll
    if (floatingBackBtn) floatingBackBtn.style.display = 'none'; // sẽ hiện khi scroll

    // ✅ KÍCH HOẠT LẠI LOGO
    const logo = document.getElementById('header-logo');
    if (logo) {
      logo.style.cursor = 'pointer';
      logo.style.opacity = '1';
      logo.onclick = goToHome;
    }
    
    // ✅ HIỆN FOOTER
    const footer = document.getElementById('footer');
    if (footer) footer.style.display = 'block';
    
    // ✅ HIỆN TẤT CẢ PHẦN ĐÁNH GIÁ
    document.getElementById("evaluationPage").style.display = "none";
    document.getElementById("content").style.display = "block";
    document.getElementById("progress-section").style.display = "block";
    document.getElementById("searchContainer").style.display = "block";
    
    // ✅ ẨN ADMIN CONTAINER NẾU CÓ
    const adminContainer = document.getElementById('admin-mode-container');
    if (adminContainer) {
      adminContainer.style.display = 'none';
    }
    
    // Reset search
    const searchInput = document.getElementById("employeeSearch");
    const searchResults = document.getElementById("searchResults");
    if (searchInput) searchInput.value = "";
    if (searchResults) searchResults.innerHTML = "";
    
    const titleElement = document.getElementById('title');
    if (titleElement) {
      titleElement.style.display = "block";
      titleElement.innerText = t('departmentListTitle');
    }
    
    closePopup();
    closeUserInfoPopup();
    
    applyLanguage();
    
    const flagVi = document.getElementById('flag-vi');
    const flagEn = document.getElementById('flag-en');
    if (flagVi) flagVi.classList.toggle('flag-active', currentLang === 'vi');
    if (flagEn) flagEn.classList.toggle('flag-active', currentLang === 'en');
    
    window.scrollTo({ top: 0, behavior: 'smooth' });
    
    showLoading();
    
    google.script.run
      .withSuccessHandler(data => {
        groupedData = data;
        
        google.script.run
          .withSuccessHandler(list => {
            evaluatedEmployees = new Set(list.map(id => String(id).trim()));
            
            google.script.run
              .withSuccessHandler(drafts => {
                draftEmployees = new Set(drafts.map(e => e.id));
                
                renderDepartments();
                updateProgress();
                hideLoading();
              })
              .getDraftEmployees(currentUser, currentLang);
          })
          .getEvaluatedEmployees(currentUser);
      })
      .withFailureHandler(err => {
        hideLoading();
        showToast("Load error: " + err.message, "error");
      })
      .getNhanVienListByLang(currentUser, currentLang);
    
    preloadUserInfoByLang(currentLang);
  }

function openEvaluatorManager() {
  const adminContent = document.getElementById('admin-content');
  
  adminContent.innerHTML = `
    <div style="text-align:center; padding:60px 20px;">
      <div class="spinner" style="margin:0 auto 20px;"></div>
      <p style="color:#666; font-size:16px;">⏳ Đang tải dữ liệu nhân viên...</p>
    </div>
  `;
  
  google.script.run
    .withSuccessHandler(employees => {
      renderEvaluatorManager(employees);
    })
    .withFailureHandler(err => {
      adminContent.innerHTML = `
        <div style="text-align:center; padding:40px;">
          <h3 style="color:#dc3545;">❌ Lỗi</h3>
          <p style="color:#666;">Không thể tải dữ liệu: ${err.message}</p>
        </div>
      `;
    })
    .getAllEmployeesForAdmin();
}

function renderEvaluatorManager(employees) {
  const adminContent = document.getElementById('admin-content');
  
  // Nhóm theo Cơ sở -> Bộ phận
  const grouped = {};
  
  employees.forEach(emp => {
    const cs = emp.phongban;
    const bp = emp.bophan;
    
    if (!grouped[cs]) grouped[cs] = {};
    if (!grouped[cs][bp]) grouped[cs][bp] = [];
    
    grouped[cs][bp].push(emp);
  });
  
  let html = `
    <div style="margin-bottom:30px;">
      <h3 style="color:#0078d7; font-size:24px;">👥 Quản lý người đánh giá</h3>
      <p style="color:#666;">Click vào từng cơ sở để xem danh sách nhân viên</p>
    </div>
    
    <!-- ✅ THÊM THANH TÌM KIẾM -->
    <div style="margin-bottom:20px;">
      <input 
        type="text" 
        id="searchAdminEmployee" 
        placeholder="🔍 Tìm theo mã nhân viên, tên hoặc email..."
        oninput="searchAdminEmployee()"
        style="
          width:100%;
          padding:12px 15px;
          border:2px solid #e0e0e0;
          border-radius:8px;
          font-size:14px;
          box-sizing:border-box;
        "
      >
    </div>
    
    <!-- Container kết quả tìm kiếm -->
    <div id="adminSearchResults" style="display:none; margin-bottom:20px;"></div>
    
    <!-- Danh sách theo cơ sở -->
    <div id="adminEmployeeList">
  `;

  // Render từng Cơ sở
  Object.keys(grouped).forEach(coSo => {
    html += `
      <div style="border:2px solid #e0e0e0; border-radius:12px; margin-bottom:15px;">
        <div onclick="toggleCoSo('${coSo}')" style="
          cursor:pointer;
          padding:20px;
          background:#f7faff;
          border-radius:10px;
          display:flex;
          justify-content:space-between;
          align-items:center;
        ">
          <strong style="color:#0078d7; font-size:18px;">🏢 ${coSo}</strong>
          <span id="arrow-${coSo}" style="font-size:20px; color:#0078d7;">▶</span>
        </div>
        
        <div id="coso-${coSo}" style="display:none; padding:20px;">
          <!-- Nội dung bộ phận sẽ render ở đây -->
        </div>
      </div>
    `;
  });
  
  adminContent.innerHTML = html;
  
  // Lưu data vào biến global để dùng sau
  window._employeesData = employees;
  window._groupedData = grouped;
}

function toggleCoSo(coSo) {
  const body = document.getElementById(`coso-${coSo}`);
  const arrow = document.getElementById(`arrow-${coSo}`);
  
  if (body.style.display === 'none') {
    body.style.display = 'block';
    arrow.innerText = '▼';
    
    // Render Bộ phận
    renderBoPhan(coSo);
  } else {
    body.style.display = 'none';
    arrow.innerText = '▶';
  }
}

function toggleBoPhan(boPhanId) {
  const body = document.getElementById(`bophan-${boPhanId}`);
  const arrow = document.getElementById(`arrow-${boPhanId}`);
  
  if (body.style.display === 'none') {
    body.style.display = 'block';
    arrow.innerText = '▼';
  } else {
    body.style.display = 'none';
    arrow.innerText = '▶';
  }
}

function editEvaluators(empId, empName, currentEvaluators) {
  const popup = document.getElementById('popup');
  const content = document.getElementById('popup-content');
  popup.style.display = 'flex';
  
  // Load tất cả nhân viên để chọn
  content.innerHTML = `
    <div style="text-align:center; padding:40px;">
      <div class="spinner" style="margin:0 auto 20px;"></div>
      <p style="color:#666;">Đang tải danh sách nhân viên...</p>
    </div>
  `;
  
  google.script.run
    .withSuccessHandler(allEmployees => {
      renderEditEvaluatorsPopup(empId, empName, currentEvaluators, allEmployees);
    })
    .getAllEmployeesForAdmin();
}

function renderEditEvaluatorsPopup(empId, empName, currentEvaluators, allEmployees) {
  const content = document.getElementById('popup-content');
  
  // Nhóm nhân viên theo Cơ sở -> Bộ phận
  const grouped = {};
  allEmployees.forEach(emp => {
    if (!emp.email) return; // Bỏ qua nếu không có email
    
    const cs = emp.phongban;
    const bp = emp.bophan;
    
    if (!grouped[cs]) grouped[cs] = {};
    if (!grouped[cs][bp]) grouped[cs][bp] = [];
    
    grouped[cs][bp].push(emp);
  });
  
  let html = `
    <div class="popup-header">
      <h3>✏️ Chỉnh sửa người đánh giá</h3>
      <button class="popup-close" onclick="closePopup()">
        <svg viewBox="0 0 24 24">
          <path d="M6 6 L18 18 M18 6 L6 18"
            stroke="currentColor" stroke-width="3"
            stroke-linecap="round" stroke-linejoin="round" fill="none"/>
        </svg>
      </button>
    </div>
    
    <div class="popup-body-scroll" style="padding:20px;">
      <div style="margin-bottom:20px; padding:15px; background:#f0f8ff; border-radius:8px; border-left:4px solid #0078d7;">
        <strong>Nhân viên:</strong> ${empName} (${empId})
      </div>
      
      <!-- Thanh tìm kiếm -->
      <div style="margin-bottom:15px;">
        <input 
          type="text" 
          id="searchEvaluator" 
          placeholder="🔍 Tìm kiếm theo tên hoặc email..."
          oninput="filterEvaluators()"
          style="
            width:100%;
            padding:12px 15px;
            border:2px solid #e0e0e0;
            border-radius:8px;
            font-size:14px;
            box-sizing:border-box;
          "
        >
      </div>
      
        <div style="margin-bottom:15px;">
          <label style="display:block; margin-bottom:10px; font-weight:600; font-size:16px;">
            📋 Chọn người đánh giá:
          </label>
          
          <!-- ✅ Container kết quả tìm kiếm (ĐẶT TRƯỚC evaluatorList) -->
          <div id="searchResultsContainer" style="
            display: none;
            background: white;
            border: 2px solid #667eea;
            border-radius: 8px;
            max-height: 400px;
            overflow-y: auto;
            margin-bottom: 15px;
            box-shadow: 0 4px 12px rgba(102, 126, 234, 0.2);
          "></div>
          
          <!-- Danh sách gốc -->
          <div id="evaluatorList" style="
            border:2px solid #e0e0e0;
            border-radius:8px;
            max-height:400px;
            overflow-y:auto;
            background:#fafbfc;
          ">
          ${Object.keys(grouped).map(coSo => {
            const coSoId = coSo.replace(/\s/g, '_');
            
            return `
              <div style="border-bottom:1px solid #e0e0e0;">
                <div onclick="toggleCoSoInPopup('${coSoId}')" style="
                  cursor:pointer;
                  padding:12px 15px;
                  background:#f0f3ff;
                  display:flex;
                  justify-content:space-between;
                  align-items:center;
                  font-weight:600;
                  color:#0078d7;
                ">
                  <span>🏢 ${coSo}</span>
                  <span id="arrow-popup-${coSoId}" style="font-size:16px;">▶</span>
                </div>
                
                <div id="popup-coso-${coSoId}" style="display:none;">
                  ${Object.keys(grouped[coSo]).map(boPhan => {
                    const boPhanId = `${coSoId}-${boPhan.replace(/\s/g, '_')}`;
                    
                    return `
                      <div style="border-top:1px solid #e9ecef;">
                        <div onclick="toggleBoPhanInPopup('${boPhanId}')" style="
                          cursor:pointer;
                          padding:10px 15px 10px 30px;
                          background:#f8f9fa;
                          display:flex;
                          justify-content:space-between;
                          align-items:center;
                          font-weight:500;
                          color:#667eea;
                        ">
                          <span>📂 ${boPhan}</span>
                          <span id="arrow-popup-${boPhanId}" style="font-size:14px;">▶</span>
                        </div>
                        
                        <div id="popup-bophan-${boPhanId}" style="display:none; padding:8px 15px 8px 45px; background:white;">
                          ${grouped[coSo][boPhan].map(emp => {
                            const isChecked = currentEvaluators.includes(emp.email);
                            return `
                              <label class="evaluator-item" data-name="${emp.ten.toLowerCase()}" data-email="${emp.email.toLowerCase()}" data-id="${emp.id.toLowerCase()}" style="
                                display:flex;
                                align-items:center;
                                padding:8px;
                                margin:4px 0;
                                background:#f8f9fa;
                                border-radius:5px;
                                cursor:pointer;
                                transition:all 0.2s;
                              "
                              onmouseover="this.style.background='#e8f4ff'"
                              onmouseout="this.style.background='#f8f9fa'">
                                <input 
                                  type="checkbox" 
                                  class="evaluator-checkbox" 
                                  value="${emp.email}"
                                  ${isChecked ? 'checked' : ''}
                                  style="margin-right:10px; width:16px; height:16px;">
                                <div style="flex:1;">
                                  <div style="font-weight:500; color:#333;">${emp.ten}</div>
                                  <div style="font-size:12px; color:#666;">${emp.id} • ${emp.email}</div>
                                </div>
                              </label>
                            `;
                          }).join('')}
                        </div>
                      </div>
                    `;
                  }).join('')}
                </div>
              </div>
            `;
          }).join('')}
        </div>
      </div>
      
      <!-- Thông tin đã chọn -->
      <div style="
        background:#e8f5e9;
        border:1px solid #4caf50;
        border-radius:8px;
        padding:12px;
        margin-bottom:15px;
      ">
        <div style="font-weight:600; color:#2e7d32; margin-bottom:8px;">
          ✅ Đã chọn: <span id="selectedCount">0</span> người
        </div>
        
        <div id="selectedList" style="
          display:flex;
          flex-wrap:wrap;
          gap:6px;
          margin-top:8px;
          padding-top:8px;
          border-top:1px solid #4caf5033;
        ">
          <!-- Danh sách người đã chọn sẽ hiện ở đây -->
        </div>
      </div>
      
      <div style="display:flex; gap:10px; justify-content:center;">
        <button onclick="closePopup()" style="
          background:#6c757d;
          color:white;
          border:none;
          padding:12px 24px;
          border-radius:8px;
          cursor:pointer;
          font-size:14px;
          font-weight:600;
        ">❌ Hủy</button>
        
        <button onclick="saveEvaluators('${empId}')" style="
          background:#28a745;
          color:white;
          border:none;
          padding:12px 24px;
          border-radius:8px;
          cursor:pointer;
          font-size:14px;
          font-weight:600;
        ">💾 Lưu thay đổi</button>
      </div>
    </div>
  `;
  
  content.innerHTML = html;
  
  // Cập nhật số lượng đã chọn
  updateSelectedCount();
  
  // Thêm event listener cho checkbox
  document.querySelectorAll('.evaluator-checkbox').forEach(cb => {
    cb.addEventListener('change', updateSelectedCount);
  });
}

function toggleCoSoInPopup(coSoId) {
  const body = document.getElementById(`popup-coso-${coSoId}`);
  const arrow = document.getElementById(`arrow-popup-${coSoId}`);
  
  if (body.style.display === 'none') {
    body.style.display = 'block';
    arrow.innerText = '▼';
  } else {
    body.style.display = 'none';
    arrow.innerText = '▶';
  }
}

function toggleBoPhanInPopup(boPhanId) {
  const body = document.getElementById(`popup-bophan-${boPhanId}`);
  const arrow = document.getElementById(`arrow-popup-${boPhanId}`);
  
  if (body.style.display === 'none') {
    body.style.display = 'block';
    arrow.innerText = '▼';
  } else {
    body.style.display = 'none';
    arrow.innerText = '▶';
  }
}

function filterEvaluators() {
  const keyword = document.getElementById('searchEvaluator').value.toLowerCase().trim();
  const resultsContainer = document.getElementById('searchResultsContainer');
  const evaluatorList = document.getElementById('evaluatorList');
  
  if (!keyword) {
    resultsContainer.style.display = 'none';
    resultsContainer.innerHTML = '';
    evaluatorList.style.display = 'block';
    return;
  }
  
  evaluatorList.style.display = 'none';
  resultsContainer.style.display = 'block';
  resultsContainer.innerHTML = '';
  
  const allItems = evaluatorList.querySelectorAll('.evaluator-item');
  const matchedItems = [];
  
  allItems.forEach(item => {
    const name = (item.dataset.name || '').toLowerCase();
    const email = (item.dataset.email || '').toLowerCase();
    const id = (item.dataset.id || '').toLowerCase();  // ✅ THÊM DÒNG NÀY
    
    // ✅ SỬA ĐIỀU KIỆN TÌM KIẾM
    if (name.includes(keyword) || email.includes(keyword) || id.includes(keyword)) {
      matchedItems.push(item);
    }
  });
  
  // ✅ Hiển thị kết quả
  if (matchedItems.length === 0) {
    resultsContainer.innerHTML = `
      <div style="padding: 20px; text-align: center; color: #999;">
        Không tìm thấy kết quả phù hợp với "${keyword}"
      </div>
    `;
    return;
  }
  
  // ✅ Header kết quả
  const headerDiv = document.createElement('div');
  headerDiv.style.cssText = `
    padding: 12px 15px;
    background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
    color: white;
    font-weight: 600;
    font-size: 14px;
    position: sticky;
    top: 0;
    z-index: 10;
  `;
  headerDiv.innerHTML = `🔍 Tìm thấy ${matchedItems.length} kết quả`;
  resultsContainer.appendChild(headerDiv);
  
  // ✅ Render các item tìm được
  matchedItems.forEach(originalItem => {
    // Clone item
    const clonedItem = originalItem.cloneNode(true);
    
    // Lấy checkbox gốc và clone
    const originalCheckbox = originalItem.querySelector('.evaluator-checkbox');
    const clonedCheckbox = clonedItem.querySelector('.evaluator-checkbox');
    
    if (originalCheckbox && clonedCheckbox) {
      // Đồng bộ trạng thái checked
      clonedCheckbox.checked = originalCheckbox.checked;
      
      // Gắn sự kiện: khi tick clone → cập nhật gốc
      clonedCheckbox.addEventListener('change', function() {
        originalCheckbox.checked = this.checked;
        updateSelectedCount();
      });
    }
    
    resultsContainer.appendChild(clonedItem);
  });
  
  // ✅ Scroll lên đầu
  resultsContainer.scrollTop = 0;
}

function updateSelectedCount() {
  // ✅ CHỈ LẤY CHECKBOX TỪ DANH SÁCH GỐC (evaluatorList)
  const evaluatorList = document.getElementById('evaluatorList');
  if (!evaluatorList) return;
  
  const checkboxes = evaluatorList.querySelectorAll('.evaluator-checkbox:checked');
  const counter = document.getElementById('selectedCount');
  const listContainer = document.getElementById('selectedList');
  
  if (counter) {
    counter.textContent = checkboxes.length;
  }
  
  if (listContainer) {
    if (checkboxes.length === 0) {
      listContainer.innerHTML = '<span style="color:#666; font-size:13px; font-style:italic;">Chưa chọn ai</span>';
    } else {
      const selectedEmails = Array.from(checkboxes).map(cb => {
        const email = cb.value;
        // Tìm tên từ label cha
        const label = cb.closest('.evaluator-item');
        const nameDiv = label ? label.querySelector('div > div:first-child') : null;
        const name = nameDiv ? nameDiv.textContent.trim() : email;
        
        return { email, name };
      });
      
      listContainer.innerHTML = selectedEmails.map(item => `
        <span style="
          display:inline-flex;
          align-items:center;
          background:#2e7d32;
          color:white;
          padding:5px 10px;
          border-radius:15px;
          font-size:12px;
          font-weight:500;
          gap:6px;
        ">
          <span>${item.name}</span>
          <button 
            onclick="uncheckEvaluator('${item.email}')"
            style="
              background:transparent;
              border:none;
              color:white;
              cursor:pointer;
              font-size:14px;
              padding:0;
              margin-left:2px;
              line-height:1;
            "
            title="Bỏ chọn"
          >×</button>
        </span>
      `).join('');
    }
  }
}

function uncheckEvaluator(email) {
  // ✅ CHỈ BỎ TICK CHECKBOX TRONG evaluatorList
  const evaluatorList = document.getElementById('evaluatorList');
  if (!evaluatorList) return;
  
  const checkbox = evaluatorList.querySelector(`.evaluator-checkbox[value="${email}"]`);
  if (checkbox) {
    checkbox.checked = false;
    updateSelectedCount();
  }
}

function saveEvaluators(empId) {
  // ✅ CHỈ LẤY CHECKBOX TỪ DANH SÁCH GỐC
  const evaluatorList = document.getElementById('evaluatorList');
  if (!evaluatorList) {
    showToast('⚠️ Lỗi: Không tìm thấy danh sách người đánh giá', 'error');
    return;
  }
  
  const checkboxes = evaluatorList.querySelectorAll('.evaluator-checkbox:checked');
  const selectedEmails = Array.from(checkboxes).map(cb => cb.value);
  
  // ✅ LỌC BỎ EMAIL TRÙNG (phòng trường hợp có lỗi)
  const uniqueEmails = [...new Set(selectedEmails)];
  
  console.log('📧 Danh sách email gửi lên server:', uniqueEmails);
  
  showLoading();
  
  google.script.run
    .withSuccessHandler(() => {
      hideLoading();
      showToast('Đã lưu thay đổi!', 'success');
      closePopup();
      
      // Reload lại danh sách
      openEvaluatorManager();
    })
    .withFailureHandler(err => {
      hideLoading();
      showToast('❌ Lỗi: ' + err.message, 'error');
    })
    .updateEvaluators(empId, uniqueEmails);
}

function renderBoPhan(coSo) {
  const container = document.getElementById(`coso-${coSo}`);
  const grouped = window._groupedData[coSo];
  
  let html = '';
  
  Object.keys(grouped).forEach(boPhan => {
    const boPhanId = `${coSo}-${boPhan}`.replace(/\s/g, '_'); // ID duy nhất
    
    html += `
      <div style="margin-bottom:15px; border:1px solid #e0e0e0; border-radius:8px;">
        <div onclick="toggleBoPhan('${boPhanId}')" style="
          cursor:pointer;
          padding:12px 15px;
          background:#f8f9fa;
          border-radius:8px;
          display:flex;
          justify-content:space-between;
          align-items:center;
        ">
          <h4 style="color:#667eea; font-size:16px; margin:0;">📂 ${boPhan}</h4>
          <span id="arrow-${boPhanId}" style="font-size:18px; color:#667eea;">▶</span>
        </div>
        
        <div id="bophan-${boPhanId}" style="display:none; padding:15px;">
          <table style="width:100%; border-collapse:collapse;">
            <thead>
              <tr style="background:#f0f3ff;">
                <th style="padding:12px; text-align:left; border:1px solid #ddd; width:10%;">Mã NV</th>
                <th style="padding:12px; text-align:left; border:1px solid #ddd; width:25%;">Họ tên</th>
                <th style="padding:12px; text-align:left; border:1px solid #ddd; width:20%;">Chức vụ</th>
                <th style="padding:12px; text-align:left; border:1px solid #ddd; width:45%;">Người đánh giá</th>
              </tr>
            </thead>
            <tbody>
              ${grouped[boPhan].map(emp => `
                <tr>
                  <td style="padding:10px; border:1px solid #ddd;">${emp.id}</td>
                  <td style="padding:10px; border:1px solid #ddd;"><strong>${emp.ten}</strong></td>
                  <td style="padding:10px; border:1px solid #ddd;">${emp.chucvu}</td>
                  <td style="padding:10px; border:1px solid #ddd;">
                    <div id="evaluators-${emp.id}" style="display:flex; flex-wrap:wrap; gap:5px; align-items:center;">
                      ${emp.evaluators.map(e => `
                        <span style="
                          display:inline-block;
                          background:#e8f5e9;
                          color:#2e7d32;
                          padding:4px 10px;
                          border-radius:12px;
                          font-size:12px;
                        ">${e}</span>
                      `).join('')}
                      ${emp.evaluators.length === 0 ? '<span style="color:#999;">Chưa có</span>' : ''}
                      
                      <button onclick="editEvaluators('${emp.id}', '${emp.ten.replace(/'/g, "\\'")}', ${JSON.stringify(emp.evaluators).replace(/"/g, '&quot;')})" style="
                        background:#0078d7;
                        color:white;
                        border:none;
                        padding:5px 12px;
                        border-radius:5px;
                        font-size:12px;
                        cursor:pointer;
                        margin-left:5px;
                      ">✏️ Sửa</button>
                    </div>
                  </td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      </div>
    `;
  });
  
  container.innerHTML = html;
}

  // ===== TẢI KẾT QUẢ ĐÃ ĐÁNH GIÁ ĐỂ SỬA =====
  function loadEvaluationForEdit(nhanVienId) {
    showDraftLoadingIndicator(); // Hiện loading

    google.script.run
      .withSuccessHandler(result => {

        // ===== 1️⃣ KIỂM TRA KẾT QUẢ =====
        if (!result) {
          console.log('❌ Không có kết quả đánh giá');
          hideDraftLoadingIndicator(false);
          return;
        }

        if (!result.cauHoi) {
          console.log('❌ Không có câu hỏi trong kết quả');
          hideDraftLoadingIndicator(false);
          return;
        }

        const evalContent = document.getElementById('evaluationContent');
        if (!evalContent) {
          console.log('❌ Không tìm thấy evaluationContent');
          hideDraftLoadingIndicator(false);
          return;
        }

        // ===== 2️⃣ HIỂN THỊ THÔNG TIN ĐÁNH GIÁ =====
        const timestamp = new Date(result.ngayDanhGia).toLocaleString(
          currentLang === 'vi' ? 'vi-VN' : 'en-US'
        );

        const infoHtml = `
          <div id="draft-info" class="draft-info" style="background:#fff3cd; border-color:#ffc107;">
            <div class="draft-info-icon">📝</div>
            <div class="draft-info-text">
              <b>${currentLang === 'vi'
                ? 'Đã tải kết quả đánh giá thành công'
                : 'Editing completed evaluation'}</b><br>
              <small>${currentLang === 'vi' ? 'Ngày đánh giá' : 'Evaluated on'}: ${timestamp}</small>
            </div>
          </div>
        `;

        evalContent.insertAdjacentHTML('afterbegin', infoHtml);

        // ===== 3️⃣ ĐIỀN DỮ LIỆU VÀO FORM =====
        const grouped = result.cauHoi;
        let filledCount = 0;

        Object.keys(grouped).forEach(nhom => {
          Object.keys(grouped[nhom]).forEach(sub => {
            grouped[nhom][sub].forEach(q => {
              const value = q.traLoi;
              if (!value) return;

              // ===== SCALE (radio) =====
              if (q.loai === 'scale') {
                const radioInput = document.querySelector(
                  `input[name="${CSS.escape(q.id)}"][value="${CSS.escape(String(value))}"]`
                );
                if (radioInput) {
                  radioInput.checked = true;
                  filledCount++;
                }
              }

              // ===== TEXT (textarea) =====
              if (q.loai === 'text') {
                const textareaInput = document.querySelector(
                  `textarea[name="${CSS.escape(q.id)}"]`
                );
                if (textareaInput) {
                  textareaInput.value = value;
                  filledCount++;
                }
              }
            });
          });
        });

        console.log(`✅ Đã điền ${filledCount} câu trả lời`);
        updateAnswerProgress();
        // ===== 4️⃣ HOÀN TẤT =====
        hideDraftLoadingIndicator(true);
        showToast(
          currentLang === 'vi'
            ? 'Đã tải kết quả đánh giá'
            : 'Evaluation loaded for editing',
          'success'
        );
      })

      // ===== 5️⃣ BẮT LỖI =====
      .withFailureHandler(err => {
        console.error('❌ Lỗi tải kết quả đánh giá:', err);
        hideDraftLoadingIndicator(false);
        showToast(
          currentLang === 'vi'
            ? '⚠️ Không thể tải kết quả đánh giá'
            : '⚠️ Cannot load evaluation result',
          'error'
        );
      })

      // ===== 6️⃣ GỌI SERVER =====
      .getEvaluationResult(nhanVienId, currentUser, currentLang);
  }

  // === KHỞI TẠO TIẾN TRÌNH ===
  function initAnswerProgress() {
    const form = document.getElementById('dgForm');
    if (!form) return;
    
    // Đếm tổng số câu hỏi
    const scaleQuestions = form.querySelectorAll('input[type="radio"]');
    const textQuestions = form.querySelectorAll('textarea.text-answer-table');
    
    // Tính số câu scale (mỗi nhóm radio tính 1 câu)
    const scaleNames = new Set();
    scaleQuestions.forEach(radio => {
      scaleNames.add(radio.name);
    });
    
    const totalQuestions = scaleNames.size + textQuestions.length;
    
    document.getElementById('totalQuestions').textContent = totalQuestions;
    updateAnswerProgress();
  }

  // === CẬP NHẬT TIẾN TRÌNH ===
  function updateAnswerProgress() {
    const form = document.getElementById('dgForm');
    if (!form) return;
    
    let answeredCount = 0;
    
    // Đếm câu scale đã trả lời
    const scaleQuestions = form.querySelectorAll('input[type="radio"]');
    const answeredScales = new Set();
    scaleQuestions.forEach(radio => {
      if (radio.checked) {
        answeredScales.add(radio.name);
      }
    });
    answeredCount += answeredScales.size;
    
    // Đếm câu text đã trả lời
    const textQuestions = form.querySelectorAll('textarea.text-answer-table');
    textQuestions.forEach(textarea => {
      if (textarea.value.trim()) {
        answeredCount++;
      }
    });
    
    const totalQuestions = parseInt(document.getElementById('totalQuestions').textContent) || 0;
    const percentage = totalQuestions > 0 ? (answeredCount / totalQuestions) * 100 : 0;
    
    // Cập nhật UI
    document.getElementById('answeredCount').textContent = answeredCount;
    document.getElementById('answerProgressBar').style.width = percentage + '%';
    document.getElementById('progressPercentage').textContent = Math.round(percentage) + '%';
    
    // ✨ HIỆU ỨNG HOÀN THÀNH 100%
    if (percentage === 100) {
      showCompletionEffect();
    }
  }

  // === HIỆU ỨNG HOÀN THÀNH ===
  function showCompletionEffect() {
    const progressDiv = document.getElementById('answerProgress');
    if (!progressDiv) return;
    
    // Đổi màu sang vàng gold
    progressDiv.style.background = 'linear-gradient(135deg, #fff9c4 0%, #ffd54f 100%)';
    progressDiv.style.borderColor = '#ffc107';
    
    // Thêm icon ngôi sao
    const icon = progressDiv.querySelector('span');
    if (icon) icon.textContent = '⭐';
    
    // Tạo confetti
    createConfetti();
    
    // Quay lại màu xanh sau 3 giây
    setTimeout(() => {
      progressDiv.style.background = 'linear-gradient(135deg, #e8f5e9 0%, #c8e6c9 100%)';
      progressDiv.style.borderColor = '#4caf50';
      if (icon) icon.textContent = '✅';
    }, 3000);
  }

  // === TẠO HIỆU ỨNG CONFETTI ===
  function createConfetti() {
    const colors = ['#ffc107', '#ff9800', '#4caf50', '#2196f3', '#e91e63'];
    const confettiCount = 30;
    
    for (let i = 0; i < confettiCount; i++) {
      setTimeout(() => {
        const confetti = document.createElement('div');
        confetti.style.cssText = `
          position: fixed;
          top: 100px;
          right: ${Math.random() * 300 + 50}px;
          width: 10px;
          height: 10px;
          background: ${colors[Math.floor(Math.random() * colors.length)]};
          border-radius: 50%;
          pointer-events: none;
          z-index: 10000;
          animation: confettiFall ${1 + Math.random()}s ease-out forwards;
        `;
        
        document.body.appendChild(confetti);
        
        setTimeout(() => confetti.remove(), 2000);
      }, i * 50);
    }
  }

  // === THÊM CSS CHO ANIMATION CONFETTI ===
  const style = document.createElement('style');
  style.textContent = `
    @keyframes confettiFall {
      to {
        transform: translateY(100vh) rotate(${Math.random() * 360}deg);
        opacity: 0;
      }
    }
  `;
  document.head.appendChild(style);

  // === TÌM NHÂN VIÊN THEO ID TRONG groupedData ===
  function findEmployeeById(empId) {
    const id = String(empId).trim();
    
    for (let pb in groupedData) {
      for (let cv in groupedData[pb]) {
        const found = groupedData[pb][cv].find(nv => String(nv.id).trim() === id);
        if (found) return found;
      }
    }
    
    return null;
  }

function searchAdminEmployee() {
  const keyword = removeVietnameseTones(
    document.getElementById('searchAdminEmployee').value.trim().toLowerCase()
  );
  
  const resultsContainer = document.getElementById('adminSearchResults');
  const employeeList = document.getElementById('adminEmployeeList');
  
  if (!keyword) {
    resultsContainer.style.display = 'none';
    resultsContainer.innerHTML = '';
    employeeList.style.display = 'block';
    return;
  }
  
  // Ẩn danh sách gốc, hiện kết quả
  employeeList.style.display = 'none';
  resultsContainer.style.display = 'block';
  
  const allEmployees = window._employeesData;
  const matched = allEmployees.filter(emp => {
    const id = removeVietnameseTones(emp.id.toLowerCase());
    const ten = removeVietnameseTones(emp.ten.toLowerCase());
    const email = removeVietnameseTones((emp.email || '').toLowerCase());
    
    return id.includes(keyword) || ten.includes(keyword) || email.includes(keyword);
  });
  
  if (matched.length === 0) {
    resultsContainer.innerHTML = `
      <div style="padding:20px; text-align:center; color:#999; background:#f8f9fa; border-radius:8px;">
        Không tìm thấy nhân viên với từ khóa "<strong>${keyword}</strong>"
      </div>
    `;
    return;
  }
  
  resultsContainer.innerHTML = `
    <div style="background:white; border:2px solid #667eea; border-radius:12px; padding:15px;">
      <div style="
        background:linear-gradient(135deg, #667eea 0%, #764ba2 100%);
        color:white;
        padding:10px 15px;
        border-radius:8px;
        margin-bottom:15px;
        font-weight:600;
      ">
        🔍 Tìm thấy ${matched.length} kết quả
      </div>
      
      <table style="width:100%; border-collapse:collapse;">
        <thead>
          <tr style="background:#f0f3ff;">
            <th style="padding:12px; text-align:left; border:1px solid #ddd; width:10%;">Mã NV</th>
            <th style="padding:12px; text-align:left; border:1px solid #ddd; width:20%;">Họ tên</th>
            <th style="padding:12px; text-align:left; border:1px solid #ddd; width:15%;">Cơ sở</th>
            <th style="padding:12px; text-align:left; border:1px solid #ddd; width:15%;">Bộ phận</th>
            <th style="padding:12px; text-align:left; border:1px solid #ddd; width:15%;">Chức vụ</th>
            <th style="padding:12px; text-align:left; border:1px solid #ddd; width:25%;">Người đánh giá</th>
          </tr>
        </thead>
        <tbody>
          ${matched.map(emp => `
            <tr>
              <td style="padding:10px; border:1px solid #ddd;">${emp.id}</td>
              <td style="padding:10px; border:1px solid #ddd;"><strong>${emp.ten}</strong></td>
              <td style="padding:10px; border:1px solid #ddd;">${emp.phongban}</td>
              <td style="padding:10px; border:1px solid #ddd;">${emp.bophan}</td>
              <td style="padding:10px; border:1px solid #ddd;">${emp.chucvu}</td>
              <td style="padding:10px; border:1px solid #ddd;">
                <div style="display:flex; flex-wrap:wrap; gap:5px; align-items:center;">
                  ${emp.evaluators.map(e => `
                    <span style="
                      display:inline-block;
                      background:#e8f5e9;
                      color:#2e7d32;
                      padding:4px 10px;
                      border-radius:12px;
                      font-size:12px;
                    ">${e}</span>
                  `).join('')}
                  ${emp.evaluators.length === 0 ? '<span style="color:#999;">Chưa có</span>' : ''}
                  
                  <button onclick="editEvaluators('${emp.id}', '${emp.ten.replace(/'/g, "\\'")}', ${JSON.stringify(emp.evaluators).replace(/"/g, '&quot;')})" style="
                    background:#0078d7;
                    color:white;
                    border:none;
                    padding:5px 12px;
                    border-radius:5px;
                    font-size:12px;
                    cursor:pointer;
                    margin-left:5px;
                  ">✏️ Sửa</button>
                </div>
              </td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    </div>
  `;
}