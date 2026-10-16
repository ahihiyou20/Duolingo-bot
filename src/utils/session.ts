import { BrowserContext } from 'playwright';
import * as path from 'path';
import { getStatePath, waitForLogin } from './auth.js';

export interface JwtInfo {
    userId?: string | number;
    expiresAt?: Date;
}

/**
 * Normalizes a pasted jwt_token value (strips "jwt_token=", quotes, whitespace).
 */
export function normalizeJwt(raw: string): string {
    return raw.trim().replace(/^jwt_token\s*=\s*/i, '').replace(/^["']|["'];?$/g, '').replace(/;$/, '').trim();
}

/**
 * Decodes the payload of a JWT without verifying it. Returns null if it's not a JWT.
 */
export function decodeJwt(token: string): JwtInfo | null {
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    try {
        const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
        return {
            userId: payload.sub,
            expiresAt: typeof payload.exp === 'number' ? new Date(payload.exp * 1000) : undefined,
        };
    } catch {
        return null;
    }
}

/**
 * Opens Duolingo in the given context, checks that the user is logged in,
 * and saves the storage state to state/storageState.json.
 */
export async function verifyAndSaveState(context: BrowserContext, logDir: string): Promise<boolean> {
    const page = await context.newPage();
    await page.goto('https://www.duolingo.com/', { waitUntil: 'domcontentloaded' });

    const loggedIn = await waitForLogin(page, 20);
    await page.screenshot({ path: path.join(logDir, loggedIn ? 'login_success.png' : 'login_failed.png') });

    if (!loggedIn) {
        console.error('❌ Duolingo does not show a logged-in session.');
        return false;
    }

    const cookies = await context.cookies('https://www.duolingo.com');
    const jwt = cookies.find(c => c.name === 'jwt_token');
    if (!jwt) {
        console.warn('⚠️  Logged in, but no jwt_token cookie found. The saved state may not work in CI.');
    } else {
        const info = decodeJwt(jwt.value);
        if (info?.userId) console.log(`User ID: ${info.userId}`);
        if (info?.expiresAt) console.log(`Token expires: ${info.expiresAt.toISOString()}`);
    }

    const statePath = getStatePath();
    await context.storageState({ path: statePath });
    console.log(`✅ Logged in. State saved to: ${statePath}`);
    return true;
}
