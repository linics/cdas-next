import { clerkMiddleware } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import { isClerkAuthenticationAvailable } from "./server/auth/clerk-availability";

// Clerk supplies identity context only. Individual routes and every command
// still perform their own authentication and resource-level authorization.
const proxy = isClerkAuthenticationAvailable()
  ? clerkMiddleware()
  : () => NextResponse.next();

export default proxy;

export const config = {
  matcher: ["/((?!_next/static|_next/image|.*\\..*).*)"],
};
