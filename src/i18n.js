// Interface text for the public site in Kurdish, Arabic and English.
// Every page is rendered on the server in one language, so search engines and link previews
// always see the right text without running any JavaScript.

import { STUDIO_STRINGS } from './i18n-studio.js';

export const LANGS = ['ku', 'ar', 'en'];

export const LANG_META = {
  ku: { dir: 'rtl', html: 'ku', hreflang: 'ku', ogLocale: 'cb_IQ', label: 'کوردی' },
  ar: { dir: 'rtl', html: 'ar', hreflang: 'ar', ogLocale: 'ar_AR', label: 'العربية' },
  en: { dir: 'ltr', html: 'en', hreflang: 'en', ogLocale: 'en_US', label: 'English' },
};

export const isLang = (value) => LANGS.includes(value);

// [Kurdish, Arabic, English]. {name} placeholders are filled by t().
const S = {
  skip: ['بڕۆ بۆ ناوەڕۆک', 'انتقل إلى المحتوى', 'Skip to content'],
  'nav.home': ['سەرەتا', 'الرئيسية', 'Home'],
  'nav.products': ['بەرهەمەکان', 'المنتجات', 'Products'],
  'nav.about': ['دەربارەی ئێمە', 'من نحن', 'About us'],
  'nav.why': ['بۆچی ئێمە', 'لماذا نحن', 'Why choose us'],
  'nav.gallery': ['گالەری', 'المعرض', 'Gallery'],
  'nav.location': ['شوێنەکەمان', 'موقعنا', 'Location'],
  'nav.contact': ['پەیوەندی', 'اتصل بنا', 'Contact'],
  'nav.social': ['سۆشیاڵ میدیا', 'وسائل التواصل', 'Social media'],
  'nav.menu': ['مینیو', 'القائمة', 'Menu'],
  'nav.close': ['داخستن', 'إغلاق', 'Close'],
  'nav.language': ['زمان', 'اللغة', 'Language'],

  'hero.label': ['کارگەی کاشی · بارزان شرێ', 'مصنع بلاط · بارزان شري', 'Tile factory · Barzan Shre'],
  'hero.title': ['کاشیی جوان، بۆ باخچە و حەوشەی جوانتر', 'بلاط جميل لحدائق وساحات أجمل', 'Beautiful tiles for more beautiful gardens and courtyards'],
  'hero.text': [
    'بەرهەمهێنانی کاشیی باخچە و حەوشە بە کوالیتییەکی باش، هەر لە ساڵی {year}.',
    'نصنع بلاط الحدائق والساحات بجودة عالية منذ عام {year}.',
    'Manufacturing quality garden and courtyard tiles since {year}.',
  ],
  'cta.whatsapp': ['پەیوەندیمان پێوە بکە لە واتسئاپ', 'تواصل معنا عبر واتساب', 'Contact us on WhatsApp'],
  'cta.products': ['بەرهەمەکان ببینە', 'تصفح منتجاتنا', 'Explore our products'],
  'cta.floating': ['پەیوەندی لە واتسئاپ', 'تواصل عبر واتساب', 'Chat on WhatsApp'],

  'about.title': ['دەربارەی ئێمە', 'من نحن', 'About us'],
  'about.p1': [
    '{name} کارگەیەکی بەرهەمهێنانی کاشییە لە بارزان شرێ، لە هەرێمی کوردستان. هەر لە ساڵی {year} کار دەکەین.',
    '{name} مصنع لإنتاج البلاط في بارزان شري، إقليم كوردستان. نعمل منذ عام {year}.',
    '{name} is a tile factory in Barzan Shre, in the Kurdistan Region of Iraq. We have been working since {year}.',
  ],
  'about.p2': [
    'کاشیی باخچە و حەوشە لە کارگەی خۆمان دروست دەکەین، بە دیزاین و قەبارەی جیاواز.',
    'نصنع بلاط الحدائق والساحات في مصنعنا، بتصاميم ومقاسات مختلفة.',
    'We make garden and courtyard tiles in our own factory, in different designs and sizes.',
  ],
  'about.p3': [
    'ئامانجمان کاشیی باش و خزمەتێکی ڕاستگۆیانەیە بۆ هەموو کڕیارێک، لە یەکەم پرسیارەوە تا هەڵبژاردنی کاشیی گونجاو.',
    'هدفنا بلاط جيد وخدمة صادقة لكل عميل، من أول سؤال حتى اختيار البلاط المناسب.',
    'Our aim is good tiles and honest service for every customer, from the first question to choosing the right tile.',
  ],
  'about.fact.since': ['دامەزراوە', 'تأسس', 'Founded'],
  'about.fact.place': ['شوێن', 'الموقع', 'Location'],
  'about.fact.products': ['بەرهەم لە پیشانگا', 'منتج في المعرض', 'Products in the showroom'],

  'why.title': ['بۆچی {name}؟', 'لماذا {name}؟', 'Why {name}?'],
  'why.since.t': ['لە ساڵی {year}ەوە', 'منذ عام {year}', 'Since {year}'],
  'why.since.d': ['{n} ساڵ ئەزموون لە دروستکردنی کاشی.', '{n} سنة من الخبرة في صناعة البلاط.', '{n} years of experience making tiles.'],
  'why.special.t': ['تایبەتمەند لە کاشی', 'متخصصون في البلاط', 'Specialized in tiles'],
  'why.special.d': [
    'کاشیی باخچە و حەوشە، ڕەسیف و پارچەکانی باخچە دروست دەکەین.',
    'نصنع بلاط الحدائق والساحات والأرصفة وقطع الحدائق.',
    'We make garden and courtyard tiles, curbs and garden pieces.',
  ],
  'why.sizes.t': ['قەبارە و دیزاینی جیاواز', 'مقاسات وتصاميم متعددة', 'Many sizes and designs'],
  'why.sizes.d': ['{designs} دیزاین بە {sizes} قەبارە لە پیشانگاکەماندا.', '{designs} تصميماً بـ {sizes} مقاسات في معرضنا.', '{designs} designs in {sizes} sizes in our showroom.'],
  'why.direct.t': ['پەیوەندیی ڕاستەوخۆ', 'تواصل مباشر', 'Direct contact'],
  'why.direct.d': ['ڕاستەوخۆ لەگەڵ کارگە قسە بکە لە واتسئاپ، بێ نێوەندگیر.', 'تحدث مع المصنع مباشرة عبر واتساب، دون وسيط.', 'Talk to the factory directly on WhatsApp, with no middleman.'],
  'why.local.t': ['بەرهەمی ناوخۆیی', 'إنتاج محلي', 'Local production'],
  'why.local.d': ['هەموو کاشییەکان لە کارگەی خۆمان لە بارزان شرێ دروست دەکرێن.', 'كل البلاط يُصنع في مصنعنا في بارزان شري.', 'Every tile is made in our own factory in Barzan Shre.'],
  'why.service.t': ['خزمەتی کڕیار', 'خدمة العملاء', 'Customer-focused'],
  'why.service.d': ['یارمەتیت دەدەین کاشیی گونجاو بۆ شوێنەکەت هەڵبژێریت.', 'نساعدك على اختيار البلاط المناسب لمكانك.', 'We help you choose the right tile for your space.'],

  'products.title': ['پیشانگای بەرهەمەکان', 'معرض المنتجات', 'Product showroom'],
  'products.lead': [
    'بە ناو، ژمارە یان قەبارە بگەڕێ. بۆ نرخ و زانیاری، لە واتسئاپ پرسیار بکە.',
    'ابحث بالاسم أو الرقم أو المقاس. للسعر والمعلومات، اسأل عبر واتساب.',
    'Search by name, number or size. For prices and details, ask us on WhatsApp.',
  ],
  'products.search': ['بگەڕێ بە ناو، ژمارە یان قەبارە…', 'ابحث بالاسم أو الرقم أو المقاس…', 'Search by name, number or size…'],
  'products.searchLabel': ['گەڕان لە بەرهەمەکان', 'البحث في المنتجات', 'Search products'],
  'products.clear': ['پاککردنەوە', 'مسح', 'Clear'],
  'products.category': ['جۆر', 'الفئة', 'Category'],
  'products.size': ['قەبارە', 'المقاس', 'Size'],
  'products.all': ['هەموو', 'الكل', 'All'],
  'products.count': ['{n} لە {total} بەرهەم', '{n} من {total} منتج', '{n} of {total} products'],
  'products.emptyTitle': ['هیچ بەرهەمێک نەدۆزرایەوە', 'لا توجد منتجات مطابقة', 'No matching products'],
  'products.emptyText': ['وشەیەکی تر تاقی بکەرەوە یان فلتەرەکان لاببە.', 'جرّب كلمة أخرى أو أزل الفلاتر.', 'Try another word or clear the filters.'],
  'products.reset': ['لابردنی فلتەرەکان', 'إزالة الفلاتر', 'Clear filters'],
  'products.none': ['بەم زووانە بەرهەمەکان لێرە دەردەکەون.', 'ستظهر المنتجات هنا قريباً.', 'Products will appear here soon.'],

  'card.details': ['وردەکاری', 'التفاصيل', 'Details'],
  'card.askPrice': ['پرسیاری نرخ', 'اسأل عن السعر', 'Ask price'],
  'card.ask': ['پرسیار', 'استفسار', 'Ask'],
  'status.available': ['بەردەستە', 'متوفر', 'Available'],
  'status.out': ['نەماوە', 'نفدت الكمية', 'Out of stock'],
  'status.ask': ['بۆ نرخ پەیوەندی بکە', 'تواصل لمعرفة السعر', 'Contact for price'],
  cm: ['سم', 'سم', 'cm'],

  'product.no': ['ژمارەی بەرهەم', 'رقم المنتج', 'Product no.'],
  'product.size': ['قەبارە', 'المقاس', 'Size'],
  'product.category': ['جۆر', 'الفئة', 'Category'],
  'product.price': ['نرخ', 'السعر', 'Price'],
  'product.availability': ['دۆخ', 'الحالة', 'Availability'],
  'product.names': ['ناو بە سێ زمان', 'الاسم بثلاث لغات', 'Name in three languages'],
  'product.description': ['وەسف', 'الوصف', 'Description'],
  'product.related': ['بەرهەمی تر', 'منتجات أخرى', 'More products'],
  'product.back': ['گەڕانەوە بۆ بەرهەمەکان', 'العودة إلى المنتجات', 'Back to products'],
  'product.ask': ['پرسیار لە واتسئاپ', 'اسأل عبر واتساب', 'Ask on WhatsApp'],
  'product.askPrice': ['پرسیاری نرخ لە واتسئاپ', 'اسأل عن السعر عبر واتساب', 'Ask the price on WhatsApp'],
  'product.photo': ['وێنەی {n}', 'الصورة {n}', 'Photo {n}'],
  'product.priceNote': ['نرخ دەکرێت بگۆڕێت؛ بۆ نرخی ئێستا پرسیار بکە.', 'قد يتغير السعر؛ اسأل عن السعر الحالي.', 'Prices can change; ask for the current price.'],
  'product.preview': ['پێشبینی: ئەم بەرهەمە لە ماڵپەڕەکەدا شاراوەیە.', 'معاينة: هذا المنتج مخفي في الموقع.', 'Preview: this product is hidden on the site.'],

  'gallery.title': ['گالەری', 'المعرض', 'Gallery'],
  'gallery.lead': ['وێنەی کارگە و بەرهەمەکانمان.', 'صور من مصنعنا ومنتجاتنا.', 'Photos from our factory and our products.'],
  'gallery.workshop': ['کارگەکەمان', 'مصنعنا', 'Our factory'],
  'gallery.products': ['وێنەی بەرهەمەکان', 'صور المنتجات', 'Product photos'],
  'gallery.more': ['هەموو وێنەکان ببینە', 'عرض كل الصور', 'See all photos'],

  'location.title': ['شوێنەکەمان', 'موقعنا', 'Our location'],
  'location.region': ['هەرێمی کوردستان، عێراق', 'إقليم كوردستان، العراق', 'Kurdistan Region, Iraq'],
  'location.open': ['لەسەر نەخشە ببینە', 'عرض على الخريطة', 'Open in Google Maps'],
  'location.directions': ['ڕێگای گەیشتن', 'الاتجاهات', 'Get directions'],
  'location.mapTitle': ['نەخشەی شوێنی کارگە', 'خريطة موقع المصنع', 'Map of the factory location'],

  'contact.title': ['پەیوەندیمان پێوە بکە', 'تواصل معنا', 'Contact us'],
  'contact.lead': [
    'بۆ نرخ، قەبارە و هەر پرسیارێک، پەیوەندیمان پێوە بکە. خێراترین ڕێگا واتسئاپە.',
    'للأسعار والمقاسات وأي سؤال، تواصل معنا. أسرع طريقة هي واتساب.',
    'For prices, sizes or any question, get in touch. WhatsApp is the fastest way.',
  ],
  'contact.phone': ['تەلەفۆن', 'الهاتف', 'Phone'],
  'contact.whatsapp': ['واتسئاپ', 'واتساب', 'WhatsApp'],
  'contact.address': ['ناونیشان', 'العنوان', 'Address'],
  'social.title': ['سۆشیاڵ میدیا', 'وسائل التواصل', 'Social media'],
  'social.lead': ['کارە نوێیەکانمان ببینە.', 'تابع أحدث أعمالنا.', 'Follow our latest work.'],

  'footer.since': ['هەر لە ساڵی {year}', 'منذ عام {year}', 'Since {year}'],
  'notFound.title': ['ئەم پەڕەیە نەدۆزرایەوە', 'الصفحة غير موجودة', 'Page not found'],
  'notFound.text': ['لەوانەیە بەستەرەکە کۆن بێت یان بەرهەمەکە لابرابێت.', 'ربما الرابط قديم أو تمت إزالة المنتج.', 'The link may be old, or the product may have been removed.'],
  'notFound.home': ['گەڕانەوە بۆ سەرەتا', 'العودة إلى الرئيسية', 'Back to the home page'],

  'viewer.close': ['داخستن', 'إغلاق', 'Close'],
  'viewer.prev': ['پێشوو', 'السابق', 'Previous'],
  'viewer.next': ['دواتر', 'التالي', 'Next'],
  'viewer.label': ['پیشاندانی وێنە', 'عارض الصور', 'Photo viewer'],

  'wa.general': ['سڵاو {name}، پرسیارێکم هەیە.', 'مرحباً {name}، لدي استفسار.', 'Hello {name}, I have a question.'],
  'wa.product': [
    'سڵاو {name}، حەزم لە بەرهەمی ژمارە {code} ({product}){size} هەیە. تکایە نرخ و زانیاریی زیاترم پێ بڵێن.',
    'مرحباً {name}، أنا مهتم بالمنتج رقم {code} ({product}){size}. هل يمكنكم تزويدي بالسعر ومعلومات إضافية؟',
    'Hello {name}, I am interested in product {code} ({product}){size}. Could you please provide its price and additional information?',
  ],
  'wa.size': ['، قەبارە {size}', '، المقاس {size}', ', size {size}'],
};

