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
const clerkProxy = clerkMiddleware((_auth, request) => withPathname(request));

export default function proxy(
  request: NextRequest,
  event: Parameters<typeof clerkProxy>[1],
) {
  // Health must stay outside Clerk. Development instances rewrite missing
  // __clerk_db_jwt into a self-proxy loop that hangs curl /api/health.
  if (request.nextUrl.pathname === "/api/health") {
    return withPathname(request);
  }

  if (isClickthroughAuthEnabled()) {
    return withPathname(request);
  }

  if (isClerkAuthenticationAvailable()) {
    return clerkProxy(request, event);
  }

  return withPathname(request);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|api/health|.*\\..*).*)"],
};
