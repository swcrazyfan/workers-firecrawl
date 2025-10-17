# API Testing Cheatsheet

This file contains ready-to-use curl commands for testing the workers-firecrawl API.

## Table of Contents

1. [Basic Search](#basic-search)
2. [Search with Time Filters](#search-with-time-filters)
3. [Search with Region Filters](#search-with-region-filters)
4. [Combined Time and Region Filters](#combined-time-and-region-filters)
5. [Image Search](#image-search)
6. [News Search](#news-search)
7. [Multiple Source Search](#multiple-source-search)
8. [URL Scraping](#url-scraping)
9. [Custom Date Range Search](#custom-date-range-search)
10. [Region-Specific Search](#region-specific-search)
11. [Search with Browser Actions](#search-with-browser-actions)
12. [Advanced Scrape Options](#advanced-scrape-options)
13. [Parameter Reference](#parameter-reference)

## Basic Search

```bash
curl -X POST "https://workers-firecrawl.joshua-55c.workers.dev/v2/search" \
  -H "Authorization: Bearer 76b8950bba6df685bf1b288ad1d2848b8e634a64d785801cd1d2892648f851a6" \
  -H "Content-Type: application/json" \
  -d '{
    "query": "Cloudflare Workers",
    "limit": 5,
    "scrapeOptions": {
      "formats": ["markdown", "metadata"]
    }
  }'
```

## Search with Time Filters

### Past Day
```bash
curl -X POST "https://workers-firecrawl.joshua-55c.workers.dev/v2/search" \
  -H "Authorization: Bearer 76b8950bba6df685bf1b288ad1d2848b8e634a64d785801cd1d2892648f851a6" \
  -H "Content-Type: application/json" \
  -d '{
    "query": "latest technology news",
    "sources": ["news"],
    "limit": 5,
    "tbs": "qdr:d",
    "scrapeOptions": {
      "formats": ["markdown", "metadata"]
    }
  }'
```

### Past Week
```bash
curl -X POST "https://workers-firecrawl.joshua-55c.workers.dev/v2/search" \
  -H "Authorization: Bearer 76b8950bba6df685bf1b288ad1d2848b8e634a64d785801cd1d2892648f851a6" \
  -H "Content-Type: application/json" \
  -d '{
    "query": "artificial intelligence developments",
    "sources": ["news"],
    "limit": 5,
    "tbs": "qdr:w",
    "scrapeOptions": {
      "formats": ["markdown", "metadata"]
    }
  }'
```

### Past Month
```bash
curl -X POST "https://workers-firecrawl.joshua-55c.workers.dev/v2/search" \
  -H "Authorization: Bearer 76b8950bba6df685bf1b288ad1d2848b8e634a64d785801cd1d2892648f851a6" \
  -H "Content-Type: application/json" \
  -d '{
    "query": "machine learning research",
    "sources": ["news"],
    "limit": 5,
    "tbs": "qdr:m",
    "scrapeOptions": {
      "formats": ["markdown", "metadata"]
    }
  }'
```

### Past Year
```bash
curl -X POST "https://workers-firecrawl.joshua-55c.workers.dev/v2/search" \
  -H "Authorization: Bearer 76b8950bba6df685bf1b288ad1d2848b8e634a64d785801cd1d2892648f851a6" \
  -H "Content-Type: application/json" \
  -d '{
    "query": "quantum computing breakthroughs",
    "sources": ["news"],
    "limit": 5,
    "tbs": "qdr:y",
    "scrapeOptions": {
      "formats": ["markdown", "metadata"]
    }
  }'
```

## Search with Region Filters

### By Country Code
```bash
curl -X POST "https://workers-firecrawl.joshua-55c.workers.dev/v2/search" \
  -H "Authorization: Bearer 76b8950bba6df685bf1b288ad1d2848b8e634a64d785801cd1d2892648f851a6" \
  -H "Content-Type: application/json" \
  -d '{
    "query": "local news",
    "sources": ["news"],
    "limit": 5,
    "country": "JP",
    "lang": "ja",
    "scrapeOptions": {
      "formats": ["markdown", "metadata"]
    }
  }'
```

### By Location Name
```bash
curl -X POST "https://workers-firecrawl.joshua-55c.workers.dev/v2/search" \
  -H "Authorization: Bearer 76b8950bba6df685bf1b288ad1d2848b8e634a64d785801cd1d2892648f851a6" \
  -H "Content-Type: application/json" \
  -d '{
    "query": "technology trends",
    "sources": ["news"],
    "limit": 5,
    "location": "United Kingdom",
    "lang": "en",
    "scrapeOptions": {
      "formats": ["markdown", "metadata"]
    }
  }'
```

### By Language Only
```bash
curl -X POST "https://workers-firecrawl.joshua-55c.workers.dev/v2/search" \
  -H "Authorization: Bearer 76b8950bba6df685bf1b288ad1d2848b8e634a64d785801cd1d2892648f851a6" \
  -H "Content-Type: application/json" \
  -d '{
    "query": "noticias de tecnología",
    "sources": ["news"],
    "limit": 5,
    "lang": "es",
    "scrapeOptions": {
      "formats": ["markdown", "metadata"]
    }
  }'
```

## Combined Time and Region Filters

```bash
curl -X POST "https://workers-firecrawl.joshua-55c.workers.dev/v2/search" \
  -H "Authorization: Bearer 76b8950bba6df685bf1b288ad1d2848b8e634a64d785801cd1d2892648f851a6" \
  -H "Content-Type: application/json" \
  -d '{
    "query": "latest technology news",
    "sources": ["news"],
    "limit": 5,
    "tbs": "qdr:w",
    "lang": "en",
    "country": "us",
    "location": "United States",
    "scrapeOptions": {
      "formats": ["markdown", "metadata"]
    }
  }'
```

## Image Search

```bash
curl -X POST "https://workers-firecrawl.joshua-55c.workers.dev/v2/search" \
  -H "Authorization: Bearer 76b8950bba6df685bf1b288ad1d2848b8e634a64d785801cd1d2892648f851a6" \
  -H "Content-Type: application/json" \
  -d '{
    "query": "cute cats",
    "sources": ["images"],
    "limit": 10
  }'
```

## News Search

```bash
curl -X POST "https://workers-firecrawl.joshua-55c.workers.dev/v2/search" \
  -H "Authorization: Bearer 76b8950bba6df685bf1b288ad1d2848b8e634a64d785801cd1d2892648f851a6" \
  -H "Content-Type: application/json" \
  -d '{
    "query": "breaking news",
    "sources": ["news"],
    "limit": 5,
    "tbs": "qdr:d",
    "lang": "en",
    "country": "us",
    "scrapeOptions": {
      "formats": ["markdown", "metadata"]
    }
  }'
```

## Multiple Source Search

```bash
curl -X POST "https://workers-firecrawl.joshua-55c.workers.dev/v2/search" \
  -H "Authorization: Bearer 76b8950bba6df685bf1b288ad1d2848b8e634a64d785801cd1d2892648f851a6" \
  -H "Content-Type: application/json" \
  -d '{
    "query": "artificial intelligence",
    "sources": ["web", "news", "images"],
    "limit": 3,
    "tbs": "qdr:m",
    "lang": "en",
    "country": "us",
    "scrapeOptions": {
      "formats": ["markdown", "metadata"]
    }
  }'
```

## URL Scraping

```bash
curl -X POST "https://workers-firecrawl.joshua-55c.workers.dev/v2/scrape" \
  -H "Authorization: Bearer 76b8950bba6df685bf1b288ad1d2848b8e634a64d785801cd1d2892648f851a6" \
  -H "Content-Type: application/json" \
  -d '{
    "url": "https://blog.cloudflare.com",
    "formats": ["markdown", "screenshot"],
    "onlyMainContent": true,
    "screenshot": {
      "fullPage": false,
      "quality": 90
    }
  }'
```

## Custom Date Range Search

```bash
curl -X POST "https://workers-firecrawl.joshua-55c.workers.dev/v2/search" \
  -H "Authorization: Bearer 76b8950bba6df685bf1b288ad1d2848b8e634a64d785801cd1d2892648f851a6" \
  -H "Content-Type: application/json" \
  -d '{
    "query": "machine learning breakthroughs",
    "sources": ["news"],
    "limit": 5,
    "tbs": "cdr:1,cd_min:01/01/2025,cd_max:01/31/2025",
    "lang": "en",
    "country": "us",
    "scrapeOptions": {
      "formats": ["markdown", "metadata"]
    }
  }'
```

## Region-Specific Search

```bash
curl -X POST "https://workers-firecrawl.joshua-55c.workers.dev/v2/search" \
  -H "Authorization: Bearer 76b8950bba6df685bf1b288ad1d2848b8e634a64d785801cd1d2892648f851a6" \
  -H "Content-Type: application/json" \
  -d '{
    "query": "local news",
    "sources": ["news"],
    "limit": 5,
    "tbs": "qdr:d",
    "lang": "ja",
    "country": "JP",
    "location": "Japan",
    "scrapeOptions": {
      "formats": ["markdown", "metadata"]
    }
  }'
```

## Search with Browser Actions

```bash
curl -X POST "https://workers-firecrawl.joshua-55c.workers.dev/v2/search" \
  -H "Authorization: Bearer 76b8950bba6df685bf1b288ad1d2848b8e634a64d785801cd1d2892648f851a6" \
  -H "Content-Type: application/json" \
  -d '{
    "query": "dynamic website content",
    "sources": ["web"],
    "limit": 3,
    "scrapeOptions": {
      "formats": ["markdown", "screenshot"],
      "actions": [
        {
          "type": "wait",
          "milliseconds": 2000
        },
        {
          "type": "click",
          "selector": "#accept-cookies"
        },
        {
          "type": "scroll"
        }
      ]
    }
  }'
```

## Advanced Scrape Options

```bash
curl -X POST "https://workers-firecrawl.joshua-55c.workers.dev/v2/search" \
  -H "Authorization: Bearer 76b8950bba6df685bf1b288ad1d2848b8e634a64d785801cd1d2892648f851a6" \
  -H "Content-Type: application/json" \
  -d '{
    "query": "Cloudflare Workers",
    "sources": ["web"],
    "limit": 3,
    "scrapeOptions": {
      "formats": ["markdown", "html", "links", "screenshot", "metadata"],
      "onlyMainContent": true,
      "includeTags": ["article", "main"],
      "excludeTags": ["aside", "footer"],
      "headers": {
        "User-Agent": "Custom Bot 1.0"
      },
      "waitFor": 2000,
      "timeout": 60000,
      "actions": [
        {
          "type": "wait",
          "milliseconds": 1000
        }
      ],
      "removeBase64Images": true,
      "blockAds": true
    }
  }'
```

## Parameter Reference

### Search Parameters

| Parameter | Type | Description | Example Values |
|-----------|------|-------------|----------------|
| `query` | string | Search query text | `"Cloudflare Workers"` |
| `limit` | number | Maximum number of results (1-100) | `5` |
| `sources` | array | Search sources to use | `["web", "news", "images"]` |
| `tbs` | string | Time-based search filter | `"qdr:d"`, `"qdr:w"`, `"qdr:m"`, `"qdr:y"`, `"cdr:1,cd_min:01/01/2025,cd_max:01/31/2025"` |
| `lang` | string | Language code (ISO 639-1) | `"en"`, `"es"`, `"ja"`, `"fr"` |
| `country` | string | Country code (ISO 3166-1) | `"us"`, `"jp"`, `"gb"`, `"fr"` |
| `location` | string | Location name | `"United States"`, `"Japan"`, `"United Kingdom"` |
| `timeout` | number | Request timeout in milliseconds | `60000` |
| `ignoreInvalidURLs` | boolean | Skip invalid URLs in results | `true` |

### Scrape Options Parameters

| Parameter | Type | Description | Example Values |
|-----------|------|-------------|----------------|
| `formats` | array | Output formats | `["markdown", "html", "rawHtml", "links", "screenshot", "metadata"]` |
| `onlyMainContent` | boolean | Extract only main content | `true` |
| `includeTags` | array | HTML tags to include | `["article", "main"]` |
| `excludeTags` | array | HTML tags to exclude | `["aside", "footer"]` |
| `headers` | object | Custom HTTP headers | `{"User-Agent": "Custom Bot"}` |
| `waitFor` | number | Time to wait before scraping (ms) | `2000` |
| `timeout` | number | Scrape timeout in milliseconds | `60000` |
| `actions` | array | Browser actions to perform | See Browser Actions below |
| `removeBase64Images` | boolean | Remove base64 images from output | `true` |
| `blockAds` | boolean | Block ads during scraping | `true` |

### Browser Actions

| Action | Parameters | Description | Examples |
|--------|------------|-------------|----------|
| `wait` | `milliseconds` | Wait for specified time | `{"type": "wait", "milliseconds": 2000}` |
| `click` | `selector` | Click on element | `{"type": "click", "selector": "#accept-cookies"}` |
| `type` | `selector`, `text` | Type text into input | `{"type": "type", "selector": "#search", "text": "query"}` |
| `scroll` | none | Scroll to bottom of page | `{"type": "scroll"}` |
| `executeJavaScript` | `javascript` | Execute custom JS | `{"type": "executeJavaScript", "javascript": "document.title = 'New Title'"}` |

### Time-Based Search (tbs) Values

| Value | Description |
|-------|-------------|
| `qdr:d` | Past day |
| `qdr:w` | Past week |
| `qdr:m` | Past month |
| `qdr:y` | Past year |
| `cdr:1,cd_min:MM/DD/YYYY,cd_max:MM/DD/YYYY` | Custom date range |

### Complete Region Mapping

The API supports virtually all countries and languages worldwide. Here are the key region mappings:

#### North America
| Location | Country | Region Code |
|----------|---------|-------------|
| United States | US | us-en |
| Canada | CA | ca-en |
| Mexico | MX | es-mx |

#### Europe
| Location | Country | Region Code |
|----------|---------|-------------|
| United Kingdom | GB | uk-en |
| Germany | DE | de-de |
| France | FR | fr-fr |
| Italy | IT | it-it |
| Spain | ES | es-es |
| Netherlands | NL | nl-nl |
| Belgium | BE | be-fr |
| Austria | AT | at-de |
| Switzerland | CH | ch-de |
| Sweden | SE | se-sv |
| Norway | NO | no-no |
| Denmark | DK | dk-da |
| Finland | FI | fi-fi |
| Poland | PL | pl-pl |
| Czech Republic | CZ | cz-cs |
| Hungary | HU | hu-hu |
| Romania | RO | ro-ro |
| Bulgaria | BG | bg-bg |
| Croatia | HR | hr-hr |
| Slovakia | SK | sk-sk |
| Slovenia | SI | sl-sl |
| Estonia | EE | ee-et |
| Latvia | LV | lv-lv |
| Lithuania | LT | lt-lt |
| Greece | GR | gr-el |
| Portugal | PT | pt-pt |
| Ireland | IE | ie-en |
| Iceland | IS | is-is |
| Luxembourg | LU | lu-fr |
| Malta | MT | mt-mt |
| Cyprus | CY | cy-cy |

#### Asia
| Location | Country | Region Code |
|----------|---------|-------------|
| Japan | JP | jp-jp |
| China | CN | cn-zh |
| India | IN | in-en |
| South Korea | KR | kr-kr |
| Hong Kong | HK | hk-tzh |
| Taiwan | TW | tw-tzh |
| Singapore | SG | sg-en |
| Thailand | TH | th-th |
| Malaysia | MY | my-ms |
| Indonesia | ID | id-id |
| Philippines | PH | ph-tl |
| Vietnam | VN | vn-vi |
| Pakistan | PK | pk-ur |
| Bangladesh | BD | bd-bn |
| Sri Lanka | LK | lk-si |
| Nepal | NP | np-ne |
| Myanmar | MM | mm-my |
| Cambodia | KH | kh-km |
| Laos | LA | la-lo |
| Mongolia | MN | mn-mn |
| Kazakhstan | KZ | kz-kk |
| Uzbekistan | UZ | uz-uz |
| Afghanistan | AF | af-ps |
| Iraq | IQ | iq-ar |
| Iran | IR | ir-fa |
| Israel | IL | il-he |
| Jordan | JO | jo-ar |
| Lebanon | LB | lb-ar |
| Syria | SY | sy-ar |
| Yemen | YE | ye-ar |
| Oman | OM | om-ar |
| Qatar | QA | qa-ar |
| Kuwait | KW | kw-ar |
| Bahrain | BH | bh-ar |
| Saudi Arabia | SA | sa-ar |
| UAE | AE | ae-ar |
| Turkey | TR | tr-tr |

#### South America
| Location | Country | Region Code |
|----------|---------|-------------|
| Brazil | BR | pt-br |
| Argentina | AR | ar-es |
| Chile | CL | cl-es |
| Colombia | CO | co-es |
| Peru | PE | pe-es |
| Venezuela | VE | ve-es |
| Ecuador | EC | ec-es |
| Bolivia | BO | bo-es |
| Paraguay | PY | py-es |
| Uruguay | UY | uy-es |
| Guyana | GY | gy-en |
| Suriname | SR | sr-nl |
| French Guiana | GF | gf-fr |

#### Central America & Caribbean
| Location | Country | Region Code |
|----------|---------|-------------|
| Guatemala | GT | gt-es |
| Costa Rica | CR | cr-es |
| Panama | PA | pa-es |
| Cuba | CU | cu-es |
| Haiti | HT | ht-fr |
| Dominican Republic | DO | do-es |
| Puerto Rico | PR | pr-es |
| Jamaica | JM | jm-en |
| Trinidad & Tobago | TT | tt-en |
| Barbados | BB | bb-en |
| Bahamas | BS | bs-en |
| Belize | BZ | bz-en |
| El Salvador | SV | sv-es |
| Honduras | HN | hn-es |
| Nicaragua | NI | ni-es |

#### Africa
| Location | Country | Region Code |
|----------|---------|-------------|
| South Africa | ZA | za-en |
| Egypt | EG | eg-ar |
| Nigeria | NG | ng-en |
| Kenya | KE | ke-en |
| Morocco | MA | ma-fr |
| Tunisia | TN | tn-fr |
| Algeria | DZ | dz-fr |
| Libya | LY | ly-ar |
| Sudan | SD | sd-ar |
| Ethiopia | ET | et-am |
| Ghana | GH | gh-en |
| Tanzania | TZ | sw-sw |
| Uganda | UG | ug-en |
| Zimbabwe | ZW | zw-en |
| Zambia | ZM | zm-en |
| Botswana | BW | bw-en |
| Namibia | NA | na-en |
| Mozambique | MZ | mz-pt |
| Angola | AO | ao-pt |
| Cameroon | CM | cm-fr |
| Senegal | SN | sn-fr |
| Ivory Coast | CI | ci-fr |
| Mali | ML | ml-fr |
| Burkina Faso | BF | bf-fr |
| Niger | NE | ne-fr |
| Chad | TD | td-fr |
| Central African Republic | CF | cf-fr |
| Congo | CG | cg-fr |
| Democratic Republic of Congo | CD | cd-fr |
| Rwanda | RW | rw-en |
| Burundi | BI | bi-fr |
| Eritrea | ER | er-ti |
| Djibouti | DJ | dj-so |
| Somalia | SO | so-so |
| Gambia | GM | gm-en |
| Guinea | GN | gn-fr |
| Guinea-Bissau | GW | gw-pt |
| Sierra Leone | SL | sl-en |
| Liberia | LR | lr-en |
| Togo | TG | tg-fr |
| Benin | BJ | bj-fr |
| Equatorial Guinea | GQ | gq-es |
| São Tomé & Príncipe | ST | st-pt |
| Cape Verde | CV | cv-pt |
| Seychelles | SC | sc-en |
| Mauritius | MU | mu-en |
| Comoros | KM | km-ar |
| Madagascar | MG | mg-fr |
| Mauritania | MR | mr-ar |
| Western Sahara | EH | eh-es |

#### Oceania
| Location | Country | Region Code |
|----------|---------|-------------|
| Australia | AU | au-en |
| New Zealand | NZ | nz-en |
| Fiji | FJ | fj-en |
| Papua New Guinea | PG | pg-en |
| Solomon Islands | SB | sb-en |
| Vanuatu | VU | vu-en |
| Samoa | WS | ws-sm |
| Kiribati | KI | ki-en |
| Tonga | TO | to-en |
| Tuvalu | TV | tv-en |
| Nauru | NR | nr-en |
| Palau | PW | pw-en |
| Marshall Islands | MH | mh-en |
| Micronesia | FM | fm-en |
| Cook Islands | CK | ck-en |
| Niue | NU | nu-en |
| Tokelau | TK | tk-en |
| American Samoa | AS | as-en |
| Guam | GU | gu-en |
| Northern Mariana Islands | MP | mp-en |
| French Polynesia | PF | pf-fr |
| New Caledonia | NC | nc-fr |
| Wallis & Futuna | WF | wf-fr |
| Pitcairn Islands | PN | pn-en |
| Easter Island | CL | cl-es |
| Christmas Island | CX | cx-en |
| Cocos Islands | CC | cc-en |
| Norfolk Island | NF | nf-en |

#### Russia & CIS
| Location | Country | Region Code |
|----------|---------|-------------|
| Russia | RU | ru-ru |
| Ukraine | UA | uk-uk |
| Belarus | BY | by-be |
| Moldova | MD | md-ro |
| Armenia | AM | am-hy |
| Azerbaijan | AZ | az-az |
| Georgia | GE | ge-ka |
| Tajikistan | TJ | tg-tg |
| Kyrgyzstan | KG | ky-ky |
| Turkmenistan | TM | tm-tm |

#### Language Codes
| Language | Region Code |
|----------|-------------|
| English | us-en |
| Japanese | jp-jp |
| German | de-de |
| French | fr-fr |
| Chinese | cn-zh |
| Spanish | es-es |
| Italian | it-it |
| Dutch | nl-nl |
| Russian | ru-ru |
| Portuguese | pt-br |
| Korean | kr-kr |
| Arabic | sa-ar |
| Hindi | in-hi |
| Thai | th-th |
| Vietnamese | vn-vi |
| Turkish | tr-tr |
| Polish | pl-pl |
| Swedish | se-sv |
| Danish | dk-da |
| Norwegian | no-no |
| Finnish | fi-fi |
| Greek | gr-el |
| Hebrew | il-he |
| Czech | cz-cs |
| Hungarian | hu-hu |
| Romanian | ro-ro |
| Bulgarian | bg-bg |
| Croatian | hr-hr |
| Slovak | sk-sk |
| Slovenian | sl-sl |
| Estonian | ee-et |
| Latvian | lv-lv |
| Lithuanian | lt-lt |
| Maltese | mt-mt |
| Icelandic | is-is |
| Irish | ie-en |
| Welsh | cy-cy |
| Traditional Chinese | hk-tzh |
| Malay | my-ms |
| Indonesian | id-id |
| Filipino | ph-tl |
| Urdu | pk-ur |
| Bengali | bd-bn |
| Sinhala | lk-si |
| Tamil | lk-ta |
| Nepali | np-ne |
| Burmese | mm-my |
| Khmer | kh-km |
| Lao | la-lo |
| Mongolian | mn-mn |
| Kazakh | kz-kk |
| Uzbek | uz-uz |
| Pashto | af-ps |
| Persian | ir-fa |
| Kurdish | iq-ar |
| Armenian | am-hy |
| Georgian | ge-ka |
| Tajik | tg-tg |
| Kyrgyz | ky-ky |
| Turkmen | tm-tm |
| Afrikaans | za-af |
| Zulu | za-zu |
| Xhosa | za-xh |
| Swahili | sw-sw |
| Amharic | et-am |
| Hausa | ng-ha |
| Yoruba | ng-yo |
| Igbo | ng-ig |
| Kinyarwanda | rw-rw |
| Tigrinya | er-ti |
| Somali | so-so |
| Wolof | sn-fr |
| Malagasy | mg-mg |
| Maori | nz-mi |
| Fijian | fj-fj |
| Tok Pisin | pg-tpi |
| Bislama | vu-bi |
| Gilbertese | ki-gil |
| Tongan | to-to |
| Tuvaluan | tv-tvl |
| Nauruan | nr-na |
| Palauan | pw-pau |
| Marshallese | mh-mh |
| Chuukese | fm-chk |
| Rarotongan | ck-rar |
| Niuean | nu-niu |
| Tokelauan | tk-tkl |
| Samoan | ws-sm |
| Chamorro | gu-ch |
| Carolinian | mp-ch |
| Tahitian | pf-ty |
| Wallisian | wf-wls |

### Examples with Different Regions

#### German Search
```bash
curl -X POST "https://workers-firecrawl.joshua-55c.workers.dev/v2/search" \
  -H "Authorization: Bearer 76b8950bba6df685bf1b288ad1d2848b8e634a64d785801cd1d2892648f851a6" \
  -H "Content-Type: application/json" \
  -d '{
    "query": "Technologie Nachrichten",
    "sources": ["news"],
    "limit": 5,
    "lang": "de",
    "country": "DE",
    "scrapeOptions": {
      "formats": ["markdown", "metadata"]
    }
  }'
```

#### French Search
```bash
curl -X POST "https://workers-firecrawl.joshua-55c.workers.dev/v2/search" \
  -H "Authorization: Bearer 76b8950bba6df685bf1b288ad1d2848b8e634a64d785801cd1d2892648f851a6" \
  -H "Content-Type: application/json" \
  -d '{
    "query": "actualités technologiques",
    "sources": ["news"],
    "limit": 5,
    "lang": "fr",
    "country": "FR",
    "scrapeOptions": {
      "formats": ["markdown", "metadata"]
    }
  }'
```

#### Chinese Search
```bash
curl -X POST "https://workers-firecrawl.joshua-55c.workers.dev/v2/search" \
  -H "Authorization: Bearer 76b8950bba6df685bf1b288ad1d2848b8e634a64d785801cd1d2892648f851a6" \
  -H "Content-Type: application/json" \
  -d '{
    "query": "技术新闻",
    "sources": ["news"],
    "limit": 5,
    "lang": "zh",
    "country": "CN",
    "scrapeOptions": {
      "formats": ["markdown", "metadata"]
    }
  }'
```

#### Korean Search
```bash
curl -X POST "https://workers-firecrawl.joshua-55c.workers.dev/v2/search" \
  -H "Authorization: Bearer 76b8950bba6df685bf1b288ad1d2848b8e634a64d785801cd1d2892648f851a6" \
  -H "Content-Type: application/json" \
  -d '{
    "query": "기술 뉴스",
    "sources": ["news"],
    "limit": 5,
    "lang": "ko",
    "country": "KR",
    "scrapeOptions": {
      "formats": ["markdown", "metadata"]
    }
  }'
```

#### Arabic Search
```bash
curl -X POST "https://workers-firecrawl.joshua-55c.workers.dev/v2/search" \
  -H "Authorization: Bearer 76b8950bba6df685bf1b288ad1d2848b8e634a64d785801cd1d2892648f851a6" \
  -H "Content-Type: application/json" \
  -d '{
    "query": "أخبار التكنولوجيا",
    "sources": ["news"],
    "limit": 5,
    "lang": "ar",
    "country": "SA",
    "scrapeOptions": {
      "formats": ["markdown", "metadata"]
    }
  }'
```

#### Russian Search
```bash
curl -X POST "https://workers-firecrawl.joshua-55c.workers.dev/v2/search" \
  -H "Authorization: Bearer 76b8950bba6df685bf1b288ad1d2848b8e634a64d785801cd1d2892648f851a6" \
  -H "Content-Type: application/json" \
  -d '{
    "query": "технологические новости",
    "sources": ["news"],
    "limit": 5,
    "lang": "ru",
    "country": "RU",
    "scrapeOptions": {
      "formats": ["markdown", "metadata"]
    }
  }'
```

#### Indian Search (Hindi)
```bash
curl -X POST "https://workers-firecrawl.joshua-55c.workers.dev/v2/search" \
  -H "Authorization: Bearer 76b8950bba6df685bf1b288ad1d2848b8e634a64d785801cd1d2892648f851a6" \
  -H "Content-Type: application/json" \
  -d '{
    "query": "तकनीकी समाचार",
    "sources": ["news"],
    "limit": 5,
    "lang": "hi",
    "country": "IN",
    "scrapeOptions": {
      "formats": ["markdown", "metadata"]
    }
  }'
```

#### Brazilian Search (Portuguese)
```bash
curl -X POST "https://workers-firecrawl.joshua-55c.workers.dev/v2/search" \
  -H "Authorization: Bearer 76b8950bba6df685bf1b288ad1d2848b8e634a64d785801cd1d2892648f851a6" \
  -H "Content-Type: application/json" \
  -d '{
    "query": "notícias de tecnologia",
    "sources": ["news"],
    "limit": 5,
    "lang": "pt",
    "country": "BR",
    "scrapeOptions": {
      "formats": ["markdown", "metadata"]
    }
  }'
```

#### African Search (Nigeria)
```bash
curl -X POST "https://workers-firecrawl.joshua-55c.workers.dev/v2/search" \
  -H "Authorization: Bearer 76b8950bba6df685bf1b288ad1d2848b8e634a64d785801cd1d2892648f851a6" \
  -H "Content-Type: application/json" \
  -d '{
    "query": "technology news",
    "sources": ["news"],
    "limit": 5,
    "lang": "en",
    "country": "NG",
    "scrapeOptions": {
      "formats": ["markdown", "metadata"]
    }
  }'