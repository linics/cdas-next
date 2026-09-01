import { type NextRequest, NextResponse } from "next/server";

function withPathname(request: NextRequest) {
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-cdas-pathname", request.nextUrl.pathname);
  return NextResponse.next({
    request: {
      headers: requestHeaders,
    },
  });
}

export default function proxy(request: NextRequest) {
  return withPathname(request);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|api/health|.*\\..*).*)"],
};
