# 🌿 AgriTech B2B Export Intelligence — Buyer Discovery

Find international B2B buyers for agricultural commodities across global trade directories. Built for exporters of essential oils, spices, rice, organic products, and other agricultural goods.

## What does this actor do?

This actor scrapes **buying leads and supplier listings** from multiple international B2B trade platforms to help agricultural exporters find real buyers worldwide.

It searches across **6 live platforms**, extracts buyer requests, filters by country/quantity/date, removes duplicates, and delivers a clean sorted dataset — newest leads first.

### Platforms Scraped

| Platform | Type | What it finds |
|---|---|---|
| **Go4WorldBusiness** | B2B Directory | 🛒 Buying leads / RFQs from international buyers |
| **TradeIndia** (Buy Requirements) | B2B Marketplace | 🛒 Active purchase requirements |
| **TradeIndia** (Products) | B2B Marketplace | 🏭 Supplier listings & price intel |
| **IndiaMart** | B2B Marketplace | 🏭 Supplier listings, prices, MOQs |
| **Alibaba** (RFQ Section) | Global B2B | 🛒 Buying requests from global buyers |
| **Alibaba** (Product Search) | Global B2B | 🏭 Supplier listings, prices, MOQs |

### Lead Types

- **🛒 Buying Leads (RFQs)** — Real purchase requests from buyers looking for your product. These are your hot leads.
- **🏭 Supplier Listings** — Competitor and market intelligence. See who else is selling, at what price, and from where.

---

## Who is this for?

- 🌿 **Essential oil distillers & exporters** — lemongrass, citronella, vetiver, eucalyptus, peppermint, tea tree
- 🌶️ **Spice exporters** — turmeric, black pepper, cardamom, cumin, chili
- 🍚 **Rice & grain exporters** — basmati, non-basmati, organic rice
- 🌱 **Organic product exporters** — moringa, ashwagandha, spirulina, herbs
- 🏭 **Agricultural commodity traders** — any bulk agricultural product
- 📊 **Export consultants & trade facilitation firms** — market research for clients
- 👨‍🌾 **Farmer Producer Organizations (FPOs)** — finding direct international buyers

---

## Input Parameters

| Parameter | Type | Required | Default | Description |
|---|---|---|---|---|
| `commodities` | String List | ✅ | `["lemongrass essential oil", "citronella oil"]` | Products to search for. Add as many as you need. |
| `buyerCountries` | String List | ❌ | `[]` (all countries) | Filter results to specific buyer countries. Leave empty for worldwide. |
| `maxPages` | Integer | ❌ | `5` | Pages to scrape per platform per commodity (1-20). More pages = more results but higher cost. |
| `minOrderQuantityKg` | Integer | ❌ | `25` | Minimum order size in kg. Set to `0` to include all. |
| `maxLeadAgeDays` | Integer | ❌ | `30` | Only include leads posted within this many days. Set to `365` for maximum coverage. |
| `debugMode` | Boolean | ❌ | `false` | Saves raw HTML from every page to Key-Value Store for troubleshooting. |
| `proxyConfig` | Proxy | ❌ | Apify Residential | Proxy configuration. **RESIDENTIAL proxies recommended** for best results. |

### Input Example

```json
{
    "commodities": [
        "lemongrass essential oil",
        "citronella oil",
        "basmati rice"
    ],
    "buyerCountries": [
        "United States",
        "Germany",
        "Japan",
        "United Kingdom",
        "France",
        "UAE"
    ],
    "maxPages": 3,
    "minOrderQuantityKg": 25,
    "maxLeadAgeDays": 30,
    "debugMode": false,
    "proxyConfig": {
        "useApifyProxy": true,
        "apifyProxyGroups": ["RESIDENTIAL"]
    }
}