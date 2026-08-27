import { clerkMiddleware } from "@clerk/nextjs/server";
import { type NextRequest, NextResponse } from "next/server";
import { isClickthroughAuthEnabled } from "./server/auth/clickthrough-auth";
import { isClerkAuthenticationAvailable } from "./server/auth/clerk-availability";

function withPathname(request: NextRequest) {
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-cdas-pathname", request.nextUrl.pathname);
  return NextResponse.next({
    request: {
      headers: requestHeaders,
    },
  });
}

// Clerk supplies identity context only. Individual routes and every command
// still perform their own authentication and resource-level authorization.
const proxy = isClickthroughAuthEnabled()
  ? withPathname
  : isClerkAuthenticationAvailable()
    ? clerkMiddleware((_auth, request) => withPathname(request))
    : withPathname;

export default proxy;

export const config = {
  matcher: ["/((?!_next/static|_next/image|.*\\..*).*)"],
};
