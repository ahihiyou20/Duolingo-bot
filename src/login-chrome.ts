import { chromium } from 'playwright';
import { spawn, spawnSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import * as readline from 'readline';
import dotenv from 'dotenv';
import { createLogDirectory } from './utils/logger.js';
import { ensureStateDir } from './utils/auth.js';
import { getContextOptions } from './utils/browser.js';
import { verifyAndSaveState } from './utils/session.js';

dotenv.config();

/**
 * Login with a real, non-automated Chrome/Edge so Google sign-in works.
 *
 * Phase 1: launch the installed browser as a normal process (no Playwright, no
 *          debugging port) with a dedicated profile. The user logs in by hand.
 * Phase 2: after the browser is closed, Playwright opens the same profile with
 *          the same executable, verifies the session and saves storageState.json.
 */

function findBrowserExecutable(): string | null {
    const env = process.env;
    const candidates: (string | undefined)[] = [env.CHROME_PATH];

    if (process.platform === 'win32') {
        for (const base of [env['PROGRAMFILES'], env['PROGRAMFILES(X86)'], env['LOCALAPPDATA']]) {
            if (base) candidates.push(path.join(base, 'Google/Chrome/Application/chrome.exe'));
        }
        for (const base of [env['PROGRAMFILES(X86)'], env['PROGRAMFILES']]) {
            if (base) candidates.push(path.join(base, 'Microsoft/Edge/Application/msedge.exe'));
        }
    } else if (process.platform === 'darwin') {
        candidates.push(
            '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
            '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
        );
    } else {
        candidates.push('/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/microsoft-edge', '/usr/bin/chromium');
    }

    return candidates.find(p => p && fs.existsSync(p)) ?? null;
}

function closeGracefully(pid: number) {
    if (process.platform === 'win32') {
        // Without /F, taskkill asks the windows to close so cookies get flushed to disk.
        spawnSync('taskkill', ['/PID', String(pid), '/T'], { stdio: 'ignore' });
    } else {
        process.kill(pid, 'SIGTERM');
    }
}

(async () => {
    const executablePath = findBrowserExecutable();
    if (!executablePath) {
        console.error('❌ Could not find Chrome or Edge. Set CHROME_PATH in .env to your browser executable.');
        process.exit(1);
    }

    const profileDir = path.join(ensureStateDir(), 'browser-profile');
    const logDir = createLogDirectory('login-chrome');
    console.log(`Browser: ${executablePath}`);
    console.log(`Profile: ${profileDir}`);
    console.log(`Log directory: ${logDir}`);

    // --- Phase 1: manual login in a plain browser ---
    const startedAt = Date.now();
    const browserProcess = spawn(executablePath, [
        `--user-data-dir=${profileDir}`,
        '--no-first-run',
        '--no-default-browser-check',
        '--disable-background-mode',
        'https://www.duolingo.com/?isLoggingIn=true',
    ], { stdio: 'ignore' });

    console.log('\n👉 Log in to Duolingo in the opened browser window (Google login works here).');
    console.log('👉 When you see your Duolingo home page, CLOSE the browser window (or press Enter here).\n');

    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    await new Promise<void>(resolve => {
        browserProcess.once('exit', () => resolve());
        rl.once('line', () => {
            if (browserProcess.exitCode === null && browserProcess.pid) {
                console.log('Closing browser...');
                closeGracefully(browserProcess.pid);
                // Force kill if it doesn't close in time.
                setTimeout(() => browserProcess.kill(), 15000).unref();
            } else {
                resolve();
            }
        });
    });
    rl.close();

    if (Date.now() - startedAt < 5000) {
        console.error('❌ The browser exited immediately. Another window using this profile may still be open.');
        console.error('   Close all browser windows opened by this script and run it again.');
        process.exit(1);
    }

    // Give the browser a moment to release the profile lock.
    await new Promise(r => setTimeout(r, 2000));

    // --- Phase 2: read the session with Playwright using the same browser + profile ---
    console.log('Browser closed. Verifying session...');
    const { viewport } = getContextOptions();
    const context = await chromium.launchPersistentContext(profileDir, {
        executablePath,
        headless: true,
        viewport,
    });

    try {
        const ok = await verifyAndSaveState(context, logDir);
        await context.close();
        if (!ok) {
            console.error('Login was not completed. Run "pnpm run login-chrome" again, or try "pnpm run login-token".');
            process.exit(1);
        }
        console.log('Next: run "pnpm run encrypt-state" and commit assets/state.bin.');
        process.exit(0);
    } catch (error) {
        console.error('An error occurred:', error);
        await context.close();
        process.exit(1);
    }
})();
