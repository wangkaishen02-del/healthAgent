const form = document.querySelector("#search-form");
const policyTableBody = document.querySelector("#policy-table-body");
const policyCount = document.querySelector("#policy-count");
const menuTrigger = document.querySelector("#menu-trigger");
const menuDropdown = document.querySelector("#menu-dropdown");
const openPolicyQuery = document.querySelector("#open-policy-query");
const openClaimQuery = document.querySelector("#open-claim-query");
const queryTab = document.querySelector("#query-tab");
const claimTab = document.querySelector("#claim-tab");
const policyQueryPage = document.querySelector("#policy-query-page");
const claimQueryPage = document.querySelector("#claim-query-page");
const resetFormButton = document.querySelector("#reset-form");
const policyPagination = document.querySelector("#policy-pagination");
const policyStatusSelect = document.querySelector("#policyStatusSelect");
const policyStatusInput = document.querySelector("#policyStatus");
const policyStatusTrigger = document.querySelector("#policyStatusTrigger");
const policyStatusLabel = document.querySelector("#policyStatusLabel");
const policyStatusMenu = document.querySelector("#policyStatusMenu");
const drawerOverlay = document.querySelector("#drawer-overlay");
const drawerPanel = document.querySelector("#drawer-panel");
const drawerClose = document.querySelector("#drawer-close");
const drawerPolicyTitle = document.querySelector("#drawer-policy-title");
const drawerStatusBadge = document.querySelector("#drawer-status-badge");
const drawerBody = document.querySelector("#drawer-body");

let activePolicyId = null;
let activeDetailTab = "basic";
let currentPolicies = [];
let currentDrawerData = null;
let policyPage = 1;
const policyPageSize = 10;
let insuredPage = 1;
const insuredPageSize = 10;

function switchMainTab(tabName) {
  const isPolicy = tabName === "policy";
  queryTab.classList.toggle("active", isPolicy);
  claimTab.classList.toggle("active", !isPolicy);
  policyQueryPage.classList.toggle("hidden", !isPolicy);
  claimQueryPage.classList.toggle("hidden", isPolicy);
}

function closePolicyStatusMenu() {
  policyStatusMenu.classList.add("hidden");
  policyStatusTrigger.setAttribute("aria-expanded", "false");
}

function openPolicyStatusMenu() {
  policyStatusMenu.classList.remove("hidden");
  policyStatusTrigger.setAttribute("aria-expanded", "true");
}

function setPolicyStatusValue(value, label) {
  policyStatusInput.value = value;
  policyStatusLabel.textContent = label;
  for (const option of policyStatusMenu.querySelectorAll(".custom-select-option")) {
    option.classList.toggle("active", option.dataset.value === value);
  }
}

function formatDateRange(start, end) {
  return `${start} ~ ${end}`;
}

function formatGender(value) {
  if (value === "male") return "男";
  if (value === "female") return "女";
  return "-";
}

function formatInsuredRole(value) {
  if (value === "employee") return "员工";
  if (value === "spouse") return "配偶";
  if (value === "child") return "子女";
  if (value === "parent") return "父母";
  return "-";
}

function renderKeyValueHtml(items) {
  return items
    .map(
      ({ label, value }) => `
        <div class="kv-item">
          <span>${label}</span>
          <strong>${value ?? "-"}</strong>
        </div>
      `,
    )
    .join("");
}

function renderSummaryHtml(items) {
  return items
    .map(
      ({ label, value }) => `
        <div class="summary-item">
          <span>${label}</span>
          <strong>${value}</strong>
        </div>
      `,
    )
    .join("");
}

function renderPaginationHtml(type, currentPage, totalPages, total) {
  return `
    <div class="pagination" data-pagination-type="${type}">
      <span class="pagination-info">第 ${currentPage} / ${totalPages} 页，共 ${total} 条</span>
      <button class="page-btn" data-page-type="${type}" data-page-action="prev" ${currentPage === 1 ? "disabled" : ""}>上一页</button>
      ${Array.from({ length: totalPages }, (_, i) => i + 1)
        .map(
          (page) => `
            <button class="page-btn ${page === currentPage ? "active" : ""}" data-page-type="${type}" data-page-action="goto" data-page-number="${page}">
              ${page}
            </button>
          `,
        )
        .join("")}
      <button class="page-btn" data-page-type="${type}" data-page-action="next" ${currentPage === totalPages ? "disabled" : ""}>下一页</button>
    </div>
  `;
}

