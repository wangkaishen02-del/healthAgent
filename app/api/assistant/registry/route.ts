import { NextRequest, NextResponse } from "next/server";
import {
  getAssistantRegistryToolCatalog,
  getMenuPages,
  getNavigationRegistry,
  getPageRegistration,
} from "../../../../src/assistant/page-registry";

export function GET(request: NextRequest) {
  const resource = request.nextUrl.searchParams.get("resource") ?? "navigation";
  if (resource === "tools") return NextResponse.json({ tools: getAssistantRegistryToolCatalog() });
  if (resource === "menu") {
    const menuId = request.nextUrl.searchParams.get("menuId");
    return NextResponse.json({ menu: menuId ? getMenuPages(menuId) : null });
  }
  if (resource === "page") {
    const pageId = request.nextUrl.searchParams.get("pageId");
    return NextResponse.json({ page: pageId ? getPageRegistration(pageId) : null });
  }
  return NextResponse.json(getNavigationRegistry());
}
