/**
 * Compact Firecrawl v2 search-parameter mapping.
 * Replaces the legacy ~976-line if/else tables with plain data maps.
 */

// ---------------------------------------------------------------------------
// mapTbs — parse Firecrawl-style `tbs` into DDG `df` + timeRange
// ---------------------------------------------------------------------------

export interface TbsMapping {
	df?: string;
	timeRange?: "day" | "week" | "month" | "year";
	warnings: string[];
}

const QDR_MAP: Record<
	string,
	{ df: string; timeRange: TbsMapping["timeRange"] }
> = {
	"qdr:d": { df: "d", timeRange: "day" },
	"qdr:w": { df: "w", timeRange: "week" },
	"qdr:m": { df: "m", timeRange: "month" },
	"qdr:y": { df: "y", timeRange: "year" },
};

const BARE_MAP: Record<
	string,
	{ df: string; timeRange: TbsMapping["timeRange"] }
> = {
	d: { df: "d", timeRange: "day" },
	day: { df: "d", timeRange: "day" },
	w: { df: "w", timeRange: "week" },
	week: { df: "w", timeRange: "week" },
	m: { df: "m", timeRange: "month" },
	month: { df: "m", timeRange: "month" },
	y: { df: "y", timeRange: "year" },
	year: { df: "y", timeRange: "year" },
};

function daysBetween(a: string, b: string): number {
	const start = new Date(a).getTime();
	const end = new Date(b).getTime();
	return Math.abs(end - start) / (1000 * 60 * 60 * 24);
}

function timeRangeForSpan(days: number): TbsMapping["timeRange"] {
	if (days < 2) return "day";
	if (days <= 14) return "week";
	if (days < 60) return "month";
	return "year";
}

export function mapTbs(tbs: string | undefined): TbsMapping {
	const warnings: string[] = [];
	if (!tbs) return { warnings };

	// Custom date range: cdr:1,cd_min:MM/DD/YYYY,cd_max:MM/DD/YYYY
	if (tbs.includes("cdr:")) {
		const minMatch = tbs.match(/cd_min:(\d{2})\/(\d{2})\/(\d{4})/);
		const maxMatch = tbs.match(/cd_max:(\d{2})\/(\d{2})\/(\d{4})/);
		if (minMatch && maxMatch) {
			const df = `${minMatch[3]}-${minMatch[1]}-${minMatch[2]}..${maxMatch[3]}-${maxMatch[1]}-${maxMatch[2]}`;
			const span = daysBetween(
				`${minMatch[3]}-${minMatch[1]}-${minMatch[2]}`,
				`${maxMatch[3]}-${maxMatch[1]}-${maxMatch[2]}`,
			);
			warnings.push("custom date range approximated for time_range");
			return { df, timeRange: timeRangeForSpan(span), warnings };
		}
		warnings.push(`tbs "${tbs}" not recognized`);
		return { warnings };
	}

	// Unsupported hour granularity
	if (tbs.includes("qdr:h")) {
		warnings.push("qdr:h unsupported, using day");
		return { df: "d", timeRange: "day", warnings };
	}

	// Standard qdr
	for (const [token, mapped] of Object.entries(QDR_MAP)) {
		if (tbs.includes(token)) {
			return { ...mapped, warnings };
		}
	}

	// Bare pass-through
	if (BARE_MAP[tbs.toLowerCase()]) {
		return { ...BARE_MAP[tbs.toLowerCase()], warnings };
	}

	// Sort-by-date
	if (tbs.includes("sbd:1")) {
		warnings.push("sbd:1 sort-by-date unsupported");
		return { warnings };
	}

	warnings.push(`tbs "${tbs}" not recognized`);
	return { warnings };
}

// ---------------------------------------------------------------------------
// klFrom — DuckDuckGo `kl` region code resolution
// ---------------------------------------------------------------------------

