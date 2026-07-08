import { handleGetRequest } from "./server.ts";

const urls = [
  "/api/health",
  "/api/policies",
  "/api/policies/policy-001",
  "/api/policies/policy-001/products",
  "/api/policies/policy-001/insureds",
  "/api/policies/policy-001/full-view",
];

for (const url of urls) {
  const response = handleGetRequest(url);
  console.log(url, response.status);
}
