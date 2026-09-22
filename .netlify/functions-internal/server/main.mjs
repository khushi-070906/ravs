globalThis.__nitro_main__ = import.meta.url;
import { n as HTTPError, t as H3Core } from "./_libs/h3+rou3+srvx.mjs";
import { t as NodeResponse } from "./_libs/srvx.mjs";
//#region node_modules/nitro/dist/runtime/internal/error/prod.mjs
const errorHandler = (error, event) => {
  const res = defaultHandler(error, event);
  return new NodeResponse(
    typeof res.body === "string" ? res.body : JSON.stringify(res.body, null, 2),
    res,
  );
};
function defaultHandler(error, event) {
  const unhandled = error.unhandled ?? !HTTPError.isError(error);
  const { status = 500, statusText = "" } = unhandled ? {} : error;
  if (status === 404) {
    const url = event.url || new URL(event.req.url);
    const baseURL = "/";
    if (/^\/[^/]/.test(baseURL) && !url.pathname.startsWith(baseURL))
      return {
        status: 302,
        headers: new Headers({ location: `${baseURL}${url.pathname.slice(1)}${url.search}` }),
      };
  }
  const headers = new Headers(unhandled ? {} : error.headers);
  headers.set("content-type", "application/json; charset=utf-8");
  return {
    status,
    statusText,
    headers,
    body: {
      error: true,
      ...(unhandled
        ? {
            status,
            unhandled: true,
          }
        : typeof error.toJSON === "function"
          ? error.toJSON()
          : {
              status,
              statusText,
              message: error.message,
            }),
    },
  };
}
//#endregion
//#region #nitro/virtual/error-handler
const errorHandlers = [errorHandler];
async function error_handler_default(error, event) {
  for (const handler of errorHandlers)
    try {
      const response = await handler(error, event, { defaultHandler });
      if (response) return response;
    } catch (error) {
      console.error(error);
    }
}
//#endregion
//#region #nitro/virtual/app
function createNitroApp() {
  const captureError = (error, errorCtx) => {
    if (errorCtx?.event) {
      const errors = errorCtx.event.req.context?.nitro?.errors;
      if (errors)
        errors.push({
          error,
          context: errorCtx,
        });
    }
  };
  const h3App = createH3App({
    onError(error, event) {
      return error_handler_default(error, event);
    },
  });
  let appHandler = (req) => {
    req.context ||= {};
    req.context.nitro = req.context.nitro || { errors: [] };
    return h3App.fetch(req);
  };
  return {
    fetch: appHandler,
    h3: h3App,
    hooks: void 0,
    captureError,
  };
}
function createH3App(config) {
  return new H3Core(config);
}
//#endregion
//#region node_modules/nitro/dist/runtime/internal/app.mjs
const APP_ID = "default";
function useNitroApp() {
  let instance = useNitroApp._instance;
  if (instance) return instance;
  instance = useNitroApp._instance = createNitroApp();
  globalThis.__nitro__ = globalThis.__nitro__ || {};
  globalThis.__nitro__[APP_ID] = instance;
  return instance;
}
//#endregion
//#region node_modules/nitro/dist/presets/netlify/runtime/netlify.mjs
const nitroApp = useNitroApp();
const ONE_YEAR_IN_SECONDS = 31536e3;
const handler = async (req) => {
  req.runtime ??= { name: "netlify" };
  req.ip ??= req.headers.get("x-nf-client-connection-ip") || void 0;
  const response = await nitroApp.fetch(req);
  const isr = (req.context?.routeRules || {})?.isr?.options;
  if (isr) {
    const maxAge = typeof isr === "number" ? isr : ONE_YEAR_IN_SECONDS;
    const revalidateDirective =
      typeof isr === "number" ? `stale-while-revalidate=${ONE_YEAR_IN_SECONDS}` : "must-revalidate";
    if (!response.headers.has("Cache-Control"))
      response.headers.set("Cache-Control", "public, max-age=0, must-revalidate");
    response.headers.set(
      "Netlify-CDN-Cache-Control",
      `public, max-age=${maxAge}, ${revalidateDirective}, durable`,
    );
  }
  return response;
};
//#endregion
export { handler as default };
