import { Actor } from 'apify';
import { PlaywrightCrawler, log } from 'crawlee';

// ════════════════════════════════════════════
// HELPER FUNCTIONS
// ════════════════════════════════════════════

function parseQuantity(rawText) {
    if (!rawText) return { raw: null, value: null, unit: null, normalizedKg: null };
    const cleaned = rawText.toLowerCase().trim();
    const match = cleaned.match(
        /([\d,.]+)\s*(kg|kgs|kilogram|kilograms|mt|metric\s*ton|ton|tons|tonne|tonnes|liter|liters|litre|litres|ltr|l|pound|pounds|lbs|lb|gram|grams|gm|g|gallon|gallons|gal|quintal|quintals|piece|pieces|pcs|unit|units|container|containers|fcl|bag|bags|carton|cartons|bottle|bottles|barrel|barrels|drum|drums|box|boxes)\b/i
    );
    if (!match) {
        const numMatch = cleaned.match(/([\d,.]+)/);
        return {
            raw: rawText.trim(),
            value: numMatch ? parseFloat(numMatch[1].replace(/,/g, '')) : null,
            unit: 'unknown',
            normalizedKg: null,
        };
    }
    const value = parseFloat(match[1].replace(/,/g, ''));
    const unit = match[2].toLowerCase().trim();
    const toKg = {
        kg: 1, kgs: 1, kilogram: 1, kilograms: 1,
        mt: 1000, 'metric ton': 1000, ton: 1000, tons: 1000, tonne: 1000, tonnes: 1000,
        liter: 0.9, liters: 0.9, litre: 0.9, litres: 0.9, ltr: 0.9, l: 0.9,
        pound: 0.453, pounds: 0.453, lbs: 0.453, lb: 0.453,
        gram: 0.001, grams: 0.001, gm: 0.001, g: 0.001,
        gallon: 3.4, gallons: 3.4, gal: 3.4,
        quintal: 100, quintals: 100,
    };
    return {
        raw: rawText.trim(), value, unit,
        normalizedKg: toKg[unit] ? Math.round(value * toKg[unit] * 100) / 100 : null,
    };
}

