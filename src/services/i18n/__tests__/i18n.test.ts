import { describe, expect, it } from 'vitest';

import { createTranslator, isRTL, t, type LocaleCode } from '@/services/i18n/i18n';

function withNodeEnv<T>(nodeEnv: string | undefined, fn: () => T): T {
  const env = process.env as unknown as Record<string, string | undefined>;
  const previous = env.NODE_ENV;
  env.NODE_ENV = nodeEnv;
  try {
    return fn();
  } finally {
    env.NODE_ENV = previous;
  }
}

describe('i18n t()', () => {
  it('returns English strings for known keys', () => {
    expect(t('nav.chat')).toBe('Find help');
  });

  it('interpolates template params and preserves missing placeholders', () => {
    expect(t('chat.quota.exceeded', { count: 3 })).toContain("You've reached");
    expect(t('chat.input.placeholder', { missing: 1 })).toBe('Describe what you need help with...');
  });

  it('falls back to English when locale is non-default and key exists in English', () => {
    expect(t('nav.map', undefined, 'es')).toBe('Mapa');
  });

  it('provides concise navigation copy in every supported locale', () => {
    const expectations: Array<{ locale: LocaleCode; copy: Record<string, string> }> = [
      {
        locale: 'en',
        copy: {
          home: 'Home', chat: 'Find help', crisis: 'Crisis',
          directory: 'Browse services', browse: 'Browse', scroll: 'Resource feed',
          account: 'Account', more: 'More', for_providers: 'For providers', your_services: 'Your services',
          submit_or_correct: 'Submit or correct a resource', volunteer_to_review: 'Volunteer to review resources',
        },
      },
      {
        locale: 'es',
        copy: {
          home: 'Inicio', chat: 'Buscar ayuda', crisis: 'Crisis',
          directory: 'Explorar servicios', browse: 'Explorar', scroll: 'Lista de recursos',
          account: 'Cuenta', more: 'Más', for_providers: 'Para proveedores', your_services: 'Sus servicios',
          submit_or_correct: 'Enviar o corregir un recurso', volunteer_to_review: 'Revisar recursos como voluntario',
        },
      },
      {
        locale: 'fr',
        copy: {
          home: 'Accueil', chat: 'Trouver de l’aide', crisis: 'Crise',
          directory: 'Parcourir les services', browse: 'Parcourir', scroll: 'Fil de ressources',
          account: 'Compte', more: 'Plus', for_providers: 'Pour les prestataires', your_services: 'Vos services',
          submit_or_correct: 'Proposer ou corriger une ressource', volunteer_to_review: 'Examiner des ressources bénévolement',
        },
      },
      {
        locale: 'zh',
        copy: {
          home: '首页', chat: '寻求帮助', crisis: '危机',
          directory: '浏览服务', browse: '浏览', scroll: '资源动态',
          account: '账户', more: '更多', for_providers: '服务提供方', your_services: '您的服务',
          submit_or_correct: '提交或更正资源', volunteer_to_review: '志愿审核资源',
        },
      },
      {
        locale: 'ar',
        copy: {
          home: 'الرئيسية', chat: 'ابحث عن مساعدة', crisis: 'أزمة',
          directory: 'تصفح الخدمات', browse: 'تصفّح', scroll: 'موجز الموارد',
          account: 'الحساب', more: 'المزيد', for_providers: 'لمقدمي الخدمات', your_services: 'خدماتك',
          submit_or_correct: 'إرسال مورد أو تصحيحه', volunteer_to_review: 'تطوع لمراجعة الموارد',
        },
      },
      {
        locale: 'vi',
        copy: {
          home: 'Trang chủ', chat: 'Tìm trợ giúp', crisis: 'Khủng hoảng',
          directory: 'Duyệt dịch vụ', browse: 'Duyệt', scroll: 'Bảng tin tài nguyên',
          account: 'Tài khoản', more: 'Thêm', for_providers: 'Dành cho nhà cung cấp', your_services: 'Dịch vụ của bạn',
          submit_or_correct: 'Gửi hoặc sửa nguồn hỗ trợ', volunteer_to_review: 'Tình nguyện rà soát nguồn hỗ trợ',
        },
      },
    ];

    for (const { locale, copy } of expectations) {
      const tl = createTranslator(locale);
      for (const [key, expected] of Object.entries(copy)) {
        expect(tl(`nav.${key}`)).toBe(expected);
      }
    }
  });

  it('falls back to key when missing (non-development)', () => {
    const result = withNodeEnv('test', () => t('missing.key'));
    expect(result).toBe('missing.key');
  });

  it('throws in development when key missing in English', () => {
    expect(() => withNodeEnv('development', () => t('missing.key'))).toThrow(
      '[i18n] Missing translation key: missing.key'
    );
  });

  it('createTranslator returns a locale-bound function', () => {
    const tl = createTranslator('en');
    expect(tl('nav.directory')).toBe('Browse services');
  });

  it('identifies RTL locales', () => {
    expect(isRTL('ar')).toBe(true);
    expect(isRTL('en')).toBe(false);
  });
});
