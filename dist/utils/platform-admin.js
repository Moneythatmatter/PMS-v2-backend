/** Super admin flag or legacy Admin role — platform user/property management. */
export function isPlatformAdmin(auth) {
    if (!auth)
        return false;
    if (auth.isSuperAdmin)
        return true;
    const role = String(auth.role ?? "").trim().toLowerCase();
    return role === "admin" || role === "administrator";
}
//# sourceMappingURL=platform-admin.js.map