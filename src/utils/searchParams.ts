/**
 * Maps Firecrawl search parameters to DuckDuckGo URL parameters
 * @param options - Firecrawl search options
 * @returns Object with DuckDuckGo URL parameters
 */
export interface DuckDuckGoSearchOptions {
  tbs?: string;
  lang?: string;
  country?: string;
  location?: string;
  sources?: string[];
}

export function mapFirecrawlToDuckDuckGoParams(
  options: DuckDuckGoSearchOptions = {},
): Record<string, string> {
  const params: Record<string, string> = {};
  
  // Map time-based search (tbs) to DuckDuckGo's df parameter
  if (options.tbs) {
    if (options.tbs.includes('qdr:h')) {
      params.df = 'd'; // past day/hour
    } else if (options.tbs.includes('qdr:d')) {
      params.df = 'd'; // past day
    } else if (options.tbs.includes('qdr:w')) {
      params.df = 'w'; // past week
    } else if (options.tbs.includes('qdr:m')) {
      params.df = 'm'; // past month
    } else if (options.tbs.includes('qdr:y')) {
      params.df = 'y'; // past year
    } else if (options.tbs.includes('cdr:')) {
      // Handle custom date ranges: cdr:1,cd_min:MM/DD/YYYY,cd_max:MM/DD/YYYY
      const dateMatch = options.tbs.match(/cd_min:([^,]+)/);
      const dateMatch2 = options.tbs.match(/cd_max:([^,]+)/);
      if (dateMatch && dateMatch2) {
        // Convert to DuckDuckGo format: YYYY-MM-DD..YYYY-MM-DD
        const startDate = dateMatch[1].replace(/\//g, '-');
        const endDate = dateMatch2[1].replace(/\//g, '-');
        params.df = `${startDate}..${endDate}`;
      }
    }
  }
  
  // Map location/country/lang to DuckDuckGo's kl parameter
  const regionCode = mapToRegionCode(options.country, options.lang, options.location);
  if (regionCode) {
    params.kl = regionCode;
  }
  
  // Map sources to DuckDuckGo's ia/iax parameters
  if (options.sources) {
    if (options.sources.includes('images')) {
      params.iax = 'images';
    } else if (options.sources.includes('news')) {
      params.ia = 'news';
    } else if (options.sources.includes('web')) {
      params.ia = 'web';
    }
  }
  
  return params;
}

/**
 * Maps country, language, and location to DuckDuckGo region codes
 * @param country - Country code (e.g., 'US', 'GB')
 * @param lang - Language code (e.g., 'en', 'ja')
 * @param location - Location string (e.g., 'United States', 'UK')
 * @returns DuckDuckGo region code or null
 */
export function mapToRegionCode(country?: string, lang?: string, location?: string): string | null {
  // Priority: explicit location > country+lang > defaults
  
  if (location) {
    // Map common locations to region codes
    const loc = location.toLowerCase();
    
    // North America
    if (loc.includes('united states') || loc.includes('us') || loc.includes('america')) return 'us-en';
    if (loc.includes('canada')) return 'ca-en';
    if (loc.includes('mexico')) return 'es-mx';
    
    // Europe
    if (loc.includes('united kingdom') || loc.includes('uk') || loc.includes('britain')) return 'uk-en';
    if (loc.includes('germany')) return 'de-de';
    if (loc.includes('france')) return 'fr-fr';
    if (loc.includes('italy')) return 'it-it';
    if (loc.includes('spain')) return 'es-es';
    if (loc.includes('netherlands')) return 'nl-nl';
    if (loc.includes('belgium')) return 'be-fr';
    if (loc.includes('austria')) return 'at-de';
    if (loc.includes('switzerland')) return 'ch-de';
    if (loc.includes('sweden')) return 'se-sv';
    if (loc.includes('norway')) return 'no-no';
    if (loc.includes('denmark')) return 'dk-da';
    if (loc.includes('finland')) return 'fi-fi';
    if (loc.includes('poland')) return 'pl-pl';
    if (loc.includes('czech')) return 'cz-cs';
    if (loc.includes('hungary')) return 'hu-hu';
    if (loc.includes('romania')) return 'ro-ro';
    if (loc.includes('bulgaria')) return 'bg-bg';
    if (loc.includes('croatia')) return 'hr-hr';
    if (loc.includes('slovakia')) return 'sk-sk';
    if (loc.includes('slovenia')) return 'sl-sl';
    if (loc.includes('estonia')) return 'ee-et';
    if (loc.includes('latvia')) return 'lv-lv';
    if (loc.includes('lithuania')) return 'lt-lt';
    if (loc.includes('greece')) return 'gr-el';
    if (loc.includes('portugal')) return 'pt-pt';
    if (loc.includes('ireland')) return 'ie-en';
    if (loc.includes('iceland')) return 'is-is';
    if (loc.includes('luxembourg')) return 'lu-fr';
    if (loc.includes('malta')) return 'mt-mt';
    if (loc.includes('cyprus')) return 'cy-cy';
    
    // Asia
    if (loc.includes('japan')) return 'jp-jp';
    if (loc.includes('china') || loc.includes('prc')) return 'cn-zh';
    if (loc.includes('india')) return 'in-en';
    if (loc.includes('south korea') || loc.includes('korea')) return 'kr-kr';
    if (loc.includes('hong kong')) return 'hk-tzh';
    if (loc.includes('taiwan')) return 'tw-tzh';
    if (loc.includes('singapore')) return 'sg-en';
    if (loc.includes('thailand')) return 'th-th';
    if (loc.includes('malaysia')) return 'my-ms';
    if (loc.includes('indonesia')) return 'id-id';
    if (loc.includes('philippines')) return 'ph-tl';
    if (loc.includes('vietnam')) return 'vn-vi';
    if (loc.includes('pakistan')) return 'pk-ur';
    if (loc.includes('bangladesh')) return 'bd-bn';
    if (loc.includes('sri lanka')) return 'lk-si';
    if (loc.includes('nepal')) return 'np-ne';
    if (loc.includes('myanmar')) return 'mm-my';
    if (loc.includes('cambodia')) return 'kh-km';
    if (loc.includes('laos')) return 'la-lo';
    if (loc.includes('mongolia')) return 'mn-mn';
    if (loc.includes('kazakhstan')) return 'kz-kk';
    if (loc.includes('uzbekistan')) return 'uz-uz';
    if (loc.includes('afghanistan')) return 'af-ps';
    if (loc.includes('iraq')) return 'iq-ar';
    if (loc.includes('iran')) return 'ir-fa';
    if (loc.includes('israel')) return 'il-he';
    if (loc.includes('jordan')) return 'jo-ar';
    if (loc.includes('lebanon')) return 'lb-ar';
    if (loc.includes('syria')) return 'sy-ar';
    if (loc.includes('yemen')) return 'ye-ar';
    if (loc.includes('oman')) return 'om-ar';
    if (loc.includes('qatar')) return 'qa-ar';
    if (loc.includes('kuwait')) return 'kw-ar';
    if (loc.includes('bahrain')) return 'bh-ar';
    if (loc.includes('saudi arabia')) return 'sa-ar';
    if (loc.includes('uae') || loc.includes('united arab emirates')) return 'ae-ar';
    if (loc.includes('turkey')) return 'tr-tr';
    if (loc.includes('cyprus')) return 'cy-cy';
    
    // South America
    if (loc.includes('brazil')) return 'pt-br';
    if (loc.includes('argentina')) return 'ar-es';
    if (loc.includes('chile')) return 'cl-es';
    if (loc.includes('colombia')) return 'co-es';
    if (loc.includes('peru')) return 'pe-es';
    if (loc.includes('venezuela')) return 've-es';
    if (loc.includes('ecuador')) return 'ec-es';
    if (loc.includes('bolivia')) return 'bo-es';
    if (loc.includes('paraguay')) return 'py-es';
    if (loc.includes('uruguay')) return 'uy-es';
    if (loc.includes('guyana')) return 'gy-en';
    if (loc.includes('suriname')) return 'sr-nl';
    if (loc.includes('french guiana')) return 'gf-fr';
    
    // Central America & Caribbean
    if (loc.includes('guatemala')) return 'gt-es';
    if (loc.includes('costa rica')) return 'cr-es';
    if (loc.includes('panama')) return 'pa-es';
    if (loc.includes('cuba')) return 'cu-es';
    if (loc.includes('haiti')) return 'ht-fr';
    if (loc.includes('dominican republic')) return 'do-es';
    if (loc.includes('puerto rico')) return 'pr-es';
    if (loc.includes('jamaica')) return 'jm-en';
    if (loc.includes('trinidad') || loc.includes('tobago')) return 'tt-en';
    if (loc.includes('barbados')) return 'bb-en';
    if (loc.includes('bahamas')) return 'bs-en';
    if (loc.includes('belize')) return 'bz-en';
    if (loc.includes('el salvador')) return 'sv-es';
    if (loc.includes('honduras')) return 'hn-es';
    if (loc.includes('nicaragua')) return 'ni-es';
    
    // Africa
    if (loc.includes('south africa')) return 'za-en';
    if (loc.includes('egypt')) return 'eg-ar';
    if (loc.includes('nigeria')) return 'ng-en';
    if (loc.includes('kenya')) return 'ke-en';
    if (loc.includes('morocco')) return 'ma-fr';
    if (loc.includes('tunisia')) return 'tn-fr';
    if (loc.includes('algeria')) return 'dz-fr';
    if (loc.includes('libya')) return 'ly-ar';
    if (loc.includes('sudan')) return 'sd-ar';
    if (loc.includes('ethiopia')) return 'et-am';
    if (loc.includes('ghana')) return 'gh-en';
    if (loc.includes('tanzania')) return 'sw-sw';
    if (loc.includes('uganda')) return 'ug-en';
    if (loc.includes('zimbabwe')) return 'zw-en';
    if (loc.includes('zambia')) return 'zm-en';
    if (loc.includes('botswana')) return 'bw-en';
    if (loc.includes('namibia')) return 'na-en';
    if (loc.includes('mozambique')) return 'mz-pt';
    if (loc.includes('angola')) return 'ao-pt';
    if (loc.includes('cameroon')) return 'cm-fr';
    if (loc.includes('senegal')) return 'sn-fr';
    if (loc.includes('ivory coast') || loc.includes('côte d\'ivoire')) return 'ci-fr';
    if (loc.includes('mali')) return 'ml-fr';
    if (loc.includes('burkina faso')) return 'bf-fr';
    if (loc.includes('niger')) return 'ne-fr';
    if (loc.includes('chad')) return 'td-fr';
    if (loc.includes('central african republic')) return 'cf-fr';
    if (loc.includes('congo')) return 'cg-fr';
    if (loc.includes('democratic republic of congo') || loc.includes('drc')) return 'cd-fr';
    if (loc.includes('rwanda')) return 'rw-en';
    if (loc.includes('burundi')) return 'bi-fr';
    if (loc.includes('eritrea')) return 'er-ti';
    if (loc.includes('djibouti')) return 'dj-so';
    if (loc.includes('somalia')) return 'so-so';
    if (loc.includes('gambia')) return 'gm-en';
    if (loc.includes('guinea')) return 'gn-fr';
    if (loc.includes('guinea-bissau')) return 'gw-pt';
    if (loc.includes('sierra leone')) return 'sl-en';
    if (loc.includes('liberia')) return 'lr-en';
    if (loc.includes('togo')) return 'tg-fr';
    if (loc.includes('benin')) return 'bj-fr';
    if (loc.includes('equatorial guinea')) return 'gq-es';
    if (loc.includes('são tomé') || loc.includes('príncipe')) return 'st-pt';
    if (loc.includes('cape verde')) return 'cv-pt';
    if (loc.includes('seychelles')) return 'sc-en';
    if (loc.includes('mauritius')) return 'mu-en';
    if (loc.includes('comoros')) return 'km-ar';
    if (loc.includes('madagascar')) return 'mg-fr';
    if (loc.includes('mauritania')) return 'mr-ar';
    if (loc.includes('western sahara')) return 'eh-es';
    
    // Oceania
    if (loc.includes('australia')) return 'au-en';
    if (loc.includes('new zealand')) return 'nz-en';
    if (loc.includes('fiji')) return 'fj-en';
    if (loc.includes('papua new guinea')) return 'pg-en';
    if (loc.includes('solomon islands')) return 'sb-en';
    if (loc.includes('vanuatu')) return 'vu-en';
    if (loc.includes('samoa')) return 'ws-sm';
    if (loc.includes('kiribati')) return 'ki-en';
    if (loc.includes('tonga')) return 'to-en';
    if (loc.includes('tuvalu')) return 'tv-en';
    if (loc.includes('nauru')) return 'nr-en';
    if (loc.includes('palau')) return 'pw-en';
    if (loc.includes('marshall islands')) return 'mh-en';
    if (loc.includes('micronesia')) return 'fm-en';
    if (loc.includes('cook islands')) return 'ck-en';
    if (loc.includes('niue')) return 'nu-en';
    if (loc.includes('tokelau')) return 'tk-en';
    if (loc.includes('american samoa')) return 'as-en';
    if (loc.includes('guam')) return 'gu-en';
    if (loc.includes('northern mariana islands')) return 'mp-en';
    if (loc.includes('french polynesia') || loc.includes('tahiti')) return 'pf-fr';
    if (loc.includes('new caledonia')) return 'nc-fr';
    if (loc.includes('wallis') || loc.includes('futuna')) return 'wf-fr';
    if (loc.includes('pitcairn islands')) return 'pn-en';
    if (loc.includes('easter island')) return 'cl-es';
    if (loc.includes('christmas island')) return 'cx-en';
    if (loc.includes('cocos islands')) return 'cc-en';
    if (loc.includes('norfolk island')) return 'nf-en';
    
    // Russia & CIS
    if (loc.includes('russia')) return 'ru-ru';
    if (loc.includes('ukraine')) return 'uk-uk';
    if (loc.includes('belarus')) return 'by-be';
    if (loc.includes('moldova')) return 'md-ro';
    if (loc.includes('armenia')) return 'am-hy';
    if (loc.includes('azerbaijan')) return 'az-az';
    if (loc.includes('georgia')) return 'ge-ka';
    if (loc.includes('tajikistan')) return 'tg-tg';
    if (loc.includes('kyrgyzstan')) return 'ky-ky';
    if (loc.includes('turkmenistan')) return 'tm-tm';
  }
  
  if (country && lang) {
    // Map country+lang combinations
    const cc = country.toUpperCase();
    const lc = lang.toLowerCase();
    
    // North America
    if (cc === 'US' && lc === 'en') return 'us-en';
    if (cc === 'CA' && lc === 'en') return 'ca-en';
    if (cc === 'CA' && lc === 'fr') return 'ca-fr';
    if (cc === 'MX' && lc === 'es') return 'es-mx';
    
    // Europe
    if (cc === 'GB' && lc === 'en') return 'uk-en';
    if (cc === 'DE' && lc === 'de') return 'de-de';
    if (cc === 'FR' && lc === 'fr') return 'fr-fr';
    if (cc === 'IT' && lc === 'it') return 'it-it';
    if (cc === 'ES' && lc === 'es') return 'es-es';
    if (cc === 'NL' && lc === 'nl') return 'nl-nl';
    if (cc === 'BE' && lc === 'fr') return 'be-fr';
    if (cc === 'BE' && lc === 'nl') return 'be-nl';
    if (cc === 'AT' && lc === 'de') return 'at-de';
    if (cc === 'CH' && lc === 'de') return 'ch-de';
    if (cc === 'CH' && lc === 'fr') return 'ch-fr';
    if (cc === 'CH' && lc === 'it') return 'ch-it';
    if (cc === 'SE' && lc === 'sv') return 'se-sv';
    if (cc === 'NO' && lc === 'no') return 'no-no';
    if (cc === 'DK' && lc === 'da') return 'dk-da';
    if (cc === 'FI' && lc === 'fi') return 'fi-fi';
    if (cc === 'PL' && lc === 'pl') return 'pl-pl';
    if (cc === 'CZ' && lc === 'cs') return 'cz-cs';
    if (cc === 'HU' && lc === 'hu') return 'hu-hu';
    if (cc === 'RO' && lc === 'ro') return 'ro-ro';
    if (cc === 'BG' && lc === 'bg') return 'bg-bg';
    if (cc === 'HR' && lc === 'hr') return 'hr-hr';
    if (cc === 'SK' && lc === 'sk') return 'sk-sk';
    if (cc === 'SI' && lc === 'sl') return 'sl-sl';
    if (cc === 'EE' && lc === 'et') return 'ee-et';
    if (cc === 'LV' && lc === 'lv') return 'lv-lv';
    if (cc === 'LT' && lc === 'lt') return 'lt-lt';
    if (cc === 'GR' && lc === 'el') return 'gr-el';
    if (cc === 'PT' && lc === 'pt') return 'pt-pt';
    if (cc === 'IE' && lc === 'en') return 'ie-en';
    if (cc === 'IS' && lc === 'is') return 'is-is';
    if (cc === 'LU' && lc === 'fr') return 'lu-fr';
    if (cc === 'LU' && lc === 'de') return 'lu-de';
    if (cc === 'LU' && lc === 'lb') return 'lu-lb';
    if (cc === 'MT' && lc === 'mt') return 'mt-mt';
    if (cc === 'CY' && lc === 'el') return 'cy-el';
    if (cc === 'CY' && lc === 'tr') return 'cy-tr';
    
    // Asia
    if (cc === 'JP' && lc === 'ja') return 'jp-jp';
    if (cc === 'CN' && lc === 'zh') return 'cn-zh';
    if (cc === 'IN' && lc === 'en') return 'in-en';
    if (cc === 'IN' && lc === 'hi') return 'in-hi';
    if (cc === 'KR' && lc === 'ko') return 'kr-kr';
    if (cc === 'HK' && lc === 'tzh') return 'hk-tzh';
    if (cc === 'HK' && lc === 'en') return 'hk-en';
    if (cc === 'TW' && lc === 'tzh') return 'tw-tzh';
    if (cc === 'SG' && lc === 'en') return 'sg-en';
    if (cc === 'SG' && lc === 'zh') return 'sg-zh';
    if (cc === 'SG' && lc === 'ms') return 'sg-ms';
    if (cc === 'SG' && lc === 'ta') return 'sg-ta';
    if (cc === 'TH' && lc === 'th') return 'th-th';
    if (cc === 'MY' && lc === 'ms') return 'my-ms';
    if (cc === 'MY' && lc === 'en') return 'my-en';
    if (cc === 'ID' && lc === 'id') return 'id-id';
    if (cc === 'ID' && lc === 'en') return 'id-en';
    if (cc === 'PH' && lc === 'tl') return 'ph-tl';
    if (cc === 'PH' && lc === 'en') return 'ph-en';
    if (cc === 'VN' && lc === 'vi') return 'vn-vi';
    if (cc === 'VN' && lc === 'en') return 'vn-en';
    if (cc === 'PK' && lc === 'ur') return 'pk-ur';
    if (cc === 'PK' && lc === 'en') return 'pk-en';
    if (cc === 'BD' && lc === 'bn') return 'bd-bn';
    if (cc === 'BD' && lc === 'en') return 'bd-en';
    if (cc === 'LK' && lc === 'si') return 'lk-si';
    if (cc === 'LK' && lc === 'ta') return 'lk-ta';
    if (cc === 'LK' && lc === 'en') return 'lk-en';
    if (cc === 'NP' && lc === 'ne') return 'np-ne';
    if (cc === 'NP' && lc === 'en') return 'np-en';
    if (cc === 'MM' && lc === 'my') return 'mm-my';
    if (cc === 'KH' && lc === 'km') return 'kh-km';
    if (cc === 'LA' && lc === 'lo') return 'la-lo';
    if (cc === 'MN' && lc === 'mn') return 'mn-mn';
    if (cc === 'KZ' && lc === 'kk') return 'kz-kk';
    if (cc === 'KZ' && lc === 'ru') return 'kz-ru';
    if (cc === 'UZ' && lc === 'uz') return 'uz-uz';
    if (cc === 'UZ' && lc === 'ru') return 'uz-ru';
    if (cc === 'AF' && lc === 'ps') return 'af-ps';
    if (cc === 'AF' && lc === 'da') return 'af-da';
    if (cc === 'IQ' && lc === 'ar') return 'iq-ar';
    if (cc === 'IR' && lc === 'fa') return 'ir-fa';
    if (cc === 'IL' && lc === 'he') return 'il-he';
    if (cc === 'IL' && lc === 'ar') return 'il-ar';
    if (cc === 'IL' && lc === 'en') return 'il-en';
    if (cc === 'JO' && lc === 'ar') return 'jo-ar';
    if (cc === 'JO' && lc === 'en') return 'jo-en';
    if (cc === 'LB' && lc === 'ar') return 'lb-ar';
    if (cc === 'LB' && lc === 'fr') return 'lb-fr';
    if (cc === 'LB' && lc === 'en') return 'lb-en';
    if (cc === 'SY' && lc === 'ar') return 'sy-ar';
    if (cc === 'YE' && lc === 'ar') return 'ye-ar';
    if (cc === 'OM' && lc === 'ar') return 'om-ar';
    if (cc === 'OM' && lc === 'en') return 'om-en';
    if (cc === 'QA' && lc === 'ar') return 'qa-ar';
    if (cc === 'QA' && lc === 'en') return 'qa-en';
    if (cc === 'KW' && lc === 'ar') return 'kw-ar';
    if (cc === 'KW' && lc === 'en') return 'kw-en';
    if (cc === 'BH' && lc === 'ar') return 'bh-ar';
    if (cc === 'BH' && lc === 'en') return 'bh-en';
    if (cc === 'SA' && lc === 'ar') return 'sa-ar';
    if (cc === 'SA' && lc === 'en') return 'sa-en';
    if (cc === 'AE' && lc === 'ar') return 'ae-ar';
    if (cc === 'AE' && lc === 'en') return 'ae-en';
    if (cc === 'TR' && lc === 'tr') return 'tr-tr';
    if (cc === 'TR' && lc === 'en') return 'tr-en';
    
    // South America
    if (cc === 'BR' && lc === 'pt') return 'pt-br';
    if (cc === 'BR' && lc === 'en') return 'br-en';
    if (cc === 'BR' && lc === 'es') return 'br-es';
    if (cc === 'AR' && lc === 'es') return 'ar-es';
    if (cc === 'AR' && lc === 'en') return 'ar-en';
    if (cc === 'CL' && lc === 'es') return 'cl-es';
    if (cc === 'CL' && lc === 'en') return 'cl-en';
    if (cc === 'CO' && lc === 'es') return 'co-es';
    if (cc === 'CO' && lc === 'en') return 'co-en';
    if (cc === 'PE' && lc === 'es') return 'pe-es';
    if (cc === 'PE' && lc === 'en') return 'pe-en';
    if (cc === 'VE' && lc === 'es') return 've-es';
    if (cc === 'VE' && lc === 'en') return 've-en';
    if (cc === 'EC' && lc === 'es') return 'ec-es';
    if (cc === 'EC' && lc === 'en') return 'ec-en';
    if (cc === 'BO' && lc === 'es') return 'bo-es';
    if (cc === 'BO' && lc === 'en') return 'bo-en';
    if (cc === 'PY' && lc === 'es') return 'py-es';
    if (cc === 'PY' && lc === 'en') return 'py-en';
    if (cc === 'UY' && lc === 'es') return 'uy-es';
    if (cc === 'UY' && lc === 'en') return 'uy-en';
    if (cc === 'GY' && lc === 'en') return 'gy-en';
    if (cc === 'SR' && lc === 'nl') return 'sr-nl';
    if (cc === 'SR' && lc === 'en') return 'sr-en';
    if (cc === 'GF' && lc === 'fr') return 'gf-fr';
    
    // Central America & Caribbean
    if (cc === 'GT' && lc === 'es') return 'gt-es';
    if (cc === 'GT' && lc === 'en') return 'gt-en';
    if (cc === 'CR' && lc === 'es') return 'cr-es';
    if (cc === 'CR' && lc === 'en') return 'cr-en';
    if (cc === 'PA' && lc === 'es') return 'pa-es';
    if (cc === 'PA' && lc === 'en') return 'pa-en';
    if (cc === 'CU' && lc === 'es') return 'cu-es';
    if (cc === 'HT' && lc === 'fr') return 'ht-fr';
    if (cc === 'HT' && lc === 'en') return 'ht-en';
    if (cc === 'DO' && lc === 'es') return 'do-es';
    if (cc === 'DO' && lc === 'en') return 'do-en';
    if (cc === 'PR' && lc === 'es') return 'pr-es';
    if (cc === 'PR' && lc === 'en') return 'pr-en';
    if (cc === 'JM' && lc === 'en') return 'jm-en';
    if (cc === 'TT' && lc === 'en') return 'tt-en';
    if (cc === 'BB' && lc === 'en') return 'bb-en';
    if (cc === 'BS' && lc === 'en') return 'bs-en';
    if (cc === 'BZ' && lc === 'en') return 'bz-en';
    if (cc === 'SV' && lc === 'es') return 'sv-es';
    if (cc === 'SV' && lc === 'en') return 'sv-en';
    if (cc === 'HN' && lc === 'es') return 'hn-es';
    if (cc === 'HN' && lc === 'en') return 'hn-en';
    if (cc === 'NI' && lc === 'es') return 'ni-es';
    if (cc === 'NI' && lc === 'en') return 'ni-en';
    
    // Africa
    if (cc === 'ZA' && lc === 'en') return 'za-en';
    if (cc === 'ZA' && lc === 'af') return 'za-af';
    if (cc === 'ZA' && lc === 'zu') return 'za-zu';
    if (cc === 'ZA' && lc === 'xh') return 'za-xh';
    if (cc === 'EG' && lc === 'ar') return 'eg-ar';
    if (cc === 'EG' && lc === 'en') return 'eg-en';
    if (cc === 'NG' && lc === 'en') return 'ng-en';
    if (cc === 'NG' && lc === 'ha') return 'ng-ha';
    if (cc === 'NG' && lc === 'yo') return 'ng-yo';
    if (cc === 'NG' && lc === 'ig') return 'ng-ig';
    if (cc === 'KE' && lc === 'en') return 'ke-en';
    if (cc === 'KE' && lc === 'sw') return 'ke-sw';
    if (cc === 'MA' && lc === 'fr') return 'ma-fr';
    if (cc === 'MA' && lc === 'ar') return 'ma-ar';
    if (cc === 'TN' && lc === 'fr') return 'tn-fr';
    if (cc === 'TN' && lc === 'ar') return 'tn-ar';
    if (cc === 'DZ' && lc === 'fr') return 'dz-fr';
    if (cc === 'DZ' && lc === 'ar') return 'dz-ar';
    if (cc === 'LY' && lc === 'ar') return 'ly-ar';
    if (cc === 'LY' && lc === 'en') return 'ly-en';
    if (cc === 'SD' && lc === 'ar') return 'sd-ar';
    if (cc === 'SD' && lc === 'en') return 'sd-en';
    if (cc === 'ET' && lc === 'am') return 'et-am';
    if (cc === 'ET' && lc === 'en') return 'et-en';
    if (cc === 'GH' && lc === 'en') return 'gh-en';
    if (cc === 'TZ' && lc === 'sw') return 'sw-sw';
    if (cc === 'TZ' && lc === 'en') return 'tz-en';
    if (cc === 'UG' && lc === 'en') return 'ug-en';
    if (cc === 'ZW' && lc === 'en') return 'zw-en';
    if (cc === 'ZM' && lc === 'en') return 'zm-en';
    if (cc === 'BW' && lc === 'en') return 'bw-en';
    if (cc === 'BW' && lc === 'tn') return 'bw-tn';
    if (cc === 'NA' && lc === 'en') return 'na-en';
    if (cc === 'MZ' && lc === 'pt') return 'mz-pt';
    if (cc === 'AO' && lc === 'pt') return 'ao-pt';
    if (cc === 'CM' && lc === 'fr') return 'cm-fr';
    if (cc === 'CM' && lc === 'en') return 'cm-en';
    if (cc === 'SN' && lc === 'fr') return 'sn-fr';
    if (cc === 'CI' && lc === 'fr') return 'ci-fr';
    if (cc === 'ML' && lc === 'fr') return 'ml-fr';
    if (cc === 'BF' && lc === 'fr') return 'bf-fr';
    if (cc === 'NE' && lc === 'fr') return 'ne-fr';
    if (cc === 'TD' && lc === 'fr') return 'td-fr';
    if (cc === 'CF' && lc === 'fr') return 'cf-fr';
    if (cc === 'CG' && lc === 'fr') return 'cg-fr';
    if (cc === 'CD' && lc === 'fr') return 'cd-fr';
    if (cc === 'RW' && lc === 'en') return 'rw-en';
    if (cc === 'RW' && lc === 'fr') return 'rw-fr';
    if (cc === 'RW' && lc === 'rw') return 'rw-rw';
    if (cc === 'BI' && lc === 'fr') return 'bi-fr';
    if (cc === 'BI' && lc === 'rw') return 'bi-rw';
    if (cc === 'ER' && lc === 'ti') return 'er-ti';
    if (cc === 'ER' && lc === 'en') return 'er-en';
    if (cc === 'DJ' && lc === 'so') return 'dj-so';
    if (cc === 'DJ' && lc === 'fr') return 'dj-fr';
    if (cc === 'DJ' && lc === 'ar') return 'dj-ar';
    if (cc === 'SO' && lc === 'so') return 'so-so';
    if (cc === 'SO' && lc === 'ar') return 'so-ar';
    if (cc === 'SO' && lc === 'en') return 'so-en';
    if (cc === 'GM' && lc === 'en') return 'gm-en';
    if (cc === 'GN' && lc === 'fr') return 'gn-fr';
    if (cc === 'GW' && lc === 'pt') return 'gw-pt';
    if (cc === 'SL' && lc === 'en') return 'sl-en';
    if (cc === 'LR' && lc === 'en') return 'lr-en';
    if (cc === 'TG' && lc === 'fr') return 'tg-fr';
    if (cc === 'BJ' && lc === 'fr') return 'bj-fr';
    if (cc === 'GQ' && lc === 'es') return 'gq-es';
    if (cc === 'GQ' && lc === 'fr') return 'gq-fr';
    if (cc === 'GQ' && lc === 'pt') return 'gq-pt';
    if (cc === 'ST' && lc === 'pt') return 'st-pt';
    if (cc === 'CV' && lc === 'pt') return 'cv-pt';
    if (cc === 'SC' && lc === 'en') return 'sc-en';
    if (cc === 'SC' && lc === 'fr') return 'sc-fr';
    if (cc === 'MU' && lc === 'en') return 'mu-en';
    if (cc === 'MU' && lc === 'fr') return 'mu-fr';
    if (cc === 'KM' && lc === 'ar') return 'km-ar';
    if (cc === 'KM' && lc === 'fr') return 'km-fr';
    if (cc === 'MG' && lc === 'fr') return 'mg-fr';
    if (cc === 'MG' && lc === 'mg') return 'mg-mg';
    if (cc === 'MR' && lc === 'ar') return 'mr-ar';
    if (cc === 'EH' && lc === 'es') return 'eh-es';
    if (cc === 'EH' && lc === 'ar') return 'eh-ar';
    
    // Oceania
    if (cc === 'AU' && lc === 'en') return 'au-en';
    if (cc === 'NZ' && lc === 'en') return 'nz-en';
    if (cc === 'NZ' && lc === 'mi') return 'nz-mi';
    if (cc === 'FJ' && lc === 'en') return 'fj-en';
    if (cc === 'FJ' && lc === 'fj') return 'fj-fj';
    if (cc === 'PG' && lc === 'en') return 'pg-en';
    if (cc === 'PG' && lc === 'tpi') return 'pg-tpi';
    if (cc === 'SB' && lc === 'en') return 'sb-en';
    if (cc === 'VU' && lc === 'en') return 'vu-en';
    if (cc === 'VU' && lc === 'bi') return 'vu-bi';
    if (cc === 'WS' && lc === 'sm') return 'ws-sm';
    if (cc === 'WS' && lc === 'en') return 'ws-en';
    if (cc === 'KI' && lc === 'en') return 'ki-en';
    if (cc === 'KI' && lc === 'gil') return 'ki-gil';
    if (cc === 'TO' && lc === 'en') return 'to-en';
    if (cc === 'TO' && lc === 'to') return 'to-to';
    if (cc === 'TV' && lc === 'en') return 'tv-en';
    if (cc === 'TV' && lc === 'tvl') return 'tv-tvl';
    if (cc === 'NR' && lc === 'en') return 'nr-en';
    if (cc === 'NR' && lc === 'na') return 'nr-na';
    if (cc === 'PW' && lc === 'en') return 'pw-en';
    if (cc === 'PW' && lc === 'pau') return 'pw-pau';
    if (cc === 'MH' && lc === 'en') return 'mh-en';
    if (cc === 'MH' && lc === 'mh') return 'mh-mh';
    if (cc === 'FM' && lc === 'en') return 'fm-en';
    if (cc === 'FM' && lc === 'chk') return 'fm-chk';
    if (cc === 'CK' && lc === 'en') return 'ck-en';
    if (cc === 'CK' && lc === 'rar') return 'ck-rar';
    if (cc === 'NU' && lc === 'en') return 'nu-en';
    if (cc === 'NU' && lc === 'niu') return 'nu-niu';
    if (cc === 'TK' && lc === 'en') return 'tk-en';
    if (cc === 'TK' && lc === 'tkl') return 'tk-tkl';
    if (cc === 'AS' && lc === 'en') return 'as-en';
    if (cc === 'AS' && lc === 'sm') return 'as-sm';
    if (cc === 'GU' && lc === 'en') return 'gu-en';
    if (cc === 'GU' && lc === 'ch') return 'gu-ch';
    if (cc === 'MP' && lc === 'en') return 'mp-en';
    if (cc === 'MP' && lc === 'ch') return 'mp-ch';
    if (cc === 'PF' && lc === 'fr') return 'pf-fr';
    if (cc === 'PF' && lc === 'ty') return 'pf-ty';
    if (cc === 'NC' && lc === 'fr') return 'nc-fr';
    if (cc === 'WF' && lc === 'fr') return 'wf-fr';
    if (cc === 'WF' && lc === 'wls') return 'wf-wls';
    if (cc === 'PN' && lc === 'en') return 'pn-en';
    if (cc === 'CX' && lc === 'en') return 'cx-en';
    if (cc === 'CC' && lc === 'en') return 'cc-en';
    if (cc === 'NF' && lc === 'en') return 'nf-en';
    
    // Russia & CIS
    if (cc === 'RU' && lc === 'ru') return 'ru-ru';
    if (cc === 'RU' && lc === 'en') return 'ru-en';
    if (cc === 'UA' && lc === 'uk') return 'uk-uk';
    if (cc === 'UA' && lc === 'ru') return 'ua-ru';
    if (cc === 'BY' && lc === 'be') return 'by-be';
    if (cc === 'BY' && lc === 'ru') return 'by-ru';
    if (cc === 'MD' && lc === 'ro') return 'md-ro';
    if (cc === 'MD' && lc === 'ru') return 'md-ru';
    if (cc === 'AM' && lc === 'hy') return 'am-hy';
    if (cc === 'AM' && lc === 'ru') return 'am-ru';
    if (cc === 'AZ' && lc === 'az') return 'az-az';
    if (cc === 'AZ' && lc === 'ru') return 'az-ru';
    if (cc === 'GE' && lc === 'ka') return 'ge-ka';
    if (cc === 'GE' && lc === 'ru') return 'ge-ru';
    if (cc === 'TJ' && lc === 'tg') return 'tg-tg';
    if (cc === 'TJ' && lc === 'ru') return 'tg-ru';
    if (cc === 'KG' && lc === 'ky') return 'ky-ky';
    if (cc === 'KG' && lc === 'ru') return 'ky-ru';
    if (cc === 'TM' && lc === 'tm') return 'tm-tm';
    if (cc === 'TM' && lc === 'ru') return 'tm-ru';
  }
  
  // Fallback to country only
  if (country) {
    const cc = country.toUpperCase();
    const countryMap: Record<string, string> = {
      // North America
      'US': 'us-en',
      'CA': 'ca-en',
      'MX': 'es-mx',
      
      // Europe
      'GB': 'uk-en',
      'DE': 'de-de',
      'FR': 'fr-fr',
      'IT': 'it-it',
      'ES': 'es-es',
      'NL': 'nl-nl',
      'BE': 'be-fr',
      'AT': 'at-de',
      'CH': 'ch-de',
      'SE': 'se-sv',
      'NO': 'no-no',
      'DK': 'dk-da',
      'FI': 'fi-fi',
      'PL': 'pl-pl',
      'CZ': 'cz-cs',
      'HU': 'hu-hu',
      'RO': 'ro-ro',
      'BG': 'bg-bg',
      'HR': 'hr-hr',
      'SK': 'sk-sk',
      'SI': 'sl-sl',
      'EE': 'ee-et',
      'LV': 'lv-lv',
      'LT': 'lt-lt',
      'GR': 'gr-el',
      'PT': 'pt-pt',
      'IE': 'ie-en',
      'IS': 'is-is',
      'LU': 'lu-fr',
      'MT': 'mt-mt',
      'CY': 'cy-cy',
      
      // Asia
      'JP': 'jp-jp',
      'CN': 'cn-zh',
      'IN': 'in-en',
      'KR': 'kr-kr',
      'HK': 'hk-tzh',
      'TW': 'tw-tzh',
      'SG': 'sg-en',
      'TH': 'th-th',
      'MY': 'my-ms',
      'ID': 'id-id',
      'PH': 'ph-tl',
      'VN': 'vn-vi',
      'PK': 'pk-ur',
      'BD': 'bd-bn',
      'LK': 'lk-si',
      'NP': 'np-ne',
      'MM': 'mm-my',
      'KH': 'kh-km',
      'LA': 'la-lo',
      'MN': 'mn-mn',
      'KZ': 'kz-kk',
      'UZ': 'uz-uz',
      'AF': 'af-ps',
      'IQ': 'iq-ar',
      'IR': 'ir-fa',
      'IL': 'il-he',
      'JO': 'jo-ar',
      'LB': 'lb-ar',
      'SY': 'sy-ar',
      'YE': 'ye-ar',
      'OM': 'om-ar',
      'QA': 'qa-ar',
      'KW': 'kw-ar',
      'BH': 'bh-ar',
      'SA': 'sa-ar',
      'AE': 'ae-ar',
      'TR': 'tr-tr',
      
      // South America
      'BR': 'pt-br',
      'AR': 'ar-es',
      'CL': 'cl-es',
      'CO': 'co-es',
      'PE': 'pe-es',
      'VE': 've-es',
      'EC': 'ec-es',
      'BO': 'bo-es',
      'PY': 'py-es',
      'UY': 'uy-es',
      'GY': 'gy-en',
      'SR': 'sr-nl',
      'GF': 'gf-fr',
      
      // Central America & Caribbean
      'GT': 'gt-es',
      'CR': 'cr-es',
      'PA': 'pa-es',
      'CU': 'cu-es',
      'HT': 'ht-fr',
      'DO': 'do-es',
      'PR': 'pr-es',
      'JM': 'jm-en',
      'TT': 'tt-en',
      'BB': 'bb-en',
      'BS': 'bs-en',
      'BZ': 'bz-en',
      'SV': 'sv-es',
      'HN': 'hn-es',
      'NI': 'ni-es',
      
      // Africa
      'ZA': 'za-en',
      'EG': 'eg-ar',
      'NG': 'ng-en',
      'KE': 'ke-en',
      'MA': 'ma-fr',
      'TN': 'tn-fr',
      'DZ': 'dz-fr',
      'LY': 'ly-ar',
      'SD': 'sd-ar',
      'ET': 'et-am',
      'GH': 'gh-en',
      'TZ': 'sw-sw',
      'UG': 'ug-en',
      'ZW': 'zw-en',
      'ZM': 'zm-en',
      'BW': 'bw-en',
      'NA': 'na-en',
      'MZ': 'mz-pt',
      'AO': 'ao-pt',
      'CM': 'cm-fr',
      'SN': 'sn-fr',
      'CI': 'ci-fr',
      'ML': 'ml-fr',
      'BF': 'bf-fr',
      'NE': 'ne-fr',
      'TD': 'td-fr',
      'CF': 'cf-fr',
      'CG': 'cg-fr',
      'CD': 'cd-fr',
      'RW': 'rw-en',
      'BI': 'bi-fr',
      'ER': 'er-ti',
      'DJ': 'dj-so',
      'SO': 'so-so',
      'GM': 'gm-en',
      'GN': 'gn-fr',
      'GW': 'gw-pt',
      'SL': 'sl-en',
      'LR': 'lr-en',
      'TG': 'tg-fr',
      'BJ': 'bj-fr',
      'GQ': 'gq-es',
      'ST': 'st-pt',
      'CV': 'cv-pt',
      'SC': 'sc-en',
      'MU': 'mu-en',
      'KM': 'km-ar',
      'MG': 'mg-fr',
      'MR': 'mr-ar',
      'EH': 'eh-es',
      
      // Oceania
      'AU': 'au-en',
      'NZ': 'nz-en',
      'FJ': 'fj-en',
      'PG': 'pg-en',
      'SB': 'sb-en',
      'VU': 'vu-en',
      'WS': 'ws-sm',
      'KI': 'ki-en',
      'TO': 'to-en',
      'TV': 'tv-en',
      'NR': 'nr-en',
      'PW': 'pw-en',
      'MH': 'mh-en',
      'FM': 'fm-en',
      'CK': 'ck-en',
      'NU': 'nu-en',
      'TK': 'tk-en',
      'AS': 'as-en',
      'GU': 'gu-en',
      'MP': 'mp-en',
      'PF': 'pf-fr',
      'NC': 'nc-fr',
      'WF': 'wf-fr',
      'PN': 'pn-en',
      'CX': 'cx-en',
      'CC': 'cc-en',
      'NF': 'nf-en',
      
      // Russia & CIS
      'RU': 'ru-ru',
      'UA': 'uk-uk',
      'BY': 'by-be',
      'MD': 'md-ro',
      'AM': 'am-hy',
      'AZ': 'az-az',
      'GE': 'ge-ka',
      'TJ': 'tg-tg',
      'KG': 'ky-ky',
      'TM': 'tm-tm'
    };
    return countryMap[cc] || null;
  }
  
  // Fallback to language only
  if (lang) {
    const lc = lang.toLowerCase();
    const langMap: Record<string, string> = {
      // Major languages
      'en': 'us-en',
      'ja': 'jp-jp',
      'de': 'de-de',
      'fr': 'fr-fr',
      'zh': 'cn-zh',
      'es': 'es-es',
      'it': 'it-it',
      'nl': 'nl-nl',
      'ru': 'ru-ru',
      'pt': 'pt-br',
      'ko': 'kr-kr',
      'ar': 'sa-ar',
      'hi': 'in-hi',
      'th': 'th-th',
      'vi': 'vn-vi',
      'tr': 'tr-tr',
      'pl': 'pl-pl',
      'sv': 'se-sv',
      'da': 'dk-da',
      'no': 'no-no',
      'fi': 'fi-fi',
      'el': 'gr-el',
      'he': 'il-he',
      'cs': 'cz-cs',
      'hu': 'hu-hu',
      'ro': 'ro-ro',
      'bg': 'bg-bg',
      'hr': 'hr-hr',
      'sk': 'sk-sk',
      'sl': 'sl-sl',
      'et': 'ee-et',
      'lv': 'lv-lv',
      'lt': 'lt-lt',
      'mt': 'mt-mt',
      'is': 'is-is',
      'ga': 'ie-en',
      'cy': 'cy-cy',
      
      // Asian languages
      'tzh': 'hk-tzh',
      'ms': 'my-ms',
      'id': 'id-id',
      'tl': 'ph-tl',
      'ur': 'pk-ur',
      'bn': 'bd-bn',
      'si': 'lk-si',
      'ta': 'lk-ta',
      'ne': 'np-ne',
      'my': 'mm-my',
      'km': 'kh-km',
      'lo': 'la-lo',
      'mn': 'mn-mn',
      'kk': 'kz-kk',
      'uz': 'uz-uz',
      'ps': 'af-ps',
      'fa': 'ir-fa',
      'ku': 'iq-ar',
      'hy': 'am-hy',
      'ka': 'ge-ka',
      'tg': 'tg-tg',
      'ky': 'ky-ky',
      'tm': 'tm-tm',
      
      // African languages
      'af': 'za-af',
      'zu': 'za-zu',
      'xh': 'za-xh',
      'sw': 'sw-sw',
      'am': 'et-am',
      'ha': 'ng-ha',
      'yo': 'ng-yo',
      'ig': 'ng-ig',
      'rw': 'rw-rw',
      'ti': 'er-ti',
      'so': 'so-so',
      'wo': 'sn-fr',
      'mg': 'mg-mg',
      
      // European languages
      'ca': 'es-es',
      'eu': 'es-es',
      'gl': 'es-es',
      'be': 'by-be',
      'uk': 'uk-uk',
      'mk': 'bg-bg',
      'sq': 'al-al',
      'bs': 'ba-ba',
      'sr': 'rs-rs',
      'me': 'me-me',
      
      // Americas languages
      'qu': 'pe-es',
      'ay': 'bo-es',
      'gn': 'py-es',
      'cr': 'ca-en',
      'iu': 'ca-en',
      'ik': 'as-en',
      
      // Pacific languages
      'mi': 'nz-mi',
      'fj': 'fj-fj',
      'tpi': 'pg-tpi',
      'bi': 'vu-bi',
      'gil': 'ki-gil',
      'to': 'to-to',
      'tvl': 'tv-tvl',
      'na': 'nr-na',
      'pau': 'pw-pau',
      'mh': 'mh-mh',
      'chk': 'fm-chk',
      'rar': 'ck-rar',
      'niu': 'nu-niu',
      'tkl': 'tk-tkl',
      'ch': 'gu-ch',
      'wls': 'wf-wls',
      'ty': 'pf-ty',
      
      // Other languages
      'jv': 'id-id',
      'su': 'id-id',
      'mad': 'id-id',
      'min': 'id-id',
      'ace': 'id-id',
      'bjn': 'id-id',
      'ban': 'id-id',
      'bug': 'id-id'
    };
    return langMap[lc] || null;
  }
  
  return null; // No specific region, use default
}

/**
 * Builds DuckDuckGo search URL with parameters
 * @param query - Search query
 * @param options - Search options
 * @returns Complete DuckDuckGo search URL
 */
export function buildDuckDuckGoUrl(query: string, options: DuckDuckGoSearchOptions = {}): string {
  const baseUrl = 'https://duckduckgo.com/';
  const params = new URLSearchParams();
  
  // Add query
  params.set('q', query);
  
  // Add mapped parameters
  const ddgParams = mapFirecrawlToDuckDuckGoParams(options);
  Object.entries(ddgParams).forEach(([key, value]) => {
    params.set(key, value);
  });
  
  return `${baseUrl}?${params.toString()}`;
}