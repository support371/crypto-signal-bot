// node_modules/hono/dist/compose.js
var compose = (middleware, onError, onNotFound) => {
  return (context, next) => {
    let index = -1;
    return dispatch(0);
    async function dispatch(i) {
      if (i <= index) {
        throw new Error("next() called multiple times");
      }
      index = i;
      let res;
      let isError = false;
      let handler;
      if (middleware[i]) {
        handler = middleware[i][0][0];
        context.req.routeIndex = i;
      } else {
        handler = i === middleware.length && next || void 0;
      }
      if (handler) {
        try {
          res = await handler(context, () => dispatch(i + 1));
        } catch (err) {
          if (err instanceof Error && onError) {
            context.error = err;
            res = await onError(err, context);
            isError = true;
          } else {
            throw err;
          }
        }
      } else {
        if (context.finalized === false && onNotFound) {
          res = await onNotFound(context);
        }
      }
      if (res && (context.finalized === false || isError)) {
        context.res = res;
      }
      return context;
    }
  };
};

// node_modules/hono/dist/request/constants.js
var GET_MATCH_RESULT = /* @__PURE__ */ Symbol();

// node_modules/hono/dist/utils/buffer.js
var bufferToFormData = (arrayBuffer, contentType) => {
  const response = new Response(arrayBuffer, {
    headers: {
      // Normalize the media type (case-insensitive) while keeping parameters like the boundary
      "Content-Type": contentType.replace(/^[^;]+/, (mediaType) => mediaType.toLowerCase())
    }
  });
  return response.formData();
};

// node_modules/hono/dist/utils/body.js
var isRawRequest = (request) => "headers" in request;
var parseBody = async (request, options = /* @__PURE__ */ Object.create(null)) => {
  const { all = false, dot = false } = options;
  const headers = isRawRequest(request) ? request.headers : request.raw.headers;
  const contentType = headers.get("Content-Type");
  const mediaType = contentType?.split(";")[0].trim().toLowerCase();
  if (mediaType === "multipart/form-data" || mediaType === "application/x-www-form-urlencoded") {
    return parseFormData(request, { all, dot });
  }
  return {};
};
async function parseFormData(request, options) {
  if (!isRawRequest(request) && request.bodyCache.formData) {
    return convertFormDataToBodyData(
      await request.bodyCache.formData,
      options
    );
  }
  const headers = isRawRequest(request) ? request.headers : request.raw.headers;
  const arrayBuffer = await request.arrayBuffer();
  const formDataPromise = bufferToFormData(arrayBuffer, headers.get("Content-Type") || "");
  if (!isRawRequest(request)) {
    request.bodyCache.formData = formDataPromise;
  }
  const formData = await formDataPromise;
  if (formData) {
    return convertFormDataToBodyData(formData, options);
  }
  return {};
}
function convertFormDataToBodyData(formData, options) {
  const form = /* @__PURE__ */ Object.create(null);
  formData.forEach((value, key) => {
    const shouldParseAllValues = options.all || key.endsWith("[]");
    if (!shouldParseAllValues) {
      form[key] = value;
    } else {
      handleParsingAllValues(form, key, value);
    }
  });
  if (options.dot) {
    Object.entries(form).forEach(([key, value]) => {
      const shouldParseDotValues = key.includes(".");
      if (shouldParseDotValues) {
        handleParsingNestedValues(form, key, value);
        delete form[key];
      }
    });
  }
  return form;
}
var handleParsingAllValues = (form, key, value) => {
  if (form[key] !== void 0) {
    if (Array.isArray(form[key])) {
      ;
      form[key].push(value);
    } else {
      form[key] = [form[key], value];
    }
  } else {
    if (!key.endsWith("[]")) {
      form[key] = value;
    } else {
      form[key] = [value];
    }
  }
};
var handleParsingNestedValues = (form, key, value) => {
  if (/(?:^|\.)__proto__\./.test(key)) {
    return;
  }
  let nestedForm = form;
  const keys = key.split(".");
  keys.forEach((key2, index) => {
    if (index === keys.length - 1) {
      nestedForm[key2] = value;
    } else {
      if (!nestedForm[key2] || typeof nestedForm[key2] !== "object" || Array.isArray(nestedForm[key2]) || nestedForm[key2] instanceof File) {
        nestedForm[key2] = /* @__PURE__ */ Object.create(null);
      }
      nestedForm = nestedForm[key2];
    }
  });
};

// node_modules/hono/dist/utils/url.js
var splitPath = (path) => {
  const paths = path.split("/");
  if (paths[0] === "") {
    paths.shift();
  }
  return paths;
};
var splitRoutingPath = (routePath) => {
  const { groups, path } = extractGroupsFromPath(routePath);
  const paths = splitPath(path);
  return replaceGroupMarks(paths, groups);
};
var extractGroupsFromPath = (path) => {
  const groups = [];
  path = path.replace(/\{[^}]+\}/g, (match2, index) => {
    const mark = `@${index}`;
    groups.push([mark, match2]);
    return mark;
  });
  return { groups, path };
};
var replaceGroupMarks = (paths, groups) => {
  for (let i = groups.length - 1; i >= 0; i--) {
    const [mark] = groups[i];
    for (let j = paths.length - 1; j >= 0; j--) {
      if (paths[j].includes(mark)) {
        paths[j] = paths[j].replace(mark, groups[i][1]);
        break;
      }
    }
  }
  return paths;
};
var patternCache = {};
var getPattern = (label, next) => {
  if (label === "*") {
    return "*";
  }
  const match2 = label.match(/^\:([^\{\}]+)(?:\{(.+)\})?$/);
  if (match2) {
    const cacheKey = `${label}#${next}`;
    if (!patternCache[cacheKey]) {
      if (match2[2]) {
        patternCache[cacheKey] = next && next[0] !== ":" && next[0] !== "*" ? [cacheKey, match2[1], new RegExp(`^${match2[2]}(?=/${next})`)] : [label, match2[1], new RegExp(`^${match2[2]}$`)];
      } else {
        patternCache[cacheKey] = [label, match2[1], true];
      }
    }
    return patternCache[cacheKey];
  }
  return null;
};
var tryDecode = (str, decoder) => {
  try {
    return decoder(str);
  } catch {
    return str.replace(/(?:%[0-9A-Fa-f]{2})+/g, (match2) => {
      try {
        return decoder(match2);
      } catch {
        return match2;
      }
    });
  }
};
var tryDecodeURI = (str) => tryDecode(str, decodeURI);
var getPath = (request) => {
  const url = request.url;
  const start = url.indexOf("/", url.indexOf(":") + 4);
  let i = start;
  for (; i < url.length; i++) {
    const charCode = url.charCodeAt(i);
    if (charCode === 37) {
      const queryIndex = url.indexOf("?", i);
      const hashIndex = url.indexOf("#", i);
      const end = queryIndex === -1 ? hashIndex === -1 ? void 0 : hashIndex : hashIndex === -1 ? queryIndex : Math.min(queryIndex, hashIndex);
      const path = url.slice(start, end);
      return tryDecodeURI(path.includes("%25") ? path.replace(/%25/g, "%2525") : path);
    } else if (charCode === 63 || charCode === 35) {
      break;
    }
  }
  return url.slice(start, i);
};
var getPathNoStrict = (request) => {
  const result = getPath(request);
  return result.length > 1 && result.at(-1) === "/" ? result.slice(0, -1) : result;
};
var mergePath = (base, sub, ...rest) => {
  if (rest.length) {
    sub = mergePath(sub, ...rest);
  }
  return `${base?.[0] === "/" ? "" : "/"}${base}${sub === "/" ? "" : `${base?.at(-1) === "/" ? "" : "/"}${sub?.[0] === "/" ? sub.slice(1) : sub}`}`;
};
var checkOptionalParameter = (path) => {
  if (path.charCodeAt(path.length - 1) !== 63 || !path.includes(":")) {
    return null;
  }
  const segments = path.split("/");
  const results = [];
  let basePath = "";
  segments.forEach((segment) => {
    if (segment !== "" && !/\:/.test(segment)) {
      basePath += "/" + segment;
    } else if (/\:/.test(segment)) {
      if (segment.charCodeAt(segment.length - 1) === 63) {
        if (results.length === 0 && basePath === "") {
          results.push("/");
        } else {
          results.push(basePath);
        }
        const optionalSegment = segment.slice(0, -1);
        basePath += "/" + optionalSegment;
        results.push(basePath);
      } else {
        basePath += "/" + segment;
      }
    }
  });
  return results.filter((v, i, a) => a.indexOf(v) === i);
};
var tryDecodeURIComponent = (str) => str.indexOf("%") !== -1 ? tryDecode(str, decodeURIComponent_) : str;
var _decodeURI = (value) => {
  if (value.indexOf("+") !== -1) {
    value = value.replace(/\+/g, " ");
  }
  return tryDecodeURIComponent(value);
};
var _getQueryParam = (url, key, multiple) => {
  let encoded;
  if (!multiple && key && key.indexOf("%") === -1 && key.indexOf("+") === -1) {
    let keyIndex2 = url.indexOf("?", 8);
    if (keyIndex2 === -1) {
      return void 0;
    }
    if (!url.startsWith(key, keyIndex2 + 1)) {
      keyIndex2 = url.indexOf(`&${key}`, keyIndex2 + 1);
    }
    while (keyIndex2 !== -1) {
      const trailingKeyCode = url.charCodeAt(keyIndex2 + key.length + 1);
      if (trailingKeyCode === 61) {
        const valueIndex = keyIndex2 + key.length + 2;
        const endIndex = url.indexOf("&", valueIndex);
        return _decodeURI(url.slice(valueIndex, endIndex === -1 ? void 0 : endIndex));
      } else if (trailingKeyCode == 38 || isNaN(trailingKeyCode)) {
        return "";
      }
      keyIndex2 = url.indexOf(`&${key}`, keyIndex2 + 1);
    }
    encoded = /[%+]/.test(url);
    if (!encoded) {
      return void 0;
    }
  }
  const results = /* @__PURE__ */ Object.create(null);
  encoded ??= /[%+]/.test(url);
  let keyIndex = url.indexOf("?", 8);
  while (keyIndex !== -1) {
    const nextKeyIndex = url.indexOf("&", keyIndex + 1);
    let valueIndex = url.indexOf("=", keyIndex);
    if (valueIndex > nextKeyIndex && nextKeyIndex !== -1) {
      valueIndex = -1;
    }
    let name = url.slice(
      keyIndex + 1,
      valueIndex === -1 ? nextKeyIndex === -1 ? void 0 : nextKeyIndex : valueIndex
    );
    if (encoded) {
      name = _decodeURI(name);
    }
    keyIndex = nextKeyIndex;
    if (name === "") {
      continue;
    }
    let value;
    if (valueIndex === -1) {
      value = "";
    } else {
      value = url.slice(valueIndex + 1, nextKeyIndex === -1 ? void 0 : nextKeyIndex);
      if (encoded) {
        value = _decodeURI(value);
      }
    }
    if (multiple) {
      if (!(results[name] && Array.isArray(results[name]))) {
        results[name] = [];
      }
      ;
      results[name].push(value);
    } else {
      results[name] ??= value;
    }
  }
  return key ? results[key] : results;
};
var getQueryParam = _getQueryParam;
var getQueryParams = (url, key) => {
  return _getQueryParam(url, key, true);
};
var decodeURIComponent_ = decodeURIComponent;

// node_modules/hono/dist/request.js
var HonoRequest = class {
  /**
   * `.raw` can get the raw Request object.
   *
   * @see {@link https://hono.dev/docs/api/request#raw}
   *
   * @example
   * ```ts
   * // For Cloudflare Workers
   * app.post('/', async (c) => {
   *   const metadata = c.req.raw.cf?.hostMetadata?
   *   ...
   * })
   * ```
   */
  raw;
  #validatedData;
  // Short name of validatedData
  #matchResult;
  routeIndex = 0;
  /**
   * `.path` can get the pathname of the request.
   *
   * @see {@link https://hono.dev/docs/api/request#path}
   *
   * @example
   * ```ts
   * app.get('/about/me', (c) => {
   *   const pathname = c.req.path // `/about/me`
   * })
   * ```
   */
  path;
  bodyCache = {};
  constructor(request, path = "/", matchResult = [[]]) {
    this.raw = request;
    this.path = path;
    this.#matchResult = matchResult;
  }
  param(key) {
    return key ? this.#getDecodedParam(key) : this.#getAllDecodedParams();
  }
  #getDecodedParam(key) {
    const paramKey = this.#matchResult[0][this.routeIndex][1][key];
    const param = this.#getParamValue(paramKey);
    return param && tryDecodeURIComponent(param);
  }
  #getAllDecodedParams() {
    const decoded = {};
    const keys = Object.keys(this.#matchResult[0][this.routeIndex][1]);
    for (const key of keys) {
      const value = this.#getParamValue(this.#matchResult[0][this.routeIndex][1][key]);
      if (value !== void 0) {
        decoded[key] = tryDecodeURIComponent(value);
      }
    }
    return decoded;
  }
  #getParamValue(paramKey) {
    return this.#matchResult[1] ? this.#matchResult[1][paramKey] : paramKey;
  }
  query(key) {
    return getQueryParam(this.url, key);
  }
  queries(key) {
    return getQueryParams(this.url, key);
  }
  header(name) {
    if (name) {
      return this.raw.headers.get(name) ?? void 0;
    }
    const headerData = /* @__PURE__ */ Object.create(null);
    this.raw.headers.forEach((value, key) => {
      headerData[key] = value;
    });
    return headerData;
  }
  async parseBody(options) {
    return parseBody(this, options);
  }
  #cachedBody = (key) => {
    const { bodyCache, raw: raw2 } = this;
    const cachedBody = bodyCache[key];
    if (cachedBody) {
      return cachedBody;
    }
    for (const anyCachedKey in bodyCache) {
      return bodyCache[anyCachedKey].then((body) => {
        if (anyCachedKey === "json") {
          body = JSON.stringify(body);
        }
        return new Response(body)[key]();
      });
    }
    return bodyCache[key] = raw2[key]();
  };
  /**
   * `.json()` can parse Request body of type `application/json`
   *
   * @see {@link https://hono.dev/docs/api/request#json}
   *
   * @example
   * ```ts
   * app.post('/entry', async (c) => {
   *   const body = await c.req.json()
   * })
   * ```
   */
  json() {
    return this.#cachedBody("text").then((text) => JSON.parse(text));
  }
  /**
   * `.text()` can parse Request body of type `text/plain`
   *
   * @see {@link https://hono.dev/docs/api/request#text}
   *
   * @example
   * ```ts
   * app.post('/entry', async (c) => {
   *   const body = await c.req.text()
   * })
   * ```
   */
  text() {
    return this.#cachedBody("text");
  }
  /**
   * `.arrayBuffer()` parse Request body as an `ArrayBuffer`
   *
   * @see {@link https://hono.dev/docs/api/request#arraybuffer}
   *
   * @example
   * ```ts
   * app.post('/entry', async (c) => {
   *   const body = await c.req.arrayBuffer()
   * })
   * ```
   */
  arrayBuffer() {
    return this.#cachedBody("arrayBuffer");
  }
  /**
   * `.bytes()` parses the request body as a `Uint8Array`.
   *
   * @see {@link https://hono.dev/docs/api/request#bytes}
   *
   * @example
   * ```ts
   * app.post('/entry', async (c) => {
   *   const body = await c.req.bytes()
   * })
   * ```
   */
  bytes() {
    return this.#cachedBody("arrayBuffer").then((buffer) => new Uint8Array(buffer));
  }
  /**
   * Parses the request body as a `Blob`.
   * @example
   * ```ts
   * app.post('/entry', async (c) => {
   *   const body = await c.req.blob();
   * });
   * ```
   * @see https://hono.dev/docs/api/request#blob
   */
  blob() {
    return this.#cachedBody("blob");
  }
  /**
   * Parses the request body as `FormData`.
   * @example
   * ```ts
   * app.post('/entry', async (c) => {
   *   const body = await c.req.formData();
   * });
   * ```
   * @see https://hono.dev/docs/api/request#formdata
   */
  formData() {
    return this.#cachedBody("formData");
  }
  /**
   * Adds validated data to the request.
   *
   * @param target - The target of the validation.
   * @param data - The validated data to add.
   */
  addValidatedData(target, data) {
    ;
    (this.#validatedData ??= {})[target] = data;
  }
  valid(target) {
    return this.#validatedData?.[target];
  }
  /**
   * `.url()` can get the request url strings.
   *
   * @see {@link https://hono.dev/docs/api/request#url}
   *
   * @example
   * ```ts
   * app.get('/about/me', (c) => {
   *   const url = c.req.url // `http://localhost:8787/about/me`
   *   ...
   * })
   * ```
   */
  get url() {
    return this.raw.url;
  }
  /**
   * `.method()` can get the method name of the request.
   *
   * @see {@link https://hono.dev/docs/api/request#method}
   *
   * @example
   * ```ts
   * app.get('/about/me', (c) => {
   *   const method = c.req.method // `GET`
   * })
   * ```
   */
  get method() {
    return this.raw.method;
  }
  get [GET_MATCH_RESULT]() {
    return this.#matchResult;
  }
  /**
   * `.matchedRoutes()` can return a matched route in the handler
   *
   * @deprecated
   *
   * Use matchedRoutes helper defined in "hono/route" instead.
   *
   * @see {@link https://hono.dev/docs/api/request#matchedroutes}
   *
   * @example
   * ```ts
   * app.use('*', async function logger(c, next) {
   *   await next()
   *   c.req.matchedRoutes.forEach(({ handler, method, path }, i) => {
   *     const name = handler.name || (handler.length < 2 ? '[handler]' : '[middleware]')
   *     console.log(
   *       method,
   *       ' ',
   *       path,
   *       ' '.repeat(Math.max(10 - path.length, 0)),
   *       name,
   *       i === c.req.routeIndex ? '<- respond from here' : ''
   *     )
   *   })
   * })
   * ```
   */
  get matchedRoutes() {
    return this.#matchResult[0].map(([[, route]]) => route);
  }
  /**
   * `routePath()` can retrieve the path registered within the handler
   *
   * @deprecated
   *
   * Use routePath helper defined in "hono/route" instead.
   *
   * @see {@link https://hono.dev/docs/api/request#routepath}
   *
   * @example
   * ```ts
   * app.get('/posts/:id', (c) => {
   *   return c.json({ path: c.req.routePath })
   * })
   * ```
   */
  get routePath() {
    return this.#matchResult[0].map(([[, route]]) => route)[this.routeIndex].path;
  }
};

