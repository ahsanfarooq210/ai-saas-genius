const PUBLIC_AUTH_PATHS = new Set(["/login", "/signup"]);

export function shouldRedirectToLogin(pathname: string): boolean {
  const normalizedPath = pathname.replace(/\/+$/, "") || "/";
  return !PUBLIC_AUTH_PATHS.has(normalizedPath);
}