function renderBasicSection(data) {
  const basicHtml = renderKeyValueHtml([
    { label: "保单号", value: data.policy.policyNo },
    { label: "保单名称", value: data.policy.policyName },
    { label: "投保单位", value: data.policy.applicantName },
    { label: "投保人类型", value: data.policy.holderType },
    { label: "生效日期", value: data.policy.effectiveDate },
    { label: "终止日期", value: data.policy.expiryDate },
    { label: "承保日期", value: data.policy.underwritingDate },
    { label: "总保费", value: data.policy.totalPremium ?? "-" },
  ]);

  const summaryHtml = renderSummaryHtml([
    { label: "险种数", value: data.products.length },
    { label: "责任数", value: data.products.reduce((sum, item) => sum + item.benefits.length, 0) },
    { label: "被保人数", value: data.insureds.length },
  ]);

  return `
    <div class="grid two">
      <section class="subpanel">
        <h3>保单基本信息</h3>
        <div class="kv-grid">${basicHtml}</div>
      </section>
      <section class="subpanel">
        <h3>概览</h3>
        <div class="summary-grid">${summaryHtml}</div>
      </section>
    </div>
  `;
}

function renderBenefitsSection(data) {
  return `
    <div class="panel-title-row">
      <h3>险种与责任</h3>
      <span class="muted">${data.products.length} 个险种</span>
    </div>
    <div class="product-list">
      ${data.products
        .map(
          (product) => `
            <div class="subpanel">
              <div class="panel-title-row">
                <div>
                  <h4>${product.productName}</h4>
                  <p class="muted">代码：${product.productCode}</p>
                </div>
                <span class="chip">${product.productStatus}</span>
              </div>
              <div class="table-wrapper">
                <table class="compact-table">
                  <thead>
                    <tr>
                      <th>险种代码</th>
                      <th>险种名称</th>
                      <th>险种状态</th>
                      <th>责任代码</th>
                      <th>责任名称</th>
                      <th>顺序</th>
                    </tr>
                  </thead>
                  <tbody>
                    ${product.benefits
                      .map(
                        (benefit) => `
                          <tr>
                            <td>${product.productCode}</td>
                            <td>${product.productName}</td>
                            <td>${product.productStatus}</td>
                            <td>${benefit.benefitCode}</td>
                            <td>${benefit.benefitName}</td>
                            <td>${benefit.sequenceNo ?? "-"}</td>
                          </tr>
                        `,
                      )
                      .join("")}
                  </tbody>
                </table>
              </div>
            </div>
          `,
        )
        .join("")}
    </div>
  `;
}

function renderInsuredsSection(data) {
  const total = data.insureds.length;
  const totalPages = Math.max(1, Math.ceil(total / insuredPageSize));
  if (insuredPage > totalPages) insuredPage = totalPages;
  const start = (insuredPage - 1) * insuredPageSize;
  const pageItems = data.insureds.slice(start, start + insuredPageSize);

  return `
    <div class="panel-title-row">
      <h3>被保人清单</h3>
      <span class="muted">${data.insureds.length} 人</span>
    </div>
    <div class="detail-table-shell">
      <div class="table-wrapper detail-table-wrapper">
        <table>
          <thead>
            <tr>
              <th class="index-col">序号</th>
              <th>被保人编号</th>
              <th>姓名</th>
              <th>性别</th>
              <th>出生日期</th>
              <th>手机号</th>
              <th>证件号</th>
              <th>被保角色</th>
              <th>加入日期</th>
              <th>保障期间</th>
            </tr>
          </thead>
          <tbody>
            ${pageItems
              .map(
                (item, index) => `
                  <tr>
                    <td>${start + index + 1}</td>
                    <td>${item.insuredPerson.insuredNo}</td>
                    <td>${item.insuredPerson.name}</td>
                    <td>${formatGender(item.insuredPerson.gender)}</td>
                    <td>${item.insuredPerson.birthDate ?? "-"}</td>
                    <td>${item.insuredPerson.phone ?? "-"}</td>
                    <td>${item.insuredPerson.idNo ?? "-"}</td>
                    <td>${formatInsuredRole(item.insuredRole)}</td>
                    <td>${item.joinDate ?? "-"}</td>
                    <td>${formatDateRange(item.effectiveDate, item.expiryDate)}</td>
                  </tr>
                `,
              )
              .join("")}
          </tbody>
        </table>
      </div>
      ${renderPaginationHtml("insured", insuredPage, totalPages, total)}
    </div>
  `;
}