const LOCATION_MAP: Record<string, string> = {
	// North America
	"united states": "us-en",
	america: "us-en",
	canada: "ca-en",
	mexico: "mx-es",

	// Europe
	"united kingdom": "uk-en",
	uk: "uk-en",
	britain: "uk-en",
	germany: "de-de",
	france: "fr-fr",
	italy: "it-it",
	spain: "es-es",
	netherlands: "nl-nl",
	belgium: "be-fr",
	austria: "at-de",
	switzerland: "ch-de",
	sweden: "se-sv",
	norway: "no-no",
	denmark: "dk-da",
	finland: "fi-fi",
	poland: "pl-pl",
	czech: "cz-cs",
	hungary: "hu-hu",
	romania: "ro-ro",
	bulgaria: "bg-bg",
	croatia: "hr-hr",
	slovakia: "sk-sk",
	slovenia: "sl-sl",
	estonia: "ee-et",
	latvia: "lv-lv",
	lithuania: "lt-lt",
	greece: "gr-el",
	portugal: "pt-pt",
	ireland: "ie-en",
	iceland: "is-is",
	luxembourg: "lu-fr",
	malta: "mt-mt",
	cyprus: "cy-cy",

	// Asia
	japan: "jp-jp",
	china: "cn-zh",
	prc: "cn-zh",
	india: "in-en",
	"south korea": "kr-kr",
	korea: "kr-kr",
	"hong kong": "hk-tzh",
	taiwan: "tw-tzh",
	singapore: "sg-en",
	thailand: "th-th",
	malaysia: "my-ms",
	indonesia: "id-id",
	philippines: "ph-tl",
	vietnam: "vn-vi",
	pakistan: "pk-ur",
	bangladesh: "bd-bn",
	"sri lanka": "lk-si",
	nepal: "np-ne",
	myanmar: "mm-my",
	cambodia: "kh-km",
	laos: "la-lo",
	mongolia: "mn-mn",
	kazakhstan: "kz-kk",
	uzbekistan: "uz-uz",
	afghanistan: "af-ps",
	iraq: "iq-ar",
	iran: "ir-fa",
	israel: "il-he",
	jordan: "jo-ar",
	lebanon: "lb-ar",
	syria: "sy-ar",
	yemen: "ye-ar",
	oman: "om-ar",
	qatar: "qa-ar",
	kuwait: "kw-ar",
	bahrain: "bh-ar",
	"saudi arabia": "sa-ar",
	uae: "ae-ar",
	"united arab emirates": "ae-ar",
	turkey: "tr-tr",

	// South America
	brazil: "br-pt",
	argentina: "ar-es",
	chile: "cl-es",
	colombia: "co-es",
	peru: "pe-es",
	venezuela: "ve-es",
	ecuador: "ec-es",
	bolivia: "bo-es",
	paraguay: "py-es",
	uruguay: "uy-es",
	guyana: "gy-en",
	suriname: "sr-nl",
	"french guiana": "gf-fr",

	// Central America & Caribbean
	guatemala: "gt-es",
	"costa rica": "cr-es",
	panama: "pa-es",
	cuba: "cu-es",
	haiti: "ht-fr",
	"dominican republic": "do-es",
	"puerto rico": "pr-es",
	jamaica: "jm-en",
	trinidad: "tt-en",
	tobago: "tt-en",
	barbados: "bb-en",
	bahamas: "bs-en",
	belize: "bz-en",
	"el salvador": "sv-es",
	honduras: "hn-es",
	nicaragua: "ni-es",

	// Africa
	"south africa": "za-en",
	egypt: "eg-ar",
	nigeria: "ng-en",
	kenya: "ke-en",
	morocco: "ma-fr",
	tunisia: "tn-fr",
	algeria: "dz-fr",
	libya: "ly-ar",
	sudan: "sd-ar",
	ethiopia: "et-am",
	ghana: "gh-en",
	tanzania: "sw-sw",
	uganda: "ug-en",
	zimbabwe: "zw-en",
	zambia: "zm-en",
	botswana: "bw-en",
	namibia: "na-en",
	mozambique: "mz-pt",
	angola: "ao-pt",
	cameroon: "cm-fr",
	sengal: "sn-fr",
	"ivory coast": "ci-fr",
	"côte d'ivoire": "ci-fr",
	mali: "ml-fr",
	"burkina faso": "bf-fr",
	niger: "ne-fr",
	chad: "td-fr",
	"central african republic": "cf-fr",
	congo: "cg-fr",
	"democratic republic of congo": "cd-fr",
	drc: "cd-fr",
	rwanda: "rw-en",
	burundi: "bi-fr",
	eritrea: "er-ti",
	djibouti: "dj-so",
	somalia: "so-so",
	gambia: "gm-en",
	guinea: "gn-fr",
	"guinea-bissau": "gw-pt",
	"sierra leone": "sl-en",
	liberia: "lr-en",
	togo: "tg-fr",
	benin: "bj-fr",
	"equatorial guinea": "gq-es",
	"são tomé": "st-pt",
	príncipe: "st-pt",
	"cape verde": "cv-pt",
	seychelles: "sc-en",
	mauritius: "mu-en",
	comoros: "km-ar",
	madagascar: "mg-fr",
	mauritania: "mr-ar",
	"western sahara": "eh-es",

	// Oceania
	australia: "au-en",
	"new zealand": "nz-en",
	fiji: "fj-en",
	"papua new guinea": "pg-en",
	"solomon islands": "sb-en",
	vanuatu: "vu-en",
	samoa: "ws-sm",
	kiribati: "ki-en",
	tonga: "to-en",
	tuvalu: "tv-en",
	nauru: "nr-en",
	palau: "pw-en",
	"marshall islands": "mh-en",
	micronesia: "fm-en",
	"cook islands": "ck-en",
	niue: "nu-en",
	tokelau: "tk-en",
	"american samoa": "as-en",
	guam: "gu-en",
	"northern mariana islands": "mp-en",
	"french polynesia": "pf-fr",
	tahiti: "pf-fr",
	"new caledonia": "nc-fr",
	wallis: "wf-fr",
	futuna: "wf-fr",
	"pitcairn islands": "pn-en",
	"easter island": "cl-es",
	"christmas island": "cx-en",
	"cocos islands": "cc-en",
	"norfolk island": "nf-en",

	// Russia & CIS
	russia: "ru-ru",
	ukraine: "uk-uk",
	belarus: "by-be",
	moldova: "md-ro",
	armenia: "am-hy",
	azerbaijan: "az-az",
	georgia: "ge-ka",
	tajikistan: "tg-tg",
	kyrgyzstan: "ky-ky",
	turkmenistan: "tm-tm",
};