Object.assign(S, STUDIO_STRINGS);
S['nav.studio'] = ['ستۆدیۆی AI', 'استوديو AI', 'AI Studio'];

/** The interface text the Studio's browser script needs, in one language. */
export function clientStrings(lang) {
  const out = {};
  for (const key of Object.keys(S)) {
    if (/^(st|status)\./.test(key) || ['cm', 'card.details', 'product.no'].includes(key)) out[key] = t(lang, key);
  }
  return out;
}

/** Looks up interface text; falls back to Kurdish, then to the key itself. */
export function t(lang, key, vars = {}) {
  const row = S[key];
  const index = LANGS.indexOf(lang);
  let text = row ? row[index] ?? row[0] : key;
  for (const [name, value] of Object.entries(vars)) text = text.split(`{${name}}`).join(String(value));
  return text;
}

/** A translated database field (`name` → `name_ar` / `name_en`), falling back to the Kurdish text. */
export function localized(row, field, lang) {
  if (!row) return '';
  if (lang === 'ku') return row[field] || '';
  return row[`${field}_${lang}`] || row[field] || '';
}

/** A translated shop setting such as shop_name or address. */
export function settingFor(settings, key, lang) {
  if (lang === 'ku') return settings[key] || '';
  return settings[`${key}_${lang}`] || settings[key] || '';
}

/** URL prefix for a language: the default language lives at the site root, the others under /ar, /en or /ku. */
export function langPrefix(lang, defaultLang) {
  return lang === defaultLang ? '' : `/${lang}`;
}

/** Product numbers are shown with at least three digits: #001. */
export const productNo = (code) => `#${String(code).padStart(3, '0')}`;
