import { chromium } from 'playwright';
import * as readline from 'readline';
import dotenv from 'dotenv';
import { createLogDirectory } from './utils/logger.js';
import { getBrowserConfig, getContextOptions } from './utils/browser.js';
import { decodeJwt, normalizeJwt, verifyAndSaveState } from './utils/session.js';

dotenv.config();

/**
 * Login by pasting the jwt_token cookie from a browser where you're already logged in.
 *
 * Usage:
 *   pnpm run login-token              (prompts for the token)
 *   pnpm run login-token <token>
 *   DUOLINGO_JWT=<token> in .env
 */

async function promptToken(): Promise<string> {
    console.log('How to get your token:');
    console.log('  1. Log in at https://www.duolingo.com in your normal browser.');
    console.log('  2. Open DevTools (F12) > Application > Cookies > https://www.duolingo.com');
    console.log('  3. Copy the value of the "jwt_token" cookie.\n');

    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    const answer = await new Promise<string>(resolve => rl.question('Paste jwt_token: ', resolve));
    rl.close();
    return answer;
}

(async () => {
    const raw = process.argv[2] || process.env.DUOLINGO_JWT || await promptToken();
    const token = normalizeJwt(raw);

    const info = decodeJwt(token);
    if (!info) {
        console.error('❌ That does not look like a jwt_token (expected three parts separated by dots).');
        process.exit(1);
    }
    if (info.expiresAt && info.expiresAt.getTime() < Date.now()) {
        console.error(`❌ This token expired at ${info.expiresAt.toISOString()}. Log in again and copy a fresh one.`);
        process.exit(1);
    }

    const logDir = createLogDirectory('login-token');
    console.log(`Log directory: ${logDir}`);

    const browser = await chromium.launch(getBrowserConfig());
    const context = await browser.newContext(getContextOptions());
    await context.addCookies([{
        name: 'jwt_token',
        value: token,
        domain: '.duolingo.com',
        path: '/',
        expires: info.expiresAt ? Math.floor(info.expiresAt.getTime() / 1000) : -1,
        httpOnly: false,
        secure: true,
        sameSite: 'Lax',
    }]);

    try {
        const ok = await verifyAndSaveState(context, logDir);
        await browser.close();
        if (!ok) {
            console.error('The token was not accepted. Make sure you copied the whole jwt_token value.');
            process.exit(1);
        }
        console.log('Next: run "pnpm run encrypt-state" and commit assets/state.bin.');
        process.exit(0);
    } catch (error) {
        console.error('An error occurred:', error);
        await browser.close();
        process.exit(1);
    }
})();