const COUNTRY_LANG_MAP: Record<string, string> = {
	// North America
	"us:en": "us-en",
	"ca:en": "ca-en",
	"ca:fr": "ca-fr",
	"mx:es": "mx-es",

	// Europe
	"gb:en": "uk-en",
	"de:de": "de-de",
	"fr:fr": "fr-fr",
	"it:it": "it-it",
	"es:es": "es-es",
	"nl:nl": "nl-nl",
	"be:fr": "be-fr",
	"be:nl": "be-nl",
	"at:de": "at-de",
	"ch:de": "ch-de",
	"ch:fr": "ch-fr",
	"ch:it": "ch-it",
	"se:sv": "se-sv",
	"no:no": "no-no",
	"dk:da": "dk-da",
	"fi:fi": "fi-fi",
	"pl:pl": "pl-pl",
	"cz:cs": "cz-cs",
	"hu:hu": "hu-hu",
	"ro:ro": "ro-ro",
	"bg:bg": "bg-bg",
	"hr:hr": "hr-hr",
	"sk:sk": "sk-sk",
	"si:sl": "sl-sl",
	"ee:et": "ee-et",
	"lv:lv": "lv-lv",
	"lt:lt": "lt-lt",
	"gr:el": "gr-el",
	"pt:pt": "pt-pt",
	"ie:en": "ie-en",
	"is:is": "is-is",
	"lu:fr": "lu-fr",
	"lu:de": "lu-de",
	"lu:lb": "lu-lb",
	"mt:mt": "mt-mt",
	"cy:el": "cy-el",
	"cy:tr": "cy-tr",

	// Asia
	"jp:ja": "jp-jp",
	"cn:zh": "cn-zh",
	"in:en": "in-en",
	"in:hi": "in-hi",
	"kr:ko": "kr-kr",
	"hk:tzh": "hk-tzh",
	"hk:en": "hk-en",
	"tw:tzh": "tw-tzh",
	"sg:en": "sg-en",
	"sg:zh": "sg-zh",
	"sg:ms": "sg-ms",
	"sg:ta": "sg-ta",
	"th:th": "th-th",
	"my:ms": "my-ms",
	"my:en": "my-en",
	"id:id": "id-id",
	"id:en": "id-en",
	"ph:tl": "ph-tl",
	"ph:en": "ph-en",
	"vn:vi": "vn-vi",
	"vn:en": "vn-en",
	"pk:ur": "pk-ur",
	"pk:en": "pk-en",
	"bd:bn": "bd-bn",
	"bd:en": "bd-en",
	"lk:si": "lk-si",
	"lk:ta": "lk-ta",
	"lk:en": "lk-en",
	"np:ne": "np-ne",
	"np:en": "np-en",
	"mm:my": "mm-my",
	"kh:km": "kh-km",
	"la:lo": "la-lo",
	"mn:mn": "mn-mn",
	"kz:kk": "kz-kk",
	"kz:ru": "kz-ru",
	"uz:uz": "uz-uz",
	"uz:ru": "uz-ru",
	"af:ps": "af-ps",
	"af:da": "af-da",
	"iq:ar": "iq-ar",
	"ir:fa": "ir-fa",
	"il:he": "il-he",
	"il:ar": "il-ar",
	"il:en": "il-en",
	"jo:ar": "jo-ar",
	"jo:en": "jo-en",
	"lb:ar": "lb-ar",
	"lb:fr": "lb-fr",
	"lb:en": "lb-en",
	"sy:ar": "sy-ar",
	"ye:ar": "ye-ar",
	"om:ar": "om-ar",
	"om:en": "om-en",
	"qa:ar": "qa-ar",
	"qa:en": "qa-en",
	"kw:ar": "kw-ar",
	"kw:en": "kw-en",
	"bh:ar": "bh-ar",
	"bh:en": "bh-en",
	"sa:ar": "sa-ar",
	"sa:en": "sa-en",
	"ae:ar": "ae-ar",
	"ae:en": "ae-en",
	"tr:tr": "tr-tr",
	"tr:en": "tr-en",

	// South America
	"br:pt": "br-pt",
	"br:en": "br-en",
	"br:es": "br-es",
	"ar:es": "ar-es",
	"ar:en": "ar-en",
	"cl:es": "cl-es",
	"cl:en": "cl-en",
	"co:es": "co-es",
	"co:en": "co-en",
	"pe:es": "pe-es",
	"pe:en": "pe-en",
	"ve:es": "ve-es",
	"ve:en": "ve-en",
	"ec:es": "ec-es",
	"ec:en": "ec-en",
	"bo:es": "bo-es",
	"bo:en": "bo-en",
	"py:es": "py-es",
	"py:en": "py-en",
	"uy:es": "uy-es",
	"uy:en": "uy-en",
	"gy:en": "gy-en",
	"sr:nl": "sr-nl",
	"sr:en": "sr-en",
	"gf:fr": "gf-fr",

	// Central America & Caribbean
	"gt:es": "gt-es",
	"gt:en": "gt-en",
	"cr:es": "cr-es",
	"cr:en": "cr-en",
	"pa:es": "pa-es",
	"pa:en": "pa-en",
	"cu:es": "cu-es",
	"ht:fr": "ht-fr",
	"ht:en": "ht-en",
	"do:es": "do-es",
	"do:en": "do-en",
	"pr:es": "pr-es",
	"pr:en": "pr-en",
	"jm:en": "jm-en",
	"tt:en": "tt-en",
	"bb:en": "bb-en",
	"bs:en": "bs-en",
	"bz:en": "bz-en",
	"sv:es": "sv-es",
	"sv:en": "sv-en",
	"hn:es": "hn-es",
	"hn:en": "hn-en",
	"ni:es": "ni-es",
	"ni:en": "ni-en",

	// Africa
	"za:en": "za-en",
	"za:af": "za-af",
	"za:zu": "za-zu",
	"za:xh": "za-xh",
	"eg:ar": "eg-ar",
	"eg:en": "eg-en",
	"ng:en": "ng-en",
	"ng:ha": "ng-ha",
	"ng:yo": "ng-yo",
	"ng:ig": "ng-ig",
	"ke:en": "ke-en",
	"ke:sw": "ke-sw",
	"ma:fr": "ma-fr",
	"ma:ar": "ma-ar",
	"tn:fr": "tn-fr",
	"tn:ar": "tn-ar",
	"dz:fr": "dz-fr",
	"dz:ar": "dz-ar",
	"ly:ar": "ly-ar",
	"ly:en": "ly-en",
	"sd:ar": "sd-ar",
	"sd:en": "sd-en",
	"et:am": "et-am",
	"et:en": "et-en",
	"gh:en": "gh-en",
	"tz:sw": "sw-sw",
	"tz:en": "tz-en",
	"ug:en": "ug-en",
	"zw:en": "zw-en",
	"zm:en": "zm-en",
	"bw:en": "bw-en",
	"bw:tn": "bw-tn",
	"na:en": "na-en",
	"mz:pt": "mz-pt",
	"ao:pt": "ao-pt",
	"cm:fr": "cm-fr",
	"cm:en": "cm-en",
	"sn:fr": "sn-fr",
	"ci:fr": "ci-fr",
	"ml:fr": "ml-fr",
	"bf:fr": "bf-fr",
	"ne:fr": "ne-fr",
	"td:fr": "td-fr",
	"cf:fr": "cf-fr",
	"cg:fr": "cg-fr",
	"cd:fr": "cd-fr",
	"rw:en": "rw-en",
	"rw:fr": "rw-fr",
	"rw:rw": "rw-rw",
	"bi:fr": "bi-fr",
	"bi:rw": "bi-rw",
	"er:ti": "er-ti",
	"er:en": "er-en",
	"dj:so": "dj-so",
	"dj:fr": "dj-fr",
	"dj:ar": "dj-ar",
	"so:so": "so-so",
	"so:ar": "so-ar",
	"so:en": "so-en",
	"gm:en": "gm-en",
	"gn:fr": "gn-fr",
	"gw:pt": "gw-pt",
	"sl:en": "sl-en",
	"lr:en": "lr-en",
	"tg:fr": "tg-fr",
	"bj:fr": "bj-fr",
	"gq:es": "gq-es",
	"gq:fr": "gq-fr",
	"gq:pt": "gq-pt",
	"st:pt": "st-pt",
	"cv:pt": "cv-pt",
	"sc:en": "sc-en",
	"sc:fr": "sc-fr",
	"mu:en": "mu-en",
	"mu:fr": "mu-fr",
	"km:ar": "km-ar",
	"km:fr": "km-fr",
	"mg:fr": "mg-fr",
	"mg:mg": "mg-mg",
	"mr:ar": "mr-ar",
	"eh:es": "eh-es",
	"eh:ar": "eh-ar",

	// Oceania
	"au:en": "au-en",
	"nz:en": "nz-en",
	"nz:mi": "nz-mi",
	"fj:en": "fj-en",
	"fj:fj": "fj-fj",
	"pg:en": "pg-en",
	"pg:tpi": "pg-tpi",
	"sb:en": "sb-en",
	"vu:en": "vu-en",
	"vu:bi": "vu-bi",
	"ws:sm": "ws-sm",
	"ws:en": "ws-en",
	"ki:en": "ki-en",
	"ki:gil": "ki-gil",
	"to:en": "to-en",
	"to:to": "to-to",
	"tv:en": "tv-en",
	"tv:tvl": "tv-tvl",
	"nr:en": "nr-en",
	"nr:na": "nr-na",
	"pw:en": "pw-en",
	"pw:pau": "pw-pau",
	"mh:en": "mh-en",
	"mh:mh": "mh-mh",
	"fm:en": "fm-en",
	"fm:chk": "fm-chk",
	"ck:en": "ck-en",
	"ck:rar": "ck-rar",
	"nu:en": "nu-en",
	"nu:niu": "nu-niu",
	"tk:en": "tk-en",
	"tk:tkl": "tk-tkl",
	"as:en": "as-en",
	"as:sm": "as-sm",
	"gu:en": "gu-en",
	"gu:ch": "gu-ch",
	"mp:en": "mp-en",
	"mp:ch": "mp-ch",
	"pf:fr": "pf-fr",
	"pf:ty": "pf-ty",
	"nc:fr": "nc-fr",
	"wf:fr": "wf-fr",
	"wf:wls": "wf-wls",
	"pn:en": "pn-en",
	"cx:en": "cx-en",
	"cc:en": "cc-en",
	"nf:en": "nf-en",

	// Russia & CIS
	"ru:ru": "ru-ru",
	"ru:en": "ru-en",
	"ua:uk": "uk-uk",
	"ua:ru": "ua-ru",
	"by:be": "by-be",
	"by:ru": "by-ru",
	"md:ro": "md-ro",
	"md:ru": "md-ru",
	"am:hy": "am-hy",
	"am:ru": "am-ru",
	"az:az": "az-az",
	"az:ru": "az-ru",
	"ge:ka": "ge-ka",
	"ge:ru": "ge-ru",
	"tj:tg": "tg-tg",
	"tj:ru": "tg-ru",
	"kg:ky": "ky-ky",
	"kg:ru": "ky-ru",
	"tm:tm": "tm-tm",
	"tm:ru": "tm-ru",
};