// node_modules/hono/dist/utils/html.js
var HtmlEscapedCallbackPhase = {
  Stringify: 1,
  BeforeStream: 2,
  Stream: 3
};
var raw = (value, callbacks) => {
  const escapedString = new String(value);
  escapedString.isEscaped = true;
  escapedString.callbacks = callbacks;
  return escapedString;
};
var resolveCallback = async (str, phase, preserveCallbacks, context, buffer) => {
  if (typeof str === "object" && !(str instanceof String)) {
    if (!(str instanceof Promise)) {
      str = str.toString();
    }
    if (str instanceof Promise) {
      str = await str;
    }
  }
  const callbacks = str.callbacks;
  if (!callbacks?.length) {
    return Promise.resolve(str);
  }
  if (buffer) {
    buffer[0] += str;
  } else {
    buffer = [str];
  }
  const resStr = Promise.all(callbacks.map((c) => c({ phase, buffer, context }))).then(
    (res) => Promise.all(
      res.filter(Boolean).map((str2) => resolveCallback(str2, phase, false, context, buffer))
    ).then(() => buffer[0])
  );
  if (preserveCallbacks) {
    return raw(await resStr, callbacks);
  } else {
    return resStr;
  }
};

// node_modules/hono/dist/context.js
var TEXT_PLAIN = "text/plain; charset=UTF-8";
var setDefaultContentType = (contentType, headers) => {
  return {
    "Content-Type": contentType,
    ...headers
  };
};
var createResponseInstance = (body, init) => new Response(body, init);
var Context = class {
  #rawRequest;
  #req;
  /**
   * `.env` can get bindings (environment variables, secrets, KV namespaces, D1 database, R2 bucket etc.) in Cloudflare Workers.
   *
   * @see {@link https://hono.dev/docs/api/context#env}
   *
   * @example
   * ```ts
   * // Environment object for Cloudflare Workers
   * app.get('*', async c => {
   *   const counter = c.env.COUNTER
   * })
   * ```
   */
  env = {};
  #var;
  finalized = false;
  /**
   * `.error` can get the error object from the middleware if the Handler throws an error.
   *
   * @see {@link https://hono.dev/docs/api/context#error}
   *
   * @example
   * ```ts
   * app.use('*', async (c, next) => {
   *   await next()
   *   if (c.error) {
   *     // do something...
   *   }
   * })
   * ```
   */
  error;
  #status;
  #executionCtx;
  #res;
  #layout;
  #renderer;
  #notFoundHandler;
  #preparedHeaders;
  #matchResult;
  #path;
  /**
   * Creates an instance of the Context class.
   *
   * @param req - The Request object.
   * @param options - Optional configuration options for the context.
   */
  constructor(req, options) {
    this.#rawRequest = req;
    if (options) {
      this.#executionCtx = options.executionCtx;
      this.env = options.env;
      this.#notFoundHandler = options.notFoundHandler;
      this.#path = options.path;
      this.#matchResult = options.matchResult;
    }
  }
  /**
   * `.req` is the instance of {@link HonoRequest}.
   */
  get req() {
    this.#req ??= new HonoRequest(this.#rawRequest, this.#path, this.#matchResult);
    return this.#req;
  }
  /**
   * @see {@link https://hono.dev/docs/api/context#event}
   * The FetchEvent associated with the current request.
   *
   * @throws Will throw an error if the context does not have a FetchEvent.
   */
  get event() {
    if (this.#executionCtx && "respondWith" in this.#executionCtx) {
      return this.#executionCtx;
    } else {
      throw Error("This context has no FetchEvent");
    }
  }
  /**
   * @see {@link https://hono.dev/docs/api/context#executionctx}
   * The ExecutionContext associated with the current request.
   *
   * @throws Will throw an error if the context does not have an ExecutionContext.
   */
  get executionCtx() {
    if (this.#executionCtx) {
      return this.#executionCtx;
    } else {
      throw Error("This context has no ExecutionContext");
    }
  }
  /**
   * @see {@link https://hono.dev/docs/api/context#res}
   * The Response object for the current request.
   */
  get res() {
    return this.#res ||= createResponseInstance(null, {
      headers: this.#preparedHeaders ??= new Headers()
    });
  }
  /**
   * Sets the Response object for the current request.
   *
   * @param _res - The Response object to set.
   */
  set res(_res) {
    if (this.#res && _res) {
      _res = createResponseInstance(_res.body, _res);
      for (const [k, v] of this.#res.headers.entries()) {
        if (k === "content-type") {
          continue;
        }
        if (k === "set-cookie") {
          const cookies = this.#res.headers.getSetCookie();
          _res.headers.delete("set-cookie");
          for (const cookie of cookies) {
            _res.headers.append("set-cookie", cookie);
          }
        } else {
          _res.headers.set(k, v);
        }
      }
    }
    this.#res = _res;
    this.finalized = true;
  }
  /**
   * `.render()` can create a response within a layout.
   *
   * @see {@link https://hono.dev/docs/api/context#render-setrenderer}
   *
   * @example
   * ```ts
   * app.get('/', (c) => {
   *   return c.render('Hello!')
   * })
   * ```
   */
  render = (...args) => {
    this.#renderer ??= (content) => this.html(content);
    return this.#renderer(...args);
  };
  /**
   * Sets the layout for the response.
   *
   * @param layout - The layout to set.
   * @returns The layout function.
   */
  setLayout = (layout) => this.#layout = layout;
  /**
   * Gets the current layout for the response.
   *
   * @returns The current layout function.
   */
  getLayout = () => this.#layout;
  /**
   * `.setRenderer()` can set the layout in the custom middleware.
   *
   * @see {@link https://hono.dev/docs/api/context#render-setrenderer}
   *
   * @example
   * ```tsx
   * app.use('*', async (c, next) => {
   *   c.setRenderer((content) => {
   *     return c.html(
   *       <html>
   *         <body>
   *           <p>{content}</p>
   *         </body>
   *       </html>
   *     )
   *   })
   *   await next()
   * })
   * ```
   */
  setRenderer = (renderer) => {
    this.#renderer = renderer;
  };
  /**
   * `.header()` can set headers.
   *
   * @see {@link https://hono.dev/docs/api/context#header}
   *
   * @example
   * ```ts
   * app.get('/welcome', (c) => {
   *   // Set headers
   *   c.header('X-Message', 'Hello!')
   *   c.header('Content-Type', 'text/plain')
   *
   *   return c.body('Thank you for coming')
   * })
   * ```
   */
  header = (name, value, options) => {
    if (this.finalized) {
      this.#res = createResponseInstance(this.#res.body, this.#res);
    }
    const headers = this.#res ? this.#res.headers : this.#preparedHeaders ??= new Headers();
    if (value === void 0) {
      headers.delete(name);
    } else if (options?.append) {
      headers.append(name, value);
    } else {
      headers.set(name, value);
    }
  };
  status = (status) => {
    this.#status = status;
  };
  /**
   * `.set()` can set the value specified by the key.
   *
   * @see {@link https://hono.dev/docs/api/context#set-get}
   *
   * @example
   * ```ts
   * app.use('*', async (c, next) => {
   *   c.set('message', 'Hono is hot!!')
   *   await next()
   * })
   * ```
   */
  set = (key, value) => {
    this.#var ??= /* @__PURE__ */ new Map();
    this.#var.set(key, value);
  };
  /**
   * `.get()` can use the value specified by the key.
   *
   * @see {@link https://hono.dev/docs/api/context#set-get}
   *
   * @example
   * ```ts
   * app.get('/', (c) => {
   *   const message = c.get('message')
   *   return c.text(`The message is "${message}"`)
   * })
   * ```
   */
  get = (key) => {
    return this.#var ? this.#var.get(key) : void 0;
  };
  /**
   * `.var` can access the value of a variable.
   *
   * @see {@link https://hono.dev/docs/api/context#var}
   *
   * @example
   * ```ts
   * const result = c.var.client.oneMethod()
   * ```
   */
  // c.var.propName is a read-only
  get var() {
    if (!this.#var) {
      return {};
    }
    return Object.fromEntries(this.#var);
  }
  #newResponse(data, arg, headers) {
    let responseHeaders = this.#res ? new Headers(this.#res.headers) : this.#preparedHeaders;
    if (typeof arg === "object" && arg.headers) {
      responseHeaders ??= new Headers();
      for (const [key, value] of new Headers(arg.headers)) {
        if (key === "set-cookie") {
          responseHeaders.append(key, value);
        } else {
          responseHeaders.set(key, value);
        }
      }
    }
    if (headers) {
      if (!responseHeaders) {
        let count = 0;
        for (const k in headers) {
          if (++count > 1 || typeof headers[k] !== "string") {
            responseHeaders = new Headers();
            break;
          }
        }
      }
      if (responseHeaders) {
        for (const k in headers) {
          const v = headers[k];
          if (typeof v === "string") {
            responseHeaders.set(k, v);
          } else {
            responseHeaders.delete(k);
            for (const v2 of v) {
              responseHeaders.append(k, v2);
            }
          }
        }
      }
    }
    const status = typeof arg === "number" ? arg : arg?.status ?? this.#status;
    return createResponseInstance(data, {
      status,
      headers: responseHeaders ?? headers
    });
  }
  newResponse = (...args) => this.#newResponse(...args);
  /**
   * `.body()` can return the HTTP response.
   * You can set headers with `.header()` and set HTTP status code with `.status`.
   * This can also be set in `.text()`, `.json()` and so on.
   *
   * @see {@link https://hono.dev/docs/api/context#body}
   *
   * @example
   * ```ts
   * app.get('/welcome', (c) => {
   *   // Set headers
   *   c.header('X-Message', 'Hello!')
   *   c.header('Content-Type', 'text/plain')
   *   // Set HTTP status code
   *   c.status(201)
   *
   *   // Return the response body
   *   return c.body('Thank you for coming')
   * })
   * ```
   */
  body = (data, arg, headers) => this.#newResponse(data, arg, headers);
  /**
   * `.text()` can render text as `Content-Type:text/plain`.
   *
   * @see {@link https://hono.dev/docs/api/context#text}
   *
   * @example
   * ```ts
   * app.get('/say', (c) => {
   *   return c.text('Hello!')
   * })
   * ```
   */
  text = (text, arg, headers) => {
    return !this.#preparedHeaders && !this.#status && !arg && !headers && !this.finalized ? new Response(text) : this.#newResponse(
      text,
      arg,
      setDefaultContentType(TEXT_PLAIN, headers)
    );
  };
  /**
   * `.json()` can render JSON as `Content-Type:application/json`.
   *
   * @see {@link https://hono.dev/docs/api/context#json}
   *
   * @example
   * ```ts
   * app.get('/api', (c) => {
   *   return c.json({ message: 'Hello!' })
   * })
   * ```
   */
  json = (object, arg, headers) => {
    return this.#newResponse(
      JSON.stringify(object),
      arg,
      setDefaultContentType("application/json", headers)
    );
  };
  html = (html, arg, headers) => {
    const res = (html2) => this.#newResponse(html2, arg, setDefaultContentType("text/html; charset=UTF-8", headers));
    return typeof html === "object" ? resolveCallback(html, HtmlEscapedCallbackPhase.Stringify, false, {}).then(res) : res(html);
  };
  /**
   * `.redirect()` can Redirect, default status code is 302.
   *
   * @see {@link https://hono.dev/docs/api/context#redirect}
   *
   * @example
   * ```ts
   * app.get('/redirect', (c) => {
   *   return c.redirect('/')
   * })
   * app.get('/redirect-permanently', (c) => {
   *   return c.redirect('/', 301)
   * })
   * ```
   */
  redirect = (location, status) => {
    const locationString = String(location);
    this.header(
      "Location",
      // Multibyes should be encoded
      // eslint-disable-next-line no-control-regex
      !/[^\x00-\xFF]/.test(locationString) ? locationString : encodeURI(locationString)
    );
    return this.newResponse(null, status ?? 302);
  };
  /**
   * `.notFound()` can return the Not Found Response.
   *
   * @see {@link https://hono.dev/docs/api/context#notfound}
   *
   * @example
   * ```ts
   * app.get('/notfound', (c) => {
   *   return c.notFound()
   * })
   * ```
   */
  notFound = () => {
    this.#notFoundHandler ??= () => createResponseInstance();
    return this.#notFoundHandler(this);
  };
};

// node_modules/hono/dist/router.js
var METHOD_NAME_ALL = "ALL";
var METHOD_NAME_ALL_LOWERCASE = "all";
var METHODS = ["get", "post", "put", "delete", "options", "patch", "query"];
var MESSAGE_MATCHER_IS_ALREADY_BUILT = "Can not add a route since the matcher is already built.";
var UnsupportedPathError = class extends Error {
};

// node_modules/hono/dist/utils/constants.js
var COMPOSED_HANDLER = "__COMPOSED_HANDLER";

