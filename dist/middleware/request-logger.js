/** Map URL prefix → short module label for terminal logs. */
function moduleTag(url) {
    if (url.startsWith("/api/housekeeping"))
        return "HK";
    if (url.startsWith("/api/purchase-stores"))
        return "PS";
    if (url.startsWith("/api/food-beverages"))
        return "FB";
    if (url.startsWith("/api/front-office"))
        return "FO";
    if (url.startsWith("/api/auth"))
        return "AUTH";
    return "API";
}
/** Dev request logger — prints each API hit to the terminal. */
export function requestLogger(req, res, next) {
    const started = Date.now();
    const { method, originalUrl } = req;
    const tag = moduleTag(originalUrl);
    res.on("finish", () => {
        const ms = Date.now() - started;
        const status = res.statusCode;
        const color = status >= 500 ? "\x1b[31m" : status >= 400 ? "\x1b[33m" : "\x1b[32m";
        const reset = "\x1b[0m";
        const dim = "\x1b[90m";
        const time = new Date().toLocaleTimeString("en-IN", {
            hour: "2-digit",
            minute: "2-digit",
            second: "2-digit",
        });
        console.log(`${time} ${dim}[${tag}]${reset} ${color}${method.padEnd(7)}${reset} ${originalUrl} → ${color}${status}${reset} (${ms}ms)`);
    });
    next();
}
//# sourceMappingURL=request-logger.js.map