const COUNTRY_MAP: Record<string, string> = {
	// North America
	US: "us-en",
	CA: "ca-en",
	MX: "mx-es",

	// Europe
	GB: "uk-en",
	DE: "de-de",
	FR: "fr-fr",
	IT: "it-it",
	ES: "es-es",
	NL: "nl-nl",
	BE: "be-fr",
	AT: "at-de",
	CH: "ch-de",
	SE: "se-sv",
	NO: "no-no",
	DK: "dk-da",
	FI: "fi-fi",
	PL: "pl-pl",
	CZ: "cz-cs",
	HU: "hu-hu",
	RO: "ro-ro",
	BG: "bg-bg",
	HR: "hr-hr",
	SK: "sk-sk",
	SI: "sl-sl",
	EE: "ee-et",
	LV: "lv-lv",
	LT: "lt-lt",
	GR: "gr-el",
	PT: "pt-pt",
	IE: "ie-en",
	IS: "is-is",
	LU: "lu-fr",
	MT: "mt-mt",
	CY: "cy-cy",

	// Asia
	JP: "jp-jp",
	CN: "cn-zh",
	IN: "in-en",
	KR: "kr-kr",
	HK: "hk-tzh",
	TW: "tw-tzh",
	SG: "sg-en",
	TH: "th-th",
	MY: "my-ms",
	ID: "id-id",
	PH: "ph-tl",
	VN: "vn-vi",
	PK: "pk-ur",
	BD: "bd-bn",
	LK: "lk-si",
	NP: "np-ne",
	MM: "mm-my",
	KH: "kh-km",
	LA: "la-lo",
	MN: "mn-mn",
	KZ: "kz-kk",
	UZ: "uz-uz",
	AF: "af-ps",
	IQ: "iq-ar",
	IR: "ir-fa",
	IL: "il-he",
	JO: "jo-ar",
	LB: "lb-ar",
	SY: "sy-ar",
	YE: "ye-ar",
	OM: "om-ar",
	QA: "qa-ar",
	KW: "kw-ar",
	BH: "bh-ar",
	SA: "sa-ar",
	AE: "ae-ar",
	TR: "tr-tr",

	// South America
	BR: "br-pt",
	AR: "ar-es",
	CL: "cl-es",
	CO: "co-es",
	PE: "pe-es",
	VE: "ve-es",
	EC: "ec-es",
	BO: "bo-es",
	PY: "py-es",
	UY: "uy-es",
	GY: "gy-en",
	SR: "sr-nl",
	GF: "gf-fr",

	// Central America & Caribbean
	GT: "gt-es",
	CR: "cr-es",
	PA: "pa-es",
	CU: "cu-es",
	HT: "ht-fr",
	DO: "do-es",
	PR: "pr-es",
	JM: "jm-en",
	TT: "tt-en",
	BB: "bb-en",
	BS: "bs-en",
	BZ: "bz-en",
	SV: "sv-es",
	HN: "hn-es",
	NI: "ni-es",

	// Africa
	ZA: "za-en",
	EG: "eg-ar",
	NG: "ng-en",
	KE: "ke-en",
	MA: "ma-fr",
	TN: "tn-fr",
	DZ: "dz-fr",
	LY: "ly-ar",
	SD: "sd-ar",
	ET: "et-am",
	GH: "gh-en",
	TZ: "sw-sw",
	UG: "ug-en",
	ZW: "zw-en",
	ZM: "zm-en",
	BW: "bw-en",
	NA: "na-en",
	MZ: "mz-pt",
	AO: "ao-pt",
	CM: "cm-fr",
	SN: "sn-fr",
	CI: "ci-fr",
	ML: "ml-fr",
	BF: "bf-fr",
	NE: "ne-fr",
	TD: "td-fr",
	CF: "cf-fr",
	CG: "cg-fr",
	CD: "cd-fr",
	RW: "rw-en",
	BI: "bi-fr",
	ER: "er-ti",
	DJ: "dj-so",
	SO: "so-so",
	GM: "gm-en",
	GN: "gn-fr",
	GW: "gw-pt",
	SL: "sl-en",
	LR: "lr-en",
	TG: "tg-fr",
	BJ: "bj-fr",
	GQ: "gq-es",
	ST: "st-pt",
	CV: "cv-pt",
	SC: "sc-en",
	MU: "mu-en",
	KM: "km-ar",
	MG: "mg-fr",
	MR: "mr-ar",
	EH: "eh-es",

	// Oceania
	AU: "au-en",
	NZ: "nz-en",
	FJ: "fj-en",
	PG: "pg-en",
	SB: "sb-en",
	VU: "vu-en",
	WS: "ws-sm",
	KI: "ki-en",
	TO: "to-en",
	TV: "tv-en",
	NR: "nr-en",
	PW: "pw-en",
	MH: "mh-en",
	FM: "fm-en",
	CK: "ck-en",
	NU: "nu-en",
	TK: "tk-en",
	AS: "as-en",
	GU: "gu-en",
	MP: "mp-en",
	PF: "pf-fr",
	NC: "nc-fr",
	WF: "wf-fr",
	PN: "pn-en",
	CX: "cx-en",
	CC: "cc-en",
	NF: "nf-en",

	// Russia & CIS
	RU: "ru-ru",
	UA: "uk-uk",
	BY: "by-be",
	MD: "md-ro",
	AM: "am-hy",
	AZ: "az-az",
	GE: "ge-ka",
	TJ: "tg-tg",
	KG: "ky-ky",
	TM: "tm-tm",
};

