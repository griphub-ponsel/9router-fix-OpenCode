class ResponseCookies {
  constructor(headers) {
    this.headers = headers;
  }

  set(name, value, options = {}) {
    const attributeNames = { httpOnly: 'HttpOnly', sameSite: 'SameSite', maxAge: 'Max-Age', secure: 'Secure', path: 'Path', domain: 'Domain' };
    const attributes = Object.entries(options).flatMap(([key, optionValue]) => {
      if (optionValue === false || optionValue == null) return [];
      const attribute = attributeNames[key] || key;
      if (optionValue === true) return [attribute];
      if (key === 'expires') return [`Expires=${new Date(optionValue).toUTCString()}`];
      return [`${attribute}=${optionValue}`];
    });
    this.headers.append('set-cookie', [name, encodeURIComponent(value), ...attributes].join('; '));
  }

  get(name) {
    const cookie = this.headers.getSetCookie?.().find((value) => value.startsWith(`${name}=`));
    if (!cookie) return undefined;
    return { name, value: decodeURIComponent(cookie.slice(name.length + 1).split(';', 1)[0]) };
  }

  delete(name, options) {
    this.set(name, '', { ...options, maxAge: 0 });
  }
}

export class NextResponse extends Response {
  constructor(body, init = {}) {
    super(body, init);
    this.cookies = new ResponseCookies(this.headers);
  }

  static json(body, init = {}) {
    const headers = new Headers(init.headers);
    if (!headers.has('content-type')) headers.set('content-type', 'application/json');
    return new NextResponse(JSON.stringify(body), { ...init, headers });
  }

  static redirect(url, init = 307) {
    const status = typeof init === 'number' ? init : init.status ?? 307;
    const headers = new Headers(typeof init === 'number' ? undefined : init.headers);
    headers.set('location', String(url));
    return new NextResponse(null, { ...(typeof init === 'number' ? {} : init), status, headers });
  }

  static rewrite(url, init = {}) {
    const headers = new Headers(init.headers);
    headers.set('x-middleware-rewrite', String(url));
    return new NextResponse(null, { ...init, headers });
  }

  static next(init = {}) {
    const headers = new Headers(init.headers);
    headers.set('x-9router-continue', '1');
    return new NextResponse(null, { ...init, headers });
  }
}

export class NextRequest extends Request {
  constructor(input, init) {
    super(input, init);
    this.nextUrl = new URL(this.url);
    const values = new Map((this.headers.get('cookie') || '').split(';').map((item) => item.trim()).filter((item) => item.includes('=')).map((item) => {
      const separator = item.indexOf('=');
      const rawValue = item.slice(separator + 1);
      try {
        return [item.slice(0, separator), decodeURIComponent(rawValue)];
      } catch {
        return [item.slice(0, separator), rawValue];
      }
    }));
    this.cookies = {
      get: (name) => values.has(name) ? { name, value: values.get(name) } : undefined,
      getAll: (name) => name ? [this.cookies.get(name)].filter(Boolean) : [...values].map(([key, value]) => ({ name: key, value })),
      has: (name) => values.has(name),
    };
  }
}

export const NextFetchEvent = class NextFetchEvent {};