// node_modules/hono/dist/hono-base.js
var notFoundHandler = (c) => {
  return c.text("404 Not Found", 404);
};
var errorHandler = (err, c) => {
  if ("getResponse" in err) {
    const res = err.getResponse();
    return c.newResponse(res.body, res);
  }
  console.error(err);
  return c.text("Internal Server Error", 500);
};
var Hono = class _Hono {
  get;
  post;
  put;
  delete;
  options;
  patch;
  query;
  all;
  on;
  use;
  /*
    This class is like an abstract class and does not have a router.
    To use it, inherit the class and implement router in the constructor.
  */
  router;
  getPath;
  // Cannot use `#` because it requires visibility at JavaScript runtime.
  _basePath = "/";
  #path = "/";
  routes = [];
  constructor(options = {}) {
    const allMethods = [...METHODS, METHOD_NAME_ALL_LOWERCASE];
    allMethods.forEach((method) => {
      this[method] = (args1, ...args) => {
        if (typeof args1 === "string") {
          this.#path = args1;
        } else {
          this.#addRoute(method, this.#path, args1);
        }
        args.forEach((handler) => {
          this.#addRoute(method, this.#path, handler);
        });
        return this;
      };
    });
    this.on = (method, path, ...handlers) => {
      for (const p of [path].flat()) {
        this.#path = p;
        for (const m of [method].flat()) {
          handlers.map((handler) => {
            this.#addRoute(m.toUpperCase(), this.#path, handler);
          });
        }
      }
      return this;
    };
    this.use = (arg1, ...handlers) => {
      if (typeof arg1 === "string") {
        this.#path = arg1;
      } else {
        this.#path = "*";
        handlers.unshift(arg1);
      }
      handlers.forEach((handler) => {
        this.#addRoute(METHOD_NAME_ALL, this.#path, handler);
      });
      return this;
    };
    const { strict, ...optionsWithoutStrict } = options;
    Object.assign(this, optionsWithoutStrict);
    this.getPath = strict ?? true ? options.getPath ?? getPath : getPathNoStrict;
  }
  #clone() {
    const clone = new _Hono({
      router: this.router,
      getPath: this.getPath
    });
    clone.errorHandler = this.errorHandler;
    clone.#notFoundHandler = this.#notFoundHandler;
    clone.routes = this.routes;
    return clone;
  }
  #notFoundHandler = notFoundHandler;
  // Cannot use `#` because it requires visibility at JavaScript runtime.
  errorHandler = errorHandler;
  /**
   * `.route()` allows grouping other Hono instance in routes.
   *
   * @see {@link https://hono.dev/docs/api/routing#grouping}
   *
   * @param {string} path - base Path
   * @param {Hono} app - other Hono instance
   * @returns {Hono} routed Hono instance
   *
   * @example
   * ```ts
   * const app = new Hono()
   * const app2 = new Hono()
   *
   * app2.get("/user", (c) => c.text("user"))
   * app.route("/api", app2) // GET /api/user
   * ```
   */
  route(path, app2) {
    const subApp = this.basePath(path);
    app2.routes.map((r) => {
      let handler;
      if (app2.errorHandler === errorHandler) {
        handler = r.handler;
      } else {
        handler = async (c, next) => (await compose([], app2.errorHandler)(c, () => r.handler(c, next))).res;
        handler[COMPOSED_HANDLER] = r.handler;
      }
      subApp.#addRoute(r.method, r.path, handler, r.basePath);
    });
    return this;
  }
  /**
   * `.basePath()` allows base paths to be specified.
   *
   * @see {@link https://hono.dev/docs/api/routing#base-path}
   *
   * @param {string} path - base Path
   * @returns {Hono} changed Hono instance
   *
   * @example
   * ```ts
   * const api = new Hono().basePath('/api')
   * ```
   */
  basePath(path) {
    const subApp = this.#clone();
    subApp._basePath = mergePath(this._basePath, path);
    return subApp;
  }
  /**
   * `.onError()` handles an error and returns a customized Response.
   *
   * @see {@link https://hono.dev/docs/api/hono#error-handling}
   *
   * @param {ErrorHandler} handler - request Handler for error
   * @returns {Hono} changed Hono instance
   *
   * @example
   * ```ts
   * app.onError((err, c) => {
   *   console.error(`${err}`)
   *   return c.text('Custom Error Message', 500)
   * })
   * ```
   */
  onError = (handler) => {
    this.errorHandler = handler;
    return this;
  };
  /**
   * `.notFound()` allows you to customize a Not Found Response.
   *
   * @see {@link https://hono.dev/docs/api/hono#not-found}
   *
   * @param {NotFoundHandler} handler - request handler for not-found
   * @returns {Hono} changed Hono instance
   *
   * @example
   * ```ts
   * app.notFound((c) => {
   *   return c.text('Custom 404 Message', 404)
   * })
   * ```
   */
  notFound = (handler) => {
    this.#notFoundHandler = handler;
    return this;
  };
  /**
   * `.mount()` allows you to mount applications built with other frameworks into your Hono application.
   *
   * @see {@link https://hono.dev/docs/api/hono#mount}
   *
   * @param {string} path - base Path
   * @param {Function} applicationHandler - other Request Handler
   * @param {MountOptions} [options] - options of `.mount()`
   * @returns {Hono} mounted Hono instance
   *
   * @example
   * ```ts
   * import { Router as IttyRouter } from 'itty-router'
   * import { Hono } from 'hono'
   * // Create itty-router application
   * const ittyRouter = IttyRouter()
   * // GET /itty-router/hello
   * ittyRouter.get('/hello', () => new Response('Hello from itty-router'))
   *
   * const app = new Hono()
   * app.mount('/itty-router', ittyRouter.handle)
   * ```
   *
   * @example
   * ```ts
   * const app = new Hono()
   * // Send the request to another application without modification.
   * app.mount('/app', anotherApp, {
   *   replaceRequest: (req) => req,
   * })
   * ```
   */
  mount(path, applicationHandler, options) {
    let replaceRequest;
    let optionHandler;
    if (options) {
      if (typeof options === "function") {
        optionHandler = options;
      } else {
        optionHandler = options.optionHandler;
        if (options.replaceRequest === false) {
          replaceRequest = (request) => request;
        } else {
          replaceRequest = options.replaceRequest;
        }
      }
    }
    const getOptions = optionHandler ? (c) => {
      const options2 = optionHandler(c);
      return Array.isArray(options2) ? options2 : [options2];
    } : (c) => {
      let executionContext = void 0;
      try {
        executionContext = c.executionCtx;
      } catch {
      }
      return [c.env, executionContext];
    };
    replaceRequest ||= (() => {
      const mergedPath = mergePath(this._basePath, path);
      const pathPrefixLength = mergedPath === "/" ? 0 : mergedPath.length;
      return (request) => {
        const url = new URL(request.url);
        url.pathname = this.getPath(request).slice(pathPrefixLength) || "/";
        return new Request(url, request);
      };
    })();
    const handler = async (c, next) => {
      const res = await applicationHandler(replaceRequest(c.req.raw), ...getOptions(c));
      if (res) {
        return res;
      }
      await next();
    };
    this.#addRoute(METHOD_NAME_ALL, mergePath(path, "*"), handler);
    return this;
  }
  #addRoute(method, path, handler, baseRoutePath) {
    method = method.toUpperCase();
    path = mergePath(this._basePath, path);
    const r = {
      basePath: baseRoutePath !== void 0 ? mergePath(this._basePath, baseRoutePath) : this._basePath,
      path,
      method,
      handler
    };
    this.router.add(method, path, [handler, r]);
    this.routes.push(r);
  }
  #handleError(err, c) {
    if (err instanceof Error) {
      return this.errorHandler(err, c);
    }
    throw err;
  }
  #dispatch(request, executionCtx, env, method) {
    if (method === "HEAD") {
      return (async () => new Response(null, await this.#dispatch(request, executionCtx, env, "GET")))();
    }
    const path = this.getPath(request, { env });
    const matchResult = this.router.match(method, path);
    const c = new Context(request, {
      path,
      matchResult,
      env,
      executionCtx,
      notFoundHandler: this.#notFoundHandler
    });
    if (matchResult[0].length === 1) {
      let res;
      try {
        res = matchResult[0][0][0][0](c, async () => {
          c.res = await this.#notFoundHandler(c);
        });
      } catch (err) {
        return this.#handleError(err, c);
      }
      return res instanceof Promise ? res.then(
        (resolved) => resolved || (c.finalized ? c.res : this.#notFoundHandler(c))
      ).catch((err) => this.#handleError(err, c)) : res ?? this.#notFoundHandler(c);
    }
    const composed = compose(matchResult[0], this.errorHandler, this.#notFoundHandler);
    return (async () => {
      try {
        const context = await composed(c);
        if (!context.finalized) {
          throw new Error(
            "Context is not finalized. Did you forget to return a Response object or `await next()`?"
          );
        }
        return context.res;
      } catch (err) {
        return this.#handleError(err, c);
      }
    })();
  }
  /**
   * `.fetch()` will be entry point of your app.
   *
   * @see {@link https://hono.dev/docs/api/hono#fetch}
   *
   * @param {Request} request - request Object of request
   * @param {Env} env - env Object
   * @param {ExecutionContext} executionCtx - context of execution
   * @returns {Response | Promise<Response>} response of request
   *
   */
  fetch = (request, ...rest) => {
    return this.#dispatch(request, rest[1], rest[0], request.method);
  };
  /**
   * `.request()` is a useful method for testing.
   * You can pass a URL or pathname to send a GET request.
   * app will return a Response object.
   * ```ts
   * test('GET /hello is ok', async () => {
   *   const res = await app.request('/hello')
   *   expect(res.status).toBe(200)
   * })
   * ```
   * @see https://hono.dev/docs/api/hono#request
   */
  request = (input, requestInit, Env, executionCtx) => {
    if (input instanceof Request) {
      return this.fetch(requestInit ? new Request(input, requestInit) : input, Env, executionCtx);
    }
    input = input.toString();
    return this.fetch(
      new Request(
        /^https?:\/\//.test(input) ? input : `http://localhost${mergePath("/", input)}`,
        requestInit
      ),
      Env,
      executionCtx
    );
  };
  /**
   * `.fire()` automatically adds a global fetch event listener.
   * This can be useful for environments that adhere to the Service Worker API, such as non-ES module Cloudflare Workers.
   * @deprecated
   * Use `fire` from `hono/service-worker` instead.
   * ```ts
   * import { Hono } from 'hono'
   * import { fire } from 'hono/service-worker'
   *
   * const app = new Hono()
   * // ...
   * fire(app)
   * ```
   * @see https://hono.dev/docs/api/hono#fire
   * @see https://developer.mozilla.org/en-US/docs/Web/API/Service_Worker_API
   * @see https://developers.cloudflare.com/workers/reference/migrate-to-module-workers/
   */
  fire = () => {
    addEventListener("fetch", (event) => {
      event.respondWith(this.#dispatch(event.request, event, void 0, event.request.method));
    });
  };
};

// node_modules/hono/dist/router/reg-exp-router/matcher.js
var emptyParam = [];
function match(method, path) {
  const matchers = this.buildAllMatchers();
  const match2 = ((method2, path2) => {
    const matcher = matchers[method2] || matchers[METHOD_NAME_ALL];
    const staticMatch = matcher[2][path2];
    if (staticMatch) {
      return staticMatch;
    }
    const match3 = path2.match(matcher[0]);
    if (!match3) {
      return [[], emptyParam];
    }
    const index = match3.indexOf("", 1);
    return [matcher[1][index], match3];
  });
  this.match = match2;
  return match2(method, path);
}

// node_modules/hono/dist/router/reg-exp-router/node.js
var LABEL_REG_EXP_STR = "[^/]+";
var ONLY_WILDCARD_REG_EXP_STR = ".*";
var TAIL_WILDCARD_REG_EXP_STR = "(?:|/.*)";
var PATH_ERROR = /* @__PURE__ */ Symbol();
var regExpMetaChars = new Set(".\\+*[^]$()");
function compareKey(a, b) {
  if (a.length === 1) {
    return b.length === 1 ? a < b ? -1 : 1 : -1;
  }
  if (b.length === 1) {
    return 1;
  }
  if (a === ONLY_WILDCARD_REG_EXP_STR || a === TAIL_WILDCARD_REG_EXP_STR) {
    return b === TAIL_WILDCARD_REG_EXP_STR ? -1 : 1;
  } else if (b === ONLY_WILDCARD_REG_EXP_STR || b === TAIL_WILDCARD_REG_EXP_STR) {
    return -1;
  }
  if (a === LABEL_REG_EXP_STR) {
    return 1;
  } else if (b === LABEL_REG_EXP_STR) {
    return -1;
  }
  return a.length === b.length ? a < b ? -1 : 1 : b.length - a.length;
}
var Node = class _Node {
  // handler index of a dynamic path, or -1 for a static path terminal
  #index;
  #varIndex;
  #children = /* @__PURE__ */ Object.create(null);
  insert(tokens, index, paramMap, context, isStatic) {
    let node = this;
    for (let i = 0, len = tokens.length; i < len; i++) {
      const token = tokens[i];
      const pattern = token.length === 1 ? token === "*" ? i === len - 1 ? ["", "", ONLY_WILDCARD_REG_EXP_STR] : ["", "", LABEL_REG_EXP_STR] : null : token === "/*" ? ["", "", TAIL_WILDCARD_REG_EXP_STR] : token.match(/^\:([^\{\}]+)(?:\{(.+)\})?$/);
      let nextNode;
      if (pattern) {
        const name = pattern[1];
        let regexpStr = pattern[2] || LABEL_REG_EXP_STR;
        if (name && pattern[2]) {
          if (regexpStr === ".*") {
            throw PATH_ERROR;
          }
          regexpStr = regexpStr.replace(/^\((?!\?:)(?=[^)]+\)$)/, "(?:");
          if (/\((?!\?:)/.test(regexpStr)) {
            throw PATH_ERROR;
          }
          if (regexpStr.length === 1 && regExpMetaChars.has(regexpStr)) {
            throw PATH_ERROR;
          }
        }
        nextNode = node.#children[regexpStr];
        if (!nextNode) {
          if (regexpStr !== ONLY_WILDCARD_REG_EXP_STR && regexpStr !== TAIL_WILDCARD_REG_EXP_STR) {
            for (const k in node.#children) {
              if (
                // a single-char pattern coexists with single-char literals as a literal does
                (regexpStr.length > 1 || k.length > 1) && k !== ONLY_WILDCARD_REG_EXP_STR && k !== TAIL_WILDCARD_REG_EXP_STR
              ) {
                throw PATH_ERROR;
              }
            }
          }
          nextNode = node.#children[regexpStr] = new _Node();
        }
        if (name !== "") {
          nextNode.#varIndex ??= context.varIndex++;
          paramMap.push([name, nextNode.#varIndex]);
        }
      } else {
        nextNode = node.#children[token];
        if (!nextNode) {
          for (const k in node.#children) {
            if (k.length > 1 && k !== ONLY_WILDCARD_REG_EXP_STR && k !== TAIL_WILDCARD_REG_EXP_STR) {
              throw PATH_ERROR;
            }
          }
          nextNode = node.#children[token] = new _Node();
        }
      }
      node = nextNode;
    }
    if (node.#index !== void 0) {
      throw PATH_ERROR;
    }
    node.#index = isStatic ? -1 : index;
  }
  buildRegExpStr() {
    const childKeys = Object.keys(this.#children).sort(compareKey);
    const strList = childKeys.map((k) => {
      const c = this.#children[k];
      const childStr = c.buildRegExpStr();
      return childStr === "" ? "" : (typeof c.#varIndex === "number" ? `(${k})@${c.#varIndex}` : regExpMetaChars.has(k) ? `\\${k}` : k) + childStr;
    }).filter(Boolean);
    if (typeof this.#index === "number" && this.#index !== -1) {
      strList.unshift(`#${this.#index}`);
    }
    if (strList.length === 0) {
      return "";
    }
    if (strList.length === 1) {
      return strList[0];
    }
    return "(?:" + strList.join("|") + ")";
  }
};

// node_modules/hono/dist/router/reg-exp-router/trie.js
var Trie = class {
  #context = { varIndex: 0 };
  #root = new Node();
  #index = 0;
  // dynamic path -> [handler index, param assoc]; static paths are not registered
  paths = /* @__PURE__ */ Object.create(null);
  insert(path, isStatic) {
    if (isStatic) {
      this.#root.insert(path.split(""), 0, [], this.#context, true);
      return;
    }
    const paramAssoc = [];
    const groups = [];
    let markedPath = path;
    for (let i = 0; ; ) {
      let replaced = false;
      markedPath = markedPath.replace(/\{[^}]+\}/g, (m) => {
        const mark = `@\\${i}`;
        groups[i] = [mark, m];
        i++;
        replaced = true;
        return mark;
      });
      if (!replaced) {
        break;
      }
    }
    const tokens = markedPath.match(/(?::[^\/]+)|(?:\/\*$)|./g) || [];
    for (let i = groups.length - 1; i >= 0; i--) {
      const [mark] = groups[i];
      for (let j = tokens.length - 1; j >= 0; j--) {
        if (tokens[j].indexOf(mark) !== -1) {
          tokens[j] = tokens[j].replace(mark, groups[i][1]);
          break;
        }
      }
    }
    this.#root.insert(tokens, this.#index, paramAssoc, this.#context, false);
    this.paths[path] = [this.#index++, paramAssoc];
  }
  buildRegExp() {
    let regexp = this.#root.buildRegExpStr();
    if (regexp === "") {
      return [/^$/, [], []];
    }
    let captureIndex = 0;
    const indexReplacementMap = [];
    const paramReplacementMap = [];
    regexp = regexp.replace(/#(\d+)|@(\d+)|\.\*\$/g, (_, handlerIndex, paramIndex) => {
      if (handlerIndex !== void 0) {
        indexReplacementMap[++captureIndex] = Number(handlerIndex);
        return "$()";
      }
      if (paramIndex !== void 0) {
        paramReplacementMap[Number(paramIndex)] = ++captureIndex;
        return "";
      }
      return "";
    });
    return [new RegExp(`^${regexp}`), indexReplacementMap, paramReplacementMap];
  }
};

// node_modules/hono/dist/router/reg-exp-router/router.js
var wildcardRegExpCache = /* @__PURE__ */ Object.create(null);
function buildWildcardRegExp(path) {
  return wildcardRegExpCache[path] ??= new RegExp(
    path === "*" ? "" : `^${path.replace(
      /\/\*$|([.\\+*[^\]$()])/g,
      (_, metaChar) => metaChar ? `\\${metaChar}` : "(?:|/.*)"
    )}$`
  );
}
function clearWildcardRegExpCache() {
  wildcardRegExpCache = /* @__PURE__ */ Object.create(null);
}
function findMiddleware(middleware, path) {
  if (!middleware) {
    return void 0;
  }
  for (const k of Object.keys(middleware).sort((a, b) => b.length - a.length)) {
    if (buildWildcardRegExp(k).test(path)) {
      return [...middleware[k]];
    }
  }
  return void 0;
}
var RegExpRouter = class {
  name = "RegExpRouter";
  #middleware;
  #routes;
  #tries;
  constructor() {
    this.#middleware = { [METHOD_NAME_ALL]: /* @__PURE__ */ Object.create(null) };
    this.#routes = { [METHOD_NAME_ALL]: /* @__PURE__ */ Object.create(null) };
    this.#tries = { [METHOD_NAME_ALL]: new Trie() };
  }
  #insertPath(method, path) {
    try {
      this.#tries[method].insert(path, !/\*|\/:/.test(path));
    } catch (e) {
      throw e === PATH_ERROR ? new UnsupportedPathError(path) : e;
    }
  }
  add(method, path, handler) {
    const middleware = this.#middleware;
    const routes = this.#routes;
    if (!middleware || !routes) {
      throw new Error(MESSAGE_MATCHER_IS_ALREADY_BUILT);
    }
    if (!middleware[method]) {
      this.#tries[method] = new Trie();
      [middleware, routes].forEach((handlerMap) => {
        handlerMap[method] = /* @__PURE__ */ Object.create(null);
        Object.keys(handlerMap[METHOD_NAME_ALL]).forEach((p) => {
          handlerMap[method][p] = [...handlerMap[METHOD_NAME_ALL][p]];
          this.#insertPath(method, p);
        });
      });
    }
    if (path === "/*") {
      path = "*";
    }
    const paramCount = (path.match(/\/:/g) || []).length;
    if (/\*$/.test(path)) {
      const re = buildWildcardRegExp(path);
      Object.keys(middleware).forEach((m) => {
        if ((method === METHOD_NAME_ALL || method === m) && !middleware[m][path]) {
          this.#insertPath(m, path);
          middleware[m][path] = findMiddleware(middleware[m], path) || findMiddleware(middleware[METHOD_NAME_ALL], path) || [];
        }
      });
      Object.keys(middleware).forEach((m) => {
        if (method === METHOD_NAME_ALL || method === m) {
          Object.keys(middleware[m]).forEach((p) => {
            re.test(p) && middleware[m][p].push([handler, paramCount]);
          });
        }
      });
      Object.keys(routes).forEach((m) => {
        if (method === METHOD_NAME_ALL || method === m) {
          Object.keys(routes[m]).forEach(
            (p) => re.test(p) && routes[m][p].push([handler, paramCount])
          );
        }
      });
      return;
    }
    const paths = checkOptionalParameter(path) || [path];
    for (let i = 0, len = paths.length; i < len; i++) {
      const path2 = paths[i];
      Object.keys(routes).forEach((m) => {
        if (method === METHOD_NAME_ALL || method === m) {
          if (!routes[m][path2]) {
            this.#insertPath(m, path2);
            routes[m][path2] = [
              ...findMiddleware(middleware[m], path2) || findMiddleware(middleware[METHOD_NAME_ALL], path2) || []
            ];
          }
          routes[m][path2].push([handler, paramCount - len + i + 1]);
        }
      });
    }
  }
  match = match;
  buildAllMatchers() {
    const matchers = /* @__PURE__ */ Object.create(null);
    Object.keys(this.#routes).concat(Object.keys(this.#middleware)).forEach((method) => {
      matchers[method] ||= this.#buildMatcher(method);
    });
    this.#middleware = this.#routes = this.#tries = void 0;
    clearWildcardRegExpCache();
    return matchers;
  }
  #buildMatcher(method) {
    const middleware = this.#middleware[method];
    const routes = this.#routes[method];
    const trie = this.#tries[method];
    const staticMap = /* @__PURE__ */ Object.create(null);
    const handlerData = [];
    [middleware, routes].forEach((r) => {
      for (const path in r) {
        const handlers = r[path];
        const pathData = trie.paths[path];
        if (!pathData) {
          staticMap[path] = [handlers.map(([h]) => [h, /* @__PURE__ */ Object.create(null)]), emptyParam];
          continue;
        }
        const paramAssoc = pathData[1];
        handlerData[pathData[0]] = handlers.map(([h, paramCount]) => {
          const paramIndexMap = /* @__PURE__ */ Object.create(null);
          paramCount -= 1;
          for (; paramCount >= 0; paramCount--) {
            const [key, value] = paramAssoc[paramCount];
            paramIndexMap[key] = value;
          }
          return [h, paramIndexMap];
        });
      }
    });
    const [regexp, indexReplacementMap, paramReplacementMap] = trie.buildRegExp();
    for (let i = 0, len = handlerData.length; i < len; i++) {
      for (let j = 0, len2 = handlerData[i].length; j < len2; j++) {
        const map = handlerData[i][j]?.[1];
        if (!map) {
          continue;
        }
        const keys = Object.keys(map);
        for (let k = 0, len3 = keys.length; k < len3; k++) {
          map[keys[k]] = paramReplacementMap[map[keys[k]]];
        }
      }
    }
    const handlerMap = [];
    for (const i in indexReplacementMap) {
      handlerMap[i] = handlerData[indexReplacementMap[i]];
    }
    return [regexp, handlerMap, staticMap];
  }
};

// node_modules/hono/dist/router/smart-router/router.js
var SmartRouter = class {
  name = "SmartRouter";
  #routers = [];
  #routes = [];
  constructor(init) {
    this.#routers = init.routers;
  }
  add(method, path, handler) {
    if (!this.#routes) {
      throw new Error(MESSAGE_MATCHER_IS_ALREADY_BUILT);
    }
    this.#routes.push([method, path, handler]);
  }
  match(method, path) {
    if (!this.#routes) {
      throw new Error("Fatal error");
    }
    const routers = this.#routers;
    const routes = this.#routes;
    const len = routers.length;
    let i = 0;
    let res;
    for (; i < len; i++) {
      const router = routers[i];
      try {
        for (let i2 = 0, len2 = routes.length; i2 < len2; i2++) {
          router.add(...routes[i2]);
        }
        res = router.match(method, path);
      } catch (e) {
        if (e instanceof UnsupportedPathError) {
          continue;
        }
        throw e;
      }
      this.match = router.match.bind(router);
      this.#routers = [router];
      this.#routes = void 0;
      break;
    }
    if (i === len) {
      throw new Error("Fatal error");
    }
    this.name = `SmartRouter + ${this.activeRouter.name}`;
    return res;
  }
  get activeRouter() {
    if (this.#routes || this.#routers.length !== 1) {
      throw new Error("No active router has been determined yet.");
    }
    return this.#routers[0];
  }
};

// node_modules/hono/dist/router/trie-router/node.js
var emptyParams = /* @__PURE__ */ Object.create(null);
var hasChildren = (children) => {
  for (const _ in children) {
    return true;
  }
  return false;
};
var Node2 = class _Node2 {
  #methods;
  #children;
  #patterns;
  #order = 0;
  #params = emptyParams;
  constructor(method, handler, children) {
    this.#children = children || /* @__PURE__ */ Object.create(null);
    this.#methods = [];
    if (method && handler) {
      const m = /* @__PURE__ */ Object.create(null);
      m[method] = { handler, possibleKeys: [], score: 0 };
      this.#methods = [m];
    }
    this.#patterns = [];
  }
  insert(method, path, handler) {
    this.#order = ++this.#order;
    let curNode = this;
    const parts = splitRoutingPath(path);
    const possibleKeys = [];
    for (let i = 0, len = parts.length; i < len; i++) {
      const p = parts[i];
      const nextP = parts[i + 1];
      const pattern = getPattern(p, nextP);
      const key = Array.isArray(pattern) ? pattern[0] : p;
      if (key in curNode.#children) {
        curNode = curNode.#children[key];
        if (pattern) {
          possibleKeys.push(pattern[1]);
        }
        continue;
      }
      curNode.#children[key] = new _Node2();
      if (pattern) {
        curNode.#patterns.push(pattern);
        possibleKeys.push(pattern[1]);
      }
      curNode = curNode.#children[key];
    }
    curNode.#methods.push({
      [method]: {
        handler,
        possibleKeys: possibleKeys.filter((v, i, a) => a.indexOf(v) === i),
        score: this.#order
      }
    });
    return curNode;
  }
  #pushHandlerSets(handlerSets, node, method, nodeParams, params) {
    for (let i = 0, len = node.#methods.length; i < len; i++) {
      const m = node.#methods[i];
      const handlerSet = m[method] || m[METHOD_NAME_ALL];
      const processedSet = {};
      if (handlerSet !== void 0) {
        handlerSet.params = /* @__PURE__ */ Object.create(null);
        handlerSets.push(handlerSet);
        if (nodeParams !== emptyParams || params && params !== emptyParams) {
          for (let i2 = 0, len2 = handlerSet.possibleKeys.length; i2 < len2; i2++) {
            const key = handlerSet.possibleKeys[i2];
            const processed = processedSet[handlerSet.score];
            handlerSet.params[key] = params?.[key] && !processed ? params[key] : nodeParams[key] ?? params?.[key];
            processedSet[handlerSet.score] = true;
          }
        }
      }
    }
  }
  search(method, path) {
    const handlerSets = [];
    this.#params = emptyParams;
    const curNode = this;
    let curNodes = [curNode];
    const parts = splitPath(path);
    const curNodesQueue = [];
    const len = parts.length;
    let partOffsets = null;
    for (let i = 0; i < len; i++) {
      const part = parts[i];
      const isLast = i === len - 1;
      const tempNodes = [];
      for (let j = 0, len2 = curNodes.length; j < len2; j++) {
        const node = curNodes[j];
        const nextNode = node.#children[part];
        if (nextNode) {
          nextNode.#params = node.#params;
          if (isLast) {
            if (nextNode.#children["*"]) {
              this.#pushHandlerSets(handlerSets, nextNode.#children["*"], method, node.#params);
            }
            this.#pushHandlerSets(handlerSets, nextNode, method, node.#params);
          } else {
            tempNodes.push(nextNode);
          }
        }
        for (let k = 0, len3 = node.#patterns.length; k < len3; k++) {
          const pattern = node.#patterns[k];
          const params = node.#params === emptyParams ? {} : { ...node.#params };
          if (pattern === "*") {
            const astNode = node.#children["*"];
            if (astNode) {
              this.#pushHandlerSets(handlerSets, astNode, method, node.#params);
              astNode.#params = params;
              tempNodes.push(astNode);
            }
            continue;
          }
          const [key, name, matcher] = pattern;
          if (!part && !(matcher instanceof RegExp)) {
            continue;
          }
          const child = node.#children[key];
          if (matcher instanceof RegExp) {
            if (partOffsets === null) {
              partOffsets = new Array(len);
              let offset = path[0] === "/" ? 1 : 0;
              for (let p = 0; p < len; p++) {
                partOffsets[p] = offset;
                offset += parts[p].length + 1;
              }
            }
            const restPathString = path.substring(partOffsets[i]);
            const m = matcher.exec(restPathString);
            if (m) {
              params[name] = m[0];
              this.#pushHandlerSets(handlerSets, child, method, node.#params, params);
              if (m[0].length === restPathString.length && child.#children["*"]) {
                this.#pushHandlerSets(
                  handlerSets,
                  child.#children["*"],
                  method,
                  node.#params,
                  params
                );
              }
              if (hasChildren(child.#children)) {
                child.#params = params;
                const componentCount = m[0].match(/\//g)?.length ?? 0;
                const targetCurNodes = curNodesQueue[componentCount] ||= [];
                targetCurNodes.push(child);
              }
              continue;
            }
          }
          if (matcher === true || matcher.test(part)) {
            params[name] = part;
            if (isLast) {
              this.#pushHandlerSets(handlerSets, child, method, params, node.#params);
              if (child.#children["*"]) {
                this.#pushHandlerSets(
                  handlerSets,
                  child.#children["*"],
                  method,
                  params,
                  node.#params
                );
              }
            } else {
              child.#params = params;
              tempNodes.push(child);
            }
          }
        }
      }
      const shifted = curNodesQueue.shift();
      curNodes = shifted ? tempNodes.concat(shifted) : tempNodes;
    }
    if (handlerSets.length > 1) {
      handlerSets.sort((a, b) => {
        return a.score - b.score;
      });
    }
    return [handlerSets.map(({ handler, params }) => [handler, params])];
  }
};

// node_modules/hono/dist/router/trie-router/router.js
var TrieRouter = class {
  name = "TrieRouter";
  #node;
  constructor() {
    this.#node = new Node2();
  }
  add(method, path, handler) {
    const results = checkOptionalParameter(path);
    if (results) {
      for (let i = 0, len = results.length; i < len; i++) {
        this.#node.insert(method, results[i], handler);
      }
      return;
    }
    this.#node.insert(method, path, handler);
  }
  match(method, path) {
    return this.#node.search(method, path);
  }
};

// node_modules/hono/dist/hono.js
var Hono2 = class extends Hono {
  /**
   * Creates an instance of the Hono class.
   *
   * @param options - Optional configuration options for the Hono instance.
   */
  constructor(options = {}) {
    super(options);
    this.router = options.router ?? new SmartRouter({
      routers: [new RegExpRouter(), new TrieRouter()]
    });
  }
};

// node_modules/hono/dist/middleware/cors/index.js
var cors = (options) => {
  const opts = {
    origin: "*",
    allowMethods: ["GET", "HEAD", "PUT", "POST", "DELETE", "PATCH", "QUERY"],
    allowHeaders: [],
    exposeHeaders: [],
    ...options
  };
  const exposeHeadersStr = opts.exposeHeaders?.length ? opts.exposeHeaders.join(",") : void 0;
  const allowHeadersStr = opts.allowHeaders?.length ? opts.allowHeaders.join(",") : void 0;
  const findAllowOrigin = ((optsOrigin) => {
    if (typeof optsOrigin === "string") {
      if (optsOrigin === "*") {
        return () => optsOrigin;
      } else {
        return (origin) => optsOrigin === origin ? origin : null;
      }
    } else if (typeof optsOrigin === "function") {
      return optsOrigin;
    } else {
      return (origin) => optsOrigin.includes(origin) ? origin : null;
    }
  })(opts.origin);
  const findAllowMethods = ((optsAllowMethods) => {
    if (typeof optsAllowMethods === "function") {
      return async (origin, c) => (await optsAllowMethods(origin, c)).join(",");
    } else if (Array.isArray(optsAllowMethods)) {
      const methodsStr = optsAllowMethods.join(",");
      return () => methodsStr;
    } else {
      return () => "";
    }
  })(opts.allowMethods);
  return async function cors2(c, next) {
    function set(key, value) {
      c.res.headers.set(key, value);
    }
    const allowOrigin = await findAllowOrigin(c.req.header("origin") || "", c);
    if (allowOrigin) {
      set("Access-Control-Allow-Origin", allowOrigin);
    }
    if (opts.credentials) {
      set("Access-Control-Allow-Credentials", "true");
    }
    if (exposeHeadersStr) {
      set("Access-Control-Expose-Headers", exposeHeadersStr);
    }
    if (c.req.method === "OPTIONS") {
      if (opts.origin !== "*") {
        set("Vary", "Origin");
      }
      if (opts.maxAge != null) {
        set("Access-Control-Max-Age", opts.maxAge.toString());
      }
      const allowMethods = await findAllowMethods(c.req.header("origin") || "", c);
      if (allowMethods) {
        set("Access-Control-Allow-Methods", allowMethods);
      }
      let headersStr = allowHeadersStr;
      if (!headersStr) {
        const requestHeaders = c.req.header("Access-Control-Request-Headers");
        if (requestHeaders) {
          headersStr = requestHeaders.split(",").map((h) => h.trim()).join(",");
        }
      }
      if (headersStr) {
        set("Access-Control-Allow-Headers", headersStr);
        c.res.headers.append("Vary", "Access-Control-Request-Headers");
      }
      c.res.headers.delete("Content-Length");
      c.res.headers.delete("Content-Type");
      return new Response(null, {
        headers: c.res.headers,
        status: 204,
        statusText: "No Content"
      });
    }
    await next();
    if (opts.origin !== "*") {
      c.header("Vary", "Origin", { append: true });
    }
  };
};

// src/index.ts
var PAPER = "paper";
var COIN_META = {
  BTC: { id: "bitcoin", name: "Bitcoin" },
  ETH: { id: "ethereum", name: "Ethereum" },
  SOL: { id: "solana", name: "Solana" },
  BNB: { id: "binancecoin", name: "BNB" },
  ADA: { id: "cardano", name: "Cardano" },
  XRP: { id: "ripple", name: "XRP" },
  DOT: { id: "polkadot", name: "Polkadot" },
  AVAX: { id: "avalanche-2", name: "Avalanche" },
  DOGE: { id: "dogecoin", name: "Dogecoin" },
  LINK: { id: "chainlink", name: "Chainlink" }
};
var FALLBACK_PRICES = {
  BTC: 105e3,
  ETH: 3800,
  SOL: 180,
  BNB: 700,
  ADA: 0.45,
  XRP: 0.52,
  DOT: 8.5,
  AVAX: 35,
  DOGE: 0.18,
  LINK: 18
};
var CIRCUIT_OPEN_MS = 5 * 60 * 1e3;
var CIRCUIT_FAIL_THRESHOLD = 3;
var ts = () => Date.now();
var day = () => (/* @__PURE__ */ new Date()).toISOString().split("T")[0];
var n = (value, fallback = 0) => {
  const parsed = typeof value === "number" ? value : parseFloat(String(value ?? ""));
  return Number.isFinite(parsed) ? parsed : fallback;
};
var bool = (value) => value === true || value === 1 || value === "1" || value === "true";
var sym = (value) => (value || "BTC").toUpperCase().trim().replace(/[-/](USDT|USD)$/i, "").replace(/(USDT|USD)$/i, "");
var safeRuntime = (env) => ({
  mode: PAPER,
  trading_mode: PAPER,
  exchange_mode: PAPER,
  network: "testnet",
  allow_mainnet: false,
  live_trading_enabled: false,
  withdrawals_enabled: false
});
async function audit(env, event, detail) {
  const payload = typeof detail === "string" ? detail : JSON.stringify(detail);
  await env.DB.prepare("INSERT INTO audit_trail (event, detail) VALUES (?, ?)").bind(event, payload).run().catch(() => void 0);
}
async function cbIsOpen(env, source) {
  const row = await env.DB.prepare(
    "SELECT open, fail_count, last_fail_at FROM circuit_breaker_state WHERE source = ?"
  ).bind(source).first().catch(() => null);
  if (!row || !bool(row.open)) return false;
  const lastFail = row.last_fail_at ? new Date(row.last_fail_at).getTime() : 0;
  if (ts() - lastFail > CIRCUIT_OPEN_MS) {
    await env.DB.prepare(
      "UPDATE circuit_breaker_state SET open = 0, fail_count = 0 WHERE source = ?"
    ).bind(source).run().catch(() => void 0);
    return false;
  }
  return true;
}
async function cbRecordSuccess(env, source) {
  await env.DB.prepare(
    `INSERT INTO circuit_breaker_state (source, open, fail_count, last_fail_at)
     VALUES (?, 0, 0, NULL)
     ON CONFLICT(source) DO UPDATE SET open = 0, fail_count = 0`
  ).bind(source).run().catch(() => void 0);
}
async function cbRecordFailure(env, source) {
  await env.DB.prepare(
    `INSERT INTO circuit_breaker_state (source, open, fail_count, last_fail_at)
     VALUES (?, 0, 1, CURRENT_TIMESTAMP)
     ON CONFLICT(source) DO UPDATE SET
       fail_count = fail_count + 1,
       last_fail_at = CURRENT_TIMESTAMP,
       open = CASE WHEN fail_count + 1 >= ? THEN 1 ELSE open END`
  ).bind(source, CIRCUIT_FAIL_THRESHOLD).run().catch(() => void 0);
}
async function fetchCoinbase(symbol) {
  try {
    const res = await fetch(`https://api.coinbase.com/v2/prices/${symbol}-USD/spot`, {
      signal: AbortSignal.timeout(4e3)
    });
    if (!res.ok) return null;
    const data = await res.json();
    const price = n(data?.data?.amount, NaN);
    return Number.isFinite(price) && price > 0 ? price : null;
  } catch {
    return null;
  }
}
async function fetchBinance(symbol) {
  try {
    const res = await fetch(
      `https://api.binance.com/api/v3/ticker/price?symbol=${symbol}USDT`,
      { signal: AbortSignal.timeout(4e3) }
    );
    if (!res.ok) return null;
    const data = await res.json();
    const price = n(data?.price, NaN);
    return Number.isFinite(price) && price > 0 ? price : null;
  } catch {
    return null;
  }
}
async function resolvePrice(env, rawSymbol, explicitPrice) {
  const symbol = sym(rawSymbol);
  const provided = n(explicitPrice, NaN);
  if (Number.isFinite(provided) && provided > 0) {
    return { symbol, price: provided, source: "request", stale: false, ts: ts() };
  }
  if (!await cbIsOpen(env, "coinbase")) {
    const price = await fetchCoinbase(symbol);
    if (price !== null) {
      await cbRecordSuccess(env, "coinbase");
      await env.DB.prepare(
        "INSERT INTO market_snapshots (symbol, price, source, stale) VALUES (?, ?, ?, 0)"
      ).bind(symbol, price, "coinbase").run().catch(() => void 0);
      return { symbol, price, source: "coinbase", stale: false, ts: ts() };
    }
    await cbRecordFailure(env, "coinbase");
  }
  if (!await cbIsOpen(env, "binance")) {
    const price = await fetchBinance(symbol);
    if (price !== null) {
      await cbRecordSuccess(env, "binance");
      await env.DB.prepare(
        "INSERT INTO market_snapshots (symbol, price, source, stale) VALUES (?, ?, ?, 0)"
      ).bind(symbol, price, "binance").run().catch(() => void 0);
      return { symbol, price, source: "binance", stale: false, ts: ts() };
    }
    await cbRecordFailure(env, "binance");
  }
  const cached = await env.DB.prepare(
    "SELECT price, source FROM market_snapshots WHERE symbol = ? ORDER BY created_at DESC LIMIT 1"
  ).bind(symbol).first().catch(() => null);
  if (cached?.price) {
    return { symbol, price: cached.price, source: `cache:${cached.source}`, stale: true, ts: ts() };
  }
  return { symbol, price: FALLBACK_PRICES[symbol] ?? 1, source: "fallback", stale: true, ts: ts() };
}
async function ensureGuardian(env) {
  await env.DB.prepare(
    "INSERT OR IGNORE INTO guardian_state (id, triggered, reason, error_count, drawdown_pct) VALUES (1, 0, NULL, 0, 0.0)"
  ).run().catch(() => void 0);
}
async function getGuardian(env) {
  await ensureGuardian(env);
  const row = await env.DB.prepare("SELECT * FROM guardian_state WHERE id = 1").first().catch(() => null);
  return {
    id: 1,
    triggered: bool(row?.triggered ?? 0),
    reason: row?.reason ?? null,
    error_count: n(row?.error_count),
    drawdown_pct: n(row?.drawdown_pct),
    updated_at: row?.updated_at ?? (/* @__PURE__ */ new Date()).toISOString(),
    max_drawdown_pct: n(env.GUARDIAN_MAX_DRAWDOWN_PCT, 15),
    max_api_errors: n(env.GUARDIAN_MAX_API_ERRORS, 10),
    max_failed_orders: n(env.GUARDIAN_MAX_FAILED_ORDERS, 5),
    ...safeRuntime(env),
    ts: ts()
  };
}
async function isHalted(env) {
  await ensureGuardian(env);
  const row = await env.DB.prepare(
    "SELECT triggered FROM guardian_state WHERE id = 1"
  ).first().catch(() => null);
  return bool(row?.triggered ?? 0);
}
async function getBalance(env) {
  const row = await env.DB.prepare(
    "SELECT id, quantity FROM portfolio WHERE symbol = 'USDT' AND status = 'balance' LIMIT 1"
  ).first().catch(() => null);
  if (row?.quantity !== void 0) return n(row.quantity, 1e4);
  const starting = n(env.PAPER_STARTING_BALANCE_USDT, 1e4);
  await env.DB.prepare(
    "INSERT INTO portfolio (symbol, side, quantity, entry_price, current_price, pnl, status) VALUES ('USDT', 'balance', ?, 1.0, 1.0, 0, 'balance')"
  ).bind(starting).run().catch(() => void 0);
  return starting;
}
async function setBalance(env, value) {
  const row = await env.DB.prepare(
    "SELECT id FROM portfolio WHERE symbol = 'USDT' AND status = 'balance' LIMIT 1"
  ).first().catch(() => null);
  if (row?.id) {
    await env.DB.prepare("UPDATE portfolio SET quantity = ? WHERE id = ?").bind(value, row.id).run();
  } else {
    await env.DB.prepare(
      "INSERT INTO portfolio (symbol, side, quantity, entry_price, current_price, pnl, status) VALUES ('USDT', 'balance', ?, 1.0, 1.0, 0, 'balance')"
    ).bind(value).run();
  }
}
async function openPositions(env, filterSymbol) {
  const normalized = filterSymbol ? sym(filterSymbol) : null;
  const query = normalized ? "SELECT * FROM portfolio WHERE status = 'open' AND symbol = ? ORDER BY created_at ASC" : "SELECT * FROM portfolio WHERE status = 'open' AND symbol != 'USDT' ORDER BY created_at ASC";
  const stmt = normalized ? env.DB.prepare(query).bind(normalized) : env.DB.prepare(query);
  const rows = await stmt.all().catch(() => ({ results: [] }));
  return rows.results ?? [];
}
async function recordPnl(env, pnl) {
  const total = await env.DB.prepare("SELECT SUM(pnl) as total FROM earnings").first().catch(() => null);
  await env.DB.prepare("INSERT INTO earnings (date, pnl, cumulative_pnl) VALUES (?, ?, ?)").bind(day(), pnl, n(total?.total) + pnl).run();
}
async function getPortfolio(env) {
  const cash = await getBalance(env);
  const positions = await openPositions(env);
  const enriched = await Promise.all(positions.map(async (pos) => {
    const px = await resolvePrice(env, pos.symbol);
    const qty = n(pos.quantity);
    const pnl = (px.price - n(pos.entry_price)) * qty;
    return {
      ...pos,
      symbol: sym(pos.symbol),
      current_price: px.price,
      market_value_usdt: qty * px.price,
      unrealized_pnl: pnl,
      pnl
    };
  }));
  const earned = await env.DB.prepare("SELECT SUM(pnl) as realized_pnl FROM earnings").first().catch(() => null);
  const posValue = enriched.reduce((s, p) => s + n(p.market_value_usdt), 0);
  const unrealized = enriched.reduce((s, p) => s + n(p.unrealized_pnl), 0);
  const realized = n(earned?.realized_pnl);
  return {
    balance_usdt: cash,
    cash_usdt: cash,
    equity_usdt: cash + posValue,
    positions_value_usdt: posValue,
    realized_pnl: realized,
    unrealized_pnl: unrealized,
    total_pnl: realized + unrealized,
    open_positions: enriched,
    positions: enriched,
    position_count: enriched.length,
    ...safeRuntime(env),
    ts: ts()
  };
}
async function placePaperOrder(env, input) {
  if (input.idempotency_key) {
    const existing = await env.DB.prepare(
      "SELECT id FROM orders WHERE mode = 'paper' AND status = 'FILLED' AND detail LIKE ? LIMIT 1"
    ).bind(`%${input.idempotency_key}%`).first().catch(() => null);
    if (existing) return { status: 200, body: { status: "FILLED", idempotent: true, ...safeRuntime(env) } };
  }
  if (await isHalted(env)) {
    return { status: 403, body: { error: "Guardian kill switch active \u2014 trading paused", ...safeRuntime(env) } };
  }
  const px = await resolvePrice(env, input.symbol, input.price);
  const symbol = px.symbol;
  const side = String(input.side ?? "BUY").toUpperCase();
  if (side !== "BUY" && side !== "SELL") {
    return { status: 400, body: { error: "Invalid side \u2014 must be BUY or SELL", ...safeRuntime(env) } };
  }
  let qty = n(input.quantity ?? input.qty);
  const notional = n(input.notional_usdt ?? input.amount);
  if (qty <= 0 && notional > 0 && px.price > 0) qty = notional / px.price;
  if (qty <= 0 || px.price <= 0) {
    return { status: 400, body: { error: "Missing valid quantity or price", ...safeRuntime(env) } };
  }
  const cash = await getBalance(env);
  const value = qty * px.price;
  let realized = 0;
  if (side === "BUY") {
    if (cash < value) {
      return { status: 400, body: { error: "Insufficient paper balance", balance_usdt: cash, required_usdt: value, ...safeRuntime(env) } };
    }
    await setBalance(env, cash - value);
    await env.DB.prepare(
      "INSERT INTO portfolio (symbol, side, quantity, entry_price, current_price, pnl, status) VALUES (?, ?, ?, ?, ?, 0, ?)"
    ).bind(symbol, "long", qty, px.price, px.price, "open").run();
  } else {
    const lots = await openPositions(env, symbol);
    const available = lots.reduce((s, p) => s + n(p.quantity), 0);
    if (available < qty - 1e-8) {
      return { status: 400, body: { error: "Insufficient paper position", available_quantity: available, requested_quantity: qty, ...safeRuntime(env) } };
    }
    let remaining = qty;
    for (const lot of lots) {
      if (remaining <= 0) break;
      const lotQty = n(lot.quantity);
      const closed = Math.min(lotQty, remaining);
      const lotPnl = (px.price - n(lot.entry_price)) * closed;
      realized += lotPnl;
      const newQty = lotQty - closed;
      if (newQty <= 1e-8) {
        await env.DB.prepare(
          "UPDATE portfolio SET quantity = 0, current_price = ?, pnl = ?, status = ? WHERE id = ?"
        ).bind(px.price, (px.price - n(lot.entry_price)) * lotQty, "closed", lot.id).run();
      } else {
        await env.DB.prepare(
          "UPDATE portfolio SET quantity = ?, current_price = ?, pnl = ? WHERE id = ?"
        ).bind(newQty, px.price, (px.price - n(lot.entry_price)) * newQty, lot.id).run();
      }
      remaining -= closed;
    }
    await setBalance(env, cash + value);
    await recordPnl(env, realized);
  }
  await env.DB.prepare(
    "INSERT INTO orders (symbol, side, quantity, price, status, mode) VALUES (?, ?, ?, ?, ?, ?)"
  ).bind(symbol, side, qty, px.price, "FILLED", PAPER).run();
  const result = {
    status: "FILLED",
    symbol,
    side,
    quantity: qty,
    price: px.price,
    fill_price: px.price,
    notional_usdt: value,
    realized_pnl: realized,
    price_source: px.source,
    price_stale: px.stale,
    ...safeRuntime(env),
    ts: ts()
  };
  await audit(env, "paper_order", result);
  return { status: 200, body: result };
}
function requireApiKey(env, req) {
  if (!env.BACKEND_API_KEY) return false;
  const fromHeader = req.headers.get("X-API-Key") ?? req.headers.get("Authorization")?.replace(/^Bearer\s+/i, "");
  return fromHeader === env.BACKEND_API_KEY;
}
async function checkRateLimit(env, req) {
  const rpm = n(env.RATE_LIMIT_RPM, 120);
  const ip = req.headers.get("CF-Connecting-IP") ?? "unknown";
  const bucket = `${ip}:${Math.floor(Date.now() / 6e4)}`;
  try {
    const row = await env.DB.prepare(
      "SELECT count FROM rate_limit_counters WHERE bucket = ?"
    ).bind(bucket).first();
    const count = n(row?.count) + 1;
    if (count > rpm) return false;
    if (row) {
      await env.DB.prepare("UPDATE rate_limit_counters SET count = ? WHERE bucket = ?").bind(count, bucket).run();
    } else {
      await env.DB.prepare("INSERT INTO rate_limit_counters (bucket, count) VALUES (?, ?)").bind(bucket, 1).run();
    }
  } catch {
  }
  return true;
}
async function cronEvery5Min(env) {
  const symbols = Object.keys(COIN_META);
  for (const s of symbols) {
    await resolvePrice(env, s);
  }
  await env.DB.prepare(
    "DELETE FROM rate_limit_counters WHERE CAST(SUBSTR(bucket, INSTR(bucket, ':') + 1) AS INTEGER) < ?"
  ).bind(Math.floor(Date.now() / 6e4) - 2).run().catch(() => void 0);
}
async function cronEvery20Min(env) {
  const threshold = new Date(Date.now() - CIRCUIT_OPEN_MS).toISOString();
  await env.DB.prepare(
    "UPDATE circuit_breaker_state SET open = 0, fail_count = 0 WHERE open = 1 AND last_fail_at < ?"
  ).bind(threshold).run().catch(() => void 0);
  await audit(env, "cron_circuit_reset", { threshold });
}
async function cronHourly(env) {
  const portfolio = await getPortfolio(env);
  const starting = n(env.PAPER_STARTING_BALANCE_USDT, 1e4);
  const drawdown = (starting - portfolio.equity_usdt) / starting * 100;
  const maxDd = n(env.GUARDIAN_MAX_DRAWDOWN_PCT, 15);
  await env.DB.prepare(
    "UPDATE guardian_state SET drawdown_pct = ?, updated_at = CURRENT_TIMESTAMP WHERE id = 1"
  ).bind(Math.max(0, drawdown)).run().catch(() => void 0);
  if (drawdown >= maxDd) {
    await env.DB.prepare(
      "UPDATE guardian_state SET triggered = 1, reason = ?, updated_at = CURRENT_TIMESTAMP WHERE id = 1"
    ).bind(`Auto-halt: drawdown ${drawdown.toFixed(2)}% \u2265 max ${maxDd}%`).run();
    await audit(env, "guardian_auto_halt", { drawdown, maxDd, equity: portfolio.equity_usdt });
  }
  await env.DB.prepare(
    "DELETE FROM market_snapshots WHERE created_at < datetime('now', '-1 day')"
  ).run().catch(() => void 0);
}
async function cronDaily(env) {
  const earned = await env.DB.prepare(
    "SELECT SUM(pnl) as daily_pnl FROM earnings WHERE date = ?"
  ).bind(day()).first().catch(() => null);
  await audit(env, "daily_rollup", { date: day(), daily_pnl: n(earned?.daily_pnl), ts: ts() });
  await env.DB.prepare(
    "DELETE FROM audit_trail WHERE timestamp < datetime('now', '-30 days')"
  ).run().catch(() => void 0);
}
var app = new Hono2();
app.use("*", async (c, next) => {
  const origins = c.env.CORS_ALLOWED_ORIGINS ? c.env.CORS_ALLOWED_ORIGINS.split(",").map((o) => o.trim()).filter(Boolean) : ["*"];
  return cors({
    origin: (origin) => {
      if (origins.includes("*")) return origin || "*";
      return origins.includes(origin) ? origin : origins[0];
    },
    allowMethods: ["GET", "POST", "PUT", "DELETE", "OPTIONS", "PATCH"],
    allowHeaders: ["Content-Type", "Authorization", "X-API-Key"],
    maxAge: 86400
  })(c, next);
});
app.use("*", async (c, next) => {
  const allowed = await checkRateLimit(c.env, c.req.raw);
  if (!allowed) return c.json({ error: "Rate limit exceeded", retry_after: 60 }, 429);
  return next();
});
var healthPayload = async (env) => {
  const g = await getGuardian(env);
  const cbRows = await env.DB.prepare("SELECT source, open FROM circuit_breaker_state").all().catch(() => ({ results: [] }));
  const cbs = {};
  for (const row of cbRows.results ?? []) cbs[row.source] = bool(row.open);
  return {
    status: "ok",
    service: "crypto-signal-bot-worker",
    runtime: "cloudflare-workers",
    provider: "cloudflare-worker",
    ...safeRuntime(env),
    kill_switch_active: bool(g.triggered),
    kill_switch_reason: g.reason,
    guardian_triggered: bool(g.triggered),
    halted: bool(g.triggered),
    market_data_mode: "live_public_paper",
    market_data_connected: true,
    market_data_source: env.MARKET_DATA_PUBLIC_EXCHANGE || "coinbase",
    circuit_breakers: cbs,
    ts: ts()
  };
};
app.get("/healthz", async (c) => c.json(await healthPayload(c.env)));
app.get("/health", async (c) => c.json(await healthPayload(c.env)));
app.get("/api/health", async (c) => c.json({ status: "ok", ...safeRuntime(c.env), ts: ts() }));
app.get("/ready", async (c) => {
  const g = await getGuardian(c.env);
  return c.json({ ready: true, status: "ok", guardian_triggered: bool(g.triggered), ...safeRuntime(c.env), ts: ts() });
});
app.get("/runtime/status", (c) => c.json({
  ...safeRuntime(c.env),
  market_data_source: c.env.MARKET_DATA_PUBLIC_EXCHANGE || "coinbase",
  starting_balance: n(c.env.PAPER_STARTING_BALANCE_USDT, 1e4),
  guardian_max_drawdown: n(c.env.GUARDIAN_MAX_DRAWDOWN_PCT, 15),
  runtime: "cloudflare-workers",
  region: "global-edge",
  ts: ts()
}));
app.get("/market/feed/status", async (c) => {
  const cbRows = await c.env.DB.prepare("SELECT * FROM circuit_breaker_state").all().catch(() => ({ results: [] }));
  const breakers = {};
  for (const row of cbRows.results ?? []) {
    breakers[row.source] = { open: bool(row.open), fail_count: n(row.fail_count), last_fail_at: row.last_fail_at };
  }
  return c.json({
    primary: "coinbase",
    fallback: "binance",
    status: "live_public",
    circuit_breakers: breakers,
    tracked_symbols: Object.keys(COIN_META),
    ...safeRuntime(c.env),
    ts: ts()
  });
});
app.get("/market/price/:symbol", async (c) => {
  const result = await resolvePrice(c.env, c.req.param("symbol"));
  return c.json(result);
});
app.get("/market/prices", async (c) => {
  const symbols = (c.req.query("symbols") ?? Object.keys(COIN_META).slice(0, 6).join(",")).split(",").map((s) => s.trim()).filter(Boolean).slice(0, 20);
  const results = await Promise.all(symbols.map((s) => resolvePrice(c.env, s)));
  return c.json({ prices: results, count: results.length, ts: ts() });
});
app.get("/market/snapshots", async (c) => {
  const symbol = c.req.query("symbol");
  const limit = Math.min(n(c.req.query("limit"), 50), 200);
  const query = symbol ? "SELECT * FROM market_snapshots WHERE symbol = ? ORDER BY created_at DESC LIMIT ?" : "SELECT * FROM market_snapshots ORDER BY created_at DESC LIMIT ?";
  const stmt = symbol ? c.env.DB.prepare(query).bind(sym(symbol), limit) : c.env.DB.prepare(query).bind(limit);
  const rows = await stmt.all().catch(() => ({ results: [] }));
  return c.json({ snapshots: rows.results ?? [], count: (rows.results ?? []).length, ts: ts() });
});
app.get("/signal/latest", async (c) => {
  const symbol = sym(c.req.query("symbol"));
  const row = await c.env.DB.prepare(
    "SELECT * FROM signals WHERE symbol = ? ORDER BY created_at DESC LIMIT 1"
  ).bind(symbol).first().catch(() => null);
  if (row) return c.json({ ...row, action: row.side, signal: row.side, available: true, ...safeRuntime(c.env), ts: ts() });
  const px = await resolvePrice(c.env, symbol);
  const history = await c.env.DB.prepare(
    "SELECT price FROM market_snapshots WHERE symbol = ? ORDER BY created_at DESC LIMIT 20"
  ).bind(symbol).all().catch(() => ({ results: [] }));
  const prices = (history.results ?? []).map((r) => n(r.price)).filter((p) => p > 0);
  let side = "HOLD", confidence = 0.5;
  if (prices.length >= 5) {
    const emaFast = prices.slice(0, 3).reduce((s, v) => s + v, 0) / 3;
    const emaSlow = prices.reduce((s, v) => s + v, 0) / prices.length;
    if (emaFast > emaSlow * 1.002) {
      side = "BUY";
      confidence = 0.68;
    }
    if (emaFast < emaSlow * 0.998) {
      side = "SELL";
      confidence = 0.65;
    }
  }
  return c.json({
    symbol,
    timeframe: "5m",
    side,
    action: side,
    signal: side,
    confidence,
    entry_price: px.price,
    stop_loss: side === "BUY" ? px.price * 0.98 : null,
    take_profit: side === "BUY" ? px.price * 1.04 : null,
    strategy: "worker_ema_crossover",
    available: true,
    price_source: px.source,
    ...safeRuntime(c.env),
    ts: ts()
  });
});
app.get("/signal/history", async (c) => {
  const symbol = c.req.query("symbol");
  const limit = Math.min(n(c.req.query("limit"), 50), 500);
  const query = symbol ? "SELECT * FROM signals WHERE symbol = ? ORDER BY created_at DESC LIMIT ?" : "SELECT * FROM signals ORDER BY created_at DESC LIMIT ?";
  const stmt = symbol ? c.env.DB.prepare(query).bind(sym(symbol), limit) : c.env.DB.prepare(query).bind(limit);
  const rows = await stmt.all().catch(() => ({ results: [] }));
  return c.json({ signals: rows.results ?? [], count: (rows.results ?? []).length, ts: ts() });
});
app.get("/exchange/status", (c) => c.json({
  status: "paper_only",
  public_market_data: c.env.MARKET_DATA_PUBLIC_EXCHANGE || "coinbase",
  live_execution: false,
  ...safeRuntime(c.env),
  ts: ts()
}));
app.get("/exchange/circuit-breakers", async (c) => {
  const rows = await c.env.DB.prepare("SELECT * FROM circuit_breaker_state").all().catch(() => ({ results: [] }));
  const adapters = (rows.results ?? []).map((r) => ({
    source: r.source,
    open: bool(r.open),
    fail_count: n(r.fail_count),
    last_fail_at: r.last_fail_at,
    reset_in_ms: r.last_fail_at ? Math.max(0, CIRCUIT_OPEN_MS - (ts() - new Date(r.last_fail_at).getTime())) : 0
  }));
  for (const source of ["coinbase", "binance"]) {
    if (!adapters.find((a) => a.source === source)) {
      adapters.push({ source, open: false, fail_count: 0, last_fail_at: null, reset_in_ms: 0 });
    }
  }
  return c.json({ adapters, count: adapters.length, ts: ts() });
});
app.post("/orders", async (c) => {
  if (!requireApiKey(c.env, c.req.raw)) return c.json({ error: "Unauthorized", code: 401 }, 401);
  const input = await c.req.json().catch(() => ({}));
  const result = await placePaperOrder(c.env, input);
  return c.json(result.body, result.status);
});
app.post("/order", async (c) => {
  if (!requireApiKey(c.env, c.req.raw)) return c.json({ error: "Unauthorized", code: 401 }, 401);
  const input = await c.req.json().catch(() => ({}));
  const result = await placePaperOrder(c.env, input);
  return c.json(result.body, result.status);
});
app.get("/orders", async (c) => {
  const limit = Math.min(n(c.req.query("limit"), 50), 500);
  const rows = await c.env.DB.prepare("SELECT * FROM orders ORDER BY created_at DESC LIMIT ?").bind(limit).all().catch(() => ({ results: [] }));
  const orders = (rows.results ?? []).map((o) => ({ ...o, side: String(o.side).toUpperCase(), status: String(o.status).toUpperCase(), order_type: "MARKET" }));
  return c.json({ orders, count: orders.length, ts: ts() });
});
app.get("/orders/:id", async (c) => {
  const row = await c.env.DB.prepare("SELECT * FROM orders WHERE id = ? LIMIT 1").bind(c.req.param("id")).first().catch(() => null);
  if (!row) return c.json({ error: "Order not found" }, 404);
  return c.json({ ...row, side: String(row.side).toUpperCase(), status: String(row.status).toUpperCase() });
});
app.get("/portfolio", async (c) => c.json(await getPortfolio(c.env)));
app.get("/portfolio/summary", async (c) => c.json(await getPortfolio(c.env)));
app.get("/portfolio/positions", async (c) => {
  const positions = await openPositions(c.env);
  return c.json({ positions, count: positions.length, ...safeRuntime(c.env), ts: ts() });
});
app.get("/portfolio/balance", async (c) => {
  const balance = await getBalance(c.env);
  return c.json({ balance_usdt: balance, cash_usdt: balance, ...safeRuntime(c.env), ts: ts() });
});
app.get("/guardian/status", async (c) => c.json(await getGuardian(c.env)));
app.post("/guardian/halt", async (c) => {
  if (!requireApiKey(c.env, c.req.raw)) return c.json({ error: "Unauthorized", code: 401 }, 401);
  const body = await c.req.json().catch(() => ({}));
  const reason = body.reason ?? "Manual halt via API";
  await ensureGuardian(c.env);
  await c.env.DB.prepare(
    "UPDATE guardian_state SET triggered = 1, reason = ?, updated_at = CURRENT_TIMESTAMP WHERE id = 1"
  ).bind(reason).run();
  const result = { status: "triggered", triggered: true, reason, ...safeRuntime(c.env), ts: ts() };
  await audit(c.env, "guardian_halt", result);
  return c.json(result);
});
app.post("/guardian/reset", async (c) => {
  if (!requireApiKey(c.env, c.req.raw)) return c.json({ error: "Unauthorized", code: 401 }, 401);
  await ensureGuardian(c.env);
  await c.env.DB.prepare(
    "UPDATE guardian_state SET triggered = 0, reason = NULL, error_count = 0, drawdown_pct = 0, updated_at = CURRENT_TIMESTAMP WHERE id = 1"
  ).run();
  const result = { status: "reset", triggered: false, ...safeRuntime(c.env), ts: ts() };
  await audit(c.env, "guardian_reset", result);
  return c.json(result);
});
app.post("/guardian/trigger", async (c) => {
  if (!requireApiKey(c.env, c.req.raw)) return c.json({ error: "Unauthorized", code: 401 }, 401);
  const body = await c.req.json().catch(() => ({}));
  await ensureGuardian(c.env);
  await c.env.DB.prepare(
    "UPDATE guardian_state SET triggered = 1, reason = ?, updated_at = CURRENT_TIMESTAMP WHERE id = 1"
  ).bind(body.reason ?? "API trigger").run();
  return c.json({ status: "triggered", triggered: true, ...safeRuntime(c.env), ts: ts() });
});
app.get("/surge/status", async (c) => {
  const rows = await c.env.DB.prepare(
    "SELECT * FROM surge_events ORDER BY triggered_at DESC LIMIT 10"
  ).all().catch(() => ({ results: [] }));
  return c.json({
    scanner_active: true,
    recent_surges: rows.results ?? [],
    tracked_symbols: Object.keys(COIN_META),
    scan_interval_s: 300,
    ...safeRuntime(c.env),
    ts: ts()
  });
});
app.get("/surge/history", async (c) => {
  const limit = Math.min(n(c.req.query("limit"), 50), 200);
  const rows = await c.env.DB.prepare(
    "SELECT * FROM surge_events ORDER BY triggered_at DESC LIMIT ?"
  ).bind(limit).all().catch(() => ({ results: [] }));
  return c.json({ surges: rows.results ?? [], count: (rows.results ?? []).length, ts: ts() });
});
app.get("/earnings", async (c) => {
  const rows = await c.env.DB.prepare(
    "SELECT date, SUM(pnl) as pnl, MAX(cumulative_pnl) as cumulative_pnl FROM earnings GROUP BY date ORDER BY date DESC LIMIT 90"
  ).all().catch(() => ({ results: [] }));
  const total = await c.env.DB.prepare("SELECT SUM(pnl) as total, COUNT(*) as trades FROM earnings").first().catch(() => null);
  return c.json({
    daily: rows.results ?? [],
    total_pnl: n(total?.total),
    total_trades: n(total?.trades),
    ...safeRuntime(c.env),
    ts: ts()
  });
});
app.get("/earnings/summary", async (c) => {
  const today_row = await c.env.DB.prepare("SELECT SUM(pnl) as pnl FROM earnings WHERE date = ?").bind(day()).first().catch(() => null);
  const total_row = await c.env.DB.prepare("SELECT SUM(pnl) as pnl FROM earnings").first().catch(() => null);
  return c.json({
    today_pnl: n(today_row?.pnl),
    total_pnl: n(total_row?.pnl),
    date: day(),
    ...safeRuntime(c.env),
    ts: ts()
  });
});
app.get("/audit", async (c) => {
  const limit = Math.min(n(c.req.query("limit"), 100), 500);
  const rows = await c.env.DB.prepare("SELECT * FROM audit_trail ORDER BY timestamp DESC LIMIT ?").bind(limit).all().catch(() => ({ results: [] }));
  return c.json({ audit: rows.results ?? [], count: (rows.results ?? []).length, ts: ts() });
});
app.get("/system/config", async (c) => {
  const rows = await c.env.DB.prepare("SELECT key, value FROM system_config").all().catch(() => ({ results: [] }));
  const config = {};
  for (const row of rows.results ?? []) config[row.key] = row.value;
  return c.json({ config, ...safeRuntime(c.env), ts: ts() });
});
app.post("/system/config", async (c) => {
  if (!requireApiKey(c.env, c.req.raw)) return c.json({ error: "Unauthorized", code: 401 }, 401);
  const body = await c.req.json().catch(() => ({}));
  for (const [key, value] of Object.entries(body)) {
    await c.env.DB.prepare(
      "INSERT INTO system_config (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = ?, updated_at = CURRENT_TIMESTAMP"
    ).bind(key, String(value), String(value)).run().catch(() => void 0);
  }
  await audit(c.env, "system_config_update", body);
  return c.json({ status: "ok", updated: Object.keys(body).length, ts: ts() });
});
app.post("/intent/live", (c) => c.json({ error: "Live trading is disabled", code: 403, mode: PAPER }, 403));
app.post("/withdraw", (c) => c.json({ error: "Withdrawals are disabled", code: 403, mode: PAPER }, 403));
app.post("/live/order", (c) => c.json({ error: "Live orders are disabled", code: 403, mode: PAPER }, 403));
app.post("/live/trade", (c) => c.json({ error: "Live trades are disabled", code: 403, mode: PAPER }, 403));
app.all("*", (c) => c.json({ error: "Not found", path: new URL(c.req.url).pathname, ts: ts() }, 404));
var index_default = {
  fetch: app.fetch,
  async scheduled(event, env, ctx) {
    ctx.waitUntil((async () => {
      try {
        const cron = event.cron;
        if (cron === "*/5 * * * *") await cronEvery5Min(env);
        if (cron === "*/20 * * * *") await cronEvery20Min(env);
        if (cron === "0 * * * *") await cronHourly(env);
        if (cron === "0 0 * * *") await cronDaily(env);
        await audit(env, "cron_fired", { cron, ts: ts() });
      } catch (err) {
        console.error("[cron error]", event.cron, err);
      }
    })());
  }
};

// src/fast-path/types.ts
var DEFAULT_FAST_PATH_THRESHOLDS = Object.freeze({
  greenMaxAgeMs: 500,
  amberMaxAgeMs: 1500,
  heartbeatTimeoutMs: 5e3,
  recoveryTimeoutMs: 1e4,
  maxBufferedEvents: 2e3,
  maxTrackedFeeds: 256,
  maxSeenEventIds: 1e4
});

// src/fast-path/events.ts
function validateNormalizedEvent(event) {
  const errors = [];
  if (event.version !== "2.0") errors.push("unsupported_version");
  if (!event.eventId) errors.push("missing_event_id");
  if (!event.channel) errors.push("missing_channel");
  if (!event.symbol) errors.push("missing_symbol");
  if (!Number.isFinite(event.exchangeTsMs) || event.exchangeTsMs <= 0) errors.push("invalid_exchange_timestamp");
  if (!Number.isFinite(event.receivedTsMs) || event.receivedTsMs <= 0) errors.push("invalid_received_timestamp");
  if (event.sequenceStart !== void 0 && event.sequenceEnd !== void 0 && event.sequenceStart > event.sequenceEnd) {
    errors.push("invalid_sequence_range");
  }
  if (event.bid !== void 0 && (!Number.isFinite(event.bid) || event.bid < 0)) errors.push("invalid_bid");
  if (event.ask !== void 0 && (!Number.isFinite(event.ask) || event.ask < 0)) errors.push("invalid_ask");
  return errors;
}
function classifySequence(lastSequence, sequenceStart, sequenceEnd) {
  if (sequenceStart === void 0 && sequenceEnd === void 0) return "not_reported";
  const start = sequenceStart ?? sequenceEnd;
  const end = sequenceEnd ?? sequenceStart;
  if (lastSequence === null) return "bootstrap";
  if (end === lastSequence) return "duplicate";
  if (end < lastSequence) return "out_of_order";
  if (start > lastSequence + 1) return "gap";
  return "continuous";
}
function isHeartbeatEvent(event) {
  return event.kind === "heartbeat";
}
function feedKey(event) {
  return `${event.source}:${event.channel}:${event.symbol}`;
}

// src/fast-path/freshness.ts
function classifyFreshness(eventAgeMs, integrityHealthy, thresholds = DEFAULT_FAST_PATH_THRESHOLDS) {
  if (eventAgeMs === null || !Number.isFinite(eventAgeMs)) return "not_reported";
  if (!integrityHealthy || eventAgeMs > thresholds.amberMaxAgeMs) return "red";
  if (eventAgeMs <= thresholds.greenMaxAgeMs) return "green";
  return "amber";
}

// src/fast-path/feed-health.ts
function copyState(state) {
  return { ...state };
}
function initialState(event) {
  return {
    source: event.source,
    channel: event.channel,
    symbol: event.symbol,
    connectionState: "connected",
    integrityState: "degraded",
    sequenceState: "not_reported",
    heartbeatState: "missing",
    recoveryState: "idle",
    lastSequence: null,
    lastExchangeTsMs: null,
    lastReceivedTsMs: null,
    lastHeartbeatTsMs: null,
    eventAgeMs: null,
    freshnessClass: "not_reported",
    gapCount: 0,
    duplicateCount: 0,
    outOfOrderCount: 0,
    acceptedEventCount: 0,
    rejectedEventCount: 0,
    recoveryStartedAtMs: null,
    recoveryCompletedAtMs: null,
    lastErrorCode: null,
    ephemeral: true
  };
}
var FeedHealthRegistry = class {
  constructor(thresholds = { ...DEFAULT_FAST_PATH_THRESHOLDS }) {
    this.thresholds = thresholds;
  }
  thresholds;
  feeds = /* @__PURE__ */ new Map();
  seenEventIds = /* @__PURE__ */ new Set();
  seenEventOrder = [];
  ingest(event, nowMs = event.receivedTsMs) {
    const key = feedKey(event);
    const state = this.getOrCreate(key, event);
    const validationErrors = validateNormalizedEvent(event);
    if (validationErrors.length > 0) {
      state.rejectedEventCount += 1;
      state.integrityState = "unavailable";
      state.lastErrorCode = validationErrors[0];
      this.refreshState(state, nowMs);
      return { accepted: false, reason: "invalid", state: copyState(state) };
    }
    if (this.seenEventIds.has(event.eventId)) {
      state.duplicateCount += 1;
      state.rejectedEventCount += 1;
      state.sequenceState = "duplicate";
      state.lastErrorCode = "DUPLICATE_EVENT";
      this.refreshState(state, nowMs);
      return { accepted: false, reason: "duplicate", state: copyState(state) };
    }
    this.rememberEventId(event.eventId);
    state.connectionState = "connected";
    state.lastReceivedTsMs = event.receivedTsMs;
    state.lastExchangeTsMs = event.exchangeTsMs;
    if (isHeartbeatEvent(event)) {
      state.lastHeartbeatTsMs = event.receivedTsMs;
      state.heartbeatState = "healthy";
      state.acceptedEventCount += 1;
      state.lastErrorCode = null;
      this.propagateHeartbeat(event, nowMs);
      this.refreshState(state, nowMs);
      return { accepted: true, reason: "heartbeat", state: copyState(state) };
    }
    const sequenceState = classifySequence(state.lastSequence, event.sequenceStart, event.sequenceEnd);
    state.sequenceState = sequenceState;
    if (sequenceState === "duplicate") {
      state.duplicateCount += 1;
      state.rejectedEventCount += 1;
      state.lastErrorCode = "DUPLICATE_SEQUENCE";
      this.refreshState(state, nowMs);
      return { accepted: false, reason: "duplicate", state: copyState(state) };
    }
    if (sequenceState === "out_of_order") {
      state.outOfOrderCount += 1;
      state.rejectedEventCount += 1;
      state.integrityState = "degraded";
      state.lastErrorCode = "OUT_OF_ORDER_EVENT";
      this.refreshState(state, nowMs);
      return { accepted: false, reason: "out_of_order", state: copyState(state) };
    }
    if (sequenceState === "gap") {
      state.gapCount += 1;
      state.rejectedEventCount += 1;
      state.integrityState = "resyncing";
      state.recoveryState = "resyncing";
      state.recoveryStartedAtMs = nowMs;
      state.recoveryCompletedAtMs = null;
      state.lastErrorCode = "SEQUENCE_GAP";
      this.refreshState(state, nowMs);
      return { accepted: false, reason: "sequence_gap", state: copyState(state) };
    }
    const end = event.sequenceEnd ?? event.sequenceStart;
    if (end !== void 0) state.lastSequence = end;
    state.acceptedEventCount += 1;
    state.lastErrorCode = null;
    if (state.recoveryState !== "healthy") state.recoveryState = "idle";
    this.refreshState(state, nowMs);
    return { accepted: true, reason: "accepted", state: copyState(state) };
  }
  markRecoveryHealthy(key, lastSequence, nowMs) {
    const state = this.feeds.get(key);
    if (!state) return null;
    state.lastSequence = lastSequence;
    state.sequenceState = "continuous";
    state.recoveryState = "healthy";
    state.recoveryCompletedAtMs = nowMs;
    state.lastErrorCode = null;
    this.refreshState(state, nowMs);
    return copyState(state);
  }
  markUnavailable(key, errorCode, nowMs) {
    const state = this.feeds.get(key);
    if (!state) return null;
    state.integrityState = "unavailable";
    state.recoveryState = "unavailable";
    state.lastErrorCode = errorCode;
    this.refreshState(state, nowMs);
    return copyState(state);
  }
  get(key, nowMs = Date.now()) {
    const state = this.feeds.get(key);
    if (!state) return null;
    this.refreshState(state, nowMs);
    return copyState(state);
  }
  list(nowMs = Date.now()) {
    return [...this.feeds.values()].map((state) => {
      this.refreshState(state, nowMs);
      return copyState(state);
    });
  }
  clear() {
    this.feeds.clear();
    this.seenEventIds.clear();
    this.seenEventOrder.length = 0;
  }
  getOrCreate(key, event) {
    const existing = this.feeds.get(key);
    if (existing) return existing;
    if (this.feeds.size >= this.thresholds.maxTrackedFeeds) {
      const oldestKey = this.feeds.keys().next().value;
      if (oldestKey) this.feeds.delete(oldestKey);
    }
    const created = initialState(event);
    this.feeds.set(key, created);
    return created;
  }
  rememberEventId(eventId) {
    this.seenEventIds.add(eventId);
    this.seenEventOrder.push(eventId);
    while (this.seenEventOrder.length > this.thresholds.maxSeenEventIds) {
      const oldest = this.seenEventOrder.shift();
      if (oldest) this.seenEventIds.delete(oldest);
    }
  }
  propagateHeartbeat(event, nowMs) {
    for (const state of this.feeds.values()) {
      const sameSource = state.source === event.source;
      const sameSymbol = event.symbol === "*" || state.symbol === event.symbol;
      if (!sameSource || !sameSymbol) continue;
      state.lastHeartbeatTsMs = event.receivedTsMs;
      state.heartbeatState = "healthy";
      this.refreshState(state, nowMs);
    }
  }
  refreshState(state, nowMs) {
    state.eventAgeMs = state.lastExchangeTsMs === null ? null : Math.max(0, nowMs - state.lastExchangeTsMs);
    state.heartbeatState = this.heartbeatState(state, nowMs);
    state.integrityState = this.integrityState(state);
    state.freshnessClass = classifyFreshness(
      state.eventAgeMs,
      state.integrityState === "healthy",
      this.thresholds
    );
    if (state.recoveryState === "resyncing" && state.recoveryStartedAtMs !== null && nowMs - state.recoveryStartedAtMs > this.thresholds.recoveryTimeoutMs) {
      state.recoveryState = "unavailable";
      state.integrityState = "unavailable";
      state.lastErrorCode = "RECOVERY_TIMEOUT";
      state.freshnessClass = "red";
    }
  }
  heartbeatState(state, nowMs) {
    if (state.lastHeartbeatTsMs === null) return "missing";
    return nowMs - state.lastHeartbeatTsMs <= this.thresholds.heartbeatTimeoutMs ? "healthy" : "stale";
  }
  integrityState(state) {
    if (state.recoveryState === "unavailable") return "unavailable";
    if (state.recoveryState === "resyncing" || state.sequenceState === "gap") return "resyncing";
    if (state.connectionState !== "connected") return "unavailable";
    if (state.sequenceState === "out_of_order") return "degraded";
    if (state.heartbeatState !== "healthy") return "degraded";
    return "healthy";
  }
};

// src/routes/v2-metrics.ts
function percentile(values, ratio) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * ratio) - 1));
  return Number(sorted[index].toFixed(3));
}
function summarize(values) {
  return {
    p50: percentile(values, 0.5),
    p95: percentile(values, 0.95),
    p99: percentile(values, 0.99)
  };
}
function parseMetricWindowMs(window) {
  const match2 = /^(\d+)(s|m|h)$/.exec(window);
  if (!match2) return 15 * 60 * 1e3;
  const amount = Number(match2[1]);
  const multiplier = match2[2] === "s" ? 1e3 : match2[2] === "m" ? 6e4 : 36e5;
  return Math.min(24 * 36e5, Math.max(1e3, amount * multiplier));
}
var DecisionMetricsStore = class {
  constructor(maxSamples = 5e3) {
    this.maxSamples = maxSamples;
  }
  maxSamples;
  samples = [];
  record(sample) {
    this.samples.push(sample);
    while (this.samples.length > this.maxSamples) this.samples.shift();
  }
  clear() {
    this.samples.length = 0;
  }
  snapshot(window = "15m", nowMs = Date.now()) {
    const cutoff = nowMs - parseMetricWindowMs(window);
    const samples = this.samples.filter((sample) => sample.recordedAtMs >= cutoff);
    const duplicateRejects = samples.filter((sample) => sample.duplicateRejected).length;
    const staleRejects = samples.filter((sample) => sample.staleRejected).length;
    return {
      version: "2.0",
      generated_at: new Date(nowMs).toISOString(),
      window,
      sample_count: samples.length,
      decision_latency_ms: summarize(samples.map((sample) => sample.decisionLatencyMs)),
      decision_data_age_ms: summarize(samples.map((sample) => sample.decisionDataAgeMs)),
      duplicate_reject_rate: samples.length ? duplicateRejects / samples.length : null,
      stale_reject_rate: samples.length ? staleRejects / samples.length : null,
      ledger_atomicity_failures: 0,
      queue_projection_lag_ms: null,
      measurement_scope: samples.length ? "ephemeral_worker_isolate" : "not_reported"
    };
  }
};

