// Request metadata describes a network/device observation, never an identity.
// Missing or reduced browser data stays unknown; client hints are not trusted for auth.
const cleanLabel = (value, limit = 100) => typeof value === 'string'
  ? value.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, limit) || null : null;
const versionLabel = value => typeof value === 'string' && /^\d+(?:[._]\d+){0,3}$/.test(value) ? value.replaceAll('_', '.').slice(0, 40) : null;

export function validClientHint(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const limits = { model: 100, platform: 40, platformVersion: 40 };
  return Object.entries(value).every(([key, field]) => key === 'mobile'
    ? typeof field === 'boolean'
    : Object.hasOwn(limits, key) && typeof field === 'string' && field.length <= limits[key] && !/[\u0000-\u001f\u007f]/.test(field));
}

function ipAddress(value) {
  if (typeof value !== 'string' || value.length > 45 || value.trim() !== value) return null;
  if (/^\d{1,3}(?:\.\d{1,3}){3}$/.test(value)) {
    const parts = value.split('.');
    return parts.every(part => Number(part) <= 255 && (part === '0' || !part.startsWith('0'))) ? value : null;
  }
  if (!value.includes(':') || !/^[\da-f:.]+$/i.test(value)) return null;
  try {
    const normalized = new URL(`https://[${value}]/`).hostname.slice(1, -1).toLowerCase();
    // Cloudflare uses this shared address for some Worker subrequests.
    return normalized === '2a06:98c0:3600::103' ? null : normalized;
  } catch { return null; }
}

function headerHint(request, name) {
  const value = request.headers.get(name);
  if (!value || !/^"[^"\r\n]*"$/.test(value)) return null;
  return cleanLabel(value.slice(1, -1), 100);
}

export function visitorMetadata(request, hint = {}) {
  const ua = cleanLabel(request.headers.get('user-agent'), 1200) || '';
  const modelHint = cleanLabel(hint.model || headerHint(request, 'sec-ch-ua-model'));
  const platform = cleanLabel(hint.platform || headerHint(request, 'sec-ch-ua-platform'), 40);
  const platformVersion = versionLabel(hint.platformVersion || headerHint(request, 'sec-ch-ua-platform-version'));
  const mobile = typeof hint.mobile === 'boolean' ? hint.mobile : request.headers.get('sec-ch-ua-mobile') === '?1';
  let deviceType = 'unknown', deviceModel = null, osFamily = null, osVersion = null;
  const ios = ua.match(/(?:CPU (?:iPhone )?OS|iPhone OS) ([\d_]+)/i);
  const android = ua.match(/Android\s+([\d.]+)/i);
  if (/iPad/i.test(ua)) { deviceType = 'tablet'; deviceModel = 'iPad'; osFamily = 'iPadOS / iOS'; osVersion = versionLabel(ios?.[1]); }
  else if (/iPhone|iPod/i.test(ua)) { deviceType = 'smartphone'; deviceModel = /iPod/i.test(ua) ? 'iPod' : 'iPhone'; osFamily = 'iOS'; osVersion = versionLabel(ios?.[1]); }
  else if (android || platform === 'Android') {
    osFamily = 'Android';
    osVersion = platformVersion || (/Android 10; K(?:[;)])/i.test(ua) ? null : versionLabel(android?.[1]));
    deviceType = /Mobile/i.test(ua) || mobile ? 'smartphone' : /Android/i.test(ua) ? 'tablet' : 'unknown';
    const uaModel = ua.match(/Android\s+[\d.]+;\s*(?:[a-z]{2}[-_][A-Z]{2};\s*)?([^;)]+?)(?:\s+Build\/|[;)])/i)?.[1];
    const model = modelHint || cleanLabel(uaModel);
    deviceModel = model && !/^(?:K|wv|Android)$/i.test(model) ? model : null;
  } else if (/Windows NT/i.test(ua) || platform === 'Windows') {
    deviceType = 'desktop'; osFamily = 'Windows';
    // NT 10.0 is shared by Windows 10 and 11. Do not infer a precise edition.
    const ntVersion = versionLabel(ua.match(/Windows NT\s+([\d.]+)/i)?.[1]);
    osVersion = platformVersion ? `申告 ${platformVersion}` : ntVersion ? `NT ${ntVersion}` : null;
  } else if (/CrOS/i.test(ua) || platform === 'Chrome OS') {
    deviceType = 'desktop'; osFamily = 'Chrome OS'; osVersion = platformVersion || versionLabel(ua.match(/CrOS\s+\S+\s+([\d.]+)/i)?.[1]);
  } else if (/Macintosh|Mac OS X/i.test(ua) || platform === 'macOS') {
    deviceType = 'desktop'; osFamily = 'macOS'; osVersion = platformVersion || versionLabel(ua.match(/Mac OS X\s+([\d_]+)/i)?.[1]);
  } else if (/Linux/i.test(ua) || platform === 'Linux') { deviceType = 'desktop'; osFamily = 'Linux'; }
  if (!deviceModel && modelHint && !/^(?:K|wv)$/i.test(modelHint)) deviceModel = modelHint;
  let browserFamily = null, browserVersion = null;
  for (const [family, pattern] of [
    ['Edge', /(?:Edg|EdgA|EdgiOS)\/([\d.]+)/i], ['Opera', /(?:OPR|OPT)\/([\d.]+)/i],
    ['Samsung Internet', /SamsungBrowser\/([\d.]+)/i], ['Firefox', /(?:Firefox|FxiOS)\/([\d.]+)/i],
    ['Chrome', /(?:Chrome|CriOS)\/([\d.]+)/i], ['Safari', /Version\/([\d.]+).*Safari\//i],
  ]) { const match = ua.match(pattern); if (match) { browserFamily = family; browserVersion = versionLabel(match[1]); break; } }
  // Reduced UA versions expose only the major component accurately.
  if (browserVersion && /^\d+\.0\.0\.0$/.test(browserVersion)) browserVersion = browserVersion.split('.')[0];
  const cf = request.cf && typeof request.cf === 'object' ? request.cf : {};
  const countryValue = cleanLabel(cf.country, 40) || cleanLabel(request.headers.get('cf-ipcountry'), 40);
  const country = countryValue && /^[A-Z]{2}$/.test(countryValue.toUpperCase()) && countryValue.toUpperCase() !== 'XX' ? countryValue.toUpperCase() : null;
  return {
    ipAddress: ipAddress(request.headers.get('cf-connecting-ip')),
    country, region: cleanLabel(cf.region), city: cleanLabel(cf.city),
    deviceType, deviceModel, osFamily, osVersion, browserFamily, browserVersion,
  };
}