const LANG_MAP: Record<string, string> = {
	// Major languages
	en: "us-en",
	ja: "jp-jp",
	de: "de-de",
	fr: "fr-fr",
	zh: "cn-zh",
	es: "es-es",
	it: "it-it",
	nl: "nl-nl",
	ru: "ru-ru",
	pt: "br-pt",
	ko: "kr-kr",
	ar: "sa-ar",
	hi: "in-hi",
	th: "th-th",
	vi: "vn-vi",
	tr: "tr-tr",
	pl: "pl-pl",
	sv: "se-sv",
	da: "dk-da",
	no: "no-no",
	fi: "fi-fi",
	el: "gr-el",
	he: "il-he",
	cs: "cz-cs",
	hu: "hu-hu",
	ro: "ro-ro",
	bg: "bg-bg",
	hr: "hr-hr",
	sk: "sk-sk",
	sl: "sl-sl",
	et: "ee-et",
	lv: "lv-lv",
	lt: "lt-lt",
	mt: "mt-mt",
	is: "is-is",
	ga: "ie-en",
	cy: "cy-cy",

	// Asian languages
	tzh: "hk-tzh",
	ms: "my-ms",
	id: "id-id",
	tl: "ph-tl",
	ur: "pk-ur",
	bn: "bd-bn",
	si: "lk-si",
	ta: "lk-ta",
	ne: "np-ne",
	my: "mm-my",
	km: "kh-km",
	lo: "la-lo",
	mn: "mn-mn",
	kk: "kz-kk",
	uz: "uz-uz",
	ps: "af-ps",
	fa: "ir-fa",
	ku: "iq-ar",
	hy: "am-hy",
	ka: "ge-ka",
	tg: "tg-tg",
	ky: "ky-ky",
	tm: "tm-tm",

	// African languages
	af: "za-af",
	zu: "za-zu",
	xh: "za-xh",
	sw: "sw-sw",
	am: "et-am",
	ha: "ng-ha",
	yo: "ng-yo",
	ig: "ng-ig",
	rw: "rw-rw",
	ti: "er-ti",
	so: "so-so",
	wo: "sn-fr",
	mg: "mg-mg",

	// European languages
	ca: "es-es",
	eu: "es-es",
	gl: "es-es",
	be: "by-be",
	uk: "uk-uk",
	mk: "bg-bg",
	sq: "al-al",
	bs: "ba-ba",
	sr: "rs-rs",
	me: "me-me",

	// Americas languages
	qu: "pe-es",
	ay: "bo-es",
	gn: "py-es",
	cr: "ca-en",
	iu: "ca-en",
	ik: "as-en",

	// Pacific languages
	mi: "nz-mi",
	fj: "fj-fj",
	tpi: "pg-tpi",
	bi: "vu-bi",
	gil: "ki-gil",
	to: "to-to",
	tvl: "tv-tvl",
	na: "nr-na",
	pau: "pw-pau",
	mh: "mh-mh",
	chk: "fm-chk",
	rar: "ck-rar",
	niu: "nu-niu",
	tkl: "tk-tkl",
	ch: "gu-ch",
	wls: "wf-wls",
	ty: "pf-ty",

	// Other languages
	jv: "id-id",
	su: "id-id",
	mad: "id-id",
	min: "id-id",
	ace: "id-id",
	bjn: "id-id",
	ban: "id-id",
	bug: "id-id",
};