// src/fast-path/index.ts
var fastPathFeedRegistry = new FeedHealthRegistry({ ...DEFAULT_FAST_PATH_THRESHOLDS });
var fastPathDecisionMetrics = new DecisionMetricsStore();

// src/routes/v2-market-feeds.ts
function buildV2MarketFeedsStatus(feeds, nowMs = Date.now()) {
  const mapped = feeds.map((feed) => ({
    source: feed.source,
    channel: feed.channel,
    symbol: feed.symbol,
    connection_state: feed.connectionState,
    integrity_state: feed.integrityState,
    sequence_state: feed.sequenceState,
    heartbeat_state: feed.heartbeatState,
    last_sequence: feed.lastSequence,
    gap_count: feed.gapCount,
    duplicate_count: feed.duplicateCount,
    out_of_order_count: feed.outOfOrderCount,
    accepted_event_count: feed.acceptedEventCount,
    rejected_event_count: feed.rejectedEventCount,
    event_age_ms: feed.eventAgeMs,
    freshness_class: feed.freshnessClass,
    recovery_state: feed.recoveryState,
    recovery_started_at: feed.recoveryStartedAtMs === null ? null : new Date(feed.recoveryStartedAtMs).toISOString(),
    recovery_completed_at: feed.recoveryCompletedAtMs === null ? null : new Date(feed.recoveryCompletedAtMs).toISOString(),
    last_event_at: feed.lastReceivedTsMs === null ? null : new Date(feed.lastReceivedTsMs).toISOString(),
    last_exchange_event_at: feed.lastExchangeTsMs === null ? null : new Date(feed.lastExchangeTsMs).toISOString(),
    last_heartbeat_at: feed.lastHeartbeatTsMs === null ? null : new Date(feed.lastHeartbeatTsMs).toISOString(),
    last_error_code: feed.lastErrorCode,
    storage_scope: "ephemeral_worker_isolate"
  }));
  const status = mapped.length === 0 ? "inactive" : mapped.every((feed) => feed.integrity_state === "healthy") ? "active" : "degraded";
  return {
    version: "2.0",
    generated_at: new Date(nowMs).toISOString(),
    status,
    capability_active: mapped.length > 0,
    message: mapped.length > 0 ? "Feed health reflects bounded in-memory events received by this Worker isolate." : "No WebSocket feed gateway is active in this Worker isolate; no connected feeds are reported.",
    feeds: mapped
  };
}