function parseDate(rawText) {
    if (!rawText) return null;
    const cleaned = rawText.toLowerCase().trim();
    const daysAgo = cleaned.match(/(\d+)\s*days?\s*ago/);
    if (daysAgo) { const d = new Date(); d.setDate(d.getDate() - parseInt(daysAgo[1])); return d.toISOString().split('T')[0]; }
    const weeksAgo = cleaned.match(/(\d+)\s*weeks?\s*ago/);
    if (weeksAgo) { const d = new Date(); d.setDate(d.getDate() - parseInt(weeksAgo[1]) * 7); return d.toISOString().split('T')[0]; }
    const monthsAgo = cleaned.match(/(\d+)\s*months?\s*ago/);
    if (monthsAgo) { const d = new Date(); d.setMonth(d.getMonth() - parseInt(monthsAgo[1])); return d.toISOString().split('T')[0]; }
    if (cleaned.includes('today')) return new Date().toISOString().split('T')[0];
    if (cleaned.includes('yesterday')) { const d = new Date(); d.setDate(d.getDate() - 1); return d.toISOString().split('T')[0]; }

    const monthNames = cleaned.match(/(\d{1,2})\s*(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\s*,?\s*(\d{4})/);
    if (monthNames) {
        const months = { jan: '01', feb: '02', mar: '03', apr: '04', may: '05', jun: '06', jul: '07', aug: '08', sep: '09', oct: '10', nov: '11', dec: '12' };
        return `${monthNames[3]}-${months[monthNames[2].substring(0, 3)]}-${monthNames[1].padStart(2, '0')}`;
    }
    const monthFirst = cleaned.match(/(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\s*(\d{1,2}),?\s*(\d{4})/);
    if (monthFirst) {
        const months = { jan: '01', feb: '02', mar: '03', apr: '04', may: '05', jun: '06', jul: '07', aug: '08', sep: '09', oct: '10', nov: '11', dec: '12' };
        return `${monthFirst[3]}-${months[monthFirst[1].substring(0, 3)]}-${monthFirst[2].padStart(2, '0')}`;
    }

    const parsed = new Date(rawText);
    if (!isNaN(parsed.getTime()) && parsed.getFullYear() > 2000) return parsed.toISOString().split('T')[0];

    const ddmmyyyy = cleaned.match(/(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{4})/);
    if (ddmmyyyy) {
        const d = new Date(`${ddmmyyyy[3]}-${ddmmyyyy[2].padStart(2, '0')}-${ddmmyyyy[1].padStart(2, '0')}`);
        if (!isNaN(d.getTime())) return d.toISOString().split('T')[0];
    }

    return rawText.trim();
}

function getAgeDays(dateString) {
    if (!dateString) return null;
    const date = new Date(dateString);
    if (isNaN(date.getTime())) return null;
    return Math.floor((Date.now() - date.getTime()) / (1000 * 60 * 60 * 24));
}

function matchCommodity(text, commodities) {
    if (!text) return 'unknown';
    const lower = text.toLowerCase();
    for (const c of commodities) {
        const words = c.toLowerCase().split(' ');
        if (words.every((w) => lower.includes(w))) return c;
    }
    for (const c of commodities) {
        if (lower.includes(c.toLowerCase().split(' ')[0])) return c;
    }
    return 'unknown';
}

function generateLeadId(platform, title, country) {
    const raw = `${platform}_${title}_${country}`.toLowerCase().replace(/[^a-z0-9]/g, '');
    let hash = 0;
    for (let i = 0; i < raw.length; i++) { hash = ((hash << 5) - hash) + raw.charCodeAt(i); hash = hash & hash; }
    return `${platform}_${Math.abs(hash).toString(36)}`;
}

function extractQuantityFromText(text) {
    if (!text) return '';
    const m = text.match(/(\d[\d,.]*\s*(?:kg|kgs|kilogram|ton|tons|mt|metric ton|liter|liters|ltr|pound|lbs|gram|grams|gm|quintal|piece|pieces|pcs|unit|units|container|bag|bags|carton|bottle|drum|barrel|box)\b)/i);
    return m ? m[1] : '';
}

function randomDelay(min, max) {
    return new Promise((r) => setTimeout(r, min + Math.random() * (max - min)));
}

function extractCountry(text) {
    if (!text) return '';
    const cleaned = text.replace(/[^\w\s,.-]/g, ' ').trim();
    if (!cleaned) return '';

    const countryList = [
        'Afghanistan', 'Albania', 'Algeria', 'Argentina', 'Armenia', 'Australia', 'Austria', 'Azerbaijan',
        'Bahrain', 'Bangladesh', 'Belarus', 'Belgium', 'Benin', 'Bolivia', 'Bosnia', 'Botswana', 'Brazil', 'Brunei', 'Bulgaria', 'Burkina Faso',
        'Cambodia', 'Cameroon', 'Canada', 'Chad', 'Chile', 'China', 'Colombia', 'Congo', 'Costa Rica', 'Croatia', 'Cuba', 'Cyprus', 'Czech',
        'Denmark', 'Dominican Republic', 'Dubai',
        'Ecuador', 'Egypt', 'El Salvador', 'Estonia', 'Ethiopia',
        'Fiji', 'Finland', 'France',
        'Gabon', 'Gambia', 'Georgia', 'Germany', 'Ghana', 'Greece', 'Guatemala', 'Guinea',
        'Haiti', 'Honduras', 'Hong Kong', 'Hungary',
        'Iceland', 'India', 'Indonesia', 'Iran', 'Iraq', 'Ireland', 'Israel', 'Italy', 'Ivory Coast',
        'Jamaica', 'Japan', 'Jordan',
        'Kazakhstan', 'Kenya', 'Korea', 'South Korea', 'Kuwait', 'Kyrgyzstan',
        'Laos', 'Latvia', 'Lebanon', 'Libya', 'Lithuania', 'Luxembourg',
        'Madagascar', 'Malawi', 'Malaysia', 'Maldives', 'Mali', 'Malta', 'Mauritius', 'Mexico', 'Moldova', 'Mongolia', 'Morocco', 'Mozambique', 'Myanmar',
        'Namibia', 'Nepal', 'Netherlands', 'New Zealand', 'Nicaragua', 'Niger', 'Nigeria', 'Norway',
        'Oman',
        'Pakistan', 'Palestine', 'Panama', 'Papua New Guinea', 'Paraguay', 'Peru', 'Philippines', 'Poland', 'Portugal',
        'Qatar',
        'Romania', 'Russia', 'Rwanda',
        'Saudi Arabia', 'Senegal', 'Serbia', 'Sierra Leone', 'Singapore', 'Slovakia', 'Slovenia', 'Somalia', 'South Africa', 'Spain', 'Sri Lanka', 'Sudan', 'Sweden', 'Switzerland', 'Syria',
        'Taiwan', 'Tajikistan', 'Tanzania', 'Thailand', 'Togo', 'Trinidad', 'Tunisia', 'Turkey', 'Turkmenistan',
        'UAE', 'Uganda', 'Ukraine', 'United Arab Emirates', 'United Kingdom', 'United States', 'Uruguay', 'Uzbekistan',
        'Venezuela', 'Vietnam',
        'Yemen',
        'Zambia', 'Zimbabwe',
        'UK', 'US', 'USA', 'KSA',
    ];

    const lower = cleaned.toLowerCase();
    for (const country of countryList) {
        if (lower.includes(country.toLowerCase())) return country;
    }

    return cleaned.substring(0, 50);
}

function matchesCountryFilter(buyerCountry, filterCountries) {
    if (!filterCountries || filterCountries.length === 0) return true;
    if (!buyerCountry || buyerCountry === 'Not specified' || buyerCountry === '') return true;

    const buyerLower = buyerCountry.toLowerCase().trim();

    const aliases = {
        'united states': ['usa', 'u.s.a', 'u.s', 'america', 'us'],
        'united kingdom': ['uk', 'britain', 'great britain', 'england', 'scotland', 'wales'],
        'united arab emirates': ['uae', 'dubai', 'abu dhabi', 'sharjah'],
        'south korea': ['korea', 'republic of korea', 's. korea'],
        'saudi arabia': ['saudi', 'ksa', 'kingdom of saudi arabia'],
        'netherlands': ['holland', 'the netherlands'],
        'czech republic': ['czechia', 'czech'],
    };

    for (const filterCountry of filterCountries) {
        const filterLower = filterCountry.toLowerCase().trim();
        if (buyerLower === filterLower) return true;
        if (buyerLower.includes(filterLower) || filterLower.includes(buyerLower)) return true;
        for (const [key, aliasList] of Object.entries(aliases)) {
            const allNames = [key, ...aliasList];
            const filterMatches = allNames.some(a => a.includes(filterLower) || filterLower.includes(a));
            const buyerMatches = allNames.some(a => a.includes(buyerLower) || buyerLower.includes(a));
            if (filterMatches && buyerMatches) return true;
        }
    }
    return false;
}


// ════════════════════════════════════════════
// PLATFORM CONFIGURATIONS
// ════════════════════════════════════════════

const PLATFORMS = {

    // ── Go4WorldBusiness (search-form approach) ──
    go4worldbusiness: {
        name: 'go4worldbusiness',
        needsSearchForm: true,
        buildUrl: (commodity, page) => {
            if (page === 1) {
                return `https://www.go4worldbusiness.com/buying-leads.html`;
            }
            return null;
        },
        extract: async (browserPage) => {
            return browserPage.evaluate(() => {
                const leads = [];
                const selectors = [
                    '.lead-list-item', '.buyinglead-item', '.buying-lead-item', '.bl-item',
                    'div[class*="buying-lead"]', 'div[class*="lead-list"]', 'div[class*="bl-"]',
                    'tr[class*="lead"]', 'li[class*="lead"]',
                    'table.leads tbody tr', 'table tbody tr',
                    '.listing-item', '.lead-item', '.card', 'article',
                ];

                let matchedElements = [];
                for (const sel of selectors) {
                    const els = document.querySelectorAll(sel);
                    if (els.length > 0 && els.length < 200) {
                        matchedElements = Array.from(els);
                        break;
                    }
                }

                if (matchedElements.length === 0) {
                    document.querySelectorAll('a[href*="buying"], a[href*="lead"], a[href*="requirement"]').forEach((link) => {
                        const parent = link.closest('div, tr, li, article') || link.parentElement;
                        if (parent && !matchedElements.includes(parent)) {
                            matchedElements.push(parent);
                        }
                    });
                }

                matchedElements.forEach((el) => {
                    const titleEl = el.querySelector(
                        'h2 a, h3 a, h4 a, .lead-title a, .bl-title a, .item-title a, ' +
                        'a[class*="title"], a[href*="buying-lead"], a[href*="bl-"]'
                    ) || el.querySelector('a');

                    const title = titleEl?.textContent?.trim() || '';
                    if (!title || title.length < 5 || title.length > 300) return;

                    const skipWords = ['home', 'about', 'contact', 'login', 'register', 'sign', 'privacy', 'terms', 'menu', 'cart', 'post', 'sell', 'buy now', 'more categories', 'view all'];
                    if (skipWords.some(w => title.toLowerCase() === w || (title.toLowerCase().startsWith(w) && title.length < 25))) return;

                    const desc = el.querySelector('.lead-desc, .bl-desc, .description, .item-desc, p, [class*="desc"]')?.textContent?.trim() || '';
                    const country = el.querySelector('.lead-country, .bl-country, .country, .location, [class*="country"], [class*="location"], img[alt*="flag"]')?.textContent?.trim()
                        || el.querySelector('img[alt*="flag"], img[src*="flag"]')?.alt?.replace(/flag/gi, '').trim() || '';
                    const qty = el.querySelector('.lead-qty, .bl-qty, .quantity, .qty, [class*="qty"], [class*="quantity"]')?.textContent?.trim() || '';
                    const date = el.querySelector('.lead-date, .bl-date, .date, time, [class*="date"], [class*="posted"]')?.textContent?.trim() || '';
                    const link = titleEl?.href || el.querySelector('a')?.href || '';

                    leads.push({ title, description: desc.substring(0, 500), country, quantity: qty, date, contactUrl: link, type: 'buying_lead' });
                });
                return leads;
            });
        },
    },

    // ── TradeIndia BUYING LEADS ──
    tradeindia_buying: {
        name: 'tradeindia-buyingleads',
        needsSearchForm: false,
        buildUrl: (commodity, page) => {
            const slug = commodity.replace(/\s+/g, '+');
            return `https://www.tradeindia.com/buy-requirement/?keyword=${encodeURIComponent(slug)}&page=${page}`;
        },
        extract: async (browserPage) => {
            return browserPage.evaluate(() => {
                const leads = [];
                document.querySelectorAll(
                    '.buy-lead-card, .requirement-card, .buy-req-item, ' +
                    'div[class*="buy-lead"], div[class*="requirement"], div[class*="buy-req"], ' +
                    '.card, .listing-item, .search-result, ' +
                    'div[class*="product"], div[class*="listing"], ' +
                    'table tbody tr, .row .col-md-12, .row .col-lg-12'
                ).forEach((el) => {
                    const title = (
                        el.querySelector('h2 a, h3 a, h4 a, .title a, a[class*="title"], .product-name a, .req-title a') ||
                        el.querySelector('a[href*="buy"], a[href*="requirement"]') ||
                        el.querySelector('a')
                    )?.textContent?.trim() || '';

                    const desc = (
                        el.querySelector('.description, .desc, p.details, .product-desc, .requirement-desc, .req-desc, p') ||
                        el.querySelector('div[class*="desc"]')
                    )?.textContent?.trim() || '';

                    const country = (
                        el.querySelector('.location, .country, .buyer-location, [class*="country"], [class*="location"], .city') ||
                        el.querySelector('span[class*="loc"], div[class*="loc"]')
                    )?.textContent?.trim() || '';

                    const qty = el.querySelector('.quantity, .qty, [class*="qty"], [class*="quantity"], .req-qty')?.textContent?.trim() || '';
                    const date = el.querySelector('.date, time, [class*="date"], .posted-date, .post-date, .req-date')?.textContent?.trim() || '';
                    const link = (
                        el.querySelector('h2 a, h3 a, h4 a, a[class*="title"], a[href*="buy"], a[href*="requirement"]') ||
                        el.querySelector('a')
                    )?.href || '';

                    if (title && title.length > 5 && title.length < 300) {
                        const skipWords = ['home', 'about us', 'contact us', 'login', 'register', 'sign up', 'privacy', 'terms', 'menu', 'cart', 'my account', 'footer', 'header', 'nav', 'copyright'];
                        const titleLower = title.toLowerCase();
                        if (skipWords.some(w => titleLower === w || titleLower.startsWith(w + ' '))) return;
                        leads.push({ title, description: desc.substring(0, 500), country, quantity: qty, date, contactUrl: link, type: 'buying_lead' });
                    }
                });
                return leads;
            });
        },
    },

    // ── TradeIndia PRODUCT SEARCH ──
    tradeindia_products: {
        name: 'tradeindia-products',
        needsSearchForm: false,
        buildUrl: (commodity, page) => {
            const q = encodeURIComponent(commodity);
            return `https://www.tradeindia.com/search.html?keyword=${q}&page=${page}`;
        },
        extract: async (browserPage) => {
            return browserPage.evaluate(() => {
                const leads = [];
                document.querySelectorAll(
                    '.product-card, .listing-item, .search-result, ' +
                    'div[class*="product"], div[class*="listing"], .card'
                ).forEach((el) => {
                    const title = (el.querySelector('h2 a, h3 a, h4 a, .product-name a, a[class*="title"]') || el.querySelector('a'))?.textContent?.trim() || '';
                    const desc = el.querySelector('.description, p, .details, .product-desc')?.textContent?.trim() || '';
                    const country = el.querySelector('.location, .country, [class*="location"]')?.textContent?.trim() || '';
                    const qty = el.querySelector('.qty, .quantity, [class*="qty"]')?.textContent?.trim() || '';
                    const date = el.querySelector('.date, time, [class*="date"]')?.textContent?.trim() || '';
                    const link = (el.querySelector('h2 a, h3 a, a[class*="title"]') || el.querySelector('a'))?.href || '';

                    if (title && title.length > 5 && title.length < 300) {
                        const skipWords = ['home', 'about us', 'contact us', 'login', 'register', 'sign up', 'privacy', 'terms', 'menu', 'cart', 'my account'];
                        if (skipWords.some(w => title.toLowerCase() === w)) return;
                        leads.push({ title, description: desc.substring(0, 500), country, quantity: qty, date, contactUrl: link, type: 'supplier_listing' });
                    }
                });
                return leads;
            });
        },
    },

    // ── IndiaMart ──
    indiamart: {
        name: 'indiamart',
        needsSearchForm: false,
        buildUrl: (commodity, page) => {
            const q = encodeURIComponent(commodity);
            return `https://dir.indiamart.com/search.mp?ss=${q}&page=${page}`;
        },
        extract: async (browserPage) => {
            return browserPage.evaluate(() => {
                const leads = [];
                document.querySelectorAll(
                    '.prd-card, .product-card, .listing-card, .card, ' +
                    'div[class*="product"], div[class*="listing"], div[class*="card"], ' +
                    '.dflx, .brs4, .m-lsBg'
                ).forEach((el) => {
                    const title = (
                        el.querySelector('h2 a, h3 a, h4 a, .prd-name a, [class*="title"] a, [class*="name"] a') ||
                        el.querySelector('a[href*="/proddetail/"], a[href*="/product/"]') ||
                        el.querySelector('a')
                    )?.textContent?.trim() || '';

                    const desc = el.querySelector('.prd-desc, .description, p, [class*="desc"]')?.textContent?.trim() || '';
                    const price = el.querySelector('.prc, .price, [class*="price"], [class*="prc"]')?.textContent?.trim() || '';
                    const company = el.querySelector('.cmp-name, .company, [class*="company"], [class*="supplier"]')?.textContent?.trim() || '';
                    const location = el.querySelector('.city, .location, [class*="city"], [class*="loc"]')?.textContent?.trim() || '';
                    const link = (
                        el.querySelector('h2 a, h3 a, a[href*="/proddetail/"], a[href*="/product/"]') ||
                        el.querySelector('a')
                    )?.href || '';

                    if (title && title.length > 5 && title.length < 300) {
                        const skipWords = ['home', 'about', 'contact', 'login', 'register', 'sign', 'privacy', 'terms', 'menu', 'cart'];
                        if (skipWords.some(w => title.toLowerCase() === w)) return;
                        leads.push({
                            title,
                            description: `${desc} ${price ? '| Price: ' + price : ''} ${company ? '| Supplier: ' + company : ''}`.trim().substring(0, 500),
                            country: location || 'India',
                            quantity: '', date: '',
                            contactUrl: link,
                            type: 'supplier_listing',
                        });
                    }
                });
                return leads;
            });
        },
    },

    // ── Alibaba Buying Requests / RFQ ──
    alibaba_rfq: {
        name: 'alibaba-rfq',
        needsSearchForm: false,
        buildUrl: (commodity, page) => {
            const q = encodeURIComponent(commodity);
            return `https://sourcing.alibaba.com/rfq/buying_request_list.htm?searchText=${q}&page=${page}`;
        },
        extract: async (browserPage) => {
            return browserPage.evaluate(() => {
                const leads = [];
                document.querySelectorAll(
                    '.buying-request-item, .rfq-item, .request-item, ' +
                    'div[class*="request"], div[class*="rfq"], div[class*="buying"], ' +
                    '.card, .listing-item, table tbody tr, ' +
                    'li[class*="item"], div[class*="item"]'
                ).forEach((el) => {
                    const title = (
                        el.querySelector('h2 a, h3 a, h4 a, .title a, [class*="title"] a, .subject a') ||
                        el.querySelector('a[href*="buying"], a[href*="rfq"], a[href*="request"]') ||
                        el.querySelector('a')
                    )?.textContent?.trim() || '';

                    const desc = el.querySelector('.description, .desc, p, .details, .content, [class*="desc"]')?.textContent?.trim() || '';
                    const country = el.querySelector('.country, .location, .buyer-country, [class*="country"], [class*="location"], img[alt*="flag"]')?.textContent?.trim()
                        || el.querySelector('img[alt*="flag"]')?.alt?.replace(/flag/gi, '').trim() || '';
                    const qty = el.querySelector('.quantity, .qty, [class*="qty"], [class*="quantity"]')?.textContent?.trim() || '';
                    const date = el.querySelector('.date, time, [class*="date"], [class*="time"], .posted')?.textContent?.trim() || '';
                    const link = (
                        el.querySelector('h2 a, h3 a, a[class*="title"], a[href*="buying"], a[href*="rfq"]') ||
                        el.querySelector('a')
                    )?.href || '';

                    if (title && title.length > 5 && title.length < 300) {
                        const skipWords = ['home', 'about', 'contact', 'login', 'register', 'sign', 'privacy', 'terms', 'menu', 'cart', 'join', 'help', 'post buying'];
                        if (skipWords.some(w => title.toLowerCase() === w || title.toLowerCase().startsWith(w + ' '))) return;
                        leads.push({ title, description: desc.substring(0, 500), country, quantity: qty, date, contactUrl: link, type: 'buying_lead' });
                    }
                });
                return leads;
            });
        },
    },

    // ── Alibaba Product Search ──
    alibaba_products: {
        name: 'alibaba-products',
        needsSearchForm: false,
        buildUrl: (commodity, page) => {
            const q = encodeURIComponent(commodity);
            return `https://www.alibaba.com/trade/search?SearchText=${q}&page=${page}`;
        },
        extract: async (browserPage) => {
            return browserPage.evaluate(() => {
                const leads = [];
                document.querySelectorAll(
                    '.organic-list-offer-outter, .J-offer-wrapper, .offer-card, ' +
                    'div[class*="offer"], div[class*="product-card"], ' +
                    '.card, .list-item, div[class*="item"]'
                ).forEach((el) => {
                    const title = (
                        el.querySelector('h2 a, h3 a, h4 a, .elements-title-normal a, [class*="title"] a') ||
                        el.querySelector('a[href*="/product-detail/"]') ||
                        el.querySelector('a')
                    )?.textContent?.trim() || '';

                    const price = el.querySelector('.elements-offer-normal-price, .price, [class*="price"]')?.textContent?.trim() || '';
                    const moq = el.querySelector('.elements-offer-normal-min-order, .moq, [class*="min-order"], [class*="moq"]')?.textContent?.trim() || '';
                    const supplier = el.querySelector('.elements-offer-normal-company, .company, [class*="company"], [class*="supplier"]')?.textContent?.trim() || '';
                    const country = el.querySelector('.country, .location, [class*="country"]')?.textContent?.trim() || '';
                    const link = (
                        el.querySelector('h2 a, h3 a, a[href*="/product-detail/"]') ||
                        el.querySelector('a')
                    )?.href || '';

                    if (title && title.length > 5 && title.length < 300) {
                        const skipWords = ['home', 'about', 'contact', 'login', 'register', 'join free', 'sign', 'privacy', 'terms', 'menu'];
                        if (skipWords.some(w => title.toLowerCase() === w)) return;
                        leads.push({
                            title,
                            description: `${price ? 'Price: ' + price + ' | ' : ''}${moq ? 'MOQ: ' + moq + ' | ' : ''}${supplier ? 'Supplier: ' + supplier : ''}`.trim().substring(0, 500),
                            country: country || '', quantity: moq, date: '',
                            contactUrl: link, type: 'supplier_listing',
                        });
                    }
                });
                return leads;
            });
        },
    },
};


// ════════════════════════════════════════════
// MAIN ACTOR
// ════════════════════════════════════════════

await Actor.init();

const input = await Actor.getInput() || {};
const {
    commodities = ['lemongrass essential oil', 'rice'],
    buyerCountries = [],
    maxPages = 3,
    minOrderQuantityKg = 10,
    maxLeadAgeDays = 90,
    debugMode = false,
    proxyConfig = { useApifyProxy: true, apifyProxyGroups: ['RESIDENTIAL'] },
} = input;

log.info('🌿 AgriTech Buyer Discovery — Starting');
log.info(`  Commodities      : ${commodities.join(', ')}`);
log.info(`  Buyer countries  : ${buyerCountries.length > 0 ? buyerCountries.join(', ') : 'ALL (no filter)'}`);
log.info(`  Max pages        : ${maxPages}`);
log.info(`  Min order        : ${minOrderQuantityKg} kg`);
log.info(`  Max age          : ${maxLeadAgeDays} days`);
log.info(`  Debug mode       : ${debugMode}`);
log.info(`  Platforms        : ${Object.keys(PLATFORMS).join(', ')}`);

let proxyConfiguration;
try {
    proxyConfiguration = await Actor.createProxyConfiguration(proxyConfig);
    log.info(`  Proxy            : configured`);
} catch (err) {
    log.warning(`  Proxy failed: ${err.message}`);
}

// Build requests
const requests = [];
for (const [platformKey, platform] of Object.entries(PLATFORMS)) {
    for (const commodity of commodities) {
        if (platform.needsSearchForm) {
            // Search-form platforms: only queue page 1
            // Pagination handled inside request handler
            const url = platform.buildUrl(commodity, 1);
            if (url) {
                requests.push({
                    url,
                    userData: { platformKey, platformName: platform.name, commodity, page: 1 },
                    uniqueKey: `${platformKey}_${commodity}_1`,
                });
            }
        } else {
            // Normal platforms: queue all pages
            for (let page = 1; page <= maxPages; page++) {
                const url = platform.buildUrl(commodity, page);
                if (url) {
                    requests.push({
                        url,
                        userData: { platformKey, platformName: platform.name, commodity, page },
                        uniqueKey: `${platformKey}_${commodity}_${page}`,
                    });
                }
            }
        }
    }
}

log.info(`  Total URLs       : ${requests.length}`);

// Stats
const stats = {
    totalRaw: 0, totalFiltered: 0,
    filteredByCountry: 0, filteredByQuantity: 0, filteredByAge: 0,
    duplicatesSkipped: 0,
    byCommodity: {}, byPlatform: {}, byCountry: {},
    byType: { buying_lead: 0, supplier_listing: 0 },
    countriesFound: {},
    errors: [], skipped: [],
};
const seenLeads = new Set();
const allLeads = [];


// ════════════════════════════════════════════
// LEAD PROCESSING FUNCTION (reused for main + pagination)
// ════════════════════════════════════════════

function processLead(raw, platformName, commodity, sourceUrl) {
    try {
        const leadId = generateLeadId(platformName, raw.title, raw.country);

        if (seenLeads.has(leadId)) {
            stats.duplicatesSkipped++;
            return null;
        }
        seenLeads.add(leadId);

        const qtyText = raw.quantity || extractQuantityFromText(raw.title + ' ' + (raw.description || ''));
        const quantity = parseQuantity(qtyText);
        const postedDate = parseDate(raw.date);
        const ageDays = getAgeDays(postedDate);
        const matched = matchCommodity(raw.title + ' ' + (raw.description || ''), commodities);
        const cleanCountry = extractCountry(raw.country);

        const countryKey = cleanCountry || 'Unknown';
        stats.countriesFound[countryKey] = (stats.countriesFound[countryKey] || 0) + 1;

        if (!matchesCountryFilter(cleanCountry, buyerCountries)) { stats.filteredByCountry++; return null; }
        if (quantity.normalizedKg && quantity.normalizedKg < minOrderQuantityKg) { stats.filteredByQuantity++; return null; }
        if (ageDays !== null && ageDays > maxLeadAgeDays) { stats.filteredByAge++; return null; }

        const leadType = raw.type || 'unknown';

        const cleanLead = {
            leadId,
            platform: platformName,
            leadType,
            title: raw.title,
            description: raw.description || '',
            commodity: matched !== 'unknown' ? matched : commodity,
            commodityMatchConfidence: matched !== 'unknown' ? 'high' : 'medium',
            buyerCountry: cleanCountry || 'Not specified',
            quantity: quantity.raw || 'Not specified',
            quantityValue: quantity.value,
            quantityUnit: quantity.unit,
            quantityKg: quantity.normalizedKg,
            postedDate: postedDate || 'Unknown',
            postedDateRaw: raw.date || '',
            ageDays,
            contactUrl: raw.contactUrl || '',
            sourceUrl,
            scrapedAt: new Date().toISOString(),
            searchQuery: commodity,
        };

        allLeads.push(cleanLead);

        stats.totalFiltered++;
        stats.byCommodity[commodity] = (stats.byCommodity[commodity] || 0) + 1;
        stats.byPlatform[platformName] = (stats.byPlatform[platformName] || 0) + 1;
        stats.byType[leadType] = (stats.byType[leadType] || 0) + 1;
        if (cleanCountry) stats.byCountry[cleanCountry] = (stats.byCountry[cleanCountry] || 0) + 1;

        return cleanLead;
    } catch (err) {
        log.warning(`  Error processing lead: ${err.message}`);
        return null;
    }
}


// ════════════════════════════════════════════
// GENERIC FALLBACK EXTRACTOR
// ════════════════════════════════════════════

async function genericExtract(browserPage) {
    return browserPage.evaluate(() => {
        const leads = [];
        document.querySelectorAll(
            'div[class*="item"], div[class*="card"], div[class*="list"] > div, ' +
            'div[class*="result"], article, li[class*="item"], tr'
        ).forEach((el) => {
            const mainLink = el.querySelector('a');
            if (!mainLink) return;
            const title = mainLink.textContent?.trim() || '';
            if (title.length < 5 || title.length > 300) return;
            const skipWords = ['home', 'about', 'contact us', 'login', 'register', 'sign', 'privacy', 'terms', 'menu', 'cart', 'account', 'help', 'faq'];
            if (skipWords.some(w => title.toLowerCase().includes(w) && title.length < 30)) return;
            leads.push({
                title,
                description: el.textContent?.substring(0, 500).replace(title, '').trim() || '',
                country: '', quantity: '', date: '',
                contactUrl: mainLink.href || '',
                type: 'unknown',
            });
        });
        return leads;
    });
}


// ════════════════════════════════════════════
// CRAWLER
// ════════════════════════════════════════════

const crawler = new PlaywrightCrawler({
    proxyConfiguration,
    maxConcurrency: 3,
    maxRequestsPerMinute: 15,
    requestHandlerTimeoutSecs: 180,
    navigationTimeoutSecs: 90,
    maxRequestRetries: 2,

    launchContext: {
        launchOptions: {
            args: ['--disable-blink-features=AutomationControlled', '--no-sandbox'],
        },
    },

    preNavigationHooks: [
        async ({ page }) => {
            await page.addInitScript(() => {
                Object.defineProperty(navigator, 'webdriver', { get: () => false });
                Object.defineProperty(navigator, 'plugins', { get: () => [1, 2, 3, 4, 5] });
                Object.defineProperty(navigator, 'languages', { get: () => ['en-US', 'en'] });
                window.chrome = { runtime: {} };
            });
            await page.setViewportSize({ width: 1366, height: 768 });
            await page.setExtraHTTPHeaders({
                'Accept-Language': 'en-US,en;q=0.9',
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
                'Sec-Fetch-Dest': 'document',
                'Sec-Fetch-Mode': 'navigate',
                'Sec-Fetch-Site': 'none',
            });
        },
    ],

    async requestHandler({ request, page, response }) {
        const { platformKey, platformName, commodity, page: pageNum } = request.userData;
        const statusCode = response?.status() || 0;

        log.info(`  [${platformName}] page ${pageNum} — "${commodity}" — HTTP ${statusCode}`);

        if (!request.url || request.url === 'null') return;

        if (statusCode >= 400) {
            log.warning(`  [${platformName}] HTTP ${statusCode} — skipping`);
            stats.skipped.push({ platform: platformName, url: request.url, status: statusCode });
            return;
        }

        // Wait for content
        try {
            await page.waitForLoadState('domcontentloaded', { timeout: 30000 });
            await randomDelay(2000, 4000);
        } catch (err) {
            log.warning(`  [${platformName}] Load timeout: ${err.message}`);
        }

        // ── HANDLE CLOUDFLARE / ANTI-BOT ──
        let pageTitle = await page.title();
        const bodyText = await page.evaluate(() => document.body?.innerText?.substring(0, 500) || '');

        if (
            pageTitle.toLowerCase().includes('just a moment') ||
            pageTitle.toLowerCase().includes('attention required') ||
            pageTitle.toLowerCase().includes('checking') ||
            bodyText.includes('Checking your browser') ||
            bodyText.includes('Please Wait') ||
            bodyText.includes('Verify you are human') ||
            bodyText.includes('Enable JavaScript')
        ) {
            log.info(`  [${platformName}] 🛡️ Challenge detected. Waiting...`);

            for (let attempt = 0; attempt < 6; attempt++) {
                await randomDelay(4000, 6000);
                pageTitle = await page.title();
                const newBody = await page.evaluate(() => document.body?.innerText?.substring(0, 200) || '');

                if (
                    !pageTitle.toLowerCase().includes('just a moment') &&
                    !pageTitle.toLowerCase().includes('attention') &&
                    !pageTitle.toLowerCase().includes('checking') &&
                    !newBody.includes('Checking your browser') &&
                    !newBody.includes('Please Wait')
                ) {
                    log.info(`  [${platformName}] ✅ Challenge resolved after ${(attempt + 1) * 5}s`);
                    break;
                }

                if (attempt === 5) {
                    log.warning(`  [${platformName}] ❌ Challenge not resolved. Skipping.`);
                    stats.skipped.push({ platform: platformName, url: request.url, reason: 'anti-bot challenge timeout' });
                    return;
                }
            }
        }

        // ── COOKIE CONSENT ──
        try {
            const cookieBtn = await page.$('button[class*="cookie"], button[class*="consent"], button[class*="accept"], #accept-cookies, .cookie-accept, a[class*="cookie"]');
            if (cookieBtn) {
                await cookieBtn.click();
                log.info(`  [${platformName}] 🍪 Accepted cookies`);
                await randomDelay(1000, 2000);
            }
        } catch {}

        // ── SEARCH-FORM PLATFORMS (Go4WorldBusiness) ──
        const platform = PLATFORMS[platformKey];

        if (platform.needsSearchForm && pageNum === 1) {
            log.info(`  [${platformName}] 🔍 Using search form for "${commodity}"...`);

            let searchWorked = false;

            // Strategy 1: Find and use the search input
            try {
                const searchSelectors = [
                    'input[name="search"]', 'input[name="q"]', 'input[name="keyword"]',
                    'input[name="SearchText"]', 'input[type="search"]',
                    '#search', '#keyword', '.search-input',
                    'input[placeholder*="search" i]', 'input[placeholder*="Search" i]',
                    'input[placeholder*="product" i]', 'input[placeholder*="buying" i]',
                    'form input[type="text"]',
                ];

                let searchInput = null;
                for (const sel of searchSelectors) {
                    searchInput = await page.$(sel);
                    if (searchInput) {
                        const isVisible = await searchInput.isVisible();
                        if (isVisible) {
                            log.info(`  [${platformName}] Found search input: ${sel}`);
                            break;
                        }
                        searchInput = null;
                    }
                }

                if (searchInput) {
                    await searchInput.click({ clickCount: 3 });
                    await randomDelay(300, 600);
                    await searchInput.fill(commodity);
                    await randomDelay(500, 1000);
                    await searchInput.press('Enter');
                    await randomDelay(3000, 5000);

                    try {
                        await page.waitForLoadState('domcontentloaded', { timeout: 15000 });
                    } catch {}

                    const newTitle = await page.title();
                    const newUrl = page.url();
                    log.info(`  [${platformName}] After search — Title: "${newTitle}" | URL: ${newUrl.substring(0, 80)}...`);
                    searchWorked = true;
                } else {
                    log.info(`  [${platformName}] No search input found. Trying direct URLs...`);
                }
            } catch (err) {
                log.warning(`  [${platformName}] Search form error: ${err.message}`);
            }

            // Strategy 2: Direct URLs
            if (!searchWorked) {
                const directUrls = [
                    `https://www.go4worldbusiness.com/buying-leads.html?search=${encodeURIComponent(commodity)}`,
                    `https://www.go4worldbusiness.com/buying-leads/${commodity.replace(/\s+/g, '-').toLowerCase()}.html`,
                    `https://www.go4worldbusiness.com/search/?q=${encodeURIComponent(commodity)}&type=buying`,
                    `https://www.go4worldbusiness.com/buying-leads/?keyword=${encodeURIComponent(commodity)}`,
                ];

                for (const url of directUrls) {
                    try {
                        log.info(`  [${platformName}] Trying: ${url.substring(0, 80)}...`);
                        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
                        await randomDelay(3000, 5000);

                        const title = await page.title();
                        const linkCount = await page.evaluate(() => document.querySelectorAll('a').length);

                        if (!title.toLowerCase().includes('error') && linkCount > 20) {
                            log.info(`  [${platformName}] ✅ URL worked! Title: "${title}" | Links: ${linkCount}`);
                            searchWorked = true;
                            break;
                        }
                    } catch (err) {
                        log.warning(`  [${platformName}] URL failed: ${err.message}`);
                    }
                }
            }

            // Strategy 3: Homepage navigation
            if (!searchWorked) {
                try {
                    log.info(`  [${platformName}] Trying homepage navigation...`);
                    await page.goto('https://www.go4worldbusiness.com/', { waitUntil: 'domcontentloaded', timeout: 30000 });
                    await randomDelay(3000, 5000);

                    try {
                        const cookieBtn2 = await page.$('button[class*="cookie"], button[class*="accept"], #accept-cookies');
                        if (cookieBtn2) await cookieBtn2.click();
                        await randomDelay(1000, 2000);
                    } catch {}

                    const buyingLeadsLink = await page.$('a[href*="buying-leads"], a[href*="buying_leads"], a:has-text("Buying Leads"), a:has-text("Buy Leads")');
                    if (buyingLeadsLink) {
                        await buyingLeadsLink.click();
                        await randomDelay(3000, 5000);
                        await page.waitForLoadState('domcontentloaded', { timeout: 15000 }).catch(() => {});

                        const searchInput = await page.$('input[name="search"], input[type="search"], input[type="text"]');
                        if (searchInput) {
                            await searchInput.fill(commodity);
                            await searchInput.press('Enter');
                            await randomDelay(3000, 5000);
                            searchWorked = true;
                            log.info(`  [${platformName}] ✅ Navigation approach worked!`);
                        }
                    }
                } catch (err) {
                    log.warning(`  [${platformName}] Homepage navigation failed: ${err.message}`);
                }
            }

            if (!searchWorked) {
                log.warning(`  [${platformName}] ❌ All search strategies failed.`);
                stats.skipped.push({ platform: platformName, url: request.url, reason: 'search form not found' });
            }
        }

        // ── SCROLL FOR LAZY LOADING ──
        try {
            await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight / 3));
            await randomDelay(1000, 2000);
            await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight * 2 / 3));
            await randomDelay(1000, 2000);
            await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
            await randomDelay(1000, 1500);
        } catch {}

        try {
            await page.waitForSelector('a[href]', { timeout: 10000 });
        } catch {}

        // ── DEBUG MODE ──
        if (debugMode) {
            const html = await page.content();
            const debugKey = `DEBUG_${platformName}_${commodity.replace(/\s+/g, '_')}_p${pageNum}`;
            await Actor.setValue(debugKey, html, { contentType: 'text/html' });

            const title = await page.title();
            const linkCount = await page.evaluate(() => document.querySelectorAll('a').length);
            const bodyPreview = await page.evaluate(() => document.body?.innerText?.substring(0, 300) || 'EMPTY');
            log.info(`  [DEBUG] Title: "${title}" | Links: ${linkCount}`);
            log.info(`  [DEBUG] Preview: ${bodyPreview.substring(0, 150)}...`);
        }

        // ── BLOCKED/ERROR CHECK ──
        pageTitle = await page.title();
        if (
            pageTitle.toLowerCase().includes('access denied') ||
            pageTitle.toLowerCase().includes('blocked') ||
            pageTitle.toLowerCase().includes('seized')
        ) {
            log.warning(`  [${platformName}] ⚠️ Blocked: "${pageTitle}"`);
            stats.skipped.push({ platform: platformName, url: request.url, reason: `blocked: ${pageTitle}` });
            return;
        }

        // ── NO RESULTS CHECK ──
        const noResults = await page.evaluate(() => {
            const text = document.body?.innerText?.toLowerCase() || '';
            return (
                text.includes('no results found') ||
                text.includes('no records found') ||
                text.includes('no leads found') ||
                text.includes('no matching') ||
                text.includes('0 results') ||
                text.includes('did not match') ||
                text.includes('no products found') ||
                text.includes('sorry, no')
            );
        });

        if (noResults) {
            log.info(`  [${platformName}] No results for "${commodity}" on page ${pageNum}`);
            return;
        }

        // ── EXTRACT LEADS ──
        let rawLeads = [];

        try {
            rawLeads = await platform.extract(page);
        } catch (err) {
            log.warning(`  [${platformName}] Extraction error: ${err.message}`);
            try {
                rawLeads = await genericExtract(page);
                if (rawLeads.length > 0) log.info(`  [${platformName}] Fallback extraction: ${rawLeads.length} items`);
            } catch (err2) {
                log.warning(`  [${platformName}] Fallback also failed`);
            }
        }

        log.info(`  [${platformName}] Raw listings: ${rawLeads.length}`);
        stats.totalRaw += rawLeads.length;

        // Process each lead
        for (const raw of rawLeads) {
            processLead(raw, platformName, commodity, request.url);
        }

        // ── PAGINATION for search-form platforms ──
        if (platform.needsSearchForm && rawLeads.length > 0 && pageNum === 1) {
            try {
                const nextSelectors = [
                    'a.next', 'a[rel="next"]', '.pagination .next a',
                    'a:has-text("Next")', 'a:has-text("»")', 'a:has-text(">")',
                    '.page-next a', 'li.next a',
                ];

                for (let extraPage = 2; extraPage <= maxPages; extraPage++) {
                    let nextBtn = null;
                    for (const sel of nextSelectors) {
                        try {
                            nextBtn = await page.$(sel);
                            if (nextBtn && await nextBtn.isVisible()) break;
                            nextBtn = null;
                        } catch {}
                    }

                    if (!nextBtn) {
                        log.info(`  [${platformName}] No more pages after page ${extraPage - 1}`);
                        break;
                    }

                    log.info(`  [${platformName}] Clicking to page ${extraPage}...`);
                    await nextBtn.click();
                    await randomDelay(3000, 5000);
                    await page.waitForLoadState('domcontentloaded', { timeout: 15000 }).catch(() => {});

                    const moreLeads = await platform.extract(page).catch(() => []);
                    log.info(`  [${platformName}] Page ${extraPage}: ${moreLeads.length} listings`);
                    stats.totalRaw += moreLeads.length;

                    for (const raw of moreLeads) {
                        processLead(raw, platformName, commodity, page.url());
                    }
                }
            } catch (err) {
                log.warning(`  [${platformName}] Pagination error: ${err.message}`);
            }
        }

        await randomDelay(2000, 4000);
    },

    async failedRequestHandler({ request }, error) {
        const { platformName } = request.userData;
        log.error(`  ❌ [${platformName}] Failed: ${request.url} — ${error.message}`);
        stats.errors.push({ platform: platformName, url: request.url, error: error.message });
    },
});


