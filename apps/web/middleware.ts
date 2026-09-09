import { type NextRequest, NextResponse } from 'next/server';

const SESSION_COOKIE = 'pm.sid';
const PUBLIC_PATHS = ['/login', '/register', '/forgot-password', '/reset-password', '/verify-email'];

/**
 * Cosmetic routing only.
 *
 * This middleware checks whether a session cookie is PRESENT — not whether it
 * is valid, which it cannot know. Its entire job is to avoid a flash of the app
 * shell before the API answers 401.
 *
 * It is not a security boundary. Every protected resource is protected by the
 * API's guards; a forged cookie gets past this file and nowhere else.
 */
export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const hasSessionCookie = request.cookies.has(SESSION_COOKIE);
  const isPublicPath = PUBLIC_PATHS.some((path) => pathname.startsWith(path));

  if (!hasSessionCookie && !isPublicPath) {
    const url = request.nextUrl.clone();
    url.pathname = '/login';
    // Remember where they were headed so sign-in can return them there.
    if (pathname !== '/') url.searchParams.set('next', pathname);
    return NextResponse.redirect(url);
  }

  if (hasSessionCookie && isPublicPath && !pathname.startsWith('/reset-password')) {
    const url = request.nextUrl.clone();
    url.pathname = '/dashboard';
    url.search = '';
    return NextResponse.redirect(url);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)'],
};
