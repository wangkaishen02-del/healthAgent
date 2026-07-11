import { handleGetRequest } from "./server.ts";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const urls = [
  "/api/health",
  "/api/policies?page=1&pageSize=2",
  "/api/policies/policy-001",
  "/api/policies/policy-001/products",
  "/api/policies/policy-001/insureds?page=2&pageSize=10",
  "/api/policies/policy-001/full-view",
];

for (const url of urls) {
  const response = handleGetRequest(url);
  assert(response.status === 200, `${url} 应返回 200`);
  console.log(url, response.status);
}

const policies = handleGetRequest("/api/policies?page=1&pageSize=2").payload as {
  items: unknown[];
  total: number;
  page: number;
  pageSize: number;
};
assert(policies.items.length === 2, "保单接口应仅返回当前页 2 条数据");
assert(policies.total === 3 && policies.page === 1 && policies.pageSize === 2, "保单分页元数据不正确");

const insureds = handleGetRequest("/api/policies/policy-001/insureds?page=2&pageSize=10").payload as {
  items: unknown[];
  total: number;
  page: number;
};
assert(insureds.items.length === 10, "被保人接口第 2 页应仅返回 10 条数据");
assert(insureds.total === 20 && insureds.page === 2, "被保人分页元数据不正确");

const detail = handleGetRequest("/api/policies/policy-001/full-view").payload as {
  insuredCount?: number;
  insureds?: unknown;
};
assert(detail.insuredCount === 20, "详情接口应返回被保人总数");
assert(detail.insureds === undefined, "详情接口不应携带全量被保人清单");

console.log("pagination assertions passed");
