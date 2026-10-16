import { Page } from 'playwright';

/**
 * Fallback for courses without a "Words" collection in the Practice Hub
 * (e.g. new courses, or courses taught from non-English languages).
 *
 * Creates a practice session through Duolingo's web API and submits it as
 * completed. Requests run inside the logged-in page so they use its cookies.
 */

const CHALLENGE_TYPES = [
    'assist', 'characterIntro', 'characterMatch', 'characterPuzzle', 'characterSelect', 'characterTrace',
    'characterWrite', 'completeReverseTranslation', 'definition', 'dialogue', 'extendedMatch',
    'extendedListenMatch', 'form', 'freeResponse', 'gapFill', 'judge', 'listen', 'listenComplete',
    'listenMatch', 'match', 'name', 'listenComprehension', 'listenIsolation', 'listenSpeak', 'listenTap',
    'orderTapComplete', 'partialListen', 'partialReverseTranslate', 'patternTapComplete', 'radioBinary',
    'radioImageSelect', 'radioListenMatch', 'radioListenRecognize', 'radioSelect', 'readComprehension',
    'reverseAssist', 'sameDifferent', 'select', 'selectPronunciation', 'selectTranscription', 'svgPuzzle',
    'syllableTap', 'syllableListenTap', 'speak', 'tapCloze', 'tapClozeTable', 'tapComplete',
    'tapCompleteTable', 'tapDescribe', 'translate', 'transliterate', 'transliterationAssist', 'typeCloze',
    'typeClozeTable', 'typeComplete', 'typeCompleteTable', 'writeComprehension',
];

export interface ApiPracticeResult {
    sessionId: string;
    xpGain: number | null;
}

export async function completePracticeViaApi(page: Page, fromLanguage: string, learningLanguage: string): Promise<ApiPracticeResult> {
    console.log(`Completing practice via API (${learningLanguage} from ${fromLanguage})...`);

    return await page.evaluate(async ({ fromLanguage, learningLanguage, challengeTypes }) => {
        const jwt = document.cookie.split('; ').find(c => c.startsWith('jwt_token='))?.split('=')[1];
        const headers: Record<string, string> = { 'Content-Type': 'application/json' };
        if (jwt) headers['Authorization'] = `Bearer ${jwt}`;

        const createRes = await fetch('https://www.duolingo.com/2017-06-30/sessions', {
            method: 'POST',
            headers,
            credentials: 'include',
            body: JSON.stringify({
                challengeTypes,
                fromLanguage,
                learningLanguage,
                isFinalLevel: false,
                isV2: true,
                juicy: true,
                smartTipsVersion: 2,
                type: 'GLOBAL_PRACTICE',
            }),
        });
        if (!createRes.ok) throw new Error(`Create session failed: HTTP ${createRes.status} ${await createRes.text()}`);
        const session = await createRes.json();

        const now = Date.now() / 1000;
        const updateRes = await fetch(`https://www.duolingo.com/2017-06-30/sessions/${session.id}`, {
            method: 'PUT',
            headers,
            credentials: 'include',
            body: JSON.stringify({
                ...session,
                heartsLeft: 0,
                startTime: now - 120,
                endTime: now,
                enableBonusPoints: false,
                failed: false,
                maxInLessonStreak: 9,
                shouldLearnThings: true,
            }),
        });
        if (!updateRes.ok) throw new Error(`Complete session failed: HTTP ${updateRes.status} ${await updateRes.text()}`);
        const result = await updateRes.json();

        return { sessionId: session.id as string, xpGain: (result.xpGain ?? null) as number | null };
    }, { fromLanguage, learningLanguage, challengeTypes: CHALLENGE_TYPES });
}

/**
 * Switches the active course, using the same request the web app sends from the courses menu.
 * (The menu shows course names in the course's base language, so clicking by name is unreliable.)
 */
export async function switchCourseViaApi(page: Page, userId: number, courseId: string, fromLanguage: string): Promise<void> {
    await page.evaluate(async ({ userId, courseId, fromLanguage }) => {
        const jwt = document.cookie.split('; ').find(c => c.startsWith('jwt_token='))?.split('=')[1];
        const headers: Record<string, string> = { 'Content-Type': 'application/json' };
        if (jwt) headers['Authorization'] = `Bearer ${jwt}`;

        const res = await fetch(`https://www.duolingo.com/2023-05-23/users/${userId}?fields=courses,currentCourse,fromLanguage,learningLanguage`, {
            method: 'PATCH',
            headers,
            credentials: 'include',
            body: JSON.stringify({ currentCourseId: courseId, fromLanguage }),
        });
        if (!res.ok) throw new Error(`Switch course failed: HTTP ${res.status} ${await res.text()}`);
    }, { userId, courseId, fromLanguage });
}

/**
 * Fetches the user's current streak info fresh from the API.
 */
export async function fetchStreakInfo(page: Page, userId: number): Promise<{ streak: number; lastExtendedDate: string | null }> {
    return await page.evaluate(async (userId) => {
        const jwt = document.cookie.split('; ').find(c => c.startsWith('jwt_token='))?.split('=')[1];
        const res = await fetch(`https://www.duolingo.com/2017-06-30/users/${userId}?fields=streak,streakData`, {
            credentials: 'include',
            headers: jwt ? { Authorization: `Bearer ${jwt}` } : {},
        });
        const json = await res.json();
        return {
            streak: json.streak,
            lastExtendedDate: json.streakData?.currentStreak?.lastExtendedDate ?? null,
        };
    }, userId);
}