// src/routes/v2-infrastructure.ts
function buildV2InfrastructureStatus(input) {
  const nowMs = input.nowMs ?? Date.now();
  const feedStatus = buildV2MarketFeedsStatus(input.feeds, nowMs);
  const decisionMetrics = input.metrics.snapshot("15m", nowMs);
  const activeFeedCount = feedStatus.feeds.filter((feed) => feed.integrity_state === "healthy").length;
  return {
    version: "2.0",
    generated_at: new Date(nowMs).toISOString(),
    runtime: {
      trading_mode: "paper",
      exchange_mode: "paper",
      network: "testnet",
      allow_mainnet: false,
      live_trading_enabled: false,
      withdrawals_enabled: false
    },
    guardian: {
      halted: input.guardian.halted,
      reason: input.guardian.reason,
      drawdown_pct: input.guardian.drawdownPct,
      max_drawdown_pct: input.guardian.maxDrawdownPct
    },
    fast_path: {
      authority: "legacy_d1",
      target_authority: "portfolio_durable_object",
      shadow_mode: activeFeedCount > 0,
      decision_latency_ms: decisionMetrics.decision_latency_ms.p95,
      decision_data_age_ms: decisionMetrics.decision_data_age_ms.p95,
      ledger_atomicity_failures: decisionMetrics.ledger_atomicity_failures,
      measurement_scope: decisionMetrics.measurement_scope
    },
    feeds: feedStatus.feeds,
    projections: {
      d1_status: input.d1Status,
      queue_status: "not_reported",
      projection_lag_ms: null
    },
    capability_state: {
      websocket_gateway: feedStatus.capability_active ? feedStatus.status : "inactive",
      portfolio_durable_object: "not_implemented",
      queue_projection: "not_reported"
    }
  };
}

