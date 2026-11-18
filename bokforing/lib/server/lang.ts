import 'server-only';
import { cache } from 'react';
import { cookies } from 'next/headers';
import type { UiLang } from '@/lib/ui-i18n';

/** Gränssnittets språk: cookien ui_lang sätts när användaren väljer språk (och vid inloggning) */
export const uiLang = cache(async (): Promise<UiLang> => ((await cookies()).get('ui_lang')?.value === 'en' ? 'en' : 'sv'));