// ════════════════════════════════════════════
// RUN
// ════════════════════════════════════════════

await crawler.run(requests);


// ════════════════════════════════════════════
// SORT BY DATE (newest first) AND PUSH
// ════════════════════════════════════════════

log.info('');
log.info('📅 Sorting leads by posted date (newest first)...');

allLeads.sort((a, b) => {
    const dateA = new Date(a.postedDate);
    const dateB = new Date(b.postedDate);
    const validA = !isNaN(dateA.getTime());
    const validB = !isNaN(dateB.getTime());
    if (validA && validB) return dateB.getTime() - dateA.getTime();
    if (validA && !validB) return -1;
    if (!validA && validB) return 1;
    if (a.ageDays !== null && b.ageDays !== null) return a.ageDays - b.ageDays;
    if (a.ageDays !== null) return -1;
    if (b.ageDays !== null) return 1;
    return 0;
});

for (let i = 0; i < allLeads.length; i++) {
    allLeads[i].rank = i + 1;
    allLeads[i].totalLeads = allLeads.length;
    await Actor.pushData(allLeads[i]);
}


// ════════════════════════════════════════════
// SUMMARY
// ════════════════════════════════════════════

const buyingLeads = allLeads.filter(l => l.leadType === 'buying_lead');
const supplierLeads = allLeads.filter(l => l.leadType === 'supplier_listing');