const LOCATION_REGEX = /^[a-z ,.'-]+$/;

function normalize(input?: string): string | undefined {
	if (!input) return undefined;
	const trimmed = input.trim().toLowerCase();
	return trimmed.length > 0 ? trimmed : undefined;
}

export function klFrom(input: {
	country?: string;
	lang?: string;
	location?: string;
}): string {
	const country = normalize(input.country);
	const lang = normalize(input.lang);
	const location = normalize(input.location);

	// 1. Exact location name
	if (location && location.length >= 3 && LOCATION_REGEX.test(location)) {
		if (LOCATION_MAP[location]) {
			return LOCATION_MAP[location];
		}
	}

	// 2. country + lang
	if (country && lang) {
		const mapped = COUNTRY_LANG_MAP[`${country}:${lang}`];
		if (mapped) return mapped;
	}

	// 3. country only
	if (country) {
		const mapped = COUNTRY_MAP[country.toUpperCase()];
		if (mapped) return mapped;
	}

	// 4. lang only
	if (lang) {
		const mapped = LANG_MAP[lang];
		if (mapped) return mapped;
	}

	return "us-en";
}

// ---------------------------------------------------------------------------
// buildDomainQuery
// ---------------------------------------------------------------------------

export function buildDomainQuery(
	query: string,
	opts: {
		includeDomains?: string[];
		excludeDomains?: string[];
	},
): string {
	const parts = [query];

	if (opts.includeDomains?.length) {
		parts.push(opts.includeDomains.map((d) => `site:${d}`).join(" OR "));
	}

	if (opts.excludeDomains?.length) {
		parts.push(opts.excludeDomains.map((d) => `-site:${d}`).join(" "));
	}

	return parts.join(" ");
}
