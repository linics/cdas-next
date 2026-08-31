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

// Authentication is resolved from the opaque HttpOnly session cookie in server
// routes and commands. The proxy only passes the pathname to legacy route
// helpers; it never talks to an external identity provider.
export default function proxy(request: NextRequest) {
  return withPathname(request);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|api/health|.*\\..*).*)"],
};