function bindDrawerPaginationEvents() {
  if (!currentDrawerData) return;
  for (const element of drawerBody.querySelectorAll("[data-page-type='insured']")) {
    element.addEventListener("click", () => {
      const action = element.dataset.pageAction;
      const totalPages = Math.max(1, Math.ceil(currentDrawerData.insureds.length / insuredPageSize));
      if (action === "prev" && insuredPage > 1) insuredPage -= 1;
      if (action === "next" && insuredPage < totalPages) insuredPage += 1;
      if (action === "goto") insuredPage = Number(element.dataset.pageNumber);
      renderDrawerBody(currentDrawerData);
    });
  }
}

function renderDrawerBody(data) {
  currentDrawerData = data;
  let content = "";
  if (activeDetailTab === "basic") content = renderBasicSection(data);
  if (activeDetailTab === "benefits") content = renderBenefitsSection(data);
  if (activeDetailTab === "insureds") content = renderInsuredsSection(data);

  drawerBody.innerHTML = `
    <div class="drawer-tabs">
      <button class="detail-tab ${activeDetailTab === "basic" ? "active" : ""}" data-drawer-tab="basic">详细信息</button>
      <button class="detail-tab ${activeDetailTab === "benefits" ? "active" : ""}" data-drawer-tab="benefits">责任信息</button>
      <button class="detail-tab ${activeDetailTab === "insureds" ? "active" : ""}" data-drawer-tab="insureds">被保人信息</button>
    </div>
    <div class="drawer-content">${content}</div>
  `;

  for (const element of drawerBody.querySelectorAll("[data-drawer-tab]")) {
    element.addEventListener("click", () => {
      activeDetailTab = element.dataset.drawerTab;
      if (activeDetailTab !== "insureds") insuredPage = 1;
      renderDrawerBody(currentDrawerData);
    });
  }

  bindDrawerPaginationEvents();
}

function openDrawer(data) {
  drawerPolicyTitle.textContent = `${data.policy.policyNo} ｜ ${data.policy.policyName ?? ""} ｜ ${data.policy.applicantName}`;
  drawerStatusBadge.textContent = data.policy.policyStatus;
  drawerStatusBadge.className = `status-badge ${data.policy.policyStatus}`;
  renderDrawerBody(data);
  drawerOverlay.classList.remove("hidden");
  requestAnimationFrame(() => drawerOverlay.classList.add("open"));
}

function closeDrawer() {
  drawerOverlay.classList.remove("open");
  window.setTimeout(() => {
    if (!drawerOverlay.classList.contains("open")) {
      drawerOverlay.classList.add("hidden");
    }
  }, 220);
}