log.info('');
log.info('════════════════════════════════════════════════════════════');
log.info('🌿 SCRAPING COMPLETE');
log.info('════════════════════════════════════════════════════════════');
log.info(`  Total raw listings      : ${stats.totalRaw}`);
log.info(`  Duplicates removed      : ${stats.duplicatesSkipped}`);
log.info(`  Filtered by country     : ${stats.filteredByCountry}`);
log.info(`  Filtered by quantity    : ${stats.filteredByQuantity}`);
log.info(`  Filtered by age         : ${stats.filteredByAge}`);
log.info(`  ─────────────────────────────────────`);
log.info(`  ✅ Final leads          : ${stats.totalFiltered}`);
log.info(`     🛒 Buying leads (RFQs) : ${buyingLeads.length}`);
log.info(`     🏭 Supplier listings    : ${supplierLeads.length}`);
log.info(`  ─────────────────────────────────────`);
log.info(`  By commodity            : ${JSON.stringify(stats.byCommodity)}`);
log.info(`  By platform             : ${JSON.stringify(stats.byPlatform)}`);
log.info(`  By country (in results) : ${JSON.stringify(stats.byCountry)}`);

if (buyerCountries.length > 0) {
    log.info(`  Country filter          : ${buyerCountries.join(', ')}`);
}