// src/agent-context.ts
var CERTIFICATION_RUNTIME = {
  mode: "paper",
  trading_mode: "paper",
  exchange_mode: "paper",
  display_mode: "certification",
  certification_mode: true,
  network: "testnet",
  allow_mainnet: false,
  live_trading_enabled: false,
  provider_mutation_enabled: false,
  real_funds_enabled: false,
  withdrawals_enabled: false
};
function ok(detail = null) {
  return { status: "ok", detail };
}
function degraded(detail) {
  return { status: "degraded", detail };
}
function unavailable(detail) {
  return { status: "unavailable", detail };
}
function booleanValue(value) {
  return value === true || value === 1 || value === "1" || value === "true";
}
function numberValue(value, fallback = 0) {
  const parsed = typeof value === "number" ? value : Number.parseFloat(String(value ?? ""));
  return Number.isFinite(parsed) ? parsed : fallback;
}
function corsHeaders(request, env) {
  const configured = env.CORS_ALLOWED_ORIGINS ? env.CORS_ALLOWED_ORIGINS.split(",").map((value) => value.trim()).filter(Boolean) : ["*"];
  const origin = request.headers.get("Origin") ?? "*";
  const allowedOrigin = configured.includes("*") ? origin : configured.includes(origin) ? origin : configured[0] ?? "null";
  return new Headers({
    "Access-Control-Allow-Origin": allowedOrigin,
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization, X-API-Key",
    "Cache-Control": "no-store",
    "Content-Type": "application/json; charset=utf-8",
    Vary: "Origin"
  });
}
function jsonResponse(request, env, payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: corsHeaders(request, env)
  });
}
async function readGuardian(env) {
  try {
    const row = await env.DB.prepare(
      "SELECT triggered, reason, drawdown_pct FROM guardian_state WHERE id = 1 LIMIT 1"
    ).first();
    if (!row) {
      return {
        check: unavailable("No guardian_state row found"),
        triggered: false,
        reason: null,
        drawdownPct: 0
      };
    }
    const triggered = booleanValue(row.triggered);
    const reason = row.reason ?? null;
    return {
      check: triggered ? degraded(`Guardian triggered${reason ? `: ${reason}` : ""}`) : ok("Guardian nominal"),
      triggered,
      reason,
      drawdownPct: numberValue(row.drawdown_pct)
    };
  } catch (error) {
    return {
      check: unavailable(`guardian_state query failed: ${String(error)}`),
      triggered: false,
      reason: null,
      drawdownPct: 0
    };
  }
}
async function readSignals(env) {
  try {
    const row = await env.DB.prepare(
      "SELECT COUNT(*) AS cnt, MAX(created_at) AS last_ts FROM signals"
    ).first();
    const count = numberValue(row?.cnt);
    return {
      check: ok(`${count} signal(s) available`),
      count,
      lastTs: row?.last_ts ?? null
    };
  } catch (error) {
    return {
      check: unavailable(`signals query failed: ${String(error)}`),
      count: 0,
      lastTs: null
    };
  }
}
async function readPortfolio(env) {
  try {
    const row = await env.DB.prepare(
      "SELECT COUNT(*) AS cnt FROM portfolio WHERE status = 'open' AND symbol != 'USDT'"
    ).first();
    const openPositions2 = numberValue(row?.cnt);
    return {
      check: ok(`${openPositions2} open position(s)`),
      openPositions: openPositions2
    };
  } catch (error) {
    return {
      check: unavailable(`portfolio query failed: ${String(error)}`),
      openPositions: 0
    };
  }
}
async function readMarketFeed(env, fetcher) {
  const circuitBreakers = {
    coinbase: false,
    binance: false
  };
  try {
    const rows = await env.DB.prepare(
      "SELECT source, open FROM circuit_breaker_state"
    ).all();
    for (const row of rows.results ?? []) {
      circuitBreakers[row.source] = booleanValue(row.open);
    }
  } catch {
  }
  try {
    const response = await fetcher(
      "https://api.coinbase.com/v2/prices/BTC-USD/spot",
      { signal: AbortSignal.timeout(3e3) }
    );
    if (!response.ok) {
      return {
        check: degraded(`Coinbase public feed returned HTTP ${response.status}`),
        connected: false,
        circuitBreakers
      };
    }
    return {
      check: ok("Coinbase public feed reachable"),
      connected: true,
      circuitBreakers
    };
  } catch (error) {
    return {
      check: unavailable(`Public market feed unreachable: ${String(error)}`),
      connected: false,
      circuitBreakers
    };
  }
}
async function handleAgentContextRequest(request, env, dependencies = {}) {
  const fetcher = dependencies.fetcher ?? fetch;
  const now = dependencies.now ?? Date.now;
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders(request, env) });
  }
  if (request.method !== "GET") {
    return jsonResponse(request, env, { error: "Method not allowed" }, 405);
  }
  let runtimeCheck;
  try {
    await env.DB.prepare("SELECT 1 AS ok").first();
    runtimeCheck = ok("D1 reachable");
  } catch (error) {
    runtimeCheck = unavailable(`D1 error: ${String(error)}`);
  }
  const [guardian, signal, portfolio, marketFeed] = await Promise.all([
    readGuardian(env),
    readSignals(env),
    readPortfolio(env),
    readMarketFeed(env, fetcher)
  ]);
  const checks = [
    runtimeCheck,
    guardian.check,
    signal.check,
    portfolio.check,
    marketFeed.check
  ];
  const allOk = checks.every((check) => check.status === "ok");
  const payload = {
    ok: allOk,
    ts: now(),
    memory_available: Boolean(env.AGENT_MEMORY),
    runtime: runtimeCheck,
    guardian: guardian.check,
    signal: signal.check,
    portfolio: portfolio.check,
    market_feed: marketFeed.check,
    ...CERTIFICATION_RUNTIME,
    kill_switch_active: guardian.triggered,
    kill_switch_reason: guardian.reason,
    guardian_triggered: guardian.triggered,
    halted: guardian.triggered,
    guardian_drawdown_pct: guardian.drawdownPct,
    active_signals_count: signal.count,
    last_signal_ts: signal.lastTs,
    open_positions_count: portfolio.openPositions,
    market_data_source: env.MARKET_DATA_PUBLIC_EXCHANGE || "coinbase",
    market_data_connected: marketFeed.connected,
    circuit_breakers: marketFeed.circuitBreakers
  };
  return jsonResponse(request, env, payload, allOk ? 200 : 207);
}