function renderPolicies(items) {
  currentPolicies = items;
  policyCount.textContent = `${items.length} 条`;

  if (!items.length) {
    policyTableBody.innerHTML = `<tr><td colspan="8">没有找到符合条件的保单。</td></tr>`;
    policyPagination.innerHTML = "";
    return;
  }

  const totalPages = Math.max(1, Math.ceil(items.length / policyPageSize));
  if (policyPage > totalPages) policyPage = totalPages;
  const start = (policyPage - 1) * policyPageSize;
  const pageItems = items.slice(start, start + policyPageSize);

  policyTableBody.innerHTML = pageItems
    .map(
      (item, index) => `
        <tr data-policy-id="${item.id}" class="${activePolicyId === item.id ? "active-row" : ""}">
          <td>${start + index + 1}</td>
          <td>${item.policyNo}</td>
          <td>${item.policyName ?? "-"}</td>
          <td>${item.applicantName}</td>
          <td>${item.policyStatus}</td>
          <td>${item.effectiveDate}</td>
          <td>${item.expiryDate}</td>
          <td>${item.insuredCount}</td>
          <td class="actions-cell">
            <button class="action-link" data-action="basic" data-policy-id="${item.id}">详细信息</button>
            <button class="action-link" data-action="benefits" data-policy-id="${item.id}">责任信息</button>
            <button class="action-link" data-action="insureds" data-policy-id="${item.id}">被保人信息</button>
          </td>
        </tr>
      `,
    )
    .join("");

  policyPagination.innerHTML = renderPaginationHtml("policy", policyPage, totalPages, items.length);

  for (const element of policyTableBody.querySelectorAll("[data-action]")) {
    element.addEventListener("click", async () => {
      activePolicyId = element.dataset.policyId;
      activeDetailTab = element.dataset.action;
      insuredPage = 1;
      renderPolicies(currentPolicies);
      await loadPolicyFullView(activePolicyId);
    });
  }

  for (const element of policyPagination.querySelectorAll("[data-page-type='policy']")) {
    element.addEventListener("click", () => {
      const action = element.dataset.pageAction;
      if (action === "prev" && policyPage > 1) policyPage -= 1;
      if (action === "next" && policyPage < totalPages) policyPage += 1;
      if (action === "goto") policyPage = Number(element.dataset.pageNumber);
      renderPolicies(currentPolicies);
    });
  }
}

async function fetchJson(url) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`请求失败: ${response.status}`);
  }
  return response.json();
}

async function loadPolicies(params = new URLSearchParams()) {
  const suffix = params.toString() ? `?${params.toString()}` : "";
  const data = await fetchJson(`/api/policies${suffix}`);
  renderPolicies(data.items);
}

async function loadPolicyFullView(policyId) {
  const data = await fetchJson(`/api/policies/${policyId}/full-view`);
  openDrawer(data);
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  activePolicyId = null;
  policyPage = 1;
  closeDrawer();
  const params = new URLSearchParams();
  for (const [key, value] of new FormData(form).entries()) {
    if (value) params.set(key, String(value));
  }
  await loadPolicies(params);
});

menuTrigger.addEventListener("click", () => {
  menuDropdown.classList.toggle("hidden");
});

policyStatusTrigger.addEventListener("click", () => {
  if (policyStatusMenu.classList.contains("hidden")) {
    openPolicyStatusMenu();
  } else {
    closePolicyStatusMenu();
  }
});

for (const option of policyStatusMenu.querySelectorAll(".custom-select-option")) {
  option.addEventListener("click", () => {
    setPolicyStatusValue(option.dataset.value, option.textContent.trim());
    closePolicyStatusMenu();
  });
}

openPolicyQuery.addEventListener("click", () => {
  switchMainTab("policy");
  menuDropdown.classList.add("hidden");
});

openClaimQuery.addEventListener("click", () => {
  switchMainTab("claim");
  menuDropdown.classList.add("hidden");
});

queryTab.addEventListener("click", () => switchMainTab("policy"));
claimTab.addEventListener("click", () => switchMainTab("claim"));

resetFormButton.addEventListener("click", async () => {
  form.reset();
  setPolicyStatusValue("", "全部");
  activePolicyId = null;
  policyPage = 1;
  closeDrawer();
  await loadPolicies();
});

document.addEventListener("click", (event) => {
  if (!policyStatusSelect.contains(event.target)) {
    closePolicyStatusMenu();
  }
});

drawerClose.addEventListener("click", closeDrawer);
drawerOverlay.addEventListener("click", (event) => {
  if (event.target === drawerOverlay) closeDrawer();
});

setPolicyStatusValue("", "全部");

loadPolicies().catch((error) => {
  policyTableBody.innerHTML = `<tr><td colspan="8">${error.message}</td></tr>`;
});