log.info('');
log.info('  🌍 ALL COUNTRIES FOUND IN RAW DATA (before filtering):');
const sortedCountries = Object.entries(stats.countriesFound).sort((a, b) => b[1] - a[1]);
for (const [country, count] of sortedCountries) {
    const marker = matchesCountryFilter(country, buyerCountries) ? '✅' : '❌';
    log.info(`     ${marker} ${country}: ${count} listings`);
}

if (stats.skipped.length > 0) {
    log.info('');
    log.info('  ⚠️ Skipped pages:');
    const skipReasons = {};
    for (const s of stats.skipped) {
        const reason = s.reason || `HTTP ${s.status}`;
        const key = `${s.platform}: ${reason}`;
        skipReasons[key] = (skipReasons[key] || 0) + 1;
    }
    for (const [reason, count] of Object.entries(skipReasons)) {
        log.info(`     ⚠️ ${reason} (${count}x)`);
    }
}

if (stats.errors.length > 0) {
    log.info('');
    log.info(`  ❌ Errors: ${stats.errors.length}`);
    for (const e of stats.errors.slice(0, 5)) {
        log.info(`     ${e.platform}: ${e.error.substring(0, 80)}`);
    }
}

log.info('');
log.info('════════════════════════════════════════════════════════════');

if (stats.totalFiltered === 0) {
    log.info('');
    log.info('⚠️  NO LEADS IN FINAL OUTPUT — HERE\'S WHY:');
    log.info('');

    if (stats.filteredByCountry > 0) {
        log.info(`  🌍 ${stats.filteredByCountry} leads removed by country filter.`);
        log.info(`     Your filter: ${buyerCountries.join(', ')}`);
        log.info(`     Countries found: ${sortedCountries.map(([c, n]) => `${c}(${n})`).join(', ')}`);
        log.info('');
        log.info('     👉 FIX: Remove the country filter (leave empty) to see ALL leads.');
        log.info('     👉 OR: Add the countries shown above to your filter.');
    }

    if (stats.filteredByQuantity > 0) {
        log.info(`  ⚖️ ${stats.filteredByQuantity} leads removed by quantity (min: ${minOrderQuantityKg} kg).`);
        log.info('     👉 FIX: Lower minOrderQuantityKg to 0');
    }

    if (stats.filteredByAge > 0) {
        log.info(`  📅 ${stats.filteredByAge} leads removed by age (max: ${maxLeadAgeDays} days).`);
        log.info('     👉 FIX: Increase maxLeadAgeDays to 365');
    }

    if (stats.totalRaw === 0) {
        log.info('  🔍 No listings found on any platform.');
        log.info('     👉 Run with debugMode: true and check Key-Value Store');
    }

    log.info('');
}

if (allLeads.length > 0) {
    log.info('🏆 TOP 5 LEADS:');
    for (const lead of allLeads.slice(0, 5)) {
        log.info(`  #${lead.rank} [${lead.leadType}] ${lead.buyerCountry} — ${lead.commodity}`);
        log.info(`     ${lead.title.substring(0, 80)}`);
        log.info(`     Posted: ${lead.postedDate} | Qty: ${lead.quantity}`);
    }
    log.info('');
}

await Actor.setValue('RUN_SUMMARY', {
    runDate: new Date().toISOString(),
    stats,
    countriesFoundInRawData: stats.countriesFound,
    leadsCount: allLeads.length,
    buyingLeads: buyingLeads.length,
    supplierListings: supplierLeads.length,
    sortedBy: 'postedDate (newest first)',
    input: { commodities, buyerCountries, maxPages, minOrderQuantityKg, maxLeadAgeDays },
});

log.info('Done. Check the Dataset tab for your leads.');
await Actor.exit();