// src/index_with_d1.ts
function numberOr(value, fallback = 0) {
  const parsed = typeof value === "number" ? value : Number.parseFloat(String(value ?? ""));
  return Number.isFinite(parsed) ? parsed : fallback;
}
function isSelectOnly(sql) {
  const stripped = sql.replace(/--[^\n]*/g, " ").replace(/\/\*[\s\S]*?\*\//g, " ").trim();
  const firstToken = stripped.split(/\s+/)[0].toUpperCase();
  if (firstToken === "SELECT") return true;
  if (firstToken === "WITH") {
    const upper = stripped.toUpperCase();
    const hasDml = /\b(INSERT|UPDATE|DELETE|DROP|CREATE|ALTER|TRUNCATE|REPLACE)\b/.test(upper);
    return !hasDml;
  }
  return false;
}
function corsHeaders2(request, env) {
  const configured = env.CORS_ALLOWED_ORIGINS ? env.CORS_ALLOWED_ORIGINS.split(",").map((value) => value.trim()).filter(Boolean) : ["*"];
  const origin = request.headers.get("Origin") ?? "*";
  const allowedOrigin = configured.includes("*") ? origin : configured.includes(origin) ? origin : configured[0] ?? "null";
  const headers = new Headers({
    "Access-Control-Allow-Origin": allowedOrigin,
    "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization, X-API-Key",
    "Cache-Control": "no-store",
    "Content-Type": "application/json; charset=utf-8",
    Vary: "Origin"
  });
  return headers;
}
function jsonResponse2(request, env, payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: corsHeaders2(request, env)
  });
}
function unauthorizedResponse(request, env) {
  return jsonResponse2(request, env, { error: "Unauthorized", code: 401 }, 401);
}
async function handleReadonlyD1Query(request, env) {
  let body;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const sql = String(body.sql ?? "").trim();
  if (!sql) {
    return Response.json({ error: "sql is required" }, { status: 400 });
  }
  if (!isSelectOnly(sql)) {
    return Response.json(
      { error: "Only SELECT queries are permitted on this endpoint" },
      { status: 400 }
    );
  }
  const params = Array.isArray(body.params) ? body.params : [];
  const result = await env.DB.prepare(sql).bind(...params).all();
  return Response.json({ result, readonly: true });
}
async function handleAgentMemory(request, env, key) {
  if (!env.AGENT_MEMORY) {
    return Response.json({ error: "AGENT_MEMORY KV namespace not bound" }, { status: 503 });
  }
  if (request.method === "GET") {
    const value = await env.AGENT_MEMORY.get(key, { type: "json" });
    return Response.json({ key, value, ts: Date.now() });
  }
  if (request.method === "POST") {
    const body = await request.json();
    await env.AGENT_MEMORY.put(key, JSON.stringify(body.value), {
      expirationTtl: 60 * 60 * 24 * 30
    });
    return Response.json({ key, value: body.value, ts: Date.now() });
  }
  if (request.method === "DELETE") {
    await env.AGENT_MEMORY.delete(key);
    return Response.json({ deleted: true, key, ts: Date.now() });
  }
  return Response.json({ error: "Method not allowed" }, { status: 405 });
}
async function readD1Status(env) {
  try {
    await env.DB.prepare("SELECT 1 AS ok").first();
    return "healthy";
  } catch {
    return "unavailable";
  }
}
async function readGuardianSnapshot(env) {
  const row = await env.DB.prepare(
    "SELECT triggered, reason, drawdown_pct FROM guardian_state WHERE id = 1 LIMIT 1"
  ).first().catch(() => null);
  return {
    halted: row?.triggered === true || row?.triggered === 1,
    reason: row?.reason ?? null,
    drawdownPct: numberOr(row?.drawdown_pct),
    maxDrawdownPct: numberOr(env.GUARDIAN_MAX_DRAWDOWN_PCT, 15)
  };
}
async function handleV2Infrastructure(request, env) {
  const nowMs = Date.now();
  const [guardian, d1Status] = await Promise.all([
    readGuardianSnapshot(env),
    readD1Status(env)
  ]);
  const payload = buildV2InfrastructureStatus({
    guardian,
    d1Status,
    feeds: fastPathFeedRegistry.list(nowMs),
    metrics: fastPathDecisionMetrics,
    nowMs
  });
  return jsonResponse2(request, env, payload);
}
function handleV2MarketFeeds(request, env) {
  const nowMs = Date.now();
  return jsonResponse2(
    request,
    env,
    buildV2MarketFeedsStatus(fastPathFeedRegistry.list(nowMs), nowMs)
  );
}
function handleV2DecisionMetrics(request, env) {
  const url = new URL(request.url);
  const window = url.searchParams.get("window") ?? "15m";
  return jsonResponse2(request, env, fastPathDecisionMetrics.snapshot(window));
}
var index_with_d1_default = {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const memoryMatch = url.pathname.match(/^\/agent\/memory\/([^/]+)$/);
    const isPrivilegedD1Query = url.pathname === "/d1/query/readonly";
    if (request.method === "OPTIONS" && (url.pathname.startsWith("/v2/") || Boolean(memoryMatch) || isPrivilegedD1Query)) {
      return new Response(null, { status: 204, headers: corsHeaders2(request, env) });
    }
    if ((memoryMatch || isPrivilegedD1Query) && !requireApiKey(env, request)) {
      return unauthorizedResponse(request, env);
    }
    if (request.method === "GET" && url.pathname === "/v2/infrastructure/status") {
      return handleV2Infrastructure(request, env);
    }
    if (request.method === "GET" && url.pathname === "/v2/market/feeds/status") {
      return handleV2MarketFeeds(request, env);
    }
    if (request.method === "GET" && url.pathname === "/v2/metrics/decision") {
      return handleV2DecisionMetrics(request, env);
    }
    if (memoryMatch) {
      return handleAgentMemory(request, env, decodeURIComponent(memoryMatch[1]));
    }
    if (request.method === "GET" && url.pathname === "/agent/context") {
      return handleAgentContextRequest(request, env);
    }
    if (request.method === "POST" && url.pathname === "/d1/query/readonly") {
      return handleReadonlyD1Query(request, env);
    }
    return index_default.fetch(request, env, ctx);
  },
  scheduled: index_default.scheduled
};

// src/index_agent_context.ts
var index_agent_context_default = {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (url.pathname === "/agent/context") {
      return handleAgentContextRequest(request, env);
    }
    return index_with_d1_default.fetch(request, env, ctx);
  },
  scheduled: index_with_d1_default.scheduled
};
export {
  index_agent_context_default as default
};
